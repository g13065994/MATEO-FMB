'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

class FreeFirePurchaseService {
  constructor({ rootDir, logger }) {
    this.rootDir = rootDir;
    this.logger = logger;
    this.file = path.join(rootDir, 'data', 'freefire-orders.json');
    this.orders = new Map();
    this._loaded = false;
  }

  _load() {
    if (this._loaded) return;
    this._loaded = true;
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const order of Array.isArray(raw) ? raw : []) {
        if (order?.id) this.orders.set(order.id, order);
      }
    } catch (error) {
      this.logger?.warn?.('Free Fire order store could not be loaded: ' + error.message);
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify([...this.orders.values()], null, 2));
    fs.renameSync(temp, this.file);
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
    if (!pack) {
      const available = packs
        .filter(item => String(item?.stockStatus || '').toLowerCase() === 'in_stock')
        .map(item => String(item?.name || item?.Pack || ''))
        .filter(Boolean)
        .slice(0, 20);
      throw new Error('The requested diamond pack is unavailable. Available packs: ' + (available.join(', ') || 'none') + '.');
    }
    return { game, pack };
  }

  _ngnPrice(usdPrice) {
    const rate = Number(process.env.MATEO_FF_USD_NGN_RATE);
    const markup = Number(process.env.MATEO_FF_MARKUP_PERCENT || 0);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('MATEO_FF_USD_NGN_RATE is not configured.');
    if (!Number.isFinite(markup) || markup < 0) throw new Error('MATEO_FF_MARKUP_PERCENT is invalid.');
    return Math.ceil(Number(usdPrice) * rate * (1 + markup / 100));
  }

  async createPayment({ uid, diamonds, email, senderID }) {
    this._load();
    const cleanUid = String(uid || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!/^\d{5,20}$/.test(cleanUid)) throw new Error('Invalid Free Fire UID.');
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) throw new Error('A valid payment email is required.');

    const { game, pack } = await this.findPack(diamonds);
    const amountNgn = this._ngnPrice(pack.price);
    const id = 'MFF-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const callback = process.env.MATEO_FF_PAYSTACK_CALLBACK_URL || undefined;

    const payment = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: cleanEmail,
        amount: String(amountNgn * 100),
        currency: 'NGN',
        reference: id,
        callback_url: callback,
        metadata: {
          order_id: id,
          sender_id: String(senderID || ''),
          game: 'Free Fire',
          uid: cleanUid,
          diamonds: Number(diamonds),
          provider_game: game,
          provider_denom: String(pack.Pack)
        }
      },
      {
        timeout: 20000,
        headers: {
          Authorization: 'Bearer ' + this._env('MATEO_PAYSTACK_SECRET_KEY'),
          'Content-Type': 'application/json'
        }
      }
    );

    if (!payment.data?.status || !payment.data?.data?.authorization_url) {
      throw new Error(payment.data?.message || 'Paystack could not initialize the payment.');
    }

    const order = {
      id,
      status: 'payment_pending',
      senderID: String(senderID || ''),
      uid: cleanUid,
      diamonds: Number(diamonds),
      email: cleanEmail,
      amountNgn,
      provider: 'alu',
      providerGame: game,
      providerDenom: String(pack.Pack),
      providerPriceUsd: Number(pack.price),
      paymentReference: id,
      paymentUrl: payment.data.data.authorization_url,
      providerOrderId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.orders.set(id, order);
    this._save();
    return order;
  }

  async verifyPaymentAndFulfill(reference) {
    this._load();
    const id = String(reference || '').trim();
    const order = this.orders.get(id);
    if (!order) throw new Error('Free Fire order not found: ' + id);
    if (order.status === 'delivered') return order;
    if (order.status === 'delivery_pending' && order.providerOrderId) return this.refreshProviderOrder(order);

    const verification = await axios.get(
      'https://api.paystack.co/transaction/verify/' + encodeURIComponent(id),
      {
        timeout: 20000,
        headers: { Authorization: 'Bearer ' + this._env('MATEO_PAYSTACK_SECRET_KEY') }
      }
    );

    const payment = verification.data?.data;
    if (!verification.data?.status || payment?.status !== 'success') {
      order.status = payment?.status === 'failed' ? 'payment_failed' : 'payment_pending';
      order.updatedAt = new Date().toISOString();
      this._save();
      return order;
    }

    if (Number(payment.amount) !== order.amountNgn * 100 || String(payment.currency || '').toUpperCase() !== 'NGN') {
      throw new Error('Payment verification mismatch for order ' + id + '.');
    }

    const webhookUrl = this._env('MATEO_FF_ALU_WEBHOOK_URL');
    const provider = await this._alu('/api/v.1/create', {
      method: 'POST',
      data: {
        game: order.providerGame,
        denom: order.providerDenom,
        userid: order.uid,
        partner_orderid: order.id,
        partner_webhook_url: webhookUrl
      }
    });

    order.status = provider.data?.data?.status || 'delivery_pending';
    order.providerOrderId = provider.data?.data?.orderid || provider.data?.data?.order_id || order.id;
    order.providerReference = provider.data?.data?.reference || null;
    order.updatedAt = new Date().toISOString();
    this._save();

    return order;
  }

  async refreshProviderOrder(order) {
    const response = await this._alu('/api/v.1/' + encodeURIComponent(order.id), { method: 'GET' });
    const remote = response.data?.data || response.data;
    if (remote?.status) order.status = String(remote.status);
    if (remote?.provider_order_id) order.providerOrderId = remote.provider_order_id;
    order.updatedAt = new Date().toISOString();
    if (order.status === 'successful') order.status = 'delivered';
    this._save();
    return order;
  }

  verifyProviderWebhook(rawBody, timestamp, signature) {
    const secret = this._env('MATEO_FF_ALU_WEBHOOK_SECRET');
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;
    const expected = crypto.createHmac('sha256', secret).update(String(timestamp) + '.' + rawBody).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  handleProviderWebhook(payload) {
    this._load();
    const data = payload?.data || payload;
    const id = String(data?.orderid || '').trim();
    if (!id) throw new Error('Webhook order ID is missing.');
    const order = this.orders.get(id);
    if (!order) throw new Error('Unknown Free Fire webhook order: ' + id);
    if (data.status) order.status = String(data.status) === 'successful' ? 'delivered' : String(data.status);
    if (data.reference) order.providerReference = String(data.reference);
    if (data.provider_order_id) order.providerOrderId = String(data.provider_order_id);
    order.updatedAt = new Date().toISOString();
    this._save();
    return order;
  }

  getOrder(reference) {
    this._load();
    return this.orders.get(String(reference || '').trim()) || null;
  }
}

module.exports = FreeFirePurchaseService;
