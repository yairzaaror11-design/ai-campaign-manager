'use strict';
// After Meta OAuth the agent continues the WhatsApp conversation by itself (F4).
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),axios=require('axios');
const {openDatabase}=require('./helpers/database');

test('Meta connection continues in WhatsApp: account buttons, auto-select, saved draft, no-account guide',async t=>{
 const previous={...process.env},h=await openDatabase(),get=axios.get;
 Object.assign(process.env,{META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),META_APP_ID:'123',META_APP_SECRET:'test-secret',META_LOGIN_CONFIG_ID:'456',APP_PUBLIC_URL:'https://campaign.example',META_WRITES_ENABLED:'false',READ_ONLY:'true'});
 const meta=require('../metaConnection'),guided=require('../metaConversation'),store=require('../marketingStore'),ui=require('../conversationUi');
 let accounts=[];
 axios.get=async url=>{
  if(url.endsWith('/me/permissions'))return{data:{data:[{permission:'ads_read',status:'granted'}]}};
  if(url.endsWith('/me/adaccounts'))return{data:{data:accounts}};
  return{data:{id:'person'}};
 };
 const client=async phone=>{
  const c=await require('../clientStore').getOrCreateClient(phone);
  await h.db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,expires_at,app_id) VALUES($1,'person',$2,NOW()+INTERVAL '1 hour','123')",[c.id,meta.encrypt('tenant-test-token',c.id)]);
  return c;
 };
 const outbox=async id=>(await h.db.query('SELECT payload FROM whatsapp_outbox WHERE client_id=$1 ORDER BY delivery_order',[id])).rows.map(r=>r.payload);
 const bodyOf=p=>p.type==='text'?p.text.body:p.interactive.body.text;
 const titles=p=>p.type!=='interactive'?[]:p.interactive.type==='button'?p.interactive.action.buttons.map(b=>b.reply.title):p.interactive.action.sections[0].rows.map(r=>r.title);
 try{
  await t.test('one ad account is selected automatically and the saved plan continues with a button',async()=>{
   accounts=[{id:'act_5550001',name:'נדל״ן כהן',account_status:1,currency:'ILS'}];
   const c=await client('972500000781');
   await store.update(c.id,null,p=>{p.journey={...(p.journey||{}),stage:'PLAN_REVIEW'};return{handled:false,changed:true};});
   const r=await guided.notifyConnected(c.id,await guided.verify(c.id));
   assert.equal(r.sent,true);assert.equal(r.verified.status,'CONNECTED');
   const sent=await outbox(c.id);assert.equal(sent.length,1);
   assert.match(bodyOf(sent[0]),/החיבור ל־Meta הושלם ✓/);assert.match(bodyOf(sent[0]),/נדל״ן כהן/);assert.match(bodyOf(sent[0]),/התוכנית שלך שמורה/);
   assert.deepEqual(titles(sent[0]),['המשך ליצירת הקמפיין','לא עכשיו']);
   assert.doesNotMatch(JSON.stringify(sent),/act_|ads_read|READ_ONLY|טוקן/);
   // Tapping the button continues the saved plan (the selected text is the launch command).
   const profile=await store.load(c.id),id=sent[0].interactive.action.buttons[0].reply.id;
   assert.equal(await ui.consume(c.id,{type:'interactive',interactive:{type:'button_reply',button_reply:{id}}}),'המשך ליצירת הקמפיין');
   assert.equal(profile.ui.decisionKey,'meta_continue');
   assert.ok(require('../conversationController').acceptsInteractive(profile));
  });
  await t.test('several accounts arrive as buttons with names that can be told apart, never raw ids',async()=>{
   accounts=[{id:'act_7770001',name:'סוכנות נדל״ן הצפון בע״מ',account_status:1},{id:'act_7770002',name:'סוכנות נדל״ן הצפון בע״מ',account_status:1},{id:'act_7770003',name:'משרד ראשי',account_status:1},{id:'act_7770004',name:'קמפיינים 2026',account_status:1}];
   const c=await client('972500000782');
   const r=await guided.notifyConnected(c.id,await guided.verify(c.id));
   assert.equal(r.verified.status,'ACCOUNT_SELECTION_REQUIRED');
   const [msg]=await outbox(c.id);
   assert.equal(msg.interactive.type,'list');
   assert.match(bodyOf(msg),/סוכנות נדל״ן הצפון בע״מ \(מסתיים ב־0001\)/);assert.match(bodyOf(msg),/\(מסתיים ב־0002\)/);
   const rows=msg.interactive.action.sections[0].rows;
   assert.match(rows[0].title,/^1\. סוכנות נדל״ן ה.*…$/);
   assert.match(rows[0].description,/מספר חשבון שמסתיים ב־0001/);assert.match(rows[1].description,/0002/);
   assert.doesNotMatch(JSON.stringify(msg),/act_/);
   // Picking a row selects that exact account.
   assert.equal(await ui.consume(c.id,{type:'interactive',interactive:{type:'list_reply',list_reply:{id:rows[1].id}}}),'/meta-select act_7770002');
  });
  await t.test('no ad account: a short Hebrew guide with the official link and a "סיימתי" re-check',async()=>{
   accounts=[];
   const c=await client('972500000783');
   await guided.notifyConnected(c.id,await guided.verify(c.id));
   const all=(await outbox(c.id)).map(bodyOf).join('\n');
   assert.match(all,/business\.facebook\.com\/settings\/ad-accounts/);
   assert.match(all,/1\. .*\n2\. .*\n3\. .*\n4\. .*\n5\. /);
   const buttons=(await outbox(c.id)).flatMap(titles);
   assert.deepEqual(buttons,['סיימתי','חיבור מחדש']);
   const last=(await outbox(c.id)).at(-1),id=last.interactive.action.buttons[0].reply.id;
   const selected=await ui.consume(c.id,{type:'interactive',interactive:{type:'button_reply',button_reply:{id}}});
   assert.equal(selected,guided.RECHECK_TEXT);
   // The owner opened an account: "סיימתי" re-checks and continues with it.
   accounts=[{id:'act_8880001',name:'העסק של דני',account_status:1}];
   const analysis=require('../conversationAnalysis').localAnalysis(selected);
   assert.equal(analysis.intent,'connection_status');
   const r=await guided.handle(c.id,selected,analysis,'recheck-1');
   assert.match(r.reply,/העסק של דני/);
  });
  await t.test('"no ad account yet" in the intro also gets the guide with buttons',async()=>{
   const c=await require('../clientStore').getOrCreateClient('972500000784');
   const manager=require('../marketingConversation');
   await manager.handleMarketingMessage(c.id,'אני רוצה להתחיל לפרסם בפייסבוק','mc-intro');
   const r=await manager.handleMarketingMessage(c.id,'לא','mc-no');
   assert.match(r.reply,/business\.facebook\.com/);assert.equal(r.decisionKey,'no_ad_account');
   const prepared=await ui.prepare(c.id,r.reply,r.decisionKey);
   assert.deepEqual(titles(prepared.interactivePayload),['סיימתי','נכין טיוטה בינתיים']);
  });
  await t.test('callback page sends the owner back to WhatsApp with a wa.me link',async()=>{
   const page=require('../metaConnectPage');
   process.env.WHATSAPP_DISPLAY_NUMBER='+972 50-000-0799';
   const html=page.page({state:'done',nonce:'n'});
   assert.match(html,/חזור לוואטסאפ/);assert.match(html,/href="https:\/\/wa\.me\/972500000799"/);
   assert.doesNotMatch(html,/המשך ליצירת הקמפיין/);
   delete process.env.WHATSAPP_DISPLAY_NUMBER;
   assert.match(page.page({state:'done',nonce:'n'}),/href="whatsapp:\/\/"/);
  });
 }finally{axios.get=get;for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);await h.close();}
});
