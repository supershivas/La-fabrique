/* ============================================================
   LA FABRIQUE — app.js  v8
   ============================================================ */
const SUPABASE_URL      = (window.__env&&window.__env.SUPABASE_URL)      || 'https://mrivfwlxnmtgkifjucvd.supabase.co';
const SUPABASE_ANON_KEY = (window.__env&&window.__env.SUPABASE_ANON_KEY) || 'REMPLACE_PAR_TA_CLE_ANON';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ── Constants ── */
const STATUS_LABELS = {ready:'Ready to start',ongoing:'Ongoing',review:'In review',sent:'Sent to client',done:'Done',hold:'On hold'};

const STATUS_ACCENT={
  ready:'var(--s-ready-fg)',
  ongoing:'var(--s-ongoing-fg)',
  review:'var(--s-review-fg)',
  sent:'var(--s-sent-fg)',
  done:'var(--s-done-fg)',
  hold:'var(--s-hold-fg)',
};
const STATUS_CLASS  = {ready:'s-ready',ongoing:'s-ongoing',review:'s-review',sent:'s-sent',done:'s-done',hold:'s-hold'};
const PROG_COLOR    = {ready:'#B4B2A9',ongoing:'#378ADD',review:'#EF9F27',sent:'#D4537E',done:'#639922',hold:'#888780'};
const AUTO_PROG     = {ready:0,ongoing:40,review:70,sent:80,done:100,hold:null};
const IMP_DOT       = {low:'imp-low',medium:'imp-med',high:'imp-high'}; // kept for dashboard dots
const IMP_TAG       = {low:'imp-tag-low',medium:'imp-tag-med',high:'imp-tag-high'};
const IMP_LBL       = {low:'Low',medium:'Medium',high:'High'};

/* ── State ── */
let projects=[],selectedYear=new Date().getFullYear(),selectedCat='pro';
let showArchived=false,showDashboard=false,expandedIds=new Set(),expandedSubIds=new Set(),archivedSubsVisibleIds=new Set();
let sliderManual=false,currentUser=null,manualOrder={},dragSrcId=null,subDragSrc=null;
let editingId=null,editingSubParentId=null,addingNoteTo=null,addingNoteToSub=null,_animateNewId=null;
let notesExpandedIds=new Set(); // tracks which project note sections are fully expanded

/* ── Date helpers ── */
function toEU(iso){if(!iso)return'—';const[y,m,d]=iso.split('-');return`${d}/${m}/${y}`;}
function fromEU(eu){
  if(!eu||eu==='—')return'';
  if(/^\d{4}-\d{2}-\d{2}$/.test(eu))return eu;
  const m=eu.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!m)return'';
  return`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}
function maskDate(input){
  input.addEventListener('input',()=>{
    let v=input.value.replace(/\D/g,'');
    if(v.length>2)v=v.slice(0,2)+'/'+v.slice(2);
    if(v.length>5)v=v.slice(0,5)+'/'+v.slice(5);
    if(v.length>10)v=v.slice(0,10);
    input.value=v;
  });
}
function todayISO(){return new Date().toISOString().split('T')[0];}
function dlStatus(dl){
  if(!dl)return'';
  const diff=Math.ceil((new Date(dl)-new Date())/86400000);
  return diff<0?'over':diff<=7?'warn':'';
}

/* ── DOM helpers ── */
function g(id){return document.getElementById(id);}
function gv(id){return g(id)?.value.trim()||'';}
function sv(id,v){if(g(id))g(id).value=v??'';}

/* ── Progress bar ── */
function pb(pct,status){
  const c=status==='done'||pct>=100?'var(--s-done-fg)':PROG_COLOR[status]||'var(--text-tertiary)';
  const label=STATUS_LABELS[status]||status;
  const sCls='s-'+status;
  return`<div class="prog-wrap">
    <div class="prog-bar-bg"><div class="prog-fill-bg" style="width:${pct}%;background:${c}"></div></div>
    <span class="prog-pct">${pct}%</span>
    <span class="status-badge ${sCls}">${label}</span>
  </div>`;
}

/* ── Order ── */
function orderKey(){return`${selectedCat}_${selectedYear}`;}
function getOrderedList(list){
  const order=manualOrder[orderKey()];if(!order)return list;
  return[...order.map(id=>list.find(p=>p.id===id)).filter(Boolean),...list.filter(p=>!order.includes(p.id))];
}
function saveOrder(list){
  manualOrder[orderKey()]=list.map(p=>p.id);
  try{localStorage.setItem('lf_order',JSON.stringify(manualOrder));}catch(_){}
  // Persist to Supabase: update sort_order on each project
  if(currentUser){
    list.forEach((p,i)=>{
      db.from('projects').update({sort_order:i,updated_at:new Date().toISOString()}).eq('id',p.id).then(()=>{});
    });
  }
}
function loadOrder(){try{const r=localStorage.getItem('lf_order');if(r)manualOrder=JSON.parse(r);}catch(_){}}

/* ── XSS escape ── */
function esc(str){
  if(str==null)return'';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}



/* ── Prefs ── */
const PK='lf_prefs';
function loadPrefs(){try{const r=localStorage.getItem(PK);return r?JSON.parse(r):{}}catch(_){return{};}}
function savePrefs(patch){const p={...loadPrefs(),...patch};try{localStorage.setItem(PK,JSON.stringify(p));}catch(_){}return p;}
function applyPrefs(){
  const p=loadPrefs(),html=document.documentElement;
  const theme=p.theme||'light';html.setAttribute('data-theme',theme);g('toggle-theme')?.setAttribute('aria-checked',theme==='dark'?'true':'false');
  const fs=p.fontSize||'normal';html.setAttribute('data-font-size',fs);document.querySelectorAll('.fs-btn').forEach(b=>b.classList.toggle('active',b.dataset.size===fs));
  const accent=p.accent||'gold';html.setAttribute('data-accent',accent);document.querySelectorAll('.accent-swatch').forEach(b=>b.classList.toggle('active',b.dataset.accent===accent));
  const sidebar=g('sidebar');if(p.sidebarW&&sidebar)sidebar.style.width=p.sidebarW+'px';
}

/* ── DB Status ── */
let lastSyncTime=null;
function setDbStatus(state,text){
  ['db-status','settings-db-badge'].forEach(id=>{
    const el=g(id);if(!el)return;
    el.className=`db-status ${state}`;
    const icon=state==='ok'?'ti-database-check':state==='error'?'ti-database-x':'ti-loader-2';
    el.innerHTML=`<i class="ti ${icon}"></i><span>${text}</span>`;
  });
  const sync=g('db-last-sync');
  if(state==='ok'){
    lastSyncTime=new Date();
    const hhmm=`${String(lastSyncTime.getHours()).padStart(2,'0')}:${String(lastSyncTime.getMinutes()).padStart(2,'0')}`;
    if(sync)sync.textContent=`Sync ${hhmm}`;
    const ss=g('settings-last-sync');if(ss)ss.textContent=`${toEU(todayISO())} à ${hhmm}`;
  } else if(sync)sync.textContent='';
  const dbUrl=g('settings-db-url');if(dbUrl)dbUrl.textContent=SUPABASE_URL.replace('https://','');
}

/* ── Toast ── */
function toast(msg,type='success',action=null){
  let c=g('toast-container');
  if(!c){c=document.createElement('div');c.id='toast-container';c.style.cssText='position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:6px;pointer-events:none;';document.body.appendChild(c);}
  const bg=type==='success'?'var(--s-done-bg)':type==='error'?'var(--s-sent-bg)':'var(--s-ongoing-bg)';
  const fg=type==='success'?'var(--s-done-fg)':type==='error'?'var(--s-sent-fg)':'var(--s-ongoing-fg)';
  const ic=type==='success'?'ti-circle-check':type==='error'?'ti-circle-x':'ti-info-circle';
  const t=document.createElement('div');
  t.style.cssText=`display:flex;align-items:center;gap:7px;padding:9px 14px;border-radius:8px;background:${bg};color:${fg};font-size:.8rem;font-weight:500;box-shadow:var(--shadow-md);animation:slideIn .2s ease;pointer-events:all;`;
  const actionHtml=action?`<button style="margin-left:8px;padding:2px 8px;border-radius:4px;background:transparent;border:1px solid ${fg};color:${fg};font-size:.75rem;font-weight:600;cursor:pointer;opacity:.85" onclick="this.closest('[data-toast]').remove()">${action.label}</button>`:'';
  t.setAttribute('data-toast','');
  t.innerHTML=`<i class="ti ${ic}" style="font-size:1rem"></i><span style="flex:1">${msg}</span>${actionHtml}`;
  c.appendChild(t);
  if(action){t.querySelector('button')?.addEventListener('click',async e=>{e.stopPropagation();await action.cb();t.remove();});}
  const dur=action?4500:2800;
  setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(()=>t.remove(),300);},dur);
}

/* ── Unique lists (client aware of comma) ── */
function getUniqueList(field){
  if(field==='client'){
    const all=[];projects.forEach(p=>{p.client&&p.client.split(',').map(s=>s.trim()).filter(Boolean).forEach(c=>{if(!all.includes(c))all.push(c);});});return all;
  }
  return[...new Set(projects.map(p=>p[field]).filter(Boolean))];
}

/* ── Autocomplete ── */
function setupAC(inputId,suggestId,getItems,opts={}){
  const input=g(inputId),sug=g(suggestId);if(!input||!sug)return;
  function show(q){
    const all=getItems();
    const matches=q===null?all:all.filter(e=>e.toLowerCase().includes(q.toLowerCase())&&q.length>0);
    if(matches.length){
      sug.style.display='block';
      sug.innerHTML=matches.map(e=>`<div class="ac-item" data-val="${e.replace(/"/g,'&quot;')}">${e}</div>`).join('');
      sug.querySelectorAll('.ac-item').forEach(item=>item.addEventListener('mousedown',e=>{
        e.preventDefault();
        if(opts.append&&input.value.includes(',')){const parts=input.value.split(',');parts[parts.length-1]=' '+item.dataset.val;input.value=parts.join(',').replace(/^ /,'');}
        else input.value=item.dataset.val;
        sug.style.display='none';
      }));
    }else sug.style.display='none';
  }
  input.addEventListener('input',()=>show(input.value.split(',').pop().trim()));
  input.addEventListener('focus',()=>show(null));
  input.addEventListener('blur',()=>setTimeout(()=>sug.style.display='none',150));
}

