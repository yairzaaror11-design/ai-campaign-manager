require('dotenv').config();

const express = require('express');
const { logger } = require('./logger');
const webhook = require('./webhook');
const telnyx = require('./telnyx');
const health = require('./health');
const { errorHandler } = require('./errorHandler');
const { initializeDatabase } = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(
  express.json({
    limit: '2mb',
    verify: (req, res, buf) => {
      req.rawBody = Buffer.from(buf);
    }
  })
);

app.use((req, res, next) => {
  logger.info('request', { method: req.method, path: req.path });
  next();
});

app.use('/webhook', webhook);
app.use('/telnyx', telnyx);
app.use('/health', health);

app.get('/', (req, res) =>
  res.json({
    name: 'Campaign Bachat',
    version: '1.8.0',
    stage: 6,
    status: 'running',
    ai: 'gemini',
    approvalEngine: true,
    metaWriteEngine: true,
    mediaHandler: true,
    voiceHandler: true,
    databaseLayer: true,
    readOnly: process.env.READ_ONLY !== 'false'
  })
);

app.use(errorHandler);

async function start() {
  try {
    await initializeDatabase();
  } catch (error) {
    logger.error('Database initialization failed; refusing to start without persistent memory', {
      error: error.message
    });
    throw error;
  }

  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
    throw Error('DATABASE_URL is required in production');
  }

  app.listen(PORT, '0.0.0.0', () =>
    logger.info('Campaign Bachat started', {
      port: PORT,
      version: '1.8.0',
      stage: 6,
      readOnly: process.env.READ_ONLY !== 'false'
    })
  );
}

start();

module.exports = app;
