'use strict';
const db = require('./db');
const meta = require('./metaConnection');
const forms = require('./metaLeadForms');
const crm = require('./crmService');
const crypto = require('node:crypto');
const axios = require('axios');
const { logger } = require('./logger');
// Lead node fields (Graph API Lead reference). ad/adset/campaign ids can be missing (organic or test leads).
const LEAD_FIELDS = 'id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data,is_organic,platform';
const digits = v => /^\d{1,40}$/.test(String(v || '')) ? String(v) : null;
const label = v => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120) || null : null;
// What the dashboard shows as the lead's source: page, form, ad, ad set, campaign.
function sourceDetail(lead, pageId, hint = {}) {
  const d = { channel: 'meta_lead_ads', pageId: digits(pageId), formId: digits(lead.form_id),
    adId: digits(lead.ad_id) || digits(hint.ad_id), adName: label(lead.ad_name),
    adsetId: digits(lead.adset_id) || digits(hint.adgroup_id), adsetName: label(lead.adset_name),
    campaignId: digits(lead.campaign_id), campaignName: label(lead.campaign_name),
    platform: ['fb','ig','an','msg','wa'].includes(lead.platform) ? lead.platform : null,
    organic: lead.is_organic === true || lead.is_organic === 'true',
    createdTime: typeof lead.created_time === 'string' ? lead.created_time.slice(0, 40) : null };
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null));
}

function enabled() {
  return process.env.META_LEAD_IMPORT_ENABLED === 'true';
}

// Lead Ads webhooks (developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving):
// the app subscribes to object "page", field "leadgen" in the App Dashboard, and each Page
// installs the app with POST /{page-id}/subscribed_apps?subscribed_fields=leadgen using a
// Page token (needs pages_manage_metadata + pages_show_list; reading the lead needs leads_retrieval).
async function pageSubscribed(pageId, token) {
  const subscriptions = await meta.graph('/'+pageId+'/subscribed_apps', token, {
    fields:'id,subscribed_fields', limit:100
  });
  return !!subscriptions.data?.some(app =>
    String(app.id) === String(process.env.META_APP_ID) && app.subscribed_fields?.includes('leadgen')
  );
}
async function subscribePage(pageId, token) {
  const proof = crypto.createHmac('sha256', process.env.META_APP_SECRET).update(token).digest('hex');
  try {
    const r = (await axios.post('https://graph.facebook.com/' + meta.config().version + '/' + forms.id(pageId) + '/subscribed_apps',
      new URLSearchParams({ subscribed_fields: 'leadgen' }),
      { headers: { Authorization: 'Bearer ' + token }, params: { appsecret_proof: proof }, timeout: 15000, maxRedirects: 0 })).data;
    return r?.success === true;
  } catch { return false; }
}

async function connect(clientId, pageId, formId) {
  const { access } = await forms.inspect(clientId, pageId, formId);
  let subscribed = await pageSubscribed(pageId, access.token);
  if (!subscribed && await subscribePage(pageId, access.token)) subscribed = await pageSubscribed(pageId, access.token);
  if (!subscribed) throw Error('META_LEAD_SUBSCRIPTION_REQUIRED');
  return db.transaction(async tx => {
    const client = (await tx('SELECT meta_generation FROM clients WHERE id=$1 FOR UPDATE', [clientId])).rows[0];
    if (!client || String(client.meta_generation) !== String(access.connection.meta_generation)) {
      throw Error('CONNECTION_REVOKED');
    }
    const saved = await tx(`INSERT INTO meta_lead_sources(form_id,page_id,client_id,meta_generation,app_id)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(form_id) DO UPDATE SET meta_generation=EXCLUDED.meta_generation,app_id=EXCLUDED.app_id
      WHERE meta_lead_sources.client_id=EXCLUDED.client_id AND meta_lead_sources.page_id=EXCLUDED.page_id
      RETURNING form_id`, [formId,pageId,clientId,client.meta_generation,process.env.META_APP_ID]);
    if (!saved.rows.length) throw Error('FORM_ALREADY_CONNECTED');
  });
}

