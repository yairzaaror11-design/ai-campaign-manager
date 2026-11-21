'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const sharp=require('sharp');
const overlay=require('../creativeOverlay');
const graphics=require('../graphicService');
const {openDatabase}=require('./helpers/database');

const TEXT={headline:'4 חדרים ב־2.9 מיליון ₪',price:'₪2,900,000',cta:'לתיאום סיור'};
const visual=()=>sharp({create:{width:1024,height:1024,channels:3,background:'#6A8CAF'}}).png().toBuffer();
const logoPng=()=>sharp({create:{width:300,height:120,channels:4,background:'#1F4E79FF'}}).png().toBuffer();
// Mean absolute RGB difference between two same-size images inside rows [top,bottom).
async function bandDiff(a,b,top,bottom){
 const [x,y]=await Promise.all([a,b].map(buf=>sharp(buf).removeAlpha().raw().toBuffer({resolveWithObject:true})));
 const {width,channels}=x.info;let sum=0,n=0;
 for(let row=top;row<bottom;row++)for(let i=row*width*channels;i<(row+1)*width*channels;i++){sum+=Math.abs(x.data[i]-y.data[i]);n++;}
 return sum/n;
}

test('overlay renders each Meta format at its exact size with the Hebrew text inside the safe text band',async()=>{
 const buffer=await visual();
 for(const [format,f] of Object.entries(overlay.FORMATS)){
  const plain=await overlay.render({buffer},{format});
  const out=await overlay.render({buffer},{format,text:TEXT});
  const meta=await sharp(out.buffer).metadata();
  assert.equal(out.mimeType,'image/png');assert.equal(meta.format,'png');
  assert.deepEqual([meta.width,meta.height],[f.width,f.height],format);
  const top=Math.round(f.height*f.textTop),bottom=Math.round(f.height*f.textBottom);
  assert.ok(await bandDiff(plain.buffer,out.buffer,top,bottom)>20,format+' text band changed');
  if(format==='9:16'){
   // Stories/Reels UI covers the top ~14% and bottom ~25%: no text may land there.
   assert.ok(top>=f.height*0.14&&bottom<=f.height*0.75);
   assert.equal(await bandDiff(plain.buffer,out.buffer,0,Math.round(f.height*0.14)),0,'top safe zone untouched');
  }
 }
});

test('Hebrew with numbers and ₪ is laid out right-to-left: the first word is on the right',async()=>{
 await overlay.loadFonts();
 const ink=async text=>{
  const {data,info}=await sharp({text:{text:'‏'+text,font:'Heebo ExtraBold 60',rgba:true,dpi:72}}).raw().toBuffer({resolveWithObject:true});
  return{info,alphaAt:x=>{let s=0;for(let y=0;y<info.height;y++)s+=data[(y*info.width+x)*4+3];return s;}};
 };
 // "4" alone is narrow; in RTL the leading "4" must sit at the far right of the line, ₪ at the far left.
 const full=await ink(TEXT.headline),shekel=await ink('₪'),four=await ink('4');
 assert.ok(full.info.width>shekel.info.width+four.info.width);
 const columns=Array.from({length:full.info.width},(_,x)=>full.alphaAt(x)>0);
 const left=columns.indexOf(true),right=columns.lastIndexOf(true);
 // The leftmost glyph is ₪ (wide, about as wide as its own render); the rightmost is the digit 4.
 // A glyph may render with a thin internal gap (₪ on Linux hinting): bridge gaps up to 4 columns.
 const gap=4,inkAfter=x=>columns.slice(x+1,x+1+gap).some(Boolean),inkBefore=x=>columns.slice(Math.max(0,x-gap),x).some(Boolean);
 let leftRun=left;while(leftRun<right&&inkAfter(leftRun)){leftRun++;while(!columns[leftRun])leftRun++;}
 let rightRun=right;while(rightRun>left&&inkBefore(rightRun)){rightRun--;while(!columns[rightRun])rightRun--;}
 assert.ok(Math.abs((leftRun-left+1)-shekel.info.width)<=8,'₪ on the left');
 assert.ok(Math.abs((right-rightRun+1)-four.info.width)<=8,'4 on the right');
});

test('logo is optional, placed small in a corner, and a broken logo never fails the render',async()=>{
 const buffer=await visual();
 const without=await overlay.render({buffer},{format:'1:1',text:TEXT});
 const withLogo=await overlay.render({buffer},{format:'1:1',text:TEXT,logo:{buffer:await logoPng()}});
 assert.ok(await bandDiff(without.buffer,withLogo.buffer,40,180)>5,'logo drawn in the top corner');
 assert.equal(await bandDiff(without.buffer,withLogo.buffer,300,1080),0,'logo stays small');
 const broken=await overlay.render({buffer},{format:'1:1',text:TEXT,logo:{buffer:Buffer.from('not an image')}});
 assert.equal((await sharp(broken.buffer).metadata()).width,1080);
});

