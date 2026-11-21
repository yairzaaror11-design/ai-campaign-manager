'use strict';
const crypto=require('node:crypto');
const db=require('./db');
async function take(key,limit=30,seconds=60) {
 const bucket=crypto.createHash('sha256').update(key).digest('hex');
 const result=await db.query(`INSERT INTO api_rate_limits(bucket,attempts,expires_at) VALUES($1,1,NOW()+($2::integer*INTERVAL '1 second'))
   ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN api_rate_limits.expires_at<NOW() THEN 1 ELSE api_rate_limits.attempts+1 END,
   expires_at=CASE WHEN api_rate_limits.expires_at<NOW() THEN EXCLUDED.expires_at ELSE api_rate_limits.expires_at END RETURNING attempts`,[bucket,seconds]);
 return result.rows[0].attempts<=limit;
}
// Local demo / E2E only: RATE_LIMIT_SCALE multiplies every limit (many test browsers share one IP).
// Ignored in production.
function scale(){const n=Number(process.env.RATE_LIMIT_SCALE);return process.env.NODE_ENV!=='production'&&Number.isFinite(n)&&n>1?Math.min(n,1000):1;}
function middleware(prefix,limit=30) {
 return async(req,res,next)=>{
   try {if(!await take(prefix+':'+req.ip,limit*scale())) return res.status(429).json({error:'יותר מדי פעולות בזמן קצר. נסו שוב בעוד דקה.'});next();}
   catch {res.status(503).json({error:'השירות לא זמין לרגע. נסו שוב בעוד רגע.'});}
 };
}
module.exports={take,middleware,scale};
