'use strict';
const providers=new Map();
function registerProvider(name,provider) {
 if(!/^[a-z][a-z0-9_-]*$/.test(name)||typeof provider!=='function') throw Error('INVALID_AI_PROVIDER');
 providers.set(name,provider);
}
async function processMessage(text,history=[],options={}) {
 if(typeof text!=='string'||!text.trim()||text.length>12000) throw Error('INVALID_AI_INPUT');
 const name=process.env.AI_PROVIDER || 'gemini';
 const provider=providers.get(name) || (name==='gemini'?require('./gemini').processWithGemini:name==='claude'?require('./claude').processWithClaude:null);
 if(!provider) throw Error('AI_PROVIDER_UNSUPPORTED');
 const response=await provider(text,history,options);
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
 if(name==='gemini')return require('./gemini').analyzeConversation(text,context,options);
 if(name==='claude')return require('./claude').analyzeConversation(text,context,options);
 throw Error('AI_PROVIDER_UNSUPPORTED');
}
module.exports={processMessage,registerProvider,analyzeConversation};
