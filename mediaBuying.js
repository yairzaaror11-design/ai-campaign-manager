'use strict';
// SCORPIO's media-buyer defaults for new campaigns (research: media_buying_playbook.md §1, §4, §5).
// Small local budgets work best consolidated: one campaign, one ad set, a few genuinely different
// ads, Advantage+ audience with the location as the hard limit, and automatic placements.
// Everything here runs BEFORE the plan is hashed, so the owner approves exactly what is sent.
//
// Marketing API field names, checked on developers.facebook.com (2026-11):
// * Advantage+ audience: targeting.targeting_automation.advantage_audience = 1 (0 opts out). Since
//   v23 it must be explicit. With it on, age_max is fixed at 65 and age_min may only be 18..25;
//   location, minimum age and custom-audience exclusions stay hard limits, and an age_range is a
//   suggestion. https://developers.facebook.com/docs/marketing-api/audiences/reference/targeting-expansion/advantage-audience/
// * Advantage+ (automatic) placements: send no publisher_platforms / *_positions; "if you do not
//   select any publisher_platforms, Facebook considers all default publisher_platforms".
//   https://developers.facebook.com/docs/marketing-api/audiences/reference/placement-targeting
const TARGETING_AUTOMATION = 'targeting_automation';
const ADVANTAGE_AUDIENCE = 'advantage_audience';
const AGE_RANGE = 'age_range';
const ADVANTAGE_AGE = Object.freeze({ minFloor: 18, minCeiling: 25, max: 65 });
const MANUAL_PLACEMENT_FIELDS = Object.freeze(['publisher_platforms', 'facebook_positions', 'instagram_positions', 'audience_network_positions', 'messenger_positions', 'threads_positions', 'device_platforms', 'user_os']);
// Manual narrowing the owner chose on purpose: when present, the audience is left exactly as approved.
const MANUAL_AUDIENCE_FIELDS = Object.freeze(['genders', 'flexible_spec', 'interests', 'behaviors', 'custom_audiences', 'exclusions', 'locales', 'income', 'life_events']);
// "Small budget" = the playbook's ₪50–₪300/day range (per day, whole bundle, account currency).
const SMALL_DAILY_BUDGET = Object.freeze({ ILS: 300, USD: 100, EUR: 100, GBP: 80, CAD: 120, AUD: 140 });
// CREATE_BUNDLE `ads`: 2..5 different ads in the ad set. ACTIVATE_BUNDLE accepts at most 20 ad IDs.
const BUNDLE_ADS = Object.freeze({ min: 2, max: 5, totalMax: 20 });

function dailyTotal(plan) {
  const p = plan.parameters || {};
  const n = Number(p.dailyBudget);
  return Number.isFinite(n) ? n : (p.adSets || []).reduce((t, s) => t + (Number(s.dailyBudget) || 0), 0);
}
function smallBudget(plan) {
  const cap = SMALL_DAILY_BUDGET[plan.parameters?.currency || plan.review?.currency];
  const total = dailyTotal(plan);
  return !!cap && total > 0 && total <= cap;
}
const manualAudience = (t) => MANUAL_AUDIENCE_FIELDS.some((k) => t[k] !== undefined && !(Array.isArray(t[k]) && !t[k].length));

// Mutates and returns the targeting: Advantage+ audience on, location stays the main manual setting.
function advantageTargeting(t) {
  if (!t || typeof t !== 'object' || t[TARGETING_AUTOMATION] !== undefined || manualAudience(t)) return t;
  const min = Number.isInteger(t.age_min) ? t.age_min : ADVANTAGE_AGE.minFloor, max = Number.isInteger(t.age_max) ? t.age_max : ADVANTAGE_AGE.max;
  // A narrower age the owner asked for becomes Meta's suggestion (age_range), not a hard limit.
  if (min > ADVANTAGE_AGE.minFloor || max < ADVANTAGE_AGE.max) t[AGE_RANGE] = [min, Math.max(min, max)];
  t.age_min = Math.min(Math.max(min, ADVANTAGE_AGE.minFloor), ADVANTAGE_AGE.minCeiling);
  t.age_max = ADVANTAGE_AGE.max;
  t[TARGETING_AUTOMATION] = { [ADVANTAGE_AUDIENCE]: 1 };
  return t;
}
function automaticPlacements(t) {
  if (t && typeof t === 'object') for (const k of MANUAL_PLACEMENT_FIELDS) delete t[k];
  return t;
}
const advantageOn = (t) => Number(t?.[TARGETING_AUTOMATION]?.[ADVANTAGE_AUDIENCE]) === 1;
const automaticPlacementsOn = (t) => !!t && MANUAL_PLACEMENT_FIELDS.every((k) => t[k] === undefined);

