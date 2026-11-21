'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {openDatabase}=require('./helpers/database');
test('durable queue order serializes one sender while allowing another sender to proceed',async()=>{
 const h=await openDatabase();
 try{
  const inbound=require('../whatsappInboundStore');
  const make=(eventId,from)=>({eventId,payload:{message:{id:eventId,from,timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'test'}}}});
  // Deliberately reverse lexical IDs and share a transaction timestamp.
  await inbound.enqueueInboundEvents([make('z-first','972501001111'),make('a-second','972501001111'),make('b-other','972501002222')]);
  const first=await inbound.claimNextInboundEvent();assert.equal(first.event_id,'z-first');
  const other=await inbound.claimNextInboundEvent();assert.equal(other.event_id,'b-other');
  assert.equal(await inbound.claimNextInboundEvent(),null);
  await inbound.markInboundDone(first.event_id);const second=await inbound.claimNextInboundEvent();assert.equal(second.event_id,'a-second');
  assert.equal((await inbound.enqueueInboundEvents([make('z-first','972501001111')])).inserted,0);
  const client=await require('../clientStore').getOrCreateClient('972501003333');
  const delivery=require('../whatsappDelivery'),meta=require('../metaConnection');
  await delivery.recordInbound({from:client.phone,timestamp:String(Math.floor(Date.now()/1000))});
  await meta.context.run(String(client.id),()=>delivery.messageContext.run({eventId:'ordered-output',sequence:0},async()=>{
   await delivery.enqueue(client.phone,delivery.textPayload('הבקשה התקבלה'));
   await delivery.enqueue(client.phone,delivery.textPayload('התוצאה מוכנה'));
  }));
  const old=process.env.WHATSAPP_SEND_ENABLED;process.env.WHATSAPP_SEND_ENABLED='true';
  try{const sent=[];for(let i=0;i<2;i++)assert.equal((await delivery.runOne({transport:async(_to,payload)=>{sent.push(payload.text.body);return{messages:[{id:'mock-'+sent.length}]};}})).status,'SENT');
   assert.deepEqual(sent,['הבקשה התקבלה','התוצאה מוכנה']);
  }finally{if(old===undefined)delete process.env.WHATSAPP_SEND_ENABLED;else process.env.WHATSAPP_SEND_ENABLED=old;}
 }finally{await h.close();}
});
