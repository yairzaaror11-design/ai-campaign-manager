'use strict';
const providers=new Map();
const resolve=name=>providers.get(name) || (name==='gemini'?require('./gemini').processWithGemini:name==='claude'?require('./claude').processWithClaude:null);
// Errors caused by the request itself; another provider would fail the same way.
const DETERMINISTIC=new Set(['INVALID_AI_INPUT','PLANNING_TOOL_CALL_REJECTED','PLANNING_ACTION_REJECTED','AI_TOOL_LIMIT','AI tool call limit exceeded','TENANT_CONTEXT_REQUIRED']);
function fallbackFor(name,options){
 const fallback=process.env.AI_FALLBACK_PROVIDER;
 if(!fallback||fallback===name||options.provider)return null; // explicit provider (e.g. evaluation) never falls back
 if(fallback==='claude'&&(!process.env.ANTHROPIC_API_KEY||!process.env.CLAUDE_MODEL))return null;
 if(fallback==='gemini'&&!process.env.GEMINI_API_KEY)return null;
 return resolve(fallback)?fallback:null;
}
// Runs the primary provider; on a provider failure, answers once with the configured fallback.
async function withFallback(name,options,primary,secondary){
 try{return await primary();}
 catch(error){
  const fallback=fallbackFor(name,options);
  if(!fallback||DETERMINISTIC.has(error.message))throw error;
  require('./logger').logger.warn('AI provider failed; using fallback',{primary:name,fallback,error:/^[A-Z_]+$/.test(error.message)?error.message:'PROVIDER_ERROR'});
  return secondary(fallback);
 }
}
function registerProvider(name,provider) {
 if(!/^[a-z][a-z0-9_-]*$/.test(name)||typeof provider!=='function') throw Error('INVALID_AI_PROVIDER');
 providers.set(name,provider);
}
async function processMessage(text,history=[],options={}) {
 if(typeof text!=='string'||!text.trim()||text.length>(options.taskPlanning&&options.planningOnly?60000:12000)) throw Error('INVALID_AI_INPUT');
 const name=options.provider||process.env.AI_PROVIDER||'gemini';
 const provider=resolve(name);
 if(!provider) throw Error('AI_PROVIDER_UNSUPPORTED');
 // Over the monthly AI cost cap the same provider answers with its cheaper model.
 const cap=require('./aiCostCap');
 const primaryOptions=await cap.textOptions(name,options);
 const response=await withFallback(name,options,()=>provider(text,history,primaryOptions),async fallback=>resolve(fallback)(text,history,await cap.textOptions(fallback,{...options,model:undefined})));
 if(!response || typeof response.text!=='string'||response.text.length>16000||!Array.isArray(response.actionPlans)||response.actionPlans.length>5) throw Error('INVALID_AI_OUTPUT');
 if(options.planningOnly&&response.actionPlans.length)throw Error('PLANNING_ACTION_REJECTED');
 for(const plan of response.actionPlans) {
   if(!plan || typeof plan!=='object'||!plan.requiresApproval||typeof plan.id!=='string'||!require('./actionPlan').isWriteIntent(plan.intent)||JSON.stringify(plan).length>16000) throw Error('INVALID_AI_PLAN');
 }
 return response;
}
async function analyzeConversation(text,context={},options={}) {
 if(typeof text!=='string'||!text.trim()||text.length>12000)throw Error('INVALID_AI_INPUT');
 const name=process.env.AI_PROVIDER||'gemini';
 if(providers.has(name)){
  const r=await providers.get(name)(text,[],{...options,task:'conversation_analysis',context});
  if(!r?.analysis)throw Error('ANALYSIS_UNAVAILABLE');return r.analysis;
 }
 const analyze=async n=>{const o=await require('./aiCostCap').textOptions(n,options);return n==='gemini'?require('./gemini').analyzeConversation(text,context,o):n==='claude'?require('./claude').analyzeConversation(text,context,o):Promise.reject(Error('AI_PROVIDER_UNSUPPORTED'));};
 if(!['gemini','claude'].includes(name))throw Error('AI_PROVIDER_UNSUPPORTED');
 return withFallback(name,options,()=>analyze(name),analyze);
}
module.exports={processMessage,registerProvider,analyzeConversation,fallbackFor};
