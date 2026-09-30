'use strict';

class MessengerAdapter {
  get name() { return 'abstract'; }
  capabilities() { return {}; }
  async login() { throw new Error('MessengerAdapter.login() is not implemented.'); }
  async afterLogin() {}
  isActive(api) {
    if (!api) return false;
    if (typeof api.isActiveClient === 'function') {
      try { return api.isActiveClient() !== false; } catch (_) {}
    }
    return true;
  }
  async disconnect(api) {
    if (!api?.logout) return;
    await new Promise(resolve => {
      try { api.logout(() => resolve()); } catch (_) { resolve(); }
    });
  }
}

module.exports = MessengerAdapter;
