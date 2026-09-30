'use strict';

const fs = require('fs');
const path = require('path');

class PluginManager {
  constructor({ rootDir = process.cwd(), config, logger } = {}) {
    this.rootDir = rootDir;
    this.config = config;
    this.logger = logger;
    this.dir = path.join(rootDir, 'plugins');
    this.plugins = new Map();
  }

  enabled() { return this.config?.get('plugins.enabled', true) !== false; }

  _disabled() {
    const value = this.config?.get('plugins.disabled', []);
    return new Set(Array.isArray(value) ? value.map(String) : []);
  }

  discover() {
    if (!this.enabled()) return [];
    fs.mkdirSync(this.dir, { recursive: true });
    this.plugins.clear();
    const disabled = this._disabled();
    for (const entry of fs.readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(this.dir, entry.name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!manifest?.name) throw new Error('manifest.name is required');
        const name = String(manifest.name).trim().toLowerCase();
        this.plugins.set(name, {
          ...manifest,
          name,
          version: String(manifest.version || '0.0.0'),
          dir: path.dirname(manifestPath),
          enabled: !disabled.has(name)
        });
      } catch (error) {
        this.logger?.warn('Plugin manifest rejected in ' + entry.name + ': ' + error.message);
      }
    }
    return [...this.plugins.values()];
  }

  _dirs(field) {
    return [...this.plugins.values()]
      .filter(plugin => plugin.enabled)
      .flatMap(plugin => {
        const values = Array.isArray(plugin[field]) ? plugin[field] : plugin[field] ? [plugin[field]] : [];
        return values.map(value => path.resolve(plugin.dir, String(value)));
      })
      .filter(dir => fs.existsSync(dir));
  }

  commandDirs() { return this._dirs('commands'); }
  eventDirs() { return this._dirs('events'); }
  list() { return [...this.plugins.values()].map(({ name, version, enabled }) => ({ name, version, enabled })); }
}

module.exports = PluginManager;
