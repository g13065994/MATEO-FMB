'use strict';

const path = require('path');
const Logger = require('./Logger');
const ConfigManager = require('./ConfigManager');
const StateManager = require('./StateManager');
const EventBus = require('./EventBus');
const createDatabase = require('./DatabaseFactory');
const PermissionManager = require('./PermissionManager');
const GroupManager = require('./GroupManager');
const UserManager = require('./UserManager');
const ModerationManager = require('./ModerationManager');
const Formatter = require('./Formatter');
const ErrorHandler = require('./ErrorHandler');
const CommandRegistry = require('./CommandRegistry');
const EventLoader = require('./EventLoader');
const ConnectionManager = require('./ConnectionManager');
const HealthServer = require('./HealthServer');
const SafetyMonitor = require('./SafetyMonitor');
const PerformanceManager = require('./PerformanceManager');
const RecoveryManager = require('./RecoveryManager');
const BackupManager = require('./BackupManager');
const SchedulerService = require('./SchedulerService');
const PluginManager = require('./PluginManager');
const AiMemoryStore = require('./AiMemoryStore');
const EryxenxFcaAdapter = require('../platform/EryxenxFcaAdapter');
const axios = require('axios');
const AiProvider = require('../ai/AiProvider');
const DatabaseHealthMonitor = require('./DatabaseHealthMonitor');
const FreeFirePurchaseService = require('../services/FreeFirePurchaseService');

function createPlatformAdapter(config) {
  const name = String(config?.get('platform.adapter', 'eryxenx-fca') || 'eryxenx-fca').toLowerCase();
  if (name === 'eryxenx-fca') return new EryxenxFcaAdapter();
  throw new Error('Unknown platform.adapter: ' + name);
}

class BotApp {
  constructor({ rootDir = process.cwd() } = {}) {
    this.rootDir = rootDir;
    this.logger = new Logger();
    this.config = new ConfigManager({ rootDir, logger: this.logger });
    this.state = new StateManager(this.config.all(), this.logger);
    this.events = new EventBus();

    this.scheduler = new SchedulerService({ rootDir, config: this.config, logger: this.logger });
    this.pluginManager = new PluginManager({ rootDir, config: this.config, logger: this.logger });
    this.db = createDatabase({ rootDir, config: this.config, logger: this.logger });
    this.dbHealth = new DatabaseHealthMonitor({ db: this.db, logger: this.logger, intervalMs: this.config.get('database.healthCheckIntervalMs', 60000) });
    this.backup = new BackupManager({ rootDir, db: this.db, scheduler: this.scheduler, config: this.config, logger: this.logger });

    this.groups = new GroupManager(this.db);
    this.users = new UserManager(this.db);
    this.permissions = new PermissionManager(this.config, this.db);
    this.formatter = new Formatter(this.config);
    this.errors = new ErrorHandler({ logger: this.logger, state: this.state, formatter: this.formatter });
    this.safety = new SafetyMonitor({ state: this.state, logger: this.logger, config: this.config });
    this.performance = new PerformanceManager({ config: this.config, state: this.state, logger: this.logger });

    this.aiMemory = new AiMemoryStore({ rootDir, logger: this.logger });
    this.ai = new AiProvider({ axios, config: this.config, performance: this.performance, memory: this.aiMemory, logger: this.logger });
    this.freeFirePurchase = new FreeFirePurchaseService({ rootDir, logger: this.logger, db: this.db });

    this.recovery = new RecoveryManager({ state: this.state, logger: this.logger, safety: this.safety, performance: this.performance });
    this.moderation = new ModerationManager({ db: this.db, groups: this.groups, permissions: this.permissions, state: this.state, logger: this.logger });

    this.platform = createPlatformAdapter(this.config);
    this.connection = new ConnectionManager({
      config: this.config,
      state: this.state,
      events: this.events,
      logger: this.logger,
      rootDir,
      performance: this.performance,
      adapter: this.platform
    });

    const services = {
      ai: this.ai,
      aiMemory: this.aiMemory,
      groups: this.groups,
      users: this.users,
      moderation: this.moderation,
      scheduler: this.scheduler,
      backup: this.backup,
      plugins: this.pluginManager,
      formatter: this.formatter,
      errors: this.errors,
      safety: this.safety,
      performance: this.performance,
      recovery: this.recovery,
      freeFirePurchase: this.freeFirePurchase,
    };

    this.commands = new CommandRegistry({
      commandsDir: path.join(rootDir, 'src', 'cmds'),
      config: this.config,
      db: this.db,
      permissions: this.permissions,
      logger: this.logger,
      state: this.state,
      services,
      pluginManager: this.pluginManager
    });

    this.eventLoader = new EventLoader({
      eventsDir: path.join(rootDir, 'src', 'events'),
      bus: this.events,
      logger: this.logger,
      apiProvider: () => this.connection.api,
      services: { ...services, db: this.db, config: this.config },
      pluginManager: this.pluginManager
    });

    this.health = new HealthServer({ app: this, logger: this.logger });
    this.startedAt = Date.now();
    this._shutdownBound = false;
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return this;
    try {
      this.pluginManager.discover();
      this.eventLoader.load();

      this.events.on('message', async ({ api, event }) => {
        try {
          if (event?.senderID) await this.users.recordMessage(event.senderID, event.senderName || '');
          const moderation = await this.moderation.inspect(event);
          if (moderation.action !== 'allow') {
            if (api?.sendMessage) await api.sendMessage(this.formatter.box('Moderation', [moderation.reason]), event.threadID);
            return;
          }
          await this.commands.execute(api, event);
        } catch (error) {
          this.recovery.recordFailure(error, 'message');
          this.errors.record(error, { scope: 'message' });
          if (api?.sendMessage && event?.threadID) {
            try { await api.sendMessage(this.errors.response(), event.threadID); } catch (sendError) { this.errors.record(sendError, { scope: 'message-response' }); }
          }
        }
      });

      this.events.on('connection:error', error => {
        const safety = this.safety.inspect(error, 'connection');
        this.recovery.recordFailure(error, 'connection');
        this.errors.record(error, { scope: 'connection' });
        if (safety.action === 'pause') {
          this.connection.stopping = true;
          this.connection.listening = false;
        }
      });

      this.events.on('listener:error', ({ type, error }) => {
        this.recovery.recordFailure(error, 'event:' + type);
        this.errors.record(error, { scope: 'event:' + type });
      });

      this._bindShutdownSignals();
      this._initialized = true;
      return this;
    } catch (error) {
      this.recovery.recordFailure(error, 'init');
      this.errors.record(error, { scope: 'init' });
      throw error;
    }
  }

