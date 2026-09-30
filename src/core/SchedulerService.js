'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SchedulerService {
  constructor({ rootDir = process.cwd(), config, logger } = {}) {
    this.rootDir = rootDir;
    this.config = config;
    this.logger = logger;
    this.file = path.join(rootDir, 'data', 'scheduler.json');
    this.jobs = [];
    this.timer = null;
    this.apiProvider = null;
    this.writeQueue = Promise.resolve();
  }

  enabled() { return this.config?.get('scheduler.enabled', true) !== false; }
  _tickMs() { return Math.max(1000, Number(this.config?.get('scheduler.tickMs', 10000)) || 10000); }
  _maxJobs() { return Math.max(1, Number(this.config?.get('scheduler.maxJobsPerUser', 20)) || 20); }
  _retentionMs() { return 7 * 86400000; }

  async load() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) {
      this.jobs = [];
      await this._persist();
      return this;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.jobs = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
      this._cleanup();
    } catch (error) {
      this.logger?.warn('Scheduler state invalid; resetting: ' + error.message);
      this.jobs = [];
      await this._persist();
    }
    return this;
  }

  _persist() {
    this.writeQueue = this.writeQueue.then(() => {
      const temp = this.file + '.' + process.pid + '.tmp';
      fs.writeFileSync(temp, JSON.stringify({ version: 1, jobs: this.jobs }, null, 2) + '\n', 'utf8');
      fs.renameSync(temp, this.file);
    });
    return this.writeQueue;
  }

  _cleanup() {
    const cutoff = Date.now() - this._retentionMs();
    this.jobs = this.jobs.filter(job => !job.completed || new Date(job.completedAt || job.createdAt || 0).getTime() >= cutoff);
  }

  static parseDuration(value) {
    const match = String(value || '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(s|m|h|d|w)$/);
    if (!match) return null;
    const n = Number(match[1]);
    const factor = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[match[2]];
    return Number.isFinite(n) && n > 0 ? n * factor : null;
  }

  async addMessage({ ownerID, threadID, text, delayMs, repeatMs = 0 }) {
    if (!this.enabled()) throw new Error('Scheduler is disabled.');
    const owner = String(ownerID || '');
    const existing = this.jobs.filter(job => String(job.ownerID) === owner && !job.completed).length;
    if (existing >= this._maxJobs()) throw new Error('You have reached the scheduler job limit.');
    const delay = Number(delayMs);
    if (!Number.isFinite(delay) || delay <= 0) throw new Error('A positive delay is required.');

    const job = {
      id: crypto.randomUUID(),
      type: 'message',
      ownerID: owner,
      threadID: String(threadID),
      text: String(text).slice(0, 4000),
      runAt: Date.now() + delay,
      repeatMs: Math.max(0, Number(repeatMs) || 0),
      attempts: 0,
      createdAt: new Date().toISOString(),
      completed: false,
      completedAt: null
    };
    this.jobs.push(job);
    await this._persist();
    return job;
  }

  list(ownerID = null) {
    const jobs = this.jobs.filter(job => !job.completed);
    return ownerID == null ? jobs : jobs.filter(job => String(job.ownerID) === String(ownerID));
  }

  async remove(id, ownerID = null) {
    const index = this.jobs.findIndex(job => job.id === String(id) && !job.completed);
    if (index < 0) return false;
    if (ownerID != null && String(this.jobs[index].ownerID) !== String(ownerID)) return false;
    this.jobs.splice(index, 1);
    await this._persist();
    return true;
  }

  start(apiProvider) {
    if (!this.enabled() || this.timer) return this;
    this.apiProvider = apiProvider;
    this.timer = setInterval(() => this._tick().catch(error => this.logger?.error('Scheduler tick failed:', error)), this._tickMs());
    this.timer.unref?.();
    return this;
  }

  async _tick() {
    if (!this.enabled()) return;
    const now = Date.now();
    const due = this.jobs.filter(job => !job.completed && job.runAt <= now);
    for (const job of due) await this._run(job);
    const before = this.jobs.length;
    this._cleanup();
    if (due.length || this.jobs.length !== before) await this._persist();
  }

  async _run(job) {
    const api = this.apiProvider?.();
    if (!api?.sendMessage) return;
    try {
      await api.sendMessage(job.text, job.threadID);
      job.attempts = 0;
      if (job.repeatMs > 0) {
        job.runAt = Date.now() + job.repeatMs;
      } else {
        job.completed = true;
        job.completedAt = new Date().toISOString();
      }
    } catch (error) {
      job.attempts = Number(job.attempts || 0) + 1;
      const maxAttempts = Math.max(1, Number(this.config?.get('scheduler.maxAttempts', 3)) || 3);
      if (job.attempts >= maxAttempts) {
        job.completed = true;
        job.completedAt = new Date().toISOString();
        this.logger?.error('Scheduled job ' + job.id + ' disabled after ' + job.attempts + ' failed attempts: ' + error.message);
      } else {
        const retry = Math.max(1000, Number(this.config?.get('scheduler.retryDelayMs', 60000)) || 60000);
        job.runAt = Date.now() + retry;
      }
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.apiProvider = null;
  }

  status() {
    const next = this.list().sort((a, b) => a.runAt - b.runAt)[0];
    return { enabled: this.enabled(), jobs: this.list().length, nextRunAt: next?.runAt || null };
  }
}

module.exports = SchedulerService;
