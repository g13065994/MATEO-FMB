'use strict';

const fs = require('fs');
const path = require('path');
const MessageDelay = require('./MessageDelay');

class AppStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppStateError';
    this.code = code;
  }
}

class ConnectionManager {
  constructor({ config, state, events, logger, rootDir = process.cwd(), performance = null, adapter }) {
    Object.assign(this, { config, state, events, logger, rootDir, performance, adapter });
    this.messageDelay = new MessageDelay({ config, logger });
    this.api = null;
    this.rawApi = null;
    this.listening = false;
    this.stopping = false;
    this.reconnectTimer = null;
    this.reconnectDelay = 5000;
    this.beforeListen = null;
    this.connectionGeneration = 0;
  }

  _appStatePath() {
    return path.resolve(this.rootDir, process.env.MATEO_APPSTATE_FILE || 'appstate.json');
  }

  _loadAppState() {
    const file = this._appStatePath();
    if (!fs.existsSync(file)) throw new AppStateError('MISSING', 'AppState missing');
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) throw new AppStateError('MISSING', 'AppState missing');
    try { return JSON.parse(raw); } catch (_) { throw new AppStateError('INVALID', 'AppState invalid'); }
  }

  _wrapApi(api) {
    const delay = this.messageDelay;
    return new Proxy(api, {
      get(target, property, receiver) {
        if (property === 'sendMessage') {
          return (text, threadID, ...extra) => delay.send(target, text, threadID, ...extra);
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  async connect({ beforeListen = null } = {}) {
    this.stopping = false;
    if (beforeListen) this.beforeListen = beforeListen;
    const generation = ++this.connectionGeneration;
    this.state.setState('status', 'connecting');
    this.state.setState('platform.adapter', this.adapter?.name || 'unknown');

    const appState = this._loadAppState();
    const options = {
      ...(this.config.get('fcaOptions', {}) || {}),
      autoReconnect: false,
      listenEvents: true,
    };

    let api;
    try {
      api = await this.adapter.login(appState, options);
    } catch (error) {
      this.state.setState('status', 'login_failed');
      throw error;
    }

    this.rawApi = api;
    this.api = this._wrapApi(api);
    await this.adapter.afterLogin?.(api, { appStatePath: this._appStatePath(), config: this.config });
    this.state.setState('status', 'online');
    this.state.setState('lastConnected', new Date().toISOString());
    this.reconnectDelay = 5000;

    if (generation !== this.connectionGeneration) return this.api;
    await this.events.dispatch('authenticated', { api: this.api });
    if (typeof this.beforeListen === 'function') await this.beforeListen(this.api);

    this.api.listenMqtt((error, event) => {
      if (generation !== this.connectionGeneration || this.stopping) return;
      if (!this.adapter?.isActive(this.rawApi)) return;

      if (error) {
        this.state.incrementStat('errorsEncountered');
        this.events.dispatch('connection:error', error).catch(err => this.logger.error(err));
        this._scheduleReconnect();
        return;
      }

      this.state.incrementStat('messagesHandled');
      let inboundBytes = 0;
      try { inboundBytes = Buffer.byteLength(JSON.stringify(event || {}), 'utf8'); } catch (_) {}
      this.performance?.recordNetwork('in', inboundBytes);

      const payload = { api: this.api, event };
      const eventTypes = new Set(['message']);
      if (event?.type) eventTypes.add(event.type);
      if (event?.logMessageType) eventTypes.add(event.logMessageType);

      this.performance?.run(() => Promise.all([...eventTypes].map(type => this.events.dispatch(type, payload))))
        .catch(err => {
          this.state.incrementStat('errorsEncountered');
          this.logger.error('Event dispatch failed:', err);
        });
    });

    this.listening = true;
    await this.events.dispatch('ready', { api: this.api });
    this.logger.info('Facebook connection is active via ' + (this.adapter?.name || 'unknown adapter') + '.');
    return this.api;
  }

  _scheduleReconnect() {
    if (this.stopping || this.reconnectTimer || this.state.getState('safety.status') === 'suspected_suspension') return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 120000);
    this.state.setState('status', 'reconnecting');
    this.logger.warn('Connection lost; retrying in ' + Math.round(delay / 1000) + 's.');

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.disconnect();
        await this.connect();
      } catch (error) {
        this.logger.error('Reconnect failed:', error.message);
        this.events.dispatch('connection:error', error).catch(err => this.logger.error(err));
        this._scheduleReconnect();
      }
    }, delay);
  }

  async disconnect() {
    this.stopping = true;
    this.listening = false;
    this.connectionGeneration += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.state.setState('status', 'stopping');

    try {
      await this.adapter?.disconnect(this.rawApi);
    } catch (error) {
      this.logger.warn('Logout failed:', error.message);
    } finally {
      this.messageDelay.clear();
      this.api = null;
      this.rawApi = null;
      this.state.setState('status', 'offline');
    }
  }
}

ConnectionManager.AppStateError = AppStateError;
module.exports = ConnectionManager;
