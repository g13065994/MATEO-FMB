'use strict';

const BotApp = require('./core/BotApp');
const ConnectionManager = require('./core/ConnectionManager');

function printBanner() {
  const banner = [
    '',
    '╔══════════════════════════════════════════════════╗',
    '║                                                  ║',
    '║                  M A T E O - F M B             ║',
    '║                                                  ║',
    '║            Facebook Messenger Bot               ║',
    '║              Modular • Reliable • Fast          ║',
    '║                                                  ║',
    '╚══════════════════════════════════════════════════╝',
    '',
  ].join('\n');

  process.stdout.write(`${banner}\n`);
}

function printConfig(app) {
  console.log('[MATEO-FMB] Loading credentials...');
  console.log(`  Config > botname: ${app.config.get('botName', 'MATEO-FMB')}`);
  console.log(`  Config > prefix: ${app.config.get('prefix', '/')}`);
  console.log(`  Config > version: ${app.config.get('version', 'unknown')}`);
  console.log(`  Config > language: ${app.config.get('language', 'en')}`);
  console.log(`  Config > appstate: ${process.env.MATEO_APPSTATE_FILE || 'appstate.json'}`);
  console.log(`  Config > admins: ${app.config.get('adminIDs', []).length}`);
  console.log(`  Config > performance: ${app.performance.mode}`);
  console.log(`  Config > Mateo control plane: ${app.mateo.enabled ? 'enabled' : 'disabled'}`);
}

async function main() {
  printBanner();
  const app = new BotApp({ rootDir: process.cwd() });

  try {
    printConfig(app);
    await app.start();
    app.logger.info(`${app.config.get('botName')} started.`);
  } catch (error) {
    if (error instanceof ConnectionManager.AppStateError) {
      console.log('[MATEO-FMB] AppState missing or invalid. Shutting down.');
      await app.shutdown('missing-appstate').catch(() => {});
      return;
    }

    console.error('[MATEO-FMB] Fatal startup error:', error.message || error);
    await app.shutdown('startup-failure').catch(() => {});
    process.exitCode = 1;
  }
}

main();
