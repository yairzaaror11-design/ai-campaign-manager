'use strict';
window.ScorpioUI=(()=>{
 function el(tag,value='',cls=''){const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;}
 function icon(name){
  const paths={home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',agent:'M8 3h8M12 3v3M5 7h14v12H5ZM8 12h.01M16 12h.01M9 16h6M2 11v5M22 11v5',campaign:'m3 10 13-5v14L3 14Zm13-2 5-3v16l-5-3M6 15l2 6h3',creative:'m4 20 4-1L21 6l-3-3L5 16ZM14 6l4 4',content:'M4 5h16v16H4ZM8 3v4M16 3v4M4 10h16M8 14h3M8 17h7',leads:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87',performance:'M4 3v17h17M8 16v-4M13 16V8M18 16V5',integrations:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',account:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',help:'M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',support:'M3 13v-1a9 9 0 0 1 18 0v1M3 12h3v7H3ZM18 12h3v7h-3ZM18 19c0 2-3 2-6 2',profile:'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21a8 8 0 0 1 16 0',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',menu:'M4 6h16M4 12h16M4 18h16',collapse:'M5 4h14v16H5ZM14 4v16M11 9l-3 3 3 3',send:'m4 4 17 8-17 8 3-8Zm3 8h14',mic:'M9 4a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',attachment:'m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2M5 16l10-10',pages:'M4 4h6v6H4ZM14 4h6v6h-6ZM4 14h6v6H4ZM14 14h6v6h-6'};
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.7');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');svg.classList.add('ui-icon');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]||paths.pages);svg.append(path);return svg;
 }
 // Semantic desktop paths extend the current SVG system; mobile retains its original path.
 const navigationPaths={
 brand:'M12 3a9 9 0 1 0 0 18h2a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h4a4 4 0 0 0 4-4c0-4-5-6-9-6ZM7 9h.01M10 6h.01M16 7h.01M6 14h.01',
 products:'m3 7 9-4 9 4-9 4ZM3 7v10l9 4 9-4V7M12 11v10M7 5l10 5',
 landing:'M3 4h18v16H3ZM3 8h18M6 6h.01M9 6h.01M7 12h6M7 15h4M16 13l2 2-2 2',
 research:'M3 5h12v14H3ZM6 9h5M6 13h3M16 14l5 6M21 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
 sales:'M3 20V8h5v12M10 20V4h5v16M17 20v-8h4v8M2 20h20',
 pipeline:'M3 4h18l-7 8v7l-4 2v-9Z',
 customers:'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 21v-2a7 7 0 0 1 13-3M16 18l2 2 4-5',
 tasks:'M7 4h10v3H7ZM7 5H4v16h16V5h-3M8 12l2 2 5-5M8 18h7',
 scripts:'M4 3h13v4h3v14H7v-4H4ZM7 7h10M7 11h7M10 15h7M10 18h5',
 automations:'M4 4h6v6H4ZM14 14h6v6h-6M10 7h7v7M7 10v7h7M15 5l2 2 2-2',
 whatsapp:'M21 11a9 9 0 0 1-9 9 9 9 0 0 1-4-1l-5 2 1-5a9 9 0 1 1 17-5ZM8 7c0 5 4 9 8 9l1-3-3-1-1 1-3-3 1-1-1-3Z',
 bot:'M4 7h16v12H4ZM9 3h6M12 3v4M8 11h.01M16 11h.01M8 15h5M2 10v6M22 10v6M17 17l3 3',
 finance:'M3 7h18v14H3ZM3 7l14-4v4M15 12h6v5h-6ZM17 14h.01',
 profitability:'M3 20V4M3 20h18M7 16l4-5 4 2 6-8M17 5h4v4',
 expenses:'M5 3h14v18l-3-2-4 2-4-2-3 2ZM8 7h8M8 11h8M8 15h4',
 forecasts:'M3 20h18M5 17v-4M10 17V9M15 17v-3M20 17V5M4 9l6-5 5 5 5-7',
 advisor:'M12 3a7 7 0 0 0-4 13v3h8v-3a7 7 0 0 0-4-13ZM9 22h6M10 9l2-2 2 2-2 2v2',
 calendar:'M4 5h16v16H4ZM8 3v4M16 3v4M4 10h16M8 14h2M14 14h2M8 17h2',
 bookings:'M3 5h14v15H3ZM7 3v4M13 3v4M3 10h14M12 16l3 3 6-7',
 services:'M4 4h16v6H4ZM4 14h9v6H4ZM17 14v6M14 17h6',
 team:'M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 21v-3a6 6 0 0 1 12 0v3M17 3v4M15 5h4M17 12a3 3 0 0 1 3 3v6',
 'calendar-settings':'M3 5h15v16H3ZM7 3v4M14 3v4M3 10h15M7 14h7M10 17h4M19 3v6M16 6h6',
 users:'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 20v-2a6 6 0 0 1 11-3M16 11l5 2v4l-5 4-4-4v-4Z'
 };
 function navigationIcon(destination,fallback){
  const svg=icon(fallback);const d=navigationPaths[destination];if(!d)return svg;
  svg.firstChild.classList.add('legacy-icon-path');
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',d);path.setAttribute('display','none');path.classList.add('desktop-semantic-path');svg.append(path);return svg;
 }
 function button(label,action,cls='secondary'){const b=el('button',label,cls);b.type='button';if(action)b.addEventListener('click',action);return b;}
 function card(title,subtitle){const c=el('article','','card');if(title){const h=el('div','','card-heading');h.append(el('h2',title));if(subtitle)h.append(el('p',subtitle,'muted'));c.append(h);}return c;}
 function badge(label,variant=''){return el('span',label,'badge '+variant);}
 function empty(title,description,action){const c=el('div','','empty-state');c.append(el('span','◇','empty-icon'),el('h3',title),el('p',description,'muted'));if(action)c.append(action);return c;}
 function field(form,label,name,{value='',type='text',required=false,maxLength=2000,options,help}={}){
  const wrap=el('label',label),input=document.createElement(options?'select':type==='textarea'?'textarea':'input');
  input.name=name;input.id='f-'+name+'-'+crypto.randomUUID();wrap.htmlFor=input.id;
  if(options){for(const [v,l]of options){const o=el('option',l);o.value=v;input.append(o);}}else if(type!=='textarea')input.type=type;
  input.value=options?(value==null||value===''?options[0]?.[0]:value):(value??'');input.required=required;input.maxLength=maxLength;if(type==='number'){input.min='0';input.step='0.01';}wrap.append(input);
  if(help){const hint=el('small',help,'muted');hint.id=input.id+'-help';input.setAttribute('aria-describedby',hint.id);wrap.append(hint);}
  form.append(wrap);return input;
 }
 function tabs(entries,selected,onSelect){const nav=el('nav','','tabs');nav.setAttribute('aria-label','תצוגות');entries.forEach(([id,label])=>{const b=button(label,()=>onSelect(id),'tab');b.setAttribute('aria-pressed',String(id===selected));nav.append(b);});return nav;}
 function table(headers,rows){
  const wrap=el('div','','table-scroll'),t=el('table'),head=el('thead'),tr=el('tr'),body=el('tbody');let descending=false,sortColumn=-1;
  const draw=data=>{body.replaceChildren();data.forEach(row=>{const r=el('tr');row.forEach(value=>{const td=el('td');td.append(value instanceof Node?value:el('span',String(value??'—')));r.append(td);});body.append(r);});};
  headers.forEach((label,index)=>{const th=el('th');th.scope='col';if(index===headers.length-1)th.textContent=label;else{const b=button(label+' ↕',()=>{descending=sortColumn===index?!descending:false;sortColumn=index;head.querySelectorAll('th').forEach(h=>h.removeAttribute('aria-sort'));th.setAttribute('aria-sort',descending?'descending':'ascending');const value=x=>x instanceof Node?x.textContent:String(x??'');draw([...rows].sort((a,b)=>(descending?-1:1)*value(a[index]).localeCompare(value(b[index]),'he',{numeric:true})));},'table-sort');b.setAttribute('aria-label','מיון לפי '+label);th.append(b);}tr.append(th);});head.append(tr);t.append(head,body);draw(rows);wrap.append(t);wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label',headers.join(' · '));return wrap;
 }

 function dialog(title,{className=''}={}){const d=el('dialog','','modal '+className),head=el('div','','dialog-heading'),h=el('h2',title);h.id='dialog-'+crypto.randomUUID();d.setAttribute('aria-labelledby',h.id);head.append(h,button('×',()=>d.close(),'icon-button'));head.lastChild.setAttribute('aria-label','סגירת חלונית');d.append(head);document.body.append(d);const previous=document.activeElement;d.addEventListener('close',()=>{d.remove();previous?.focus();},{once:true});return d;}
 function confirm(title,description,label){return new Promise(resolve=>{const d=dialog(title);let approved=false;d.append(el('p',description));const row=el('div','','actions');row.append(button(label,()=>{approved=true;d.close();},'primary'),button('ביטול',()=>d.close()));d.append(row);d.addEventListener('close',()=>resolve(approved),{once:true});d.showModal();});}
 function progress(value,label){const wrap=el('div','','progress-wrap'),p=el('progress');p.max=100;p.value=value;p.setAttribute('aria-label',label);wrap.append(el('div',label+' · '+value+'%','muted'),p);return wrap;}
 return {el,icon,navigationIcon,button,card,badge,empty,field,tabs,table,dialog,confirm,progress};
})();
