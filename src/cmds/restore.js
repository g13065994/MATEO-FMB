'use strict';

module.exports = {
  name: 'restore',
  category: 'system',
  description: 'Queue a database restore for the next startup.',
  usage: '/restore <backup-id>',
  role: 3,
  cooldown: 30,

  async execute(ctx) {
    const id = String(ctx.args[0] || '').trim();
    if (!id) return ctx.reply(ctx.error('Provide a backup ID from /backups.'));
    try {
      ctx.backup.requestRestore(id);
      return ctx.reply(ctx.format('Restore queued', [
        'Backup: ' + id,
        'The restore will be applied at the next startup.',
        'Restart MATEO-FMB after verifying the backup ID.'
      ]));
    } catch (error) {
      return ctx.reply(ctx.error(error.message));
    }
  }
};
