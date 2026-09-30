'use strict';

module.exports = {
  name: 'canceljob',
  aliases: ['cancelreminder'],
  category: 'utility',
  description: 'Cancel one of your scheduled jobs.',
  usage: '/canceljob <job-id>',
  cooldown: 3,

  async execute(ctx) {
    const id = String(ctx.args[0] || '').trim();
    if (!id) return ctx.reply(ctx.error('Provide the job ID shown by /jobs.'));
    const jobs = ctx.scheduler?.list?.(ctx.userID) || [];
    const job = jobs.find(item => item.id === id || item.id.startsWith(id));
    if (!job) return ctx.reply(ctx.error('That scheduled job was not found.'));
    const ok = await ctx.scheduler.remove(job.id, ctx.userID);
    return ctx.reply(ok
      ? ctx.format('Scheduler', ['Job ' + job.id.slice(0, 8) + ' cancelled.'])
      : ctx.error('Unable to cancel that job.'));
  }
};
