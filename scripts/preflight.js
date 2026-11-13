'use strict';
require('dotenv').config();
const db=require('../db');
async function main() {
 require('../runtimeConfig').validateRuntime();
 if(!process.env.DATABASE_URL) throw Error('DATABASE_URL_REQUIRED');
 if(process.env.READ_ONLY!=='true'||process.env.META_WRITES_ENABLED==='true'||process.env.WHATSAPP_SEND_ENABLED==='true') throw Error('PREFLIGHT_REQUIRES_SAFETY_LOCKS');
 const connection=await db.databaseStatus();
 if(!connection.connected) throw Error('DATABASE_UNREACHABLE');
 const schemas=await db.query("SELECT to_regclass('public.schema_migrations') AS migrations,to_regclass('public.campaign_briefs') AS briefs");
 const applied=schemas.rows[0].migrations?(await db.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(r=>r.name):[];
 const pending=require('fs').readdirSync(require('path').join(__dirname,'../migrations')).filter(n=>n.endsWith('.sql')&&!applied.includes(n));
 let duplicates=0;
 if(schemas.rows[0].briefs) duplicates=Number((await db.query("SELECT COUNT(*) AS count FROM (SELECT client_id FROM campaign_briefs WHERE status IN ('COLLECTING','REVIEW') GROUP BY client_id HAVING COUNT(*)>1) conflicts")).rows[0].count);
 console.log(JSON.stringify({configuration:'valid',database:'connected',pendingMigrations:pending,duplicateOpenBriefTenants:duplicates,productionDeployAuthorized:false,backupRestoreTestRequired:true}));
 if(duplicates) process.exitCode=1;
}
main().catch(error=>{console.error(/^[A-Z0-9_]+$/.test(error.message)?error.message:'PREFLIGHT_FAILED');process.exitCode=1;}).finally(()=>db.closeDatabase());