/* ── Export CSV ── */
function exportCSV(){
  const list=getFiltered();
  const headers=['Type','Numéro','Nom','Catégorie','Statut','%','Importance','Éditeur','Client(s)','Début','Deadline','Terminé','Mis à jour'];
  const rows=[];
  list.forEach(p=>{
    rows.push(['Projet',p.number,p.name,p.cat,STATUS_LABELS[p.status]||p.status,p.progress+'%',IMP_LBL[p.importance]||p.importance,p.editor||'',p.client||'',toEU(p.date),toEU(p.deadline),toEU(p.ended),toEU(p.updatedAt)]);
    (p.subprojects||[]).forEach(s=>{
      rows.push(['↳ Sous-projet',s.number,s.name,p.cat,STATUS_LABELS[s.status]||s.status,s.progress+'%','','','','','',toEU(s.ended),'']);
    });
  });
  const csv=[headers,...rows].map(r=>r.map(v=>`"${String(v==null?"":v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`lafabrique_${selectedCat}_${selectedYear}_${todayISO()}.csv`;a.click();URL.revokeObjectURL(url);
  toast('Export CSV ✓');
}

/* ══════════════════════════════════════════════════════════
   CONTEXT MENU (… button)
   ══════════════════════════════════════════════════════════ */
function openCtxMenu(anchorEl, items){
  closeCtxMenu();
  const menu=document.createElement('div');menu.id='ctx-menu';menu.className='ctx-menu';
  menu.innerHTML=items.map(item=>
    item.sep?`<div class="ctx-sep"></div>`
    :`<button class="ctx-item ${item.danger?'danger':''}" data-action="${item.action}" data-pid="${item.pid||''}" data-sid="${item.sid||''}">
        <i class="ti ${item.icon}"></i>${item.label}
      </button>`
  ).join('');
  document.body.appendChild(menu);
  const rect=anchorEl.getBoundingClientRect();
  let top=rect.bottom+4,left=rect.right-menu.offsetWidth||rect.left;
  // keep in viewport
  if(left+200>window.innerWidth)left=window.innerWidth-204;
  if(top+menu.offsetHeight+10>window.innerHeight)top=rect.top-menu.offsetHeight-4;
  menu.style.top=top+'px';menu.style.left=left+'px';

  menu.querySelectorAll('.ctx-item').forEach(btn=>{
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      closeCtxMenu();
      handleCtxAction(btn.dataset.action,btn.dataset.pid,btn.dataset.sid);
    });
  });
  setTimeout(()=>document.addEventListener('click',closeCtxMenu,{once:true}),10);
}
function closeCtxMenu(){const m=g('ctx-menu');if(m)m.remove();}

async function handleCtxAction(action,pid,sid){
  const asyncActions=['dup-proj','archive-proj','dup-sub','archive-sub'];
  if(asyncActions.includes(action))setCardLoading(pid,true);
  try{
    switch(action){
      case 'add-sub':      openNewSub(pid);break;
      case 'add-note':     openAddNote(pid);break;
      case 'dup-proj':     await dupProject(pid);break;
      case 'archive-proj': await toggleArchive(pid);break;
      case 'delete-proj':  await confirmDelete(pid);break;
      case 'add-sub-note': openAddSubNote(pid,sid);break;
      case 'dup-sub':      await dupSub(pid,sid);break;
      case 'archive-sub':  await toggleArchiveSub(pid,sid);break;
      case 'delete-sub':   await confirmDeleteSub(pid,sid);break;
    }
  }finally{
    if(asyncActions.includes(action))setCardLoading(pid,false);
  }
}
function setCardLoading(pid,on){
  const card=g('project-list')?.querySelector(`[data-pid="${pid}"].proj-card`);
  if(!card)return;
  card.style.opacity=on?'.5':'';
  card.style.pointerEvents=on?'none':'';
}

/* ══════════════════════════════════════════════════════════
   INLINE STATUS DROPDOWN
   ══════════════════════════════════════════════════════════ */

/* ── Fireworks ── */
function launchFireworks(anchorEl){
  const rect=anchorEl?anchorEl.getBoundingClientRect():{top:window.innerHeight/2,left:window.innerWidth/2,width:0,height:0};
  const cx=rect.left+rect.width/2, cy=rect.top+rect.height/2;
  const canvas=document.createElement('canvas');
  canvas.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999';
  canvas.width=window.innerWidth;canvas.height=window.innerHeight;
  document.body.appendChild(canvas);
  const ctx=canvas.getContext('2d');
  const colors=['#C9973A','#E8C06A','#A3D977','#6BBFFF','#FF8A6B','#C084FC','#F472B6','#34D399'];
  const particles=[];
  const count=72;
  for(let i=0;i<count;i++){
    const angle=(Math.PI*2/count)*i;
    const speed=3+Math.random()*5;
    particles.push({
      x:cx,y:cy,
      vx:Math.cos(angle)*speed*(0.6+Math.random()*0.8),
      vy:Math.sin(angle)*speed*(0.6+Math.random()*0.8)-2,
      alpha:1,size:3+Math.random()*4,
      color:colors[Math.floor(Math.random()*colors.length)],
      gravity:0.12+Math.random()*0.08,
      decay:0.013+Math.random()*0.01,
    });
  }
  let frame;
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    let alive=false;
    particles.forEach(p=>{
      p.x+=p.vx;p.y+=p.vy;p.vy+=p.gravity;
      p.vx*=0.98;p.alpha-=p.decay;
      if(p.alpha>0){
        alive=true;
        ctx.save();ctx.globalAlpha=p.alpha;ctx.fillStyle=p.color;
        ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();
        ctx.restore();
      }
    });
    if(alive)frame=requestAnimationFrame(draw);
    else canvas.remove();
  }
  draw();
  setTimeout(()=>{cancelAnimationFrame(frame);canvas.remove();},2500);
}

function openInlineStatus(pid,anchorEl,sid=null){
  closeInlineStatus();
  const item=sid?projects.find(x=>x.id===pid)?.subprojects.find(x=>x.id===sid):projects.find(x=>x.id===pid);
  if(!item)return;
  const dropdown=document.createElement('div');dropdown.id='inline-status-dropdown';dropdown.className='isd-dropdown';
  dropdown.innerHTML=Object.entries(STATUS_LABELS).map(([k,v])=>`
    <button class="isd-item ${item.status===k?'active':''}" data-status="${k}">
      <span class="status-badge ${STATUS_CLASS[k]}">${v}</span>
      ${item.status===k?'<i class="ti ti-check" style="font-size:.7rem;margin-left:auto;color:var(--text-tertiary)"></i>':''}
    </button>`).join('');
  document.body.appendChild(dropdown);
  const rect=anchorEl.getBoundingClientRect();
  dropdown.style.top=`${rect.bottom+4}px`;dropdown.style.left=`${Math.min(rect.left,window.innerWidth-180)}px`;
  dropdown.querySelectorAll('.isd-item').forEach(btn=>{
    btn.addEventListener('click',async e=>{
      e.stopPropagation();
      const newStatus=btn.dataset.status;
      closeInlineStatus();
      if(sid){
        const parent=projects.find(x=>x.id===pid);const s=parent.subprojects.find(x=>x.id===sid);
        if(!s)return;s.status=newStatus;s.progress=AUTO_PROG[newStatus]!==null?AUTO_PROG[newStatus]:s.progress;
        await saveSubproject(pid,s,false);parent.updatedAt=todayISO();await saveProject({...parent},false);
      } else {
        const p=projects.find(x=>x.id===pid);if(!p)return;
        const wasNotDone=p.status!=='done';p.status=newStatus;
        p.progress=AUTO_PROG[newStatus]!==null?AUTO_PROG[newStatus]:p.progress;
        if(newStatus==='done'&&wasNotDone){p.ended=todayISO();launchFireworks(anchorEl);
        // Flash the card green
        const doneCard=g('project-list')?.querySelector(`[data-pid="${pid}"].proj-card`);
        if(doneCard){doneCard.classList.remove('card-done-flash');void doneCard.offsetWidth;doneCard.classList.add('card-done-flash');}
      }
        if(newStatus!=='done')p.ended=null;
        p.updatedAt=todayISO();await saveProject({...p},false);
      }
      toast(`Statut → ${STATUS_LABELS[newStatus]} ✓`);
      renderProjects();renderSidebar();
      // Pop the status badge after re-render
      const card=g('project-list')?.querySelector(`[data-pid="${pid}"]`);
      if(card){
        const badge=card.querySelector('.status-badge');
        if(badge){badge.classList.remove('badge-pop');void badge.offsetWidth;badge.classList.add('badge-pop');}
      }
    });
  });
  setTimeout(()=>document.addEventListener('click',closeInlineStatus,{once:true}),10);
}
function closeInlineStatus(){const d=g('inline-status-dropdown');if(d)d.remove();}

/* ══════════════════════════════════════════════════════════
   SUPABASE
   ══════════════════════════════════════════════════════════ */
async function fetchProjects(){
  setDbStatus('connecting','Connexion…');
  g('project-list').innerHTML=`<div class="loading-state"><i class="ti ti-loader-2" style="animation:spin 1s linear infinite;font-size:1.2rem"></i> Chargement…</div>`;
  const{data:pData,error:pErr}=await db.from('projects').select('*').eq('user_id',currentUser.id).order('sort_order',{ascending:true,nullsFirst:false});
  if(pErr){setDbStatus('error','Erreur BDD');toast('Impossible de charger les projets','error');g('project-list').innerHTML=`<div class="empty-state"><i class="ti ti-database-x"></i><p>${pErr.message}</p></div>`;return;}
  const ids=(pData||[]).map(p=>p.id);
  const{data:sData}=ids.length?await db.from('subprojects').select('*').in('parent_id',ids):{data:[]};
  const{data:nData}=ids.length?await db.from('notes').select('*').in('project_id',ids).order('created_at',{ascending:true}):{data:[]};
  projects=(pData||[]).map(p=>({
    id:p.id,number:p.number,name:p.name,cat:p.cat||'pro',
    status:p.status||'ready',progress:p.progress||0,importance:p.importance||'medium',
    editor:p.editor||'',client:p.client||'',date:p.date||'',
    deadline:p.deadline||'',ended:p.ended||null,archived:p.archived||false,
    updatedAt:(p.updated_at||'').split('T')[0],year:p.year||new Date().getFullYear(),
    subprojects:(sData||[]).filter(s=>s.parent_id===p.id).map(s=>({
      id:s.id,number:s.number,name:s.name,status:s.status||'ready',progress:s.progress||0,
      deadline:s.deadline||null, ended:s.ended||null, archived:s.archived||false,
      notes:(nData||[]).filter(n=>n.project_id===p.id&&n.sub_id===s.id).map(n=>({id:n.id,date:(n.created_at||'').split('T')[0],text:n.text})),
    })),
    notes:(nData||[]).filter(n=>n.project_id===p.id&&!n.sub_id).map(n=>({id:n.id,date:(n.created_at||'').split('T')[0],text:n.text})),
  }));
  restoreFilters();setDbStatus('ok','Connecté');renderSidebar();renderView();
}

async function saveProject(payload,isNew=false){
  const row={number:payload.number,name:payload.name,cat:payload.cat,status:payload.status,progress:payload.progress,importance:payload.importance,editor:payload.editor,client:payload.client,date:payload.date||null,deadline:payload.deadline||null,ended:payload.ended||null,year:payload.year,archived:payload.archived||false,updated_at:new Date().toISOString(),user_id:currentUser.id};
  if(isNew){const{data,error}=await db.from('projects').insert(row).select().single();if(error){toast('Erreur création','error');return null;}return data.id;}
  const{error}=await db.from('projects').update(row).eq('id',payload.id);if(error){toast('Erreur mise à jour','error');return null;}return payload.id;
}
async function saveSubproject(parentId,payload,isNew=false){
  const row={parent_id:parentId,number:payload.number,name:payload.name,status:payload.status,progress:payload.progress,deadline:payload.deadline||null,ended:payload.ended||null,archived:payload.archived||false};
  if(isNew){const{data,error}=await db.from('subprojects').insert(row).select().single();if(error){toast('Erreur sous-projet','error');return null;}return data.id;}
  const{error}=await db.from('subprojects').update(row).eq('id',payload.id);if(error){toast('Erreur sous-projet','error');return null;}return payload.id;
}
async function saveNote(projectId,text,subId=null){
  const row={project_id:projectId,text,created_at:new Date().toISOString()};if(subId)row.sub_id=subId;
  const{data,error}=await db.from('notes').insert(row).select().single();if(error){toast('Erreur note','error');return null;}return data;
}
async function updateNote(noteId,text){const{error}=await db.from('notes').update({text}).eq('id',noteId);if(error){toast('Erreur modification note','error');return false;}return true;}
async function deleteNote(noteId){const{error}=await db.from('notes').delete().eq('id',noteId);if(error){toast('Erreur suppression note','error');return false;}return true;}
async function deleteProjectFromDb(id){const{error}=await db.from('projects').delete().eq('id',id);if(error){toast('Erreur suppression','error');return false;}return true;}
async function deleteSubprojectFromDb(id){const{error}=await db.from('subprojects').delete().eq('id',id);if(error){toast('Erreur suppression sous-projet','error');return false;}return true;}

/* ══════════════════════════════════════════════════════════
   SIDEBAR
   ══════════════════════════════════════════════════════════ */

/* ── Year modal ── */
let _yearModalCat=null;
function openYearModal(cat){
  _yearModalCat=cat;
  const ov=g('year-modal-overlay');
  const inp=g('year-modal-input');
  if(!ov||!inp)return;
  inp.value='';
  g('year-modal-error').textContent='';
  ov.classList.add('open');
  setTimeout(()=>inp.focus(),80);
}
function closeYearModal(){g('year-modal-overlay')?.classList.remove('open');}
function confirmYearModal(){
  const inp=g('year-modal-input');
  const val=inp?.value.trim();
  const err=g('year-modal-error');
  if(!val||isNaN(val)||parseInt(val)<2000||parseInt(val)>2100){
    if(err)err.textContent='Année invalide (2000–2100)';
    inp?.focus();return;
  }
  const y=parseInt(val);
  selectedYear=y;selectedCat=_yearModalCat;
  closeYearModal();renderSidebar();renderView();
}

function renderSidebar(){
  ['pro','perso'].forEach(cat=>{
    const container=g('yl-'+cat);if(!container)return;
    const years=[...new Set(projects.filter(p=>p.cat===cat).map(p=>p.year))].sort((a,b)=>b-a);
    container.innerHTML=years.map(y=>{
      const count=projects.filter(p=>p.cat===cat&&p.year===y&&!p.archived).length;
      const overdue=projects.filter(p=>p.cat===cat&&p.year===y&&!p.archived&&p.deadline&&dlStatus(p.deadline)==='over'&&p.status!=='done').length;
      const active=selectedCat===cat&&selectedYear===y;
      return`<div class="year-item ${active?'active':''}" data-y="${y}" data-c="${cat}"><span>${y}${overdue?` <span class="overdue-badge">☠${overdue}</span>`:''}</span><span class="year-count">${count}</span></div>`;
    }).join('')+`<div class="year-item year-item-add" data-y="new" data-c="${cat}"><i class="ti ti-plus" style="font-size:.65rem"></i> Année</div>`;
    container.querySelectorAll('.year-item').forEach(item=>{
      item.addEventListener('click',()=>{
        if(item.dataset.y==='new'){openYearModal(cat);return;}
        selectedYear=parseInt(item.dataset.y);selectedCat=item.dataset.c;showDashboard=false;renderSidebar();renderView();
      });
    });
  });
  g('btn-dashboard')?.classList.toggle('active',showDashboard);
  const ab=g('toggle-archived');if(ab){ab.querySelector('span').textContent=showArchived?'Masquer archivés':'Voir archivés';ab.classList.toggle('active',showArchived);}
  const title=g('topbar-title');if(title)title.textContent=`${selectedCat==='pro'?'Pro':'Perso'} · ${selectedYear}${showArchived?' · Archives':showDashboard?' · Stats':''}`;
  const logout=g('btn-logout');if(logout&&currentUser)logout.title=currentUser.email;
}


function updateClearBtn(){
  const anyFilter=g('filter-status')?.value||g('filter-imp')?.value||g('filter-editor')?.value||g('search')?.value;
  const cb=g('btn-clear-filters');
  if(cb)cb.style.display=anyFilter?'inline-flex':'none';
  ['filter-status','filter-imp','filter-editor'].forEach(id=>{
    const el=g(id);if(el)el.classList.toggle('filter-on',!!el.value);
  });
}
function renderView(){
  const title=g('topbar-title');if(title)title.textContent=`${selectedCat==='pro'?'Pro':'Perso'} · ${selectedYear}${showArchived?' · Archives':showDashboard?' · Stats':''}`;
  if(showDashboard)renderDashboard();else renderProjects();
}

/* ══════════════════════════════════════════════════════════
   SETTINGS
   ══════════════════════════════════════════════════════════ */
function openSettings(){
  const emailEl=g('settings-email');if(emailEl&&currentUser)emailEl.textContent=currentUser.email;
  const dbUrlEl=g('settings-db-url');if(dbUrlEl)dbUrlEl.textContent=SUPABASE_URL.replace('https://','');
  const ss=g('settings-last-sync');if(ss&&lastSyncTime){const hhmm=`${String(lastSyncTime.getHours()).padStart(2,'0')}:${String(lastSyncTime.getMinutes()).padStart(2,'0')}`;ss.textContent=`${toEU(todayISO())} à ${hhmm}`;}
  const sbadge=g('settings-db-badge'),mb=g('db-status');if(sbadge&&mb){sbadge.className=mb.className;sbadge.innerHTML=mb.innerHTML;}
  g('settings-overlay')?.classList.add('open');
}
function closeSettings(){g('settings-overlay')?.classList.remove('open');}

/* ══════════════════════════════════════════════════════════
   DRAG & DROP
   ══════════════════════════════════════════════════════════ */
function setupDragDrop(container){
  container.querySelectorAll('.proj-card[draggable]').forEach(card=>{
    card.addEventListener('dragstart',e=>{dragSrcId=card.dataset.pid;card.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
    card.addEventListener('dragend',()=>{card.classList.remove('dragging');container.querySelectorAll('.proj-card').forEach(c=>c.classList.remove('drag-over'));dragSrcId=null;});
    card.addEventListener('dragover',e=>{e.preventDefault();if(card.dataset.pid===dragSrcId)return;container.querySelectorAll('.proj-card').forEach(c=>c.classList.remove('drag-over'));card.classList.add('drag-over');});
    card.addEventListener('drop',e=>{e.preventDefault();if(!dragSrcId)return;const tid=card.dataset.pid;if(tid===dragSrcId)return;const list=getFiltered();const si=list.findIndex(p=>p.id===dragSrcId),ti=list.findIndex(p=>p.id===tid);if(si===-1||ti===-1)return;const[m]=list.splice(si,1);list.splice(ti,0,m);saveOrder(list);renderProjects();});
  });
}
function setupSubDragDrop(subContainer,parentId){
  subContainer.querySelectorAll('.sub-card[draggable]').forEach(card=>{
    card.addEventListener('dragstart',e=>{subDragSrc=card.dataset.sid;card.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.stopPropagation();});
    card.addEventListener('dragend',()=>{card.classList.remove('dragging');subContainer.querySelectorAll('.sub-card').forEach(c=>c.classList.remove('drag-over'));subDragSrc=null;});
    card.addEventListener('dragover',e=>{e.preventDefault();e.stopPropagation();if(card.dataset.sid===subDragSrc)return;subContainer.querySelectorAll('.sub-card').forEach(c=>c.classList.remove('drag-over'));card.classList.add('drag-over');});
    card.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();if(!subDragSrc)return;const tid=card.dataset.sid;if(tid===subDragSrc)return;const parent=projects.find(p=>p.id===parentId);const si=parent.subprojects.findIndex(s=>s.id===subDragSrc),ti=parent.subprojects.findIndex(s=>s.id===tid);if(si===-1||ti===-1)return;const[m]=parent.subprojects.splice(si,1);parent.subprojects.splice(ti,0,m);renderProjects();});
  });
}

/* ══════════════════════════════════════════════════════════
   FILTERING
   ══════════════════════════════════════════════════════════ */
function getFiltered(){
  const q=g('search').value.toLowerCase(),st=g('filter-status').value,imp=g('filter-imp').value,sort=g('sort-by').value;
  let list=projects.filter(p=>p.cat===selectedCat&&p.year===selectedYear&&(showArchived?p.archived:!p.archived));
  if(q)list=list.filter(p=>p.name.toLowerCase().includes(q)||p.number.toLowerCase().includes(q)||(p.editor&&p.editor.toLowerCase().includes(q))||(p.client&&p.client.toLowerCase().includes(q))||p.notes.some(n=>n.text.toLowerCase().includes(q))||(p.subprojects&&p.subprojects.some(s=>s.notes&&s.notes.some(n=>n.text.toLowerCase().includes(q)))));
  const ed=g('filter-editor')?.value||'';
  if(st)list=list.filter(p=>p.status===st);if(imp)list=list.filter(p=>p.importance===imp);
  if(ed)list=list.filter(p=>p.editor&&p.editor.toLowerCase().includes(ed.toLowerCase()));
  if(sort==='manual')return getOrderedList(list);
  if(sort==='number')return list.sort((a,b)=>a.number.localeCompare(b.number));
  if(sort==='name')  return list.sort((a,b)=>a.name.localeCompare(b.name));
  if(sort==='progress')return list.sort((a,b)=>b.progress-a.progress);
  if(sort==='deadline')return list.sort((a,b)=>{if(!a.deadline)return 1;if(!b.deadline)return-1;return new Date(a.deadline)-new Date(b.deadline);});
  return list.sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
}

/* ══════════════════════════════════════════════════════════
   BUILD NOTES HTML (last note + toggle)
   ══════════════════════════════════════════════════════════ */
function buildNotesSection(notes,actionPrefix,pid,sid=null){
  if(!notes||!notes.length)return`<div class="note-empty">Aucune note — <button class="btn-inline" data-action="${actionPrefix==='proj'?'add-note':'add-sub-note'}" data-pid="${pid}" data-sid="${sid||''}">ajouter</button></div>`;
  const sortedNotes=[...notes].reverse(); // newest first
  const lastNote=sortedNotes[0];
  const extraNotes=sortedNotes.slice(1);
  const key=sid?`sub-${sid}`:`proj-${pid}`;
  const isExpanded=notesExpandedIds.has(key);

  const noteHTML=(n)=>`
    <div class="note-item" data-note-id="${n.id}">
      <div class="note-item-header">
        <div class="note-date"><i class="ti ti-clock" style="font-size:.6rem"></i>${toEU(n.date)}</div>
        <div class="note-actions">
          <button class="btn-icon" data-action="${actionPrefix}-edit-note" data-nid="${n.id}" data-pid="${pid}" data-sid="${sid||''}" style="font-size:.75rem"><i class="ti ti-edit"></i></button>
          <button class="btn-icon" data-action="${actionPrefix}-del-note"  data-nid="${n.id}" data-pid="${pid}" data-sid="${sid||''}" style="font-size:.75rem;color:var(--s-sent-fg)"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      <div class="note-text" id="note-text-${n.id}">${esc(n.text)}</div>
    </div>`;

  return`
    ${noteHTML(lastNote)}
    ${extraNotes.length?`
      ${isExpanded?extraNotes.map(noteHTML).join(''):''}
      <button class="notes-toggle" data-action="toggle-notes" data-key="${key}">
        <i class="ti ti-${isExpanded?'chevron-up':'chevron-down'}"></i>
        ${isExpanded?'Masquer':'Voir les '+extraNotes.length+' note'+( extraNotes.length>1?'s':'')+' précédente'+(extraNotes.length>1?'s':'')}
      </button>`:''}`;
}

/* ══════════════════════════════════════════════════════════
   BUILD CARDS
   ══════════════════════════════════════════════════════════ */

function clearFilters(){
  const s=g('search');if(s)s.value='';
  ['filter-status','filter-imp','filter-editor'].forEach(id=>{
    const el=g(id);if(el){el.value='';el.classList.remove('filter-on');}
  });
  renderView();
  updateClearBtn();
  ['lf-filter-search','lf-filter-status','lf-filter-imp','lf-filter-editor','lf-sort'].forEach(k=>localStorage.removeItem(k));
}
function renderProjects(){
  const list=getFiltered(),container=g('project-list');if(!container)return;
  // Update result count + filter active states
  const rc=g('result-count');
  const total=projects.filter(p=>p.cat===selectedCat&&p.year===selectedYear&&(showArchived?p.archived:!p.archived)).length;
  if(rc){rc.textContent=list.length<total?`${list.length} / ${total}`:list.length>0?`${list.length}`:'';rc.style.display=list.length<total?'inline':'none';}
  updateClearBtn();
  // Refresh editor filter options
  const edSel=g('filter-editor');
  if(edSel){
    const curEd=edSel.value;
    const editors=[...new Set(projects.filter(p=>p.cat===selectedCat&&p.year===selectedYear&&p.editor).map(p=>p.editor.trim()).filter(Boolean))].sort();
    edSel.innerHTML='<option value="">Éditeur</option>'+editors.map(e=>`<option value="${esc(e)}" ${curEd===e?'selected':''}>${esc(e)}</option>`).join('');
  }
  const isDraggable=g('sort-by').value==='manual';
  if(!list.length){
    const q=g('search').value,st=g('filter-status').value,imp=g('filter-imp').value,ed=g('filter-editor')?.value||'';
    const hasFilter=q||st||imp||ed;
    if(showArchived){
      container.innerHTML=`<div class="empty-state"><i class="ti ti-archive"></i><p>Aucun projet archivé</p></div>`;
    } else if(hasFilter){
      container.innerHTML=`<div class="empty-state"><i class="ti ti-filter-off"></i><p>Aucun résultat pour ce filtre</p><button class="btn-ghost" onclick="clearFilters()" style="margin-top:8px">Effacer les filtres</button></div>`;
    } else {
      container.innerHTML=`<div class="empty-state"><i class="ti ti-inbox"></i><p>Aucun projet — appuie sur <kbd>N</kbd> pour commencer</p></div>`;
    }
    return;
  }
  container.innerHTML=list.map(p=>buildProjectCard(p,isDraggable)).join('');
  attachCardListeners();
  if(isDraggable)setupDragDrop(container);
  list.filter(p=>expandedIds.has(p.id)).forEach(p=>{
    const subCont=container.querySelector(`[data-pid="${p.id}"] .sub-list`);
    if(subCont)setupSubDragDrop(subCont,p.id);
  });
}

function buildMetaTags(p){
  const dls=dlStatus(p.deadline),dlClass=dls==='over'?'dl-over':dls==='warn'?'dl-warn':'';
  const clients=p.client?p.client.split(',').map(s=>s.trim()).filter(Boolean):[];
  return[
    '',
    p.editor?`<span class="tag-chip"><i class="ti ti-building" style="font-size:.6rem"></i>${esc(p.editor)}</span>`:'',
    clients.map(c=>`<span class="tag-chip"><i class="ti ti-user" style="font-size:.6rem"></i>${esc(c)}</span>`).join(''),
    p.date?`<span class="tag-chip"><i class="ti ti-calendar" style="font-size:.6rem"></i>${toEU(p.date)}</span>`:'',
    p.deadline?`<span class="tag-chip ${dlClass}">☠ ${toEU(p.deadline)}</span>`:'',
    p.ended?`<span class="tag-chip" style="color:var(--s-done-fg)">✓ ${toEU(p.ended)}</span>`:'',
    p.archived?`<span class="tag-chip" style="color:var(--text-tertiary)"><i class="ti ti-archive" style="font-size:.6rem"></i>Archivé</span>`:'',
  ].filter(Boolean).join('');
}

function buildProjectCard(p,draggable=false){
  const open=expandedIds.has(p.id);
  const metaTags=buildMetaTags(p);
  const dragHandle=draggable?`<div class="drag-handle" title="Réordonner"><i class="ti ti-grip-vertical"></i></div>`:'';

  let expandedSection='';
  if(open){
    // Subprojects — only if any exist
    const activeSubs=p.subprojects.filter(s=>!s.archived);
    const archivedSubs=p.subprojects.filter(s=>s.archived);
    const showArchivedSubs=archivedSubsVisibleIds.has(p.id);
    const subsList=activeSubs.map(s=>buildSubCard(s,p)).join('')+(showArchivedSubs?archivedSubs.map(s=>`<div style="opacity:0.5">${buildSubCard(s,p)}</div>`).join(''):'');
    const archivedToggle=archivedSubs.length?`<button class="btn-inline" style="color:var(--text-tertiary);font-size:var(--fs-xxxs)" data-action="toggle-archived-subs" data-pid="${p.id}">${showArchivedSubs?'Masquer':'Voir '+archivedSubs.length+' archivé'+(archivedSubs.length>1?'s':'')+' '}</button>`:'';
    const subsSection=p.subprojects.length?`
      <div class="subs-section">
        <div class="section-hdr">Sous-projets (${activeSubs.length}${archivedSubs.length?' + '+archivedSubs.length+' archivé'+(archivedSubs.length>1?'s':''):''})
          <button class="btn-inline" data-action="add-sub" data-pid="${p.id}"><i class="ti ti-plus"></i>Ajouter</button>
        </div>
        <div class="sub-list">${subsList}</div>
        ${archivedToggle}
      </div>`:`
      <div class="subs-section subs-empty">
        <button class="btn-inline" data-action="add-sub" data-pid="${p.id}" style="color:var(--text-tertiary)"><i class="ti ti-plus"></i>Ajouter un sous-projet</button>
      </div>`;

    // Notes — last note + toggle
    const notesSection=`
      <div class="notes-section" style="border-top:1px solid var(--border)">
        <div class="section-hdr">Notes
          <button class="btn-inline" data-action="add-note" data-pid="${p.id}"><i class="ti ti-plus"></i>Ajouter</button>
        </div>
        ${buildNotesSection(p.notes,'proj',p.id)}
      </div>`;

    expandedSection=`<div class="proj-expanded-wrap" id="exp-wrap-${p.id}"><div class="proj-expanded">${subsSection}${notesSection}</div></div>`;
  }

  const cardAccent=STATUS_ACCENT[p.status]||'var(--border)';
  const isNew=_animateNewId===p.id;if(isNew)_animateNewId=null;
  return`<div class="proj-card ${open?'expanded':''} ${isNew?'card-new':''}" data-pid="${p.id}" ${draggable?'draggable="true"':''}  style="--card-accent:${cardAccent}">
    <div class="pr-row" data-action="toggle" data-pid="${p.id}">
      <div class="pr-col-ctrl">
        ${dragHandle}
        <i class="ti ti-chevron-right pr-chevron ${open?'open':''}"></i>
      </div>
      <div class="pr-col-name">
        <div class="proj-num-row">
          <span class="proj-num">${esc(p.number)}</span>
          ${p.notes&&p.notes.length?`<span class="notes-bubble" title="${p.notes.length} note${p.notes.length>1?'s':''}"><i class="ti ti-note" style="font-size:.6rem"></i> ${p.notes.length}</span>`:''}
          ${p.subprojects&&p.subprojects.length?`<span class="subs-bubble" title="${p.subprojects.length} sous-projet${p.subprojects.length>1?'s':''}"><i class="ti ti-folders" style="font-size:.6rem"></i> ${p.subprojects.length}</span>`:''}
        </div>
        <span class="proj-name">${esc(p.name)}</span>
      </div>
      <div class="pr-col-bar" data-action="inline-status" data-pid="${p.id}" onclick="event.stopPropagation()" title="Cliquer pour changer le statut">
        ${pb(p.progress,p.status)}
      </div>
      <div class="pr-col-meta">
        ${metaTags}
      </div>
      <div class="pr-col-actions" onclick="event.stopPropagation()">
        <span class="imp-tag ${IMP_TAG[p.importance]}">${IMP_LBL[p.importance]}</span>
        <button class="btn-edit-main" data-action="edit-proj" data-pid="${p.id}">
          <i class="ti ti-edit"></i><span>Modifier</span>
        </button>
        <button class="btn-more" data-action="more-proj" data-pid="${p.id}" title="Plus d'options">
          <i class="ti ti-dots-vertical"></i>
        </button>
      </div>
    </div>
    ${expandedSection}
  </div>`;
}

function buildSubCard(s,parent){
  const open=expandedSubIds.has(s.id);
  const dls=dlStatus(s.deadline||''),dlClass=dls==='over'?'dl-over':dls==='warn'?'dl-warn':'';

  let expandedSection='';
  if(open){
    expandedSection=`<div class="proj-expanded-wrap" id="exp-wrap-sub-${s.id}"><div class="sub-expanded">
      <div class="section-hdr" style="font-size:var(--fs-xxxs);margin-bottom:4px">Notes
        <button class="btn-inline" data-action="add-sub-note" data-pid="${parent.id}" data-sid="${s.id}"><i class="ti ti-plus"></i>Ajouter</button>
      </div>
      ${buildNotesSection(s.notes,'sub',parent.id,s.id)}
    </div></div>`;
  }

  return`<div class="sub-card" draggable="true" data-sid="${s.id}" data-pid="${parent.id}">
    <div class="sub-row" data-action="toggle-sub" data-pid="${parent.id}" data-sid="${s.id}">
      <div class="sub-col-ctrl">
        <div class="sub-drag-handle"><i class="ti ti-grip-vertical"></i></div>
        <i class="ti ti-chevron-right sub-chevron ${open?'open':''}"></i>
      </div>
      <div class="sub-col-name">
        <span class="sub-num">${esc(s.number)}</span>
        <span class="sub-name">${esc(s.name)}</span>
      </div>
      <div class="sub-col-bar" data-action="inline-status-sub" data-pid="${parent.id}" data-sid="${s.id}" onclick="event.stopPropagation()" title="Cliquer pour changer le statut">
        ${pb(s.progress,s.status)}
      </div>
      <div class="sub-col-meta">
        ${s.deadline?`<span class="tag-chip ${dlClass}">☠ ${toEU(s.deadline)}</span>`:''}
        ${s.ended?`<span class="tag-chip" style="color:var(--s-done-fg)">✓ ${toEU(s.ended)}</span>`:''}
      </div>
      <div class="sub-col-actions" onclick="event.stopPropagation()">
        <button class="btn-edit-sub" data-action="edit-sub" data-pid="${parent.id}" data-sid="${s.id}">
          <i class="ti ti-edit"></i>
        </button>
        <button class="btn-more-sub" data-action="more-sub" data-pid="${parent.id}" data-sid="${s.id}" title="Plus d'options">
          <i class="ti ti-dots-vertical"></i>
        </button>
      </div>
    </div>
    ${expandedSection}
  </div>`;
}

/* ── Card event listeners ── */
function attachCardListeners(){
  g('project-list').querySelectorAll('[data-action]').forEach(node=>{
    node.addEventListener('click',async e=>{
      e.stopPropagation();
      const{action,pid,sid,nid,key}=node.dataset;
      switch(action){
        case 'toggle':        toggleExpand(pid);break;
        case 'toggle-sub':    toggleSubExpand(pid,sid);break;
        case 'toggle-notes':  toggleNotes(key);break;
        case 'edit-proj':     openEdit(pid);break;
        case 'more-proj':     openMoreMenu(pid,null,node);break;
        case 'add-sub':       openNewSub(pid);break;
        case 'add-note':      openAddNote(pid);break;
        case 'edit-sub':      openEditSub(pid,sid);break;
        case 'more-sub':      openMoreMenu(pid,sid,node);break;
        case 'add-sub-note':  openAddSubNote(pid,sid);break;
        case 'inline-status': openInlineStatus(pid,node);break;
        case 'inline-status-sub': openInlineStatus(pid,node,sid);break;
        case 'toggle-archived-subs': archivedSubsVisibleIds.has(pid)?archivedSubsVisibleIds.delete(pid):archivedSubsVisibleIds.add(pid);renderProjects();break;
        case 'proj-edit-note':editNoteInline(nid,pid,null);break;
        case 'proj-del-note': await delNoteAction(nid,pid,null);break;
        case 'sub-edit-note': editNoteInline(nid,pid,sid);break;
        case 'sub-del-note':  await delNoteAction(nid,pid,sid);break;
      }
    });
  });
}

function animateExpand(wrapEl,open){
  if(open){
    wrapEl.style.overflow='hidden';
    wrapEl.style.height='0';
    wrapEl.style.transition='none';
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const h=wrapEl.firstElementChild?wrapEl.firstElementChild.offsetHeight:0;
      wrapEl.style.transition='height .22s cubic-bezier(.4,0,.2,1)';
      wrapEl.style.height=h+'px';
      wrapEl.addEventListener('transitionend',()=>{
        wrapEl.style.height='';wrapEl.style.overflow='';wrapEl.style.transition='';
      },{once:true});
    }));
  } else {
    const h=wrapEl.firstElementChild?wrapEl.firstElementChild.offsetHeight:wrapEl.offsetHeight;
    wrapEl.style.transition='none';
    wrapEl.style.overflow='hidden';
    wrapEl.style.height=h+'px';
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      wrapEl.style.transition='height .18s cubic-bezier(.4,0,1,1)';
      wrapEl.style.height='0';
    }));
  }
}
function toggleExpand(id){
  const wasOpen=expandedIds.has(id);
  if(wasOpen){
    const wrapEl=g('exp-wrap-'+id);
    if(wrapEl){
      g('project-list')?.querySelector(`[data-pid="${id}"] .pr-chevron`)?.classList.remove('open');
      g('project-list')?.querySelector(`[data-pid="${id}"].proj-card`)?.classList.remove('expanded');
      animateExpand(wrapEl,false);
      setTimeout(()=>{expandedIds.delete(id);renderProjects();},190);
    } else {expandedIds.delete(id);renderProjects();}
  } else {
    expandedIds.add(id);
    renderProjects();
    const wrapEl=g('exp-wrap-'+id);
    if(wrapEl)animateExpand(wrapEl,true);
  }
}
function toggleSubExpand(pid,sid){
  const wasOpen=expandedSubIds.has(sid);
  if(!wasOpen){
    expandedSubIds.add(sid);
    renderProjects();
    const wrapEl=g('exp-wrap-sub-'+sid);
    if(wrapEl)animateExpand(wrapEl,true);
  } else {
    const wrapEl=g('exp-wrap-sub-'+sid);
    if(wrapEl){
      g('project-list')?.querySelector(`[data-sid="${sid}"] .sub-chevron`)?.classList.remove('open');
      animateExpand(wrapEl,false);
      setTimeout(()=>{expandedSubIds.delete(sid);renderProjects();},190);
    } else {expandedSubIds.delete(sid);renderProjects();}
  }
}
function toggleNotes(key){notesExpandedIds.has(key)?notesExpandedIds.delete(key):notesExpandedIds.add(key);renderProjects();}

function openMoreMenu(pid,sid,anchorEl){
  if(!sid){
    openCtxMenu(anchorEl,[
      {action:'add-sub',    pid, icon:'ti-folders',      label:'Ajouter sous-projet'},
      {action:'add-note',   pid, icon:'ti-notes',        label:'Ajouter une note'},
      {sep:true},
      {action:'dup-proj',   pid, icon:'ti-copy',         label:'Dupliquer'},
      {action:'archive-proj',pid,icon:'ti-archive',      label:'Archiver'},
      {sep:true},
      {action:'delete-proj',pid, icon:'ti-trash',        label:'Supprimer',danger:true},
    ]);
  } else {
    const subItem=projects.find(x=>x.id===pid)?.subprojects.find(x=>x.id===sid);
    const archiveLabel=subItem?.archived?'Restaurer':'Archiver';
    const archiveIcon=subItem?.archived?'ti-archive-off':'ti-archive';
    openCtxMenu(anchorEl,[
      {action:'add-sub-note',pid,sid,icon:'ti-notes',   label:'Ajouter une note'},
      {action:'dup-sub',     pid,sid,icon:'ti-copy',    label:'Dupliquer'},
      {action:'archive-sub', pid,sid,icon:archiveIcon,  label:archiveLabel},
      {sep:true},
      {action:'delete-sub',  pid,sid,icon:'ti-trash',   label:'Supprimer',danger:true},
    ]);
  }
}

/* ── Note inline edit ── */
function editNoteInline(nid,pid,sid){
  const textEl=g('note-text-'+nid);if(!textEl)return;
  const original=textEl.textContent;
  const textarea=document.createElement('textarea');textarea.className='note-edit-area';textarea.value=original;
  textEl.replaceWith(textarea);textarea.focus();
  const save=async()=>{
    const newText=textarea.value.trim();if(!newText)return;
    const ok=await updateNote(nid,newText);
    if(ok){
      const p=projects.find(x=>x.id===pid);
      if(sid){const s=p.subprojects.find(x=>x.id===sid);const n=s?.notes.find(x=>x.id===nid);if(n)n.text=newText;}
      else{const n=p.notes.find(x=>x.id===nid);if(n)n.text=newText;}
      toast('Note modifiée ✓');renderProjects();
    }
  };
  textarea.addEventListener('blur',save);
  textarea.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.ctrlKey)save();if(e.key==='Escape')renderProjects();});
}

/* ══════════════════════════════════════════════════════════
   CONFIRM MODAL
   ══════════════════════════════════════════════════════════ */
let _confirmCb=null;
function openConfirm(title,msg,cb){
  g('confirm-title').textContent=title;
  g('confirm-msg').innerHTML=msg;
  g('confirm-overlay').classList.add('open');
  _confirmCb=cb;
}
function closeConfirm(){g('confirm-overlay').classList.remove('open');_confirmCb=null;}

async function delNoteAction(nid,pid,sid){
  const p=projects.find(x=>x.id===pid);
  const label=sid?p?.subprojects.find(x=>x.id===sid)?.notes.find(x=>x.id===nid)?.text:p?.notes.find(x=>x.id===nid)?.text;
  openConfirm('Supprimer cette note ?',`<em style="color:var(--text-tertiary)">"${(label||'').slice(0,80)}…"</em>`,async()=>{
    const ok=await deleteNote(nid);
    if(ok){
      if(sid){const s=p.subprojects.find(x=>x.id===sid);if(s)s.notes=s.notes.filter(n=>n.id!==nid);}
      else p.notes=p.notes.filter(n=>n.id!==nid);
      toast('Note supprimée');renderProjects();
    }
  });
}

/* ── Duplicate / Archive / Delete ── */
async function dupProject(id){
  const src=projects.find(x=>x.id===id);if(!src)return;
  const newP={...src,id:undefined,number:src.number+'_copie',name:src.name+' (copie)',ended:null,archived:false,updatedAt:todayISO(),subprojects:[],notes:[]};
  const newId=await saveProject({...newP,year:src.year},true);
  if(!newId)return;
  newP.id=newId;
  // Dupliquer les sous-projets
  for(const s of (src.subprojects||[])){
    const sid=await saveSubproject(newId,{number:s.number,name:s.name,status:s.status,progress:s.progress},true);
    if(sid){
      const newSub={id:sid,number:s.number,name:s.name,status:s.status,progress:s.progress,notes:[]};
      // Dupliquer les notes du sous-projet
      for(const n of (s.notes||[])){
        const nd=await saveNote(newId,n.text,sid);
        if(nd)newSub.notes.push({id:nd.id,date:nd.created_at||todayISO(),text:n.text});
      }
      newP.subprojects.push(newSub);
    }
  }
  // Dupliquer les notes du projet
  for(const n of (src.notes||[])){
    const nd=await saveNote(newId,n.text);
    if(nd)newP.notes.push({id:nd.id,date:nd.created_at||todayISO(),text:n.text});
  }
  projects.push(newP);
  toast(`Projet dupliqué ✓ (${newP.subprojects.length} sous-projet${newP.subprojects.length>1?'s':''})`);
  renderSidebar();renderProjects();
}
async function dupSub(parentId,subId){
  const parent=projects.find(x=>x.id===parentId);const src=parent?.subprojects.find(x=>x.id===subId);if(!src)return;
  const newId=await saveSubproject(parentId,{number:src.number+'b',name:src.name+' (copie)',status:src.status,progress:src.progress},true);
  if(newId){parent.subprojects.push({id:newId,number:src.number+'b',name:src.name+' (copie)',status:src.status,progress:src.progress,notes:[]});toast('Sous-projet dupliqué ✓');renderProjects();}
}
async function toggleArchive(id){
  const p=projects.find(x=>x.id===id);if(!p)return;
  const wasArchived=p.archived;
  p.archived=!wasArchived;
  await saveProject({...p},false);
  renderSidebar();renderView();
  toast(
    wasArchived?'Projet désarchivé':'Projet archivé',
    'info',
    {label:'Annuler',cb:async()=>{p.archived=wasArchived;await saveProject({...p},false);renderSidebar();renderView();}}
  );
}
async function toggleArchiveSub(parentId,subId){
  const parent=projects.find(x=>x.id===parentId);const s=parent?.subprojects.find(x=>x.id===subId);if(!s)return;
  s.archived=!s.archived;
  await saveSubproject(parentId,s,false);
  toast(s.archived?'Sous-projet archivé':'Sous-projet restauré');
  renderProjects();
}
async function confirmDelete(id){
  const p=projects.find(x=>x.id===id);
  openConfirm(
    'Supprimer ce projet ?',
    `<strong>${esc(p?.number)} — ${esc(p?.name)}</strong><br><span style="color:var(--s-sent-fg);font-size:var(--fs-xxs)">Action irréversible. Sous-projets et notes inclus.</span>`,
    async()=>{
      const card=g('project-list')?.querySelector(`[data-pid="${id}"].proj-card`);
      const doDelete=async()=>{
        if(await deleteProjectFromDb(id)){
          projects=projects.filter(pr=>pr.id!==id);expandedIds.delete(id);
          toast('Projet supprimé');renderSidebar();renderView();
        }
      };
      if(card){card.classList.add('card-removing');setTimeout(doDelete,220);}
      else{await doDelete();}
    }
  );
}
async function confirmDeleteSub(parentId,subId){
  const parent=projects.find(x=>x.id===parentId);const s=parent?.subprojects.find(x=>x.id===subId);
  openConfirm(
    'Supprimer ce sous-projet ?',
    `<strong>${esc(s?.number)} — ${esc(s?.name)}</strong>`,
    async()=>{
      const card=g('project-list')?.querySelector(`[data-sid="${subId}"].sub-card`);
      const doDelete=async()=>{
        if(await deleteSubprojectFromDb(subId)){
          parent.subprojects=parent.subprojects.filter(x=>x.id!==subId);
          toast('Sous-projet supprimé');renderProjects();
        }
      };
      if(card){card.classList.add('card-removing');setTimeout(doDelete,220);}
      else{await doDelete();}
    }
  );
}

/* ══════════════════════════════════════════════════════════
   MODAL
   ══════════════════════════════════════════════════════════ */

/* ── Modal field visibility ── */
// cas: 'new-proj' | 'edit-proj' | 'new-sub' | 'edit-sub'
function showModalFields(cas){
  const blocs={
    'bloc-num'          : ['new-proj','edit-proj','new-sub'],
    'bloc-num-ro'       : ['edit-sub'],
    'bloc-cat'          : ['new-proj'],
    'bloc-meta'         : ['new-proj','edit-proj'],
    'bloc-imp'          : ['new-proj','edit-proj'],
    'bloc-note'         : ['new-proj','edit-proj'],
    'bloc-name'         : ['new-proj','edit-proj','new-sub','edit-sub'],
    'bloc-status'       : ['new-proj','edit-proj','new-sub','edit-sub'],
    'bloc-sub-deadline' : ['new-sub','edit-sub'],
  };
  Object.entries(blocs).forEach(([id,cases])=>{
    const el=g(id);if(!el)return;
    el.style.display=cases.includes(cas)?'':'none';
  });
  // label contextuel
  const lbl=g('f-name-label');
  if(lbl)lbl.textContent=cas.includes('sub')?'Nom du sous-projet':'Nom du projet';
  const ph=g('f-name');
  if(ph)ph.placeholder=cas.includes('sub')?'Nom du sous-projet':'Nom du projet';
}

function resetModal(){
  editingId=null;editingSubParentId=null;addingNoteTo=null;addingNoteToSub=null;sliderManual=false;
  ['f-num','f-num-ro','f-name','f-editor','f-client','f-note','f-sub-deadline'].forEach(id=>{const el=g(id);if(el){el.value='';el.disabled=false;}});
  g('f-status-m').value='ready';g('f-imp').value='medium';
  g('f-progress').value=0;g('f-progress-val').textContent='0%';
  if(g('f-progress'))g('f-progress').style.accentColor='var(--accent)';
  g('f-date').value='';g('f-deadline').value='';g('f-cat').value=selectedCat;
  g('note-label').textContent='Note initiale';
  g('f-note').placeholder='Ajouter une note…';
  g('prog-hint').textContent='Auto selon le statut — ajustable manuellement';
  g('editor-suggest').style.display='none';g('client-suggest').style.display='none';
  clearFieldErrors();
}

/* ── Field change highlight ── */
function watchFieldChanges(){
  const modal=g('modal');if(!modal)return;
  modal.querySelectorAll('input:not([readonly]),select,textarea').forEach(el=>{
    const orig=el.value;
    el.classList.remove('field-changed');
    const handler=()=>el.classList.toggle('field-changed',el.value!==orig);
    el.addEventListener('input',handler);
    el.addEventListener('change',handler);
  });
}
function openModal(title,icon='ti-folder'){g('modal-title').innerHTML=`<i class="ti ${icon}"></i>${title}`;g('modal-overlay').classList.add('open');}
function closeModal(){g('modal-overlay').classList.remove('open');resetModal();}
function syncSlider(status){
  const auto=AUTO_PROG[status];if(auto===null)return;
  if(!sliderManual){g('f-progress').value=auto;g('f-progress-val').textContent=`${auto}%`;}
  if(auto===100||status==='done'){if(g('f-progress'))g('f-progress').style.accentColor='#639922';}
  g('prog-hint').textContent=`Auto : ${auto}% pour "${STATUS_LABELS[status]}" — ajustable`;
}

function openNewProject(){
  resetModal();showModalFields('new-proj');syncSlider('ready');
  const year=new Date().getFullYear();
  sv('f-num',`${year}_`);
  openModal('Nouveau projet','ti-folder-plus');
  // Focus at end of prefilled number
  const numEl=g('f-num');
  if(numEl){numEl.focus();numEl.setSelectionRange(numEl.value.length,numEl.value.length);}
}

function openEdit(id){
  resetModal();showModalFields('edit-proj');editingId=id;sliderManual=true;
  const p=projects.find(x=>x.id===id);if(!p){toast('Projet introuvable','error');return;}
  sv('f-num',p.number);sv('f-name',p.name);sv('f-editor',p.editor);sv('f-client',p.client);
  g('f-status-m').value=p.status;g('f-imp').value=p.importance||'medium';
  g('f-progress').value=p.progress;g('f-progress-val').textContent=`${p.progress}%`;
  if(p.progress===100||p.status==='done')g('f-progress').style.accentColor='#639922';
  sv('f-date',p.date||'');sv('f-deadline',p.deadline||'');g('f-cat').value=p.cat;
  g('note-label').textContent='Nouvelle note';g('f-note').placeholder='Ajouter une note…';
  openModal(`Modifier — ${esc(p.number)}`,'ti-edit');
  watchFieldChanges();
}
function openNoteModal(title,cb){
  g('note-modal-title').innerHTML=`<i class="ti ti-notes"></i>${title}`;
  g('note-modal-text').value='';
  g('note-overlay').classList.add('open');
  setTimeout(()=>g('note-modal-text').focus(),50);
  _noteCb=cb;
}
function closeNoteModal(){g('note-overlay').classList.remove('open');_noteCb=null;}

function openAddNote(id){
  const p=projects.find(x=>x.id===id);if(!p)return;
  openNoteModal(`${p.number} — ${p.name}`,async()=>{
    const text=g('note-modal-text').value.trim();if(!text)return;
    const now=todayISO();
    const nd=await saveNote(p.id,text);
    if(nd){p.notes.push({id:nd.id,date:now,text});toast('Note ajoutée ✓');}
    closeNoteModal();renderProjects();
  });
}

function openAddSubNote(parentId,subId){
  const parent=projects.find(x=>x.id===parentId);const s=parent?.subprojects.find(x=>x.id===subId);if(!s)return;
  openNoteModal(`${s.number} — ${s.name}`,async()=>{
    const text=g('note-modal-text').value.trim();if(!text)return;
    const now=todayISO();
    const nd=await saveNote(parentId,text,subId);
    if(nd){s.notes.push({id:nd.id,date:now,text});toast('Note ajoutée ✓');}
    closeNoteModal();renderProjects();
  });
}

function openNewSub(parentId){
  resetModal();showModalFields('new-sub');editingSubParentId=parentId;
  const parent=projects.find(x=>x.id===parentId);if(!parent){toast('Projet introuvable','error');return;}
  sv('f-num',`${parent.number}_${String(parent.subprojects.length+1).padStart(2,'0')}`);
  openModal(`Sous-projet — ${esc(parent.number)}`,'ti-folders');
}
function openEditSub(parentId,subId){
  resetModal();showModalFields('edit-sub');editingSubParentId=parentId;editingId=subId;sliderManual=true;
  const parent=projects.find(x=>x.id===parentId);const s=parent?.subprojects.find(x=>x.id===subId);
  if(!s){toast('Sous-projet introuvable','error');return;}
  sv('f-num-ro',s.number);sv('f-name',s.name);
  g('f-status-m').value=s.status;g('f-progress').value=s.progress;g('f-progress-val').textContent=`${s.progress}%`;
  if(s.progress===100||s.status==='done')g('f-progress').style.accentColor='#639922';
  sv('f-sub-deadline', s.deadline||'');
  openModal(`Modifier — ${esc(s.number)}`,'ti-edit');
  watchFieldChanges();
}
function showFieldError(inputId,msg){
  const el=g(inputId);if(!el)return;
  el.classList.add('field-error');
  let em=el.parentNode.querySelector('.field-error-msg');
  if(!em){em=document.createElement('div');em.className='field-error-msg';el.parentNode.appendChild(em);}
  em.textContent=msg;em.classList.add('visible');
  el.addEventListener('input',()=>{el.classList.remove('field-error');em.classList.remove('visible');},{once:true});
}
function clearFieldErrors(){
  g('modal')?.querySelectorAll('.field-error').forEach(el=>el.classList.remove('field-error'));
  g('modal')?.querySelectorAll('.field-error-msg').forEach(el=>el.classList.remove('visible'));
}

/* ── Save ── */
async function handleSave(){
  clearFieldErrors();
  const num=gv('f-num'),name=gv('f-name'),status=g('f-status-m').value;
  let progress=parseInt(g('f-progress').value)||0;if(status==='done')progress=100;
  const deadline=gv('f-deadline'),date=gv('f-date');
  const noteText=gv('f-note'),editor=gv('f-editor'),client=gv('f-client');
  const importance=g('f-imp').value,cat=g('f-cat').value,now=todayISO();
  g('btn-save').disabled=true;g('btn-save').textContent='Enregistrement…';
  try{
    if(addingNoteToSub!==null){
      if(!noteText)return;const{parentId,subId}=addingNoteToSub;
      const parent=projects.find(x=>x.id===parentId);const s=parent?.subprojects.find(x=>x.id===subId);
      const nd=await saveNote(parentId,noteText,subId);if(nd){s.notes.push({id:nd.id,date:now,text:noteText});toast('Note ajoutée ✓');}
      closeModal();renderProjects();return;
    }
    if(addingNoteTo!==null){
      const p=projects.find(x=>x.id===addingNoteTo);const wasNotDone=p.status!=='done';
      Object.assign(p,{status,progress,updatedAt:now});
      if(status==='done'&&wasNotDone)p.ended=now;if(status!=='done')p.ended=null;
      await saveProject({...p},false);
      if(noteText){const nd=await saveNote(p.id,noteText);if(nd)p.notes.push({id:nd.id,date:now,text:noteText});}
      toast('Note ajoutée ✓');closeModal();renderView();return;
    }
    if(editingSubParentId!==null&&editingId!==null){
      const subNum=gv('f-num-ro')||num;
      let err=false;
      if(!subNum){showFieldError('f-num-ro','Numéro requis');err=true;}
      if(!name){showFieldError('f-name','Nom requis');err=true;}
      if(err)return;
      const parent=projects.find(x=>x.id===editingSubParentId);const sub=parent.subprojects.find(x=>x.id===editingId);if(!sub)return;
      const subDeadline=gv('f-sub-deadline');
      const ended=status==='done'&&sub.status!=='done'?now:(status!=='done'?null:sub.ended);
      Object.assign(sub,{number:subNum,name,status,progress,deadline:subDeadline||null,ended});await saveSubproject(editingSubParentId,sub,false);parent.updatedAt=now;await saveProject({...parent},false);toast('Sous-projet mis à jour ✓');
    } else if(editingSubParentId!==null){
      let err=false;
      if(!num){showFieldError('f-num','Numéro requis');err=true;}
      if(!name){showFieldError('f-name','Nom requis');err=true;}
      if(err)return;
      const parent=projects.find(x=>x.id===editingSubParentId);
      const subDeadline=gv('f-sub-deadline');
      const newId=await saveSubproject(editingSubParentId,{number:num,name,status,progress,deadline:subDeadline||null,ended:status==='done'?now:null,archived:false},true);
      if(newId){parent.subprojects.push({id:newId,number:num,name,status,progress,deadline:subDeadline||null,ended:status==='done'?now:null,archived:false,notes:[]});parent.updatedAt=now;await saveProject({...parent},false);}toast('Sous-projet créé ✓');
    } else if(editingId!==null){
      const editNum=gv('f-num').trim();
      let editErr=false;
      if(!editNum){showFieldError('f-num','Numéro requis');editErr=true;}
      else if(editNum!==projects.find(x=>x.id===editingId)?.number){
        const dup=projects.find(p=>p.number===editNum&&p.id!==editingId);
        if(dup){showFieldError('f-num',`N° déjà utilisé par "${esc(dup.name)}"`);editErr=true;}
      }
      if(!name){showFieldError('f-name','Nom requis');editErr=true;}
      if(editErr)return;
      const p=projects.find(x=>x.id===editingId);if(!p){toast('Projet introuvable','error');return;}
      const wasNotDone=p.status!=='done';Object.assign(p,{number:editNum,name,status,progress,date,deadline,editor,client,importance,cat,updatedAt:now});
      if(status==='done'&&wasNotDone)p.ended=now;if(status!=='done')p.ended=null;
      await saveProject({...p},false);
      if(noteText){const nd=await saveNote(p.id,noteText);if(nd)p.notes.push({id:nd.id,date:now,text:noteText});}
      toast('Projet mis à jour ✓');
    } else {
      let err=false;
      if(!num){showFieldError('f-num','Numéro requis');err=true;}
      else if(cat!=='perso'&&!/^\d{4}_\S+$/.test(num)){showFieldError('f-num','Format attendu : AAAA_xxx');err=true;}
      else{
        const duplicate=projects.find(p=>p.number===num&&p.cat===cat);
        if(duplicate){showFieldError('f-num',`N° déjà utilisé par "${duplicate.name}"`);err=true;}
      }
      if(!name){showFieldError('f-name','Nom requis');err=true;}
      if(err)return;
      const year=parseInt(num.split('_')[0])||new Date().getFullYear();
      const newP={number:num,name,cat,status,progress,importance,editor,client,date,deadline,ended:status==='done'?now:null,archived:false,updatedAt:now,year,subprojects:[],notes:[]};
      const newId=await saveProject({...newP},true);
      if(newId){newP.id=newId;if(noteText){const nd=await saveNote(newId,noteText);if(nd)newP.notes.push({id:nd.id,date:now,text:noteText});}projects.push(newP);selectedYear=year;selectedCat=cat;_animateNewId=newId;toast('Projet créé ✓');}
    }
    closeModal();renderSidebar();renderView();
  }finally{g('btn-save').disabled=false;g('btn-save').textContent='Enregistrer';}
}

/* ══════════════════════════════════════════════════════════
   DASHBOARD
   ══════════════════════════════════════════════════════════ */
function renderDashboard(){
  const container=g('project-list');
  const scope=projects.filter(p=>p.cat===selectedCat&&p.year===selectedYear&&!p.archived);
  const byStatus={};Object.keys(STATUS_LABELS).forEach(k=>byStatus[k]=0);scope.forEach(p=>{if(byStatus[p.status]!==undefined)byStatus[p.status]++;});
  const overdue=scope.filter(p=>p.deadline&&dlStatus(p.deadline)==='over'&&p.status!=='done');
  const dueSoon=scope.filter(p=>p.deadline&&dlStatus(p.deadline)==='warn'&&p.status!=='done');
  const active=scope.filter(p=>p.status!=='done'&&p.status!=='hold');
  const avgProg=active.length?Math.round(active.reduce((a,p)=>a+p.progress,0)/active.length):0;
  const clientMap={};scope.forEach(p=>{if(p.client)p.client.split(',').map(s=>s.trim()).filter(Boolean).forEach(c=>{clientMap[c]=(clientMap[c]||0)+1;});});
  const topClients=Object.entries(clientMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const impMap={high:0,medium:0,low:0};scope.forEach(p=>impMap[p.importance]=(impMap[p.importance]||0)+1);
  const total=scope.length,done=byStatus.done||0,cr=total?Math.round((done/total)*100):0;
  container.innerHTML=`<div class="dashboard">
    <div class="dash-row">
      <div class="dash-card dash-wide">
        <div class="dash-title"><i class="ti ti-chart-bar"></i> Par statut</div>
        <div class="dash-status-grid">${Object.entries(STATUS_LABELS).map(([k,v])=>`<div class="dash-stat-pill"><span class="status-badge ${STATUS_CLASS[k]}">${v}</span><span class="dash-stat-num">${byStatus[k]||0}</span></div>`).join('')}</div>
        <div class="dash-progress-row"><span style="font-size:var(--fs-xxxs);color:var(--text-tertiary)">Completion</span><div style="flex:1;margin:0 10px">${pb(cr,'done')}</div><strong style="font-size:var(--fs-xs);color:var(--s-done-fg)">${cr}%</strong></div>
      </div>
      <div class="dash-card">
        <div class="dash-title"><i class="ti ti-alert-triangle"></i> Alertes</div>
        ${overdue.length===0&&dueSoon.length===0?`<div class="dash-empty">✓ Aucune deadline critique</div>`:`${overdue.map(p=>`<div class="dash-alert over"><span class="dash-alert-num">${esc(p.number)}</span><span class="dash-alert-name">${esc(p.name)}</span><span class="dash-alert-dl">☠ ${toEU(p.deadline)}</span></div>`).join('')}${dueSoon.map(p=>`<div class="dash-alert warn"><span class="dash-alert-num">${p.number}</span><span class="dash-alert-name">${p.name}</span><span class="dash-alert-dl">⚠ ${toEU(p.deadline)}</span></div>`).join('')}`}
      </div>
    </div>
    <div class="dash-row">
      <div class="dash-card dash-sm"><div class="dash-title"><i class="ti ti-trending-up"></i> Avancement</div><div class="dash-big-num">${avgProg}<span style="font-size:1rem;font-weight:400;color:var(--text-tertiary)">%</span></div><div style="font-size:var(--fs-xxxs);color:var(--text-tertiary);margin-top:4px">${active.length} projet${active.length>1?'s':''} actif${active.length>1?'s':''}</div>${pb(avgProg,'ongoing')}</div>
      <div class="dash-card dash-sm"><div class="dash-title"><i class="ti ti-flag"></i> Importance</div>${[['high','var(--imp-high)'],['medium','var(--imp-med)'],['low','var(--imp-low)']].map(([k,c])=>`<div class="dash-imp-row"><span style="background:${c};width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0"></span><span style="font-size:var(--fs-xs);flex:1">${IMP_LBL[k]}</span><div style="width:70px;height:5px;background:var(--bg-hover);border-radius:3px;overflow:hidden"><div style="width:${total?Math.round((impMap[k]/total)*100):0}%;height:100%;background:${c};border-radius:3px"></div></div><strong style="font-size:var(--fs-xs);min-width:18px;text-align:right">${impMap[k]}</strong></div>`).join('')}</div>
      <div class="dash-card"><div class="dash-title"><i class="ti ti-users"></i> Top clients</div>${topClients.length===0?`<div class="dash-empty">Aucun client</div>`:topClients.map(([c,n])=>`<div class="dash-client-row"><i class="ti ti-user" style="color:var(--text-tertiary)"></i><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c}</span><span class="dash-badge">${n}</span></div>`).join('')}</div>
      <div class="dash-card dash-sm"><div class="dash-title"><i class="ti ti-list-check"></i> Résumé</div><div class="dash-summary-row"><span>Total</span><strong>${total}</strong></div><div class="dash-summary-row"><span>Terminés</span><strong style="color:var(--s-done-fg)">${done}</strong></div><div class="dash-summary-row"><span>En retard</span><strong style="color:var(--dl-over)">${overdue.length}</strong></div><div class="dash-summary-row"><span>Deadline proche</span><strong style="color:var(--dl-warn)">${dueSoon.length}</strong></div><div class="dash-summary-row"><span>Archivés</span><strong style="color:var(--text-tertiary)">${projects.filter(p=>p.cat===selectedCat&&p.year===selectedYear&&p.archived).length}</strong></div></div>
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════════
   AUTH
   ══════════════════════════════════════════════════════════ */

/* ── Reset password ── */
function openResetScreen(){
  const box=g('login-box');if(!box)return;
  box.innerHTML=`
    <div class="login-logo"><div class="logo-icon">✦</div><div><div style="font-size:1.1rem;font-weight:600;color:var(--text-primary)">La fabrique</div><div style="font-size:.7rem;color:var(--text-tertiary);letter-spacing:.05em;text-transform:uppercase">Réinitialisation</div></div></div>
    <div id="reset-info" style="font-size:var(--fs-xxs);color:var(--text-secondary);margin-bottom:12px;line-height:1.5">Saisis ton adresse email pour recevoir un lien de réinitialisation.</div>
    <div id="login-error" class="login-error" style="display:none"></div>
    <div class="fg"><label>Email</label><input type="email" id="reset-email" placeholder="vous@exemple.com" autocomplete="email"/></div>
    <button id="btn-send-reset" class="btn-primary" style="width:100%;margin-top:4px">Envoyer le lien</button>
    <div style="text-align:center;margin-top:10px"><a href="#" id="back-to-login" style="font-size:var(--fs-xxs);color:var(--text-tertiary)">← Retour à la connexion</a></div>
  `;
  document.getElementById('btn-send-reset')?.addEventListener('click',sendResetEmail);
  document.getElementById('reset-email')?.addEventListener('keydown',e=>{if(e.key==='Enter')sendResetEmail();});
  document.getElementById('back-to-login')?.addEventListener('click',e=>{e.preventDefault();renderLoginScreen();});
  document.getElementById('reset-email')?.focus();
}

async function sendResetEmail(){
  const email=document.getElementById('reset-email')?.value.trim();
  const errEl=document.getElementById('login-error');
  if(!email){if(errEl){errEl.textContent='Saisis ton adresse email.';errEl.style.display='block';}return;}
  const btn=document.getElementById('btn-send-reset');
  if(btn){btn.disabled=true;btn.textContent='Envoi…';}
  const{error}=await db.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+'?reset=1'});
  if(btn){btn.disabled=false;btn.textContent='Envoyer le lien';}
  if(error){if(errEl){errEl.textContent=error.message;errEl.style.display='block';}}
  else{
    const box=g('login-box');if(box)box.innerHTML=`
      <div class="login-logo"><div class="logo-icon">✦</div></div>
      <div style="text-align:center;padding:12px 0">
        <div style="font-size:1.5rem;margin-bottom:8px">✉️</div>
        <div style="font-weight:600;margin-bottom:6px">Email envoyé !</div>
        <div style="font-size:var(--fs-xxs);color:var(--text-secondary);line-height:1.5">Consulte ta boîte mail et clique sur le lien pour définir un nouveau mot de passe.</div>
        <a href="#" id="back-to-login2" style="display:inline-block;margin-top:14px;font-size:var(--fs-xxs);color:var(--text-tertiary)">← Retour à la connexion</a>
      </div>
    `;
    document.getElementById('back-to-login2')?.addEventListener('click',e=>{e.preventDefault();renderLoginScreen();});
  }
}

function openNewPasswordScreen(){
  const box=g('login-box');if(!box)return;
  box.innerHTML=`
    <div class="login-logo"><div class="logo-icon">✦</div><div><div style="font-size:1.1rem;font-weight:600;color:var(--text-primary)">La fabrique</div><div style="font-size:.7rem;color:var(--text-tertiary);letter-spacing:.05em;text-transform:uppercase">Nouveau mot de passe</div></div></div>
    <div id="login-error" class="login-error" style="display:none"></div>
    <div class="fg"><label>Nouveau mot de passe</label><input type="password" id="new-password" placeholder="8 caractères minimum" autocomplete="new-password"/></div>
    <div class="fg"><label>Confirmer</label><input type="password" id="new-password2" placeholder="Répète le mot de passe" autocomplete="new-password"/></div>
    <button id="btn-update-pwd" class="btn-primary" style="width:100%;margin-top:4px">Enregistrer</button>
  `;
  document.getElementById('btn-update-pwd')?.addEventListener('click',updatePassword);
  document.getElementById('new-password2')?.addEventListener('keydown',e=>{if(e.key==='Enter')updatePassword();});
  document.getElementById('new-password')?.focus();
}

async function updatePassword(){
  const p1=document.getElementById('new-password')?.value;
  const p2=document.getElementById('new-password2')?.value;
  const errEl=document.getElementById('login-error');
  if(!p1||p1.length<8){if(errEl){errEl.textContent='Mot de passe trop court (8 caractères minimum).';errEl.style.display='block';}return;}
  if(p1!==p2){if(errEl){errEl.textContent='Les mots de passe ne correspondent pas.';errEl.style.display='block';}return;}
  const btn=document.getElementById('btn-update-pwd');
  if(btn){btn.disabled=true;btn.textContent='Enregistrement…';}
  const{error}=await db.auth.updateUser({password:p1});
  if(btn){btn.disabled=false;btn.textContent='Enregistrer';}
  if(error){if(errEl){errEl.textContent=error.message;errEl.style.display='block';}}
  else{
    // Clean URL then redirect to app
    window.history.replaceState(null,'',window.location.pathname);
    await checkAuth();
  }
}

function renderLoginScreen(){
  document.body.innerHTML=`
    <div id="login-screen">
      <div id="login-box">
        <div class="login-logo"><div class="logo-icon">✦</div><div><div style="font-size:1.1rem;font-weight:600;color:var(--text-primary)">La fabrique</div><div style="font-size:.7rem;color:var(--text-tertiary);letter-spacing:.05em;text-transform:uppercase">gestion de projets</div></div></div>
        <div id="login-error" class="login-error" style="display:none"></div>
        <div class="fg"><label>Email</label><input type="email" id="auth-email" placeholder="vous@exemple.com" autocomplete="email"/></div>
        <div class="fg"><label>Mot de passe</label><input type="password" id="auth-password" placeholder="••••••••" autocomplete="current-password"/></div>
        <button id="auth-btn" class="btn-primary" style="width:100%;justify-content:center;height:38px;font-size:var(--fs-sm);margin-top:4px">Se connecter</button>
        <div style="text-align:center;margin-top:8px"><a href="#" id="btn-forgot-pwd" style="font-size:var(--fs-xxs);color:var(--text-tertiary)">Mot de passe oublié ?</a></div>
        <p id="auth-switch" style="text-align:center;font-size:var(--fs-xxs);color:var(--text-tertiary);margin-top:10px;cursor:pointer">Pas encore de compte ? <span style="color:var(--accent);font-weight:500">Créer un compte</span></p>
        <p id="forgot-pw"   style="text-align:center;font-size:var(--fs-xxxs);color:var(--text-tertiary);margin-top:6px;cursor:pointer">Mot de passe oublié ?</p>
      </div>
    </div>`;
  let isSignUp=false;
  g('auth-switch').addEventListener('click',()=>{isSignUp=!isSignUp;g('auth-btn').textContent=isSignUp?'Créer le compte':'Se connecter';g('auth-switch').innerHTML=isSignUp?`Déjà un compte ? <span style="color:var(--accent);font-weight:500">Se connecter</span>`:`Pas encore de compte ? <span style="color:var(--accent);font-weight:500">Créer un compte</span>`;});
  g('forgot-pw').addEventListener('click',async()=>{const email=g('auth-email').value.trim(),errBox=g('login-error');if(!email){errBox.textContent='Entrez votre email ci-dessus.';errBox.style.display='block';return;}const{error}=await db.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});errBox.style.cssText='display:block;background:var(--s-done-bg);color:var(--s-done-fg);border-radius:8px;padding:8px 10px;font-size:var(--fs-xxs);margin-bottom:10px';errBox.textContent=error?error.message:'Email de réinitialisation envoyé.';});
  const doAuth=async()=>{
    const email=g('auth-email').value.trim(),password=g('auth-password').value,errBox=g('login-error');errBox.style.display='none';
    if(!email||!password){errBox.textContent='Merci de remplir tous les champs.';errBox.style.display='block';return;}
    g('auth-btn').disabled=true;g('auth-btn').textContent='Chargement…';
    const{data,error}=isSignUp?await db.auth.signUp({email,password}):await db.auth.signInWithPassword({email,password});
    if(error){errBox.textContent=error.message;errBox.style.display='block';g('auth-btn').disabled=false;g('auth-btn').textContent=isSignUp?'Créer le compte':'Se connecter';return;}
    if(isSignUp&&!data.session){errBox.style.cssText='display:block;background:var(--s-done-bg);color:var(--s-done-fg);border-radius:8px;padding:8px 10px;font-size:var(--fs-xxs);margin-bottom:10px';errBox.textContent='Compte créé ! Vérifiez votre email.';g('auth-btn').disabled=false;g('auth-btn').textContent='Se connecter';isSignUp=false;return;}
    location.reload();
  };
  g('auth-btn').addEventListener('click',doAuth);
  [g('auth-email'),g('auth-password')].forEach(i=>i.addEventListener('keydown',e=>{if(e.key==='Enter')doAuth();}));
}

