'use strict';
// Provider output constraints supplement, never replace, backend authorization/validation.
function responseSchema(context){
 const string={type:'string'},strings={type:'array',items:string};
 const initial=!context.plan?.length;
 const next={type:'object',additionalProperties:false,required:['op'],properties:{
  op:{type:'string',enum:['ask','collect','read','draft','image','meta','review','finish','blocked']},
  stepId:initial?{type:'string',description:'An id from the plan returned in this response.'}:{type:'string',enum:context.plan.map(s=>s.id)},
  question:string,facts:{type:'array',maxItems:12,items:{type:'object',additionalProperties:false,properties:{key:string,value:string,evidence:string},required:['key','value','evidence']}},knownFields:strings,
  tool:{type:'string',enum:require('./botCapabilities').READ_TOOLS},args:{type:'object',additionalProperties:true,properties:{
   operation:{type:'string',enum:Object.keys(require('./businessCase').OPS)},
   fields:{type:'array',items:{anyOf:[{type:'string',description:'A semantic field name for get_business_facts only.'},{type:'object',additionalProperties:false,properties:{key:{type:'string',enum:Object.keys(require('./businessCase').TYPES)},value:{type:'string',description:'Unsigned base-10 decimal digits only, optionally with a decimal dot or grouped thousands commas. No currency symbols, units, spaces, percent signs or arithmetic. Copy the numeric amount from quoted owner evidence.'},evidence:{type:'string'}},required:['key','value','evidence']}] }},
   currency:{type:'object',additionalProperties:false,properties:{value:{type:'string',enum:['ILS','USD','EUR','GBP']},evidence:{type:'string'}},required:['value','evidence']},
   period:{type:'object',additionalProperties:false,properties:{value:{type:'string',description:'Exact contiguous owner quotation, or omit the entire period object.'},evidence:{type:'string'}},required:['value','evidence']}
  }},
  title:string,content:string,destination:{type:'string',enum:['landing_page']},prompt:string,referenceMediaIds:{...strings,maxItems:4},
  campaignDraft:{type:'object',additionalProperties:false,properties:Object.fromEntries(['objective','audience','geography','placements','budgetNote','scheduleNote','headline','cta','designBrief'].map(k=>[k,{type:'string',description:['headline','cta'].includes(k)?'Short visible image text, at most 100 characters.':'Concise proposed setting, at most 400 characters. Unprovided budget/schedule remain explicitly not set.'}]).concat([['referenceMediaIds',{type:'array',maxItems:4,items:{type:'string'}}]])),required:['objective','audience','geography','placements','budgetNote','scheduleNote','headline','cta','designBrief']},
  formDraft:{type:'object',additionalProperties:false,properties:{title:{type:'string'},questions:{type:'array',minItems:2,maxItems:8,items:{type:'string'}}},required:['title','questions']},
  proposal:{type:'object',additionalProperties:false,properties:{intent:{type:'string',enum:[...require('./actionPlan').WRITE_INTENTS]},summary:string,target:{type:'object',additionalProperties:true},parameters:{type:'object',additionalProperties:true}},required:['intent','summary','target','parameters']},reason:string
 }};
 const packageMissing=require('./campaignPackage').required(context.request)&&!context.plan?.some(s=>s.artifact?.campaignDraft);
 // Complete alternatives: providers must see the required payload beside its discriminator.
 const branch=(op,keys,required=keys)=>({type:'object',additionalProperties:false,properties:Object.fromEntries(['op',...keys].map(k=>[k,k==='op'?{type:'string',enum:[op]}:next.properties[k]])),required:['op',...required]});
 const read=branch('read',['stepId','tool','args']);
 const numeric=structuredClone(next.properties.args);numeric.required=['operation','fields'];numeric.additionalProperties=false;
 numeric.properties.fields.items=next.properties.args.properties.fields.items.anyOf[1];
 numeric.properties.fields.maxItems=16;
 const numericRead=structuredClone(read);numericRead.properties.tool={type:'string',enum:['analyze_business_case']};numericRead.properties.args=numeric;
 read.properties.tool={type:'string',enum:next.properties.tool.enum.filter(t=>t!=='analyze_business_case')};
 // Do not intersect two different argument schemas through nested anyOf.
 read.properties.args={type:'object',additionalProperties:true};
 const alternatives=[branch('ask',['stepId','question']),branch('collect',['stepId','facts','knownFields'],['stepId','facts']),read,numericRead,
  branch('draft',['stepId','title','content','destination','formDraft','campaignDraft'],['stepId','title','content',...(packageMissing?['campaignDraft']:[])]),
  branch('image',['stepId','prompt','referenceMediaIds'],['stepId','prompt']),branch('meta',['stepId','proposal']),branch('review',[]),branch('finish',[]),branch('blocked',['stepId','reason'])];
 const correction=packageMissing&&['INVALID_CAMPAIGN_DRAFT','TASK_CAMPAIGN_DRAFT_REQUIRED','TASK_FORM_DRAFT_REQUIRED'].includes(context.plannerFeedback?.code)&&context.plan?.some(s=>s.kind==='draft'&&s.status==='PREPARED');
 const properties={next:{anyOf:correction?alternatives.filter(s=>s.properties.op.enum[0]==='draft'):alternatives.filter(s=>(!initial||['ask','collect','read','draft','blocked'].includes(s.properties.op.enum[0]))&&(!packageMissing||!['review','finish'].includes(s.properties.op.enum[0])))}};
 if(initial)properties.plan={type:'array',minItems:1,maxItems:12,items:{type:'object',additionalProperties:false,properties:{id:{type:'string',description:'Unique lowercase ASCII identifier, starting with a letter, then letters/digits/underscores, at most 40 characters.'},label:string,kind:{type:'string',enum:['collect','read','draft','image','meta']},dependsOn:{type:'array',items:{type:'string',description:'Id of an EARLIER step in this plan.'}},intent:{type:'string',enum:[...require('./actionPlan').WRITE_INTENTS]}},required:['id','label','kind','dependsOn']}};
 return{type:'object',additionalProperties:false,properties:initial?{plan:properties.plan,next:properties.next}:{next:properties.next},required:initial?['plan','next']:['next']};
}
module.exports={responseSchema};
