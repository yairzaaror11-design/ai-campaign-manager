'use strict';
const crypto = require('node:crypto');
function createMockMetaAdapter() {
  const records = new Map(); // Test-only, in-memory: restart requires reconciliation.
  const id = () => crypto.randomUUID();
  return {
    async createPaused(plan) {
      const campaignId = id(), adSetIds = [id()], creativeIds = plan.creatives.map(id), adIds = plan.creatives.map(id);
      const objects = { campaignId, adSetIds, creativeIds, adIds };
      records.set(campaignId, { objects, status: 'PAUSED' });
      return objects;
    },
    async verifyPaused(objects) {
      const row = records.get(objects?.campaignId);
      return !!row && row.status === 'PAUSED' && JSON.stringify(row.objects) === JSON.stringify(objects);
    },
    async activate(objects) {
      const row = records.get(objects?.campaignId);
      if (!row || row.status !== 'PAUSED') throw Error('Meta state conflict');
      row.status = 'ACTIVE';
    },
    async verifyActive(objects) { return records.get(objects?.campaignId)?.status === 'ACTIVE'; }
  };
}
module.exports = { createMockMetaAdapter };
