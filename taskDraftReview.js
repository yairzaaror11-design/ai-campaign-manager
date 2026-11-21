'use strict';
function formDraft(value){
 if(!value||Object.keys(value).some(k=>!['title','questions'].includes(k))||typeof value.title!=='string'||!value.title.trim()||value.title.length>120||!Array.isArray(value.questions)||value.questions.length<2||value.questions.length>8||value.questions.some(q=>typeof q!=='string'||!q.trim()||q.length>180))throw Error('INVALID_FORM_DRAFT');
 return{title:value.title.trim(),questions:value.questions.map(q=>q.trim())};
}
function hasForm(artifact){
 if(!artifact)return false;
 try{if(artifact.formDraft){formDraft(artifact.formDraft);return true;}}catch{return false;}
 // Preserve existing fully specified, reviewed JSON form drafts.
 try{require('./metaLeadForms').validate(JSON.parse(artifact.content));return true;}catch{return false;}
}
function issue(task){
 if(/דרושים|מועמדות|גיוס/u.test(task.request)&&/מודעה/u.test(task.request)&&/טופס/u.test(task.request)&&!task.state.steps.some(s=>s.artifact&&hasForm(s.artifact)))return 'TASK_FORM_DRAFT_REQUIRED';
 return require('./campaignPackage').issue(task);
}
function feedback(code='TASK_FORM_DRAFT_REQUIRED'){if(code!=='TASK_FORM_DRAFT_REQUIRED')return require('./campaignPackage').feedback(code);return{code:'TASK_FORM_DRAFT_REQUIRED',instruction:'The owner requested both an ad and an applicant form. The package has no concrete form draft. Keep existing step IDs and completed effects. Revise a prepared draft step to include formDraft:{title,questions:[string,...]} with concrete contact and job-relevant questions, or prepare an already-planned pending form draft. Do not create a provider form yet, infer job requirements or request package approval until this draft is present. For a whole campaign ALSO include campaignDraft:{objective,audience,geography,placements,budgetNote,scheduleNote,headline,cta,designBrief,referenceMediaIds?:[]}; each setting at most 400 characters, headline/cta at most 100. The server generates the graphic from these fields.'};}
module.exports={formDraft,hasForm,issue,feedback};
