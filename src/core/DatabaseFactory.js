'use strict';

const JsonDatabase = require('./JsonDatabase');
const SqliteDatabase = require('./SqliteDatabase');

function createDatabase({ rootDir, config, logger }) {
  const mode = String(config?.get('storage.mode', 'sqlite') || 'sqlite').toLowerCase();
  if (mode === 'json') return new JsonDatabase({ rootDir, logger, config });
  if (mode === 'sqlite') return new SqliteDatabase({ rootDir, logger, config });
  throw new Error('Unknown storage.mode. Use "sqlite" or "json".');
}

module.exports = createDatabase;
