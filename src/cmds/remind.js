'use strict';

const SchedulerService = require('../core/SchedulerService');

module.exports = {
  name: 'remind',
  aliases: ['reminder'],
  category: 'utility',
  description: 'Schedule a message reminder in this thread.',
  usage: '/remind <duration> <message>',
  cooldown: 5,

  async execute(ctx) {
    if (!ctx.scheduler) return ctx.reply(ctx.error('Scheduler is unavailable.'));
    if (ctx.args.length < 2) return ctx.reply(ctx.format('Usage', [
      this.usage,
      'Examples: /remind 30m drink water',
      '/remind 2h meeting'
    ]));

    const delayMs = SchedulerService.parseDuration(ctx.args[0]);
    if (!delayMs) return ctx.reply(ctx.error('Use a duration such as 30s, 15m, 2h, 1d or 1w.'));
    const text = ctx.args.slice(1).join(' ').trim();
    if (!text) return ctx.reply(ctx.error('Reminder text is required.'));

    try {
      const job = await ctx.scheduler.addMessage({
        ownerID: ctx.userID,
        threadID: ctx.threadID,
        text,
        delayMs
      });
      return ctx.reply(ctx.format('Reminder scheduled', [
        'ID: ' + job.id.slice(0, 8),
        'Time: ' + new Date(job.runAt).toLocaleString(),
        'Message: ' + job.text
      ]));
    } catch (error) {
      return ctx.reply(ctx.error(error.message));
    }
  }
};