/* ── Auth state listener ── */
function initAuthListener(){
  db.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'){
      renderLoginScreen();
      openNewPasswordScreen();
    } else if(event==='SIGNED_OUT'||(event==='TOKEN_REFRESHED'&&!session)){
      currentUser=null;projects=[];
      toast('Session expirée, reconnectez-vous','error');
      setTimeout(()=>renderLoginScreen(),1500);
    } else if(event==='TOKEN_REFRESHED'&&session){
      currentUser=session.user;
    }
  });
}

async function checkAuth(){
  // Intercept password reset token from URL hash
  const hash=window.location.hash;
  if(hash&&hash.includes('access_token')&&hash.includes('type=recovery')){
    renderLoginScreen();
    openNewPasswordScreen();
    // Let Supabase handle the session from the hash
    await db.auth.getSession();
    return;
  }
  const{data:{session}}=await db.auth.getSession();
  if(session?.user){currentUser=session.user;loadOrder();applyPrefs();fetchProjects();const logout=g('btn-logout');if(logout)logout.title=currentUser.email;}
  else renderLoginScreen();
}

/* ══════════════════════════════════════════════════════════
   INJECTED CSS
   ══════════════════════════════════════════════════════════ */
document.head.insertAdjacentHTML('beforeend',`<style>
  @keyframes spin    {to{transform:rotate(360deg)}}
  @keyframes slideIn {from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}
  @keyframes fadeIn  {from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
  #login-screen{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg)}
  #login-box{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:28px 24px;width:340px;box-shadow:var(--shadow-md)}
  .login-logo{display:flex;align-items:center;gap:10px;margin-bottom:20px}
  .login-error{background:var(--s-sent-bg);color:var(--s-sent-fg);border-radius:var(--radius-md);padding:8px 10px;font-size:var(--fs-xxs);margin-bottom:10px}
  .prog-wrap{display:flex;align-items:center;gap:4px}
  .prog-bar{flex:1;background:var(--bg-hover);border-radius:4px;overflow:hidden}
  .prog-fill{height:100%;border-radius:4px;transition:width .35s}
  .prog-pct{font-size:var(--fs-xxxs);color:var(--text-secondary);min-width:26px;text-align:right;font-family:var(--font-mono)}
</style>`);

