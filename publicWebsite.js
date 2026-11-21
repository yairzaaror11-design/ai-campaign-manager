'use strict';
const dns=require('node:dns').promises,https=require('node:https'),net=require('node:net');
const ipaddr=require('ipaddr.js'),axios=require('axios'),cheerio=require('cheerio');
function publicAddress(address){
 try{let a=ipaddr.parse(address);if(a.kind()==='ipv6'&&a.isIPv4MappedAddress())a=a.toIPv4Address();return a.range()==='unicast';}catch{return false;}
}
function url(value){
 if(typeof value!=='string'||value.length>2000)throw Error('INVALID_PUBLIC_URL');
 const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!u.hostname.includes('.')||u.hostname.endsWith('.local')||u.hostname.endsWith('.internal')||net.isIP(u.hostname.replace(/^\[|\]$/g,'')))throw Error('INVALID_PUBLIC_URL');
 u.hash='';return u;
}
async function fetchPublic(value,{resolve=dns.lookup,request=axios.get,accept='html'}={}){
 let u=url(value);
 for(let hop=0;hop<4;hop++){
  const records=await resolve(u.hostname,{all:true,verbatim:true});
  if(!records.length||records.some(r=>!publicAddress(r.address)))throw Error('PRIVATE_NETWORK_BLOCKED');
  const pinned=records[0];const agent=new https.Agent({lookup:(_host,options,callback)=>options?.all?callback(null,[pinned]):callback(null,pinned.address,pinned.family)});
  let r;
  try{r=await request(u.toString(),{httpsAgent:agent,proxy:false,maxRedirects:0,timeout:8000,maxContentLength:accept==='image'?5*1024*1024:1024*1024,maxBodyLength:1024*1024,responseType:'arraybuffer',validateStatus:status=>status>=200&&status<400,headers:{'User-Agent':'CampaignBachat/1.0 business-profile-preview','Accept':accept==='image'?'image/png,image/jpeg,image/webp':'text/html,application/xhtml+xml'}});}finally{agent.destroy();}
  if(r.status>=300&&r.status<400){if(!r.headers.location)throw Error('INVALID_REDIRECT');u=url(new URL(r.headers.location,u).toString());continue;}
  const type=String(r.headers['content-type']||'').split(';')[0].trim().toLowerCase();
  if(accept==='image'?!['image/png','image/jpeg','image/webp'].includes(type):!['text/html','application/xhtml+xml'].includes(type))throw Error('UNSUPPORTED_PUBLIC_CONTENT');
  const buffer=Buffer.from(r.data);if(!buffer.length||buffer.length>(accept==='image'?5*1024*1024:1024*1024))throw Error('PUBLIC_CONTENT_LIMIT');
  return{buffer,type,url:u.toString()};
 }
 throw Error('PUBLIC_REDIRECT_LIMIT');
}
function extract(buffer,source){
 const $=cheerio.loadBuffer(Buffer.from(buffer),{encoding:{defaultEncoding:'utf-8'}}),clean=s=>String(s||'').replace(/\s+/g,' ').trim().slice(0,600);
 const meta=name=>clean($(`meta[property="${name}"],meta[name="${name}"]`).first().attr('content'));
 const absolute=v=>{if(!v)return null;try{return url(new URL(String(v),source).toString()).toString();}catch{return null;}};
 let structured=[];
 $('script[type="application/ld+json"]').slice(0,10).each((_,e)=>{try{const v=JSON.parse($(e).text().slice(0,100000));structured.push(...(Array.isArray(v)?v:[v]));}catch{}});
 structured=structured.flatMap(v=>v?.['@graph']||[v]).slice(0,80);
 const business=structured.find(v=>/LocalBusiness|Store|Organization|ProfessionalService|Restaurant|Product/.test([v?.['@type']].flat().join(' ')))||{};
 const name=clean(business.name)||meta('og:site_name')||meta('og:title')||clean($('title').first().text());
 const description=clean(business.description)||meta('description')||meta('og:description');
 const headings=$('h1,h2').slice(0,8).map((_,e)=>clean($(e).text())).get().filter(Boolean);
 const imageValue=v=>typeof v==='string'?v:v?.url||v?.contentUrl;
 const logo=absolute(imageValue(business.logo)||$('link[rel="icon"]').first().attr('href')||'');
 const images=[meta('og:image'),imageValue(business.image),...$('img').slice(0,15).map((_,e)=>$(e).attr('src')).get()].map(absolute).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).slice(0,6);
 const color=meta('theme-color');const colors=/^#[a-f0-9]{3}(?:[a-f0-9]{3})?$/i.test(color)?[color]:[];
 const location=clean(business.address?.addressLocality||business.address?.streetAddress||'');
 const products=structured.filter(v=>v?.['@type']==='Product'||v?.['@type']==='Service').slice(0,5).map(v=>clean(v.name)).filter(Boolean);
 const social=/instagram\.com|facebook\.com/.test(new URL(source).hostname);
 if((!name&&!description)||(social&&/^(Instagram|Facebook|Login|Log into)/i.test(name)&&!description))throw Error('PUBLIC_PROFILE_UNAVAILABLE');
 return{source,foundAt:new Date().toISOString(),status:'PENDING_CONFIRMATION',facts:{...(name?{businessName:name.slice(0,120)}:{}),...(description?{businessType:description.slice(0,500)}:{}),...(products[0]?{product:products[0]}:{}),...(location?{serviceArea:location}:{})},brand:{logo,colors,images},headings,description,limitations:['מידע שנמצא בעמוד ציבורי דורש אישור בעל העסק','תמונות ולוגו אינם אישור לזכויות שימוש','זיהוי תגי מדידה אינו הוכחה שאירועי רכישה נמדדים בפועל'],checks:{hasContactLink:$('a[href^="tel:"],a[href^="mailto:"],a[href*="wa.me/"]').length>0,hasForm:$('form').length>0,hasTitle:!!clean($('title').text()),hasMobileViewport:!!$('meta[name="viewport"]').length,trackingTagsDetected:/googletagmanager\.com|fbq\(|fbevents\.js|gtag\(/.test(buffer.toString()),verifiedConversions:false}};
}
async function inspect(value,options){const r=await fetchPublic(value,options);return extract(r.buffer,r.url);}
module.exports={publicAddress,url,fetchPublic,extract,inspect};
