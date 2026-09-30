'use strict';

const fs = require('fs');
const path = require('path');

class AiMemoryStore {
  constructor({ rootDir = process.cwd(), maxMessagesPerThread = 24, maxThreads = 250, logger } = {}) {
    this.file = path.join(rootDir, 'data', 'ai-memory.json');
    this.maxMessagesPerThread = Math.max(4, maxMessagesPerThread);
    this.maxThreads = Math.max(10, maxThreads);
    this.logger = logger;
    this.data = {};
  }

  init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) return this;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = parsed?.threads && typeof parsed.threads === 'object' ? parsed.threads : {};
    } catch (error) {
      this.logger?.warn('AI memory reset: ' + error.message);
      this.data = {};
    }
    return this;
  }

  _save() {
    const temp = this.file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({ version: 1, threads: this.data }, null, 2) + '\n', 'utf8');
    fs.renameSync(temp, this.file);
  }

  remember(threadID, role, text) {
    const key = String(threadID || 'global');
    if (!this.data[key]) this.data[key] = [];
    this.data[key].push({ role: String(role), text: String(text).slice(0, 4000), at: new Date().toISOString() });
    this.data[key] = this.data[key].slice(-this.maxMessagesPerThread);
    const keys = Object.keys(this.data);
    if (keys.length > this.maxThreads) {
      for (const oldKey of keys.slice(0, keys.length - this.maxThreads)) delete this.data[oldKey];
    }
    this._save();
  }

  history(threadID, limit = 12) {
    return (this.data[String(threadID || 'global')] || []).slice(-Math.max(1, limit));
  }

  clear(threadID) {
    delete this.data[String(threadID || 'global')];
    this._save();
  }
}

module.exports = AiMemoryStore;
