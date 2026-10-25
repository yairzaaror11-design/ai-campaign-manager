'use strict';
const db=require('./db');
async function campaignReport(clientId,preset='last_7d') {
 const meta=require('./metaConnection');
 if(String(meta.context.getStore())!==String(clientId)) throw Error('TENANT_CONTEXT_REQUIRED');
 if(!['today','yesterday','last_7d','last_14d','last_30d','this_month','last_month'].includes(preset)) throw Error('INVALID_REPORT_PERIOD');
 const c=await meta.credentials(clientId);
 if(!c.meta_ad_account_id) throw Error('ACCOUNT_SELECTION_REQUIRED');
 const account=await meta.graph('/'+c.meta_ad_account_id,c.token,{fields:'id,name,currency'});
 const report=await require('./metaAds').getCampaignPerformance(c.meta_ad_account_id,preset);
 if(report.paging?.next) throw Error('REPORT_REQUIRES_PAGINATION');
 const rows=report.data || [];
 const sum=key=>rows.reduce((total,row)=>{const n=Number(row[key] || 0);if(!Number.isFinite(n)||n<0) throw Error('INVALID_META_METRICS');return total+n;},0);
 const totals={spend:sum('spend'),impressions:sum('impressions'),clicks:sum('clicks')};
 const payload={account:{id:account.id,name:account.name,currency:account.currency},preset,totals,campaigns:rows};
 const id=require('crypto').randomUUID();
 await db.query('INSERT INTO performance_snapshots(id,client_id,account_id,date_preset,payload) VALUES($1,$2,$3,$4,$5::jsonb)',[id,clientId,c.meta_ad_account_id,preset,JSON.stringify(payload)]);
 return 'דוח '+preset+' — '+account.name+' ('+c.meta_ad_account_id+')\nהוצאה: '+totals.spend.toFixed(2)+' '+account.currency+'\nחשיפות: '+totals.impressions+'\nקליקים: '+totals.clicks+'\nקמפיינים בדוח: '+rows.length+'\nמזהה דוח: '+id+'\nנתונים כפי שהתקבלו מ־Meta; ייתכנו עיכובי דיווח.';
}
module.exports={campaignReport};
