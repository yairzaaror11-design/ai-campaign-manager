require('dotenv').config();
const express = require('express');
const { logger } = require('./utils/logger');
const webhookRouter = require('./routes/webhook');
const healthRouter = require('./routes/health');
const { errorHandler } = require('./middleware/errorHandler');
const { setupCronJobs } = require('./utils/cron');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// ── Routes ────────────────────────────────────────────────
app.use('/webhook', webhookRouter);
app.use('/health', healthRouter);

app.get('/', (req, res) => {
  res.json({
    name: 'AI Campaign Manager',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      webhook: '/webhook',
      health: '/health'
    }
  });
});

// ── Error Handler ─────────────────────────────────────────
app.use(errorHandler);

// ── Start Server ──────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`🚀 AI Campaign Manager running on port ${PORT}`);
  logger.info(`📱 Webhook URL: https://your-railway-domain.railway.app/webhook`);
  logger.info(`🔑 Verify Token: ${process.env.WHATSAPP_VERIFY_TOKEN}`);

  // Start scheduled jobs (daily performance reports)
  setupCronJobs();
});

module.exports = app;
