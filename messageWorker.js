'use strict';
require('dotenv').config();
async function main() {
 require('./runtimeConfig').validateRuntime();
 if(!process.env.DATABASE_URL) throw Error('DATABASE_URL_REQUIRED');
 // Jobs must run in one place only; the web service skips them in worker mode.
 if(require('./backgroundJobs').jobsRunIn()!=='worker') throw Error('SET_RUN_BACKGROUND_JOBS_IN_WORKER');
 await require('./db').initializeDatabase();
 const stop=require('./backgroundJobs').startBackgroundJobs();
 const keepAlive=setInterval(()=>{},60000);
 let stopping=false;
 const shutdown=async()=>{if(stopping) return;stopping=true;clearInterval(keepAlive);await stop();await require('./db').closeDatabase();};
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
}
if(require.main===module) main().catch((error)=>{require('./logger').logger.error('Message worker startup failed',{error:/^[A-Z_]+$/.test(error?.message)?error.message:'STARTUP_FAILED'});process.exitCode=1;});
module.exports={main};
