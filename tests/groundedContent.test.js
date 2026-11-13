'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const facts=require('../conversationFacts'),journey=require('../campaignJourney'),social=require('../socialContent'),policy=require('../offerPolicy'),store=require('../marketingStore');
function ready(){const p=store.emptyProfile();journey.init(p);for(const [k,v]of Object.entries({businessName:'פרחי דנה',businessType:'חנות פרחים',product:'זרי פרחים',businessGoal:'פניות',dailyBudget:{amount:100,currency:'ILS',period:'day'},audience:'מחפשי מתנות',geography:'חיפה',leadDestination:'WhatsApp',offer:'14 יום ניהול במתנה',offerMediaSeparate:true,offerScope:'ניהול הקמפיין',offerCommitment:'ללא התחייבות'}))facts.write(p,k,v);return p;}
function authorize(p,channel){p.journey.requestedOutput=channel==='social'?'social':'ad';const q=journey.transition(p,'תשתמש בהצעה');assert.equal(q.decisionKey,'offer_use');return journey.transition(p,'ההצעה בתוקף לתוכן הזה');}
test('historical offer never silently becomes new paid or informational social copy',()=>{
 const p=ready();const paid=journey.transition(p,'תכין מודעה');assert.doesNotMatch(paid.reply,/14 יום|במתנה/);assert.equal(p.offerReview,undefined);
 const organic=journey.transition(p,'תוכן לסושיאל');assert.doesNotMatch(organic.reply,/14 יום|במתנה/);assert.equal(p.socialContent.brief.purpose,'EXPLAIN_SERVICE');assert.equal(policy.allowed(p,'social'),false);
});
test('offer confirmation is bound to channel, product, terms, purpose and freshness',()=>{
 const p=ready();const paid=authorize(p,'paid');assert.match(paid.reply,/14 יום/);assert.match(paid.reply,/ללא התחייבות/);assert.equal(policy.allowed(p,'paid'),true);assert.equal(policy.allowed(p,'social'),false);
 const organic=social.prepare(p);assert.doesNotMatch(organic.reply,/14 יום|במתנה/);
 const promo=authorize(p,'social');assert.match(promo.reply,/14 יום/);assert.match(promo.reply,/תקציב המדיה משולם בנפרד/);assert.equal(p.socialContent.brief.purpose,'PROMOTION');
 p.contentBrief={purpose:'BUSINESS_UPDATE',subject:'נפתח אצלנו שירות חדש'};assert.equal(policy.allowed(p,'social'),false);
 facts.write(p,'product','עציצים');assert.equal(policy.allowed(p,'paid'),false);
 facts.write(p,'product','זרי פרחים');p.offerSelections.paid.confirmedAt=Date.now()-86400001;assert.equal(policy.allowed(p,'paid'),false);
});
test('changed or expired offer review requires a fresh review instead of accepting stale yes',()=>{
 const p=ready();p.journey.requestedOutput='ad';journey.transition(p,'תשתמש בהצעה');const hash=p.offerReview.hash;facts.write(p,'offerScope','בדיקת מודעות בלבד');
 const changed=journey.transition(p,'כן');assert.equal(changed.decisionKey,'offer_use');assert.notEqual(p.offerReview.hash,hash);assert.equal(policy.allowed(p,'paid'),false);
 p.offerReview.expiresAt=0;assert.equal(journey.transition(p,'כן').decisionKey,'offer_use');assert.equal(policy.allowed(p,'paid'),false);
 journey.transition(p,'מה הכוונה?');assert.equal(journey.transition(p,'כן').handled,false);assert.equal(policy.allowed(p,'paid'),false);
 journey.transition(p,'נמשיך בלי ההצעה');assert.equal(p.offerReview,undefined);assert.equal(policy.allowed(p,'paid'),false);
});
test('legacy cached promotions are stale and new output excludes them',()=>{
 const p=ready();p.journey.stage='CREATIVE_REVIEW';p.journey.requestedOutput='ad';p.journey.draft={revision:p.journey.revision,creatives:[{body:'14 יום ניהול במתנה'}],stale:false};
 p.socialContent={items:[{body:'14 יום ניהול במתנה'}],stale:false};
 const reply=journey.transition(p,'היי');assert.doesNotMatch(reply.reply,/14 יום/);assert.equal(p.socialContent.stale,true);
});
test('negation and correction keep the intended channel and cannot confirm an ad action',async()=>{
 const p=ready();const unclear=journey.transition(p,'לא אני רוצה תוכן לסושיאל כרגע');assert.equal(unclear.decisionKey,'social_intent');assert.equal(p.socialContent,undefined);
 const paid=journey.transition(p,'לא רוצה פוסט, אני רוצה קמפיין');assert.equal(p.journey.requestedOutput,'plan');assert.equal(p.journey.stage,'PLAN_REVIEW');assert.equal(p.socialContent,undefined);assert.match(paid.reply,/מודעה 1/);
 const s=journey.transition(p,'לא רוצה קמפיין אלא תוכן לסושיאל');assert.equal(s.decisionKey,'social_review');assert.equal(p.journey.planApproved,false);
 const a=await require('../conversationAnalysis').analyze('אני לא רוצה קמפיין',p,{interpreter:async()=>{throw Error('must not need provider');}});assert.equal(a.updates.length,0);assert.equal(a.intent,'other');
});
test('a business-specific recommendation asks for one actual update and turns it into the draft',async()=>{
 const p=ready();const first=journey.transition(p,'מעניין אותי עדכונים ודברים שקשורים בעסק');assert.match(first.reply,/זרי פרחים/);assert.equal((first.reply.match(/\?/g)||[]).length,1);assert.equal(p.socialContent,undefined);assert.equal(p.socialInput.kind,'UPDATE');
 const actual='פתחנו אפשרות לאיסוף זרי פרחים גם בשישי';const draft=journey.transition(p,actual);assert.match(draft.reply,/גם בשישי/);assert.equal(p.socialContent.brief.purpose,'BUSINESS_UPDATE');assert.equal(p.socialInput,undefined);assert.doesNotMatch(draft.reply,/14 יום|במתנה|בונים אמון/);
 let input;await social.enrich(p,draft,{writer:async x=>{input=x;return{creatives:[{headline:'איסוף גם בשישי',body:actual,cta:'לפרטים כתבו לנו'},{headline:'עדכון קטן',body:actual,cta:'רוצים לדעת עוד?'}]};}});assert.equal(input.contentBrief.subject,actual);assert.equal(input.facts.offer,undefined);assert.equal(input.facts.dailyBudget,undefined);
});
test('service explanation, inquiry and work requests have different purposes and next steps',()=>{
 const p=ready();journey.transition(p,'תכין פוסט שמסביר על השירות');assert.equal(p.socialContent.brief.purpose,'EXPLAIN_SERVICE');journey.transition(p,'תכין פוסט שיביא פניות');assert.equal(p.socialContent.brief.purpose,'INQUIRY');
 const work=journey.transition(p,'נציג עבודה');assert.match(work.reply,/אפשר לשלוח תמונה/);assert.equal(p.socialInput.kind,'PHOTO');assert.equal(p.contentBrief.purpose,'SHOW_WORK');
 const calendar=social.calendar(p);assert.doesNotMatch(calendar.reply,/יום 1|יום 3|יום 5/);assert.match(calendar.reply,/הזמינות והחומרים/);
});
test('provider cannot reintroduce a free offer or turn advertising budget into a product price',async()=>{
 const p=ready();const result=social.prepare(p);const before=JSON.stringify(p.socialContent.items);
 const bad={creatives:[{headline:'זר במתנה',body:'זרי פרחים במתנה',cta:'כתבו לנו'},{headline:'מתנה נוספת',body:'זרי פרחים חינם',cta:'כתבו לנו'}]};
 await social.enrich(p,result,{writer:async()=>bad});assert.equal(JSON.stringify(p.socialContent.items),before);assert.equal(p.socialContent.copySource,undefined);
 assert.throws(()=>require('../creativeGeneration').validate({creatives:[{headline:'מחיר הזר',body:'100 ₪ לזר',cta:'כתבו לנו'},{headline:'מחיר הזר הנוסף',body:'100 ₪ לזר',cta:'כתבו לנו'}]},JSON.stringify(policy.copyFacts(p,'paid'))),/UNSUPPORTED_CREATIVE_NUMBER/);
});
test('WhatsApp media follows the promised draft, and offer consent never becomes campaign consent',async()=>{
 const h=await require('./helpers/database').openDatabase(),env={...process.env};
 const wa=require('../whatsapp'),media=require('../mediaHandler'),ai=require('../aiService');
 const old={send:wa.safeSend,receive:media.receiveWhatsAppMedia,process:ai.processMessage,analyze:ai.analyzeConversation};const sent=[];
 Object.assign(process.env,{AUTHORIZED_PHONE_NUMBERS:'972501001091',BUSINESS_LINK_ONBOARDING_ENABLED:'true',MARKETING_DISCOVERY_ENABLED:'true',WHATSAPP_SEND_ENABLED:'false',APP_PUBLIC_URL:'https://scorpio.example'});
 wa.safeSend=async(to,text,ui)=>sent.push({to,text,ui});
 media.receiveWhatsAppMedia=async()=>({type:'image',mediaId:'test-picture',mimeType:'image/png',caption:'סידור פרחים שהכנו לאירוע משפחתי',buffer:Buffer.from('test'),fileSize:4});
 ai.analyzeConversation=async text=>require('../conversationAnalysis').localAnalysis(text);
 ai.processMessage=async input=>{const data=JSON.parse(input);assert.equal(data.contentBrief.purpose,'SHOW_WORK');assert.equal(data.facts.offer,undefined);return{text:JSON.stringify({creatives:[{headline:'פרחים לאירוע משפחתי',body:data.contentBrief.subject,cta:'לפרטים כתבו לנו'},{headline:'מבט על הסידור',body:data.contentBrief.subject,cta:'רוצים לדעת עוד?'}]}),actionPlans:[]};};
 delete require.cache[require.resolve('../messageHandler')];
 try{
  const client=await require('../clientStore').getOrCreateClient('972501001091');
  await store.update(client.id,null,p=>{const f=ready();Object.assign(p,{planId:f.planId,answers:f.answers,journey:f.journey});journey.transition(p,'נציג עבודה');return{handled:true,reply:'נשלח צילום'};});
  await require('../messageHandler').handleIncomingMessage({from:client.phone,id:'promised-media',type:'image',image:{id:'123'},timestamp:String(Math.floor(Date.now()/1000))});
  assert.equal(sent.length,2);assert.equal(sent[0].text,'קיבלתי את התמונה.');assert.match(sent[1].text,/טיוטה לפוסט/);assert.match(sent[1].text,/לאירוע משפחתי/);assert.doesNotMatch(sent[1].text,/מה נעשה עם|14 יום|במתנה/);
  let p=await store.load(client.id);assert.equal(p.socialInput,undefined);assert.equal(p.socialContent.mediaAssetId,p.mediaContext.assetId);
  const workspace=await require('../workspaceService').list(client.id,'content');assert.equal(workspace.items.length,2);
  await store.update(client.id,null,profile=>{profile.journey.requestedOutput='ad';profile.launch={stage:'SETUP',accountId:'act_123'};profile.connection={status:'CONNECTION_OFFERED',pendingQuestion:'hasAdAccount'};const r=journey.transition(profile,'תשתמש בהצעה');assert.equal(r.decisionKey,'offer_use');return r;});
  const result=await require('../marketingConversation').handleMarketingMessage(client.id,'כן','offer-yes');assert.equal(result.handled,true);p=await store.load(client.id);assert.equal(policy.allowed(p,'paid'),true);assert.equal(p.journey.planApproved,false);
  assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM approvals')).rows[0].n,0);assert.equal((await h.db.query('SELECT COUNT(*)::int AS n FROM meta_execution_attempts')).rows[0].n,0);
 }finally{wa.safeSend=old.send;media.receiveWhatsAppMedia=old.receive;ai.processMessage=old.process;ai.analyzeConversation=old.analyze;delete require.cache[require.resolve('../messageHandler')];for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);await h.close();}
});
test('a question about another channel and a general refusal never become a content request or product fact',()=>{
 const p=ready();const question='לא רוצה קמפיין, מה זה פוסט?';assert.equal(social.requested(question),false);assert.equal(journey.transition(p,question).handled,false);assert.equal(p.socialContent,undefined);
 const empty=store.emptyProfile();journey.transition(empty,'אני רוצה קמפיין');const refusal=journey.transition(empty,'אני לא רוצה את זה');assert.equal(refusal.handled,false);assert.equal(facts.value(empty,'product'),null);
});
test('a correction retains facts from the affirmative clause and cancels an obsolete offer question on refusal',()=>{
 const p=ready();const analysis=require('../conversationAnalysis').localAnalysis('לא רוצה פוסט ב-300 שקל ביום, אני רוצה קמפיין ב-150 שקל ביום');assert.equal(analysis.intent,'build');assert.equal(analysis.updates.find(x=>x.field==='dailyBudget').value.amount,150);
 p.journey.requestedOutput='ad';journey.transition(p,'תשתמש בהצעה');assert.ok(p.offerReview);journey.transition(p,'אני לא רוצה קמפיין');assert.equal(p.offerReview,undefined);assert.equal(p.offerIntent,undefined);assert.equal(policy.allowed(p,'paid'),false);
});
