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
function middleware(prefix,limit=30) {
 return async(req,res,next)=>{
   try {if(!await take(prefix+':'+req.ip,limit)) return res.status(429).json({error:'Too many requests'});next();}
   catch {res.status(503).json({error:'Temporarily unavailable'});}
 };
}
module.exports={take,middleware};
