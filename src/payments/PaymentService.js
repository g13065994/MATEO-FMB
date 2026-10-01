'use strict';

const PaystackProvider = require('./providers/PaystackProvider');

class PaymentService {
  constructor({ logger } = {}) {
    this.logger = logger;
    this.providers = {
      paystack: new PaystackProvider({ logger })
    };
  }

  provider(name = 'paystack') {
    const key = String(name).toLowerCase();
    const provider = this.providers[key];
    if (!provider) throw new Error('Unsupported payment provider: ' + key);
    return provider;
  }
}

module.exports = PaymentService;
