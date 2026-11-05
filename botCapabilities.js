'use strict';
// Shared executable capability registry: planner access and customer-facing discovery.
const READ_TOOLS=Object.freeze(['get_authorization_status','get_meta_capabilities','get_ad_accounts','get_meta_pages','get_meta_lead_forms','get_business_facts','get_workspace_records','get_media_assets','get_campaigns','get_campaign_setup','get_campaign_structure','get_campaign_performance','get_campaign_insights','get_meta_connection_status','get_meta_ads_knowledge','get_marketing_answers','get_marketing_questions','get_marketing_diagnosis','get_landing_drafts','get_professional_skills','analyze_business_case']);
function describe(){return{
 readTools:[...READ_TOOLS],writeProposals:[...require('./actionPlan').WRITE_INTENTS],
 externalWritesEnabled:process.env.READ_ONLY==='false'&&process.env.META_WRITES_ENABLED==='true',requiresExactApproval:true,
 scopedAuthority:{enabled:require('./scopedAuthority').enabled(),supportedIntents:[...require('./scopedAuthority').SUPPORTED],spendingAuthorized:false,creation:'OWNER_PORTAL_ONLY',verification:'SERVER_RECORD_NOT_PROVIDER_ELIGIBILITY'},
 formQuestions:['FULL_NAME','EMAIL','PHONE','CUSTOM'],
 professionalSkills:{version:'2026-11-05-v1',guides:require('./professionalSkills').SKILLS.length,analysisOperations:Object.keys(require('./businessCase').OPS),mode:'PARTIAL_READ_ONLY_ANALYSIS',crmConnected:false,billingEnabledByThisFeature:false},
 landingPages:{privateDrafts:true,publishViaChat:false},leadImport:{availableViaChat:false},
 models:{selected:process.env.AI_PROVIDER||'gemini',claudeConfigured:!!process.env.ANTHROPIC_API_KEY&&!!process.env.CLAUDE_MODEL},
 graphics:{implemented:true,enabled:process.env.GRAPHICS_ENABLED==='true'&&!!process.env.GEMINI_API_KEY&&!!process.env.GEMINI_IMAGE_MODEL,maxReferences:4},
 unsupported:['video generation','full website deployment through chat','organic social publication through chat','automatic CRM integration','generic arbitrary Graph API writes','automatic applicant ranking','conditional form questions','automatic coverage of every Ads Manager feature'],verifiedLive:false
};}
module.exports={READ_TOOLS,describe};