// One ad set is the default at small budgets: every extra ad set splits a small budget further.
function singleAdSetIssue(plan) {
  if (plan.intent !== 'CREATE_BUNDLE' || !smallBudget(plan) || (plan.parameters.adSets || []).length <= 1) return null;
  return Object.assign(Error('SMALL_BUDGET_SINGLE_ADSET'), { reply: 'בתקציב הזה עדיף קהל אחד ותקציב אחד: כל חלוקה נוספת מפצלת תקציב קטן ומאטה את הלמידה של Meta. אכין את ההצעה מחדש עם קבוצת מודעות אחת.' });
}

function applyBundleDefaults(plan) {
  if (plan.intent !== 'CREATE_BUNDLE' || !smallBudget(plan)) return plan;
  for (const set of plan.parameters.adSets || []) {
    if (!set.targeting) continue;
    advantageTargeting(set.targeting);
    automaticPlacements(set.targeting);
  }
  return plan;
}

// Strict checks for targeting that claims Advantage+ audience (Meta rejects the other shapes).
function checkAdvantageTargeting(t) {
  if (!advantageOn(t)) return;
  if (t.age_max !== undefined && t.age_max !== ADVANTAGE_AGE.max) throw Error('ADVANTAGE_AUDIENCE_AGE');
  if (t.age_min !== undefined && (!Number.isInteger(t.age_min) || t.age_min < ADVANTAGE_AGE.minFloor || t.age_min > ADVANTAGE_AGE.minCeiling)) throw Error('ADVANTAGE_AUDIENCE_AGE');
  const r = t[AGE_RANGE];
  if (r !== undefined && (!Array.isArray(r) || r.length !== 2 || !r.every(Number.isInteger) || r[0] < ADVANTAGE_AGE.minFloor || r[1] > ADVANTAGE_AGE.max || r[0] > r[1])) throw Error('ADVANTAGE_AUDIENCE_AGE');
}

// The ads of a bundle, in order: `ads` (2..5) or the legacy single ad + copy-only variants.
function bundleAds(p) {
  if (Array.isArray(p.ads) && p.ads.length) return p.ads.map((a) => ({ headline: a.headline, message: a.message, imageHash: a.imageHash }));
  return [{ headline: p.headline, message: p.message, imageHash: p.imageHash }, ...(p.variants || []).map((v) => ({ headline: v.headline, message: v.message, imageHash: p.imageHash }))];
}
const text = (v, max) => typeof v === 'string' && v.trim() && v.length <= max;
function checkBundleAds(p) {
  if (p.ads === undefined) return;
  if (p.variants !== undefined) throw Error('ADS_AND_VARIANTS_CONFLICT');
  if (!Array.isArray(p.ads) || p.ads.length < BUNDLE_ADS.min || p.ads.length > BUNDLE_ADS.max) throw Error('INVALID_BUNDLE_ADS');
  const seen = new Set();
  for (const a of p.ads) {
    if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).some((k) => !['headline', 'message', 'imageHash'].includes(k))) throw Error('INVALID_BUNDLE_ADS');
    if (!text(a.headline, 100) || !text(a.message, 2000)) throw Error('BUNDLE_AD_COPY_REQUIRED');
    if (typeof a.imageHash !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(a.imageHash)) throw Error('BUNDLE_AD_IMAGE_REQUIRED');
    const key = a.headline + '|' + a.message + '|' + a.imageHash;
    if (seen.has(key)) throw Error('DUPLICATE_BUNDLE_AD');
    seen.add(key);
  }
  // The top-level creative fields are the first ad (older code paths and reviews read them).
  if (p.headline !== p.ads[0].headline || p.message !== p.ads[0].message || p.imageHash !== p.ads[0].imageHash) throw Error('BUNDLE_FIRST_AD_MISMATCH');
  if ((p.adSets || []).length * p.ads.length > BUNDLE_ADS.totalMax) throw Error('BUNDLE_TOO_MANY_ADS');
}

module.exports = { TARGETING_AUTOMATION, ADVANTAGE_AUDIENCE, AGE_RANGE, ADVANTAGE_AGE, MANUAL_PLACEMENT_FIELDS, MANUAL_AUDIENCE_FIELDS, SMALL_DAILY_BUDGET, BUNDLE_ADS, smallBudget, advantageTargeting, automaticPlacements, advantageOn, automaticPlacementsOn, applyBundleDefaults, singleAdSetIssue, checkAdvantageTargeting, bundleAds, checkBundleAds };
