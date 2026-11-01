'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {page}=require('../metaConnectPage');
function browser({hash='',response={ok:false},networkError=false}={}){
 const elements=Object.fromEntries(['connect','copy','recovery','status','title','intro'].map(id=>[id,{hidden:false,disabled:false,textContent:'',handlers:{},classList:{add(){}},setAttribute(){},removeAttribute(){},addEventListener(type,fn){this.handlers[type]=fn;}}]));
 let calls=0,redirect=null,clean=null;
 const html=page({nonce:'test',management:true}),script=html.match(/<script nonce="test">([\s\S]+?)<\/script>/)[1];
 vm.runInNewContext(script,{document:{getElementById:id=>elements[id]},location:{hash,pathname:'/auth/meta/connect',search:'?mode=manage',assign:value=>redirect=value},history:{replaceState:(_a,_b,value)=>clean=value},navigator:{clipboard:{writeText:async()=>{}}},URL,fetch:async(_url,options)=>{calls++;assert.equal(JSON.parse(options.body).invite,hash.slice(1));if(networkError)throw Error('offline');return{ok:response.ok,json:async()=>({url:response.url})};}});
 return{elements,get calls(){return calls;},get redirect(){return redirect;},get clean(){return clean;}};
}
test('expired/missing link stays readable, removes bearer fragment and never starts OAuth',()=>{
 const b=browser({hash:'#invalid'});assert.equal(b.calls,0);assert.equal(b.elements.connect.hidden,true);assert.equal(b.elements.recovery.hidden,false);assert.match(b.elements.title.textContent,/קישור חדש/);assert.equal(b.clean,'/auth/meta/connect?mode=manage');
});
test('valid link waits for explicit click and redirects only to official Facebook',async()=>{
 const b=browser({hash:'#'+'a'.repeat(43),response:{ok:true,url:'https://www.facebook.com/v26.0/dialog/oauth?state=example'}});assert.equal(b.calls,0);await b.elements.connect.handlers.click();assert.equal(b.calls,1);assert.match(b.redirect,/^https:\/\/www.facebook.com\//);
 const wrong=browser({hash:'#'+'a'.repeat(43),response:{ok:true,url:'https://attacker.example'}});await wrong.elements.connect.handlers.click();assert.equal(wrong.redirect,null);assert.equal(wrong.elements.connect.disabled,false);
});
test('server rejection and network failure show actionable recovery instead of a dead button',async()=>{
 const expired=browser({hash:'#'+'a'.repeat(43)});await expired.elements.connect.handlers.click();assert.equal(expired.elements.connect.hidden,true);assert.equal(expired.elements.recovery.hidden,false);
 const offline=browser({hash:'#'+'a'.repeat(43),networkError:true});await offline.elements.connect.handlers.click();assert.equal(offline.elements.connect.disabled,false);assert.match(offline.elements.status.textContent,/אינטרנט/);
});
test('OAuth HTML is mobile-sized and nonce protected for connection, success and failure pages',async()=>{
 const h=await require('./helpers/database').openDatabase();
 const app=require('express')();app.use('/auth/meta',require('../metaOAuth'));const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);});
 try{const base='http://127.0.0.1:'+server.address().port;for(const path of ['/auth/meta/connect?mode=manage','/auth/meta/callback']){const r=await fetch(base+path),html=await r.text();assert.equal(r.status,path.includes('callback')?400:200);assert.match(html,/name="viewport" content="width=device-width, initial-scale=1"/);assert.match(html,/SCORPIO AI/);const nonce=html.match(/<style nonce="([^"]+)">/)[1];assert.ok(r.headers.get('content-security-policy').includes("style-src 'nonce-"+nonce+"'"));assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(html.includes('https://fonts.'),false);}}
 finally{await new Promise(resolve=>server.close(resolve));await h.close();}
 assert.match(page({nonce:'test',state:'done',title:'<img onerror=evil>'}),/&lt;img onerror=evil&gt;/);
});
