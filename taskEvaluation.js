'use strict';
// Synthetic model-only probes. No task rows, client data, messages or Meta mutations.
const cases=[
 {id:'recruitment',request:'תיצור לי קמפיין דרושים וטופס מועמדות לנציגי שירות. עדיין לא נתתי אזור או שעות.',business:{businessName:{value:'עסק בדיקה סינתטי',status:'known'},businessType:{value:'שירותי לקוחות',status:'known'}},forbiddenQuestion:/שם העסק|מה העסק עושה/},
 {id:'reuse_known_business',request:'תכין לי נוסח מודעה למסעדה על בסיס הפרטים שכבר שמורים. אל תפרסם.',business:{businessName:{value:'מסעדת בדיקה סינתטית',status:'known'},businessType:{value:'מסעדה',status:'known'},product:{value:'ארוחות צהריים',status:'known'},audience:{value:'לקוחות באזור',status:'known'},geography:{value:'ישראל',status:'known'},advantage:{value:'בישול ביתי',status:'known'}},forbiddenQuestion:/שם העסק|מה העסק עושה|איזה מוצר/},
 {id:'draft_is_not_publication',request:'תכין רק טיוטת קמפיין למכון כושר. אל תפרסם ואל תוציא כסף.',business:{businessType:{value:'מכון כושר',status:'known'}},noWrites:true}
];
let state={status:'NOT_RUN',providers:[]};
const ready=()=>state.status==='PASSED';
function status(){return structuredClone(state);}
async function run({decide=require('./taskPlanner').decide,providers}={}){
 if(state.status==='RUNNING')return status();
 state={status:'RUNNING',startedAt:new Date().toISOString(),providers:[]};
 const selected=process.env.AI_PROVIDER||'gemini';
 const configs=providers||[{provider:'gemini',model:process.env.GEMINI_MODEL,configured:!!process.env.GEMINI_API_KEY},{provider:'claude',model:process.env.CLAUDE_MODEL,configured:!!process.env.ANTHROPIC_API_KEY}];
 for(const config of configs){
  const entry={provider:config.provider,model:config.model||null,status:'NOT_CONFIGURED',cases:[]};state.providers.push(entry);
  if(!config.configured||!config.model)continue;
  for(const item of cases){
   const began=Date.now();let result='FAILED',reason='INVALID_DECISION';
   try{
    const context={request:item.request,requiredOutcomes:require('./taskAgent').requiredOutcomes(item.request),plan:[],facts:{},messages:[{role:'user',content:item.request}],knownBusiness:{facts:item.business},readTools:require('./taskPlanner').READ_TOOLS,writeSchema:require('./gemini').functionDeclarations.find(t=>t.name==='propose_action').parameters};
    const answer=await decide(context,{provider:config.provider,model:config.model});
    const plan=require('./taskAgent').validatePlan(answer.plan,item.request),n=answer.next;
    if(!n||!['ask','collect','read','draft','blocked'].includes(n.op))throw Error('UNSAFE_INITIAL_STEP');
    const step=plan.find(s=>s.id===n.stepId);if(!step||step.dependsOn.length)throw Error('INITIAL_STEP_NOT_READY');
    if(({ask:'collect',collect:'collect',read:'read',draft:'draft'})[n.op]!==step.kind&&n.op!=='blocked')throw Error('OPERATION_MISMATCH');
    if(n.op==='ask'&&(typeof n.question!=='string'||n.question.length>600||item.forbiddenQuestion?.test(n.question)))throw Error('REDUNDANT_QUESTION');
    if(item.noWrites&&plan.some(s=>s.kind==='meta'))throw Error('DRAFT_ONLY_HAS_WRITE');
    if(n.op==='read'&&!require('./taskPlanner').READ_TOOLS.includes(n.tool))throw Error('UNSUPPORTED_TOOL');
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
function start(){if(process.env.TASK_AGENT_EVALUATE_ON_START==='true')run().catch(()=>{state.status='FAILED';});}
module.exports={cases,ready,status,run,start};
