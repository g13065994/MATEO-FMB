'use strict';

module.exports = {
  name: 'ffpacks',
  aliases: ['ffproducts'],
  category: 'freefire',
  description: 'Show currently available Free Fire diamond packs.',
  usage: '/ffpacks',
  role: 0,
  cooldown: 10,

  async execute(ctx) {
    const service = ctx.services.freeFirePurchase;
    if (!service) return ctx.reply(ctx.error('Free Fire purchasing is not configured on this bot.'));

    try {
      const { packs } = await service.getPacks();
      const lines = packs
        .filter(pack => String(pack?.stockStatus || '').toLowerCase() === 'in_stock')
        .slice(0, 30)
        .map(pack => `${pack.name || pack.Pack} — $ ${pack.price}`);
      return ctx.reply(ctx.format('Free Fire Packs', lines.length ? lines : ['No packs are currently in stock.']));
    } catch (error) {
      return ctx.reply(ctx.error(error.message || 'Could not load Free Fire packs.'));
    }
  }
};
