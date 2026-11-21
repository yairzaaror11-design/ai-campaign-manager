'use strict';
(()=>{
 const UI=window.ScorpioUI,{el,button,card,badge,empty,field,tabs,table,dialog,progress}=UI;
 const groups={home:{label:'היום',items:[['home','היום'],['approvals','מחכה לאישור'],['agent','הסוכן שלך']]},customers:{label:'לקוחות',items:[['leads','כל הלידים'],['pipeline','לוח עסקאות'],['customers','לקוחות'],['growth','צמיחה'],['team','צוות'],['tasks','משימות'],['sales','סיכום מכירות']]},ads:{label:'פרסום',items:[['catalog','מה אני מוכר'],['campaign','קמפיינים'],['performance','תוצאות'],['landing','עמודי מכירה'],['research','תכנון ומחקר']]},content:{label:'תוכן',items:[['content','לוח תוכן'],['creative','סטודיו קריאייטיב']]},business:{label:'העסק שלי',items:[['agreement','הסכם עבודה'],['brand','זהות מותג'],['finance','כסף ורווחיות'],['profitability','רווחיות לפי מוצר'],['expenses','הוצאות'],['integrations','חיבורים'],['billing','מנוי וחיוב'],['users','משתמשים והרשאות'],['account','הגדרות'],['help','עזרה ותמיכה']]}};
 // Screens without a working backend stay out of navigation until they are built.
 const HIDDEN=new Set(['scripts','automations','whatsapp','bot','forecasts','advisor']);for(const g of Object.values(groups))g.items=g.items.filter(([id])=>!HIDDEN.has(id));
 const departmentMeta={home:{icon:'home',description:'מה קורה בעסק ומה מחכה לך'},customers:{icon:'leads',description:'לידים, עסקאות ולקוחות'},ads:{icon:'campaign',description:'מה רץ, כמה עלה ומה הביא'},content:{icon:'content',description:'פוסטים, גרפיקות וסרטונים'},business:{icon:'account',description:'מותג, מוצרים, כסף והגדרות'}};
 const departmentColor={home:'home',customers:'sales',ads:'marketing',content:'calendar',business:'finance'};
 const dirtyForms=new Set();let leavePending=false,sheetState=null;
 function hasUnsaved(){for(const f of dirtyForms)if(!f.isConnected)dirtyForms.delete(f);return dirtyForms.size>0;}
 async function allowLeave(){if(!hasUnsaved())return true;if(leavePending)return false;leavePending=true;const ok=await UI.confirm('שינויים שלא נשמרו','יש מידע שהזנת ולא נשמר. להישאר ולשמור, או לעזוב את המסך?','עזיבה ללא שמירה');leavePending=false;if(ok)dirtyForms.clear();return ok;}
 function openMore(){
  if(sheetState)return;
  const d=dialog('מחלקות וכלים',{className:'navigation-sheet'});d.id='navigation-sheet';document.querySelector('[data-mobile-nav=more]')?.setAttribute('aria-expanded','true');const links=el('div','','mobile-more-actions');
  const choose=action=>{sheetState.after=action;d.close();};
  Object.entries(groups).forEach(([id,g])=>links.append(button(g.label,()=>choose(()=>navigate(g.items[0][0])),'secondary')));
  [['agent','הסוכן שלך'],['pages','כל הדפים'],['account','הגדרות'],['users','משתמשים והרשאות'],['billing','מנוי וחיוב'],['help','מרכז עזרה'],['support','תמיכה']].forEach(([id,label])=>links.append(button(label,()=>choose(()=>navigate(id)),'secondary')));
  links.append(button('יום / לילה',()=>choose(themeToggle),'secondary'),button('חיפוש במערכת',()=>choose(()=>openCommands()),'secondary'),button('מדריך למערכת',()=>choose(startTour),'secondary'));d.append(el('p','המסך הקודם נשאר פתוח עד לבחירת יעד.','muted'),links);sheetState={dialog:d,after:null};history.pushState({scorpioSheet:true},'',location.href);document.body.classList.add('sheet-open');
  d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});
  d.addEventListener('close',()=>{document.querySelector('[data-mobile-nav=more]')?.setAttribute('aria-expanded','false');document.body.classList.remove('sheet-open');if(history.state?.scorpioSheet)history.back();},{once:true});d.showModal();
 }
 const system=[['agent','הסוכן שלך'],['users','משתמשים והרשאות'],['billing','מנויים וחיובים'],['help','מרכז עזרה ותמיכה'],['account','הגדרות']];
 const titles={...Object.fromEntries([...Object.values(groups).flatMap(g=>g.items),...system]),onboarding:'היכרות עם העסק',products:'מוצרים ושירותים',pages:'כל הדפים',support:'תמיכה',...Object.fromEntries(Object.values(groups).flatMap(g=>g.items))};
 let current='home',department='home',generation=0,ready=false,drawer=null,chatMessages=[],guide=null,brandTab='kit',settingsTab='display',contentMonth=new Date(),contentMode='calendar',researchTab='personas',showCampaignTools=false,sidebarIdentity,departmentNavigation;
 const dynamic=el('section','','page-content'),sidebar=el('aside','','sidebar'),backdrop=el('div','','sidebar-backdrop');
 dynamic.id='dashboard-screen';dynamic.setAttribute('aria-label','תוכן המסך');
 const header=document.querySelector('.app-header'),oldBrand=header.querySelector('.brand'),logout=$('logout'),main=$('main-content');
 function localGet(key){try{return localStorage.getItem(key);}catch{return null;}}
 function localSet(key,value){try{localStorage.setItem(key,value);}catch{}}
 const theme=localGet('scorpio-theme');if(['light','dark'].includes(theme))document.documentElement.dataset.theme=theme;
 function themeToggle(){const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;localSet('scorpio-theme',next);updateThemeControl();if(current==='account')navigate(current);}
 function updateThemeControl(){const b=$('theme-toggle');if(!b)return;const dark=document.documentElement.dataset.theme==='dark';b.textContent=dark?'☀':'☾';b.setAttribute('aria-label',dark?'מעבר למצב יום':'מעבר למצב לילה');b.setAttribute('aria-pressed',String(dark));b.title=dark?'מעבר למצב יום':'מעבר למצב לילה';}
 function heading(title,subtitle,actions=[],level=1){const h=el('div','','page-heading'),right=el('div','','heading-with-icon'),copy=el('div');copy.append(el('p',groups[department]?.label||'מערכת','eyebrow'),el(level===2?'h2':'h1',title),el('p',subtitle));right.append(el('span','✧','agent-symbol'),copy);h.append(right);if(actions.length){const a=el('div','','actions');a.append(...actions);h.append(a);}return h;}
 function routeScreen(){const fragment=location.hash.slice(1),value=titles[fragment]?fragment:location.pathname.split('/')[2];return titles[value]?value:(value&&/^[a-z-]+$/.test(value)?value:'home');}
 function navButton(id,label){const b=button('',()=>navigate(id),'ghost');b.append(UI.navigationIcon(id,({home:'home',catalog:'home',agent:'agent',campaign:'campaign',creative:'creative',content:'content',leads:'leads',performance:'performance',integrations:'integrations',account:'account',help:'help',support:'support',users:'leads',profile:'profile'})[id]||'pages'),el('span',label,'nav-label'));b.dataset.screen=id;b.title=label;b.setAttribute('aria-label',label);b.setAttribute('aria-current',current===id?'page':'false');return b;}
 function closeSidebar(){const wasOpen=sidebar.classList.contains('open');document.body.classList.remove('sidebar-open');sidebar.classList.remove('open');backdrop.classList.remove('open');$('sidebar-toggle')?.setAttribute('aria-expanded','false');if(wasOpen)$('sidebar-toggle')?.focus();}
 function buildShell(){
  sidebarIdentity=el('div','','sidebar-identity');oldBrand.textContent='SCORPIO AI';oldBrand.setAttribute('aria-label','SCORPIO AI — בית');oldBrand.addEventListener('click',e=>{e.preventDefault();navigate('home');});
  const collapse=button('',()=>{const collapsed=!document.body.classList.contains('sidebar-collapsed');document.body.classList.toggle('sidebar-collapsed',collapsed);localSet('scorpio-sidebar',collapsed?'collapsed':'expanded');collapse.setAttribute('aria-expanded',String(!collapsed));},'icon-button sidebar-collapse');collapse.append(UI.icon('collapse'));collapse.setAttribute('aria-label','כיווץ או הרחבת התפריט');collapse.setAttribute('aria-expanded','true');const top=el('div','','sidebar-wordmark');top.append(oldBrand,collapse);
  const business=button('',()=>{const d=dialog('העסק המחובר');d.append(el('p',state.business?.businessName||'העסק שלך'),el('p','החשבון מחובר לעסק שלך בוואטסאפ.','muted'));d.showModal();},'secondary business-switch');business.id='business-switch';
  const account=el('div','','account-label');account.id='header-account';const identity=el('div','','header-business');identity.append(oldBrand,business,account);sidebarIdentity.append(collapse);if(localGet('scorpio-sidebar')==='collapsed'){document.body.classList.add('sidebar-collapsed');collapse.setAttribute('aria-expanded','false');}
  const headerCopy=el('div','','header-page-copy');headerCopy.append(el('strong','','header-page-title'),el('small','','header-page-description'));headerCopy.firstChild.id='header-page-title';headerCopy.lastChild.id='header-page-description';
  const nav=el('nav','','department-nav');nav.setAttribute('aria-label','מחלקות');Object.entries(groups).forEach(([id,g])=>{const b=button(g.label,()=>navigate(g.items[0][0]),'ghost');b.dataset.department=id;nav.append(b);});departmentNavigation=nav;const indicator=el('span','','department-indicator');indicator.setAttribute('aria-hidden','true');nav.prepend(indicator);const positionIndicator=()=>{const active=nav.querySelector('[aria-current=true]');if(!active||!nav.getClientRects().length)return;indicator.style.width=active.offsetWidth+'px';indicator.style.transform='translateX('+active.offsetLeft+'px)';};new ResizeObserver(positionIndicator).observe(nav);nav.addEventListener('departmentchange',positionIndicator);
  const searchWrap=el('form','','header-search');searchWrap.append(UI.icon('search'));const search=el('input');search.type='search';search.placeholder='חיפוש במערכת…';search.setAttribute('aria-label','חיפוש במערכת');searchWrap.append(search,el('kbd','⌘ K'));searchWrap.addEventListener('submit',e=>{e.preventDefault();openCommands(search.value);});
  const tools=el('div','','header-tools'),toggle=button('',()=>{const open=!sidebar.classList.contains('open');sidebar.classList.toggle('open',open);backdrop.classList.toggle('open',open);toggle.setAttribute('aria-expanded',String(open));document.body.classList.toggle('sidebar-open',open);if(open)sidebar.querySelector('nav button')?.focus();},'icon-button menu-toggle');toggle.append(UI.icon('menu'));toggle.id='sidebar-toggle';toggle.setAttribute('aria-label','פתיחת תפריט');toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','scorpio-sidebar');
  const notices=button('',async()=>{const d=dialog('מה מחכה לך היום'),list=el('div');d.append(list);d.showModal();try{const {items}=await api('today');if(!items.length)list.append(el('p','הכול מטופל ✓ אין משהו דחוף כרגע'));items.forEach(item=>{const row=el('div','','today-row urgency-'+item.urgency),copy=el('div');copy.append(el('strong',item.text));if(item.detail)copy.append(el('small',item.detail));row.append(copy,button('לטפל',()=>{d.close();navigate(item.screen);},'secondary'));list.append(row);});}catch{list.append(el('p','לא הצלחנו לטעון עדכונים.','muted'));}},'icon-button');notices.append(UI.icon('bell'));notices.setAttribute('aria-label','התראות ועדכונים');
  const settingsButton=button('',()=>navigate('account'),'icon-button');settingsButton.append(UI.icon('account'));settingsButton.setAttribute('aria-label','הגדרות');
  const avatar=button('',()=>{settingsTab='account';navigate('account');},'profile-avatar');avatar.id='profile-avatar';avatar.setAttribute('aria-label','פרופיל משתמש');
  const mobileSearch=button('',()=>openCommands(),'icon-button mobile-search');mobileSearch.append(UI.icon('search'));mobileSearch.setAttribute('aria-label','פתיחת חיפוש');const themeButton=button('',themeToggle,'icon-button theme-toggle');themeButton.id='theme-toggle';tools.append(themeButton,mobileSearch,notices,settingsButton,avatar,toggle);header.replaceChildren(identity,nav,searchWrap,tools,headerCopy);updateThemeControl();
  sidebar.id='scorpio-sidebar';sidebar.setAttribute('aria-label','תפריט צד');sidebar.addEventListener('click',e=>{if(!window.matchMedia('(min-width:961px)').matches||!document.body.classList.contains('sidebar-collapsed'))return;const target=e.target.closest('button');if(!target||target.classList.contains('sidebar-collapse'))return;document.body.classList.remove('sidebar-collapsed');localSet('scorpio-sidebar','expanded');sidebar.querySelector('.sidebar-collapse')?.setAttribute('aria-expanded','true');});document.body.append(sidebar,backdrop);backdrop.addEventListener('click',closeSidebar);
  $('workspace').prepend(dynamic);main.classList.add('dashboard-background');document.body.classList.add('shell-ready');
  const floating=el('div','','floating-actions');floating.id='floating-actions';const a=button('',()=>openAgent(),'primary');a.append(UI.icon('agent'));a.setAttribute('aria-label','פתיחת הסוכן');a.title='הסוכן שלך';const h=button('',()=>navigate('help'),'secondary');h.append(UI.icon('help'));h.setAttribute('aria-label','מרכז עזרה');h.title='מרכז עזרה';const t=button('◉',startTour,'secondary');t.setAttribute('aria-label','הפעלת מדריך');t.title='הפעלת מדריך';a.classList.add('desktop-floating');t.classList.add('desktop-floating');h.classList.add('desktop-floating');floating.append(a,t,h);
  const mobileNav=el('nav','','mobile-bottom-nav');mobileNav.setAttribute('aria-label','ניווט תחתון');
  [['home','היום','home',()=>navigate('home')],['customers','לקוחות','leads',()=>navigate('leads')],['ads','פרסום','campaign',()=>navigate('campaign')],['content','תוכן','content',()=>navigate('content')],['business','העסק שלי','account',()=>navigate('brand')]].forEach(([id,label,icon,action])=>{const b=button('',action,'mobile-bottom-item');b.dataset.mobileNav=id;b.setAttribute('aria-label',label);if(id==='more'){b.setAttribute('aria-expanded','false');b.setAttribute('aria-controls','navigation-sheet');}const symbol=el('span','','mobile-bottom-icon');symbol.append(UI.icon(icon));b.append(symbol,el('span',label));mobileNav.append(b);});floating.append(mobileNav);document.body.append(floating);
  document.addEventListener('input',e=>{const f=e.target.closest('form');if(f&&main.contains(f)&&!f.classList.contains('home-agent-form'))dirtyForms.add(f);});
  // A submitted form is no longer "unsaved": saving must not trigger the leave-without-saving prompt.
  document.addEventListener('submit',e=>dirtyForms.delete(e.target),true);
  window.addEventListener('beforeunload',e=>{if(hasUnsaved()){e.preventDefault();e.returnValue='';}});
  document.addEventListener('keydown',e=>{if(e.key==='Tab'&&sidebar.classList.contains('open')){const all=[...sidebar.querySelectorAll('button:not(:disabled),a[href]')].filter(n=>n.getClientRects().length);const first=all[0],last=all.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}if(e.key==='Escape'){closeSidebar();closeTour();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCommands();}});
  window.addEventListener('hashchange',()=>navigate(routeScreen(),false));window.addEventListener('popstate',()=>{if(sheetState){const old=sheetState;sheetState=null;old.dialog.close();document.body.classList.remove('sheet-open');old.after?.();return;}navigate(routeScreen(),false);});
  const observer=new MutationObserver(()=>{const hidden=$('workspace').hidden;sidebar.hidden=hidden;floating.hidden=hidden;headerCopy.hidden=hidden;searchWrap.hidden=hidden;tools.hidden=hidden;identity.hidden=hidden;departmentNavigation.hidden=hidden;if(hidden){document.body.classList.remove('shell-ready');drawer?.close();}else document.body.classList.add('shell-ready');});observer.observe($('workspace'),{attributes:true,attributeFilter:['hidden']});
 }
 function renderSidebar(){
  document.body.dataset.department=departmentColor[department]||department;
  sidebar.replaceChildren(sidebarIdentity);const meta=departmentMeta[department];const departmentHeading=el('div','','department-heading'),symbol=el('span','','department-symbol'),copy=el('div');symbol.append(UI.icon(meta.icon));copy.append(el('strong',groups[department].label),el('small',meta.description));departmentHeading.append(symbol,copy);sidebar.append(departmentHeading);const departmentSelect=el('select','','tablet-departments');departmentSelect.setAttribute('aria-label','מעבר מחלקה');Object.entries(groups).forEach(([id,g])=>{const option=el('option',g.label);option.value=id;departmentSelect.append(option);});departmentSelect.value=department;departmentSelect.addEventListener('change',async()=>{await navigate(groups[departmentSelect.value].items[0][0]);departmentSelect.value=department;});sidebar.append(departmentSelect);
  const mobileSection=el('nav','','mobile-section-heading mobile-subnav');mobileSection.setAttribute('aria-label','מסכים ב'+groups[department].label);groups[department].items.forEach(([id,label])=>{const t=button(label,()=>navigate(id),'subnav-tab');t.setAttribute('aria-current',current===id?'page':'false');mobileSection.append(t);});requestAnimationFrame(()=>mobileSection.querySelector('[aria-current=page]')?.scrollIntoView({inline:'center',block:'nearest'}));$('department-context')?.remove();mobileSection.id='department-context';mobileSection.hidden=current==='onboarding';main.prepend(mobileSection);
  const nav=el('nav');nav.setAttribute('aria-label','ניווט ראשי');
  const advancedIds=new Set(['research','integrations','scripts','automations','whatsapp','bot','forecasts','advisor']);
  const primaryItems=groups[department].items.filter(([id])=>!advancedIds.has(id)),advancedItems=groups[department].items.filter(([id])=>advancedIds.has(id));
  primaryItems.forEach(([id,label])=>nav.append(navButton(id,label)));
  if(advancedItems.length){const advanced=el('details','','advanced-navigation');advanced.open=advancedItems.some(([id])=>id===current);advanced.append(el('summary','כלים נוספים · '+advancedItems.length));advancedItems.forEach(([id,label])=>advanced.append(navButton(id,label)));nav.append(advanced);}

  
  sidebar.append(nav);
  const bottom=el('div','','sidebar-bottom');[['pages','כל הדפים']].forEach(([id,label])=>bottom.append(navButton(id,label)));const profile=button('',()=>{settingsTab='account';navigate('account');},'sidebar-profile');profile.append(UI.icon('profile'),el('span',state.account?.display_name||'פרופיל משתמש','nav-label'));profile.setAttribute('aria-label','פרופיל משתמש');bottom.append(profile,logout);sidebar.append(bottom);
  document.querySelectorAll('[data-mobile-nav]').forEach(b=>{const active=b.dataset.mobileNav===department;b.setAttribute('aria-current',active?'page':'false');});
  departmentNavigation.querySelectorAll('[data-department]').forEach(b=>b.setAttribute('aria-current',String(b.dataset.department===department)));
  departmentNavigation.dispatchEvent(new Event('departmentchange'));
  $('business-switch').replaceChildren(UI.icon('pages'),el('span',(state.business.businessName||'העסק שלי')+' ⌄','business-name'));$('header-account').textContent=state.account?.display_name||'סביבת העבודה';
  $('header-page-title').textContent=titles[current];$('header-page-description').textContent=pageDescriptions[current]||'כל העסק, בסביבת עבודה אחת';$('profile-avatar').textContent=(state.account?.display_name||state.business.businessName||'S').trim().slice(0,1);$('profile-avatar').title=state.account?.display_name||'פרופיל משתמש';
 }
 function stats(values,five=false){const row=el('div','','stats-row'+(five?' five':''));values.forEach(([label,value,note])=>{const c=el('div','','stat');c.append(el('span',label),el('strong',String(value)),el('small',note||''));row.append(c);});return row;}
 function go(label,id){return button(label,()=>navigate(id),'secondary');}
 async function navigate(id,hash=true){
  if(id==='support')id='help';
  catalogLabel();if(!titles[id]){if(id&&id!=='app'&&id!=='home')setTimeout(()=>tell('המסך הזה עוד לא זמין. העברתי אותך ל"היום".'),300);id='home';history.replaceState(null,'','/app/home');}if(!await allowLeave()){if(!hash)history.replaceState(null,'','/app/'+current);return;}current=id;department=Object.keys(groups).find(g=>groups[g].items.some(([s])=>s===id))||department;
  if(hash)window.scrollTo(0,0);if(hash&&location.pathname!=='/app/'+id)history.pushState(null,'','/app/'+id);closeSidebar();renderSidebar();document.body.classList.toggle('onboarding-view',id==='onboarding');sidebar.hidden=id==='onboarding';$('floating-actions').hidden=id==='onboarding';departmentNavigation.hidden=id==='onboarding';document.title=titles[id]+' | SCORPIO AI';
  document.querySelectorAll('[data-view]').forEach(e=>e.hidden=true);dynamic.hidden=false;dynamic.replaceChildren();const version=++generation;
  if(['campaign','leads','billing'].includes(id)){
   dynamic.append(heading(titles[id],id==='campaign'?'התוכנית, המודעות והאישורים של העסק שלך':id==='leads'?'כל הלידים של העסק, במקום אחד':'המנוי והתשלום שלך',id==='campaign'?[button('✧ צור קמפיין',()=>openAgent(true),'primary')]:id==='leads'?[exportLink()]:[]));
   const legacy=document.querySelector('[data-view="'+(id==='billing'?'account':id)+'"]');legacy.hidden=id==='campaign'&&!state.draft&&!showCampaignTools;legacy.classList.add('page-content');if(id==='campaign'&&!state.draft&&!showCampaignTools){dynamic.append(empty('עוד לא יצרת קמפיין ממומן','נכין תוכנית, קהל ומודעות כטיוטה פרטית. יצירה ב־Meta והפעלה דורשות אישורים נפרדים.',button('＋ צור קמפיין ממומן',()=>openAgent(true),'primary')));const tools=card('המשך עבודה עם חשבון הפרסום');tools.append(go('חיבורים ואינטגרציות','integrations'),button('הצגת כלים ודוחות קיימים',()=>{showCampaignTools=true;navigate('campaign');}));dynamic.append(tools);}
   if(id==='campaign')liveCampaigns(version);
   if(id==='leads')await loadLeads();return;
  }
  try{
   const data=await renderScreen(id);if(version!==generation)return;dynamic.replaceChildren(...data);
  }catch(e){if(version===generation)dynamic.replaceChildren(heading(titles[id],'משהו לא נטען, ננסה שוב?'),empty('משהו לא נטען',e.message,button('ניסיון חוזר',()=>navigate(id),'primary')));}
 }
 // Campaigns running in the connected Meta account, joined with CRM results.
 async function liveCampaigns(version){
  let list,report;try{[list,report]=await Promise.all([api('campaigns'),api('business-report?period=last_30d').catch(()=>({metaCampaigns:[]}))]);}catch{return;}
  if(version!==generation||!list.connected||!list.campaigns.length)return;
  const stats30=Object.fromEntries((report.metaCampaigns||[]).map(x=>[x.id,x])),STATUS={ACTIVE:'פעיל',PAUSED:'כבוי',CAMPAIGN_PAUSED:'כבוי',ADSET_PAUSED:'כבוי',IN_PROCESS:'בבדיקה',WITH_ISSUES:'יש בעיה',DISAPPROVED:'נדחה',PENDING_REVIEW:'בבדיקה',ARCHIVED:'בארכיון',DELETED:'נמחק'};
  const c=card('הקמפיינים בחשבון הפרסום','30 הימים האחרונים');
  const rows=list.campaigns.filter(x=>!['ARCHIVED','DELETED'].includes(x.status)).map(x=>{const st=stats30[x.id]||{spend:0,leads:0,won:0,revenue:0},act=el('div','','actions');
   if(['ACTIVE','PAUSED','CAMPAIGN_PAUSED'].includes(x.status)){const pause=x.status==='ACTIVE',b=button(pause?'כיבוי':'הפעלה',()=>run(b,async()=>{const r=await api('campaigns/'+x.id+'/action',{kind:pause?'PAUSE':'RESUME'});if(!r.ok){tell(r.reply,true);return;}tell('הכנתי את זה. רק צריך את האישור שלך 👇');navigate('approvals');}),'secondary');act.append(b);
    act.append(button('שינוי תקציב',()=>budgetDialog(x,'budget',st),'secondary'));
    if(st.winner)act.append(button('🏆 שכפל קמפיין מנצח',()=>budgetDialog(x,'duplicate',st),'secondary budget-winner'));}
   return [x.name,badge(STATUS[x.status]||x.status,x.status==='ACTIVE'?'':'warning'),shekel(st.spend),st.leads,st.leads?shekel(st.spend/st.leads):'—',st.won,shekel(st.revenue),act];});
  if(!rows.length)return;
  c.append(table(['קמפיין','מצב','עלות פרסום','לידים','עלות לליד','מכירות','הכנסות','פעולות'],rows));
  c.append(el('p','שינוי תקציב או שכפול קמפיין מנצח: מכינים כאן, רואים כמה זה יעלה, ושום דבר לא משתנה ב־Meta עד שתאשר.','muted'));
  const actions=el('div','','actions');actions.append(button('לבקש מהסוכן שיפור לקמפיין',()=>openAgent(true),'secondary'),go('ביצועים מלאים','performance'));c.append(actions);
  const emptyState=dynamic.querySelector('.empty-state');if(emptyState)emptyState.replaceWith(c);else dynamic.children[0]?.after(c);
 }
 // Change a daily budget, or duplicate a winner (paused) with a new budget: pick an amount,
 // see current vs new and the cost, prepare the approval, then confirm it explicitly.
 async function budgetDialog(x,mode,st){
  const dup=mode==='duplicate',d=dialog(dup?'שכפול קמפיין מנצח':'שינוי תקציב יומי',{className:'budget-dialog'}),body=el('div','','budget-body');d.append(body);d.showModal();
  body.append(el('p','בודק את התקציב הנוכחי ב־Meta…','muted'));
  let info;try{info=await api('campaigns/'+x.id+'/budget');}catch(e){body.replaceChildren(el('p',e.message,'form-error'));return;}
  body.replaceChildren(el('h3',info.name||x.name));
  if(!info.ok){body.append(el('p',info.reply,'form-error'));return;}
  const current=info.currentDailyBudget,round=v=>Math.max(1,Math.round(v));
  if(dup&&st.winner)body.append(el('p',(st.winner.by==='SALE'?'מכירה כאן עולה ':'ליד כאן עולה ')+shekel(st.winner.cost)+', לעומת '+shekel(st.winner.average)+' בממוצע בחשבון. העותק ייווצר מושהה, עם אותן מודעות וקהלים, ותוכל להפעיל אותו באישור נפרד.','budget-why'));
  body.append(el('p','תקציב יומי נוכחי'+(dup?' בקמפיין המקורי':'')+': '+shekel(current),'budget-current'));
  const form=el('form','','budget-form'),chips=el('div','','budget-chips');chips.setAttribute('role','group');chips.setAttribute('aria-label','שינוי מהיר');
  const input=field(form,dup?'תקציב יומי לעותק (₪)':'תקציב יומי חדש (₪)','dailyBudget',{type:'number',value:String(dup?current:round(current*1.2)),required:true});input.step='1';input.min='1';input.inputMode='numeric';
  [['−20%',0.8],['+20%',1.2],['+50%',1.5]].forEach(([label,f])=>{const b=button(label,()=>{input.value=String(round(current*f));update();},'secondary budget-chip');b.dir='ltr';chips.append(b);});
  form.prepend(chips);
  const preview=el('p','','budget-preview'),cap=el('p','','muted'),error=el('p','','form-error');preview.setAttribute('aria-live','polite');error.setAttribute('role','alert');
  if(info.capDaily)cap.textContent='תקרת ההוצאה היומית שקבעת: '+shekel(info.capDaily);
  const cost=el('p','','budget-cost');form.append(cost);
  const update=()=>{const v=Number(input.value);if(!(v>=1)){preview.textContent=cost.textContent='';return;}preview.textContent=dup?'תקציב יומי לעותק: '+shekel(v)+' (במקור '+shekel(current)+')':'מ־'+shekel(current)+' ל־'+shekel(v)+' ליום';cost.textContent='💸 '+(dup?'אחרי ההפעלה, ':'')+'עד '+shekel(v)+' ליום · בערך '+shekel(v*30)+' לחודש';};
  input.addEventListener('input',update);update();
  const submit=button('הכנה לאישור',null,'primary');submit.type='submit';form.append(preview,cost,cap,error,submit);body.append(form);
  form.addEventListener('submit',e=>{e.preventDefault();run(submit,async()=>{error.textContent='';
   const r=await api('campaigns/'+x.id+'/'+(dup?'duplicate':'budget'),{dailyBudget:Number(input.value)});
   if(!r.ok){error.textContent=r.reply;return;}
   form.hidden=true;const review=el('div','','budget-review');review.append(el('p','זה מה שיישלח ל־Meta. שום דבר לא משתנה עד שתאשר:','muted'),el('pre',r.summary,'approval-summary'));
   const result=el('p','','approval-result');result.setAttribute('role','status');
   const ok=button(dup?'מאשר, לשכפל (מושהה)':'מאשר את השינוי',()=>run(ok,async()=>{const a=await api('approvals/'+encodeURIComponent(r.actionId)+'/approve',{confirm:true});result.textContent=a.reply;ok.remove();no.remove();tell(a.reply,!a.ok);if(a.ok)setTimeout(()=>{d.close();navigate('campaign');},1500);}),'primary');
   const no=button('לא לבצע',()=>run(no,async()=>{const a=await api('approvals/'+encodeURIComponent(r.actionId)+'/reject',{});result.textContent=a.reply;ok.remove();no.remove();}),'secondary');
   const acts=el('div','','actions');acts.append(ok,no);review.append(acts,result);body.append(review);ok.focus();});});
 }
 async function renderScreen(id){
  if(id==='catalog')return catalogScreen();if(id==='performance')return [heading('ביצועי קמפיינים','מהכסף שהוצא ועד המכירות'),performanceCard()];if(id==='pages')return pageDirectory();if(id==='approvals')return approvalsScreen();if(id==='agreement')return agreementScreen();if(id==='onboarding')return onboarding();if(id==='home')return home();if(id==='brand')return brand();if(['products','tasks','expenses'].includes(id))return records(id);if(id==='content')return content();if(['sales','pipeline','customers'].includes(id))return sales(id);if(id==='creative')return creative();if(id==='landing')return landing();if(id==='integrations')return window.ScorpioConnections?window.ScorpioConnections.screen({extras:async()=>[await leadSources(),await channelsCard()]}):integrations();if(['finance','profitability'].includes(id))return finance(id);if(id==='help')return help();if(id==='account')return settings();if(id==='research')return research();if(id==='users')return users();if(id==='growth'&&window.ScorpioGrowth)return window.ScorpioGrowth.growthScreen();if(id==='team'&&window.ScorpioGrowth)return window.ScorpioGrowth.teamScreen();if(id==='agent')return [heading('הסוכן שלך','ממשיכים מהפרטים שכבר נשמרו'),empty('מה נרצה לקדם עכשיו?','הסוכן מכיר את העסק שלך. שום דבר לא עולה לאוויר ולא מחייב אותך בלי האישור שלך.',button('פתיחת שיחה',()=>openAgent(true),'primary'))];
  const descriptions={scripts:'הסוכן הקיים יכול לסייע באפיון מסר ומכירה בשיחת WhatsApp. ספריית תסריטים עם עריכה ושמירה טרם מומשה.',automations:'תורי ההודעות והפעולות המאושרות הקיימים נשמרים. בניית כללי אוטומציה בדשבורד טרם מומשה.',whatsapp:'הסוכן ושיחת העסק פועלים דרך חיבור WhatsApp הקיים. תיבת שיחות לצוות ושליחה מהדשבורד טרם מומשו.',bot:'מנוע השיחה הקיים ממשיך לנהל את תהליך השיווק. עורך בוטים ופרסום בוט מותאם טרם מומשו.',forecasts:'כדי לבנות תחזית נדרשים יעדים, טווחי זמן ומודל הנחות. אפשר לתעד מוצרים והוצאות; מודול התחזיות טרם מומש.',advisor:'אפיון רווחיות קיים במנוע השיחה. ייעוץ המבוסס על דוח הכנסות והוצאות מאוחד טרם מומש.',calendar:'אין עדיין מודול זמינות ותורים מחובר. תאריך במשימה אינו הזמנה ביומן.',bookings:'יצירת תור תדרוש שירות, צוות, אזור זמן ובדיקת זמינות במסד. מנגנון זה טרם מומש.',services:'קטלוג מוצרים ושירותים לשיווק זמין. משך שירות, זמני המתנה וזמינות להזמנה עדיין אינם מחוברים.',team:'ניהול צוות, שעות עבודה והרשאות תורים טרם מומש.', 'calendar-settings':'חיבור Google Calendar ואזור זמן ליומן עדיין אינם מוגדרים.',support:'כל המדריכים כאן. צריך עזרה? כתבו לסוכן בוואטסאפ.'};
  if(['calendar','bookings'].includes(id))return [heading(titles[id],'תורים וזמינות טרם חוברו',[button('תזכורת למעקב',()=>editRecord('tasks'),'primary')]),card('מה אפשר לעשות עכשיו?','אפשר לשמור משימת מעקב עם תאריך ולנהל את המשך הטיפול. זו תזכורת בלבד — היא אינה מזמינה פגישה ואינה בודקת זמינות.'),go('פתיחת המשימות','tasks')];
  return [heading(titles[id],'סטטוס היכולת'),empty('היכולת הזו עדיין אינה מחוברת',descriptions[id]||'מסך זה דורש השלמת חיבור.',go('למשימות והמשך העבודה','tasks'))];
 }
 const pageDescriptions={catalog:'מה העסק מוכר: לידים, קמפיין ומצב לכל פריט',brand:'ערכת המותג, זהות ותוכן ופרטי העסק',products:'קטלוג מוצרים ושירותים עם קהלים ומחירים',creative:'מרכז התוכן ותצוגות מקדימות',content:'לוח חודשי, טיוטות ועריכת פוסטים',campaign:'טיוטת קמפיין, מודעות, חיבור Meta ודוחות',landing:'עמודי מכירה, תצוגה מקדימה ואיסוף לידים',research:'פרופילי לקוחות ותכנון מחקר',integrations:'Meta, רשתות חברתיות ומצב חיבורים'};
 function marketingDirectory(){const section=el('section','','page-directory');section.append(el('h2','כל דפי מחלקת השיווק'));const grid=el('div','','page-directory-grid');groups.marketing.items.forEach(([id,label],index)=>{const c=card();c.classList.add('interactive-card');c.append(el('span',String(index+1).padStart(2,'0'),'directory-number'),el('h3',label),el('p',pageDescriptions[id],'muted'),go('פתיחת '+label,id));grid.append(c);});section.append(grid);return section;}
 function pageDirectory(){const out=[heading('כל הדפים','כל מסכי SCORPIO AI — כניסה ישירה מכל מקום')];Object.entries(groups).forEach(([key,g])=>{if(key==='home')return;const section=el('section','','page-directory');section.append(el('h2',g.label));const grid=el('div','','page-directory-grid');g.items.forEach(([id,label])=>{const c=card();c.classList.add('interactive-card');c.append(el('h3',label));if(pageDescriptions[id])c.append(el('p',pageDescriptions[id],'muted'));else if(['scripts','automations','whatsapp','bot','forecasts','advisor','calendar','bookings','services','calendar-settings'].includes(id))c.append(badge('יכולת בתהליך מימוש','warning'));c.append(go('פתיחת '+label,id));grid.append(c);});section.append(grid);out.push(section);});const sys=el('div','','page-directory-grid');system.forEach(([id,label])=>{const c=card(label);c.classList.add('interactive-card');c.append(go('פתיחת '+label,id));sys.append(c);});out.push(el('h2','מערכת וחשבון'),sys);return out;}
 const shekel=v=>v===null||v===undefined?'—':'₪'+Math.round(v).toLocaleString('he-IL'),percent=v=>v===null||v===undefined?'—':Math.round(v*100)+'%';
 // Ad spend -> leads -> meetings -> sales -> revenue, from Meta and the CRM together.
 function performanceCard(){
  const c=card('ביצועים: מהפרסום ועד המכירה'),controls=el('div','','performance-controls'),period=el('select');period.setAttribute('aria-label','תקופת ביצועים');for(const [value,label]of [['last_7d','7 ימים אחרונים'],['last_14d','14 ימים אחרונים'],['last_30d','30 ימים אחרונים']]){const o=el('option',label);o.value=value;period.append(o);}controls.append(period);c.append(controls);
  const body=el('div','','performance-body');body.setAttribute('aria-live','polite');c.append(body);
  const load=async()=>{body.replaceChildren(el('p','טוען נתונים…','muted'));try{const r=await api('business-report?period='+period.value),f=r.funnel,m=r.metrics;body.replaceChildren();
   body.append(stats([['סכום שהוצא',r.spend===null?'—':shekel(r.spend),r.spend===null?'חשבון Meta לא מחובר':''],['לידים',f.leads,m.costPerLead!==null?shekel(m.costPerLead)+' לליד':''],['מכירות',f.won,percent(m.closeRate)+' שיעור סגירה'],['הכנסות',shekel(f.revenue),m.revenuePerShekel!==null?'החזר על הפרסום ×'+m.revenuePerShekel.toFixed(1):'']]));
   const steps=[['לידים',f.leads],['קיבלו מענה',f.contacted],['פגישות',f.meetings],['מכירות',f.won]],max=Math.max(1,f.leads),funnel=el('div','','funnel');steps.forEach(([label,value])=>{const row=el('div','','funnel-row'),bar=el('div','','funnel-bar');bar.style.width=Math.max(4,Math.round(value/max*100))+'%';row.append(el('span',label),bar,el('strong',String(value)));funnel.append(row);});body.append(funnel);if(r.speed?.leads)body.append(el('p','⏱ זמן תגובה ממוצע ללידים: '+r.speed.label+(r.speed.fastShare!=null?' · '+percent(r.speed.fastShare)+' תוך 15 דקות':''),'muted'));
   if(r.campaigns.length)body.append(el('h3','לפי קמפיין'),table(['קמפיין','לידים','מכירות','הכנסות','עלות למכירה'],r.campaigns.map(x=>[x.name,x.leads,x.won,shekel(x.revenue),x.costPerCustomer!==null?shekel(x.costPerCustomer):x.costPerLead!==null?shekel(x.costPerLead)+' לליד':'—'])));
   const next=el('ol','','next-steps');r.nextSteps.forEach(t=>next.append(el('li',t)));body.append(el('h3','מה כדאי לעשות עכשיו'),next);
   if(f.staleUntouched)body.append(go('ללידים שמחכים לתשובה','leads'));
  }catch(e){body.replaceChildren(el('p',e.message,'error'));}};
  period.addEventListener('change',load);load();
  const actions=el('div','','actions');actions.append(go('בדיקת החיבורים','integrations'),go('כל הלידים','leads'));c.append(actions);return c;
 }
 // Pick an image, shrink it to at most 1600px JPEG, and send it to the agent like a WhatsApp photo.
 function pickImage(){return new Promise((resolve,reject)=>{const input=document.createElement('input');input.type='file';input.accept='image/*';input.addEventListener('change',()=>{const file=input.files?.[0];if(!file)return resolve(null);if(file.size>20*1024*1024)return reject(Error('התמונה גדולה מדי.'));const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{const scale=Math.min(1,1600/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);URL.revokeObjectURL(url);resolve({imageBase64:canvas.toDataURL('image/jpeg',0.85).split(',')[1],mimeType:'image/jpeg'});};img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('לא הצלחנו לקרוא את התמונה.'));};img.src=url;});input.click();});}
 async function sendImage(caption){const image=await pickImage();if(!image)return null;tell('שולח את התמונה לסוכן…');const r=await api('agent/attachment',{...image,caption,requestId:crypto.randomUUID()});return {reply:r.reply,media:(r.mediaIds||[]).map(id=>({id,url:'/app/api/agent/media/'+encodeURIComponent(id)}))};}
 function greeting(){const h=Number(new Date().toLocaleString('en-US',{timeZone:'Asia/Jerusalem',hour:'numeric',hour12:false}))%24;return h>=5&&h<12?'בוקר טוב':h>=12&&h<17?'צהריים טובים':h>=17&&h<22?'ערב טוב':'לילה טוב';}
 function ago(ts){const m=Math.max(0,Math.round((Date.now()-new Date(ts).getTime())/60000));if(m<1)return 'עכשיו';if(m<60)return 'לפני '+m+' דק׳';const h=Math.round(m/60);if(h<24)return h===1?'לפני שעה':'לפני '+h+' שעות';const d=Math.round(h/24);return d===1?'אתמול':'לפני '+d+' ימים';}
 function decisionCard(a){
  const lines=String(a.summary||'').split('\n').map(x=>x.replace(/[*_]/g,'').trim()).filter(x=>x&&!/(חשבון|מס׳ אישור|מס' אישור)\s*:/.test(x)&&!/\bact_\w+/.test(x)),c=el('article','','hx-decision'+(a.startsSpending?' hx-spend':''));
  c.append(el('h3',lines[0]||'פעולה לאישור'));if(lines.length>1)c.append(el('p',lines.slice(1).join('\n'),'hx-why'));
  c.append(el('small','בתוקף עד '+new Date(a.expiresAt).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',day:'numeric',month:'numeric'}),'hx-expiry'));
  const result=el('p','','approval-result');result.setAttribute('role','status');
  const ok=button(a.startsSpending?'מאשר, להפעיל':'לאשר',()=>run(ok,async()=>{if(a.startsSpending&&!await UI.confirm('הפעלת פרסום','האישור מפעיל פרסום ומתחיל לחייב מהתקציב. להמשיך?','מאשר להפעיל'))return;const r=await api('approvals/'+encodeURIComponent(a.actionId)+'/approve',{confirm:true});result.textContent=r.reply;ok.remove();no.remove();tell(r.reply,!r.ok&&!r.reoffered);if(r.reoffered||r.activationActionId)setTimeout(()=>navigate('approvals'),1200);}),'primary');
  const no=button(a.task?'ביטול המשימה':'לא לבצע',()=>run(no,async()=>{const r=await api('approvals/'+encodeURIComponent(a.actionId)+'/reject',{});result.textContent=r.reply;ok.remove();no.remove();}),'secondary');
  const acts=el('div','','hx-acts');acts.append(ok,no);c.append(acts,result);return c;
 }
 function setupPanel(setup){
  const s=el('section','','hx-setup setup-steps');const left=setup.total-setup.done;s.append(el('h2',left===1?'עוד צעד אחד והכול מוכן':`עוד ${left} צעדים והכול מוכן`));const bar=el('progress');bar.max=setup.total;bar.value=setup.done;bar.setAttribute('aria-label',`${setup.done} מתוך ${setup.total} צעדים הושלמו`);s.append(bar);
  setup.steps.forEach(step=>{const row=el('div','','setup-row'+(step.done?' done':''));row.append(el('span',step.done?'✓':'○','setup-mark'),el('span',step.title));if(!step.done)row.append(button('להתחיל',()=>step.screen==='agent'?openAgent(true):navigate(step.screen),'secondary'));s.append(row);});return s;
 }
 function leadRow(l){
  const row=button('',()=>navigate('leads'),'hx-lead'),won=l.status==='WON'&&l.currency==='ILS'&&Number(l.revenue_minor)>0;
  const who=el('span','','hx-who');who.append(el('strong',l.name),el('small',[leadSourceLabel(l.source),ago(l.created_at)].filter(Boolean).join(', ')));
  row.append(el('span',(l.name||'?').trim().charAt(0),'hx-avatar'),who,el('span',won?'נסגר '+shekel(Number(l.revenue_minor)/100):statuses[l.status]||l.status,'hx-chip hx-'+String(l.status).toLowerCase()));
  row.setAttribute('aria-label',l.name+', '+(statuses[l.status]||l.status));return row;
 }
 // Ledger home: the assistant's note, the measured path from ad spend to revenue, campaigns, and a rail for what waits.
 function agentBrief(headline,sub,chips){
  const c=el('section','','lg-brief');c.setAttribute('aria-label','הסוכן שלך');c.append(el('h1',headline));const subLine=el('p',sub,'lg-sub');c.append(subLine);
  const form=el('form','','lg-compose'),input=el('input');input.name='message';input.required=true;input.maxLength=2000;input.autocomplete='off';input.placeholder='מה לעשות היום? למשל: תכין לי קמפיין לשירות הכי רווחי';input.setAttribute('aria-label','הודעה לסוכן');
  const attach=button('',()=>run(attach,async()=>{const r=await sendImage(input.value.trim());if(!r)return;log.replaceChildren(el('p','📷 תמונה'+(input.value.trim()?': '+input.value.trim():''),'lg-you'),el('p',r.reply,'lg-agent'));input.value='';tell('התמונה נשלחה לסוכן.');}),'lg-icon');attach.append(UI.icon('attachment'));attach.setAttribute('aria-label','צירוף תמונה לסוכן');attach.title='צירוף תמונה';
  const send=button('שליחה',null,'primary');send.type='submit';form.append(input,attach,send);
  const row=el('div','','lg-chips');chips.forEach(([label,action])=>row.append(button(label,action,'lg-chip')));
  const log=el('div','','lg-log');log.setAttribute('role','log');log.setAttribute('aria-live','polite');log.setAttribute('aria-label','תשובת הסוכן');
  let pending=null;form.addEventListener('submit',e=>{e.preventDefault();run(send,async()=>{const message=input.value.trim();if(!message)return;pending=pending?.message===message?pending:{message,screen:'home',requestId:crypto.randomUUID()};log.replaceChildren(el('p','רגע, חושב…','lg-wait'));try{const r=await api('agent',pending);pending=null;log.replaceChildren(el('p',message,'lg-you'),el('p',r.reply,'lg-agent'));input.value='';}catch(err){log.replaceChildren(el('p',err.message,'error'));throw err;}});});
  c.append(form,row,log,el('small','שום דבר לא עולה לאוויר ולא מחייב אותך בלי האישור שלך.','lg-safe'));c.subLine=subLine;return c;
 }
 function sparkline(series,label){const ns='http://www.w3.org/2000/svg',w=120,h=28,max=Math.max(1,...series),svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.setAttribute('class','lg-spark');svg.setAttribute('role','img');svg.setAttribute('aria-label',label);const step=series.length>1?w/(series.length-1):w;const pts=series.map((v,k)=>`${(w-k*step).toFixed(1)},${(h-2-(v/max)*(h-6)).toFixed(1)}`).join(' ');const line=document.createElementNS(ns,'polyline');line.setAttribute('points',pts);svg.append(line);return svg;}
 function flowStrip(report){
  const f=report.funnel,m=report.metrics,wrap=el('div','','lg-flow');const pct=v=>v===null||v===undefined?'':Math.round(v*100)+'%';
  const step=(label,value,{note='',ratio=null,cls='',action=null}={})=>{const d=el('div','','lg-step '+cls);d.append(el('span',label,'lg-k'),el('strong',String(value),'lg-v'));if(note)d.append(el('span',note,'lg-note'));if(action)d.append(action);if(ratio!==null){const bar=el('span','','lg-bar'),fill=el('i');fill.style.width=Math.max(0,Math.min(100,Math.round(ratio*100)))+'%';bar.append(fill);d.append(bar);}return d;};
  const connect=button('חיבור Meta',()=>navigate('integrations'),'lg-link');
  wrap.append(report.spend===null?step('עלות פרסום','לא מחובר',{cls:'lg-off',action:connect}):step('עלות פרסום',shekel(report.spend),{note:m.costPerLead===null?'':shekel(m.costPerLead)+' לליד'}),
   step('לידים',f.leads,{cls:'lg-leads-step'}),
   step('קיבלו מענה',f.contacted,{ratio:f.leads?f.contacted/f.leads:0,note:f.leads?pct(m.contactRate)+' מהלידים':''}),
   step('נסגרו',f.won,{ratio:f.leads?f.won/f.leads:0,note:f.contacted?Math.round(f.won/f.contacted*100)+'% מהם':''}),
   step('הכנסה',shekel(f.revenue||0),{cls:'lg-rev'+(f.revenue?'':' lg-zero'),ratio:f.revenue?1:0}));
  return wrap;
 }
 // The one number an owner asks first: what is left after paying for ads.
 function bottomLine(report){const f=report.funnel,rev=f.revenue||0,box=el('div','','lg-bottom');
  if(rev&&report.spend!==null){const left=rev-report.spend;box.classList.add(left>=0?'up':'down');box.append(el('span',left>=0?'השבוע נשאר לך אחרי הפרסום':'השבוע הפרסום עלה יותר ממה שנכנס','lg-bottom-k'),el('strong',shekel(Math.abs(left)),'lg-bottom-v'),el('small',`${f.won} מכירות · ${shekel(rev)} הכנסות · ${shekel(report.spend)} פרסום`,'lg-bottom-note'));}
  else if(rev){box.append(el('span','הכנסות השבוע','lg-bottom-k'),el('strong',shekel(rev),'lg-bottom-v'),el('small',`${f.won} מכירות · חברו את Meta כדי לראות כמה נשאר אחרי הפרסום`,'lg-bottom-note'));}
  else{box.classList.add('calm');box.append(el('span','השורה התחתונה','lg-bottom-k'),el('strong','עוד אין מכירות השבוע','lg-bottom-v small'),el('small','כשליד קונה, סמנו "נסגר" עם סכום, ותראו כאן כמה נשאר לכם בכיס.','lg-bottom-note'));}
  return box;}
 function flowVerdict(report){const f=report.funnel,m=report.metrics,p=el('p','','lg-verdict');
  if(m.revenuePerShekel!==null){p.append('כל שקל על פרסום החזיר ',el('b','₪'+m.revenuePerShekel.toFixed(1)),'. עלות ללקוח שסגר: ',el('b',shekel(m.costPerCustomer)),'.');}
  else if(f.won&&f.revenue){p.append('ממוצע לעסקה ',el('b',shekel(f.revenue/f.won)),'. ',report.spend===null?'אחרי חיבור Meta יופיעו כאן עלות ללקוח והחזר לכל שקל.':'');}
  else if(f.won)p.append('סמנו סכום לעסקאות שנסגרו, כדי לראות אם הפרסום רווחי.');
  else if(f.leads)p.append('כשליד קונה, סמנו אותו "נסגר" עם סכום. כך תראה כמה הפרסום החזיר.');
  else p.append('עוד אין לידים בשבוע הזה. כשקמפיין ירוץ, תראה כאן את כל הדרך מהפרסום ועד המכירה.');return p;}
 function campaignTable(report){
  const rows=(report.metaCampaigns&&report.metaCampaigns.length?report.metaCampaigns:report.campaigns||[]).slice(0,6);
  if(!rows.length){const d=el('div','','lg-calm');d.append(el('b','עוד אין קמפיינים עם נתונים השבוע'),el('span','כשקמפיין ירוץ, תראה כאן כמה הוא עלה, כמה לידים הביא וכמה מהם נסגרו.'));const b=button('צור לי קמפיין',()=>openAgent(true),'secondary');d.append(b);return d;}
  const scroll=el('div','','lg-table'),t=el('table'),head=el('tr');[['קמפיין',''],['עלות פרסום','n'],['לידים','n'],['נסגרו','n'],['הכנסה','n']].forEach(([l,c])=>{const th=el('th',l);if(c)th.className='n';th.scope='col';head.append(th);});const thead=el('thead');thead.append(head);const tb=el('tbody');
  rows.forEach(x=>{const tr=el('tr');tr.append(el('td',x.name),el('td',x.spend===undefined||x.spend===null?'—':shekel(x.spend),'n'),el('td',String(x.leads||0),'n'),el('td',String(x.won||0),'n'),el('td',x.revenue?shekel(x.revenue):'—','n'));tb.append(tr);});t.append(thead,tb);scroll.append(t);return scroll;
 }
 function railHead(title,action){const h=el('div','','lg-rail-head');h.append(el('h2',title));if(action)h.append(action);return h;}
 const TODO_VERB={leads:'לענות',approvals:'לאשר',campaign:'לקמפיינים',pipeline:'לעסקאות',integrations:'לחבר',brand:'להשלים',products:'להוסיף',onboarding:'להשלים',billing:'למנוי',content:'לתוכן',agent:'לסוכן',tasks:'למשימות'};
 async function home(){
  const [tasks,leads,newMeta,approvals,today]=await Promise.all([api('workspace/tasks'),api('leads'),api('leads/new-meta'),api('approvals').catch(()=>({approvals:[]})),api('today').catch(()=>({items:[],setup:{done:0,total:0,steps:[]}}))]),open=tasks.items.filter(x=>x.payload.status==='OPEN'),pending=approvals.approvals||[];
  updateBell(today.items.length);
  const waiting=leads.leads.filter(l=>l.status==='NEW'),oldest=waiting[waiting.length-1],setupLeft=today.setup.total-today.setup.done;
  const headline=greeting()+'. '+(waiting.length?(waiting.length===1?`ליד אחד מחכה לתשובה${oldest?', '+oldest.name+' '+ago(oldest.created_at).replace('לפני ','מחכה כבר '):''}.`:`${waiting.length} לידים מחכים לתשובה, ${oldest.name} ${ago(oldest.created_at).replace('לפני ','מחכה כבר ')}.`):pending.length?(pending.length===1?'פעולה אחת מחכה לאישור שלך.':`${pending.length} פעולות מחכות לאישור שלך.`):setupLeft>0?(setupLeft===1?'עוד צעד אחד והעסק מוכן לפרסום.':`עוד ${setupLeft} צעדים והעסק מוכן לפרסום.`):'הכול רגוע היום.');
  const chips=[['להכין קמפיין',()=>openAgent(true)],['מי מחכה לתשובה?',()=>navigate('leads')],['תראה לי את התוצאות',()=>navigate('performance')]];
  const brief=agentBrief(headline,'טוען את נתוני השבוע…',chips);
  const main=el('div','','lg-main'),rail=el('aside','','lg-rail');rail.setAttribute('aria-label','מה מחכה לך');main.append(brief);
  main.append(statusPanel());
  const setup=today.setup.total&&setupLeft>0?setupPanel(today.setup):null;if(setup&&!leads.leads.length)main.append(setup);
  {const xp=window.ScorpioExperience?.progressSection?.();if(xp)main.prepend(xp);}
  const flowSec=el('section','','lg-sec'),flowHead=el('div','','lg-sec-head'),flowTitle=el('h2','מהפרסום ועד המכירה');flowHead.append(flowTitle,el('span','7 הימים האחרונים','lg-meta'));flowSec.append(flowHead,el('p','טוען…','lg-wait'));main.append(flowSec);
  const campSec=el('section','','lg-sec'),campHead=el('div','','lg-sec-head');campHead.append(el('h2','קמפיינים'),el('span','7 הימים האחרונים','lg-meta'));campSec.append(campHead,el('p','טוען…','lg-wait'));main.append(campSec);
  if(setup&&leads.leads.length)main.append(setup);
  api('business-report?period=last_7d').then(r=>{const f=r.funnel;brief.subLine.textContent=(f.won?`השבוע נסגרו ${f.won} עסקאות ב־${shekel(f.revenue||0)}.`:f.leads?`השבוע נכנסו ${f.leads} לידים.`:'השבוע עוד לא נכנסו לידים.')+(r.spend===null?' כדי לדעת כמה הפרסום עלה, צריך לחבר את חשבון Meta.':` הוצאה על פרסום: ${shekel(r.spend)}.`);
   const strip=flowStrip(r);flowSec.replaceChildren(flowHead,bottomLine(r),strip,flowVerdict(r));campSec.replaceChildren(campHead,campaignTable(r));
   trendReady.then(t=>{const cell=strip.querySelector('.lg-leads-step');if(!t||!cell)return;const series=t.series.map(x=>x.leads);if(!series.some(Boolean))return;cell.append(sparkline(series,'לידים ביום ב־14 הימים האחרונים'),el('span','לידים ביום, 14 ימים','lg-note lg-spark-note'));});
  }).catch(()=>{brief.subLine.textContent='לא הצלחנו לטעון את נתוני השבוע.';flowSec.replaceChildren(flowHead,el('p','לא הצלחנו לטעון את נתוני השבוע. נסו לרענן.','lg-wait'));campSec.remove();});
  const trendReady=api('trend?days=14').catch(()=>null);
  // Rail: approvals, today's items, newest leads.
  const appr=el('section','','lg-rail-sec');appr.append(railHead('מחכה לאישור שלך',pending.length>3?button('כל האישורים',()=>navigate('approvals'),'lg-link'):null));
  pending.slice(0,3).forEach(a=>appr.append(decisionCard(a)));
  if(!pending.length){const d=el('div','','lg-calm');d.append(el('b','אין פעולות שמחכות לאישור'),el('span','כשאכין שינוי בקמפיין, הוא יופיע כאן ובוואטסאפ, ולא יבוצע בלי אישור.'));appr.append(d);}
  today.items.forEach(item=>{const row=el('div','','lg-todo urgency-'+item.urgency),copy=el('div');copy.append(el('strong',item.text));if(item.detail)copy.append(el('small',item.detail));row.append(copy,button(TODO_VERB[item.screen]||'לפתוח',()=>navigate(item.screen),item.urgency>=3?'primary':'secondary'));appr.append(row);});
  const recent=el('section','','lg-rail-sec');recent.append(railHead('לידים אחרונים',leads.leads.length?button(`כל ${leads.leads.length} הלידים`,()=>navigate('leads'),'lg-link'):null));const list=el('div','','lg-leads');
  if(newMeta.count){const meta=button(`${newMeta.count} לידים חדשים מ־Meta`,()=>run(meta,async()=>{const d=dialog('לידים חדשים מ־Meta'),box=el('div');const show=async before=>{const page=await api('leads/new-meta'+(before?'?before='+encodeURIComponent(before):''));for(const lead of page.leads)box.append(leadCard(lead));if(page.next){const more=button('עוד לידים',()=>run(more,async()=>{await show(page.next);more.remove();}));box.append(more);}};await show();d.append(box);d.showModal();}),'lg-banner');list.append(meta);}
  if(leads.leads.length)leads.leads.slice(0,5).forEach(l=>list.append(leadRow(l)));else list.append(empty('עוד אין לידים','לידים חדשים יופיעו כאן.',go('פתיחת הלידים','leads')));recent.append(list);
  const tasksSec=el('section','','lg-rail-sec');tasksSec.append(railHead('משימות פתוחות',open.length?button('כל המשימות',()=>navigate('tasks'),'lg-link'):null));
  if(open.length)open.slice(0,4).forEach(x=>{const row=el('div','','lg-task');row.append(el('span',x.payload.title),el('small',x.payload.date||'ללא תאריך'));tasksSec.append(row);});else tasksSec.append(el('p','אין משימות פתוחות.','lg-meta'));
  rail.append(appr,recent,tasksSec);
  const layout=el('div','','lg-layout');layout.append(main,rail);
  return [layout];
 }
 function updateBell(count){const bell=document.querySelector('[aria-label^="התראות"]');if(!bell)return;bell.querySelector('.bell-count')?.remove();if(count){const dot=el('span',String(count),'bell-count');bell.append(dot);bell.setAttribute('aria-label','התראות ועדכונים · '+count);}}
 // "What I did and why": every action prepared or done, with its reason.
 function activityCard(){
  const c=card('מה עשיתי ולמה','30 הימים האחרונים · שום דבר לא עולה לאוויר ולא מחייב אותך בלי האישור שלך'),body=el('div');body.append(el('p','טוען…','muted'));c.append(body);
  api('activity').then(({items})=>{body.replaceChildren();if(!items.length){body.append(el('p','עוד לא בוצעו פעולות בחשבון הפרסום.','muted'));return;}
   items.slice(0,15).forEach(x=>{const row=el('div','','today-row'),copy=el('div');copy.append(el('strong',x.what),el('small',new Date(x.at).toLocaleDateString('he-IL',{weekday:'short',day:'numeric',month:'numeric'})+' · '+x.status));if(x.why)copy.append(el('p','למה: '+x.why,'muted'));row.append(copy);
    // "החזר למצב הקודם" (24 hours): goes through the agreement / approval rules like any action.
    if(x.undo&&x.actionId){const u=button(x.undo.label,()=>run(u,async()=>{const r=await api('activity/'+encodeURIComponent(x.actionId)+'/undo',{});tell(r.reply,!r.ok);if(r.ok)navigate(r.mode==='approval'?'approvals':current);}),'secondary undo-button');row.append(u);}
    body.append(row);});
  }).catch(()=>{body.replaceChildren(el('p','לא הצלחנו לטעון את היומן.','muted'));});
  return c;
 }
 // The five things the owner always sees: done, running now, waiting, failed, actual spend.
 function statusPanel(){
  const sec=el('section','','lg-sec status-panel'),head=el('div','','lg-sec-head');head.append(el('h2','תמונת מצב'),el('span','7 הימים האחרונים','lg-meta'));sec.append(head,el('p','טוען…','lg-wait'));sec.setAttribute('aria-live','polite');
  api('status').then(s=>{
   const money=v=>'₪'+Math.round(v).toLocaleString('he-IL'),grid=el('div','','status-grid');
   const box=(icon,title,items,emptyText,screen)=>{const b=el('div','','status-box');b.append(el('strong',icon+' '+title+(items.length?' ('+items.length+')':'')));if(!items.length)b.append(el('small',emptyText,'muted'));items.slice(0,3).forEach(x=>b.append(el('small','• '+x.what+(x.autonomous?' · לבד, לפי ההסכם':''))));if(screen&&items.length)b.append(button('לפרטים',()=>navigate(screen),'lg-link'));grid.append(b);};
   box('✅','מה עשיתי',s.done,'עוד לא בוצעו פעולות.','approvals');
   box('⏳','מה רץ עכשיו',s.running,'שום דבר לא בביצוע.','campaign');
   box('✋','מחכה לאישור שלך',s.waiting,'שום דבר.','approvals');
   box('⚠️','מה נכשל או נעצר',s.failed,'כלום, הכול עבר תקין.','approvals');
   const spend=el('div','','status-box');spend.append(el('strong','💸 הוצאה בפועל'));spend.append(el('small',s.spend?'היום '+money(s.spend.today)+' · החודש '+money(s.spend.month)+(s.spend.monthlyCeiling?' מתוך '+money(s.spend.monthlyCeiling):''):'לא זמין כרגע: חשבון Meta לא מחובר או לא ענה.'));grid.append(spend);
   sec.replaceChildren(head,grid);
   if(s.agreement?.paused){const n=el('p','⏸ הפעולות האוטומטיות עצורות. הסוכן שואל אותך על כל פעולה.','notice');n.append(button('להסכם העבודה',()=>navigate('agreement'),'lg-link'));sec.append(n);}
  }).catch(()=>sec.replaceChildren(head,el('p','לא הצלחנו לטעון את תמונת המצב.','lg-wait')));
  return sec;
 }
 // Work agreement: set once what the agent does alone, and what always waits for the owner.
 async function agreementScreen(){
  const data=await api('agreement'),a=data.agreement,out=[heading('הסכם עבודה','פעם אחת קובעים מה הסוכן עושה לבד, ומה תמיד מחכה לאישור שלך')];
  if(a){
   const s=card(a.paused?'⏸ הפעולות האוטומטיות עצורות':'✅ ההסכם פעיל',a.paused?'הסוכן שואל אותך על כל פעולה עד שתחדש':'הסוכן פועל לבד רק בתוך מה שכתוב כאן, ומדווח ב"מה עשיתי ולמה"');
   s.append(el('p','תקרת הוצאה חודשית: ₪'+Math.round(a.monthlyCeiling).toLocaleString('he-IL')+' · תקציב יומי מקסימלי לקמפיין: ₪'+Math.round(a.maxDailyPerCampaign).toLocaleString('he-IL')));
   const yes=Object.entries(data.labels).filter(([k])=>a.allow[k]).map(([,v])=>v);s.append(el('p','עושה לבד: '+(yes.length?yes.join(' · '):'כלום, שואל על הכול'),'muted'));
   const result=el('p','','approval-result');result.setAttribute('role','status');
   const toggle=button(a.paused?'לחדש את הפעולות האוטומטיות':'עצור את כל הפעולות האוטומטיות',()=>run(toggle,async()=>{await api('agreement/'+(a.paused?'resume':'pause'),{});tell(a.paused?'הפעולות האוטומטיות חזרו לפעול לפי ההסכם.':'עצרתי את כל הפעולות האוטומטיות. מעכשיו הסוכן שואל על כל פעולה.');navigate('agreement');}),a.paused?'primary':'danger');
   const actions=el('div','','actions');actions.append(toggle);s.append(actions,result);out.push(s);
  }
  const c=card(a?'עדכון ההסכם':'הגדרת ההסכם','שינוי ההסכם חל מיד, וכל פעולה שאושרה לפי ההסכם הקודם ועוד לא בוצעה נחסמת'),form=el('form'),error=el('p','','form-error');error.setAttribute('role','alert');
  const grid=el('div','','form-grid');
  field(grid,'תקרת הוצאה חודשית על פרסום (₪)','monthlyCeiling',{type:'number',required:true,value:a?.monthlyCeiling??'',help:'כל הקמפיינים יחד. הסוכן לא יחרוג ממנה בלי אישור שלך.'});
  field(grid,'תקציב יומי מקסימלי לקמפיין (₪)','maxDailyPerCampaign',{type:'number',required:true,value:a?.maxDailyPerCampaign??''});
  form.append(grid,el('h3','מה הסוכן עושה לבד ומדווח לך'));
  const boxes={};Object.entries(data.labels).forEach(([k,label])=>{const l=el('label','','check-row'),i=document.createElement('input');i.type='checkbox';i.checked=a?!!a.allow[k]:!!data.presets.protect[k];boxes[k]=i;l.append(i,el('span',label));form.append(l);});
  form.append(el('h3','תמיד ישאל אותך קודם'));data.alwaysAsk.forEach(x=>form.append(el('p','✋ '+x,'muted')));
  field(form,'סגנון ודגשים לתוכן','styleNotes',{type:'textarea',maxLength:1000,value:a?.styleNotes||'',help:'למשל: רציני, בלי אימוג׳ים, פונים בגוף שני'});
  field(form,'נושאים אסורים (מופרדים בפסיקים)','forbiddenTopics',{maxLength:1000,value:(a?.forbiddenTopics||[]).join(', ')});
  const save=button(a?'שמירת ההסכם המעודכן':'שמירת הסכם העבודה',null,'primary');save.type='submit';form.append(error,save);
  form.addEventListener('submit',e=>{e.preventDefault();run(save,async()=>{error.textContent='';try{const f=Object.fromEntries(new FormData(form));await api('agreement',{monthlyCeiling:Number(f.monthlyCeiling),maxDailyPerCampaign:Number(f.maxDailyPerCampaign),allow:Object.fromEntries(Object.entries(boxes).map(([k,i])=>[k,i.checked])),styleNotes:f.styleNotes||'',forbiddenTopics:String(f.forbiddenTopics||'').split(',').map(x=>x.trim()).filter(Boolean)});dirtyForms.delete(form);tell('הסכם העבודה נשמר.');navigate('agreement');}catch(err){error.textContent=err.message;}});});
  c.append(form);out.push(c);
  return out;
 }
 // Pending approvals: the same ones sent on WhatsApp, approved through the same path.
 async function approvalsScreen(){
  const {approvals}=await api('approvals'),out=[heading('אישורים ממתינים','שום דבר לא עולה לאוויר ולא מחייב אותך בלי האישור שלך')];
  out.push(activityCard());
  if(!approvals.length){out.push(empty('אין אישורים ממתינים','כשהסוכן או השומר יכינו פעולה, היא תופיע כאן ובוואטסאפ.',go('חזרה לבית','home')));return out;}
  approvals.forEach(a=>{const c=card(a.startsSpending?'⚠️ פעולה שמתחילה לחייב':'פעולה לאישור');c.append(el('pre',a.summary,'approval-summary'),el('small','בתוקף עד '+new Date(a.expiresAt).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',day:'numeric',month:'numeric'})));
   const result=el('p','','approval-result');result.setAttribute('role','status');
   const ok=button(a.startsSpending?'מאשר, להפעיל':'מאשר ✅',()=>run(ok,async()=>{if(a.startsSpending&&!await UI.confirm('הפעלת פרסום','האישור מפעיל פרסום ומתחיל לחייב מהתקציב. להמשיך?','מאשר להפעיל'))return;const r=await api('approvals/'+encodeURIComponent(a.actionId)+'/approve',{confirm:true});result.textContent=r.reply;ok.remove();no.remove();tell(r.reply,!r.ok);}),'primary');
   const no=button(a.task?'ביטול המשימה':'לא לבצע',()=>run(no,async()=>{const r=await api('approvals/'+encodeURIComponent(a.actionId)+'/reject',{});result.textContent=r.reply;ok.remove();no.remove();}),'secondary');
   const actions=el('div','','actions');actions.append(ok,no);c.append(actions,result);out.push(c);});
  return out;
 }
 function brand(){
  const out=[heading('ניהול מותג','ערכת מותג, זהות ואסטרטגיית תוכן',[button('עדכון פרטי העסק עם הסוכן',()=>openAgent(true),'secondary')]),tabs([['kit','ערכת מותג'],['identity','זהות ותוכן'],['products','מוצרים ושירותים'],['context','הקשר עסקי']],brandTab,async id=>{if(!await allowLeave())return;if(id==='products')navigate('products');else{brandTab=id;navigate('brand');}})];
  if(brandTab!=='kit'){const c=card(brandTab==='identity'?'זהות ותוכן':'הקשר עסקי');const data=state.business||{};Object.entries(brandTab==='identity'?{businessName:'שם העסק',businessType:'תחום',audience:'קהל היעד',advantage:'היתרון',product:'שירות לקידום',businessGoal:'המטרה',brandTone:'סגנון התוכן'}:{geography:'אזור הפרסום',serviceArea:'אזור השירות',idealCustomer:'לקוחות רצויים',leadDestination:'דרך קבלת הפניות',leadOwner:'מי מטפל בפניות',capacity:'זמינות ללקוחות חדשים',pastMarketing:'ניסיון בפרסום',website:'אתר'}).forEach(([k,label])=>fieldValue(c,label,data[k]));c.append(button('המשך אפיון בשיחה',()=>openAgent(true),'primary'));return [...out,c];}
  const grid=el('div','','split-grid'),editor=card('לוגו וצבעים','נכסי המותג נשמרים לצד פרטי העסק'),form=el('form'),error=el('p','','form-error');error.setAttribute('role','alert');
  const layout=el('div','','brand-editor'),logoBox=el('div','','logo-box');if(state.brand?.logo){const img=el('img');img.src='/app/api/brand-image?slot=logo';img.alt='הלוגו השמור';img.addEventListener('error',()=>{img.remove();logoBox.append(el('p','לא ניתן לטעון את הלוגו מהקישור.','error'));},{once:true});logoBox.append(img);}else logoBox.append(el('span','↑','empty-icon'),el('p','קישור ללוגו של העסק'),el('small','מדביקים קישור ללוגו'));
  const palette=el('div');palette.append(el('h3','פלטת צבעים'),el('p','לחץ על צבע כדי לשנות','muted'));const colors=Array.from({length:5},(_,i)=>state.brand?.colors?.[i]||['--primary','--surface','--primary-hover','--canvas','--text'].map(key=>getComputedStyle(document.documentElement).getPropertyValue(key).trim())[i]);const savedColors=!!state.brand?.colors?.length;let colorsTouched=savedColors;const colorRow=el('div','','palette-row');['ראשי','משני','הדגשה','רקע','טקסט'].forEach((label,i)=>{const l=el('label',label),input=el('input');input.type='color';input.name='color'+i;input.value=colors[i];input.setAttribute('aria-label','צבע '+label);const code=el('small',savedColors?colors[i]:'לא נבחר');input.addEventListener('input',()=>{colorsTouched=true;code.textContent='נבחר';});l.append(input,code);colorRow.append(l);});if(!savedColors)palette.append(el('p','עוד לא נבחרו צבעים לעסק. "ייבוא פרטי עסק מאתר" ימצא אותם לבד, או שתבחר כאן.','muted'));palette.append(colorRow);layout.append(logoBox,palette);form.append(layout);
  field(form,'יש לכם קישור ללוגו?','logo',{value:state.brand?.logo,type:'url',maxLength:2000,help:'קישור לתמונת הלוגו (מתחיל ב־https).'});const fg=el('div','','form-grid');field(fg,'שם העסק','businessName',{value:state.business.businessName,required:true,maxLength:120});field(fg,'מה העסק עושה?','businessType',{value:state.business.businessType,maxLength:500});form.append(fg,error);form.append(button('ייבוא פרטי עסק מאתר',importBusiness,'secondary'));const submit=button('שמירת פרטי המותג',null,'primary');submit.type='submit';form.append(submit);
  let expectedVersion=state.profileVersion;form.addEventListener('submit',e=>{e.preventDefault();run(submit,async()=>{error.textContent='';try{const f=Object.fromEntries(new FormData(form));await api('brand',{businessName:f.businessName,businessType:f.businessType,logo:f.logo,colors:colorsTouched?Array.from({length:5},(_,i)=>f['color'+i]):undefined,version:expectedVersion});dirtyForms.delete(form);await refresh();tell('פרטי המותג נשמרו. טיוטת הקמפיין דורשת בדיקה מחודשת.');}catch(err){error.textContent=err.message+' אם הפרטים עודכנו במקביל, רעננו את המסך לפני שמירה נוספת.';}});});editor.append(form);
  const aside=el('div'),preview=card('תצוגת כרטיס מותג'),pv=el('div','','brand-preview');pv.append(el('strong',state.business.businessName||'העסק שלך'),el('p',state.business.businessType||'הפרטים יופיעו לאחר השמירה','muted'),go('לפרטים נוספים','research'));preview.append(pv);const readiness=card('מוכנות המותג'),checks=[['שם העסק',!!state.business.businessName],['תחום הפעילות',!!state.business.businessType],['לוגו',!!state.brand?.logo],['צבעי מותג',!!state.brand?.colors?.length]],done=checks.filter(x=>x[1]).length;readiness.append(progress(done*25,done+' מתוך 4 הושלמו'));checks.forEach(([l,ok])=>readiness.append(el('p',(ok?'✓ ':'○ ')+l)));aside.append(preview,readiness);grid.append(editor,aside);return [...out,grid];
 }
 function fieldValue(container,label,value){const d=el('div','','metric');d.append(el('strong',label),el('span',value==null||value===''?'עדיין לא נמסר':typeof value==='object'?JSON.stringify(value):String(value)));container.append(d);}
 const configs={products:{title:'מוצרים ושירותים',subtitle:'קהל, הבטחה, מחיר ועלות — באותו קטלוג של העסק',add:'הוסף מוצר',fields:[['שם המוצר','name',{required:true,maxLength:120}],['קהל יעד','audience',{type:'textarea',maxLength:1000}],['הבטחה מרכזית','promise',{type:'textarea',maxLength:1000}],['מחיר מכירה','priceMinor',{type:'number',help:'מחיר במטבע הנבחר; אפשר להשאיר ריק'}],['עלות ישירה','costMinor',{type:'number'}],['מטבע','currency',{options:[['ILS','₪ ILS'],['USD','USD'],['EUR','EUR']]}]]},tasks:{title:'משימות',subtitle:'כל הצעדים הבאים של העסק, עם תאריך ומצב',add:'משימה חדשה',fields:[['כותרת','title',{required:true,maxLength:160}],['הערות','note',{type:'textarea',maxLength:2000}],['תאריך יעד','date',{type:'date'}]]},expenses:{title:'הוצאות',subtitle:'כל ההוצאות של העסק',add:'הוצאה חדשה',fields:[['תיאור ההוצאה','title',{required:true,maxLength:160}],['סכום','amountMinor',{type:'number',required:true}],['מטבע','currency',{options:[['ILS','₪ ILS'],['USD','USD'],['EUR','EUR']]}],['תאריך','date',{type:'date'}],['קטגוריה','category',{maxLength:120}]]},content:{title:'טיוטת תוכן',add:'צור פוסט',fields:[['כותרת','title',{required:true,maxLength:160}],['טקסט הפוסט','body',{type:'textarea',required:true,maxLength:8000}],['ערוץ','channel',{options:[['Facebook','Facebook'],['Instagram','Instagram']]}],['תאריך מתוכנן','date',{type:'date',help:'תאריך לתכנון בלבד; אין תזמון פרסום אוטומטי'}]]}};
 configs.personas={title:'פרופיל לקוח',add:'פרופיל לקוח חדש',fields:[['שם הפרופיל','name',{required:true,maxLength:120}],['מי הלקוחות?','audience',{required:true,type:'textarea',maxLength:1000}],['מה מציק להם?','pains',{type:'textarea',maxLength:2000}],['מה הם רוצים להשיג?','desires',{type:'textarea',maxLength:2000}],['באילו ערוצים נמצאים?','channels',{maxLength:500}],['הערות','notes',{type:'textarea',maxLength:2000}]]};
 configs.research={title:'מחקר שיווקי',add:'מחקר חדש',fields:[['נושא המחקר','title',{required:true,maxLength:160}],['מה נרצה לבדוק?','question',{required:true,type:'textarea',maxLength:2000}],['ממצאים והערות','findings',{type:'textarea',maxLength:6000}],['מקור ציבורי','sourceUrl',{type:'url',maxLength:2000}],['מצב','status',{options:[['PLANNED','מתוכנן'],['IN_PROGRESS','בבדיקה'],['COMPLETE','הושלם']]}]]};
 function major(value){return value==null?'':(value/100).toFixed(2);}
 function amount(value,currency='ILS'){return value==null?'עוד לא הוגדר':new Intl.NumberFormat('he-IL',{style:'currency',currency}).format(value/100);}
 function parseMinor(value){if(value==='')return null;if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw Error('יש להזין סכום חיובי עם עד שתי ספרות אחרי הנקודה.');const [whole,decimal='']=value.split('.');const n=Number(whole)*100+Number(decimal.padEnd(2,'0'));if(!Number.isSafeInteger(n))throw Error('הסכום גדול מדי.');return n;}
 function editRecord(kind,item){
  const cfg=configs[kind],d=dialog(item?.id?'עריכת '+cfg.title:cfg.add),form=el('form'),p=item?.payload||{},error=el('p','','form-error');error.setAttribute('role','alert');
  cfg.fields.forEach(([label,name,options])=>field(form,label,name,{...options,value:name.endsWith('Minor')?major(p[name]):p[name]}));
  if(kind==='products')field(form,'מצב','active',{value:p.active===false?'false':'true',options:[['true','פעיל'],['false','לא פעיל']]});if(kind==='tasks')field(form,'מצב המשימה','status',{value:p.status||'OPEN',options:[['OPEN','פתוחה'],['DONE','הושלמה']]});
  if(kind==='content')form.append(el('p',item&&!item.id?'✨ הפוסט נכתב על ידי ה־AI. אפשר לערוך ולשמור.':'הפוסט נשמר כטיוטה. הפרסום ברשתות נעשה על ידך.','notice'));
  const actions=el('div','','actions'),save=button('שמירה',null,'primary');save.type='submit';actions.append(save,button('ביטול',()=>d.close()));form.append(error,actions);d.append(form);d.showModal();let requestId=crypto.randomUUID(),lastBody=null;
  form.addEventListener('submit',e=>{e.preventDefault();run(save,async()=>{error.textContent='';try{const values=Object.fromEntries(new FormData(form));for(const key of Object.keys(values))if(key.endsWith('Minor'))values[key]=parseMinor(values[key]);if(kind==='products')values.active=values.active==='true';const body=JSON.stringify(values);if(lastBody!==null&&lastBody!==body)requestId=crypto.randomUUID();lastBody=body;await api('workspace/'+kind+(item?.id?'/'+item.id:''),{payload:values,version:item?.version,requestId},item?.id?'PATCH':'POST');d.close();await navigate(current);tell('הפרטים נשמרו.');}catch(err){error.textContent=err.message;}});});
 }
 async function records(kind){
  const cfg=configs[kind],data=await api('workspace/'+kind),out=[heading(cfg.title,cfg.subtitle,[button('＋ '+cfg.add,()=>editRecord(kind),'primary')])];
  if(data.hasMore)out.push(el('p','מוצגות 200 הרשומות האחרונות.','notice'));
  if(!data.items.length)return [...out,empty('עדיין אין '+(kind==='products'?'מוצרים':kind==='tasks'?'משימות':'הוצאות'),'הפרטים יישמרו לעסק שלך ויהיו זמינים גם בכניסה הבאה.',button(cfg.add,()=>editRecord(kind),'primary'))];
  let filter='all',query='';const list=el('div'),toolbar=el('div','','toolbar'),search=el('input');search.type='search';search.placeholder='חיפוש';search.setAttribute('aria-label','חיפוש ברשומות');toolbar.append(search);
  const draw=()=>{let rows=data.items.filter(x=>JSON.stringify(x.payload).toLowerCase().includes(query.toLowerCase()));if(filter==='active')rows=rows.filter(x=>x.payload.active);if(filter==='open')rows=rows.filter(x=>x.payload.status==='OPEN');
   list.replaceChildren();if(!rows.length){list.append(empty('לא נמצאו תוצאות','נסו חיפוש אחר.'));return;}
   if(kind==='products')list.append(table(['מוצר','קהל יעד','הבטחה מרכזית','מחיר מכירה','עלות ישירה','מצב','פעולות'],rows.map(x=>[x.payload.name,el('p',x.payload.audience),el('p',x.payload.promise),amount(x.payload.priceMinor,x.payload.currency),amount(x.payload.costMinor,x.payload.currency),badge(x.payload.active?'פעיל':'לא פעיל'),button('עריכה',()=>editRecord(kind,x))])));
   else if(kind==='expenses')list.append(table(['תיאור','סכום','תאריך','קטגוריה','פעולות'],rows.map(x=>[x.payload.title,amount(x.payload.amountMinor,x.payload.currency),x.payload.date,x.payload.category,button('עריכה',()=>editRecord(kind,x))])));
   else rows.forEach(x=>{const c=card(x.payload.title);c.append(el('p',x.payload.note),badge(x.payload.status==='DONE'?'הושלמה':'פתוחה'),el('p',x.payload.date||'ללא תאריך','muted'));const actions=el('div','','actions'),toggle=button(x.payload.status==='DONE'?'פתיחה מחדש':'סימון כהושלמה',()=>run(toggle,async()=>{await api('workspace/tasks/'+x.id,{payload:{...x.payload,status:x.payload.status==='DONE'?'OPEN':'DONE'},version:x.version,requestId:crypto.randomUUID()},'PATCH');await navigate('tasks');}));actions.append(toggle,button('עריכה',()=>editRecord(kind,x)));c.append(actions);list.append(c);});
  };
  search.addEventListener('input',()=>{query=search.value;draw();});if(kind!=='expenses'){const select=el('select');select.setAttribute('aria-label','סינון מצב');for(const [v,l]of [['all','הכל'],[kind==='products'?'active':'open',kind==='products'?'פעילים':'פתוחות']]){const o=el('option',l);o.value=v;select.append(o);}select.addEventListener('change',()=>{filter=select.value;draw();});toolbar.append(select);}draw();return [...out,toolbar,list];
 }

 // Ongoing organic content: a three-month calendar the owner approves; each post
 // arrives on WhatsApp ready to publish on its day.
 const ORGANIC_MEDIA={AI_GRAPHIC:'גרפיקה AI',AI_VIDEO:'סרטון AI',PHOTO:'צילום אמיתי',MIXED:'שילוב'},ORGANIC_FORMAT={POST:'פוסט',STORY:'סטורי',REEL:'רילס'},ORGANIC_STATUS={DRAFT:'מחכה לאישור',APPROVED:'מאושר ✓',SENDING:'נשלח עכשיו',SENT:'נשלח אליך ✓',SKIPPED:'דילגנו',FAILED:'לא נשלח'};
 const dayLabel=d=>new Date(d+'T12:00:00').toLocaleDateString('he-IL',{weekday:'long',day:'numeric',month:'numeric'});
 function organicCard(){
  const c=card('תוכן שוטף','כל יום פרסום הפוסט מגיע אליך לוואטסאפ, מוכן להעתקה');c.classList.add('organic-card');const body=el('div');body.append(el('p','טוען…','muted'));c.append(body);
  const reload=()=>navigate('content');
  api('organic').then(o=>{body.replaceChildren();
   if(!o.plan){
    const form=el('div','','organic-setup');let perWeek=3,media='MIXED';
    const pick=(label,options,value,set)=>{const g=el('div','','organic-pick');g.append(el('strong',label));const row=el('div','','quick-chips');options.forEach(([v,l])=>{const b=button(l,()=>{set(v);row.querySelectorAll('button').forEach(x=>x.classList.toggle('primary',x===b));},v===value?'primary':'secondary');row.append(b);});g.append(row);return g;};
    form.append(el('p','בחרו כמה פוסטים בשבוע ואיך ליצור את התמונות. נכין לוח ל־3 חודשים, ושום דבר לא עולה לאוויר בלי האישור שלך.'),pick('כמה פוסטים בשבוע?',[[2,'2'],[3,'3'],[5,'5']],perWeek,v=>perWeek=v),pick('איך ליצור את התמונות?',[['AI_GRAPHIC','🖼 גרפיקות AI'],['AI_VIDEO','🎬 סרטוני AI'],['PHOTO','📸 צילום אמיתי'],['MIXED','✨ שילוב']],media,v=>media=v));
    const go=button('בנו לי לוח ל־3 חודשים','','primary');go.addEventListener('click',()=>run(go,async()=>{tell('מכין את הלוח… זה לוקח כחצי דקה');const r=await api('organic/plan',{perWeek,media});tell(`✅ מוכן: ${r.count} פוסטים`);reload();}));
    form.append(go);body.append(form);body.append(shootBox());return;}
   const p=o.plan,head=el('div','','setup-steps');
   head.append(el('strong',`${ORGANIC_MEDIA[p.media_mode]} · ${p.posts_per_week} פוסטים בשבוע · עד ${dayLabel(p.ends_on)}${p.status==='PAUSED'?' · בהשהיה':''}`));
   const actions=el('div','','actions');
   if(o.waiting){const all=button(`אשר את כל ${o.waiting} הפוסטים`,()=>run(all,async()=>{const r=await api('organic/approve-all',{});tell(`✅ אישרת ${r.approved} פוסטים`);reload();}),'primary');actions.append(all);}
   const toggle=button(p.status==='PAUSED'?'להמשיך':'השהיה',()=>run(toggle,async()=>{await api('organic/status',{status:p.status==='PAUSED'?'ACTIVE':'PAUSED'});reload();}),'secondary');
   const more=button('עוד 3 חודשים',()=>run(more,async()=>{tell('מכין עוד 3 חודשים…');const r=await api('organic/plan',{perWeek:p.posts_per_week,media:p.media_mode,extend:true});tell(`✅ נוספו ${r.count} פוסטים`);reload();}),'secondary');
   actions.append(toggle);if(p.daysLeft<=30)actions.append(more);head.append(actions);body.append(head);
   const upcoming=o.posts.filter(x=>x.publish_on>=o.today),past=o.posts.filter(x=>x.publish_on<o.today);let shown=8;
   const list=el('div','','organic-list');
   const draw=()=>{list.replaceChildren();upcoming.slice(0,shown).forEach(x=>list.append(postRow(x,reload)));if(upcoming.length>shown){const m=button(`להציג עוד (${upcoming.length-shown})`,()=>{shown+=12;draw();},'ghost');list.append(m);}};draw();
   body.append(list);
   if(past.length){const d=el('details');d.append(el('summary',`פוסטים מהשבועיים האחרונים (${past.length})`));past.slice().reverse().forEach(x=>d.append(postRow(x,reload)));body.append(d);}
   body.append(shootBox(o.shoots));
  }).catch(()=>{body.replaceChildren(el('p','לא הצלחנו לטעון את התוכן השוטף.','muted'));});
  return c;
 }
 function postRow(x,reload){
  const row=el('div','','today-row organic-row'),copy=el('div');
  copy.append(el('strong',`${dayLabel(x.publish_on)} · ${ORGANIC_FORMAT[x.format]} · ${ORGANIC_MEDIA[x.media]}`),el('small',x.topic));
  const text=el('p',x.caption,'organic-caption'),live=(x.publications||[]).filter(p=>p.status==='PUBLISHED');copy.append(text,badge(live.length?'פורסם ✓':ORGANIC_STATUS[x.status]||x.status,x.status==='DRAFT'&&!live.length?'warning':''));
  live.forEach(p=>{const name=p.network==='instagram'?'אינסטגרם':'פייסבוק';if(p.permalink){const a=el('a','לפוסט ב'+name);a.href=p.permalink;a.target='_blank';a.rel='noopener noreferrer';copy.append(a);}else copy.append(el('small','פורסם ב'+name));});
  (x.publications||[]).filter(p=>['FAILED','UNCERTAIN'].includes(p.status)).forEach(p=>copy.append(el('small',(p.network==='instagram'?'אינסטגרם':'פייסבוק')+': '+(p.status==='UNCERTAIN'?'לא בטוח שפורסם, כדאי לבדוק בדף':'לא פורסם, נשלח אליך לוואטסאפ'),'muted')));
  const actions=el('div','','actions');
  if(x.status==='DRAFT'){const ok=button('אשר',()=>run(ok,async()=>{await api('organic/posts/'+x.id,{action:'approve'});reload();}),'primary');actions.append(ok);}
  if(['DRAFT','APPROVED'].includes(x.status)){
   const edit=button('עריכה',()=>{const area=el('textarea');area.value=x.caption;area.maxLength=1000;area.rows=5;area.setAttribute('aria-label','טקסט הפוסט');const save=button('שמירה',()=>run(save,async()=>{await api('organic/posts/'+x.id,{action:'edit',caption:area.value});reload();}),'primary');text.replaceWith(area);actions.replaceChildren(save,button('ביטול',reload,'ghost'));},'secondary');
   const skip=button('דלג',()=>run(skip,async()=>{await api('organic/posts/'+x.id,{action:'skip'});reload();}),'ghost');actions.append(edit,skip);}
  if(x.status==='SKIPPED'&&x.publish_on>=new Date().toISOString().slice(0,10)){const back=button('להחזיר',()=>run(back,async()=>{await api('organic/posts/'+x.id,{action:'restore'});reload();}),'ghost');actions.append(back);}
  if(['SENT','SKIPPED','FAILED'].includes(x.status)){const cp=button('העתקת הטקסט',()=>{navigator.clipboard?.writeText(x.caption).then(()=>tell('הטקסט הועתק ✓'),()=>tell('לא הצלחנו להעתיק',true));},'ghost');actions.append(cp);}
  row.append(copy,actions);return row;
 }
 function shootBox(shoots=[]){
  const box=el('div','','organic-shoot');box.append(el('h3','📸 יום צילום בעסק'),el('p','צלם מקצועי מגיע לעסק לכמה שעות. התמונות נכנסות לפוסטים ולמודעות שלכם לחודשים קדימה.','muted'));
  const open=shoots.find(s=>['REQUESTED','SCHEDULED'].includes(s.status));
  if(open){box.append(badge(open.status==='SCHEDULED'?'נקבע ✓':'הבקשה התקבלה, נחזור אליך לתיאום'));return box;}
  const area=el('textarea');area.rows=3;area.maxLength=1000;area.placeholder='כתובת העסק, ימים ושעות נוחים, ומה חשוב לצלם (צוות, מוצרים, המקום)';area.setAttribute('aria-label','פרטים ליום הצילום');
  const send=button('הזמנת יום צילום',()=>run(send,async()=>{if(area.value.trim().length<5){tell('כתבו כתובת וזמנים נוחים',true);return;}await api('organic/photo-shoot',{details:area.value});box.replaceChildren(el('h3','📸 יום צילום בעסק'),badge('הבקשה התקבלה, נחזור אליך לתיאום'));tell('✅ הבקשה נשלחה');}),'secondary');
  box.append(area,send);return box;
 }

 // One post on demand: the owner says what it is about, the AI writes it, the owner edits and saves.
 function aiPost(){
  const d=dialog('✨ צור פוסט עם AI'),form=el('form'),error=el('p','','form-error');error.setAttribute('role','alert');
  field(form,'על מה הפוסט?','topic',{type:'textarea',maxLength:300,help:'למשל: מבצע לחג, טיפ ללקוחות, היכרות עם הצוות. אפשר להשאיר ריק ונבחר נושא בשבילך.'});
  field(form,'איפה תפרסם?','channel',{value:'Instagram',options:[['Instagram','Instagram'],['Facebook','Facebook']]});
  const go=button('כתוב לי פוסט',null,'primary');go.type='submit';const manual=button('אכתוב בעצמי',()=>{d.close();editRecord('content');},'ghost');const actions=el('div','','actions');actions.append(go,manual);form.append(error,actions);d.append(form);d.showModal();form.querySelector('textarea')?.focus();
  form.addEventListener('submit',e=>{e.preventDefault();run(go,async()=>{error.textContent='';go.textContent='כותב…';try{const f=Object.fromEntries(new FormData(form));const r=await api('organic/draft',{topic:f.topic,channel:f.channel});d.close();editRecord('content',{payload:r});}catch(err){error.textContent=err.message;}finally{go.textContent='כתוב לי פוסט';}});});
 }
 async function content(){
  const data=await api('workspace/content'),month=contentMonth.toLocaleDateString('he-IL',{month:'long',year:'numeric'}),out=[heading('תוכן לסושיאל','פוסטים קבועים לשלושה חודשים קדימה',[button('✨ צור פוסט עם AI',aiPost,'primary')]),organicCard(),el('h2','טיוטות שמורות','section-title')];
  const controls=el('div','','toolbar'),moves=el('div','','actions');moves.append(button('→',()=>{contentMonth=new Date(contentMonth.getFullYear(),contentMonth.getMonth()-1,1);navigate('content');}),el('strong',month),button('←',()=>{contentMonth=new Date(contentMonth.getFullYear(),contentMonth.getMonth()+1,1);navigate('content');}),button('החודש הנוכחי',()=>{contentMonth=new Date();navigate('content');}));moves.firstChild.setAttribute('aria-label','חודש קודם');moves.children[2].setAttribute('aria-label','חודש הבא');controls.append(moves,tabs([['calendar','לוח תוכן'],['list','רשימת טיוטות']],contentMode,id=>{contentMode=id;navigate('content');}));
  const grid=el('div','','split-grid'),calendar=card(),preview=card('תצוגה מקדימה','בחרו טיוטה מהלוח לעריכה מלאה');preview.append(empty('אין תוכן להצגה','בחרו טיוטה מהלוח.'));
  const show=x=>{preview.replaceChildren(el('h2',x.payload.title),badge(x.payload.channel+' · טיוטה'),el('p',x.payload.body),el('p',x.payload.date||'ללא תאריך','muted'),button('עריכת הטיוטה',()=>editRecord('content',x)));};
  if(contentMode==='list'){if(!data.items.length)calendar.append(empty('אין טיוטות עדיין','ה־AI יכתוב לך את הפוסט הראשון.',button('✨ צור פוסט עם AI',aiPost,'primary')));data.items.forEach(x=>calendar.append(button(x.payload.title+' · '+(x.payload.date||'ללא תאריך'),()=>show(x),'secondary')));}
  else {const cal=el('div','','calendar-grid');['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','שבת'].forEach(day=>cal.append(el('div',day,'calendar-day heading')));const y=contentMonth.getFullYear(),m=contentMonth.getMonth(),start=new Date(y,m,1).getDay(),days=new Date(y,m+1,0).getDate();for(let i=0;i<Math.ceil((start+days)/7)*7;i++){const day=i-start+1,cell=el('div','','calendar-day');if(day>0&&day<=days){cell.append(el('span',String(day)));const date=y+'-'+String(m+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');data.items.filter(x=>x.payload.date===date).forEach(x=>cell.append(button(x.payload.title,()=>show(x),'secondary')));}cal.append(cell);}calendar.append(cal);const undated=data.items.filter(x=>!x.payload.date);if(undated.length){calendar.append(el('h3','ללא תאריך'));undated.forEach(x=>calendar.append(button(x.payload.title,()=>show(x),'secondary')));}}
  grid.append(calendar,preview);return [...out,controls,grid,...(data.hasMore?[el('p','מוצגות 200 הטיוטות האחרונות.','notice')]:[])];
 }
 async function creative(){
  const [posts,products]=await Promise.all([api('workspace/content'),api('workspace/products')]);const grid=el('div','','split-grid'),calendar=card('לוח תוכן לסושיאל'),preview=card('תצוגה מקדימה','הטיוטה הקיימת מהשיחה');
  if(posts.items.length){posts.items.slice(0,4).forEach(x=>calendar.append(el('p',x.payload.title),badge('טיוטה · '+x.payload.channel)));calendar.append(go('פתח לוח תוכן','content'));}else calendar.append(empty('אין תוכן מתוכנן עדיין','נשמור את הפוסט הראשון כטיוטה.',go('פתח לוח תוכן','content')));
  if(state.draft?.creatives?.[0]){const c=state.draft.creatives[0];preview.append(el('h3',c.headline),el('p',c.body),badge(state.draft.stale?'נדרשת בדיקה מחדש':'טיוטה'),go('בדיקת הקמפיין','campaign'));}else preview.append(empty('אין תוכן להצגה','הטיוטה תופיע לאחר הכנתה בשיחה.'));
  grid.append(calendar,preview);const outputs=card('אולפן תוצרים','טיוטות שנשמרו לעסק');outputs.append(posts.items.length?table(['תוצר','ערוץ','מצב','פעולות'],posts.items.map(x=>[x.payload.title,x.payload.channel,badge('טיוטה'),button('עריכה',()=>editRecord('content',x))])):empty('עדיין אין תוצרים','אפשר ליצור פוסט או להכין תוכנית קמפיין.'));
  return [heading('סטודיו קריאייטיב',(state.business.businessName||'העסק שלך')+' · '+new Date().toLocaleDateString('he-IL',{month:'long',year:'numeric'}),[go('צור תוכן','content'),button('✧ צור קמפיין',()=>openAgent(true),'primary')]),el('p','לוח התוכן מרכז את הטיוטות שלך. פותחים, בודקים ועורכים לפני כל פרסום.','notice'),stats([['טיוטות תוכן',posts.items.length,'תכנון מקומי'],['פורסמו','—','עוד אין נתוני פרסום'],['מוצרים',products.items.filter(x=>x.payload.active).length,'מוצרים פעילים'],['חיבור Meta',state.connection?.status==='CONNECTED'?'1':'0','לפי הבדיקה האחרונה']]),grid,outputs];
 }
 function editLanding(page){
  const d=dialog(page?'עריכת עמוד מכירה':'עמוד מכירה חדש'),form=el('form'),p=page?.payload||{},creative=state.draft?.creatives?.[0]||{},error=el('p','','form-error');error.setAttribute('role','alert');
  field(form,'שם העסק','businessName',{value:p.businessName||state.business.businessName||'',required:true,maxLength:120});field(form,'כותרת העמוד','title',{value:p.title||creative.headline||'',required:true,maxLength:200});field(form,'תוכן העמוד','body',{value:p.body||creative.body||'',required:true,type:'textarea',maxLength:8000});field(form,'כפתור הפנייה','cta',{value:p.cta||'השאירו פרטים ונחזור אליכם',required:true,maxLength:120});field(form,'המוצר או השירות','product',{value:p.product||state.business.product||'',maxLength:1000});form.append(el('p','שמירה יוצרת טיוטה פרטית. פרסום דורש תצוגה מקדימה ואישור נפרד.','notice'));
  const save=button('שמירת טיוטה',null,'primary');save.type='submit';form.append(error,save);d.append(form);d.showModal();let requestId=crypto.randomUUID(),last=null;
  form.addEventListener('submit',e=>{e.preventDefault();run(save,async()=>{try{const payload=Object.fromEntries(new FormData(form)),serialized=JSON.stringify(payload);if(last&&last!==serialized)requestId=crypto.randomUUID();last=serialized;await api('landing/drafts'+(page?'/'+page.id:''),{payload,revision:page?.revision,requestId},page?'PATCH':'POST');d.close();await navigate('landing');tell('טיוטת עמוד המכירה נשמרה.');}catch(err){error.textContent=err.message;}});});
 }
 function previewLanding(page){
  const d=dialog('תצוגה מקדימה — '+page.payload.title),preview=card(),p=page.payload;preview.append(badge(page.status==='PUBLISHED'?'עמוד פורסם':'טיוטה פרטית'),el('p',p.businessName,'eyebrow'),el('h1',p.title),el('p',p.body),el('strong',p.cta),el('p','לדף יתווסף טופס עם שם, טלפון ואימייל. כל ליד ייכנס לכאן.','muted'));d.append(preview);
  if(page.status==='DRAFT'){const publish=button('אישור ופרסום העמוד',()=>run(publish,async()=>{if(!await UI.confirm('פרסום עמוד המכירה','הדף יעלה לאוויר עם הנוסח הזה וטופס לידים. לפרסם?','אישור פרסום'))return;await api('landing/'+page.id+'/publish',{confirmPublish:true,revision:page.revision,requestId:crypto.randomUUID()});d.close();await navigate('landing');tell('עמוד המכירה פורסם.');}),'primary');d.append(publish,button('עריכת הטיוטה',()=>{d.close();editLanding(page);}));}d.showModal();
 }
 // What I sell (מה אני מוכר): one catalog for every business; fields and labels come from its vertical profile. Mobile-first cards.
 const CATALOG_STATUS={DRAFT:'טיוטה',ACTIVE:'משווק',PAUSED:'בהשהיה',SOLD_OUT:'אזל',ENDED:'הסתיים'};
 function showReply(title,text,extra){const d=dialog(title),p=el('p',text||'','reply-text'),row=el('div','','actions');row.append(...(extra?[extra]:[]),button('סגירה',()=>d.close(),'secondary'));d.append(p,row);d.showModal();}
 function campaignLabel(i){if(i.campaignStatus)return 'קמפיין: '+(({ACTIVE:'פעיל',PAUSED:'מושהה',CAMPAIGN_PAUSED:'מושהה',ARCHIVED:'בארכיון'})[i.campaignStatus]||i.campaignStatus);if(i.campaignId)return 'קמפיין מקושר';if(i.campaignPrepared)return 'טיוטת קמפיין';return 'אין קמפיין';}
 function catalogLabel(){const label=state?.catalog?.label;if(!label)return;const item=groups.ads.items.find(([id])=>id==='catalog');if(item&&item[1]!==label){item[1]=label;titles.catalog=label;}}
 async function catalogScreen(){
  const data=await api('catalog'),v=data.vertical,list=data.items,add=()=>editItem(null,v,data.license);
  if(state){state.catalog=v;catalogLabel();}
  const out=[heading(v.label,`ה${v.itemPlural} שאתה מוכר, הלידים שהם מביאים והפרסום שלהם`,[button('＋ '+v.item+' חדש',add,'primary')])];
  if(!v.known){const c=card('מה העסק מוכר?','כך נשאל רק את הפרטים שחשובים לך');const row=el('div','','catalog-actions');v.choices.forEach(([key,label])=>{const b=button(label,()=>run(b,async()=>{await api('catalog/vertical',{vertical:key});await navigate('catalog');}));row.append(b);});c.append(row);out.push(c);}
  out.push(el('p',`אפשר גם לשלוח לסוכן בוואטסאפ תמונות ותיאור קצר, למשל "${v.example}".`+(v.license?` בכל מודעה ופוסט מופיע ה${v.license.label}.`:'')+(v.consentRequired?' שום נכס לא מפורסם בלי הסכמת בעל הנכס.':'')+' שום דבר לא מתפרסם בלי האישור שלך.','notice'));
  if(!list.length){out.push(empty(`עוד אין ${v.itemPlural}`,`מוסיפים ${v.item} ראשון כאן, או שולחים אותו לסוכן בוואטסאפ.`,button('הוספה',add,'primary')));return out;}
  out.push(stats([['משווקים',list.filter(i=>i.status==='ACTIVE').length,v.itemPlural+' פעילים'],['לידים',list.reduce((a,i)=>a+i.leads,0),'מכל ה'+v.itemPlural],['נסגרו',list.filter(i=>['SOLD_OUT','ENDED'].includes(i.status)).length,'נמכרו, אזלו או הסתיימו']]));
  const grid=el('div','','catalog-grid');list.forEach(i=>grid.append(itemCard(i,v,data.license)));out.push(grid);return out;
 }
 function itemCard(i,v,license){
  const c=el('article','','card catalog-card'),media=el('div','','catalog-photo'),body=el('div','','catalog-body');
  if(i.coverPhotoId){const img=el('img');img.src='/app/api/catalog/'+i.id+'/photos/'+i.coverPhotoId;img.alt='תמונה של '+i.title;img.loading='lazy';media.append(img);}else media.append(el('span','אין תמונה עדיין','muted'));
  const tags=el('div','','catalog-tags');tags.append(badge(i.statusLabel||CATALOG_STATUS[i.status]||i.status,i.status==='DRAFT'?'warning':''),badge(i.leads+' לידים'),badge(campaignLabel(i)));if(i.consentRequired&&!i.consent)tags.append(badge('אין הסכמת בעל הנכס','warning'));if(i.scheduledPosts)tags.append(badge(i.scheduledPosts+' פוסטים מתוכננים'));
  body.append(el('h3',i.title),el('p',[i.priceText,i.dealLabel].filter(Boolean).join(' · ')||'בלי מחיר','catalog-price'),tags);
  if(i.missing?.length){const names={title:'שם',price:'מחיר',license:v.license?.label||'רישיון'};v.fields.forEach(f=>names[f.key]=f.label);body.append(el('p','חסר: '+i.missing.map(m=>names[m]||m).join(', '),'muted'));}
  const actions=el('div','','catalog-actions');actions.append(button('עריכה',()=>editItem(i,v,license)));
  if(i.status==='ACTIVE'){
   const camp=button('קמפיין לידים',()=>run(camp,async()=>{tell('הסוכן מכין טיוטת קמפיין…');const r=await api('catalog/'+i.id+'/campaign',{});showReply('קמפיין לידים',r.reply,r.blocked?null:button('לסוכן',()=>{document.querySelector('dialog[open]')?.close();openAgent(true);},'primary'));}),'primary');
   const posts=button('פוסטים',()=>run(posts,async()=>{tell('הסוכן כותב פוסטים…');const r=await api('catalog/'+i.id+'/posts',{});await navigate('catalog');showReply('פוסטים',r.reply,r.blocked?null:go('ללוח התוכן','content'));}));
   actions.append(camp,posts);
  }
  if(['ACTIVE','PAUSED','DRAFT'].includes(i.status))v.closeOutcomes.slice(0,2).forEach(o=>{if(v.key==='real_estate'&&o.key!==(i.attributes.dealType==='RENT'?'RENTED':'SOLD'))return;const b=button('סמן: '+o.label,()=>run(b,async()=>{if(!await UI.confirm(`${i.title}: ${o.label}?`,'הסוכן יעצור את הפוסטים המתוכננים שלו ויכין עצירה של הקמפיין שלו לאישור שלך.','כן, '+o.label))return;const r=await api('catalog/'+i.id+'/close',{outcome:o.key});await navigate('catalog');showReply('עדכנתי',r.reply,r.pauseActionId?go('לאישור העצירה','approvals'):null);}),'ghost');actions.append(b);});
  body.append(actions);c.append(media,body);return c;
 }
 function shrinkImage(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{const scale=Math.min(1,1600/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.round(img.width*scale);canvas.height=Math.round(img.height*scale);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);URL.revokeObjectURL(url);let q=.85,data=canvas.toDataURL('image/jpeg',q);while(data.length>1900000&&q>.4){q-=.15;data=canvas.toDataURL('image/jpeg',q);}resolve(data.split(',')[1]);};img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('לא הצלחתי לקרוא את התמונה.'));};img.src=url;});}
 function checkbox(form,label,name,checked,help){const wrap=el('label','','catalog-check'),input=document.createElement('input');input.type='checkbox';input.name=name;input.checked=!!checked;const text=el('span',label);if(help)text.append(el('small',' '+help,'muted'));wrap.append(input,text);form.append(wrap);return input;}
 function editItem(i,v,license){
  const d=dialog(i?'עריכה: '+i.title:v.item+' חדש'),form=el('form','','catalog-form'),error=el('p','','form-error'),a=i?.attributes||{},inputs={};error.setAttribute('role','alert');
  if(v.kinds.length>1)field(form,'סוג','kind',{value:i?.kind||v.kinds[0][0],options:v.kinds});
  if(!v.computedTitle)field(form,'שם ה'+v.item,'title',{value:i?.rawTitle||'',required:true,maxLength:160});
  v.fields.filter(f=>f.type==='choice').forEach(f=>{inputs[f.key]=field(form,f.label,'a_'+f.key,{value:a[f.key]??f.choices[0][0],options:f.choices});});
  const price=field(form,'מחיר בשקלים','price',{value:i?.price??'',type:'number',required:true});price.step='1';price.inputMode='numeric';
  v.fields.filter(f=>f.type!=='choice').forEach(f=>{
   if(f.type==='boolean'){inputs[f.key]=checkbox(form,f.label,'a_'+f.key,a[f.key]);return;}
   const input=field(form,f.label+(f.required===true?'':' (לא חובה)'),'a_'+f.key,{value:f.type==='list'?(a[f.key]||[]).join(', '):a[f.key]??'',type:f.type==='number'?'number':f.type==='url'?'url':'text',required:f.required===true,maxLength:f.type==='list'?400:300,help:f.type==='list'?'מופרדים בפסיק':undefined});
   if(f.type==='number'){input.step=String(f.step||1);if(f.min!=null)input.min=String(f.min);if(f.max!=null)input.max=String(f.max);input.inputMode=f.step&&f.step<1?'decimal':'numeric';}
   inputs[f.key]=input;
  });
  field(form,'תיאור','description',{value:i?.description||'',type:'textarea',maxLength:2000});
  let lic=null;if(v.license){lic=field(form,'מספר '+v.license.label,'licenseNumber',{value:a.licenseNumber||license||'',required:true,maxLength:10,help:'חובה בכל מודעה. נשמר גם לבאים.'});lic.inputMode='numeric';lic.pattern='[0-9]{3,10}';}
  const consent=v.consentRequired?checkbox(form,v.consentLabel||'יש הסכמה לפרסום','consent',i?.consent,i?.consentAt?'(נרשם '+new Date(i.consentAt).toLocaleDateString('he-IL')+')':''):null;
  const market=checkbox(form,'לשווק עכשיו','activate',i?i.status==='ACTIVE':true,v.consentRequired?'בלי הסכמה נשמר כטיוטה':'');
  const photosBox=el('div','','catalog-thumbs'),fileLabel=el('label','הוספת תמונות'),files=document.createElement('input');files.type='file';files.accept='image/jpeg,image/png';files.multiple=true;files.name='photos';fileLabel.append(files);
  form.append(el('h3','תמונות'),photosBox,fileLabel);
  if(i?.id)api('catalog/'+i.id+'/photos').then(r=>r.photos.forEach(id=>{const f=el('figure'),img=el('img');img.src='/app/api/catalog/'+i.id+'/photos/'+id;img.alt='תמונה';const del=button('מחיקה',()=>run(del,async()=>{await api('catalog/'+i.id+'/photos/'+id,{},'DELETE');f.remove();}),'ghost');f.append(img,del);photosBox.append(f);})).catch(()=>{});
  const save=button('שמירה',null,'primary');save.type='submit';form.append(error,save);d.append(form);d.showModal();
  form.addEventListener('submit',e=>{e.preventDefault();run(save,async()=>{error.textContent='';
   if(consent&&market.checked&&!consent.checked){error.textContent='כדי לשווק צריך הסכמה של בעל הנכס. אפשר לבטל את הסימון "לשווק עכשיו" ולשמור כטיוטה.';return;}
   const fd=Object.fromEntries(new FormData(form)),num=x=>x===''||x==null?null:Number(x),attributes={};
   v.fields.forEach(f=>{const input=inputs[f.key];if(!input)return;attributes[f.key]=f.type==='boolean'?input.checked:f.type==='number'?num(input.value):f.type==='list'?String(input.value||'').split(',').map(x=>x.trim()).filter(Boolean):(input.value||null);});
   const body={...(fd.kind?{kind:fd.kind}:{}),...(v.computedTitle?{}:{title:fd.title}),price:num(fd.price),description:fd.description,attributes,...(lic?{licenseNumber:lic.value}:{}),...(consent?{consent:consent.checked}:{}),activate:market.checked,...(i?{version:i.version}:{})};
   try{const saved=await api('catalog'+(i?'/'+i.id:''),body,i?'PATCH':'POST');
    let failed=0;for(const file of files.files){try{await api('catalog/'+saved.id+'/photos',{imageBase64:await shrinkImage(file),mimeType:'image/jpeg'});}catch{failed++;}}
    d.close();await navigate('catalog');tell(failed?`נשמר, אבל ${failed} תמונות לא עלו. אפשר לנסות שוב בעריכה.`:'נשמר.',!!failed);
   }catch(err){error.textContent=err.message;}
  });});
 }
 async function landing(){
  const data=await api('landing'),out=[heading('עמודי מכירה','דף עם ההצעה שלכם וטופס, וכל ליד ממנו נכנס לכאן.',[button('＋ צור עמוד מכירה',()=>editLanding(),'primary')])];
  if(!data.pages.length)out.push(empty('עדיין אין עמודי מכירה','צרו עמוד ראשון מהמותג וההצעה שלכם. העמוד נשמר כטיוטה פרטית לפני פרסום.',button('צור עמוד מכירה',()=>editLanding(),'primary')));else out.push(table(['עמוד','מצב','נוצר','פעולות'],data.pages.map(p=>{const actions=el('div','','actions');actions.append(button('תצוגה מקדימה',()=>previewLanding(p)));if(p.status==='DRAFT')actions.append(button('עריכה',()=>editLanding(p)));if(p.url){const a=el('a','פתיחת הדף');a.href=p.url;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}return [p.payload?.title||p.slug.slice(0,12),badge(p.status==='PUBLISHED'?'פורסם':'טיוטה'),new Date(p.created_at).toLocaleDateString('he-IL'),actions];})));
  try{const ch=await api('channels'),auto=ch.pages;out.push(heading('דף העסק ודפי הפריטים','דף ציבורי לעסק ולכל פריט שמשווק, עם טופס לידים',[],2));
   if(!auto.length){const b=button('יצירת דף לעסק',()=>run(b,async()=>{const r=await api('channels/pages/business',{});tell(r.published?'✅ הדף באוויר':'הדף נוצר כטיוטה');navigate('landing');}),'primary');out.push(b);}
   else out.push(table(['דף','מצב','לידים','פעולות'],auto.map(p=>{const actions=el('div','','actions');if(p.url){const a=el('a','פתיחת הדף');a.href=p.url;a.target='_blank';a.rel='noopener noreferrer';actions.append(a);}else{const b=button('פרסום',()=>run(b,async()=>{await api('channels/pages/'+p.id+'/publish',{});navigate('landing');}),'primary');actions.append(b);}return [p.kind==='BUSINESS'?'דף העסק':(p.item_title||'פריט'),badge(p.status==='PUBLISHED'?'פורסם':'טיוטה'),String(p.leads),actions];})));}catch{}
  // SEO articles are not built yet, so no section for them (no "coming soon" placeholders).
  return out;
 }

 async function sales(id){
  const data=await api('leads'),counts=state.crm.counts,total=Object.values(counts).reduce((a,b)=>a+b,0),out=[heading(titles[id],{pipeline:'כל הלידים לפי שלב הטיפול',customers:'לידים שסגרו עסקה',sales:'לידים, עסקאות ומשימות במבט אחד'}[id]||'כל הלידים, מכל המקורות',[...(id==='pipeline'?[]:[go('ללוח העסקאות','pipeline')]),button('＋ ליד חדש',()=>{navigate('leads').then(()=>$('lead-form').querySelector('input')?.focus());},'primary')])];
  if(id==='pipeline'){const p=el('div','','pipeline');for(const [status,label]of Object.entries(statuses)){const col=el('div','','pipeline-column');col.dataset.status=status;col.append(el('h3',label+' · '+(counts[status]||0)));data.leads.filter(l=>l.status===status).forEach(l=>{const c=leadCard(l);c.draggable=true;c.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',l.id);c.classList.add('dragging');});c.addEventListener('dragend',()=>c.classList.remove('dragging'));col.append(c);});col.addEventListener('dragover',e=>{e.preventDefault();col.classList.add('drop-target');});col.addEventListener('dragleave',()=>col.classList.remove('drop-target'));col.addEventListener('drop',async e=>{e.preventDefault();col.classList.remove('drop-target');const lead=data.leads.find(x=>x.id===e.dataTransfer.getData('text/plain'));if(!lead||lead.status===status)return;try{await api('leads/'+lead.id,{status,version:lead.version},'PATCH');await refresh();tell('הליד עבר ל״'+statuses[status]+'״.');}catch(err){tell(err.message,true);}});p.append(col);}return [...out,el('p','גוררים ליד בין העמודות כדי לעדכן את השלב שלו.','muted'),p];}
  if(id==='customers'){const customers=data.leads.filter(l=>l.status==='WON');return [...out,customers.length?table(['שם','טלפון','דוא״ל','הכנסה שדווחה','פעולה'],customers.map(l=>[l.name,l.phone,l.email,amount(l.revenue_minor==null?null:Number(l.revenue_minor),l.currency||'ILS'),go('פתיחת הליד','leads')])):empty('אין לקוחות שנסגרו עדיין','כשתסמנו ליד כנסגר ✅ הוא יופיע כאן.',go('ניהול לידים','leads'))];}
  const tasks=await api('workspace/tasks'),today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'}),todays=data.leads.filter(l=>new Date(l.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'})===today).length,done=counts.WON||0;
  const summary=stats([['סה״כ לידים',total,''],['חדשים היום',todays,'מתוך 100 האחרונים'],['משימות היום',tasks.items.filter(x=>x.payload.date===today&&x.payload.status==='OPEN').length,'מתוך הרשומות שנטענו'],['אחוז סגירה',total?Math.round(done/total*100)+'%':'—',done+' עסקאות שנסגרו'],['עסקאות שנסגרו',done,'דיווח שלך']],true);
  const grid=el('div','','split-grid'),leads=card('לידים אחרונים','החדשים למעלה'),side=el('div'),callout=el('div','','callout');callout.append(el('h2','מה הצעד הבא?'),el('p','מהצעת העסק ועד לעסקה — כל שלב משתמש במידע שכבר שמרתם.','muted'));const steps=el('ol','','journey-steps');[['brand','1. מחדדים את ההצעה'],['campaign','2. מתכננים קמפיין'],['pipeline','3. מטפלים בלידים'],['customers','4. בודקים עסקאות שנסגרו']].forEach(([id,label])=>{const step=el('li');step.append(go(label,id));steps.append(step);});callout.append(steps);side.append(callout);const integrations=card('לידים מוואטסאפ');integrations.append(el('p','ליד שכותב לך בוואטסאפ נכנס לכאן, ומכל ליד אפשר לפתוח הודעה מוכנה בוואטסאפ שלך.','muted'),go('לחיבורים ומקורות לידים','integrations'));side.append(integrations);
  if(!data.leads.length)leads.append(empty('עוד אין לידים','עוד אין לידים. כשקמפיין יתחיל לרוץ, הם יופיעו כאן. אפשר גם להוסיף ליד ידנית.'));else data.leads.slice(0,4).forEach(l=>leads.append(leadCard(l)));grid.append(leads,side);const taskCard=card('משימות');if(tasks.items.length)tasks.items.slice(0,4).forEach(x=>taskCard.append(el('p',(x.payload.status==='DONE'?'✓ ':'○ ')+x.payload.title)));else taskCard.append(empty('אין משימות עדיין','אפשר לשמור את פעולת ההמשך הראשונה.',go('ניהול משימות','tasks')));return [...out,summary,grid,taskCard];
 }
 function leadCard(lead){const c=card(lead.name);c.append(el('p',[lead.phone,lead.email].filter(Boolean).join(' · '),'muted'));const s=el('select');s.setAttribute('aria-label','מצב הטיפול ב־'+lead.name);Object.entries(statuses).forEach(([v,l])=>{const o=el('option',l);o.value=v;o.selected=lead.status===v;s.append(o);});s.addEventListener('change',()=>run(s,async()=>{try{await api('leads/'+lead.id,{status:s.value,version:lead.version},'PATCH');await refresh();tell('השלב עודכן.');}catch(e){s.value=lead.status;throw e;}}));c.append(s);const ready=readyMessageLink(lead);if(ready)c.append(ready);return c;}
 // Speed to lead: the drafted first message opens in the owner's own WhatsApp (SCORPIO never sends it).
 function readyMessageLink(lead){const n=typeof waNumber==='function'?waNumber(lead.phone):null;if(!n||!['NEW','CONTACTED'].includes(lead.status))return null;const first=String(lead.name||'').trim().split(/\s+/)[0],text=lead.ready_message||(first&&lead.name!=='ליד מ־Meta'?'היי '+first:'היי')+'. ראינו שהשארת פרטים, תודה! מתי נוח לך לדבר כמה דקות?',a=el('a','✉️ שלח הודעה מוכנה','button secondary');a.href='https://wa.me/'+n+'?text='+encodeURIComponent(text);a.target='_blank';a.rel='noopener noreferrer';return a;}
 async function leadSources(){
  const data=await api('meta/lead-source');
  if(!data.enabled)return null;
  const panel=card('טופסי לידים של Meta','בוחרים דף וטופס, וכל ליד חדש ייכנס לכאן אוטומטית.');
  for(const source of data.sources){
   const status=!source.current_connection?'נדרש חיבור מחדש':source.failed?'יש אירועים שנכשלו':'הטופס משויך';
   panel.append(el('p',source.form_id+' · '+status));
  }
  const load=button('בחירת דף וטופס',()=>run(load,async()=>{
   const {pages}=await api('meta/lead-source/pages');
   const d=dialog('חיבור טופס לידים');
   const list=el('div');
   d.append(list);
   if(!pages.length)list.append(el('p','לא נמצאו דפים זמינים בחיבור Meta.'));
   for(const page of pages){
    const choose=button(page.name||page.id,()=>run(choose,async()=>{
     const {forms}=await api('meta/lead-source?pageId='+encodeURIComponent(page.id));
     list.replaceChildren(el('p',page.name||page.id));
     if(!forms.length)list.append(el('p','לא נמצאו טפסים בדף הזה.'));
     for(const form of forms){
      const save=button(form.name||form.id,()=>run(save,async()=>{
       await api('meta/lead-source',{pageId:page.id,formId:form.id});
       d.close();
       await navigate('integrations');
       tell('הטופס שויך. יש לבדוק קליטת ליד מ־Meta.');
      }));
      list.append(save);
     }
    }));
    list.append(choose);
   }
   d.showModal();
  }));
  panel.append(load);
  return panel;
 }
 async function integrations(){
  const grid=el('div','','grid'),meta=card('Meta Business','קריאת חשבונות ונתוני פרסום לפי ההרשאות שתאשרו');meta.append(badge(state.connection?.status==='CONNECTED'?'חיבור נבדק בעבר':'נדרש חיבור'),el('p','החיבור לא מפעיל שום קמפיין. Meta תראה לך בדיוק מה מאשרים.'),button('בדיקת חיבור Meta',()=>{showCampaignTools=true;navigate('campaign').then(()=>$('meta-connect').click());},'primary'));
  const other=card('Google, WhatsApp ומודלי AI');other.append(el('h3','WhatsApp'),el('p','שיחת העסק משתמשת בחיבור הקיים. הגדרת מספרים והרשאות ספק אינה זמינה כאן.'),el('h3','Google'),el('p','Google Ads ויומן Google יגיעו בקרוב.'),el('h3','מנועי AI'),el('p','ספקי ה־AI נשמרים לפי הגדרות השרת הקיימות.'));grid.append(meta,other);
  const leadPanel=await leadSources();
  if(leadPanel)grid.append(leadPanel);
  grid.append(await channelsCard());
  const connections=await api('integrations');
  connections.social.forEach(provider=>{const c=card(provider.name,'חיבור לרשתות החברתיות');c.append(badge(provider.connected?'מחובר':provider.selectionRequired?'נדרשת בחירת חשבון':provider.configured?'מוכן לחיבור':'לא הוגדר בשרת'));if(provider.displayName)c.append(el('p',provider.displayName));
   if(provider.configured)c.append(el('p',({facebook:'הספק יבקש גישה לדפים ולפרסום פוסטים.',instagram:'הספק יבקש גישה לדפים ולחשבון Instagram לצורך פרסום תוכן.',linkedin:'הספק יבקש פרטי פרופיל והרשאה לפרסום תוכן.',tiktok:'הספק יבקש פרטי חשבון והרשאה לפרסום וידאו.',youtube:'הספק יבקש גישה לערוץ ולהעלאת סרטונים.',x:'הספק יבקש פרטי חשבון וגישה לקריאה ולפרסום תוכן.'})[provider.id],'muted'));if(!provider.configured)c.append(el('p','החיבור הזה יגיע בקרוב.','muted'));
   else if(provider.selectionRequired){c.append(el('p','באיזה חשבון נשתמש?'));provider.accounts.forEach(a=>{const b=button(a.name,()=>run(b,async()=>{await api('social/'+provider.id+'/account',{accountId:a.id});await navigate('integrations');}));c.append(b);});}
   else if(!provider.connected){const b=button('חיבור '+provider.name,()=>run(b,async()=>{if(!await UI.confirm('חיבור '+provider.name,'החיבור יבקש הרשאות לתוכן ולחשבון דרך הספק הרשמי. פרטי ההרשאות יוצגו אצל הספק. פוסטים יפורסמו אוטומטית רק אם הסכם העבודה מאפשר לסוכן לפרסם לבד.','המשך לחיבור'))return;const r=await api('social/'+provider.id+'/connect',{});location.assign(r.url);}), 'primary');c.append(b);}
   if(provider.hasAuthorization){const b=button('ניתוק החיבור',()=>run(b,async()=>{if(!await UI.confirm('ניתוק '+provider.name,'הטוקן המקומי והבחירה בחשבון יוסרו. הרשאות אצל הספק ניתנות להסרה גם בהגדרות הספק.','אישור ניתוק'))return;await api('social/'+provider.id+'/disconnect',{confirm:true});await navigate('integrations');}),'secondary');c.append(b);}grid.append(c);
  });
  return [heading('חיבורים ופרסום','החשבונות שמחוברים לעסק'),grid];
 }
 // Channels: automatic publishing status, Meta Pixel, lead webhook and the business page.
 async function channelsCard(){
  const c=card('פרסום ולידים מכל מקום','פרסום אוטומטי, פיקסל ומקורות לידים');
  let d;try{d=await api('channels');}catch{c.append(el('p','לא הצלחנו לטעון את המצב.','muted'));return c;}
  const a=d.autopublish,LBL={facebook:'פייסבוק',instagram:'אינסטגרם'},WHY={NO_AGREEMENT:'אין הסכם עבודה',PAUSED:'הפעולות האוטומטיות עצורות',NOT_ALLOWED:'הסכם העבודה לא מאפשר לפרסם לבד'};
  c.append(el('h3','פרסום אוטומטי של פוסטים'));
  if(!a.enabled)c.append(el('p','עוד לא פעיל בשרת. בינתיים כל פוסט מגיע אליך לוואטסאפ, מוכן לפרסום.','muted'));
  else{c.append(el('p',a.agreementAllows?'הסכם העבודה מאפשר לסוכן לפרסם לבד ✓':'הסוכן לא מפרסם לבד: '+(WHY[a.agreementWhy]||'צריך אישור בהסכם העבודה')+'.'));
   for(const [n,v] of Object.entries(a.networks))c.append(el('p',LBL[n]+': '+(v.connected?(v.missing?.length?'חסרות הרשאות: '+v.missing.join(', '):'מחובר'+(v.account?' ('+v.account+')':'')):'לא מחובר')));
   const check=button('בדיקת הרשאות',()=>run(check,async()=>{const r=await api('channels/autopublish/check',{});const lines=Object.entries(r.networks).map(([n,v])=>LBL[n]+': '+(!v.connected?'לא מחובר':v.missing?.length?'חסר: '+v.missing.join(', '):v.reason?'לא נבדק כרגע':'מוכן לפרסום ✓'));tell(lines.join(' · '));}),'secondary');c.append(check);}
  c.append(el('h3','Meta Pixel בדפי העסק'));
  const form=el('form','','inline-form'),input=el('input');input.id='pixel-id';input.inputMode='numeric';input.maxLength=20;input.value=d.pixelId||'';input.setAttribute('dir','ltr');const label=el('label','מזהה פיקסל (מספר מתוך מנהל האירועים)');label.htmlFor='pixel-id';
  const save=button('שמירה','', 'primary');save.type='submit';form.append(label,input,save);form.addEventListener('submit',e=>{e.preventDefault();run(save,async()=>{await api('channels/pixel',{pixelId:input.value.trim()||null});tell(input.value.trim()?'✅ הפיקסל נשמר. הוא נטען בדפים רק אחרי שהמבקר מאשר מדידה.':'הפיקסל הוסר.');});});c.append(form);
  c.append(el('p',d.conversionsApi.metaConnected?'לידים מהדפים ועסקאות שנסגרו נשלחים גם ל־Meta מהשרת (Conversions API), רק כשהמבקר אישר מדידה.':'כדי שלידים ועסקאות יישלחו גם מהשרת (Conversions API) צריך חיבור Meta פעיל.','muted'));
  c.append(el('h3','קישור לקבלת לידים מהאתר או מ־Zapier'));
  if(d.webhook)c.append(el('p',d.webhook.url,'mono'));
  const rot=button(d.webhook?'יצירת מפתח חדש':'יצירת קישור',()=>run(rot,async()=>{if(d.webhook&&!await UI.confirm('מפתח חדש','המפתח הקודם יפסיק לעבוד מיד. צריך לעדכן אותו באתר או ב־Zapier.','יצירת מפתח'))return;const r=await api('channels/webhook',{});const box=dialog('קישור הלידים שלך');box.append(el('p','שולחים POST עם name, phone, email (וגם utm_campaign, utm_content או item אם יש).'),el('p','כתובת: '+r.url,'mono'),el('p','מפתח (מופיע רק עכשיו, שמרו אותו): '+r.secret,'mono'),el('p','את המפתח שולחים בכותרת Authorization: Bearer <המפתח>.','muted'));box.showModal();}),'secondary');c.append(rot);
  c.append(el('h3','לידים מהודעות באינסטגרם ומסנג׳ר'),el('p',d.dmLeads.enabled?'פעיל.':'מוכן אבל עוד לא פעיל: צריך אישור של Meta להרשאות הודעות.','muted'));
  return c;
 }
 async function finance(id){
  const [products,expenses]=await Promise.all([api('workspace/products'),api('workspace/expenses')]),out=[heading(titles[id],id==='profitability'?'תרומה ישירה לפי מחירים ועלויות שהוזנו':'הכנסות והוצאות שדווחו במערכת; אין כאן חיבור בנקאי',[button('רישום הוצאה',()=>editRecord('expenses'),'primary')])];
  if(id==='profitability')return [...out,el('p','רווח ליחידה = מחיר המכירה פחות העלות של המוצר עצמו.','notice'),products.items.length?table(['מוצר','מחיר','עלות ישירה','רווח ליחידה','פעולות'],products.items.map(x=>{const p=x.payload;return [p.name,amount(p.priceMinor,p.currency),amount(p.costMinor,p.currency),amount(p.priceMinor!=null&&p.costMinor!=null?p.priceMinor-p.costMinor:null,p.currency),button('עריכה',()=>editRecord('products',x))];})):empty('אין מוצרים לחישוב','הוסיפו מוצר עם מחיר ועלות ישירה.',go('הוספת מוצר','products'))];
  out.push(profitCard(expenses.items));
  const totals={};for(const x of expenses.items){const p=x.payload;totals[p.currency]=(totals[p.currency]||0)+p.amountMinor;}const c=card('נתונים לפי מטבע','כל ההכנסות וההוצאות שנרשמו, לפי מטבע.');if(Object.keys(totals).length||state.crm.revenue.length)c.append(table(['מטבע','הכנסות','הוצאות שנטענו'],[...new Set([...state.crm.revenue.map(x=>x.currency),...Object.keys(totals)])].map(currency=>[currency,amount(Number(state.crm.revenue.find(x=>x.currency===currency)?.amount||0),currency),amount(totals[currency]||0,currency)])));if(!Object.keys(totals).length&&!state.crm.revenue.length)c.append(empty('מתחילים מרישום ההוצאה הראשונה','רושמים הוצאה למעלה. הכנסות יופיעו כאן כשתסמנו ליד כנסגר.'));return [...out,el('p','המידע הוזן בידי העסק ולא אומת מול בנק או מערכת חשבונאית. מטבעות מוצגים בנפרד.','notice'),c];
 }
 // Profit after marketing for the last 30 days (ILS): sales revenue minus ad spend minus recorded expenses.
 function profitCard(expenseItems){
  const c=card('רווח אחרי פרסום · 30 ימים','הכנסות, פחות הסכום שהוצא על פרסום, פחות הוצאות'),body=el('div');body.append(el('p','מחשב…','muted'));c.append(body);
  const since=new Date(Date.now()-30*864e5).toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'}),expenses=expenseItems.filter(x=>x.payload.currency==='ILS'&&(x.payload.date||x.created_at?.slice(0,10)||'')>=since).reduce((t,x)=>t+x.payload.amountMinor,0)/100;
  api('business-report?period=last_30d').then(r=>{const revenue=r.funnel.revenue,spend=r.spend||0,profit=revenue-spend-expenses;body.replaceChildren(stats([['הכנסות',shekel(revenue),r.funnel.won+' מכירות'],['סכום שהוצא',shekel(spend),r.spend===null?'Meta לא מחובר':''],['הוצאות',shekel(expenses),''],['נשאר לך',shekel(profit),profit>=0?'אחרי הפרסום וההוצאות 💰':'בתקופה הזו יצא יותר ממה שנכנס']]));
   body.append(el('p',revenue===0?'כדי לראות רווח, סמנו לידים שקנו ✅ עם הסכום.':'לפני עלות המוצר עצמו ומסים.','muted'));
  }).catch(()=>body.replaceChildren(el('p','לא הצלחנו לחשב כרגע.','muted')));return c;
 }
 async function research(){
  const out=[heading('תכנון ומחקר שיווקי','מי הלקוחות, מה חשוב להם ומה כדאי לבדוק לפני הפרסום'),tabs([['personas','קהל היעד שלי'],['market','מחקר שוק'],['ads','מאגר מודעות'],['organic','לידים מתוכן אורגני']],researchTab,id=>{researchTab=id;navigate('research');})];
  if(researchTab==='personas'){
   const data=await api('workspace/personas'),top=el('div','','toolbar');top.append(el('h2','פרופילי הלקוחות שלכם'),button('＋ פרופיל לקוח חדש',()=>editRecord('personas'),'primary'));out.push(top,el('p','פרופיל לקוח מתאר מי הלקוח, מה מציק לו ומה גורם לו לבחור בעסק. הפרופילים נשמרים לעסק ומשמשים הקשר לסוכן.','notice'));
   if(!data.items.length)out.push(empty('עדיין אין פרופילי לקוחות','אפשר להוסיף פרופיל ראשון מתוך מה שכבר ידוע על קהל היעד.',button('פרופיל לקוח חדש',()=>editRecord('personas'),'primary')));
   const grid=el('div','','grid');data.items.forEach(item=>{const c=card(item.payload.name);for(const [key,label]of Object.entries({audience:'קהל היעד',pains:'נקודות כאב',desires:'רצונות',channels:'ערוצים',notes:'הערות'}))fieldValue(c,label,item.payload[key]);c.append(button('עריכת הפרופיל',()=>editRecord('personas',item)));grid.append(c);});out.push(grid);
  }else if(researchTab==='market'||researchTab==='ads'){
   const data=await api('workspace/research'),top=el('div','','toolbar');top.append(el('h2',researchTab==='ads'?'מקורות ומודעות למחקר':'מחקר שוק'),button('＋ מחקר חדש',()=>editRecord('research'),'primary'));out.push(top);
   if(researchTab==='ads')out.push(el('p','שומרים כאן מודעות של מתחרים ומה למדתם מהן.','notice'));
   if(!data.items.length)out.push(empty('אין מחקרים שמורים','הגדירו שאלה עסקית, תעדו מקור וממצאים ועדכנו את מצב הבדיקה.',button('מחקר חדש',()=>editRecord('research'),'primary')));
   data.items.forEach(item=>{const p=item.payload,c=card(p.title);c.append(badge(({PLANNED:'מתוכנן',IN_PROGRESS:'בבדיקה',COMPLETE:'הושלם'})[p.status]),el('p',p.question),el('p',p.findings||'עדיין אין ממצאים','muted'));if(p.sourceUrl)c.append(el('p','מקור: '+p.sourceUrl,'muted'));c.append(button('עריכת המחקר',()=>editRecord('research',item)));out.push(c);});
  }else{const data=await api('leads'),leads=data.leads.filter(l=>/organic|אורגני|social/i.test(l.source));out.push(leads.length?table(['שם','מקור','מצב','פעולות'],leads.map(l=>[l.name,l.source,statuses[l.status],go('פתיחת הליד','leads')])):empty('עוד אין לידים מפוסטים','לידים שהגיעו מפוסטים, בלי תשלום, יופיעו כאן.',go('פתיחת הלידים','leads')));}
  return out;
 }

 const helpTopics=[['התחלה מהירה','פתיחת חשבון וכניסה מהקישור האישי','account','כתבו לסוכן בוואטסאפ ״דשבורד״ ותקבלו קישור כניסה אישי.'],['זהות המותג','שם, תחום, לוגו וצבעים','brand','במסך זהות מותג אפשר לערוך את שם העסק והתחום, להוסיף קישור HTTPS ללוגו ולבחור צבעים. שמרו את הטופס. עדכון פרטים מסמן את טיוטת הקמפיין לבדיקה מחדש.'],['תוכן אורגני','יצירת טיוטות ותכנון בלוח','content','לוחצים על ״צור פוסט״, כותבים ושומרים. הפוסט נשמר כטיוטה.'],['קמפיינים ממומנים','תוכנית, תצוגה מקדימה ואישורים','campaign','כתבו לסוכן מה אתם רוצים לקדם, והוא יכין קמפיין. שום דבר לא עולה לאוויר ולא מחייב אותך בלי האישור שלך.'],['לידים ומכירות','לידים, לקוחות ועסקאות','leads','מוסיפים ליד עם שם וטלפון או אימייל. כל שינוי שלב מופיע גם בלוח העסקאות, וליד שנסגר עובר ללקוחות.'],['פיננסים','מוצרים, עלויות והוצאות','finance','רושמים הוצאות ומחירים, ואני מחשב כמה נשאר לך.'],['חיבורים ואינטגרציות','חיבור Meta והיכולות הקיימות','integrations','מחברים את חשבון הפרסום ב־Meta בכמה לחיצות.'],['חשבון וחיוב','מסלול, מחיר, ביטול והחזר','billing','מחיר חודשי קבוע ו־14 ימי ניסיון חינם. ביטול בלחיצה אחת במסך מנוי וחיוב או בוואטסאפ ״בטל מנוי״. החזר מלא בחודש התשלום הראשון. תקציב הפרסום משולם ישירות ל־Meta. פרטי כרטיס לא נשמרים אצלנו.']];
 function help(){const hero=el('div','','help-hero');hero.append(el('span','✧','agent-symbol'),badge('מרכז העזרה של SCORPIO AI'),el('h1','איך אפשר לעזור לכם היום?'),el('p','מדריכים קצרים ותשובות שיעזרו להתקדם עם העסק.','muted'));const search=el('input');search.type='search';search.placeholder='חפשו מדריך: זהות מותג, לידים, חיבורים…';search.setAttribute('aria-label','חיפוש במרכז העזרה');hero.append(search);const chips=el('div','','quick-chips');helpTopics.slice(0,4).forEach(x=>chips.append(go(x[0],x[2])));hero.append(chips);const grid=el('div','','help-grid');const draw=()=>{grid.replaceChildren();const found=helpTopics.filter(x=>x.join(' ').includes(search.value));found.forEach(([title,sub,id,body])=>{const c=card();c.append(button(title,()=>{const d=dialog(title);d.append(el('p',body),button('פתיחת המסך',()=>{d.close();navigate(id);},'primary'));d.showModal();},'ghost'),el('p',sub,'muted'),el('small','מדריך קצר'));grid.append(c);});if(!found.length)grid.append(empty('לא נמצא מדריך','נסו מילת חיפוש אחרת.'));};search.addEventListener('input',draw);draw();return [hero,heading('לפי נושא','כל אזור במערכת עם המדריך שלו',[button('הפעל מדריך אינטראקטיבי',startTour,'secondary')]),grid];}
 // Business facts in Hebrew (same labels as conversationFacts.FIELDS); unknown keys are not shown raw.
 const BUSINESS_LABELS={businessName:'שם העסק',businessType:'תחום',businessGoal:'מטרה',product:'מוצר',audience:'קהל',geography:'אזור הפרסום',serviceArea:'אזור השירות',advantage:'היתרון',dailyBudget:'תקציב מדיה יומי',leadDestination:'דרך קבלת הפניות',offer:'ההצעה',materials:'חומרים קיימים',website:'אתר',idealCustomer:'לקוחות רצויים',proof:'המלצות ועבודות',capacity:'זמינות ללקוחות חדשים',leadOwner:'מי מטפל בפניות',pastMarketing:'ניסיון בפרסום',successCriteria:'מה ייחשב הצלחה',brandTone:'סגנון התוכן',genderPreference:'לשון פנייה'};
 // Sign-in with Google (settings → account). Shown only when the server has it configured.
 function googleSignIn(){const box=el('div','','google-signin');box.setAttribute('aria-live','polite');
  api('google-login').then(g=>{if(!g.enabled)return;box.append(el('h3','כניסה עם Google'));
   if(g.accounts.length){g.accounts.forEach(a=>box.append(el('p','מחובר: '+a.email,'muted')));const off=button('ניתוק הכניסה עם Google',()=>run(off,async()=>{if(!await UI.confirm('ניתוק Google','אחרי הניתוק תיכנסו רק מהקישור בוואטסאפ או עם מספר הטלפון והקוד. לנתק?','ניתוק'))return;await api('google-login/unlink',{confirm:true});tell('הכניסה עם Google נותקה.');navigate('account');}),'secondary');box.append(off);}
   else{box.append(el('p','חברו את חשבון ה־Google שלכם, ומהפעם הבאה תיכנסו בלחיצה אחת.','muted'));const a=el('a','חיבור חשבון Google','button secondary');a.href='/app/auth/google/start?mode=link';box.append(a);}
  }).catch(()=>{});return box;}
 function settings(){const grid=el('div','','settings-grid'),menu=card(),body=card();[['display','תצוגה ושפה'],['business','פרטי העסק'],['billing','מנוי וחיוב'],['account','חשבון']].forEach(([id,l])=>{const b=button(l,()=>{if(id==='billing')navigate('billing');else{settingsTab=id;navigate('account');}},settingsTab===id?'primary':'secondary');menu.append(b);});
  if(settingsTab==='display'){body.append(el('h2','תצוגה ושפה'));const row=el('div','','setting-row');row.append(el('strong','מצב תצוגה'),button(document.documentElement.dataset.theme==='dark'?'◐ כהה — מעבר לבהיר':'☼ בהיר — מעבר לכהה',themeToggle));body.append(row);const lang=el('div','','setting-row');lang.append(el('div','שפת ממשק'),badge('עברית · RTL'));body.append(lang,el('p','בחירת הצבעים נשמרת במכשיר הזה.','muted'));}
  else if(settingsTab==='business'){body.append(el('h2','פרטי העסק'));Object.entries(state.business).forEach(([k,v])=>{const label=BUSINESS_LABELS[k];if(label)fieldValue(body,label,typeof v==='object'&&v?.amount!==undefined?'₪'+v.amount+' ליום':typeof v==='boolean'?(v?'כן':'לא'):v);});body.append(go('עריכת המותג','brand'));}
  else{body.append(el('h2','החשבון שלי'),el('p',state.account?.display_name||'החשבון טרם נשמר'),el('p',state.account?.email||'לא נמסר דוא״ל'),go('הרשמה, מסלול וחיוב','billing'));body.append(googleSignIn());const out=button('יציאה מהחשבון',()=>$('logout').click(),'secondary');out.id='account-logout';body.append(out);const links=el('p');const p=el('a','מדיניות פרטיות');p.href='/privacy';const d=el('a','ניהול ומחיקת מידע');d.href='/data-deletion';links.append(p,el('span',' · '),d);body.append(links);}grid.append(menu,body);return [heading('הגדרות','ניהול פרטי העסק והחשבון'),grid];}
 const authorityLabels={CREATE_LEAD_FORM:'יצירת טופס לידים',PAUSE_CAMPAIGN:'השהיית קמפיין',EDIT_CAMPAIGN:'עדכון שם קמפיין',CREATE_CAMPAIGN:'יצירת קמפיין מושהה',CREATE_BUNDLE:'יצירת חבילת קמפיין מושהה',CREATE_ADSET:'יצירת קבוצת מודעות מושהית',CREATE_AD:'יצירת מודעה מושהית',CREATE_CREATIVE:'יצירת קריאייטיב',UPLOAD_IMAGE:'העלאת תמונה'};
 function authoritySummary(m){const p=m.policy;return [p.label,'חשבון Meta: '+p.accountId,'פעולות: '+p.intents.map(i=>authorityLabels[i]||i).join(', '),'עד '+p.maxActions+' פעולות, בתוקף עד '+new Date(p.expiresAt).toLocaleString('he-IL'),'קמפיינים: '+(p.campaignIds.length?p.campaignIds.join(', '):'כל הקמפיינים בחשבון הנבחר'),'עמודים: '+(p.pageIds.length?p.pageIds.join(', '):'עמודים שיש לחשבון הרשאה לנהל'),'הסוכן לא יפעיל פרסום, לא ישנה תקציב ולא יחייב בלי אישור שלך.'].join('\n');}
 async function users(){
  const c=card('גישה לחשבון');c.append(table(['משתמש','גישה','מצב'],[[state.account?.display_name||'החשבון המחובר','בעל/ת החשבון',badge('מחובר')]]),el('p','נכנסים דרך קישור אישי מהוואטסאפ או עם מספר הטלפון וקוד. אנשי צוות שמקבלים לידים מוסיפים במסך צוות.','notice'),go('למסך צוות','team'));
  const out=[heading('משתמשים והרשאות','מי נכנס לחשבון'),c],data=await api('authority');
  if(!data.enabled&&!data.mandates.length)return out;
  const permissions=card('מה הסוכן רשאי לעשות לבד','פעולות שגרתיות בתוך היקף מוגדר, עם אפשרות ביטול');
  if(!data.enabled)permissions.append(el('p','כרגע הסוכן לא מבצע פעולות לבד. אפשר לבטל הרשאות.','notice'));
  permissions.append(el('p','המסגרות כאן אינן מאשרות הפעלת פרסום או שינוי תקציב. אישור תוכן נשאר נפרד.','notice'));
  for(const m of data.mandates){
   const row=card(m.policy.label);row.append(el('p',authoritySummary(m),'authority-summary'),badge(m.status==='REVOKED'?'בוטלה':m.expired?'פג תוקף':m.status==='ACTIVE'?'פעילה':'ממתינה לאישור'),el('p',m.status==='ACTIVE'&&!m.expired&&data.enabled?'נותרו '+m.remainingActions+' פעולות במסגרת.':'כרגע אין פעולות שהסוכן רשאי לבצע לבד.'));
   if(m.status==='DRAFT'&&!m.expired&&data.enabled){const approve=button('בדיקה ואישור המסגרת',()=>run(approve,async()=>{if(!await UI.confirm('אישור מסגרת הרשאה מוגבלת',authoritySummary(m),'מאשר את המסגרת המדויקת'))return;await api('authority/'+m.id+'/approve',{revision:m.revision,confirmHash:m.hash,confirmation:'APPROVE_SCOPED_AUTHORITY'});await navigate('users');}),'primary');row.append(approve);}
   if(m.status!=='REVOKED'){const revoke=button('ביטול המסגרת',()=>run(revoke,async()=>{if(!await UI.confirm('ביטול הרשאה','פעולות שעוד לא התחילו ייעצרו. מה שכבר בוצע נשאר.','בטל את המסגרת'))return;await api('authority/'+m.id+'/revoke',{revision:m.revision});await navigate('users');}),'secondary');row.append(revoke);}permissions.append(row);
  }
  if(data.enabled){
   const form=el('form'),error=el('p','','form-error');let proposalInput=null;form.addEventListener('input',()=>{proposalInput=null;});error.setAttribute('role','alert');
   field(form,'שם המסגרת','label',{required:true,maxLength:120});
   field(form,'סוג פעולה','intent',{options:['CREATE_LEAD_FORM','PAUSE_CAMPAIGN','EDIT_CAMPAIGN','CREATE_CAMPAIGN'].map(i=>[i,authorityLabels[i]])});
   const count=field(form,'מספר פעולות מרבי','maxActions',{type:'number',value:5,required:true});count.step='1';count.min='1';count.max='1000';
   const days=field(form,'תוקף בימים','days',{type:'number',value:7,required:true});days.step='1';days.min='1';days.max='30';
   field(form,'מטבע חשבון הפרסום','currency',{options:[['ILS','שקל'],['USD','דולר'],['EUR','אירו'],['GBP','ליש״ט']]});
   form.append(el('p','ההצעה תחול על חשבון Meta הנבחר. לפני הפעלתה יוצגו החשבון, הפעולות והתוקף לאישור נפרד.','muted'));
   const save=button('הכנת מסגרת לבדיקה',null,'primary');save.type='submit';form.append(error,save);permissions.append(form);
   form.addEventListener('submit',e=>{e.preventDefault();run(save,async()=>{try{const f=Object.fromEntries(new FormData(form));proposalInput||={requestId:crypto.randomUUID(),label:f.label,intents:[f.intent],currency:f.currency,maxActions:Number(f.maxActions),expiresAt:new Date(Date.now()+Number(f.days)*86400000).toISOString()};await api('authority/proposals',proposalInput);dirtyForms.delete(form);await navigate('users');}catch(err){error.textContent=err.message;}});});
  }
  out.push(permissions);return out;
 }

 // Lead timeline and a follow-up reminder that lands in today's tasks.
 function exportLink(){const a=el('a','⬇ ייצוא לאקסל','button secondary');a.href='/app/api/leads/export.csv';a.download='leads.csv';return a;}
 function leadDetailsButton(lead){return button('היסטוריה ותזכורת',async()=>{const d=dialog('הליד '+lead.name),list=el('ol','','lead-timeline');d.append(el('p',[lead.phone,lead.email].filter(Boolean).join(' · '),'muted'),el('h3','מה קרה עד עכשיו'),list);d.showModal();
  const KIND={CREATED:'הליד נכנס',STATUS:'שלב עודכן',NOTE:'הערה',REVENUE:'סכום עסקה',REMINDER:'נקבעה תזכורת'};
  try{const {events}=await api('leads/'+lead.id+'/timeline');if(!events.length)list.append(el('li','הליד נוסף לפני שהתחלנו לשמור היסטוריה. מעכשיו כל שינוי יופיע כאן.','muted'));events.forEach(e=>{const li=el('li');li.append(el('strong',KIND[e.kind]||e.kind),el('span',' · '+(e.kind==='STATUS'?statuses[e.detail]||e.detail:e.kind==='CREATED'?leadSourceLabel(e.detail):e.detail)),el('small',' '+new Date(e.at).toLocaleString('he-IL',{timeZone:'Asia/Jerusalem',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit'})));list.append(li);});}catch(e){list.append(el('li',e.message,'error'));}
  const form=el('form','','reminder-form'),input=el('input');input.type='date';input.required=true;input.min=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'});input.value=new Date(Date.now()+864e5).toLocaleDateString('en-CA',{timeZone:'Asia/Jerusalem'});input.setAttribute('aria-label','תאריך לחזרה');const save=button('קביעת תזכורת לחזור',null,'primary');save.type='submit';form.append(el('h3','תזכורת לחזור אליו'),input,save);d.append(form);
  const requestId=crypto.randomUUID();form.addEventListener('submit',e=>{e.preventDefault();run(save,async()=>{await api('leads/'+lead.id+'/reminder',{date:input.value,requestId});tell('התזכורת נשמרה ותופיע ב״מה לעשות היום״ בתאריך הזה.');d.close();});});
 },'secondary');}
 function leadRevenueButton(lead){return button('הערות והכנסה',()=>{const d=dialog('עדכון הליד — '+lead.name),form=el('form'),error=el('p','','form-error');error.setAttribute('role','alert');field(form,'הערה','note',{type:'textarea',value:lead.note,maxLength:2000});field(form,'הכנסה מהעסקה','revenueMinor',{type:'number',value:major(lead.revenue_minor==null?null:Number(lead.revenue_minor)),help:'נספר כהכנסה כשהליד מסומן כנסגר.'});field(form,'מטבע','currency',{value:lead.currency||'ILS',options:[['ILS','₪ ILS'],['USD','USD'],['EUR','EUR']]});const save=button('שמירת הליד',null,'primary');save.type='submit';form.append(error,save);d.append(form);d.showModal();form.addEventListener('submit',e=>{e.preventDefault();run(save,async()=>{try{const f=Object.fromEntries(new FormData(form)),revenueMinor=parseMinor(f.revenueMinor);await api('leads/'+lead.id,{status:lead.status,version:lead.version,note:f.note,...(revenueMinor!==null?{revenueMinor,currency:f.currency}:{})},'PATCH');d.close();await refresh();await loadLeads();tell('פרטי הליד נשמרו.');}catch(err){error.textContent=err.message;}});});},'secondary');}
 function openCommands(initialQuery=''){const d=dialog('חיפוש מסך או פעולה'),search=el('input');search.type='search';search.placeholder='שם המסך…';search.value=typeof initialQuery==='string'?initialQuery:'';search.setAttribute('aria-label','חיפוש מסך');const results=el('div','','quick-chips');const draw=()=>{results.replaceChildren();Object.entries(titles).filter(([,title])=>title.includes(search.value)).forEach(([id,title])=>results.append(button(title,()=>{d.close();navigate(id);})));};search.addEventListener('input',draw);d.append(search,results);draw();d.showModal();search.focus();}
 function openAgent(expanded=false){
  if(drawer?.open){drawer.querySelector('textarea')?.focus();return;}
  const contextScreen=current==='performance'?'campaign':current;drawer=dialog((expanded?'הסוכן שלך · מנהל הקמפיינים':'הסוכן שלך'),{className:expanded?'agent-expanded':'agent-drawer'});const activeDrawer=drawer;
  const head=drawer.querySelector('.dialog-heading');if(!expanded)head.insertBefore(button('↗',()=>{drawer.close();openAgent(true);},'icon-button'),head.lastChild);if(!expanded)head.children[1].setAttribute('aria-label','הרחבת הסוכן למסך מלא');
  const context=el('div',titles[contextScreen]+' · מחובר לפרטי העסק ולתכנון','agent-context');if(!expanded)drawer.append(context);
  const body=el('div','','agent-body'),welcome=el('div','','agent-welcome');welcome.append(el('div','','agent-orb'),el('h3','מה תרצו לקדם עכשיו?'),el('p','ממשיכים מהמידע שכבר נשמר על העסק.','muted'));body.append(welcome);
  const messages=el('div');messages.setAttribute('role','log');messages.setAttribute('aria-label','היסטוריית שיחה');messages.setAttribute('aria-live','polite');body.append(messages);
  const quick=el('div','','quick-chips');[['נמשיך בתוכנית','נמשיך'],['מה כבר ידוע?','מה כבר ידוע'],['הכן תוכנית קמפיין','תכין לי תוכנית קמפיין']].forEach(([label,message])=>quick.append(button(label,()=>submitMessage(message),'secondary')));body.append(quick);
  const shortcuts=el('div','','agent-shortcuts');shortcuts.append(button('פתיחת קמפיינים',()=>{drawer.close();navigate('campaign');}),button('צור פוסט חדש',()=>{drawer.close();navigate('content').then(aiPost);}),button('ניהול משימות',()=>{drawer.close();navigate('tasks');}));body.append(shortcuts);
  const composer=el('form','','agent-composer'),row=el('div','','composer-row'),input=el('textarea');input.rows=1;input.maxLength=2000;input.required=true;input.placeholder='כתבו מה תרצו ליצור, לבדוק או לתכנן…';input.setAttribute('aria-label','הודעה לסוכן');const send=button('↑',null,'primary');send.type='submit';send.setAttribute('aria-label','שליחת הודעה לסוכן');const attach=button('',()=>run(attach,async()=>{const caption=input.value.trim(),r=await sendImage(caption);if(!r)return;chatMessages=[...chatMessages,{role:'user',content:'📷 תמונה'+(caption?': '+caption:'')},{role:'assistant',content:r.reply,media:r.media}].slice(-24);renderMessages();input.value='';tell('התמונה נשלחה לסוכן.');}),'icon-button');attach.append(UI.icon('attachment'));attach.setAttribute('aria-label','צירוף תמונה לסוכן');attach.title='צירוף תמונה';row.append(attach,input,send);composer.append(row,el('small','הביצוע כפוף להרשאות החשבון ולאישור המתאים. Shift+Enter לשורה חדשה.'));drawer.append(body,composer);
  if(expanded){const summary=el('aside','','business-summary');summary.append(el('h3','כרטיס העסק שלך'));const identity=el('div','','summary-brand'),mark=el('div',state.brand?.logo?'':'לוגו','summary-logo');if(state.brand?.logo){const image=el('img');image.src='/app/api/brand-image?slot=logo';image.alt='לוגו העסק';mark.append(image);}identity.append(mark,el('strong',state.business.businessName||'העסק שלך'));summary.append(identity);const factsGrid=el('div','','summary-grid');fieldValue(factsGrid,'תחום',state.business.businessType);fieldValue(factsGrid,'בעל/ת החשבון',state.account?.display_name);for(const [k,label]of Object.entries({audience:'קהל היעד',product:'מוצרים ושירותים',advantage:'הבידול',businessGoal:'המטרה'})){const block=el('div','','summary-wide');fieldValue(block,label,state.business[k]);factsGrid.append(block);}summary.append(factsGrid);summary.append(progress(Math.round(Object.values(state.business).filter(Boolean).length/17*100),'פרטי עסק שנמסרו'));drawer.append(summary);}
  let busy=false,loaded=false,pending=null;
  const cancelChip=()=>{const stuck=!!chatMessages.at(-1)?.content?.includes('לא קיבלתי מ־Meta תשובה ברורה');if(!stuck)quick.querySelector('[data-cancel]')?.remove();if(stuck&&!quick.querySelector('[data-cancel]')){const b=button('תסגור אותה ונתחיל מחדש',()=>submitMessage('תסגור אותה'),'secondary');b.dataset.cancel='1';quick.prepend(b);}};
  const renderMessages=()=>{cancelChip();messages.replaceChildren();chatMessages.forEach(m=>{const bubble=el('div',m.content,'chat-message '+m.role);for(const media of m.media||[]){if(!/^\/app\/api\/agent\/media\/[a-f0-9-]{36}$/i.test(media.url||''))continue;const image=el('img');image.src=media.url;image.alt='טיוטת תמונה לבדיקה';image.addEventListener('error',()=>image.replaceWith(el('p','התמונה אינה זמינה עוד. אפשר לבקש להכין גרסה חדשה.')),{once:true});bubble.append(image);}messages.append(bubble);});body.scrollTop=body.scrollHeight;};
  async function submitMessage(value){
   if(busy||!loaded||!value.trim())return;busy=true;send.disabled=true;input.disabled=true;quick.querySelectorAll('button').forEach(b=>b.disabled=true);
   const bodyRequest=pending?.message===value?pending:{message:value,screen:contextScreen,requestId:crypto.randomUUID()};pending=bodyRequest;
   try{tell('רגע, חושב…');const r=await api('agent',bodyRequest);pending=null;chatMessages=[...chatMessages,{role:'user',content:value},{role:'assistant',content:r.reply,media:r.media}].slice(-24);renderMessages();input.value='';shortcuts.replaceChildren();r.actions.forEach(a=>shortcuts.append(button(a.label,()=>{activeDrawer.close();navigate(a.screen);})));tell('');await refresh();}
   catch(e){tell(e.message,true);}finally{busy=false;send.disabled=false;input.disabled=false;quick.querySelectorAll('button').forEach(b=>b.disabled=false);input.focus();}
  }
  composer.addEventListener('submit',e=>{e.preventDefault();submitMessage(input.value);});input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();submitMessage(input.value);}});
  send.disabled=true;drawer.showModal();api('agent').then(r=>{if(!activeDrawer.open)return;chatMessages=r.messages;renderMessages();loaded=true;send.disabled=false;input.focus();}).catch(e=>{tell(e.message,true);body.append(el('p','ההיסטוריה לא נטענה. סגרו ופתחו את הסוכן כדי לנסות שוב.','error'));});
 }
 function closeTour(){if(!guide)return;guide.remove();guide=null;document.querySelectorAll('.tour-highlight').forEach(x=>x.classList.remove('tour-highlight'));}
 async function startTour(){
  closeTour();if(!state)return;await navigate('sales');let step=0;
  const steps=[['.stats-row','המספרים של העסק','המספרים מבוססים על הלידים והמשימות שלך.'],['.sidebar','כל המחלקה, במקום אחד','בתפריט הצד נמצאים המסכים של המחלקה שבחרת.'],['.department-nav','מעבר בין מחלקות','מכאן עוברים לשיווק, מכירות, פיננסים ויומן.'],['.floating-actions','הסוכן ועזרה','הסוכן משתמש בפרטי העסק שכבר נשמרו. העזרה והמדריך זמינים כאן.'],['#business-switch','אותו עסק, אותה שיחה','הפרטים והחיבורים נשארים משויכים לחשבון שנכנס מה־WhatsApp.']];
  const draw=()=>{closeTour();const [selector,title,body]=steps[step],target=document.querySelector(selector);target?.classList.add('tour-highlight');guide=el('div','','tour-popover');guide.setAttribute('role','dialog');guide.setAttribute('aria-label','מדריך אינטראקטיבי');guide.append(el('p','שלב '+(step+1)+' מתוך '+steps.length,'muted'),el('h3',title),el('p',body));const actions=el('div','','actions');actions.append(button(step===steps.length-1?'סיום':'הבא',()=>{if(++step>=steps.length){localSet('scorpio-tour','complete');closeTour();tell('המדריך הושלם. אפשר להפעיל אותו שוב בכל עת.');}else draw();},'primary'),button('דלג על המדריך',()=>{localSet('scorpio-tour','skipped');closeTour();}));guide.append(actions);document.body.append(guide);const r=target?.getBoundingClientRect(),w=Math.min(360,innerWidth-32),left=Math.max(16,Math.min(innerWidth-w-16,r?r.left+r.width/2-w/2:innerWidth/2-w/2)),top=Math.max(120,Math.min(innerHeight-guide.offsetHeight-16,r?r.bottom+12:160));guide.style.left=left+'px';guide.style.top=top+'px';actions.firstChild.focus();};draw();
 }
 function onboarding(){
  const hero=el('div','','onboarding-hero');hero.append(badge('SCORPIO AI · נכיר את העסק'),el('h1','ספרו לנו על העסק שלכם'),el('h2','ונבנה יחד את הצעד הבא שלו'),el('p','יש לכם אתר? אפשר לקרוא את העמוד הציבורי, לבדוק את הפרטים ולאשר מה לשמור.','muted'));
  const form=el('form','','onboarding-url'),input=el('input');input.type='url';input.name='url';input.required=true;input.maxLength=2000;input.placeholder='https://your-business.com';input.dir='ltr';input.setAttribute('aria-label','כתובת אתר העסק');const submit=button('↑',null,'primary');submit.type='submit';submit.setAttribute('aria-label','בדיקת אתר העסק');form.append(el('span','◎','url-symbol'),input,submit);form.addEventListener('submit',e=>{e.preventDefault();importBusiness(input.value);});hero.append(form);
  const actions=el('div','','actions');actions.append(button('אין לי אתר — ממשיכים בשיחה',()=>openAgent(true),'ghost'),go('חזרה לעסק שלי','home'));hero.append(actions);hero.append(el('p','הפרטים יישמרו רק לאחר שתבדקו ותאשרו אותם.','muted'));return [hero];
 }
 function importBusiness(initialUrl){const d=dialog('ספרו לנו על העסק שלכם'),form=el('form'),error=el('p','','form-error');error.setAttribute('role','alert');field(form,'כתובת אתר העסק','url',{type:'url',value:typeof initialUrl==='string'?initialUrl:'',required:true,maxLength:2000,help:'נקרא מידע מהעמוד הציבורי ונציג לכם אותו לאישור לפני שמירה.'});const submit=button('בדיקת האתר',null,'primary');submit.type='submit';form.append(error,submit);d.append(form);d.showModal();form.addEventListener('submit',e=>{e.preventDefault();run(submit,async()=>{error.textContent='';try{const r=await api('business/inspect',{url:new FormData(form).get('url')});const preview=card('הפרטים שנמצאו באתר','זו הצעה בלבד — הפרטים יישמרו רק לאחר אישורכם');Object.entries(r.candidate.facts||{}).forEach(([key,value])=>fieldValue(preview,({businessName:'שם העסק',businessType:'תחום',product:'מוצר',serviceArea:'אזור'})[key]||key,value));preview.append(el('p','אלה הפרטים שמצאתי באתר. נכון?','muted'));const confirm=button('הפרטים נכונים — שמירה',()=>run(confirm,async()=>{const saved=await api('business/confirm',{confirm:true});if(!saved.ok)throw Error('לא הצלחתי לשמור את פרטי האתר כרגע. אפשר להמשיך בשיחה עם הסוכן.');d.close();await refresh();tell('פרטי האתר אושרו ונשמרו.');}),'primary');preview.append(confirm);form.hidden=true;d.append(preview,button('בדיקת קישור אחר',()=>{preview.remove();form.hidden=false;}));}catch(err){error.textContent=err.message;}});});}
 document.addEventListener('portal:refresh',()=>{
  if(!ready){buildShell();ready=true;}
  renderSidebar();navigate(routeScreen(),false);
 });
 document.addEventListener('portal:navigate',e=>{if(ready)navigate(e.detail==='account'?'billing':e.detail);});
 window.addEventListener('offline',()=>tell('אין חיבור לרשת. שמירה דורשת חיבור פעיל.',true));window.addEventListener('online',()=>tell('החיבור חזר. אפשר לנסות שוב פעולה שלא הושלמה.'));
 // Script execution normally precedes the asynchronous first dashboard response.
 if(typeof state!=='undefined'&&state){buildShell();ready=true;navigate(routeScreen(),false);}
 // Expose only local UI navigation to the existing portal; API credentials stay in HttpOnly cookies.
 // Lead concierge: what the agent did with each lead, and the owner's one-tap takeover.
 const conciergeStatus={PENDING:'הסוכן שולח הודעה ראשונה',CONTACTED:'הסוכן פנה לליד, מחכה לתשובה',QUALIFYING:'הסוכן שואל שאלות התאמה',SCHEDULING:'הסוכן מציע מועדים',BOOKED:'נקבע מועד',DONE:'השאלות הושלמו, כדאי לחזור לליד',OWNER:'אתה ממשיך עם הליד',OPTED_OUT:'הליד ביקש הסרה, לא פונים אליו',FALLBACK:'ההודעה האוטומטית לא נמסרה, נשלחה לך הודעה מוכנה'};
 const conciergeScore={HOT:'🔥 חם',WARM:'🙂 פושר',COLD:'❄️ קר'},conciergeAnswer=[['intent','מחפשים'],['need','מה צריך'],['product','מוצר'],['goal','מטרה'],['budget','תקציב'],['area','אזור'],['quantity','כמות'],['delivery','קבלה'],['timing','מתי'],['slot_pref','שעה נוחה'],['mortgage','משכנתא']];
 const conciergeHandoff={DISTRESS:'הליד כתב משהו שדורש מגע אישי',LEAD_ASKED_HUMAN:'הליד ביקש לדבר עם אדם',OTHER_TIME:'אף מועד לא התאים לליד',UNCLEAR:'השיחה עם הסוכן לא הסתדרה'};
 function conciergeBlock(lead,conv,reload){
  const box=el('div','','concierge');box.setAttribute('aria-label','השיחה של הסוכן עם '+lead.name);
  const top=el('p','','actions');top.append(el('span','🤖 '+(conciergeStatus[conv.status]||conv.status),'badge'));if(conv.score)top.append(el('span',conciergeScore[conv.score],'badge'));box.append(top);
  const answers=conciergeAnswer.filter(([k])=>conv.answers?.[k]).map(([k,label])=>label+': '+conv.answers[k].label);if(answers.length)box.append(el('p',answers.join(' · ')));
  if(conv.viewing&&conv.viewingLabel)box.append(el('p','📅 מועד: '+conv.viewingLabel+({BOOKED:'',ATTENDED:' · הגיע',NO_SHOW:' · לא הגיע',PROGRESSING:' · מתקדמים',CANCELLED:' · בוטלה'}[conv.viewing.status]||'')));
  if(conciergeHandoff[conv.handoff_reason])box.append(el('p','⚠️ '+conciergeHandoff[conv.handoff_reason],'error'));
  const row=el('div','','actions');
  row.append(button('💬 השיחה של הסוכן'+(conv.messages?' ('+conv.messages+')':''),async e=>run(e.currentTarget,async()=>{const d=dialog('השיחה עם '+lead.name),data=await api('leads/'+lead.id+'/concierge');d.append(el('p','כל הודעה שהסוכן שלח בשמך, וכל תשובה של הליד.','muted'));for(const m of data.messages){const b=el('div',m.body,'chat-message '+(m.direction==='OUT'?'assistant':'user'));b.title=new Date(m.created_at).toLocaleString('he-IL');d.append(b);}if(!data.messages.length)d.append(el('p','עוד אין הודעות.','muted'));d.showModal();}),'secondary'));
  if(!['OWNER','OPTED_OUT','FALLBACK'].includes(conv.status)){const take=button('✋ אני ממשיך מכאן',()=>run(take,async()=>{await api('leads/'+lead.id+'/takeover',{});tell('הסוכן הפסיק לענות לליד הזה. מעכשיו אתה ממשיך איתו.');await reload?.();}),'secondary');take.title='הסוכן יפסיק לענות לליד, והודעות שלו יועברו אליך';row.append(take);}
  box.append(row);return box;
 }
 function conciergeSettings(data,reload){
  const meeting=data.meeting,c=card('🤖 הסוכן עונה ראשון ללידים',data.settings.enabled?'פועל: כל ליד מטופס Meta מקבל הודעה בשמך תוך דקות, עם עד 4 שאלות קצרות'+(meeting?' וקביעת '+meeting.noun+'.':'.'):'כבוי: כל ליד מגיע אליך עם הודעה מוכנה לשליחה בלחיצה.');
  const toggle=button(data.settings.enabled?'כיבוי':'הפעלה',()=>run(toggle,async()=>{await api('lead-concierge/settings',{enabled:!data.settings.enabled},'PUT');tell(data.settings.enabled?'הסוכן כבר לא יענה ללידים בעצמו.':'מעכשיו הסוכן עונה ראשון ללידים.');await reload?.();}),data.settings.enabled?'secondary':'primary');
  const form=el('form'),presets=[['0,1,2,3,4','א׳–ה׳'],['0,1,2,3,4,5','א׳–ו׳'],['0,1,2,3,4,5,6','כל השבוע']],w=data.settings.availability[0];
  const days=el('select'),start=el('input'),end=el('input');days.setAttribute('aria-label','ימים פנויים');presets.forEach(([v,l])=>{const o=el('option',l);o.value=v;o.selected=w&&w.days.join(',')===v;days.append(o);});
  for(const [i,v,l] of [[start,w?.start||'10:00','משעה'],[end,w?.end||'18:00','עד שעה']]){i.type='time';i.value=v;i.required=true;i.setAttribute('aria-label',l);}
  const line=el('div','','actions');line.append(days,start,end);const save=button('שמירת זמינות',null,'secondary');save.type='submit';line.append(save);
  form.append(el('p',data.settings.availabilityText?'זמינות ל'+meeting?.plural+': '+data.settings.availabilityText:'עוד לא הוגדרה זמינות ל'+meeting?.plural+'. בלי זמינות, הסוכן ישאל את השאלות ויעביר אליך לתיאום.','muted'),line);
  form.addEventListener('submit',e=>{e.preventDefault();run(save,async()=>{await api('lead-concierge/settings',{availability:[{days:days.value.split(',').map(Number),start:start.value,end:end.value}]},'PUT');tell('הזמינות נשמרה.');await reload?.();});});
  const kind=el('select');kind.setAttribute('aria-label','סוג העסק, לפיו נבחרות השאלות');(data.verticals||[]).forEach(v=>{const o=el('option',v.label);o.value=v.key;o.selected=v.key===data.vertical;kind.append(o);});
  kind.addEventListener('change',()=>run(kind,async()=>{await api('lead-concierge/settings',{vertical:kind.value},'PUT');tell('סוג העסק עודכן. השאלות ללידים חדשים יתאימו אליו.');await reload?.();}));
  const kindRow=el('label','סוג העסק (קובע אילו שאלות הסוכן שואל)');kindRow.append(kind);
  c.append(toggle,kindRow);if(meeting)c.append(form);return c;
 }
 window.ScorpioDashboard={navigate,openAgent,importBusiness,leadRevenueButton,leadDetailsButton,conciergeBlock,conciergeSettings};
})();
