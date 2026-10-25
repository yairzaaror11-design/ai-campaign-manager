'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');
const meta=require('../metaConnection'),delivery=require('../whatsappDelivery'),graphics=require('../graphicService');
test('generated graphics are tenant-scoped, attempt-once, reusable as media and gated by the WhatsApp reply window',async()=>{
 const harness=await openDatabase();const {db}=harness;const previous={graphics:process.env.GRAPHICS_ENABLED,sends:process.env.WHATSAPP_SEND_ENABLED};
 process.env.GRAPHICS_ENABLED='true';process.env.WHATSAPP_SEND_ENABLED='true';
 try {
 const a=(await db.query("INSERT INTO clients(phone) VALUES('972500000001') RETURNING id")).rows[0].id;
 const b=(await db.query("INSERT INTO clients(phone) VALUES('972500000002') RETURNING id")).rows[0].id;
 let generated=0,uploaded=0,sent=0;
 const adapter={generateImage:async()=>{generated++;return {buffer:Buffer.alloc(20),mimeType:'image/png'};},uploadImage:async()=>{uploaded++;return '123456';}};
 const run=(id,event,work)=>meta.context.run(String(id),()=>delivery.messageContext.run({eventId:event,sequence:0},work));
 const asset=await run(a,'graphic-1',()=>graphics.createGraphic(a,'A business campaign graphic',adapter));
 const again=await run(a,'graphic-1',()=>graphics.createGraphic(a,'A business campaign graphic',adapter));
 assert.equal(asset.id,again.id);assert.equal(generated,1);assert.equal(uploaded,1);
 await assert.rejects(require('../mediaStore').loadMedia(b,asset.id),/MEDIA_EXPIRED_OR_NOT_OWNED/);
 await assert.rejects(run(b,'graphic-2',()=>graphics.createGraphic(a,'Other client prompt',adapter)),/GRAPHIC_CONTEXT_REQUIRED/);
 await run(a,'graphic-send',()=>delivery.enqueue('972500000001',{type:'image',image:{id:asset.whatsapp_media_id}}));
 assert.equal((await delivery.runOne({transport:async()=>{sent++;return {messages:[{id:'x'}]};}})).status,'BLOCKED');assert.equal(sent,0);
 await delivery.recordInbound({from:'972500000001',timestamp:String(Math.floor(Date.now()/1000))});
 await run(a,'graphic-send-2',()=>delivery.enqueue('972500000001',{type:'image',image:{id:asset.whatsapp_media_id}}));
 assert.equal((await delivery.runOne({transport:async()=>{sent++;return {messages:[{id:'wamid.graphic'}]};}})).status,'SENT');assert.equal(sent,1);
 await assert.rejects(run(a,'graphic-failed',()=>graphics.createGraphic(a,'Failed provider request',{...adapter,generateImage:async()=>{throw Error('provider unavailable');}})));
 await assert.rejects(run(a,'graphic-failed',()=>graphics.createGraphic(a,'Retry same event',adapter)),/GRAPHIC_ALREADY_ATTEMPTED/);assert.equal(generated,1);
 process.env.GRAPHICS_ATTEMPT_LIMIT='2';
 await assert.rejects(run(a,'graphic-over-limit',()=>graphics.createGraphic(a,'Over pilot limit',adapter)),/GRAPHIC_PILOT_LIMIT/);assert.equal(generated,1);
 delete process.env.GRAPHICS_ATTEMPT_LIMIT;
 await db.query('DELETE FROM clients WHERE id=$1',[a]);assert.equal((await db.query('SELECT * FROM graphic_jobs WHERE client_id=$1',[a])).rows.length,0);
 } finally {process.env.GRAPHICS_ENABLED=previous.graphics;process.env.WHATSAPP_SEND_ENABLED=previous.sends;await harness.close();}
});
test('Hebrew and explicit graphic requests route without turning campaign requests into images',()=>{
 assert.match(graphics.graphicPrompt('צור לי גרפיקה לבית קפה'),/בית קפה/);
 assert.equal(graphics.graphicPrompt('/graphic blue square banner'),'blue square banner');
 assert.equal(graphics.graphicPrompt('בנה קמפיין לידים'),null);
});
