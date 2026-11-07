'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),axios=require('axios');
const {openDatabase}=require('./helpers/database');
test('WhatsApp production release: 20 acceptance scenarios with isolated tenant data',async t=>{
 const env={...process.env},get=axios.get;
 Object.assign(process.env,{APP_PUBLIC_URL:'https://test.example',META_LOGIN_CONFIG_ID:'456',META_APP_ID:'123',META_APP_SECRET:'test',META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),META_TOKEN_KEY_ID:'primary',READ_ONLY:'true',META_WRITES_ENABLED:'false',MARKETING_DISCOVERY_ENABLED:'true'});
 const h=await openDatabase(),meta=require('../metaConnection'),store=require('../marketingStore'),ui=require('../conversationUi'),reads=require('../readConversation'),period=require('../reportPeriod');
 const a=await require('../clientStore').getOrCreateClient('972500009911'),b=await require('../clientStore').getOrCreateClient('972500009922');
 let insightParams;
 const accounts=Array.from({length:21},(_,i)=>({id:'act_'+(101+i),name:i===12?'אריה נכסים':'עסק '+(i+1),account_status:1,currency:'ILS'}));
 axios.get=async(url,options)=>{
  if(url.endsWith('/me/permissions'))return{data:{data:[{permission:'ads_read',status:'granted'}]}};
  if(url.endsWith('/me/adaccounts'))return{data:{data:accounts}};
  if(url.endsWith('/insights')){insightParams=options.params;return{data:{data:[{campaign_id:'1',campaign_name:'קמפיין',spend:'123.45',impressions:'1000',clicks:'10',actions:[]}]}};}
  const account=accounts.find(a=>url.endsWith('/'+a.id));if(account)return{data:account};
  throw Error('UNEXPECTED_READ');
 };
 await h.db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,'99',$2,'123',NOW()+INTERVAL '1 hour')",[a.id,meta.encrypt('test-token',a.id)]);
 const click=id=>({interactive:{type:'list_reply',list_reply:{id,title:'ignored'}}});
 const rows=result=>result.interactivePayload.interactive.action.sections?.[0]?.rows||result.interactivePayload.interactive.action.buttons.map(x=>x.reply);
 try{
  await t.test('01 capabilities in natural Hebrew are recognized',()=>{assert.equal(require('../conversationAnalysis').localAnalysis('שלום, מה אתה יודע לעשות?').intent,'capabilities');});
  await t.test('02 conversation facts and short affirmative keep the same tenant context',async()=>{await store.update(a.id,null,p=>{require('../conversationFacts').write(p,'businessName','עסק בדיקה');return{handled:false,changed:true};});assert.equal(require('../conversationFacts').value(await store.load(a.id),'businessName'),'עסק בדיקה');assert.equal(require('../conversationAnalysis').localAnalysis('כן').intent,'yes');});
  await t.test('03 negative short reply is recognized without advertising approval',()=>{assert.equal(require('../conversationAnalysis').localAnalysis('לא').intent,'no');});
  await t.test('04 native audioTranscription words become Hebrew transcript',()=>{assert.equal(require('../voiceHandler').extractTranscript({candidates:[{finishReason:'STOP',content:{parts:[{audioTranscription:{words:[{word:'תעבור'},{word:'לחשבון'},{word:'אריה נכסים'}]}}]}}]}),'תעבור לחשבון אריה נכסים');});
  await t.test('05 standard text and segmented transcripts remain supported',()=>{assert.equal(require('../voiceHandler').extractTranscript({candidates:[{content:{parts:[{text:'שלום'},{audioTranscription:{text:'עולם'}}]}}]}),'שלום עולם');});
  await t.test('06 empty or truncated speech cannot execute a request',()=>{assert.throws(()=>require('../voiceHandler').extractTranscript({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'אשר'}]}}]}));assert.throws(()=>require('../voiceHandler').extractTranscript({text:''}));});
  await t.test('07 account list is paginated within ten WhatsApp rows',async()=>{const r=await reads.handle(a.id,'החשבונות שלי');const payload=await ui.prepare(a.id,r.reply,r.decisionKey);assert.equal(rows(payload).length,9);assert.ok(rows(payload).some(r=>r.title==='חשבונות נוספים'));});
  await t.test('08 second page button stays valid and maps to server data',async()=>{const r=await reads.handle(a.id,'/meta-page 1');const menu=await ui.prepare(a.id,r.reply,r.decisionKey);assert.equal(rows(menu).length,10);const entry=rows(menu).find(r=>r.title.includes('אריה'));assert.ok(entry);assert.equal(await ui.consume(a.id,click(entry.id)),'/meta-select act_113');});
  await t.test('09 final page is accessible beyond first twenty accounts',async()=>{const r=await reads.handle(a.id,'/meta-page 2');const menu=await ui.prepare(a.id,r.reply,r.decisionKey);assert.equal(rows(menu).length,6);assert.equal(await ui.consume(a.id,click(rows(menu)[4].id)),'/meta-select act_121');});
  await t.test('10 named account switch verifies access and persists the account',async()=>{const r=await reads.handle(a.id,'תעבור לחשבון אריה נכסים.');assert.match(r.reply,/אריה נכסים/);assert.equal((await meta.credentials(a.id)).meta_ad_account_id,'act_113');});
  await t.test('11 unknown account never replaces the selected authorized account',async()=>{const r=await reads.handle(a.id,'תעבור לחשבון חשבון לא קיים');assert.match(r.reply,/לא נמצאו/);assert.equal((await meta.credentials(a.id)).meta_ad_account_id,'act_113');});
  await t.test('12 search filters only accounts returned by Meta',async()=>{await reads.handle(a.id,'חפש חשבון אריה');const p=await store.load(a.id);assert.equal(require('../accountMenu').page(p.connection).total,1);});
  await t.test('13 last-year spend uses a real time_range and selected tenant account',async()=>{const r=await meta.context.run(String(a.id),()=>reads.handle(a.id,'כמה הוצאתי על פרסום בשנה האחרונה?'));assert.match(r.reply,/123.45/);assert.ok(insightParams.time_range);assert.equal(insightParams.date_preset,undefined);const p=JSON.parse(insightParams.time_range);assert.equal((Date.parse(p.until)-Date.parse(p.since))/86400000,364);});
  await t.test('14 explicit requested dates survive unchanged to Meta',async()=>{await meta.context.run(String(a.id),()=>reads.handle(a.id,'דוח ביצועים 2026-01-01 עד 2026-02-28'));assert.deepEqual(JSON.parse(insightParams.time_range),{since:'2026-01-01',until:'2026-02-28'});});
  await t.test('15 calendar previous year differs from rolling year',()=>{assert.equal(period.parse('כמה הוצאתי בשנה שעברה'),'last_year');assert.deepEqual(period.validate('last_year'),{date_preset:'last_year'});});
  await t.test('16 ambiguous or invalid periods ask for clarification',async()=>{assert.match((await reads.handle(a.id,'כמה הוצאתי על פרסום?')).reply,/לאיזו תקופה/);assert.match((await reads.handle(a.id,'דוח ביצועים 2026-02-30 עד 2026-03-01')).reply,/לא תקין/);});
  await t.test('17 cross-tenant buttons and consumed replays are rejected',async()=>{const r=await reads.handle(a.id,'החשבונות שלי');const m=await ui.prepare(a.id,r.reply,r.decisionKey),id=rows(m)[0].id;assert.equal(await ui.consume(b.id,click(id)),null);assert.equal(await ui.consume(a.id,click(id)),'/meta-select act_101');assert.equal(await ui.consume(a.id,click(id)),null);});
  await t.test('18 expired menu refreshes controls without executing stale choice',async()=>{const r=await reads.handle(a.id,'החשבונות שלי');const m=await ui.prepare(a.id,r.reply,r.decisionKey),id=rows(m)[0].id;await store.update(a.id,null,p=>{p.ui.expiresAt=0;return{handled:false,changed:true};});assert.equal(await ui.consume(a.id,click(id)),null);const fresh=await ui.refresh(a.id);assert.ok(fresh.interactivePayload);assert.notEqual(rows(fresh)[0].id,id);});
  await t.test('19 generic waiting messages are suppressed even with an inbound context',async()=>{const wa=require('../whatsapp'),before=wa.safeSend;let count=0;wa.safeSend=async()=>count++;try{await require('../whatsappDelivery').messageContext.run({eventId:'notice'},()=>require('../processingNotice').notifyProcessing(a.phone));assert.equal(count,0);}finally{wa.safeSend=before;}});
  await t.test('20 read-only guards remain enabled and no ad approval was created',async()=>{assert.equal(process.env.READ_ONLY,'true');assert.equal(process.env.META_WRITES_ENABLED,'false');assert.equal((await h.db.query('SELECT count(*)::int AS n FROM approvals')).rows[0].n,0);assert.equal((await h.db.query('SELECT count(*)::int AS n FROM meta_execution_attempts')).rows[0].n,0);});
 }finally{axios.get=get;await h.close();for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);}
});
