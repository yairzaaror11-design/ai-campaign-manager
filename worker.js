'use strict';
const { runOne } = require('./workflowWorker');
const { initializeDatabase } = require('./db');
const { logger } = require('./logger');
const pollMs = Math.max(1000, Number(process.env.WORKER_POLL_MS || 5000));
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  if (process.env.MOCK_META_ENABLED !== 'true' || process.env.READ_ONLY !== 'true') {
    throw Error('Worker only supports MOCK_META_ENABLED=true and READ_ONLY=true');
  }
  await initializeDatabase();
  while (!stopping) {
    try {
      const result = await runOne();
      if (result.status === 'IDLE') await sleep(pollMs);
    } catch (error) {
      logger.error('Workflow worker iteration failed', { error: error.message });
      await sleep(pollMs);
    }
  }
}
if (require.main === module) main().catch(error => { logger.error('Worker failed to start', { error: error.message }); process.exitCode = 1; });
module.exports = { main };
