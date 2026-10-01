'use strict';

module.exports = {
  name: 'ffbuy',
  aliases: ['ffpurchase', 'fftopup'],
  category: 'freefire',
  description: 'Create a secure payment for a Free Fire diamond top-up.',
  usage: '/ffbuy <uid> <diamonds> <email>',
  role: 0,
  cooldown: 15,

  async execute(ctx) {
    const [uid, diamonds, email] = ctx.args;
    if (!uid || !diamonds || !email) {
      return ctx.reply(ctx.error(`Usage: ${ctx.prefix}ffbuy <uid> <diamonds> <email>`));
    }

    const service = ctx.services.freeFirePurchase;
    if (!service) return ctx.reply(ctx.error('Free Fire purchasing is not configured on this bot.'));

    try {
      const order = await service.createPayment({
        uid,
        diamonds,
        email,
        senderID: ctx.userID
      });

      return ctx.reply(ctx.format('Free Fire Purchase', [
        `UID: ${order.uid}`,
        `Diamonds: ${order.diamonds}`,
        `Price: ₦${order.amountNgn.toLocaleString('en-NG')}`,
        `Order: ${order.id}`,
        '',
        'Payment is required before delivery.',
        'Open this secure Paystack checkout:',
        order.paymentUrl,
        '',
        `After payment, use ${ctx.prefix}ffstatus ${order.id}`
      ]));
    } catch (error) {
      ctx.logger?.warn?.('Free Fire purchase initialization failed: ' + error.message);
      return ctx.reply(ctx.error(error.message || 'Could not create the Free Fire purchase.'));
    }
  }
};