async function ingest(pageId, value, expectedGeneration) {
  if (!value || value.page_id !== pageId ||
      ![pageId,value.form_id,value.leadgen_id].every(id => typeof id === 'string' && /^\d{1,40}$/.test(id))) return;
  const source = (await db.query(`SELECT s.* FROM meta_lead_sources s JOIN clients c ON c.id=s.client_id
    WHERE s.page_id=$1 AND s.form_id=$2 AND s.app_id=$3 AND s.meta_generation=c.meta_generation`,
    [pageId,value.form_id,process.env.META_APP_ID])).rows[0];
  if (!source || String(source.meta_generation) !== String(expectedGeneration)) throw Error('CONNECTION_REVOKED');
  const { client_id: clientId, meta_generation: generation } = source;
  const prior = await db.query("SELECT 1 FROM crm_leads WHERE client_id=$1 AND source='meta_lead_ads' AND source_event_id=$2", [clientId,value.leadgen_id]);
  if (prior.rows.length) return;
  const access = await meta.context.run(String(clientId), () => forms.pageAccess(clientId,pageId));
  if (String(access.connection.meta_generation) !== String(generation)) throw Error('CONNECTION_REVOKED');
  const lead = await meta.graph('/'+value.leadgen_id,access.token,{fields:LEAD_FIELDS});
  if (lead.id !== value.leadgen_id || lead.form_id !== value.form_id || !Array.isArray(lead.field_data)) {
    throw Error('META_LEAD_RESPONSE_MISMATCH');
  }
  const field = name => {
    const value = lead.field_data.find(field => field?.name === name)?.values?.[0];
    return typeof value === 'string' ? value.trim() : '';
  };
  const phone = field('phone_number');
  const answers = require('./leadSpeed').formAnswers(lead.field_data);
  const email = field('email');
  const saved = await crm.create(clientId,{
    name: field('full_name').slice(0,120) || 'ליד מ־Meta',
    phone: /^\+?[\d ()-]{7,30}$/.test(phone) ? phone : null,
    email: email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    campaignId: /^\d{1,40}$/.test(lead.campaign_id || '') ? String(lead.campaign_id) : null,
    source:'meta_lead_ads',
    sourceEventId:value.leadgen_id,
    note: require('./leadSpeed').answersNote(answers)
  }, async tx => {
    const current = await tx(`SELECT 1 FROM meta_lead_sources s JOIN clients c ON c.id=s.client_id
      WHERE s.form_id=$1 AND s.page_id=$2 AND s.client_id=$3 AND s.app_id=$4
      AND s.meta_generation=$5 AND c.meta_generation=$5 FOR SHARE OF s`,
      [value.form_id,pageId,clientId,process.env.META_APP_ID,generation]);
    return current.rows.length > 0;
  });
  if (saved.revoked) throw Error('CONNECTION_REVOKED');
  if (saved.id) {
    const detail = sourceDetail(lead, pageId, value);
    await db.query('UPDATE crm_leads SET source_detail=$3::jsonb,ad_id=COALESCE($4,ad_id),updated_at=NOW() WHERE client_id=$1 AND id=$2',
      [clientId, saved.id, JSON.stringify(detail), detail.adId || null]);
    saved.source_detail = detail;
  }
  // A newly saved lead (not a duplicate) alerts the owner immediately.
  if (saved.id) await require('./leadConcierge').onNewLead(clientId, saved, { answers, formId: value.form_id });
}

