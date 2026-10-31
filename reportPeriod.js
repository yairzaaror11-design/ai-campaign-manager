'use strict';
const PRESETS=['today','yesterday','last_7d','last_14d','last_30d','this_month','last_month','this_year','last_year'];
function dateOnly(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw Error('INVALID_REPORT_PERIOD');return value;}
function day(now,timezone='Asia/Jerusalem'){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
function validate(period,now=new Date(),timezone){
 if(typeof period==='string'){if(!PRESETS.includes(period))throw Error('INVALID_REPORT_PERIOD');return{date_preset:period};}
 const since=dateOnly(period?.since||''),until=dateOnly(period?.until||'');
 if(since>until||until>day(now,timezone)||(Date.parse(until)-Date.parse(since))/86400000>1095)throw Error('INVALID_REPORT_PERIOD');
 return{time_range:JSON.stringify({since,until})};
}
function parse(text,now=new Date(),timezone){
 const n=String(text).trim();
 const dates=n.match(/\d{4}-\d{2}-\d{2}/g);
 if(dates){if(dates.length!==2)throw Error('INVALID_REPORT_PERIOD');const p={since:dates[0],until:dates[1]};validate(p,now,timezone);return p;}
 const short=n.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g);
 if(short){if(short.length!==2)throw Error('INVALID_REPORT_PERIOD');const iso=x=>{const [d,m,y]=x.split(/[/.]/);return`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;};const p={since:iso(short[0]),until:iso(short[1])};validate(p,now,timezone);return p;}
 if(/בשנה האחרונה|שנה אחרונה|12 החודשים האחרונים/.test(n)){
   const until=day(now,timezone),d=new Date(until+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-364);return{since:d.toISOString().slice(0,10),until};
 }
 if(/בשנה שעברה|השנה הקודמת/.test(n))return'last_year';
 if(/השנה|שנה הנוכחית/.test(n))return'this_year';
 if(/חודש שעבר|החודש הקודם/.test(n))return'last_month';
 if(/החודש/.test(n))return'this_month';
 if(/אתמול/.test(n))return'yesterday';
 if(/היום/.test(n))return'today';
 const count=n.match(/(?:ב[- ]?)?(7|14|30)\s*(?:ימים|יום)/);if(count)return`last_${count[1]}d`;
 if(/שבועיים/.test(n))return'last_14d';
 if(/השבוע|שבוע האחרון/.test(n))return'last_7d';
 const command=n.match(/^\/report(?: (\w+))?$/);if(command)return command[1]||'last_7d';
 return null;
}
function label(period){const names={today:'היום',yesterday:'אתמול',last_7d:'7 הימים האחרונים',last_14d:'14 הימים האחרונים',last_30d:'30 הימים האחרונים',this_month:'החודש',last_month:'החודש הקודם',this_year:'השנה',last_year:'השנה הקודמת'};return typeof period==='string'?names[period]:`${period.since} עד ${period.until}`;}
module.exports={PRESETS,validate,parse,label,day};
