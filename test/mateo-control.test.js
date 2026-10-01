'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const MateoControlClient = require('../src/control/MateoControlClient');

test('MateoControlClient is disabled without a Bot Key', () => {
  const previous = process.env.MATEO_BOT_KEY;
  delete process.env.MATEO_BOT_KEY;
  const client = new MateoControlClient({ config: { get: (_k, fallback) => fallback } });
  assert.equal(client.enabled, false);
  assert.equal(client.status().authenticated, false);
  if (previous !== undefined) process.env.MATEO_BOT_KEY = previous;
});

test('MateoControlClient status never exposes the Bot Key or access token', () => {
  const previous = process.env.MATEO_BOT_KEY;
  process.env.MATEO_BOT_KEY = 'mte_fmb_test_secret_that_is_long_enough_for_runtime';
  const client = new MateoControlClient({ config: { get: (_k, fallback) => fallback } });
  client.accessToken = 'secret-session-token';
  const status = JSON.stringify(client.status());
  assert.equal(status.includes(process.env.MATEO_BOT_KEY), false);
  assert.equal(status.includes('secret-session-token'), false);
  if (previous !== undefined) process.env.MATEO_BOT_KEY = previous;
  else delete process.env.MATEO_BOT_KEY;
});
