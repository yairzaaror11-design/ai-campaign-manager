'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const axios = require('axios');
const db = require('../db');
const meta = require('../metaConnection');
const {verifySignedRequest,deleteClient} = require('../metaDeletion');

test('tenant OAuth lifecycle: real PostgreSQL semantics, encryption, state, isolation, disconnect and deletion', async()=>{
  process.env.META_TOKEN_ENCRYPTION_KEY=crypto.randomBytes(32).toString('base64');
  process.env.APP_PUBLIC_URL='https://campaign.example';
  process.env.META_APP_ID='123'; process.env.META_APP_SECRET='test-secret'; process.env.META_LOGIN_CONFIG_ID='456';
  const pg = new PGlite();
  // initializeDatabase uses its private query binding; capture the schema through the pool boundary.
  const {Pool} = require('pg');
  const originalPoolQuery=Pool.prototype.query;
  const originalQuery=db.query, originalTransaction=db.transaction;
  const originalGet=axios.get, originalPost=axios.post;
  process.env.DATABASE_URL='postgresql://unused';
  Pool.prototype.query=async function(sql,params){return params?.length ? pg.query(sql,params) : (await pg.exec(sql)).at(-1);};
  db.query=(sql,params=[])=>pg.query(sql,params);
  db.transaction=async work=>{await pg.exec('BEGIN');try {const result=await work(db.query);await pg.exec('COMMIT');return result;}catch(e){await pg.exec('ROLLBACK');throw e;}};
  try {
    await db.initializeDatabase();
    const a=(await db.query("INSERT INTO clients(phone) VALUES('111') RETURNING id")).rows[0].id;
    const b=(await db.query("INSERT INTO clients(phone) VALUES('222') RETURNING id")).rows[0].id;
    const encrypted=meta.encrypt('secret',a);
    assert.equal(meta.decrypt(encrypted,a),'secret');
    assert.throws(()=>meta.decrypt(encrypted,b));
    const invite=(await meta.createInvite(a)).split('#')[1];
    const login=await meta.begin(invite);
    await assert.rejects(meta.begin(invite),/INVALID_LOGIN/);
    const state=new URL(login.url).searchParams.get('state');
    await assert.rejects(meta.callback(state,'wrong','code'),/INVALID_LOGIN/);
    axios.post=async()=>({data:{access_token:'tenant-token',expires_in:3600}});
    axios.get=async(url,options)=>{
      assert.equal(options.headers.Authorization,'Bearer tenant-token');
      assert.ok(options.params.appsecret_proof);
      if(url.endsWith('/me/permissions')) return {data:{data:[{permission:'ads_read',status:'granted'}]}};
      if(url.endsWith('/me/adaccounts')) return {data:{data:[{id:'act_11',account_status:1}]}};
      if(url.endsWith('/999')) return {data:{account_id:'22'}};
      if(url.endsWith('/888')) return {data:{account_id:'11'}};
      return {data:{id:'1234',data:[]}};
    };
    await meta.callback(state,login.browser,'code');
    await assert.rejects(meta.callback(state,login.browser,'code'),/INVALID_LOGIN/);
    assert.equal((await meta.credentials(a)).token,'tenant-token');
    await assert.rejects(meta.credentials(b),/META_CONNECTION_REQUIRED/);
    await assert.rejects(meta.selectAccount(a,'act_22'),/ACCOUNT_NOT_GRANTED/);
    await meta.selectAccount(a,'act_11');
    await meta.context.run(String(a),async()=>{
      await assert.rejects(meta.tenantRead('/act_22/campaigns',{}),/TENANT_ACCOUNT_MISMATCH/);
      await assert.rejects(meta.tenantRead('/999/insights',{}),/TENANT_ACCOUNT_MISMATCH/);
      await meta.tenantRead('/888/insights',{});
      await assert.rejects(require('../metaWrite').createCampaign({target:{accountId:'act_11'},parameters:{name:'Test',objective:'OUTCOME_TRAFFIC'}}),/TENANT_WRITES_DISABLED/);
    });
    const {handleBriefMessage} = require('../briefConversation');
    process.env.MOCK_META_ENABLED='false';
    await handleBriefMessage('111','/brief TRAFFIC 25');
    for (const [field,value] of Object.entries({businessName:'Test business',product:'Service',audience:'Adults',geography:'Tel Aviv',websiteUrl:'https://example.com'})) {
      await handleBriefMessage('111','/brief-set '+field+' '+value);
    }
    await handleBriefMessage('111','/brief-review');
    const brief=(await db.query('SELECT payload FROM campaign_briefs WHERE client_id=$1',[a])).rows[0].payload;
    const approved=await handleBriefMessage('111','/brief-approve '+brief.revision);
    assert.match(approved.reply,/נשמרה טיוטה מקומית/);
    const drafts=(await db.query('SELECT * FROM campaign_local_drafts WHERE client_id=$1',[a])).rows;
    assert.equal(drafts.length,1);
    assert.equal(drafts[0].ad_account_id,'act_11');
    assert.equal(drafts[0].payload.status,'LOCAL_DRAFT');
    assert.equal((await db.query('SELECT * FROM campaign_local_drafts WHERE client_id=$1',[b])).rows.length,0);
    // A callback already exchanging its code must not recreate a disconnected connection.
    const late=await meta.begin((await meta.createInvite(a)).split('#')[1]);
    let release, started;
    const entered=new Promise(r=>{started=r;});
    axios.post=async()=>{started();await new Promise(r=>{release=r;});return {data:{access_token:'tenant-token',expires_in:3600}};};
    const pending=meta.callback(new URL(late.url).searchParams.get('state'),late.browser,'late');
    await entered; await meta.disconnect(a); release();
    await assert.rejects(pending,/CONNECTION_REVOKED/);
    await assert.rejects(meta.credentials(a),/META_CONNECTION_REQUIRED/);
    const payload=Buffer.from(JSON.stringify({algorithm:'HMAC-SHA256',user_id:'1234',issued_at:Math.floor(Date.now()/1000)})).toString('base64url');
    const signature=crypto.createHmac('sha256','test-secret').update(payload).digest('base64url');
    assert.equal(verifySignedRequest(signature+'.'+payload).user_id,'1234');
    assert.throws(()=>verifySignedRequest('bad.'+payload));
    await db.transaction(tx=>deleteClient(a,tx));
    assert.equal((await db.query('SELECT id FROM clients WHERE id=$1',[a])).rows.length,0);
    assert.equal((await db.query('SELECT id FROM clients WHERE id=$1',[b])).rows.length,1);
  } finally {
    axios.get=originalGet;axios.post=originalPost;
    Pool.prototype.query=originalPoolQuery;db.query=originalQuery;db.transaction=originalTransaction;
    await db.closeDatabase();await pg.close();
  }
});