  async start() {
    await this.init();
    try {
      await this.backup.applyPendingRestore();
      this.aiMemory.init();
      await this.db.init();
      await this.scheduler.load();

      this.health.start();
      this.dbHealth.start();
      this.performance.startMonitoring();
      this.logger.info('Performance mode: ' + this.performance.mode);
      this.logger.info('Platform adapter: ' + this.platform.name);
      this.logger.info('Loading credentials...');

      await this.connection.connect({
        beforeListen: async () => {
          this.logger.info('Login successful.');
          this.logger.info('Loading commands...');
          this.commands.load();
          this.logger.info('Commands loaded.');
          this.logger.info('Storage: ' + this.config.get('storage.mode', 'sqlite'));
          this.logger.info('Users loaded (' + (this.db.data?.users?.length || 0) + ').');
        }
      });

      this.scheduler.start(() => this.connection.api);

      if (this.config.get('backups.autoOnStart', true)) {
        await this.backup.create('startup').catch(error => this.logger.warn('Startup backup skipped: ' + error.message));
      }

      return this;
    } catch (error) {
      const safety = this.safety.inspect(error, 'startup');
      this.recovery.recordFailure(error, 'startup');
      this.errors.record(error, { scope: 'start' });
      if (safety.action === 'pause') this.connection.stopping = true;
      this.scheduler.stop();
      this.dbHealth.stop();
      this.performance.stopMonitoring();
      await this.health.stop();
      throw error;
    }
  }

  async shutdown(signal = 'manual') {
    this.logger.info('Shutting down (' + signal + ')...');
    try {
      this.scheduler.stop();
      this.dbHealth.stop();
      this.performance.stopMonitoring();
      await this.connection.disconnect();
      await this.health.stop();
      await this.db.write?.();
      this.db.close?.();
      this.state.setState('status', 'offline');
    } catch (error) {
      this.recovery.recordFailure(error, 'shutdown');
      this.errors.record(error, { scope: 'shutdown' });
      throw error;
    }
  }

  status() {
    const status = this.state.getStatus();
    return {
      ...status,
      botName: this.config.get('botName'),
      commands: this.commands.commands.size,
      users: this.db.data?.users?.length || 0,
      groups: this.db.data?.groups?.length || 0,
      connected: Boolean(this.connection.api),
      uptime: Date.now() - this.startedAt,
      platform: { adapter: this.platform.name, capabilities: this.platform.capabilities() },
      storage: { mode: this.config.get('storage.mode', 'sqlite'), file: this.db.file },
      databaseHealth: this.dbHealth.status(),
      plugins: this.pluginManager.list(),
      scheduler: this.scheduler.status(),
      safety: this.safety.status(),
      recovery: this.recovery.snapshot(),
      performance: this.performance.snapshot()
    };
  }

  _bindShutdownSignals() {
    if (this._shutdownBound) return;
    this._shutdownBound = true;
    const shutdown = signal => this.shutdown(signal).then(() => process.exit(0)).catch(error => {
      this.errors.record(error, { scope: 'shutdown:' + signal });
      process.exit(1);
    });
    process.once('SIGINT', () => shutdown('SIGINT'));
    process.once('SIGTERM', () => shutdown('SIGTERM'));
  }
}

module.exports = BotApp;
