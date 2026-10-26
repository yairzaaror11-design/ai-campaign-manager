'use strict';
function number(value){if(value==null||value==='')return null;const n=Number(value);if(!Number.isFinite(n)||n<0||n>1e12)throw Error('INVALID_PERFORMANCE_VALUE');return n;}
function action(row,types){
 if(!Array.isArray(row.actions))return null;
 for(const type of types){const item=row.actions.find(x=>x.action_type===type);if(item)return number(item.value);}
 return 0;
}
function analyze(snapshot,{targetCpl=null,reviewSpendLimit=null}={}){
 if(!snapshot?.account?.id||!Array.isArray(snapshot.campaigns)||snapshot.campaigns.length>2000)throw Error('INVALID_PERFORMANCE_SNAPSHOT');
 const target=number(targetCpl),limit=number(reviewSpendLimit);if(target===0||limit===0)throw Error('INVALID_REVIEW_TARGET');
 const campaigns=snapshot.campaigns.map(row=>{
  const spend=number(row.spend),clicks=number(row.clicks),impressions=number(row.impressions);
  const leads=action(row,['lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead']);
  const purchases=action(row,['purchase','offsite_conversion.fb_pixel_purchase','omni_purchase']);
  return{id:String(row.campaign_id||''),name:String(row.campaign_name||'קמפיין').slice(0,200),spend,clicks,impressions,leads,purchases,cpl:leads>0&&spend!=null?spend/leads:null,cpc:clicks>0&&spend!=null?spend/clicks:null,ctr:impressions>0&&clicks!=null?clicks/impressions*100:null};
 });
 const total=field=>campaigns.some(c=>c[field]===null)?null:campaigns.reduce((s,c)=>s+c[field],0);
 const totals=Object.fromEntries(['spend','clicks','impressions','leads','purchases'].map(k=>[k,total(k)]));
 const observations=[],recommendations=[];
 if(!campaigns.length)observations.push('לא התקבלו קמפיינים בטווח הדוח. זה אינו מוכיח שאין קמפיינים בחשבון.');
 if(totals.leads===null)recommendations.push({kind:'MEASUREMENT',text:'נתוני הפניות אינם מלאים. צריך לבדוק אילו אירועי פנייה מדווחים לפני הערכת העלות לפנייה.',confidence:'high',requiresApproval:false});
 else if(totals.spend>0&&totals.leads===0)recommendations.push({kind:'DIAGNOSE',text:'נרשמה הוצאה ולא דווחו פניות בטווח הזה. בדקו תחילה את המדידה, יעד המודעה וזמן ההבשלה של הפניות; אין כאן הוראה אוטומטית לעצור.',confidence:'low',requiresApproval:false});
 if(totals.purchases===null)observations.push('אין נתוני רכישות מלאים; לא ניתן להסיק רווחיות או החזר על ההשקעה.');
 if(target)for(const c of campaigns)if(c.cpl!=null&&c.cpl>target)recommendations.push({kind:'REVIEW_CPL',campaignId:c.id,text:`העלות לפנייה ב-${c.name} גבוהה מהיעד שמסרת. כדאי לבדוק את איכות הפניות ואת המדידה לפני שינוי.`,confidence:'low',evidence:{spend:c.spend,reportedLeads:c.leads,cpl:c.cpl,targetCpl:target},requiresApproval:true});
 if(limit)for(const c of campaigns)if(c.spend!=null&&c.spend>=limit)recommendations.push({kind:'REVIEW_SPEND',campaignId:c.id,text:`ההוצאה ב-${c.name} הגיעה לסף הבדיקה שהגדרת. נדרשת בחינה ואישור לפני שינוי תקציב או עצירה.`,confidence:'high',evidence:{spend:c.spend,reviewSpendLimit:limit},requiresApproval:true});
 if(!target)observations.push('לא הוגדר יעד עסקי לעלות לפנייה מתאימה; המערכת אינה ממציאה סף כדאיות.');
 return{version:1,source:'meta_reported',account:snapshot.account,preset:snapshot.preset,createdAt:new Date().toISOString(),totals,campaigns,observations,recommendations,limitations:['אירועי Meta אינם בהכרח לקוחות ייחודיים או עסקאות מאומתות','דיווח וייחוס עשויים להתעדכן באיחור','אין לערבב מטבעות, טווחי זמן או חלונות ייחוס שונים','המלצה אינה הרשאה לפעולה'],externalActionsExecuted:false};
}
function format(result){
 const t=result.totals,lines=[`הוצאה מדווחת: ${t.spend==null?'נתון חסר':t.spend.toFixed(2)+' '+result.account.currency}`,`פניות שדווחו ב-Meta: ${t.leads??'נתון חסר'}`,`רכישות שדווחו ב-Meta: ${t.purchases??'נתון חסר'}`];
 const suggestion=result.recommendations[0];if(suggestion)lines.push(suggestion.text);else lines.push('כדי להציע שינוי עסקי מדויק צריך להשוות את הנתונים ליעד ולרווחיות של העסק.');
 lines.push('אלה נתוני הפלטפורמה בטווח שנבחר; ייתכנו עיכובי דיווח.');return lines.join('\n');
}
module.exports={number,action,analyze,format};
