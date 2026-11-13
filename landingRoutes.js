'use strict';
const router=require('express').Router();
router.get('/landing.js',(req,res)=>res.type('application/javascript').send(`'use strict';const form=document.getElementById('contact-form'),status=document.getElementById('form-status');const eventId=crypto.randomUUID();form.addEventListener('submit',async e=>{e.preventDefault();const button=form.querySelector('button');button.disabled=true;try{const f=new FormData(form);const r=await fetch(location.pathname+'/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...Object.fromEntries(f),consent:f.get('consent')==='on',eventId})});if(!r.ok)throw Error('לא ניתן לשלוח כרגע. בדקו את הפרטים ונסו שוב.');form.hidden=true;status.textContent='הפנייה נשלחה. העסק יוכל לחזור אליכם לפי הפרטים שמסרתם.';}catch(e){status.textContent=e.message;button.disabled=false;}});`));
router.get('/p/:slug',require('./rateLimit').middleware('landing-read',120),async(req,res)=>{
 try{const page=await require('./landingService').get(req.params.slug);res.set({'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",'Cache-Control':'no-store'}).type('html').send(require('./landingService').html(page));}catch{res.sendStatus(404);}
});
router.post('/p/:slug/lead',require('./rateLimit').middleware('landing-submit',10),async(req,res)=>{
 try{if(req.headers.origin!==require('./portalStore').origin()||!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return res.sendStatus(403);await require('./landingService').submit(req.params.slug,req.body);res.json({ok:true});}catch{res.status(400).json({error:'לא ניתן לשמור את הפנייה. בדקו את הפרטים ונסו שוב.'});}
});
module.exports=router;
