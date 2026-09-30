'use strict';

const BotApp = require('../src/core/BotApp');

async function main() {
  const app = new BotApp({ rootDir: process.cwd() });
  try {
    app.aiMemory.init();
    await app.db.init();
    await app.scheduler.load();
    const id = await app.backup.create('cli');
    console.log('Backup created: ' + id);
  } finally {
    app.scheduler.stop();
    await app.db.write?.().catch(() => {});
    app.db.close?.();
  }
}

main().catch(error => {
  console.error('Backup failed:', error.message || error);
  process.exitCode = 1;
});
