'use strict';

const crypto = require('crypto');
const axios = require('axios');

class PaystackProvider {
  constructor({ logger } = {}) {
    this.logger = logger;
    this.baseURL = 'https://api.paystack.co';
  }

  _secret() {
    const secret = String(process.env.MATEO_PAYSTACK_SECRET_KEY || '').trim();
    if (!secret) throw new Error('MATEO_PAYSTACK_SECRET_KEY is not configured.');
    return secret;
  }

  async initialize({ email, amountNgn, reference, callbackUrl, metadata }) {
    const response = await axios.post(this.baseURL + '/transaction/initialize', {
      email,
      amount: String(Math.round(amountNgn * 100)),
      currency: 'NGN',
      reference,
      callback_url: callbackUrl || undefined,
      metadata
    }, {
      timeout: 20000,
      headers: {
        Authorization: 'Bearer ' + this._secret(),
        'Content-Type': 'application/json'
      }
    });

    if (!response.data?.status || !response.data?.data?.authorization_url) {
      throw new Error(response.data?.message || 'Paystack could not initialize the payment.');
    }

    return response.data.data;
  }

  async verify(reference) {
    const response = await axios.get(
      this.baseURL + '/transaction/verify/' + encodeURIComponent(String(reference)),
      { timeout: 20000, headers: { Authorization: 'Bearer ' + this._secret() } }
    );
    return response.data?.data || null;
  }

  verifyWebhookSignature(rawBody, signature) {
    const expected = crypto.createHmac('sha512', this._secret()).update(rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

module.exports = PaystackProvider;
