'use strict';
const router=require('express').Router(),authority=require('./scopedAuthority');
const endpoint=work=>async(req,res)=>{
 try{await authority.withPortalOwner(req.portal,async()=>res.json(await work(req)));}
 catch(error){
  const stale=['AUTHORITY_STALE','AUTHORITY_REQUEST_CONFLICT','AUTHORITY_CONNECTION_CHANGED'].includes(error.message);
  const denied=['AUTHORITY_OWNER_REQUIRED','TENANT_CONTEXT_REQUIRED','SCOPED_AUTOMATION_DISABLED'].includes(error.message);
  res.status(denied?403:stale?409:400).json({error:denied?'הפעולה אינה זמינה לחשבון הזה.':stale?'מסגרת ההרשאה השתנתה. רעננו ובדקו אותה לפני אישור.':'בדקו את סוגי הפעולות, המגבלות ותאריך התוקף.'});
 }
};
router.get('/',endpoint(req=>authority.list(req.portal.clientId)));
router.post('/proposals',endpoint(req=>authority.propose(req.portal.clientId,req.body)));
router.post('/:id/approve',endpoint(req=>authority.approve(req.portal.clientId,req.params.id,req.body)));
router.post('/:id/revoke',endpoint(req=>authority.revoke(req.portal.clientId,req.params.id,req.body)));
module.exports=router;
