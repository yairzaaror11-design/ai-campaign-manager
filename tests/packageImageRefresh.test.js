'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const pkg = require('../campaignPackage');
const draft = { objective: 'לידים', audience: 'בעלי עסקים', geography: 'תל אביב', placements: 'פיד', budgetNote: 'לא נקבע', scheduleNote: 'לא נקבע', headline: 'כותרת חדשה', cta: 'לפרטים', designBrief: 'נקי' };
const task = (uploadStatus) => ({ request: 'אני רוצה קמפיין', state: { planningMode: 'REQUESTED_TASK', steps: [
  { id: 'd1', kind: 'draft', status: 'PREPARED', dependsOn: [], artifact: { campaignDraft: draft } },
  { id: 'img', kind: 'image', packageImage: true, status: 'PREPARED', dependsOn: ['d1'], artifact: { mediaId: 'm', imageText: { headline: 'כותרת ישנה', cta: 'לפרטים' } } },
  ...(uploadStatus ? [{ id: 'up', kind: 'meta', intent: 'UPLOAD_IMAGE', status: uploadStatus, dependsOn: ['img'] }] : [])] } });

test('a graphic that no longer matches the revised copy is regenerated', () => {
  const t = task('PENDING');
  const next = pkg.imageDecision(t, () => true);
  assert.equal(next.next.op, 'image'); assert.deepEqual(next.next.imageText, { headline: 'כותרת חדשה', cta: 'לפרטים' });
  assert.equal(t.state.steps[1].status, 'PENDING');
});
test('an uploaded graphic is never silently replaced', () => {
  const t = task('DONE');
  assert.equal(pkg.imageDecision(t, () => true), null);
  assert.equal(t.state.steps[1].status, 'PREPARED');
});
