'use strict';

module.exports = {
  name: 'plugins',
  category: 'system',
  description: 'Show installed MATEO-FMB plugins.',
  usage: '/plugins',
  cooldown: 5,

  async execute(ctx) {
    const plugins = ctx.plugins?.list?.() || [];
    if (!plugins.length) return ctx.reply(ctx.format('Plugins', ['No external plugins installed.']));
    return ctx.reply(ctx.format('Plugins', plugins.map(plugin =>
      plugin.name + ' ' + plugin.version + ' — ' + (plugin.enabled ? 'enabled' : 'disabled')
    )));
  }
};
