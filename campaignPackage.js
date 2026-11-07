'use strict';
const IMAGE_ID='campaign_package_image';
function required(request,planningMode){if(require('./planningIntent').isDiscovery({request,planningMode}))return false;return /קמפיין/u.test(request)&&!/^(?:תכין|תכיני|הכן)(?: לי)?\s+(?:רק\s+)?(?:דוח|דו[״"]?ח|סיכום|ניתוח|בדיקה|סטטוס|אסטרטגיה|תוכנית|תכנית|תכנון|נוסח|טקסט|מודעה|גרפיקה|תמונה|טופס)/u.test(request)&&/תכין|תכיני|תיצור|תיצרי|צור|צרי|בנה|בני|הכן|תקים|להקים|לבנות|תעשה|אני רוצה|אני צריך|טיוטת|טיוטה|חבילת|קמפיין חדש/u.test(request)&&!/קמפיין ריק|מסגרת קמפיין|רק\s+(?:נוסח|טקסט)|בלי גרפיקה|ללא גרפיקה|בלי תמונות|ללא תמונות|לא צריך גרפיקה|לא צריך תמונה/u.test(request);}
function checked(value){
 const fields=['objective','audience','geography','placements','budgetNote','scheduleNote','headline','cta','designBrief'];
 const invalid=fields.filter(k=>typeof value?.[k]!=='string'||!value[k].trim()),overLimit=fields.filter(k=>typeof value?.[k]==='string'&&value[k].length>(['headline','cta'].includes(k)?100:400)),unknownCount=value&&typeof value==='object'?Object.keys(value).filter(k=>!fields.includes(k)&&k!=='referenceMediaIds').length:0;
 if(!value||invalid.length||overLimit.length||unknownCount)throw Object.assign(Error('INVALID_CAMPAIGN_DRAFT'),{contractIssue:{missing:!value,invalid,overLimit,unknownCount}});
 const ids=value.referenceMediaIds||[];
 if(!Array.isArray(ids)||ids.length>4||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)))throw Error('INVALID_REFERENCE_IMAGES');
 return{...Object.fromEntries(fields.map(k=>[k,value[k].trim()])),referenceMediaIds:ids};
}
function draft(task){return task.state.steps.map(s=>s.artifact?.campaignDraft).find(Boolean);}
function ensure(task){
 if(!required(task.request,task.state.planningMode)||!task.state.steps.length||task.state.campaignPackageVersion===1)return;
 // Server-owned preparation upgrade only, before external work or uncertainty.
 if(task.state.steps.some(s=>s.kind==='meta'&&s.status!=='PENDING'||['RUNNING','WAITING_APPROVAL','STALE'].includes(s.status)))return;
 const firstMeta=task.state.steps.findIndex(s=>s.kind==='meta'),at=firstMeta<0?task.state.steps.length:firstMeta;
 const drafts=task.state.steps.slice(0,at).filter(s=>s.kind==='draft');if(!drafts.length)return;
 const lastDraft=Math.max(...drafts.map(d=>task.state.steps.indexOf(d)));
 let image=task.state.steps.slice(0,at).find((s,i)=>s.kind==='image'&&s.status==='PENDING'&&i>lastDraft);
 if(!image){
  if(task.state.steps.length>=12||task.state.steps.some(s=>s.id===IMAGE_ID))throw Error('CAMPAIGN_PACKAGE_PLAN_LIMIT');
  image={id:IMAGE_ID,label:'גרפיקה עם כיתוב למודעה',kind:'image',dependsOn:drafts.map(s=>s.id),status:'PENDING'};
  task.state.steps.splice(at,0,image);
 }
 for(const d of drafts)if(!image.dependsOn.includes(d.id))image.dependsOn.push(d.id);
 image.packageImage=true;
 for(const step of task.state.steps)if(step.kind==='meta'&&step.status==='PENDING'&&!step.dependsOn.includes(image.id))step.dependsOn.push(image.id);
 const bundle=task.state.steps.find(s=>s.kind==='meta'&&['CREATE_BUNDLE','CREATE_CREATIVE','CREATE_AD'].includes(s.intent));
 if(bundle){
  let upload=task.state.steps.find(s=>s.kind==='meta'&&s.intent==='UPLOAD_IMAGE'&&s.status==='PENDING');
  if(!upload){if(task.state.steps.length>=12||task.state.steps.some(s=>s.id==='campaign_package_upload'))throw Error('CAMPAIGN_PACKAGE_PLAN_LIMIT');upload={id:'campaign_package_upload',label:'העלאת הגרפיקה המאושרת לחשבון הפרסום',kind:'meta',intent:'UPLOAD_IMAGE',dependsOn:[image.id],status:'PENDING'};task.state.steps.splice(task.state.steps.indexOf(bundle),0,upload);}
  upload.packageUpload=true;if(!upload.dependsOn.includes(image.id))upload.dependsOn.push(image.id);
  if(!bundle.dependsOn.includes(upload.id))bundle.dependsOn.push(upload.id);
 }
 task.state.campaignPackageVersion=1;
}
function issue(task){
 if(!required(task.request,task.state.planningMode))return null;
 const d=draft(task);if(!d)return 'TASK_CAMPAIGN_DRAFT_REQUIRED';
 try{checked(d);}catch{return 'INVALID_CAMPAIGN_DRAFT';}
 const image=task.state.steps.find(s=>s.packageImage&&s.kind==='image');
 if(!image?.artifact?.mediaId||!image.artifact.imageText||image.artifact.imageText.headline!==d.headline||image.artifact.imageText.cta!==d.cta||!['PREPARED','DONE'].includes(image.status))return 'TASK_CAMPAIGN_GRAPHIC_REQUIRED';
 return null;
}
function feedback(code){return{code,instruction:'Prepare the complete campaign package, not just copy. Keep accepted step IDs. Revise an existing draft with campaignDraft:{objective,audience,geography,placements,budgetNote,scheduleNote,headline,cta,designBrief,referenceMediaIds?:[]}, concrete ad content and requested formDraft. All setting strings at most 400 characters, headline/cta at most 100; all nine fields are mandatory. The audience must match this goal (applicants for recruitment). Unprovided budget/schedule stay explicitly not set; recommendations are proposals, not authority. Headline/cta are the exact short Hebrew text for the graphic. The server owns the packageImage step and generates it after the draft; do not add duplicate image steps or request review before it exists. Meta creation and activation still require separate approvals.'};}
function imageDecision(task,ready){
 if(!required(task.request,task.state.planningMode))return null;const d=draft(task),step=task.state.steps.find(s=>s.packageImage&&s.status==='PENDING');
 if(!d||!step||!ready(task,step))return null;const p=checked(d);
 return{next:{op:'image',stepId:step.id,prompt:[p.designBrief,'Create one advertisement graphic. Render this exact Hebrew headline and CTA legibly, right-to-left, without extra text: '+JSON.stringify({headline:p.headline,cta:p.cta}),'Use supplied owned references as visual brand/product references. Do not invent a logo, salary, guarantees or requirements.'].join('\n').slice(0,2000),referenceMediaIds:p.referenceMediaIds,imageText:{headline:p.headline,cta:p.cta}}};
}
function render(d){return '\n\nטיוטת הגדרות קמפיין — לא הופעל פרסום\nמטרה: '+d.objective+'\nקהל מוצע: '+d.audience+'\nאזור: '+d.geography+'\nמיקומים מוצעים: '+d.placements+'\nתקציב: '+d.budgetNote+'\nתזמון: '+d.scheduleNote;}
module.exports={required,checked,ensure,issue,feedback,imageDecision,render};
