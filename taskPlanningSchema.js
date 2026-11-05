'use strict';
// Provider output constraints supplement, never replace, backend authorization/validation.
function responseSchema(context){
 const string={type:'string'},strings={type:'array',items:string};
 const initial=!context.plan?.length;
 const next={type:'object',additionalProperties:false,required:['op'],properties:{
  op:{type:'string',enum:['ask','collect','read','draft','image','meta','review','finish','blocked']},
  stepId:initial?{type:'string',description:'An id from the plan returned in this response.'}:{type:'string',enum:context.plan.map(s=>s.id)},
  question:string,facts:{type:'array',maxItems:12,items:{type:'object',additionalProperties:false,properties:{key:string,value:string,evidence:string},required:['key','value','evidence']}},knownFields:strings,
  tool:{type:'string',enum:require('./botCapabilities').READ_TOOLS},args:{type:'object',additionalProperties:true},
  title:string,content:string,destination:{type:'string',enum:['landing_page']},prompt:string,referenceMediaIds:{...strings,maxItems:4},
  formDraft:{type:'object',additionalProperties:false,properties:{title:{type:'string'},questions:{type:'array',minItems:2,maxItems:8,items:{type:'string'}}},required:['title','questions']},
  proposal:{type:'object',additionalProperties:false,properties:{intent:{type:'string',enum:[...require('./actionPlan').WRITE_INTENTS]},summary:string,target:{type:'object',additionalProperties:true},parameters:{type:'object',additionalProperties:true}},required:['intent','summary','target','parameters']},reason:string
 }};
 const properties={next};
 if(initial)properties.plan={type:'array',minItems:1,maxItems:12,items:{type:'object',additionalProperties:false,properties:{id:{type:'string',description:'Unique lowercase ASCII identifier, starting with a letter, then letters/digits/underscores, at most 40 characters.'},label:string,kind:{type:'string',enum:['collect','read','draft','image','meta']},dependsOn:{type:'array',items:{type:'string',description:'Id of an EARLIER step in this plan.'}},intent:{type:'string',enum:[...require('./actionPlan').WRITE_INTENTS]}},required:['id','label','kind','dependsOn']}};
 return{type:'object',additionalProperties:false,properties:initial?{plan:properties.plan,next}:{next},required:initial?['plan','next']:['next']};
}
module.exports={responseSchema};