async function enqueue(body) {
  await db.transaction(async tx => {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value;
        if (change.field !== 'leadgen' || !v || v.page_id !== entry.id ||
            ![entry.id,v.form_id,v.leadgen_id].every(id => typeof id === 'string' && /^\d{1,40}$/.test(id))) continue;
        // A new form on a Page this business already connected (e.g. made in Ads Manager)
        // belongs to that business; ingest still checks the form against the Page with its token.
        const owners = (await tx(`SELECT DISTINCT s.client_id,c.meta_generation FROM meta_lead_sources s JOIN clients c ON c.id=s.client_id
          WHERE s.page_id=$1 AND s.app_id=$2 AND c.meta_generation=s.meta_generation`,[entry.id,process.env.META_APP_ID])).rows;
        if (owners.length === 1) await tx(`INSERT INTO meta_lead_sources(form_id,page_id,client_id,meta_generation,app_id)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(form_id) DO NOTHING`,[v.form_id,entry.id,owners[0].client_id,owners[0].meta_generation,process.env.META_APP_ID]);
        await tx(`INSERT INTO meta_lead_events(lead_id,form_id,generation)
          SELECT $1,s.form_id,s.meta_generation FROM meta_lead_sources s JOIN clients c ON c.id=s.client_id
          WHERE s.form_id=$2 AND s.page_id=$3 AND s.app_id=$4 AND c.meta_generation=s.meta_generation
          ON CONFLICT(lead_id) DO NOTHING`,[v.leadgen_id,v.form_id,entry.id,process.env.META_APP_ID]);
      }
    }
  });
}

async function runOne() {
  const claimed = await db.transaction(tx => tx(`WITH next AS (
    SELECT lead_id FROM meta_lead_events WHERE status='PENDING' AND available_at<=NOW()
    ORDER BY available_at,lead_id LIMIT 1 FOR UPDATE SKIP LOCKED
  )
  UPDATE meta_lead_events e SET attempts=LEAST(e.attempts+1,5),available_at=NOW()+INTERVAL '2 minutes',
    status=CASE WHEN e.attempts>=5 THEN 'FAILED' ELSE 'PENDING' END
  FROM next,meta_lead_sources s WHERE e.lead_id=next.lead_id AND s.form_id=e.form_id
  RETURNING e.*,s.page_id`));
  const event = claimed.rows[0];
  if (!event || event.status==='FAILED') return;
  try {
    await ingest(event.page_id,{
      page_id:event.page_id,form_id:event.form_id,leadgen_id:event.lead_id
    },event.generation);
    await db.query("UPDATE meta_lead_events SET status='DONE' WHERE lead_id=$1 AND attempts=$2 AND status='PENDING'",[event.lead_id,event.attempts]);
  } catch (error) {
    const permanent = ['CONNECTION_REVOKED','META_LEAD_RESPONSE_MISMATCH','LEAD_CONTACT_REQUIRED'].includes(error.message);
    await db.query(`UPDATE meta_lead_events SET status=CASE WHEN attempts>=5 OR $3 THEN 'FAILED' ELSE 'PENDING' END,
      available_at=NOW()+attempts*INTERVAL '30 seconds' WHERE lead_id=$1 AND attempts=$2 AND status='PENDING'`,[event.lead_id,event.attempts,permanent]);
  }
}

// After SCORPIO creates a lead form (approved CREATE_LEAD_FORM), its leads flow in by themselves.
async function registerCreatedForm(clientId, pageId, formId) {
  if (!enabled()) return { registered: false, reason: 'DISABLED' };
  try {
    await meta.context.run(String(clientId), () => connect(clientId, pageId, formId));
    return { registered: true };
  } catch (error) {
    const reason = /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'REGISTER_FAILED';
    logger.warn('Lead form not connected for import', { reason });
    return { registered: false, reason };
  }
}

// For the connections screen: queued / failed Lead Ads imports.
async function status(clientId) {
  const r = (await db.query(`SELECT e.status,COUNT(*)::int AS n,MAX(e.available_at) AS last FROM meta_lead_events e
    JOIN meta_lead_sources s ON s.form_id=e.form_id WHERE s.client_id=$1 GROUP BY e.status`, [clientId])).rows;
  const by = Object.fromEntries(r.map(x => [x.status, x.n]));
  const forms = (await db.query('SELECT COUNT(*)::int AS n FROM meta_lead_sources WHERE client_id=$1', [clientId])).rows[0].n;
  return { enabled: enabled(), forms, imported: by.DONE || 0, pending: by.PENDING || 0, failed: by.FAILED || 0 };
}

module.exports = { enabled, connect, enqueue, runOne, ingest, registerCreatedForm, subscribePage, pageSubscribed, sourceDetail, status, LEAD_FIELDS };