test('image text and formats are validated',()=>{
 assert.equal(overlay.textSpec(undefined),null);assert.equal(overlay.textSpec({headline:'  '}),null);
 assert.deepEqual(overlay.textSpec({headline:' מבצע‮ קיץ ',cta:'לפרטים',price:99}),{headline:'מבצע קיץ',price:'99',cta:'לפרטים'});
 assert.throws(()=>overlay.textSpec({headline:'א'.repeat(91)}),/INVALID_IMAGE_TEXT/);
 assert.throws(()=>overlay.textSpec('כותרת'),/INVALID_IMAGE_TEXT/);
 assert.deepEqual(overlay.formatList(undefined),['1:1']);
 assert.throws(()=>overlay.formatList(['16:9']),/INVALID_GRAPHIC_FORMATS/);
 assert.throws(()=>overlay.formatList(['1:1','1:1']),/INVALID_GRAPHIC_FORMATS/);
});

test('the image model is told to draw no text and to leave space for the headline',async()=>{
 const before={p:process.env.GRAPHICS_PROVIDER,k:process.env.OPENAI_API_KEY,m:process.env.OPENAI_IMAGE_MODEL};
 process.env.GRAPHICS_PROVIDER='openai';process.env.OPENAI_API_KEY='sk-test';process.env.OPENAI_IMAGE_MODEL='gpt-image-test';
 const axios=require('axios'),post=axios.post,prompts=[];
 axios.post=async(_url,body)=>{prompts.push(body.prompt);return{data:{data:[{b64_json:(await visual()).toString('base64')}]}};};
 try{
  await graphics.generate('דירת 4 חדרים');await graphics.generate('דירת 4 חדרים',{reserveTextSpace:true});
  assert.match(prompts[0],/Do not render any text, letters, words, numbers/);assert.doesNotMatch(prompts[0],/render any Hebrew text/i);
  assert.match(prompts[1],/lower third .* headline is placed there later/);
 }finally{axios.post=post;for(const [k,v] of [['GRAPHICS_PROVIDER',before.p],['OPENAI_API_KEY',before.k],['OPENAI_IMAGE_MODEL',before.m]])if(v===undefined)delete process.env[k];else process.env[k]=v;}
});

test('createGraphic overlays text, returns the 1:1 media by default and all formats on request, deduplicated',async()=>{
 const harness=await openDatabase();const {db}=harness;const previous=process.env.GRAPHICS_ENABLED;process.env.GRAPHICS_ENABLED='true';
 try{
  const client=(await db.query("INSERT INTO clients(phone) VALUES('972500000071') RETURNING id")).rows[0].id;
  const meta=require('../metaConnection'),delivery=require('../whatsappDelivery');
  const run=(event,work)=>meta.context.run(String(client),()=>delivery.messageContext.run({eventId:event,sequence:0},work));
  const base=await visual(),uploads=[],calls=[];let n=0;
  const adapter={generateImage:async(_p,options)=>{calls.push(options);return{buffer:base,mimeType:'image/png'};},uploadImage:async image=>{uploads.push(image);return String(++n);},loadBrand:async()=>({logo:{buffer:await logoPng()},accent:'#1F4E79'})};
  const single=await run('overlay-1',()=>graphics.createGraphic(client,'מודעה לדירה',{...adapter,imageText:TEXT}));
  assert.equal(single.mime_type,'image/png');assert.equal(single.formats,undefined);assert.equal(calls[0].reserveTextSpace,true);
  assert.deepEqual([(await sharp(uploads[0].buffer).metadata()).width,(await sharp(uploads[0].buffer).metadata()).height],[1080,1080]);
  const multi=await run('overlay-2',()=>graphics.createGraphic(client,'מודעה לדירה',{...adapter,imageText:TEXT,formats:['1:1','4:5','9:16']}));
  assert.deepEqual(Object.keys(multi.formats),['1:1','4:5','9:16']);assert.equal(multi.formats['1:1'].id,multi.id);
  assert.equal(calls.length,2,'one generation for all formats');assert.equal(uploads.length,4);
  assert.deepEqual(await Promise.all(uploads.slice(1).map(async u=>(await sharp(u.buffer).metadata()).height)),[1080,1350,1920]);
  const again=await run('overlay-2',()=>graphics.createGraphic(client,'מודעה לדירה',{...adapter,imageText:TEXT,formats:['1:1','4:5','9:16']}));
  assert.equal(calls.length,2);assert.deepEqual(Object.fromEntries(Object.entries(again.formats).map(([k,v])=>[k,v.id])),Object.fromEntries(Object.entries(multi.formats).map(([k,v])=>[k,v.id])));
  await assert.rejects(require('../mediaStore').loadMedia(client+1,multi.formats['9:16'].id),/MEDIA_EXPIRED_OR_NOT_OWNED/);
  // No text and no formats: the provider visual is stored untouched, exactly as before.
  await run('overlay-3',()=>graphics.createGraphic(client,'תמונה אורגנית',adapter));assert.equal(uploads.at(-1).buffer,base);
  await assert.rejects(run('overlay-4',()=>graphics.createGraphic(client,'מודעה',{...adapter,formats:['2:1']})),/INVALID_GRAPHIC_FORMATS/);
 }finally{if(previous===undefined)delete process.env.GRAPHICS_ENABLED;else process.env.GRAPHICS_ENABLED=previous;await harness.close();}
});
