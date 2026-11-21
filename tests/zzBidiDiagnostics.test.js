'use strict';
// TEMPORARY: where do "4" (red) and "₪" (blue) land with different bidi wrappers on this OS?
const test=require('node:test');
test('bidi diagnostics (temporary)',async()=>{
 const sharp=require('sharp');await require('../creativeOverlay').loadFonts();
 const body='<span foreground="#ff0000">4</span> חדרים ב־2.9 מיליון <span foreground="#0000ff">₪</span>';
 const variants={plain:body,rlm:'‏'+body,rle:'‫'+body+'‬',rli:'⁧'+body+'⁩',rlmBoth:'‏'+body+'‏'};
 for(const [k,t] of Object.entries(variants)){
  const {data,info}=await sharp({text:{text:t,font:'Heebo ExtraBold 60',rgba:true,dpi:72}}).raw().toBuffer({resolveWithObject:true});
  let rx=0,rn=0,bx=0,bn=0;for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const i=(y*info.width+x)*4;if(data[i+3]<128)continue;if(data[i]>180&&data[i+2]<80){rx+=x;rn++;}if(data[i+2]>180&&data[i]<80){bx+=x;bn++;}}
  console.log('DIAG',k,'width',info.width,'red(4) x',rn?Math.round(rx/rn):-1,'blue(₪) x',bn?Math.round(bx/bn):-1);
 }
 const ov=require('../creativeOverlay');console.log('DIAG env LANG',process.env.LANG,'LC_ALL',process.env.LC_ALL);
});
