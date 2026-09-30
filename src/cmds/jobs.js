'use strict';

module.exports = {
  name: 'jobs',
  aliases: ['reminders'],
  category: 'utility',
  description: 'List your pending scheduled jobs.',
  usage: '/jobs',
  cooldown: 5,

  async execute(ctx) {
    const jobs = ctx.scheduler?.list?.(ctx.userID) || [];
    if (!jobs.length) return ctx.reply(ctx.format('Scheduled jobs', ['No pending jobs.']));
    const lines = jobs.slice(0, 15).map(job =>
      job.id.slice(0, 8) + ' — ' + new Date(job.runAt).toLocaleString() + ' — ' + job.text.slice(0, 120)
    );
    if (jobs.length > 15) lines.push('...and ' + (jobs.length - 15) + ' more.');
    return ctx.reply(ctx.format('Scheduled jobs', lines));
  }
};
