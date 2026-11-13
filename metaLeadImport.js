'use strict';
const db = require('./db');
const meta = require('./metaConnection');
const forms = require('./metaLeadForms');
const crm = require('./crmService');

function enabled() {
  return process.env.META_LEAD_IMPORT_ENABLED === 'true';
}

async function connect(clientId, pageId, formId) {
  const { access } = await forms.inspect(clientId, pageId, formId);
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
  const lead = await meta.graph('/'+value.leadgen_id,access.token,{fields:'id,form_id,campaign_id,field_data'});
  if (lead.id !== value.leadgen_id || lead.form_id !== value.form_id || !Array.isArray(lead.field_data)) {
    throw Error('META_LEAD_RESPONSE_MISMATCH');
  }
  const field = name => {
    const value = lead.field_data.find(field => field?.name === name)?.values?.[0];
    return typeof value === 'string' ? value.trim() : '';
  };
  const phone = field('phone_number');
  const email = field('email');
  const saved = await crm.create(clientId,{
    name: field('full_name').slice(0,120) || 'ליד מ־Meta',
    phone: /^\+?[\d ()-]{7,30}$/.test(phone) ? phone : null,
    email: email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    campaignId: /^\d{1,40}$/.test(lead.campaign_id || '') ? String(lead.campaign_id) : null,
    source:'meta_lead_ads',
    sourceEventId:value.leadgen_id
  }, async tx => {
    const current = await tx(`SELECT 1 FROM meta_lead_sources s JOIN clients c ON c.id=s.client_id
      WHERE s.form_id=$1 AND s.page_id=$2 AND s.client_id=$3 AND s.app_id=$4
      AND s.meta_generation=$5 AND c.meta_generation=$5 FOR SHARE OF s`,
      [value.form_id,pageId,clientId,process.env.META_APP_ID,generation]);
    return current.rows.length > 0;
  });
  if (saved.revoked) throw Error('CONNECTION_REVOKED');
}

async function enqueue(body) {
  await db.transaction(async tx => {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value;
        if (change.field !== 'leadgen' || !v || v.page_id !== entry.id ||
            ![entry.id,v.form_id,v.leadgen_id].every(id => typeof id === 'string' && /^\d{1,40}$/.test(id))) continue;
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

module.exports = { enabled, connect, enqueue, runOne };
