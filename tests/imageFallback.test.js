'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),axios=require('axios');
test('Gemini image billing error (402) falls back to OpenAI images when configured',async()=>{
 const env={...process.env},post=axios.post;
 Object.assign(process.env,{GRAPHICS_PROVIDER:'',GEMINI_API_KEY:'g',GEMINI_IMAGE_MODEL:'gemini-test-image',OPENAI_API_KEY:'o',OPENAI_IMAGE_MODEL:'gpt-image-test'});
 const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5e70000000049454e44ae426082','hex');
 const calls=[];
 axios.post=async(url)=>{calls.push(url);if(url.includes('generativelanguage'))throw Object.assign(Error('payment'),{response:{status:402}});return{data:{data:[{b64_json:png.toString('base64')}],usage:{}}};};
 try{
  const image=await require('../graphicService').generate('מודעה',{});
  assert.equal(image.mimeType,'image/png');assert.ok(calls[0].includes('generativelanguage'));assert.ok(calls.at(-1).includes('api.openai.com'));
  process.env.OPENAI_API_KEY='';
  await assert.rejects(require('../graphicService').generate('מודעה',{}),/GRAPHIC_PROVIDER_FAILED/);
 }finally{axios.post=post;for(const k of Object.keys(process.env))if(!(k in env))delete process.env[k];Object.assign(process.env,env);}
});