/* ══════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded',()=>{

  g('btn-new')?.addEventListener('click',openNewProject);
  g('btn-cancel')?.addEventListener('click',closeModal);
  g('btn-save')?.addEventListener('click',handleSave);
  g('modal-overlay')?.addEventListener('click',e=>{if(e.target===g('modal-overlay'))closeModal();});
  g('note-btn-cancel')?.addEventListener('click',closeNoteModal);
  g('confirm-cancel')?.addEventListener('click',e=>{e.stopPropagation();closeConfirm();});
  g('confirm-ok')?.addEventListener('click',async e=>{e.stopPropagation();const cb=_confirmCb;closeConfirm();if(cb)await cb();});
  g('confirm-overlay')?.addEventListener('click',e=>{if(e.target===g('confirm-overlay'))closeConfirm();});
  g('year-modal-overlay')?.addEventListener('click',e=>{if(e.target===g('year-modal-overlay'))closeYearModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&g('confirm-overlay')?.classList.contains('open'))closeConfirm();});
  g('note-btn-save')?.addEventListener('click',()=>{if(_noteCb)_noteCb();});
  g('note-overlay')?.addEventListener('click',e=>{if(e.target===g('note-overlay'))closeNoteModal();});
  g('note-modal-text')?.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();if(_noteCb)_noteCb();}});

  g('f-status-m')?.addEventListener('change',function(){sliderManual=false;syncSlider(this.value);});
  g('f-progress')?.addEventListener('input',function(){
    sliderManual=true;const pct=parseInt(this.value)||0;
    g('f-progress-val').textContent=pct+'%';
    this.style.accentColor=pct>=100?'#639922':'var(--accent)';
    const statusEl=g('f-status-m');
    if(pct===100&&statusEl&&statusEl.value!=='done'){statusEl.value='done';g('prog-hint').textContent='Statut passé à "Done" ✓';}
    else if(pct<100&&statusEl&&statusEl.value==='done'&&sliderManual){statusEl.value='ongoing';syncSlider('ongoing');}
    else g('prog-hint').textContent='Valeur personnalisée';
  });

  g('search')?.addEventListener('input',()=>{renderView();updateClearBtn();localStorage.setItem('lf-filter-search',g('search').value);});
  g('filter-status')?.addEventListener('change',()=>{renderView();updateClearBtn();localStorage.setItem('lf-filter-status',g('filter-status').value);});
  g('filter-imp')?.addEventListener('change',()=>{renderView();updateClearBtn();localStorage.setItem('lf-filter-imp',g('filter-imp').value);});
  g('sort-by')?.addEventListener('change',()=>{renderView();localStorage.setItem('lf-sort',g('sort-by').value);});
  g('filter-editor')?.addEventListener('change',()=>{renderView();updateClearBtn();localStorage.setItem('lf-filter-editor',g('filter-editor').value);});
  g('btn-clear-filters')?.addEventListener('click',clearFilters);

  /* ── Filter drawer (mobile) ── */
  function syncDrawerSelects(){
    // Populate mobile selects with same options as desktop selects
    ['status','imp','editor'].forEach(k=>{
      const src=g('filter-'+k),dst=g('filter-'+k+'-m');
      if(!src||!dst)return;
      dst.innerHTML=src.innerHTML;
      dst.value=src.value;
    });
    const sb=g('sort-by'),sbm=g('sort-by-m');
    if(sb&&sbm){sbm.innerHTML=sb.innerHTML;sbm.value=sb.value;}
  }
  function openFilterDrawer(){
    syncDrawerSelects();
    g('filter-drawer')?.classList.add('open');
    g('filter-drawer-overlay')?.classList.add('open');
    g('btn-filter-mobile')?.classList.add('filter-active');
  }
  function closeFilterDrawer(){
    g('filter-drawer')?.classList.remove('open');
    g('filter-drawer-overlay')?.classList.remove('open');
    g('btn-filter-mobile')?.classList.remove('filter-active');
  }
  function applyDrawerFilters(){
    ['status','imp','editor'].forEach(k=>{
      const src=g('filter-'+k+'-m'),dst=g('filter-'+k);
      if(src&&dst)dst.value=src.value;
    });
    const sbm=g('sort-by-m'),sb=g('sort-by');
    if(sbm&&sb)sb.value=sbm.value;
    // update filter-active badge
    const hasFilter=g('filter-status')?.value||g('filter-imp')?.value||g('filter-editor')?.value;
    g('btn-filter-mobile')?.classList.toggle('filter-active',!!hasFilter);
    renderView();
    closeFilterDrawer();
  }
  g('btn-filter-mobile')?.addEventListener('click',openFilterDrawer);
  g('filter-drawer-overlay')?.addEventListener('click',()=>{applyDrawerFilters();});
  g('filter-drawer-reset')?.addEventListener('click',()=>{
    ['filter-status-m','filter-imp-m','filter-editor-m'].forEach(id=>{const el=g(id);if(el)el.value='';});
    applyDrawerFilters();
  });
  ['filter-status-m','filter-imp-m','filter-editor-m','sort-by-m'].forEach(id=>{
    g(id)?.addEventListener('change',applyDrawerFilters);
  });

  g('btn-dashboard')?.addEventListener('click',()=>{showDashboard=!showDashboard;g('btn-dashboard')?.classList.toggle('active',showDashboard);renderView();});
  g('btn-export')?.addEventListener('click',exportCSV);
  g('toggle-archived')?.addEventListener('click',()=>{showArchived=!showArchived;renderSidebar();renderView();});

  g('btn-settings')?.addEventListener('click',openSettings);
  g('btn-settings-hdr')?.addEventListener('click',openSettings);
  g('btn-settings-close')?.addEventListener('click',closeSettings);
  g('settings-overlay')?.addEventListener('click',e=>{if(e.target===g('settings-overlay'))closeSettings();});
  g('toggle-theme')?.addEventListener('click',function(){const isDark=this.getAttribute('aria-checked')==='true';const t=isDark?'light':'dark';document.documentElement.setAttribute('data-theme',t);this.setAttribute('aria-checked',!isDark?'true':'false');savePrefs({theme:t});});
  document.querySelectorAll('.fs-btn').forEach(btn=>btn.addEventListener('click',()=>{const s=btn.dataset.size;document.documentElement.setAttribute('data-font-size',s);document.querySelectorAll('.fs-btn').forEach(b=>b.classList.toggle('active',b.dataset.size===s));savePrefs({fontSize:s});}));
  document.querySelectorAll('.accent-swatch').forEach(btn=>btn.addEventListener('click',()=>{const a=btn.dataset.accent;document.documentElement.setAttribute('data-accent',a);document.querySelectorAll('.accent-swatch').forEach(b=>b.classList.toggle('active',b.dataset.accent===a));savePrefs({accent:a});}));
  g('btn-logout-settings')?.addEventListener('click',async()=>{closeSettings();await db.auth.signOut();currentUser=null;renderLoginScreen();});
  g('btn-logout')?.addEventListener('click',async()=>{await db.auth.signOut();currentUser=null;renderLoginScreen();});
  g('btn-reconnect')?.addEventListener('click',()=>{if(currentUser){setDbStatus('connecting','Reconnexion…');fetchProjects();}});

  // Mobile
  function openSidebar(){g('sidebar')?.classList.add('open');g('sidebar-overlay')?.classList.add('open');}
  function closeSidebar(){g('sidebar')?.classList.remove('open');g('sidebar-overlay')?.classList.remove('open');}
  g('btn-menu')?.addEventListener('click',openSidebar);
  g('btn-new-mobile')?.addEventListener('click',openNewProject);
  g('sidebar-overlay')?.addEventListener('click',closeSidebar);
  document.addEventListener('click',e=>{if(e.target.closest('.year-item')&&window.innerWidth<=640)setTimeout(closeSidebar,120);});
  document.querySelectorAll('.bnav-item').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const{view,cat}=btn.dataset;
      document.querySelectorAll('.bnav-item').forEach(b=>b.classList.remove('active'));
      if(view==='new'){openNewProject();document.querySelector(`.bnav-item[data-cat="${selectedCat}"]`)?.classList.add('active');return;}
      if(view==='settings'){openSettings();return;}
      btn.classList.add('active');
      if(view==='stats'){showDashboard=true;renderView();return;}
      if(cat){showDashboard=false;selectedCat=cat;const years=[...new Set(projects.filter(p=>p.cat===cat).map(p=>p.year))].sort((a,b)=>b-a);if(years.length)selectedYear=years[0];renderSidebar();renderView();}
    });
  });

  // Sidebar resize
  const resizer=g('sidebar-resizer'),sidebar=g('sidebar');let isResizing=false,startX=0,startW=0;
  resizer?.addEventListener('mousedown',e=>{if(window.innerWidth<=640)return;isResizing=true;startX=e.clientX;startW=sidebar.offsetWidth;resizer.classList.add('dragging');document.body.style.cursor='col-resize';document.body.style.userSelect='none';});
  document.addEventListener('mousemove',e=>{if(!isResizing)return;const newW=Math.min(300,Math.max(120,startW+(e.clientX-startX)));sidebar.style.width=newW+'px';});
  document.addEventListener('mouseup',()=>{if(!isResizing)return;isResizing=false;resizer?.classList.remove('dragging');document.body.style.cursor='';document.body.style.userSelect='';savePrefs({sidebarW:sidebar.offsetWidth});});

  // Date masks supprimés — champs type="date" natifs

  // Autocomplete
  setupAC('f-editor','editor-suggest',()=>getUniqueList('editor'));
  setupAC('f-client','client-suggest',()=>getUniqueList('client'),{append:true});

  // Keyboard
  document.addEventListener('keydown',e=>{
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT')return;
    if(e.key==='n'||e.key==='N'){e.preventDefault();openNewProject();}
    if(e.key==='d'||e.key==='D'){showDashboard=!showDashboard;g('btn-dashboard')?.classList.toggle('active',showDashboard);renderView();}
    if(e.key==='p'||e.key==='P')openSettings();
    if(e.key==='e'||e.key==='E')exportCSV();
    if(e.key==='Escape'){closeModal();closeSettings();closeInlineStatus();closeCtxMenu();}
  });

  initAuthListener();
  checkAuth();
});
