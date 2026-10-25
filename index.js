require('dotenv').config();

const express = require('express');
const { logger } = require('./logger');
const webhook = require('./webhook');
const telnyx = require('./telnyx');
const health = require('./health');
const { errorHandler } = require('./errorHandler');
const { initializeDatabase } = require('./db');
const { startBackgroundJobs } = require('./backgroundJobs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
app.disable('x-powered-by');
if(process.env.TRUST_PROXY_HOPS==='1') app.set('trust proxy',1);
app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});next();});

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
app.use('/auth/meta', require('./metaOAuth'));
app.use('/meta', require('./metaDeletion').router);
app.use(require('./privacyPages'));


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
  require('./runtimeConfig').validateRuntime();
  let stopJobs=async()=>{};
  try {
    await initializeDatabase();
    if(process.env.WHATSAPP_WORKER_IN_WEB!=='false') stopJobs=startBackgroundJobs();
  } catch (error) {
    logger.error('Database initialization failed; refusing to start without persistent memory', {
      error: error.message
    });
    throw error;
  }

  if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
    throw Error('DATABASE_URL is required in production');
  }

  const server=app.listen(PORT, '0.0.0.0', () =>
    logger.info('Campaign Bachat started', {
      port: PORT,
      version: '1.8.0',
      stage: 6,
      readOnly: process.env.READ_ONLY !== 'false'
    })
  );
  let shuttingDown=false;
  const shutdown=async()=>{
    if(shuttingDown) return;shuttingDown=true;
    const deadline=setTimeout(()=>process.exit(1),25000);deadline.unref();
    server.close(async()=>{await stopJobs();await require('./db').closeDatabase();clearTimeout(deadline);});
  };
  process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
  return {server,shutdown};
}

if(require.main===module) start().catch(()=>{logger.error('Startup configuration or database failed');process.exitCode=1;});

module.exports = app;
module.exports.start=start;
