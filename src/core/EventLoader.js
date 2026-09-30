'use strict';

const fs = require('fs');
const path = require('path');

class EventLoader {
  constructor({ eventsDir, bus, logger, apiProvider, services = {}, pluginManager = null }) {
    Object.assign(this, { eventsDir, bus, logger, apiProvider, services, pluginManager });
  }

  _eventDirs() {
    return [this.eventsDir, ...(this.pluginManager?.eventDirs?.() || [])].filter(Boolean);
  }

  load() {
    for (const eventsDir of this._eventDirs()) {
      if (!fs.existsSync(eventsDir)) continue;
      for (const file of fs.readdirSync(eventsDir).filter(f => f.endsWith('.js')).sort()) {
        const fullPath = path.join(eventsDir, file);
        delete require.cache[require.resolve(fullPath)];
        try {
          const mod = require(fullPath);
          const definitions = mod.default ? [mod.default] : [mod];
          for (const definition of definitions) {
            if (!definition || !definition.eventType || typeof definition.run !== 'function') {
              this.logger.warn('Skipping invalid event module: ' + file);
              continue;
            }
            for (const eventType of (Array.isArray(definition.eventType) ? definition.eventType : [definition.eventType])) {
              this.bus.on(eventType, async payload => {
                await definition.run(payload.api || this.apiProvider(), payload.event || payload, this.services);
              });
              this.logger.info('Registered event ' + eventType + ' from ' + file);
            }
          }
        } catch (error) {
          this.logger.error('Failed to load event ' + file + ':', error);
        }
      }
    }
    return this;
  }
}

module.exports = EventLoader;
