'use strict';

const crypto = require('crypto');
const axios = require('axios');

class FreeFirePurchaseService {
  constructor({ rootDir, logger, db }) {
    this.rootDir = rootDir;
    this.logger = logger;
    this.db = db;
  }

  _env(name, required = true) {
    const value = String(process.env[name] || '').trim();
    if (!value && required) throw new Error(name + ' is not configured.');
    return value;
  }

  _alu(pathname, options = {}) {
    return axios({
      baseURL: process.env.MATEO_FF_ALU_BASE_URL || 'https://aluu.in',
      timeout: 20000,
      ...options,
      url: pathname,
      headers: {
        'x-api-key': this._env('MATEO_FF_ALU_API_KEY'),
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
  }

  async getFreeFireGameCode() {
    const response = await this._alu('/api/v.1/games', { method: 'GET' });
    const games = response.data?.data || [];
    const game = games.find(item => /free fire/i.test(String(item?.Name || '')));
    if (!game?.gamecode) throw new Error('Free Fire is not available in the configured top-up catalog.');
    return String(game.gamecode);
  }

  async getPacks() {
    const game = await this.getFreeFireGameCode();
    const response = await this._alu('/api/v.1/products/' + encodeURIComponent(game), { method: 'GET' });
    return { game, packs: Array.isArray(response.data?.data) ? response.data.data : [] };
  }

  async findPack(diamonds) {
    const wanted = String(Math.floor(Number(diamonds)));
    if (!/^\d+$/.test(wanted) || Number(wanted) <= 0) throw new Error('Diamond amount must be a positive whole number.');
    const { game, packs } = await this.getPacks();
    const pack = packs.find(item => String(item?.Pack ?? '') === wanted && String(item?.stockStatus || '').toLowerCase() === 'in_stock');
    if (!pack) throw new Error('The requested diamond pack is unavailable. Use /ffpacks to see current packs.');
    return { game, pack };
  }

  _ngnPrice(usdPrice) {
    const rate = Number(process.env.MATEO_FF_USD_NGN_RATE);
    const markup = Number(process.env.MATEO_FF_MARKUP_PERCENT || 0);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('MATEO_FF_USD_NGN_RATE is not configured.');
    if (!Number.isFinite(markup) || markup < 0) throw new Error('MATEO_FF_MARKUP_PERCENT is invalid.');
    return Math.ceil(Number(usdPrice) * rate * (1 + markup / 100));
  }

  async _save(order) {
    order.updatedAt = new Date().toISOString();
    await this.db.savePaymentOrder(order);
    return order;
  }

  async createPayment({ uid, diamonds, email, senderID }) {
    const cleanUid = String(uid || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!/^\d{5,20}$/.test(cleanUid)) throw new Error('Invalid Free Fire UID.');
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) throw new Error('A valid payment email is required.');

    const { game, pack } = await this.findPack(diamonds);
    const amountNgn = this._ngnPrice(pack.price);
    const id = 'MFF-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(5).toString('hex').toUpperCase();
    const callback = process.env.MATEO_FF_PAYSTACK_CALLBACK_URL || undefined;

    const payment = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: cleanEmail,
        amount: String(amountNgn * 100),
        currency: 'NGN',
        reference: id,
        callback_url: callback,
        metadata: { order_id: id, sender_id: String(senderID || ''), game: 'Free Fire', uid: cleanUid, diamonds: Number(diamonds), provider_game: game, provider_denom: String(pack.Pack) }
      },
      { timeout: 20000, headers: { Authorization: 'Bearer ' + this._env('MATEO_PAYSTACK_SECRET_KEY'), 'Content-Type': 'application/json' } }
    );

    if (!payment.data?.status || !payment.data?.data?.authorization_url) throw new Error(payment.data?.message || 'Paystack could not initialize the payment.');

    const order = {
      id, status: 'payment_pending', deliveryClaimed: false,
      senderID: String(senderID || ''), uid: cleanUid, diamonds: Number(diamonds), email: cleanEmail,
      amountNgn, provider: 'alu', providerGame: game, providerDenom: String(pack.Pack), providerPriceUsd: Number(pack.price),
      paymentReference: id, paymentUrl: payment.data.data.authorization_url, providerOrderId: null, providerReference: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    await this._save(order);
    return order;
  }

  async verifyPaymentAndFulfill(reference) {
    const id = String(reference || '').trim();
    const order = this.db.getPaymentOrder(id);
    if (!order) throw new Error('Free Fire order not found: ' + id);
    if (order.status === 'delivered') return order;
    if (order.status === 'delivery_pending' && order.providerOrderId) return this.refreshProviderOrder(order);

    const verification = await axios.get('https://api.paystack.co/transaction/verify/' + encodeURIComponent(id), {
      timeout: 20000, headers: { Authorization: 'Bearer ' + this._env('MATEO_PAYSTACK_SECRET_KEY') }
    });
    const payment = verification.data?.data;

    if (!verification.data?.status || payment?.status !== 'success') {
      order.status = payment?.status === 'failed' ? 'payment_failed' : 'payment_pending';
      return this._save(order);
    }

    if (Number(payment.amount) !== order.amountNgn * 100 || String(payment.currency || '').toUpperCase() !== 'NGN' || String(payment.reference || '') !== order.paymentReference) {
      throw new Error('Payment verification mismatch for order ' + id + '.');
    }

    order.status = 'payment_confirmed';
    order.paymentConfirmedAt ||= new Date().toISOString();
    await this._save(order);
    return this._fulfill(order);
  }

  async _fulfill(order) {
    if (order.status === 'delivered') return order;
    if (order.providerOrderId) return this.refreshProviderOrder(order);

    const claimed = this.db.claimPaymentDelivery(order.id);
    if (!claimed) {
      const current = this.db.getPaymentOrder(order.id);
      if (current?.providerOrderId) return this.refreshProviderOrder(current);
      return current || order;
    }

    order.deliveryClaimed = true;
    try {
      const webhookUrl = this._env('MATEO_FF_ALU_WEBHOOK_URL');
      const provider = await this._alu('/api/v.1/create', {
        method: 'POST',
        data: { game: order.providerGame, denom: order.providerDenom, userid: order.uid, partner_orderid: order.id, partner_webhook_url: webhookUrl }
      });
      order.status = provider.data?.data?.status === 'successful' ? 'delivered' : 'delivery_pending';
      order.providerOrderId = provider.data?.data?.orderid || provider.data?.data?.order_id || null;
      order.providerReference = provider.data?.data?.reference || null;
      if (!order.providerOrderId) throw new Error('ALU did not return a provider order ID.');
      if (order.status === 'delivered') order.deliveredAt = new Date().toISOString();
      return this._save(order);
    } catch (error) {
      this.db.releasePaymentDelivery(order.id);
      order.deliveryClaimed = false;
      await this._save(order);
      throw error;
    }
  }

  async refreshProviderOrder(order) {
    const lookupId = order.providerOrderId || order.id;
    const response = await this._alu('/api/v.1/' + encodeURIComponent(lookupId), { method: 'GET' });
    const remote = response.data?.data || response.data;
    const status = String(remote?.status || '').toLowerCase();
    if (['successful', 'success', 'delivered'].includes(status)) {
      order.status = 'delivered';
      order.deliveredAt ||= new Date().toISOString();
      order.deliveryClaimed = false;
    } else if (['error', 'failed', 'cancelled', 'canceled'].includes(status)) {
      order.status = 'delivery_failed';
      order.deliveryFailedAt ||= new Date().toISOString();
      order.deliveryClaimed = false;
    } else if (status) {
      order.status = 'delivery_pending';
    }
    if (remote?.orderid) order.providerOrderId = String(remote.orderid);
    if (remote?.reference) order.providerReference = String(remote.reference);
    return this._save(order);
  }

  verifyProviderWebhook(rawBody, timestamp, signature) {
    const secret = this._env('MATEO_FF_ALU_WEBHOOK_SECRET');
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;
    const expected = crypto.createHmac('sha256', secret).update(String(timestamp) + '.' + rawBody).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(String(signature || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async handleProviderWebhook(payload) {
    const data = payload?.data || payload;
    const id = String(data?.orderid || data?.partner_orderid || '').trim();
    if (!id) throw new Error('Webhook order ID is missing.');
    const order = this.db.getPaymentOrder(id);
    if (!order) throw new Error('Unknown Free Fire webhook order: ' + id);
    const status = String(data?.status || '').toLowerCase();
    if (['successful', 'success', 'delivered'].includes(status)) {
      order.status = 'delivered';
      order.deliveredAt ||= new Date().toISOString();
    } else if (status) order.status = 'delivery_pending';
    if (data.reference) order.providerReference = String(data.reference);
    if (data.provider_order_id) order.providerOrderId = String(data.provider_order_id);
    order.deliveryClaimed = false;
    await this.db.savePaymentOrder(order);
    return order;
  }

  verifyPaystackWebhook(rawBody, signature) {
    const secret = this._env('MATEO_PAYSTACK_SECRET_KEY');
    const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(String(signature || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  async handlePaystackWebhook(payload) {
    const event = String(payload?.event || '').toLowerCase();
    if (event !== 'charge.success') return { ignored: true, event };
    const data = payload?.data || {};
    const reference = String(data?.reference || '').trim();
    if (!reference) throw new Error('Paystack webhook reference is missing.');
    const order = this.db.getPaymentOrder(reference);
    if (!order) throw new Error('Unknown Paystack payment reference: ' + reference);
    if (Number(data.amount) !== order.amountNgn * 100 || String(data.currency || '').toUpperCase() !== 'NGN' || String(data.status || '').toLowerCase() !== 'success') {
      throw new Error('Paystack webhook payment mismatch for order ' + reference + '.');
    }
    order.status = 'payment_confirmed';
    order.paymentConfirmedAt ||= new Date().toISOString();
    await this._save(order);

    setImmediate(() => {
      this._fulfill(order).catch(error => {
        this.logger?.warn?.('Async Free Fire fulfillment failed: ' + error.message);
      });
    });

    return { accepted: true, order: order.id, status: order.status };
  }

  getOrder(reference) {
    return this.db.getPaymentOrder(String(reference || '').trim());
  }
}

module.exports = FreeFirePurchaseService;
