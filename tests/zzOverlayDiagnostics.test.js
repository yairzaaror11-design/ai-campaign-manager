'use strict';
// TEMPORARY: prints how the Hebrew overlay font stack behaves on this machine (CI Linux vs macOS).
const test=require('node:test');
test('overlay font diagnostics (temporary)',async()=>{
 let sharp;try{sharp=require('sharp');}catch(e){console.log('DIAG no sharp',e.message);return;}
 console.log('DIAG versions',JSON.stringify(sharp.versions),process.platform,process.arch);
 const path=require('path');const dir=path.join(path.dirname(require.resolve('@fontsource/heebo/package.json')),'files');
 const files={he:path.join(dir,'heebo-hebrew-800-normal.woff'),la:path.join(dir,'heebo-latin-800-normal.woff')};
 for(const [k,f] of Object.entries(files)){for(const t of ['4','ח','₪','4 ח ₪']){try{const m=await sharp({text:{text:t,font:'Heebo 80',fontfile:f,rgba:true}}).png().toBuffer({resolveWithObject:true});console.log('DIAG',k,JSON.stringify(t),m.info.width,m.info.height);}catch(e){console.log('DIAG err',k,t,e.message.slice(0,120));}}}
 try{const ov=require('../creativeOverlay');console.log('DIAG overlay exports',Object.keys(ov).join(','));}catch(e){console.log('DIAG overlay load',e.message);}
});
