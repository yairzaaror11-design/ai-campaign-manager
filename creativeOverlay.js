'use strict';
// Adds the Hebrew headline / price / CTA and the business logo to a text-free generated visual,
// in code, so the letters are always spelled and ordered correctly (image models misspell Hebrew).
// One generated square visual is laid out into the Meta formats below.
const path=require('node:path');

// Meta feed/stories sizes. safeTop/safeBottom: fraction of the height kept free of text
// (9:16 stories/reels draw the profile bar on top and the reply/CTA UI at the bottom).
const FORMATS={
 '1:1':{width:1080,height:1080,imageTop:0,textTop:0.60,textBottom:0.95,logoTop:0.045},
 '4:5':{width:1080,height:1350,imageTop:0,textTop:0.64,textBottom:0.955,logoTop:0.04},
 '9:16':{width:1080,height:1920,imageTop:0.0625,textTop:0.55,textBottom:0.74,logoTop:0.155,safeTop:0.14,safeBottom:0.25},
};
const RLM='‏';
const FONT_DIR=path.join(path.dirname(require.resolve('@fontsource/heebo/package.json')),'files');
const FONT_FILES=['hebrew','latin'].flatMap(subset=>[700,800].map(weight=>path.join(FONT_DIR,`heebo-${subset}-${weight}-normal.woff`)));
const DEFAULT_ACCENT='#FFC83D';
let sharpModule,fontsReady;

function sharp(){
 if(!sharpModule){
  // Our own minimal fontconfig file: no system fonts are needed (Heebo is loaded per file below),
  // and it avoids the "cannot load default config file" error on hosts without fontconfig.
  if(!process.env.FONTCONFIG_FILE&&!process.env.FONTCONFIG_PATH)process.env.FONTCONFIG_FILE=path.join(__dirname,'assets','fonts.conf');
  sharpModule=require('sharp');
 }
 return sharpModule;
}
// libvips registers every fontfile it is given for the life of the process; Hebrew letters come from
// the hebrew subset and digits/Latin from the latin subset, so both are registered before any layout.
async function loadFonts(){
 fontsReady??=(async()=>{for(const fontfile of FONT_FILES)await sharp()({text:{text:'.',font:'Heebo',fontfile}}).png().toBuffer();})().catch(e=>{fontsReady=null;throw e;});
 return fontsReady;
}
const escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
function line(value,max,field){
 if(value===undefined||value===null||value==='')return null;
 if(typeof value!=='string')throw Error('INVALID_IMAGE_TEXT');
 const text=value.replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g,' ').replace(/\s+/g,' ').trim();
 if(!text)return null;
 if(text.length>max)throw Error('INVALID_IMAGE_TEXT:'+field);
 return text;
}
// Validates and normalises {headline,cta,price}. Returns null when there is nothing to draw.
function textSpec(input){
 if(input===undefined||input===null)return null;
 if(typeof input!=='object'||Array.isArray(input))throw Error('INVALID_IMAGE_TEXT');
 const spec={headline:line(input.headline,90,'headline'),price:line(input.price===undefined||input.price===null?input.price:String(input.price),40,'price'),cta:line(input.cta,30,'cta')};
 return spec.headline||spec.price||spec.cta?spec:null;
}
function formatList(formats){
 if(formats===undefined)return['1:1'];
 if(!Array.isArray(formats)||!formats.length||formats.length>3||new Set(formats).size!==formats.length||formats.some(f=>!Object.hasOwn(FORMATS,f)))throw Error('INVALID_GRAPHIC_FORMATS');
 return formats;
}
function hexColor(value){return typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value.toUpperCase():null;}
function luminance(hex){
 const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4);
 return 0.2126*r+0.7152*g+0.0722*b;
}
const contrastOn=hex=>luminance(hex)>0.4?'#111111':'#FFFFFF';

