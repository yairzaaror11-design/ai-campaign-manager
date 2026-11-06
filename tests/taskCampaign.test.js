'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),axios=require('axios');
const {openDatabase}=require('./helpers/database');
test('bot manager completes a campaign sequence through media lookup, package review, upload, paused creation and separate verified activation',async()=>{
 const env={...process.env},get=axios.get,post=axios.post,h=await openDatabase(),meta=require('../metaConnection'),mediaHandler=require('../mediaHandler'),receive=mediaHandler.receiveWhatsAppMedia;
 Object.assign(process.env,{TASK_AGENT_ENABLED:'true',META_TOKEN_ENCRYPTION_KEY:crypto.randomBytes(32).toString('base64'),APPROVAL_HMAC_KEY:crypto.randomBytes(32).toString('hex'),META_APP_ID:'123',META_APP_SECRET:'secret',META_LOGIN_CONFIG_ID:'456',APP_PUBLIC_URL:'https://campaign.example',META_WRITES_ENABLED:'true',READ_ONLY:'false',OBJECT_STORAGE_ENABLED:'false',GRAPHICS_ENABLED:'true',GEMINI_API_KEY:'fixture',GEMINI_IMAGE_MODEL:'gemini-image-fixture'});
 const c=await require('../clientStore').getOrCreateClient('972500077111');
 await h.db.query("INSERT INTO meta_connections(client_id,meta_user_id,token_ciphertext,app_id,expires_at) VALUES($1,'test-user',$2,'123',NOW()+INTERVAL '1 hour')",[c.id,meta.encrypt('fixture-token',c.id)]);await h.db.query("UPDATE clients SET meta_ad_account_id='act_11' WHERE id=$1",[c.id]);
 const mediaId=await require('../mediaStore').saveMedia(c.id,{mediaId:'fixture-photo',type:'image',mimeType:'image/png',caption:'התמונה שסופקה לקמפיין'});
 mediaHandler.receiveWhatsAppMedia=async()=>({buffer:Buffer.from('fixture image'),mimeType:'image/png'});
 const objects=new Map(),writes=[],reads=[];let nextId=900;
 axios.get=async(url,options)=>{reads.push(url.split('/').at(-1));
  if(url.endsWith('/me/permissions'))return{data:{data:[{permission:'ads_management',status:'granted'}]}};
  if(url.endsWith('/act_11'))return{data:{id:'act_11',name:'Account',currency:'ILS',timezone_name:'Asia/Jerusalem'}};
  if(url.endsWith('/me/accounts'))return{data:{data:[{id:'555'}]}};
  if(url.endsWith('/act_11/adimages'))return{data:{data:[{hash:'verified-image-hash'}]}};
  const id=url.split('/').at(-1);if(objects.has(id))return{data:objects.get(id)};
  throw Error('Unexpected provider read');
 };
 axios.post=async(url,params)=>{
  const body=Object.fromEntries(params),edge=url.split('/').at(-1);writes.push(edge);
  if(edge==='adimages')return{data:{images:{fixture:{hash:'verified-image-hash'}}}};
  if(objects.has(edge)){objects.get(edge).status=body.status;return{data:{success:true}};}
  const id=String(nextId++),row={...body,id,account_id:'11'};
  if(body.creative)row.creative={id:JSON.parse(body.creative).creative_id};
  if(body.object_story_spec)row.object_story_spec=JSON.parse(body.object_story_spec);
  objects.set(id,row);return{data:{id}};
 };
 const planner=async ctx=>{
  const s=id=>ctx.plan.find(x=>x.id===id);
  if(!ctx.plan.length)return{plan:[{id:'media',kind:'read',label:'בחירת התמונה שסופקה',dependsOn:[]},{id:'copy',kind:'draft',label:'נוסח המודעה',dependsOn:[]},{id:'upload',kind:'meta',intent:'UPLOAD_IMAGE',label:'העלאת התמונה לחשבון הפרסום',dependsOn:['media','copy']},{id:'bundle',kind:'meta',intent:'CREATE_BUNDLE',label:'יצירת הקמפיין והמודעות במצב מושהה',dependsOn:['upload','copy']},{id:'activate',kind:'meta',intent:'ACTIVATE_BUNDLE',label:'הפעלת הקמפיין שאושר',dependsOn:['bundle']}],next:{op:'read',stepId:'media',tool:'get_media_assets',args:{}}};
  if(s('copy').status==='PENDING')return{next:{op:'draft',stepId:'copy',title:'המודעה למסעדה',content:'המסעדה בישראל מזמינה אתכם להכיר את התפריט. לפרטים בקרו באתר.',campaignDraft:{objective:'תנועה לתפריט',audience:'מתעניינים במסעדה',geography:'ישראל',placements:'הצעה לבדיקה',budgetNote:'100 שקל ביום — נתוני הבעלים',scheduleNote:'לא נקבע',headline:'הכירו את התפריט',cta:'לצפייה בתפריט',designBrief:'עיצוב מסעדה',referenceMediaIds:[mediaId]}}};
  if(s('copy').status==='PREPARED')return{next:{op:'review'}};
  if(s('upload').status==='PENDING')return{next:{op:'meta',stepId:'upload',proposal:{intent:'UPLOAD_IMAGE',summary:'העלאת תמונת המסעדה לאישור',target:{accountId:'act_11'},parameters:{mediaId:s('campaign_package_image').result.mediaId}}}};
  if(s('bundle').status==='PENDING')return{next:{op:'meta',stepId:'bundle',proposal:{intent:'CREATE_BUNDLE',summary:'קמפיין מסעדה מושהה בתקציב 100 ₪ ביום',target:{accountId:'act_11'},parameters:{name:'Restaurant campaign',objective:'OUTCOME_TRAFFIC',specialAdCategories:[],dailyBudget:100,pageId:'555',link:'https://restaurant.example/menu',message:s('copy').artifact.adContent,headline:'הכירו את התפריט',imageHash:s('upload').result.id,adSets:[{name:'Israel audience',dailyBudget:100,billingEvent:'IMPRESSIONS',optimizationGoal:'LINK_CLICKS',bidStrategy:'LOWEST_COST_WITHOUT_CAP',targeting:{geo_locations:{countries:['IL']},age_min:18},startTime:'2026-12-01T09:00:00Z'}]}}}};
  if(s('activate').status==='PENDING'){const ids=s('bundle').result.objects;return{next:{op:'meta',stepId:'activate',proposal:{intent:'ACTIVATE_BUNDLE',summary:'הפעלת הקמפיין המדויק שאושר',target:{accountId:'act_11',campaignId:ids.campaignId},parameters:{adsetIds:ids.adsetIds,adIds:ids.adIds}}}};}
  return{next:{op:'finish'}};
 };
 const agent=require('../taskAgent');let sequence=0;
 const send=message=>meta.context.run(String(c.id),()=>agent.send(c.id,{message,requestId:'campaign-'+(++sequence),channel:'WHATSAPP'},{planner,imageOptions:{generateImage:async()=>({buffer:Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(32)]),mimeType:'image/png'}),uploadImage:async()=>'998'}}));
 const approve=r=>send('אשר '+r.reply.match(/אשר (\d{6})/)[1]);
 try{
  const review=await send('תיצור לי קמפיין למסעדה בישראל בתקציב של 100 שקל ביום ותפרסם אותו');assert.equal(review.task.status,'WAITING_REVIEW');assert.equal(writes.length,0);assert.equal((await agent.current(c.id)).state.steps[0].result[0].id,mediaId);
  const upload=await send('מאשר את החבילה');assert.equal(upload.task.status,'WAITING_APPROVAL');assert.equal(writes.length,0);
  const bundle=await approve(upload);assert.deepEqual(writes,['adimages']);assert.equal(bundle.task.status,'WAITING_APPROVAL');
  const activation=await approve(bundle);assert.equal(activation.task.status,'WAITING_APPROVAL',JSON.stringify({writes,reads,objects:[...objects.values()],error:(await agent.current(c.id)).state.lastError}));assert.equal([...objects.values()].filter(o=>o.status==='ACTIVE').length,0);assert.equal([...objects.values()].filter(o=>o.status==='PAUSED').length,3);
  assert.match(activation.reply,/10000/); // Verified account budget is disclosed in minor units before activation.
  const done=await approve(activation);assert.equal(done.task.status,'COMPLETE',JSON.stringify(done));assert.equal([...objects.values()].filter(o=>o.status==='ACTIVE').length,3);assert.equal(done.task.steps.filter(s=>s.kind==='meta'&&s.verified).length,3);
  assert.equal((await h.db.query('SELECT id FROM crm_leads WHERE client_id=$1',[c.id])).rows.length,0);
 }finally{axios.get=get;axios.post=post;mediaHandler.receiveWhatsAppMedia=receive;await h.close();for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
