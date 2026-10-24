require('dotenv').config();

const express = require('express');
const { logger } = require('./logger');
const webhook = require('./webhook');
const health = require('./health');
const { errorHandler } = require('./errorHandler');

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
app.use('/health', health);

app.get('/', (req, res) =>
  res.json({
    name: 'Campaign Bachat',
    version: '1.6.0',
    stage: 4,
    status: 'running',
    ai: 'gemini',
    approvalEngine: true,
    metaWriteEngine: true,
    postWriteVerification: true,
    mediaHandler: true,
    readOnly: process.env.READ_ONLY !== 'false'
  })
);

app.use(errorHandler);

app.listen(PORT, '0.0.0.0', () =>
  logger.info('Campaign Bachat started', {
    port: PORT,
    version: '1.6.0',
    stage: 4,
    readOnly: process.env.READ_ONLY !== 'false'
  })
);

module.exports = app;