async function textImage(text,{weight,size,color,width}){
 const markup=`<span foreground="${color}">${RLM}${escape(text)}</span>`;
 const {data,info}=await sharp()({text:{text:markup,font:`Heebo ${weight===800?'ExtraBold':'Bold'} ${size}`,width,align:'centre',wrap:'word',rgba:true,dpi:72,spacing:Math.round(size*0.12)}}).png().toBuffer({resolveWithObject:true});
 return{input:data,width:info.width,height:info.height};
}
async function ctaPill(text,{size,accent,maxWidth}){
 const label=await textImage(text,{weight:700,size,color:contrastOn(accent),width:maxWidth-2*size});
 const padX=Math.round(size*0.9),padY=Math.round(size*0.45);
 const width=Math.min(maxWidth,label.width+2*padX),height=label.height+2*padY,radius=Math.round(height/2);
 const pill=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="${accent}"/></svg>`);
 const input=await sharp()(pill).composite([{input:label.input,left:Math.max(0,Math.round((width-label.width)/2)),top:padY}]).png().toBuffer();
 return{input,width,height};
}
// Lays the text block out bottom-up inside [top,bottom], shrinking the type until it fits.
async function textBlock(spec,{width,height,top,bottom,accent}){
 const margin=Math.round(width*0.07),maxWidth=width-2*margin,room=bottom-top;
 const priceColor=luminance(accent)>0.3?accent:'#FFFFFF';
 for(let scale=1;scale>=0.5;scale-=0.1){
  const gap=Math.round(22*scale),pieces=[];
  if(spec.headline)pieces.push(await textImage(spec.headline,{weight:800,size:Math.round(76*scale),color:'#FFFFFF',width:maxWidth}));
  if(spec.price)pieces.push(await textImage(spec.price,{weight:800,size:Math.round(60*scale),color:priceColor,width:maxWidth}));
  if(spec.cta)pieces.push(await ctaPill(spec.cta,{size:Math.round(42*scale),accent,maxWidth}));
  const total=pieces.reduce((sum,p)=>sum+p.height,0)+gap*(pieces.length-1);
  if(total<=room||scale<=0.55){
   let y=Math.max(top,bottom-total);
   return pieces.map(p=>{const placed={input:p.input,left:Math.max(0,Math.round((width-p.width)/2)),top:y};y+=p.height+gap;return placed;});
  }
 }
 return[];
}
async function logoLayer(logo,{width,height,top}){
 const box=Math.round(width*0.16),pad=Math.round(width*0.012);
 const {data,info}=await sharp()(logo,{limitInputPixels:40e6}).rotate().resize({width:box,height:Math.round(box*0.6),fit:'inside',withoutEnlargement:false}).png().toBuffer({resolveWithObject:true});
 const w=info.width+2*pad,h=info.height+2*pad;
 const plate=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${Math.round(pad*1.5)}" fill="#FFFFFF" fill-opacity="0.92"/></svg>`);
 const input=await sharp()(plate).composite([{input:data,left:pad,top:pad}]).png().toBuffer();
 return{input,left:Math.round(width*0.045),top:Math.round(height*top)};
}
function scrim(width,height,from){
 const start=Math.max(0,from)/height;
 return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="${start.toFixed(4)}" stop-color="#000" stop-opacity="0"/><stop offset="${Math.min(1,start+0.12).toFixed(4)}" stop-color="#000" stop-opacity="0.62"/><stop offset="1" stop-color="#000" stop-opacity="0.82"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/></svg>`);
}

// Renders one format. image: {buffer} of the generated visual. Returns {buffer,mimeType,width,height,format}.
async function render(image,{format='1:1',text,logo,accent}={}){
 const f=FORMATS[format];if(!f)throw Error('INVALID_GRAPHIC_FORMATS');
 const spec=textSpec(text);const s=sharp();
 const {width,height}=f,color=hexColor(accent)||DEFAULT_ACCENT;
 const source=s(image.buffer,{limitInputPixels:40e6}).rotate();
 let base;
 if(width===height)base=await source.resize(width,height,{fit:'cover',position:'attention'}).png().toBuffer();
 else{
  // Keep the whole square visual and extend it with a blurred, darkened copy instead of cropping it.
  const square=await source.clone().resize(width,width,{fit:'cover',position:'attention'}).png().toBuffer();
  const backdrop=await source.clone().resize(width,height,{fit:'cover'}).blur(40).modulate({brightness:0.55}).png().toBuffer();
  base=await s(backdrop).composite([{input:square,left:0,top:Math.round(height*f.imageTop)}]).png().toBuffer();
 }
 const layers=[];
 if(spec){
  await loadFonts();
  const top=Math.round(height*f.textTop),bottom=Math.round(height*f.textBottom);
  layers.push({input:scrim(width,height,top-Math.round(height*0.12)),left:0,top:0});
  layers.push(...await textBlock(spec,{width,height,top,bottom,accent:color}));
 }
 if(logo?.buffer)try{layers.push(await logoLayer(logo.buffer,{width,height,top:f.logoTop}));}catch{require('./logger').logger.warn('Creative logo skipped',{format,reason:'LOGO_DECODE_FAILED'});}
 let buffer=await s(base).composite(layers).png({compressionLevel:9}).toBuffer(),mimeType='image/png';
 // WhatsApp media is limited to 5MB: photographic 9:16 PNGs can exceed it, so those go out as JPEG.
 if(buffer.length>4.5*1024*1024){buffer=await s(buffer).jpeg({quality:90,mozjpeg:true}).toBuffer();mimeType='image/jpeg';}
 return{buffer,mimeType,width,height,format};
}
// Renders every requested format from the same generated visual, in order.
async function renderFormats(image,{formats,text,logo,accent}={}){
 const out=[];for(const format of formatList(formats))out.push(await render(image,{format,text,logo,accent}));
 return out;
}
module.exports={FORMATS,FONT_FILES,textSpec,formatList,render,renderFormats,loadFonts};
