'use strict';
// Synthetic model-only probes. No task rows, client data, messages or Meta mutations.
const cases=[
 {id:'recruitment',request:'תיצור לי קמפיין דרושים עם מודעה וטופס מועמדות',business:{businessName:{value:'עסק בדיקה סינתטי',status:'known'},businessType:{value:'סוכנות דיגיטל',status:'known'},product:{value:'תוכן לסושיאל לעסקים',status:'known'},businessGoal:{value:'הגדלת הכנסות העסק',status:'known'},geography:{value:'תל אביב',status:'known'}},forbiddenQuestion:/שם העסק|מה העסק עושה/},
 {id:'reuse_known_business',request:'תכין לי נוסח מודעה למסעדה על בסיס הפרטים שכבר שמורים. אל תפרסם.',business:{businessName:{value:'מסעדת בדיקה סינתטית',status:'known'},businessType:{value:'מסעדה',status:'known'},product:{value:'ארוחות צהריים',status:'known'},audience:{value:'לקוחות באזור',status:'known'},geography:{value:'ישראל',status:'known'},advantage:{value:'בישול ביתי',status:'known'}},forbiddenQuestion:/שם העסק|מה העסק עושה|איזה מוצר/},
 {id:'draft_is_not_publication',request:'תכין רק טיוטת קמפיין למכון כושר. אל תפרסם ואל תוציא כסף.',business:{businessType:{value:'מכון כושר',status:'known'}},noWrites:true},
 {id:'new_goal_after_clarification',request:'דירת 2 חדרים למכירה באילת במיליון שקל',business:{},afterClarification:true},
 {id:'continuation_feedback',request:'תכין לי טיוטת מודעה לבית קפה עם ארוחת בוקר ב-45 ₪. אל תפרסם.',business:{businessType:{value:'בית קפה',status:'known'}},continuation:true},
 {id:'professional_calculation',request:'בדוק כדאיות בלי לשנות תקציב: תקופה קודמת של 30 יום עם פרסום 3000 ₪ ו-5 לקוחות משלמים, תקופה חדשה של 30 יום עם פרסום 6000 ₪ ו-8 לקוחות משלמים. הנחת הכנסה לחיי לקוח אחרי עלויות משתנות היא 687.50 ₪.',business:{},professional:true},
 {id:'recruitment_grounded_package',request:'תכין לי קמפיין דרושים עם מודעה וטופס מועמדות, בלי לפרסם',business:{businessName:{value:'עסק בדיקה סינתטי',status:'known'}},recruitmentPackage:true}
];
// Exercise the correction transport even when the first numeric answer happens
// to be well formed. No client data or executor is involved.
cases.push({...cases.find(c=>c.id==='professional_calculation'),id:'professional_contract_correction',contractCorrection:true});
cases.push({...cases.find(c=>c.id==='recruitment_grounded_package'),id:'campaign_contract_continuation',packageContinuation:true});
cases.push({id:'discovery_before_creative',request:'אני רוצה להביא לקוחות חדשים לעסק דרך פייסבוק ואינסטגרם. תעזור לי לבחור מה כדאי להציע ולמי לפנות. לפני שמכינים מודעה ועיצוב, בוא נדייק יחד את הכיוון. בלי לפרסם כרגע.',business:{businessName:{value:'עסק בדיקה סינתטי',status:'known'},product:{value:'ניהול פרסום לעסקים',status:'known'}},noWrites:true,discovery:true});
let state={status:'NOT_RUN',providers:[]};
let inFlight=null;
const ACCEPTANCE_MS=24*60*60*1000;
let validUntil=Infinity;
const ready=()=>state.status==='PASSED'&&Date.now()<validUntil;
function cacheIdentity(){
 const release=process.env.RENDER_GIT_COMMIT;
 const provider=process.env.AI_PROVIDER||'gemini';
 const model=provider==='gemini'?process.env.GEMINI_MODEL:provider==='claude'?process.env.CLAUDE_MODEL:null;
 const credential=provider==='gemini'?process.env.GEMINI_API_KEY:provider==='claude'?process.env.ANTHROPIC_API_KEY:null;
 if(!/^[a-f0-9]{40}$/i.test(release||'')||!model||!credential||!require('./db').configured())return null;
 const fingerprint=require('node:crypto').createHash('sha256').update(JSON.stringify([
  release,provider,model,credential,process.env.DYNAMIC_CONVERSATION_ENABLED
 ])).digest('hex');
 return{service:process.env.RENDER_SERVICE_ID||'default',fingerprint,provider,model};
}
function completePass(result,identity){
 const provider=result?.providers?.find?.(p=>p.provider===identity.provider&&p.model===identity.model);
 const expected=[...cases,...require('./conversationRouter').PROBES].map(item=>item.id);
 return result?.status==='PASSED'&&provider?.status==='PASSED'&&Array.isArray(provider.cases)&&
  provider.cases.length===expected.length&&expected.every(id=>provider.cases.some(c=>c.id===id&&c.result==='PASSED'));
}
async function evaluateWithCache(options){
 const identity=options?null:cacheIdentity();
 const db=require('./db');
 if(identity){
  state={status:'NOT_RUN',providers:[]};
  try{
   const {rows:[cached]}=await db.query(
    'SELECT result, expires_at FROM model_acceptance_cache WHERE service=$1 AND fingerprint=$2 AND expires_at>NOW()',
    [identity.service,identity.fingerprint]
   );
   if(cached&&completePass(cached.result,identity)){
    validUntil=Date.parse(cached.expires_at);
    if(Date.now()<validUntil){
     state={...cached.result,source:'cached'};
     return status();
    }
   }
  }catch{require('./logger').logger.warn('Model acceptance cache read unavailable');}
 }
 validUntil=Infinity;
 const result=await evaluate(options);
 if(identity&&completePass(result,identity)){
  validUntil=Date.parse(result.finishedAt)+ACCEPTANCE_MS;
  try{
   await db.query(
    `INSERT INTO model_acceptance_cache(service,fingerprint,result,expires_at) VALUES($1,$2,$3,$4)
     ON CONFLICT(service) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,result=EXCLUDED.result,expires_at=EXCLUDED.expires_at`,
    [identity.service,identity.fingerprint,JSON.stringify(result),new Date(validUntil)]
   );
  }catch{require('./logger').logger.warn('Model acceptance cache write unavailable');}
 }
 return result;
}
function status(){return structuredClone(state);}
async function evaluate({decide=require('./taskPlanner').decide,route=require('./conversationRouter').route,providers}={}){
 if(state.status==='RUNNING')return status();
 state={status:'RUNNING',startedAt:new Date().toISOString(),providers:[]};
 const selected=process.env.AI_PROVIDER||'gemini';
 const configs=providers||[{provider:'gemini',model:process.env.GEMINI_MODEL,configured:!!process.env.GEMINI_API_KEY},{provider:'claude',model:process.env.CLAUDE_MODEL,configured:!!process.env.ANTHROPIC_API_KEY}];
 for(const config of configs){
  const entry={provider:config.provider,model:config.model||null,status:'NOT_CONFIGURED',cases:[]};state.providers.push(entry);
  if(!config.configured||!config.model)continue;
  entry.status='RUNNING';
  for(const item of cases){
   const began=Date.now();let result='FAILED',reason='INVALID_DECISION',contractIssue,providerIssue;
   try{
    const context={request:item.request,requiredOutcomes:require('./taskAgent').requiredOutcomes(item.request),plan:[],facts:{},messages:[{role:'user',content:item.request}],knownBusiness:{facts:item.business},readTools:require('./taskPlanner').READ_TOOLS,professionalReadSchemas:require('./gemini').functionDeclarations.filter(t=>['get_professional_skills','analyze_business_case'].includes(t.name)),writeSchema:require('./gemini').functionDeclarations.find(t=>t.name==='propose_action').parameters};
    if(item.afterClarification)context.messages=[{role:'user',content:'אני רוצה לשווק משהו אחר'},{role:'assistant',content:'בטח, מה המוצר או השירות שתרצה לקדם עכשיו?'},{role:'user',content:item.request}];
    if(item.professional)context.plan=[{id:'guide',label:'כללי הרחבה',kind:'read',dependsOn:[],status:'DONE',result:require('./professionalSkills').catalog({id:'MKT-06'})},{id:'economics',label:'כלכלה שולית',kind:'read',dependsOn:['guide'],status:'PENDING'}];
    if(item.contractCorrection)context.plannerFeedback={code:'INVALID_BUSINESS_FIELDS',operation:'scaling',instruction:'Return a corrected analyze_business_case read for the supplied owner figures, using args.operation and fields:[{key,value,evidence}], with numeric strings and exact owner evidence. Keep the accepted plan IDs. No tool has run.'};
    if(item.continuation){context.plan=[{id:'copy',label:'מודעת בית קפה',kind:'draft',dependsOn:[],status:'PREPARED',artifact:{title:'מודעה',content:'ארוחת בוקר ב-45 ₪. לפרטים כתבו לנו.',reviewed:false}}];context.messages.push({role:'user',content:'שנה את הכותרת ל־קפה טרי ליד הבית, בלי לשנות את ההצעה.'});}
    if(item.recruitmentPackage){
     context.plan=[{id:'details',label:'פרטי משרה',kind:'collect',dependsOn:[],status:'DONE'},{id:'recruitment_copy',label:'מודעה וטופס לבדיקה',kind:'draft',dependsOn:['details'],status:'PREPARED',artifact:{title:'טיוטה קודמת',content:'החברה מתרחבת; ניסיון B2B יתרון.',reviewed:false}},{id:'form',label:'טופס',kind:'meta',intent:'CREATE_LEAD_FORM',dependsOn:['recruitment_copy'],status:'PENDING'},{id:'campaign',label:'קמפיין',kind:'meta',intent:'CREATE_BUNDLE',dependsOn:['form'],status:'PENDING'}];
     context.facts={role:{value:'איש מכירות',evidence:'גיוס איש מכירות בכל הארץ'},geography:{value:'בכל הארץ',evidence:'גיוס איש מכירות בכל הארץ'}};
     context.messages.push({role:'user',content:'גיוס איש מכירות בכל הארץ'},{role:'assistant',content:'החברה מתרחבת; ניסיון B2B יתרון.'},{role:'user',content:'תקן את הטיוטה לפי הפרטים שמסרתי בלבד וצרף את שאלות טופס המועמדות. אל תוסיף תנאים או דרישות שלא מסרתי.'});
     context.plannerFeedback=require('./taskDraftReview').feedback();
     if(item.packageContinuation){
      context.plan.unshift({id:'stored_facts',label:'פרטים שנשמרו',kind:'collect',dependsOn:[],status:'DONE'});context.plan[1].dependsOn=['stored_facts'];
      const existing={request:item.request,state:{steps:context.plan}};require('./campaignPackage').ensure(existing);context.plan=existing.state.steps;
      context.plannerFeedback=require('./campaignPackage').feedback('TASK_CAMPAIGN_DRAFT_REQUIRED');
     }
    }
    const options={provider:config.provider,model:config.model};
    let answer;
    try{
     answer=await decide(context,options);
     if(!context.plan.length){if(!answer?.next)throw Error('INVALID_TASK_DECISION');require('./taskAgent').validatePlan(answer.plan,item.request);}
    }catch(error){
     if(context.plan.length||!require('./taskPlanner').repairableInitial(error))throw error;
     // Match the runtime's single model-only correction, with all final checks below unchanged.
     answer=await decide({...context,plannerFeedback:require('./taskPlanner').initialFeedback(error instanceof SyntaxError?'INVALID_TASK_JSON':error.message)},options);
    }
    if(item.recruitmentPackage){try{require('./campaignPackage').checked(answer.next?.campaignDraft);}catch(error){if(error.message!=='INVALID_CAMPAIGN_DRAFT')throw error;answer=await decide({...context,plannerFeedback:require('./campaignPackage').feedback(error.message)},options);}}
    if(item.recruitmentPackage){
     const n=answer.next,copy=String(n?.title||'')+' '+String(n?.content||'');
     if(n?.op!=='draft'||n.stepId!=='recruitment_copy'||typeof n.content!=='string'||n.content.length>6000)throw Error('RECRUITMENT_PACKAGE_NOT_REVISED');
     require('./taskDraftReview').formDraft(n.formDraft);require('./campaignPackage').checked(n.campaignDraft);
     if(!/מכירות/u.test(copy)||!/כל הארץ|פריסה ארצית/u.test(copy)||/מתרחב|B2B|טלפוני|דרישות סף|שכר בסיס/u.test(copy))throw Error('UNSUPPORTED_RECRUITMENT_CLAIM');
    }else if(item.professional){
     const n=answer.next;
     if(n?.op!=='read'||n.stepId!=='economics'||n.tool!=='analyze_business_case'||n.args?.operation!=='scaling')throw Error('PROFESSIONAL_TOOL_NOT_USED');
     const id='synthetic-model-probe';
     const result=require('./metaConnection').context.run(id,()=>require('./businessCase').analyze(n.args,{clientId:id,sources:[item.request]}));
     if(result.metrics?.marginalCac?.value!=='1000.00'||result.metrics?.estimatedIncrementalLifetimeBalanceBeforeOtherCosts?.value!=='-937.50'||result.externalActionsExecuted!==false)throw Error('PROFESSIONAL_CALCULATION_FAILED');
    }else if(item.continuation){
     const n=answer.next,copy=String(n?.title||'')+' '+String(n?.content||'');
     if(n?.op!=='draft'||n.stepId!=='copy'||typeof n.content!=='string'||n.content.length>6000)throw Error('CONTINUATION_NOT_APPLIED');
     if(!copy.includes('קפה טרי ליד הבית')||!copy.includes('45'))throw Error('CONTINUATION_CHANGED_OFFER');
    }else{
    const plan=require('./taskAgent').validatePlan(answer.plan,item.request),n=answer.next;
    if(!n||!['ask','collect','read','draft','blocked'].includes(n.op))throw Error('UNSAFE_INITIAL_STEP');
    const step=plan.find(s=>s.id===n.stepId);if(!step||step.dependsOn.length)throw Error('INITIAL_STEP_NOT_READY');
    if(({ask:'collect',collect:'collect',read:'read',draft:'draft'})[n.op]!==step.kind&&n.op!=='blocked')throw Error('OPERATION_MISMATCH');
    if(n.op==='ask'&&(typeof n.question!=='string'||n.question.length>600||item.forbiddenQuestion?.test(n.question)))throw Error('REDUNDANT_QUESTION');
    if(item.noWrites&&plan.some(s=>s.kind==='meta'))throw Error('DRAFT_ONLY_HAS_WRITE');
    if(item.discovery&&(!['ask','read','collect','blocked'].includes(n.op)||plan.some(s=>['image','meta'].includes(s.kind))))throw Error('DISCOVERY_SKIPPED');
    if(n.op==='read'&&!require('./taskPlanner').READ_TOOLS.includes(n.tool))throw Error('UNSUPPORTED_TOOL');
    }
    result='PASSED';reason=null;
   }catch(error){reason=/^[A-Z_]+$/.test(error.message)?error.message:'PROVIDER_OR_RESPONSE_FAILED';if(error.contractIssue)contractIssue=error.contractIssue;if(reason==='PROVIDER_OR_RESPONSE_FAILED')providerIssue={status:Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:null,category:/schema|anyOf|nesting|too many states/i.test(error.message)?'SCHEMA_REJECTED':'PROVIDER_OR_RESPONSE_FAILED'};}
   entry.cases.push({id:item.id,result,reason,...(contractIssue?{contractIssue}:{}),...(providerIssue?{providerIssue}:{}),latencyMs:Date.now()-began});
  }
  for(const probe of require('./conversationRouter').PROBES){
   const began=Date.now();let result='FAILED',reason='ROUTING_INTENT_MISMATCH';
   try{
    const answer=await route({message:probe.message,...(probe.pendingMessage?{pendingRequest:probe.pendingMessage}:{}),task:{request:'הכן קמפיין לשירות ניהול פרסום',status:'WAITING_REVIEW',planningMode:'REQUESTED_TASK',steps:[{id:'copy',kind:'draft',status:'PREPARED',artifact:{title:'מודעה',content:'ניהול פרסום לבעלי עסקים. לשיחת היכרות השאירו פרטים.'}},{id:'image',kind:'image',status:'PREPARED'},{id:'create',kind:'meta',status:'PENDING'}]},messages:[],business:{product:{value:'ניהול פרסום לעסקים',status:'known'}}},{provider:config.provider,model:config.model});
    if(probe.allowed.includes(answer?.kind)&&(!probe.needsPending||answer.usePending===true)&&(answer.kind!=='ANSWER'||typeof answer.reply==='string'&&answer.reply.trim()&&answer.reply.length<=900)){result='PASSED';reason=null;}
   }catch(error){reason=/^[A-Z_]+$/.test(error.message)?error.message:'PROVIDER_OR_RESPONSE_FAILED';}
   entry.cases.push({id:probe.id,result,reason,latencyMs:Date.now()-began});
  }
  entry.status=entry.cases.every(c=>c.result==='PASSED')?'PASSED':'FAILED';
 }
 state.status=state.providers.find(p=>p.provider===selected)?.status==='PASSED'?'PASSED':'FAILED';state.finishedAt=new Date().toISOString();
 require('./logger').logger.info('Task manager model acceptance completed',{result:state.status,providers:state.providers.map(p=>({provider:p.provider,status:p.status,cases:p.cases}))});
 return status();
}
function run(options){
 if(inFlight)return inFlight;
 inFlight=evaluateWithCache(options).catch(()=>{state.status='FAILED';return status();}).finally(()=>{inFlight=null;});
 return inFlight;
}
function start(){if(process.env.TASK_AGENT_EVALUATE_ON_START==='true')void run();}
function ensure(){if(inFlight)return inFlight;if(ready())return Promise.resolve(status());if(state.startedAt&&Date.now()-Date.parse(state.startedAt)<60000)return Promise.resolve(status());return run();}
async function waitUntilReady(timeoutMs=45000){
 if(ready())return true;
 let timer;
 try{await Promise.race([ensure(),new Promise(resolve=>{timer=setTimeout(resolve,timeoutMs);})]);return ready();}
 finally{clearTimeout(timer);}
}
module.exports={cases,ready,status,run,start,ensure,waitUntilReady};
