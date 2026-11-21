'use strict';
// Owners never see technical terms; long replies split at natural breaks; weekly report is a button (F12/F13/F18).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {openDatabase}=require('./helpers/database');
const root=path.join(__dirname,'..');
const msg=(from,id,body)=>({from,id,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body}});

test('long messages split at paragraph, then sentence boundaries, never mid-word',()=>{
 const {splitMessage}=require('../whatsapp');
 const para1='משפט ראשון בפסקה. '.repeat(150).trim(),para2='עוד פסקה עם תוכן. '.repeat(150).trim();
 const parts=splitMessage(para1+'\n\n'+para2,3800);
 assert.deepEqual(parts,[para1,para2]);
 const sentences='זה משפט אחד ארוך יחסית. '.repeat(400).trim();
 for(const p of splitMessage(sentences,3800)){assert.ok(p.length<=3800);assert.match(p,/\.$/);}
 assert.equal(splitMessage(sentences,3800).join(' '),sentences);
 assert.deepEqual(splitMessage('קצר'),['קצר']);
 const word='א'.repeat(9000);assert.deepEqual(splitMessage(word).map(p=>p.length),[3800,3800,1400]);
});

test('owner-facing source text has no technical terms',()=>{
 const owner=[
  ['messageHandler.js',/READ_ONLY פעיל|הטוקן|פקודות: \/meta|בקש \/meta-connect|עם \/meta-connect|לחיבור חשבון פרסום: \/meta-connect|ניתן לבטל עם \/notifications-off/],
  ['metaConversation.js',/חסרה הרשאת ads_read/],
  ['businessReport.js',/\/meta-connect/],
  ['actionPlan.js',/קהל דומה 1%/],
  ['buyerAudiences.js',/קהל דומה 1%|Lookalike\) 1%/],
 ];
 for(const [file,re] of owner)assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),re,file);
});

test('currency shows as ₪, not ILS',()=>{
 const brain=require('../marketingBrain');
 const out=brain.format({totals:{spend:120.5,leads:3,purchases:null},account:{currency:'ILS'},recommendations:[]});
 assert.match(out,/120\.50 ₪/);assert.doesNotMatch(out,/ILS/);
 const facts=require('../conversationFacts');
 if(typeof facts.display==='function')assert.doesNotMatch(facts.display({amount:50,currency:'ILS'}),/ILS/);
});

test('ad account names cut to fit a button stay distinguishable',()=>{
 const menu=require('../accountMenu');
 const accounts=[{id:'act_1230001',name:'סוכנות נדל״ן המרכז והשרון'},{id:'act_1230002',name:'סוכנות נדל״ן המרכז והשרון'}];
 assert.equal(menu.shortName(accounts[0].name,16).length,16);assert.match(menu.shortName(accounts[0].name,16),/…$/);
 assert.notEqual(menu.describe(accounts[0],accounts),menu.describe(accounts[1],accounts));
 assert.doesNotMatch(menu.describe(accounts[0],accounts),/act_/);
 const text=menu.reply({accounts});
 assert.match(text,/\(מסתיים ב־0001\)/);assert.match(text,/\(מסתיים ב־0002\)/);
 assert.doesNotMatch(menu.reply({accounts:[{id:'act_9',name:'יחיד'}]}),/מסתיים/);
});

test('weekly report: offered as a button after a report, plain words and the old command both sign up',async()=>{
 const h=await openDatabase(),wa=require('../whatsapp'),transport=wa.transport;
 const before={...process.env};
 Object.assign(process.env,{AUTHORIZED_PHONE_NUMBERS:'972500000791',WHATSAPP_SEND_ENABLED:'true',WEEKLY_REPORTS_ENABLED:'true'});
 delete process.env.WEEKLY_REPORT_TEMPLATE;
 delete require.cache[require.resolve('../messageHandler')];
 try{
  const handle=require('../messageHandler').handleIncomingMessage,phone='972500000791';
  const outbox=async()=>(await h.db.query("SELECT payload FROM whatsapp_outbox o JOIN clients c ON c.id=o.client_id WHERE c.phone=$1 ORDER BY delivery_order",[phone])).rows.map(r=>r.payload);
  await handle(msg(phone,'wamid.wr1','דוח עסקי'),{});
  const sent=await outbox();
  const button=sent.find(p=>p.type==='interactive');
  assert.ok(button,'report is followed by a weekly-report button');
  assert.equal(button.interactive.body.text,require('../weeklyReportOffer').OFFER_TEXT);
  assert.deepEqual(button.interactive.action.buttons.map(b=>b.reply.title),['כן, דוח כל שבוע']);
  assert.doesNotMatch(JSON.stringify(sent),/notifications-on/);
  // Tapping the button signs up.
  await handle({from:phone,id:'wamid.wr2',timestamp:String(Math.floor(Date.now()/1000)),type:'interactive',interactive:{type:'button_reply',button_reply:{id:button.interactive.action.buttons[0].reply.id,title:'כן, דוח כל שבוע'}}},{});
  assert.equal((await h.db.query('SELECT opted_in FROM whatsapp_contacts WHERE phone=$1',[phone])).rows[0].opted_in,true);
  assert.match((await outbox()).at(-1).text.body,/כל יום ראשון בבוקר/);
  // Plain words stop it; the old command still works as an alias.
  await handle(msg(phone,'wamid.wr3','בלי דוח שבועי'),{});
  assert.equal((await h.db.query('SELECT opted_in FROM whatsapp_contacts WHERE phone=$1',[phone])).rows[0].opted_in,false);
  await handle(msg(phone,'wamid.wr4','/notifications-on'),{});
  assert.equal((await h.db.query('SELECT opted_in FROM whatsapp_contacts WHERE phone=$1',[phone])).rows[0].opted_in,true);
  // Already signed up: no more offers.
  const count=(await outbox()).filter(p=>p.type==='interactive').length;
  await handle(msg(phone,'wamid.wr5','דוח עסקי'),{});
  assert.equal((await outbox()).filter(p=>p.type==='interactive').length,count);
 }finally{wa.transport=transport;for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);await h.close();}
});
