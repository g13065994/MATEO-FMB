'use strict';

module.exports = {
  name: 'backups',
  aliases: ['backup-list'],
  category: 'system',
  description: 'List available local backups.',
  usage: '/backups',
  role: 2,
  cooldown: 5,

  async execute(ctx) {
    const list = ctx.backup?.list?.() || [];
    if (!list.length) return ctx.reply(ctx.format('Backups', ['No backups found.']));
    return ctx.reply(ctx.format('Backups', list.slice(0, 15)));
  }
};
