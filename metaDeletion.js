'use strict';
const crypto = require('node:crypto');
const express = require('express');
const db = require('./db');
const router = express.Router();
router.use(express.urlencoded({extended:false,limit:'16kb'}));
function verifySignedRequest(value) {
  const parts = String(value || '').split('.');
  if (parts.length!==2 || !process.env.META_APP_SECRET) throw Error('INVALID_SIGNATURE');
  const signature = Buffer.from(parts[0],'base64url');
  const expected = crypto.createHmac('sha256',process.env.META_APP_SECRET).update(parts[1]).digest();
  if (signature.length!==expected.length || !crypto.timingSafeEqual(signature,expected)) throw Error('INVALID_SIGNATURE');
  const data = JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  if (data.algorithm!=='HMAC-SHA256' || !/^\d+$/.test(data.user_id) || !Number.isFinite(data.issued_at) || Math.abs(Date.now()/1000-data.issued_at)>600) throw Error('INVALID_REQUEST');
  return data;
}
async function deleteClient(clientId, tx) {
  await tx('DELETE FROM campaign_journal WHERE client_id=$1',[clientId]);
  await tx('DELETE FROM clients WHERE id=$1',[clientId]);
}
router.post('/deletion',async(req,res)=>{
  try {
    const signed = verifySignedRequest(req.body.signed_request);
    const confirmation = crypto.randomBytes(24).toString('hex');
    await db.transaction(async tx=>{
      const rows = await tx('SELECT client_id FROM meta_connections WHERE meta_user_id=$1 FOR UPDATE',[signed.user_id]);
      for (const row of rows.rows) await deleteClient(row.client_id,tx);
    });
    res.json({url:require('./metaConnection').config().origin+'/data-deletion',confirmation_code:confirmation});
  } catch { res.status(400).json({error:'Deletion request could not be completed'}); }
});
module.exports = {router,verifySignedRequest,deleteClient};
