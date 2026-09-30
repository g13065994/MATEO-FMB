'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const EMPTY_DB = {
  users: [],
  groups: [],
  history: [],
  statistics: { messages: 0, commands: 0, errors: 0, moderationActions: 0 },
};

const clone = value => JSON.parse(JSON.stringify(value));

class SqliteDatabase {
  constructor({ rootDir = process.cwd(), logger, config } = {}) {
    this.rootDir = rootDir;
    this.logger = logger;
    this.config = config;
    const configured = config?.get('storage.sqliteFile', 'data/mateo.sqlite') || 'data/mateo.sqlite';
    this.file = path.resolve(rootDir, configured);
    const legacy = config?.get('storage.legacyJsonFile', 'db.json') || 'db.json';
    this.legacyFile = path.resolve(rootDir, legacy);
    this.data = null;
    this.writeQueue = Promise.resolve();
    this.db = null;
  }

  _ensureOpen() {
    if (this.db) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY, data TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS groups (thread_id TEXT PRIMARY KEY, data TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, data TEXT NOT NULL);' +
      'CREATE TABLE IF NOT EXISTS statistics (name TEXT PRIMARY KEY, value REAL NOT NULL);'
    );
  }

  _normalize(parsed = {}) {
    const data = { ...clone(EMPTY_DB), ...parsed };
    data.users = Array.isArray(data.users) ? data.users : [];
    data.groups = Array.isArray(data.groups) ? data.groups : [];
    data.history = Array.isArray(data.history) ? data.history.slice(-5000) : [];
    data.statistics = { ...clone(EMPTY_DB.statistics), ...(data.statistics || {}) };
    return data;
  }

  _hasStoredData() {
    this._ensureOpen();
    const row = this.db.prepare(
      'SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM groups) + (SELECT COUNT(*) FROM history) + (SELECT COUNT(*) FROM statistics) AS count'
    ).get();
    return Number(row?.count || 0) > 0;
  }

  async init() {
    this._ensureOpen();
    if (!this._hasStoredData() && fs.existsSync(this.legacyFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.legacyFile, 'utf8'));
        this.data = this._normalize(parsed);
        await this.write();
        this.logger?.info('Migrated legacy JSON database into SQLite.');
        return this;
      } catch (error) {
        this.logger?.warn('SQLite migration skipped: ' + error.message);
      }
    }
    await this.read();
    return this;
  }

  async read() {
    this._ensureOpen();
    const users = this.db.prepare('SELECT data FROM users ORDER BY rowid').all().map(row => JSON.parse(row.data));
    const groups = this.db.prepare('SELECT data FROM groups ORDER BY rowid').all().map(row => JSON.parse(row.data));
    const history = this.db.prepare('SELECT data FROM history ORDER BY id DESC LIMIT 5000').all().reverse().map(row => JSON.parse(row.data));
    const statsRows = this.db.prepare('SELECT name, value FROM statistics').all();
    const statistics = {};
    for (const row of statsRows) statistics[row.name] = Number(row.value);
    this.data = this._normalize({ users, groups, history, statistics });
    return this.data;
  }

  async write() {
    this._ensureOpen();
    this.writeQueue = this.writeQueue.then(() => this._writeNow());
    return this.writeQueue;
  }

  _writeNow() {
    if (!this.data) this.data = clone(EMPTY_DB);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('DELETE FROM users; DELETE FROM groups; DELETE FROM history; DELETE FROM statistics;');
      const user = this.db.prepare('INSERT INTO users(user_id, data) VALUES(?, ?)');
      const group = this.db.prepare('INSERT INTO groups(thread_id, data) VALUES(?, ?)');
      const history = this.db.prepare('INSERT INTO history(timestamp, data) VALUES(?, ?)');
      const stat = this.db.prepare('INSERT INTO statistics(name, value) VALUES(?, ?)');
      for (const item of this.data.users || []) user.run(String(item.userID), JSON.stringify(item));
      for (const item of this.data.groups || []) group.run(String(item.threadID), JSON.stringify(item));
      for (const item of (this.data.history || []).slice(-5000)) history.run(String(item.timestamp || new Date().toISOString()), JSON.stringify(item));
      for (const [name, value] of Object.entries(this.data.statistics || {})) stat.run(String(name), Number(value) || 0);
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  async update(mutator) {
    if (typeof mutator !== 'function') throw new TypeError('Database update requires a function.');
    if (!this.data) await this.init();
    const result = await mutator(this.data);
    await this.write();
    return result;
  }

  incrementStat(name, amount = 1) {
    if (!this.data) this.data = clone(EMPTY_DB);
    const value = Number(amount);
    this.data.statistics[name] = Number(this.data.statistics[name] || 0) + (Number.isFinite(value) ? value : 0);
    return this.data.statistics[name];
  }

  getUser(userID) {
    return this.data?.users?.find(user => String(user.userID) === String(userID)) || null;
  }

  async ensureUser(userID, name = '') {
    if (!userID) return null;
    if (!this.data) await this.init();
    let user = this.getUser(userID);
    const now = new Date().toISOString();
    if (!user) {
      user = { userID: String(userID), name: name || String(userID), coins: 0, level: 1, xp: 0, messages: 0, commandsUsed: 0, warnings: 0, firstSeen: now, lastSeen: now };
      this.data.users.push(user);
    } else {
      user.lastSeen = now;
      if (name) user.name = name;
    }
    return user;
  }

  getGroup(threadID) {
    return this.data?.groups?.find(group => String(group.threadID) === String(threadID)) || null;
  }

  async ensureGroup(threadID, defaults = {}) {
    if (!threadID) return null;
    if (!this.data) await this.init();
    let group = this.getGroup(threadID);
    if (!group) {
      group = { threadID: String(threadID), ...clone(defaults) };
      this.data.groups.push(group);
    }
    return group;
  }

  addHistory(entry, limit = 5000) {
    if (!this.data) this.data = clone(EMPTY_DB);
    this.data.history.push({ ...entry, timestamp: entry.timestamp || new Date().toISOString() });
    if (this.data.history.length > limit) this.data.history = this.data.history.slice(-limit);
  }

  backupTo(destination) {
    this._ensureOpen();
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
    const safe = path.resolve(destination).replace(/'/g, "''");
    this.db.exec("VACUUM INTO '" + safe + "'");
  }

  close() {
    if (!this.db) return;
    try { this.db.close(); } finally { this.db = null; }
  }
}

module.exports = SqliteDatabase;
