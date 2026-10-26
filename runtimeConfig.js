'use strict';
function validateRuntime() {
 for(const flag of ['READ_ONLY','META_WRITES_ENABLED','WHATSAPP_SEND_ENABLED','WHATSAPP_WORKER_IN_WEB','REQUIRE_WORKER_HEARTBEAT','GRAPHICS_ENABLED','BUSINESS_LINK_ONBOARDING_ENABLED','PUBLIC_ONBOARDING_ENABLED','BILLING_ENABLED']) if(process.env[flag]!==undefined&&!['true','false'].includes(process.env[flag])) throw Error('INVALID_BOOLEAN_'+flag);
 require('./maintenance').retentionDays();
 if(process.env.NODE_ENV!=='production') return;
 for(const key of ['DATABASE_URL','META_TOKEN_ENCRYPTION_KEY','APPROVAL_HMAC_KEY','DELETION_HMAC_KEY','META_APP_ID','META_APP_SECRET','META_LOGIN_CONFIG_ID','APP_PUBLIC_URL','WHATSAPP_VERIFY_TOKEN','WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID','AUTHORIZED_PHONE_NUMBERS']) if(!process.env[key]) throw Error('MISSING_CONFIGURATION_'+key);
 if(process.env.PUBLIC_ONBOARDING_ENABLED==='true')for(const key of ['PRIVACY_OPERATOR_NAME','PRIVACY_CONTACT_EMAIL','PRIVACY_HOSTING_PROVIDER','PRIVACY_BACKUP_RETENTION'])if(!process.env[key])throw Error('PUBLIC_ONBOARDING_PRIVACY_REQUIRED');
 require('./metaConnection').config();
 if(process.env.META_LEGACY_SINGLE_TENANT==='true'||process.env.MOCK_META_ENABLED==='true') throw Error('UNSAFE_PRODUCTION_MODE');
 if(process.env.DB_SSL==='false'&&process.env.ALLOW_PRIVATE_DB_PLAINTEXT!=='true') throw Error('DATABASE_TLS_REQUIRED');
 if(process.env.GRAPHICS_ENABLED==='true'&&(!process.env.GEMINI_API_KEY||!/^gemini-[a-z0-9.-]+$/.test(process.env.GEMINI_IMAGE_MODEL || ''))) throw Error('GRAPHICS_CONFIGURATION_REQUIRED');
 const provider=process.env.AI_PROVIDER || 'gemini';
 if(provider==='gemini'&&(!process.env.GEMINI_API_KEY||!process.env.GEMINI_MODEL||!process.env.GEMINI_TRANSCRIBE_MODEL)) throw Error('GEMINI_CONFIGURATION_REQUIRED');
 if(provider==='claude'&&(!process.env.ANTHROPIC_API_KEY||!process.env.CLAUDE_MODEL)) throw Error('CLAUDE_CONFIGURATION_REQUIRED');
 if(!['gemini','claude'].includes(provider)) throw Error('AI_PROVIDER_UNSUPPORTED');
 for(const key of ['APPROVAL_HMAC_KEY','DELETION_HMAC_KEY']) if(process.env[key].length<32) throw Error('STRONG_KEY_REQUIRED_'+key);
}
module.exports={validateRuntime};
