const cron = require('node-cron');
const { logger } = require('./logger');
const { getAdAccounts, getCampaignPerformance } = require('../services/metaAds');
const { sendWhatsAppMessage } = require('../services/whatsapp');

function setupCronJobs() {
  const adminNumbers = (process.env.ADMIN_PHONE_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);

  if (!adminNumbers.length) {
    logger.warn('No ADMIN_PHONE_NUMBERS set — skipping scheduled reports');
    return;
  }

  // Daily morning report at 8:00 AM (server timezone)
  cron.schedule('0 8 * * *', async () => {
    logger.info('Running daily performance report cron job');

    try {
      const accountsData = await getAdAccounts();
      if (!accountsData.accounts?.length) return;

      for (const phoneNumber of adminNumbers) {
        let report = `📊 *Daily Performance Report*\n_${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}_\n\n`;

        for (const account of accountsData.accounts.slice(0, 3)) { // Top 3 accounts
          const perf = await getCampaignPerformance(account.id, null, 'yesterday');

          report += `*${account.name}*\n`;

          if (perf.insights?.length) {
            const totals = perf.insights.reduce((acc, i) => {
              acc.spend  += Number(String(i.spend).replace('$', '') || 0);
              acc.clicks += Number(String(i.clicks).replace(/,/g, '') || 0);
              acc.imps   += Number(String(i.impressions).replace(/,/g, '') || 0);
              return acc;
            }, { spend: 0, clicks: 0, imps: 0 });

            report += `• Spend: $${totals.spend.toFixed(2)}\n`;
            report += `• Clicks: ${totals.clicks.toLocaleString()}\n`;
            report += `• Impressions: ${totals.imps.toLocaleString()}\n`;
            report += `• CTR: ${totals.imps > 0 ? ((totals.clicks / totals.imps) * 100).toFixed(2) : 0}%\n\n`;
          } else {
            report += `• No data for yesterday\n\n`;
          }
        }

        report += `_Reply with any question about your campaigns!_`;
        await sendWhatsAppMessage(phoneNumber.replace(/\D/g, ''), report);
      }
    } catch (err) {
      logger.error('Daily report cron error', { error: err.message });
    }
  });

  // Weekly summary every Monday at 9:00 AM
  cron.schedule('0 9 * * 1', async () => {
    logger.info('Running weekly performance summary cron job');

    try {
      for (const phoneNumber of adminNumbers) {
        const msg = `📅 *Weekly Summary Ready*\n\nYour weekly ad performance summary is available.\n\nAsk me:\n• "Show weekly report"\n• "Which campaign performed best last week?"\n• "Suggest optimizations based on last week"`;
        await sendWhatsAppMessage(phoneNumber.replace(/\D/g, ''), msg);
      }
    } catch (err) {
      logger.error('Weekly summary cron error', { error: err.message });
    }
  });

  logger.info('✅ Cron jobs scheduled (daily 8AM, weekly Monday 9AM)');
}

module.exports = { setupCronJobs };
