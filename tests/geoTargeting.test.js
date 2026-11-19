'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const geo = require('../geoTargeting');
const search = async ({ q }) => ({ data: q === 'רחובות' ? [{ key: '1234', name: 'Rehovot', type: 'city' }] : q === 'מחוז המרכז' ? [{ key: '77', name: 'Central District', type: 'region' }] : [] });

test('places resolve to Meta cities with a clamped radius, countries dropped', async () => {
  const t = await geo.resolveTargeting({ places: [{ name: 'רחובות', radiusKm: 5 }], age_min: 25 }, search);
  assert.deepEqual(t, { age_min: 25, geo_locations: { cities: [{ key: '1234', name: 'Rehovot', radius: 17, distance_unit: 'kilometer' }] } });
  assert.ok(geo.validGeo(t.geo_locations));
  assert.deepEqual(geo.forMeta(t).geo_locations, { cities: [{ key: '1234', radius: 17, distance_unit: 'kilometer' }] });
});
test('regions work and unknown places stop the plan instead of targeting all Israel', async () => {
  assert.deepEqual((await geo.resolveTargeting({ places: [{ name: 'מחוז המרכז' }] }, search)).geo_locations, { regions: [{ key: '77', name: 'Central District' }] });
  await assert.rejects(geo.resolveTargeting({ places: [{ name: 'עיר שלא קיימת' }] }, search), /TARGET_PLACE_NOT_FOUND/);
  await assert.rejects(geo.resolveTargeting({ places: [{ name: 'x', extra: 1 }] }, search), /INVALID_TARGET_PLACES/);
});
test('validation keeps country targeting and rejects malformed local targeting', () => {
  assert.ok(geo.validGeo({ countries: ['IL'] }));
  assert.equal(geo.validGeo({ cities: [{ key: '1', radius: 5, distance_unit: 'kilometer' }] }), false);
  assert.equal(geo.validGeo({ cities: [{ key: 'abc', radius: 20, distance_unit: 'kilometer' }] }), false);
  assert.equal(geo.validGeo({ zips: ['1'] }), false);
  assert.equal(geo.validGeo({}), false);
});
test('approval summary shows the real area', () => {
  const { createActionPlan, formatActionPlan } = require('../actionPlan');
  const text = formatActionPlan(createActionPlan({ intent: 'CREATE_ADSET', target: { accountId: 'act_1' }, parameters: { name: 'n', dailyBudget: 30, currency: 'ILS', targeting: { geo_locations: { cities: [{ key: '1234', name: 'Rehovot', radius: 20, distance_unit: 'kilometer' }] } } } }));
  assert.match(text, /Rehovot \+ 20 ק"מ/);
});
