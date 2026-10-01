'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const PaystackProvider = require('../src/payments/providers/PaystackProvider');

test('Paystack webhook signatures accept the exact signed body', () => {
  const previous = process.env.MATEO_PAYSTACK_SECRET_KEY;
  process.env.MATEO_PAYSTACK_SECRET_KEY = 'test-secret';
  try {
    const provider = new PaystackProvider();
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'MFF-TEST' } });
    const signature = crypto.createHmac('sha512', 'test-secret').update(body).digest('hex');

    assert.equal(provider.verifyWebhookSignature(body, signature), true);
    assert.equal(provider.verifyWebhookSignature(body + ' ', signature), false);
    assert.equal(provider.verifyWebhookSignature(body, signature.slice(0, -1)), false);
  } finally {
    if (previous === undefined) delete process.env.MATEO_PAYSTACK_SECRET_KEY;
    else process.env.MATEO_PAYSTACK_SECRET_KEY = previous;
  }
});
