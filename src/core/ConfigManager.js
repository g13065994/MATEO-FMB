'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  botName: 'MATEO-FMB',
  version: '1.1.0',
  tagline: 'A modern Messenger bot.',
  prefix: '/',
  adminIDs: [],
  ownerID: '',
  welcomeMessage: 'Welcome to MATEO-FMB. Type /help to see what I can do.',
  allowedGroups: [],
  language: 'en',
  style: { footer: 'MATEO-FMB', separator: '━━━━━━━━━━━━━━━━' },
  storage: { mode: 'sqlite', sqliteFile: 'data/mateo.sqlite', legacyJsonFile: 'db.json' },
  platform: { adapter: 'eryxenx-fca', autoSaveAppState: true, sessionSaveIntervalMs: 900000, sessionDebounceMs: 30000 },
  scheduler: { enabled: true, tickMs: 10000, maxJobsPerUser: 20, retryDelayMs: 60000, maxAttempts: 3 },
  backups: { enabled: true, keep: 10, autoOnStart: true },
  plugins: { enabled: true, disabled: [] },
  ai: { endpoint: '', method: 'GET', timeoutMs: 30000, providers: [] },
  performance: { mode: 'normal', rssLimitMb: 0 },
  messageDelay: { enabled: true, minMs: 2000, maxMs: 3000 },
  fcaOptions: { online: true, updatePresence: true, selfListen: false, listenEvents: true, autoReconnect: false }
};

const clone = value => JSON.parse(JSON.stringify(value));

function merge(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object'
      ? merge(base[key], value)
      : value;
  }
  return result;
}

class ConfigManager {
  constructor({ rootDir = process.cwd(), logger } = {}) {
    this.rootDir = rootDir;
    this.logger = logger;
    this.file = path.join(rootDir, process.env.MATEO_CONFIG || 'settings.json');
    this.config = this._load();
  }

  _load() {
    let userConfig = {};
    if (fs.existsSync(this.file)) {
      try { userConfig = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
      catch (error) { throw new Error('Invalid configuration file ' + this.file + ': ' + error.message); }
    }
    const config = merge(clone(DEFAULTS), userConfig);
    config.botName = process.env.MATEO_BOT_NAME || config.botName;
    config.version = process.env.MATEO_VERSION || config.version;
    config.prefix = process.env.MATEO_PREFIX || config.prefix;
    config.ownerID = process.env.MATEO_OWNER_ID || config.ownerID;
    config.ai.endpoint = process.env.MATEO_AI_ENDPOINT || config.ai.endpoint;
    config.performance.mode = String(process.env.MATEO_PERFORMANCE || config.performance.mode || 'normal').toLowerCase();

    const rssLimitMb = Number(process.env.MATEO_RSS_LIMIT_MB || config.performance.rssLimitMb || 0);
    config.performance.rssLimitMb = Number.isFinite(rssLimitMb) && rssLimitMb > 0 ? rssLimitMb : 0;

    const minDelay = Number(process.env.MATEO_MESSAGE_DELAY_MIN_MS || config.messageDelay.minMs || 0);
    const maxDelay = Number(process.env.MATEO_MESSAGE_DELAY_MAX_MS || config.messageDelay.maxMs || minDelay);
    config.messageDelay.minMs = Number.isFinite(minDelay) && minDelay >= 0 ? minDelay : 2000;
    config.messageDelay.maxMs = Number.isFinite(maxDelay) && maxDelay >= config.messageDelay.minMs ? maxDelay : config.messageDelay.minMs;

    if (process.env.MATEO_MESSAGE_DELAY_ENABLED !== undefined) {
      config.messageDelay.enabled = !['0', 'false', 'off', 'no'].includes(String(process.env.MATEO_MESSAGE_DELAY_ENABLED).toLowerCase());
    }
    return config;
  }

  get(key, fallback = undefined) {
    const value = key.split('.').reduce((current, part) => current?.[part], this.config);
    return value === undefined ? fallback : value;
  }

  set(key, value, { persist = true } = {}) {
    const parts = String(key).split('.').filter(Boolean);
    if (!parts.length) throw new TypeError('Configuration key is required.');
    let target = this.config;
    for (const part of parts.slice(0, -1)) {
      if (!target[part] || typeof target[part] !== 'object' || Array.isArray(target[part])) target[part] = {};
      target = target[part];
    }
    target[parts.at(-1)] = value;
    if (persist) this.save();
    return value;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tempFile = this.file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(this.config, null, 2) + '\n', 'utf8');
    fs.renameSync(tempFile, this.file);
    return this;
  }

  all() { return clone(this.config); }
}

module.exports = ConfigManager;
