'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SqliteDatabase = require('../src/core/SqliteDatabase');
const SchedulerService = require('../src/core/SchedulerService');
const PluginManager = require('../src/core/PluginManager');
const AiMemoryStore = require('../src/core/AiMemoryStore');
const EryxenxFcaAdapter = require('../src/platform/EryxenxFcaAdapter');

test('scheduler parses durable reminder durations', () => {
  assert.equal(SchedulerService.parseDuration('30m'), 1800000);
  assert.equal(SchedulerService.parseDuration('2h'), 7200000);
  assert.equal(SchedulerService.parseDuration('bad'), null);
});

test('sqlite database persists and reloads users', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mateo-db-'));
  const config = { get(key, fallback) {
    const map = { 'storage.sqliteFile': 'data/mateo.sqlite', 'storage.legacyJsonFile': 'db.json' };
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
  }};
  const db = new SqliteDatabase({ rootDir: root, config });
  await db.init();
  await db.ensureUser('123', 'Test User');
  await db.write();
  db.close();

  const reloaded = new SqliteDatabase({ rootDir: root, config });
  await reloaded.init();
  assert.equal(reloaded.getUser('123')?.name, 'Test User');
  reloaded.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('plugin manager discovers manifest-based plugins', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mateo-plugin-'));
  const pluginDir = path.join(root, 'plugins', 'demo');
  fs.mkdirSync(path.join(pluginDir, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify({ name: 'demo', version: '1.0.0', commands: 'commands' }));
  const config = { get(key, fallback) { return key === 'plugins.enabled' ? true : fallback; } };
  const manager = new PluginManager({ rootDir: root, config });
  manager.discover();
  assert.deepEqual(manager.list(), [{ name: 'demo', version: '1.0.0', enabled: true }]);
  assert.equal(manager.commandDirs().length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('AI memory is bounded and persistent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mateo-ai-'));
  const memory = new AiMemoryStore({ rootDir: root, maxMessagesPerThread: 4 });
  memory.init();
  for (let i = 0; i < 6; i += 1) memory.remember('thread', 'user', 'message-' + i);
  assert.equal(memory.history('thread').length, 4);
  const disk = JSON.parse(fs.readFileSync(memory.file, 'utf8'));
  assert.equal(disk.threads.thread.length, 4);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Messenger adapter exposes longevity capabilities', () => {
  const adapter = new EryxenxFcaAdapter();
  const caps = adapter.capabilities();
  assert.equal(adapter.name, 'eryxenx-fca');
  assert.equal(caps.sessionGuard, true);
  assert.equal(caps.staleClientGuard, true);
  assert.equal(caps.httpFallback, true);
  assert.equal(caps.e2ee, true);
});
