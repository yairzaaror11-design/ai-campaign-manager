'use strict';
const seed=require('./data/meta-ads-knowledge.he.json');
const db=require('./db');
function select(topics,{query='',state='ANY',ids,limit=3}={}){
 if(typeof query!=='string'||query.length>200||typeof state!=='string'||state.length>50||!Number.isInteger(limit)||limit<1||limit>3)throw Error('INVALID_KNOWLEDGE_QUERY');
 if(ids&&(!Array.isArray(ids)||ids.length>3||ids.some(id=>typeof id!=='string'||id.length>100)))throw Error('INVALID_KNOWLEDGE_IDS');
 const words=query.toLowerCase().split(/\s+/).filter(Boolean);
 return topics.filter(t=>typeof t.id==='string'&&typeof t.content==='string'&&Array.isArray(t.tags)&&Array.isArray(t.conditions))
  .filter(t=>(!ids||ids.includes(t.id))&&(t.conditions.includes('ANY')||state==='ANY'||t.conditions.includes(state)))
  .map(t=>({t,score:words.reduce((s,w)=>s+([t.content,...t.tags].join(' ').toLowerCase().includes(w)?1:0),0)}))
  .filter(x=>!words.length||x.score).sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>x.t);
}
function search(options={}){return select(seed.topics,options);}
async function retrieve(options={}){
 // Validate before database work. Rank the current DB content so editorial updates need no core-code change.
 search(options);let topics=seed.topics.map(t=>({...t,version:seed.version,updated_on:seed.updated_on}));
 if(db.configured()){
  const r=await db.query('SELECT id,payload,version,updated_at FROM meta_ads_knowledge ORDER BY id LIMIT 100');
  const current=new Map(topics.map(t=>[t.id,t]));
  for(const row of r.rows)current.set(row.id,{...row.payload,id:row.id,version:row.version,updated_on:row.updated_at});
  topics=[...current.values()];
 }
 return select(topics,options).map(t=>({id:t.id,category:t.category,content:String(t.content).slice(0,1500),tags:t.tags,version:t.version||seed.version,updated_on:t.updated_on||seed.updated_on,source:t.source,source_status:t.source_status,conditions:t.conditions}));
}
module.exports={search,retrieve};
