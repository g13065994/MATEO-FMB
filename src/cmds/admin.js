'use strict';

module.exports = {
  name: 'admin',
  aliases: ['botadmin'],
  category: 'system',
  description: 'Manage MATEO-FMB bot administrators.',
  usage: '/admin <list|add|remove> [userID]',
  role: 3,

  async execute(ctx) {
    const action = String(ctx.args[0] || 'list').toLowerCase();
    const ids = Array.isArray(ctx.config.get('adminIDs', [])) ? [...ctx.config.get('adminIDs', [])].map(String) : [];

    if (action === 'list') {
      return ctx.reply(ctx.format('Bot admins', ids.length ? ids.map((id, i) => `${i + 1}. ${id}`) : ['No bot admins configured.']));
    }

    const target = String(ctx.args[1] || ctx.message?.mentions?.[ctx.args[1]]?.id || '').trim();
    if (!/^\d+$/.test(target)) return ctx.reply(ctx.error('Provide a numeric Messenger user ID.'));

    if (action === 'add') {
      if (!ids.includes(target)) ids.push(target);
      ctx.config.set('adminIDs', ids);
      return ctx.reply(ctx.format('Bot admin', [`Added: ${target}`, `Total admins: ${ids.length}`]));
    }

    if (action === 'remove') {
      if (target === String(ctx.config.get('ownerID', '') || '')) return ctx.reply(ctx.error('The bot owner cannot be removed from owner configuration.'));
      const next = ids.filter(id => id !== target);
      if (next.length === ids.length) return ctx.reply(ctx.error('That user is not a bot admin.'));
      ctx.config.set('adminIDs', next);
      return ctx.reply(ctx.format('Bot admin', [`Removed: ${target}`, `Total admins: ${next.length}`]));
    }

    return ctx.reply(ctx.error('Usage: /admin <list|add|remove> [userID]'));
  },
};
