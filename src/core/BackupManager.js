'use strict';

const fs = require('fs');
const path = require('path');

class BackupManager {
  constructor({ rootDir = process.cwd(), db, scheduler = null, config, logger } = {}) {
    this.rootDir = rootDir;
    this.db = db;
    this.scheduler = scheduler;
    this.config = config;
    this.logger = logger;
    this.dir = path.join(rootDir, 'data', 'backups');
  }

  enabled() { return this.config?.get('backups.enabled', true) !== false; }
  keep() { return Math.max(1, Number(this.config?.get('backups.keep', 10)) || 10); }
  _id() { return new Date().toISOString().replace(/[:.]/g, '-'); }

  async create(reason = 'manual') {
    if (!this.enabled()) throw new Error('Backups are disabled.');
    fs.mkdirSync(this.dir, { recursive: true });
    const id = this._id();
    const target = path.join(this.dir, id);
    fs.mkdirSync(target, { recursive: true });

    const dbName = path.basename(this.db.file || 'database.db');
    const dbTarget = path.join(target, dbName);
    if (typeof this.db.backupTo === 'function') this.db.backupTo(dbTarget);
    else fs.copyFileSync(this.db.file, dbTarget);

    const schedulerFile = this.scheduler?.file;
    if (schedulerFile && fs.existsSync(schedulerFile)) {
      fs.copyFileSync(schedulerFile, path.join(target, 'scheduler.json'));
    }

    fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({
      id,
      reason,
      createdAt: new Date().toISOString(),
      database: dbName,
      includes: ['database', schedulerFile && fs.existsSync(schedulerFile) ? 'scheduler' : null].filter(Boolean)
    }, null, 2) + '\n');

    this._prune();
    this.logger?.info('Backup created: ' + id);
    return id;
  }

  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir)
      .filter(name => fs.statSync(path.join(this.dir, name)).isDirectory())
      .sort().reverse();
  }

  _snapshot(id) {
    const snapshot = path.join(this.dir, String(id));
    if (!fs.existsSync(snapshot)) throw new Error('Backup not found: ' + id);
    const manifestFile = path.join(snapshot, 'manifest.json');
    if (!fs.existsSync(manifestFile)) throw new Error('Backup manifest missing: ' + id);
    return { snapshot, manifest: JSON.parse(fs.readFileSync(manifestFile, 'utf8')) };
  }

  requestRestore(id) {
    this._snapshot(id);
    const marker = path.join(this.rootDir, 'data', 'restore-request.json');
    fs.writeFileSync(marker, JSON.stringify({ id: String(id), requestedAt: new Date().toISOString() }, null, 2) + '\n');
    return marker;
  }

  async applyPendingRestore() {
    const marker = path.join(this.rootDir, 'data', 'restore-request.json');
    if (!fs.existsSync(marker)) return null;
    const request = JSON.parse(fs.readFileSync(marker, 'utf8'));
    const { snapshot, manifest } = this._snapshot(request.id);
    const sourceDb = path.join(snapshot, manifest.database);
    if (!fs.existsSync(sourceDb)) throw new Error('Backup database missing: ' + request.id);
    this.db.close?.();
    fs.mkdirSync(path.dirname(this.db.file), { recursive: true });
    fs.copyFileSync(sourceDb, this.db.file);
    const schedulerSource = path.join(snapshot, 'scheduler.json');
    if (this.scheduler?.file && fs.existsSync(schedulerSource)) {
      fs.mkdirSync(path.dirname(this.scheduler.file), { recursive: true });
      fs.copyFileSync(schedulerSource, this.scheduler.file);
    }
    fs.unlinkSync(marker);
    this.logger?.warn('Applied pending restore: ' + request.id + '. Restart the bot to resume normally.');
    return request.id;
  }

  _prune() {
    const all = this.list();
    for (const id of all.slice(this.keep())) {
      fs.rmSync(path.join(this.dir, id), { recursive: true, force: true });
    }
  }
}

module.exports = BackupManager;
