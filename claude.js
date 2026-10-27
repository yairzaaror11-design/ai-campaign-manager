'use strict';
const axios=require('axios');
const gemini=require('./gemini');
function lowerSchema(value) {
 if(Array.isArray(value)) return value.map(lowerSchema);
 if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='type'&&typeof v==='string'?v.toLowerCase():lowerSchema(v)]));
 return value;
}
async function processWithClaude(text,history=[],options={}) {
 if(!process.env.ANTHROPIC_API_KEY&&!options.client) throw Error('ANTHROPIC_API_KEY_REQUIRED');
 if(!process.env.CLAUDE_MODEL) throw Error('CLAUDE_MODEL_REQUIRED');
 const client=options.client || {create:async body=>{
   try {return (await axios.post('https://api.anthropic.com/v1/messages',body,{headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},timeout:30000,maxRedirects:0})).data;}
   catch {throw Error('AI_REQUEST_FAILED');}
 }};
 const messages=[...history.slice(-12).map(m=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content).slice(0,12000)})),{role:'user',content:text}];
 const plans=[];
 for(let round=0;round<6;round++) {
   const response=await client.create({model:process.env.CLAUDE_MODEL,max_tokens:2048,system:require('./marketingPrompt').withMarketingContext(gemini.SYSTEM+(options.creativeDraft?'\n'+require('./creativeGeneration').SYSTEM:'')+(options.planningOnly?'\nPlanning conversation only. No tools or actions are available. Use supplied dashboard context to answer, explain and suggest; never claim to save, publish, send, book, delete or execute.':''),options.marketingContext),messages,
     ...(options.planningOnly?{}:{tools:gemini.functionDeclarations.map(f=>({name:f.name,description:f.description,input_schema:lowerSchema(f.parameters)}))})});
   const calls=(response.content || []).filter(p=>p.type==='tool_use');
   if(options.planningOnly&&calls.length)throw Error('PLANNING_TOOL_CALL_REJECTED');
   if(!calls.length) return {text:(response.content||[]).filter(p=>p.type==='text').map(p=>p.text).join('\n'),actionPlans:plans};
   if(calls.length>5) throw Error('AI_TOOL_LIMIT');
   messages.push({role:'assistant',content:response.content});
   const results=[];
   for(const call of calls) {
     try {const result=await gemini.runTool(call.name,call.input);if(result.actionPlan) plans.push(result.actionPlan);results.push({type:'tool_result',tool_use_id:call.id,content:JSON.stringify(result)});}
     catch {results.push({type:'tool_result',tool_use_id:call.id,content:'Tool request rejected',is_error:true});}
   }
   messages.push({role:'user',content:results});
 }
 throw Error('AI_TOOL_LIMIT');
}
async function analyzeConversation(text,context={},options={}){
 if(!process.env.CLAUDE_MODEL||(!options.client&&!process.env.ANTHROPIC_API_KEY))throw Error('CLAUDE_CONFIGURATION_REQUIRED');
 const body={model:process.env.CLAUDE_MODEL,max_tokens:1800,system:require('./conversationAnalysis').ANALYSIS_SYSTEM,messages:[{role:'user',content:JSON.stringify({context,currentUserMessage:text})}]};
 let response;
 if(options.client)response=await options.client.create(body);
 else try{response=(await axios.post('https://api.anthropic.com/v1/messages',body,{headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},timeout:12000,maxRedirects:0})).data;}catch{throw Error('AI_REQUEST_FAILED');}
 return JSON.parse((response.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n').replace(/^```(?:json)?\s*|\s*```$/g,''));
}
module.exports={processWithClaude,analyzeConversation};
