'use strict';
const db=require('./db');
const crypto=require('crypto');
async function saveMedia(clientId,media) {
 const id=crypto.randomUUID();
 await db.query(`INSERT INTO tenant_media(id,client_id,whatsapp_media_id,media_type,mime_type,caption,expires_at) VALUES($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '1 day')`,[id,clientId,media.mediaId,media.type,media.mimeType,media.caption.slice(0,2000)]);
 return id;
}
async function listMedia(clientId) {
 return (await db.query('SELECT id,media_type,mime_type,caption FROM tenant_media WHERE client_id=$1 AND expires_at>NOW() ORDER BY created_at DESC LIMIT 20',[clientId])).rows;
}
async function loadMedia(clientId,id) {
 if(!/^[a-f0-9-]{36}$/i.test(id)) throw Error('INVALID_MEDIA_REFERENCE');
 const result=await db.query('SELECT * FROM tenant_media WHERE id=$1 AND client_id=$2 AND expires_at>NOW()',[id,clientId]);
 if(!result.rows.length) throw Error('MEDIA_EXPIRED_OR_NOT_OWNED');
 return result.rows[0];
}
module.exports={saveMedia,listMedia,loadMedia};
