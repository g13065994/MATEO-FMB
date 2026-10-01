'use strict';

module.exports = {
  name: 'ffstatus',
  aliases: ['fforder'],
  category: 'freefire',
  description: 'Verify payment and check Free Fire delivery status.',
  usage: '/ffstatus <order-id>',
  role: 0,
  cooldown: 10,

  async execute(ctx) {
    const reference = String(ctx.args[0] || '').trim();
    if (!reference) return ctx.reply(ctx.error(`Usage: ${ctx.prefix}ffstatus <order-id>`));

    const service = ctx.services.freeFirePurchase;
    if (!service) return ctx.reply(ctx.error('Free Fire purchasing is not configured on this bot.'));

    const order = service.getOrder(reference);
    if (!order) return ctx.reply(ctx.error('Order not found. Check the order ID and try again.'));

    if (order.senderID && String(order.senderID) !== String(ctx.userID) && Number(ctx.command.role || 0) === 0) {
      return ctx.reply(ctx.error('Only the user who created this order can check it.'));
    }

    try {
      const updated = await service.verifyPaymentAndFulfill(reference);
      const status = String(updated.status || 'unknown');

      if (status === 'payment_pending') {
        return ctx.reply(ctx.format('Free Fire Order', [
          `Order: ${updated.id}`,
          `UID: ${updated.uid}`,
          `Diamonds: ${updated.diamonds}`,
          'Status: Payment pending',
          'Complete the Paystack payment first.'
        ]));
      }

      if (status === 'payment_failed') {
        return ctx.reply(ctx.error(`Order ${updated.id} payment failed. No diamond delivery was started.`));
      }

      if (status === 'successful' || status === 'delivered') {
        updated.status = 'delivered';
        return ctx.reply(ctx.format('Free Fire Delivery', [
          `Order: ${updated.id}`,
          `UID: ${updated.uid}`,
          `Diamonds: ${updated.diamonds}`,
          'Status: Delivered successfully.'
        ]));
      }

      return ctx.reply(ctx.format('Free Fire Order', [
        `Order: ${updated.id}`,
        `UID: ${updated.uid}`,
        `Diamonds: ${updated.diamonds}`,
        `Status: ${status}`,
        '',
        'Use the status command again later if the provider is still processing the order.'
      ]));
    } catch (error) {
      ctx.logger?.warn?.('Free Fire order status failed: ' + error.message);
      return ctx.reply(ctx.error(error.message || 'Could not verify this order.'));
    }
  }
};
