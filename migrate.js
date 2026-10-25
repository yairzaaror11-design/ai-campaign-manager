'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
async function migrate(transaction) {
  return transaction(async tx=>{
    await tx('SELECT pg_advisory_xact_lock(874223001)');
    await tx('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    for (const name of fs.readdirSync(path.join(__dirname,'migrations')).filter(n=>/^\d+.*\.sql$/.test(n)).sort()) {
      const sql=fs.readFileSync(path.join(__dirname,'migrations',name),'utf8');
      const checksum=crypto.createHash('sha256').update(sql).digest('hex');
      const applied=await tx('SELECT checksum FROM schema_migrations WHERE name=$1',[name]);
      if (applied.rows.length) {
        if(applied.rows[0].checksum!==checksum) throw Error('MIGRATION_CHECKSUM_MISMATCH');
        continue;
      }
      await tx(sql);
      await tx('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,checksum]);
    }
  });
}
module.exports={migrate};
