'use strict';
const winston=require('winston');
function redact(value,key='') {
 if(/token|secret|password|authorization|cookie|rawbody/i.test(key)) return '[REDACTED]';
 if(typeof value==='string') {
  let text=value.replace(/(access_token|client_secret|appsecret_proof|code|state)=([^\s&]+)/gi,'$1=[REDACTED]').replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[DATABASE_URL]');
  for(const [name,secret] of Object.entries(process.env)) if(/SECRET|TOKEN|API_KEY|HMAC_KEY|DATABASE_URL/.test(name)&&secret.length>=8) text=text.split(secret).join('[REDACTED]');
  return text;
 }
 if(Array.isArray(value)) return value.map(item=>redact(item));
 if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v,k)]));
 return value;
}
const sanitize=winston.format(info=>{for(const key of Object.keys(info)) info[key]=redact(info[key],key);return info;});
const logger=winston.createLogger({level:process.env.LOG_LEVEL||'info',format:winston.format.combine(sanitize(),winston.format.timestamp(),winston.format.json()),transports:[new winston.transports.Console()]});
module.exports={logger,redact};
