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
let state={status:'NOT_RUN',providers:[]};
let inFlight=null;
const ready=()=>state.status==='PASSED';
function status(){return structuredClone(state);}
async function evaluate({decide=require('./taskPlanner').decide,providers}={}){
 if(state.status==='RUNNING')return status();
 state={status:'RUNNING',startedAt:new Date().toISOString(),providers:[]};
 const selected=process.env.AI_PROVIDER||'gemini';
 const configs=providers||[{provider:'gemini',model:process.env.GEMINI_MODEL,configured:!!process.env.GEMINI_API_KEY},{provider:'claude',model:process.env.CLAUDE_MODEL,configured:!!process.env.ANTHROPIC_API_KEY}];
 for(const config of configs){
  const entry={provider:config.provider,model:config.model||null,status:'NOT_CONFIGURED',cases:[]};state.providers.push(entry);
  if(!config.configured||!config.model)continue;
  entry.status='RUNNING';
  for(const item of cases){
   const began=Date.now();let result='FAILED',reason='INVALID_DECISION';
   try{
    const context={request:item.request,requiredOutcomes:require('./taskAgent').requiredOutcomes(item.request),plan:[],facts:{},messages:[{role:'user',content:item.request}],knownBusiness:{facts:item.business},readTools:require('./taskPlanner').READ_TOOLS,professionalReadSchemas:require('./gemini').functionDeclarations.filter(t=>['get_professional_skills','analyze_business_case'].includes(t.name)),writeSchema:require('./gemini').functionDeclarations.find(t=>t.name==='propose_action').parameters};
    if(item.afterClarification)context.messages=[{role:'user',content:'אני רוצה לשווק משהו אחר'},{role:'assistant',content:'בטח, מה המוצר או השירות שתרצה לקדם עכשיו?'},{role:'user',content:item.request}];
    if(item.professional)context.plan=[{id:'guide',label:'כללי הרחבה',kind:'read',dependsOn:[],status:'DONE',result:require('./professionalSkills').catalog({id:'MKT-06'})},{id:'economics',label:'כלכלה שולית',kind:'read',dependsOn:['guide'],status:'PENDING'}];
    if(item.continuation){context.plan=[{id:'copy',label:'מודעת בית קפה',kind:'draft',dependsOn:[],status:'PREPARED',artifact:{title:'מודעה',content:'ארוחת בוקר ב-45 ₪. לפרטים כתבו לנו.',reviewed:false}}];context.messages.push({role:'user',content:'שנה את הכותרת ל־קפה טרי ליד הבית, בלי לשנות את ההצעה.'});}
    if(item.recruitmentPackage){
     context.plan=[{id:'details',label:'פרטי משרה',kind:'collect',dependsOn:[],status:'DONE'},{id:'recruitment_copy',label:'מודעה וטופס לבדיקה',kind:'draft',dependsOn:['details'],status:'PREPARED',artifact:{title:'טיוטה קודמת',content:'החברה מתרחבת; ניסיון B2B יתרון.',reviewed:false}},{id:'form',label:'טופס',kind:'meta',intent:'CREATE_LEAD_FORM',dependsOn:['recruitment_copy'],status:'PENDING'},{id:'campaign',label:'קמפיין',kind:'meta',intent:'CREATE_BUNDLE',dependsOn:['form'],status:'PENDING'}];
     context.facts={role:{value:'איש מכירות',evidence:'גיוס איש מכירות בכל הארץ'},geography:{value:'בכל הארץ',evidence:'גיוס איש מכירות בכל הארץ'}};
     context.messages.push({role:'user',content:'גיוס איש מכירות בכל הארץ'},{role:'assistant',content:'החברה מתרחבת; ניסיון B2B יתרון.'},{role:'user',content:'תקן את הטיוטה לפי הפרטים שמסרתי בלבד וצרף את שאלות טופס המועמדות. אל תוסיף תנאים או דרישות שלא מסרתי.'});
     context.plannerFeedback=require('./taskDraftReview').feedback();
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
    if(item.recruitmentPackage){
     const n=answer.next,copy=String(n?.title||'')+' '+String(n?.content||'');
     if(n?.op!=='draft'||n.stepId!=='recruitment_copy'||typeof n.content!=='string'||n.content.length>6000)throw Error('RECRUITMENT_PACKAGE_NOT_REVISED');
     require('./taskDraftReview').formDraft(n.formDraft);
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
    if(n.op==='read'&&!require('./taskPlanner').READ_TOOLS.includes(n.tool))throw Error('UNSUPPORTED_TOOL');
    }
    result='PASSED';reason=null;
   }catch(error){reason=/^[A-Z_]+$/.test(error.message)?error.message:'PROVIDER_OR_RESPONSE_FAILED';}
   entry.cases.push({id:item.id,result,reason,latencyMs:Date.now()-began});
  }
  entry.status=entry.cases.every(c=>c.result==='PASSED')?'PASSED':'FAILED';
 }
 state.status=state.providers.find(p=>p.provider===selected)?.status==='PASSED'?'PASSED':'FAILED';state.finishedAt=new Date().toISOString();
 require('./logger').logger.info('Task manager model acceptance completed',{result:state.status,providers:state.providers.map(p=>({provider:p.provider,status:p.status,cases:p.cases}))});
 return status();
}
function run(options){
 if(inFlight)return inFlight;
 inFlight=evaluate(options).catch(()=>{state.status='FAILED';return status();}).finally(()=>{inFlight=null;});
 return inFlight;
}
function start(){if(process.env.TASK_AGENT_EVALUATE_ON_START==='true')void run();}
function ensure(){if(inFlight)return inFlight;if(state.status==='PASSED')return Promise.resolve(status());if(state.startedAt&&Date.now()-Date.parse(state.startedAt)<60000)return Promise.resolve(status());return run();}
async function waitUntilReady(timeoutMs=45000){
 if(ready())return true;
 let timer;
 try{await Promise.race([ensure(),new Promise(resolve=>{timer=setTimeout(resolve,timeoutMs);})]);return ready();}
 finally{clearTimeout(timer);}
}
module.exports={cases,ready,status,run,start,ensure,waitUntilReady};
