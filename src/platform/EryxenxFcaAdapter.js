'use strict';

const path = require('path');
const login = require('@eryxenx/fca');
const MessengerAdapter = require('./MessengerAdapter');

class EryxenxFcaAdapter extends MessengerAdapter {
  get name() { return 'eryxenx-fca'; }

  capabilities() {
    return Object.freeze({
      mqtt: true,
      autoReconnect: true,
      staleClientGuard: true,
      sessionGuard: true,
      httpFallback: true,
      e2ee: true,
      e2eeMedia: true,
      broadcast: true,
      classicApi: true,
    });
  }

  async login(appState, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        login({ appState }, { ...options, autoReconnect: false }, (error, api) => {
          if (error) return reject(error instanceof Error ? error : new Error(String(error)));
          resolve(api);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async afterLogin(api, { appStatePath, config } = {}) {
    const enabled = config?.get('platform.autoSaveAppState', true) !== false;
    if (!enabled || typeof api?.sessionGuard !== 'function' || !appStatePath) return;
    const interval = Math.max(60_000, Number(config?.get('platform.sessionSaveIntervalMs', 900_000)) || 900_000);
    const debounce = Math.max(5_000, Number(config?.get('platform.sessionDebounceMs', 30_000)) || 30_000);
    api.sessionGuard(path.resolve(appStatePath), { interval, debounce });
  }
}

module.exports = EryxenxFcaAdapter;
