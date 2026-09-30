'use strict';

module.exports = {
  name: 'backup',
  category: 'system',
  description: 'Create a safe local MATEO-FMB backup.',
  usage: '/backup',
  role: 2,
  cooldown: 30,

  async execute(ctx) {
    try {
      const id = await ctx.backup.create('command');
      return ctx.reply(ctx.format('Backup', ['Created: ' + id]));
    } catch (error) {
      return ctx.reply(ctx.error(error.message));
    }
  }
};
