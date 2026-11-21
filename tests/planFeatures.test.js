'use strict';
// Plan features are shown as active only while they work; the rest say "(בקרוב)".
const test=require('node:test'),assert=require('node:assert/strict');
const plans=require('../billingPlans');

test('features that do not work today are marked "(בקרוב)"',()=>{
 const env={...process.env};
 try{
  delete process.env.VIDEO_ENABLED;delete process.env.META_CRM_FEEDBACK_ENABLED;delete process.env.WEEKLY_REPORTS_ENABLED;
  const growth=plans.plan('growth').features,premium=plans.plan('premium').features,basic=plans.plan('basic').features;
  assert.ok(growth.includes('סרטוני AI (בקרוב)'));
  assert.ok(premium.includes('בדיקה אנושית של הקמפיינים והתוכן (בקרוב)'));
  assert.ok(growth.includes('החזרת מכירות ל־Meta לשיפור הקמפיינים (בקרוב)'));
  assert.ok(basic.includes('דוחות ביצועים לפי בקשה'));
  assert.ok(basic.includes('דוח שבועי אוטומטי (בקרוב)'));
  // Switching a feature on shows it as active; the human review stays "soon" until it exists.
  process.env.META_CRM_FEEDBACK_ENABLED='true';process.env.WEEKLY_REPORTS_ENABLED='true';
  assert.ok(plans.plan('growth').features.includes('החזרת מכירות ל־Meta לשיפור הקמפיינים'));
  assert.ok(plans.plan('basic').features.includes('דוח שבועי אוטומטי'));
  assert.ok(plans.list()[2].features.includes('בדיקה אנושית של הקמפיינים והתוכן (בקרוב)'));
  // Video needs both the switch and a provider key.
  process.env.VIDEO_ENABLED='true';
  assert.equal(plans.plan('growth').features.includes('סרטוני AI'),require('../videoService').enabled());
  assert.ok(Object.isFrozen(plans.plan('growth').features));
 }finally{for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
