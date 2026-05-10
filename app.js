/* ============================================================
   LA FABRIQUE — app.js  v5
   - Fix UUID sous-projets
   - Mot de passe oublié
   - Export CSV
   - Dashboard / Stats
   - Variables d'environnement Vercel
   ============================================================ */

/* ---- Config via env vars (set in Vercel dashboard) ----
   En local : remplace directement les valeurs ci-dessous.
   En prod   : Vercel injecte __env via _headers ou une route.
   -------------------------------------------------------- */
const SUPABASE_URL      = (window.__env && window.__env.SUPABASE_URL)      || 'https://mrivfwlxnmtgkifjucvd.supabase.co';
const SUPABASE_ANON_KEY = (window.__env && window.__env.SUPABASE_ANON_KEY) || 'REMPLACE_PAR_TA_CLE_ANON';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ============================================================
   CONSTANTS
   ============================================================ */
const STATUS_LABELS = {
  ready:'Ready to start', ongoing:'Ongoing', review:'In review',
  sent:'Sent to client',  done:'Done',       hold:'On hold',
};
const STATUS_CLASS = {
  ready:'s-ready', ongoing:'s-ongoing', review:'s-review',
  sent:'s-sent',   done:'s-done',       hold:'s-hold',
};
const PROGRESS_COLOR = {
  ready:'#B4B2A9', ongoing:'#378ADD', review:'#EF9F27',
  sent:'#D4537E',  done:'#639922',    hold:'#888780',
};
const STATUS_COLORS_BG = {
  ready:'#F1EFE8', ongoing:'#E6F1FB', review:'#FAEEDA',
  sent:'#FBEAF0',  done:'#EAF3DE',   hold:'#F1EFE8',
};
const AUTO_PROG = { ready:0, ongoing:40, review:70, sent:80, done:100, hold:null };
const IMP_DOT   = { low:'imp-low', medium:'imp-med', high:'imp-high' };
const IMP_LBL   = { low:'Low',     medium:'Medium',  high:'High'    };

/* ============================================================
   STATE
   ============================================================ */
let projects           = [];
let selectedYear       = new Date().getFullYear();
let selectedCat        = 'pro';
let showArchived       = false;
let showDashboard      = false;
let expandedIds        = new Set();
let sliderManual       = false;
let currentUser        = null;
let manualOrder        = {};
let dragSrcId          = null;
let editingId          = null;
let editingSubParentId = null;
let addingNoteTo       = null;

/* ============================================================
   PURE HELPERS
   ============================================================ */
function toEuropean(s) {
  if (!s) return '—';
  const [y,m,d] = s.split('-');
  return `${d}/${m}/${y}`;
}
function todayISO() { return new Date().toISOString().split('T')[0]; }
function deadlineStatus(dl) {
  if (!dl) return '';
  const diff = Math.ceil((new Date(dl) - new Date()) / 86_400_000);
  return diff < 0 ? 'over' : diff <= 7 ? 'warn' : '';
}
function pb(pct, status, h='5px') {
  const c = PROGRESS_COLOR[status]||'#888';
  return `<div class="prog-wrap"><div class="prog-bar" style="height:${h}"><div class="prog-fill" style="width:${pct}%;background:${c}"></div></div><span class="prog-pct">${pct}%</span></div>`;
}
function orderKey() { return `${selectedCat}_${selectedYear}`; }
function getOrderedList(list) {
  const order = manualOrder[orderKey()];
  if (!order) return list;
  return [...order.map(id=>list.find(p=>p.id===id)).filter(Boolean),
          ...list.filter(p=>!order.includes(p.id))];
}
function saveOrder(list) {
  manualOrder[orderKey()] = list.map(p=>p.id);
  try { localStorage.setItem('lf_order', JSON.stringify(manualOrder)); } catch(_) {}
}
function loadOrder() {
  try { const r=localStorage.getItem('lf_order'); if(r) manualOrder=JSON.parse(r); } catch(_) {}
}
function getUniqueList(field) {
  return [...new Set(projects.map(p=>p[field]).filter(Boolean))];
}

/* ============================================================
   DOM HELPERS
   ============================================================ */
function g(id)   { return document.getElementById(id); }
function gv(id)  { return g(id).value.trim(); }
function sv(id,v){ g(id).value = v ?? ''; }

/* ============================================================
   DB STATUS
   ============================================================ */
function setDbStatus(state, text) {
  const badge = g('db-status'), sync = g('db-last-sync');
  if (!badge) return;
  badge.className = `db-status ${state}`;
  const icon = state==='ok'?'ti-database-check':state==='error'?'ti-database-x':'ti-loader-2';
  badge.innerHTML = `<i class="ti ${icon}"></i><span>${text}</span>`;
  if (state==='ok' && sync) {
    const n=new Date();
    sync.textContent=`Sync ${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
  } else if (sync) sync.textContent='';
}

/* ============================================================
   TOAST
   ============================================================ */
function toast(msg, type='success') {
  let c=g('toast-container');
  if (!c) {
    c=document.createElement('div'); c.id='toast-container';
    c.style.cssText='position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:6px;pointer-events:none;';
    document.body.appendChild(c);
  }
  const bg=type==='success'?'#EAF3DE':type==='error'?'#FBEAF0':'#E6F1FB';
  const fg=type==='success'?'#3B6D11':type==='error'?'#993356':'#185FA5';
  const ic=type==='success'?'ti-circle-check':type==='error'?'ti-circle-x':'ti-info-circle';
  const t=document.createElement('div');
  t.style.cssText=`display:flex;align-items:center;gap:7px;padding:9px 14px;border-radius:8px;background:${bg};color:${fg};font-size:0.75rem;font-weight:500;box-shadow:0 2px 8px rgba(0,0,0,.12);animation:slideIn .2s ease;pointer-events:all;`;
  t.innerHTML=`<i class="ti ${ic}" style="font-size:0.9rem"></i>${msg}`;
  c.appendChild(t);
  setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity .3s';setTimeout(()=>t.remove(),300);},2800);
}

/* ============================================================
   EXPORT CSV
   ============================================================ */
function exportCSV() {
  const list = getFiltered();
  const headers = ['Numéro','Nom','Catégorie','Statut','Progression','Importance','Éditeur','Client','Date début','Deadline','Terminé le','Mis à jour'];
  const rows = list.map(p => [
    p.number, p.name, p.cat, STATUS_LABELS[p.status]||p.status,
    p.progress+'%', IMP_LBL[p.importance]||p.importance,
    p.editor||'', p.client||'',
    toEuropean(p.date), toEuropean(p.deadline), toEuropean(p.ended), toEuropean(p.updatedAt)
  ]);
  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=`lafabrique_${selectedCat}_${selectedYear}_${todayISO()}.csv`;
  a.click(); URL.revokeObjectURL(url);
  toast('Export CSV téléchargé ✓');
}

/* ============================================================
   DASHBOARD / STATS
   ============================================================ */
function renderDashboard() {
  const container = g('project-list');
  const scope = projects.filter(p=>p.cat===selectedCat&&p.year===selectedYear&&!p.archived);

  // Per-status counts
  const byStatus = {};
  Object.keys(STATUS_LABELS).forEach(k=>byStatus[k]=0);
  scope.forEach(p=>{ if(byStatus[p.status]!==undefined) byStatus[p.status]++; });

  // Overdue
  const overdue = scope.filter(p=>p.deadline&&deadlineStatus(p.deadline)==='over'&&p.status!=='done');
  const dueSoon = scope.filter(p=>p.deadline&&deadlineStatus(p.deadline)==='warn'&&p.status!=='done');

  // Avg progress (non-done)
  const active = scope.filter(p=>p.status!=='done'&&p.status!=='hold');
  const avgProg = active.length ? Math.round(active.reduce((a,p)=>a+p.progress,0)/active.length) : 0;

  // By client (top 5)
  const clientMap = {};
  scope.forEach(p=>{ if(p.client){clientMap[p.client]=(clientMap[p.client]||0)+1;} });
  const topClients = Object.entries(clientMap).sort((a,b)=>b[1]-a[1]).slice(0,5);

  // By importance
  const impMap = {high:0,medium:0,low:0};
  scope.forEach(p=>impMap[p.importance]=(impMap[p.importance]||0)+1);

  const total = scope.length;
  const done  = byStatus.done||0;
  const completionRate = total ? Math.round((done/total)*100) : 0;

  container.innerHTML = `
    <div class="dashboard">
      <div class="dash-row">

        <!-- Status breakdown -->
        <div class="dash-card dash-wide">
          <div class="dash-title"><i class="ti ti-chart-bar"></i> Projets par statut</div>
          <div class="dash-status-grid">
            ${Object.entries(STATUS_LABELS).map(([k,v])=>`
              <div class="dash-stat-pill">
                <span class="status-badge ${STATUS_CLASS[k]}">${v}</span>
                <span class="dash-stat-num">${byStatus[k]||0}</span>
              </div>`).join('')}
          </div>
          <div class="dash-progress-row">
            <span style="font-size:0.75rem;color:var(--text-tertiary)">Taux de completion</span>
            <div style="flex:1;margin:0 10px">${pb(completionRate,'done','8px')}</div>
            <span style="font-size:0.75rem;font-weight:600;color:var(--s-done-fg)">${completionRate}%</span>
          </div>
        </div>

        <!-- Alerts -->
        <div class="dash-card">
          <div class="dash-title"><i class="ti ti-alert-triangle"></i> Alertes</div>
          ${overdue.length===0&&dueSoon.length===0
            ? `<div class="dash-empty">✓ Aucune deadline critique</div>`
            : `${overdue.map(p=>`
                <div class="dash-alert over">
                  <span class="dash-alert-num">${p.number}</span>
                  <span class="dash-alert-name">${p.name}</span>
                  <span class="dash-alert-dl">☠ ${toEuropean(p.deadline)}</span>
                </div>`).join('')}
               ${dueSoon.map(p=>`
                <div class="dash-alert warn">
                  <span class="dash-alert-num">${p.number}</span>
                  <span class="dash-alert-name">${p.name}</span>
                  <span class="dash-alert-dl">⚠ ${toEuropean(p.deadline)}</span>
                </div>`).join('')}`
          }
        </div>
      </div>

      <div class="dash-row">
        <!-- Avg progress -->
        <div class="dash-card dash-sm">
          <div class="dash-title"><i class="ti ti-trending-up"></i> Avancement moyen</div>
          <div class="dash-big-num">${avgProg}<span style="font-size:1rem;font-weight:400;color:var(--text-tertiary)">%</span></div>
          <div style="font-size:0.7rem;color:var(--text-tertiary);margin-top:4px">sur ${active.length} projet${active.length>1?'s':''} actif${active.length>1?'s':''}</div>
          ${pb(avgProg,'ongoing','10px')}
        </div>

        <!-- Importance breakdown -->
        <div class="dash-card dash-sm">
          <div class="dash-title"><i class="ti ti-flag"></i> Importance</div>
          ${[['high','#E24B4A'],['medium','#EF9F27'],['low','#639922']].map(([k,c])=>`
            <div class="dash-imp-row">
              <span class="imp-dot" style="background:${c};width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0"></span>
              <span style="font-size:0.78rem;flex:1">${IMP_LBL[k]}</span>
              <div style="width:80px;height:5px;background:var(--bg-hover);border-radius:3px;overflow:hidden">
                <div style="width:${total?Math.round((impMap[k]/total)*100):0}%;height:100%;background:${c};border-radius:3px"></div>
              </div>
              <span style="font-size:0.75rem;font-weight:600;min-width:20px;text-align:right">${impMap[k]}</span>
            </div>`).join('')}
        </div>

        <!-- Top clients -->
        <div class="dash-card">
          <div class="dash-title"><i class="ti ti-users"></i> Top clients</div>
          ${topClients.length===0
            ? `<div class="dash-empty">Aucun client renseigné</div>`
            : topClients.map(([client,count])=>`
                <div class="dash-client-row">
                  <i class="ti ti-user" style="font-size:0.75rem;color:var(--text-tertiary)"></i>
                  <span style="font-size:0.78rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${client}</span>
                  <span class="dash-badge">${count}</span>
                </div>`).join('')}
        </div>

        <!-- Summary -->
        <div class="dash-card dash-sm">
          <div class="dash-title"><i class="ti ti-list-check"></i> Résumé</div>
          <div class="dash-summary-row"><span>Total projets</span><strong>${total}</strong></div>
          <div class="dash-summary-row"><span>Terminés</span><strong style="color:var(--s-done-fg)">${done}</strong></div>
          <div class="dash-summary-row"><span>En retard</span><strong style="color:var(--dl-over)">${overdue.length}</strong></div>
          <div class="dash-summary-row"><span>Deadline proche</span><strong style="color:var(--dl-warn)">${dueSoon.length}</strong></div>
          <div class="dash-summary-row"><span>Archivés</span><strong style="color:var(--text-tertiary)">${projects.filter(p=>p.cat===selectedCat&&p.year===selectedYear&&p.archived).length}</strong></div>
        </div>
      </div>
    </div>`;
}

/* ============================================================
   SUPABASE — READ
   ============================================================ */
async function fetchProjects() {
  setDbStatus('connecting','Connexion…');
  g('project-list').innerHTML=`<div class="loading-state"><i class="ti ti-loader-2" style="animation:spin 1s linear infinite;font-size:1.2rem"></i> Chargement…</div>`;

  const {data:pData,error:pErr}=await db
    .from('projects').select('*')
    .eq('user_id',currentUser.id)
    .order('updated_at',{ascending:false});

  if (pErr) {
    setDbStatus('error','Erreur BDD');
    toast('Impossible de charger les projets','error');
    g('project-list').innerHTML=`<div class="empty-state"><i class="ti ti-database-x"></i><p>${pErr.message}</p></div>`;
    return;
  }

  const ids=(pData||[]).map(p=>p.id);
  const {data:sData}=ids.length?await db.from('subprojects').select('*').in('parent_id',ids):{data:[]};
  const {data:nData}=ids.length?await db.from('notes').select('*').in('project_id',ids).order('created_at',{ascending:true}):{data:[]};

  projects=(pData||[]).map(p=>({
    id:p.id, number:p.number, name:p.name, cat:p.cat||'pro',
    status:p.status||'ready', progress:p.progress||0, importance:p.importance||'medium',
    editor:p.editor||'', client:p.client||'', date:p.date||'',
    deadline:p.deadline||'', ended:p.ended||null, archived:p.archived||false,
    updatedAt:(p.updated_at||'').split('T')[0],
    year:p.year||new Date().getFullYear(),
    subprojects:(sData||[]).filter(s=>s.parent_id===p.id)
      .map(s=>({id:s.id,number:s.number,name:s.name,status:s.status||'ready',progress:s.progress||0})),
    notes:(nData||[]).filter(n=>n.project_id===p.id)
      .map(n=>({id:n.id,date:(n.created_at||'').split('T')[0],text:n.text})),
  }));

  setDbStatus('ok','Connecté');
  renderSidebar();
  renderView();
}

/* ============================================================
   SUPABASE — WRITE
   ============================================================ */
async function saveProject(payload, isNew=false) {
  const row={
    number:payload.number, name:payload.name, cat:payload.cat,
    status:payload.status, progress:payload.progress, importance:payload.importance,
    editor:payload.editor, client:payload.client,
    date:payload.date||null, deadline:payload.deadline||null,
    ended:payload.ended||null, year:payload.year, archived:payload.archived||false,
    updated_at:new Date().toISOString(), user_id:currentUser.id,
  };
  if (isNew) {
    const {data,error}=await db.from('projects').insert(row).select().single();
    if (error){toast('Erreur création','error');return null;}
    return data.id;
  }
  const {error}=await db.from('projects').update(row).eq('id',payload.id);
  if (error){toast('Erreur mise à jour','error');return null;}
  return payload.id;
}

async function saveSubproject(parentId, payload, isNew=false) {
  const row={parent_id:parentId,number:payload.number,name:payload.name,status:payload.status,progress:payload.progress};
  if (isNew) {
    const {data,error}=await db.from('subprojects').insert(row).select().single();
    if (error){toast('Erreur sous-projet','error');return null;}
    return data.id;
  }
  const {error}=await db.from('subprojects').update(row).eq('id',payload.id);
  if (error){toast('Erreur sous-projet','error');return null;}
  return payload.id;
}

async function saveNote(projectId,text) {
  const {error}=await db.from('notes').insert({project_id:projectId,text,created_at:new Date().toISOString()});
  if (error){toast('Erreur note','error');return false;}
  return true;
}

async function deleteProjectFromDb(id) {
  const {error}=await db.from('projects').delete().eq('id',id);
  if (error){toast('Erreur suppression','error');return false;}
  return true;
}

/* ============================================================
   AUTOCOMPLETE
   ============================================================ */
function setupAC(inputId,suggestId,getItems) {
  const input=g(inputId), sug=g(suggestId);
  if (!input||!sug) return;
  input.addEventListener('input',()=>{
    const q=input.value.toLowerCase();
    const matches=getItems().filter(e=>e.toLowerCase().includes(q)&&q.length>0);
    if (matches.length) {
      sug.style.display='block';
      sug.innerHTML=matches.map(e=>`<div class="ac-item" data-val="${e.replace(/"/g,'&quot;')}">${e}</div>`).join('');
      sug.querySelectorAll('.ac-item').forEach(item=>item.addEventListener('mousedown',e=>{e.preventDefault();input.value=item.dataset.val;sug.style.display='none';}));
    } else sug.style.display='none';
  });
  input.addEventListener('blur',()=>setTimeout(()=>sug.style.display='none',150));
}

/* ============================================================
   SIDEBAR
   ============================================================ */
function renderSidebar() {
  ['pro','perso'].forEach(cat=>{
    const container=g('yl-'+cat);
    if (!container) return;
    const years=[...new Set(projects.filter(p=>p.cat===cat).map(p=>p.year))].sort((a,b)=>b-a);
    container.innerHTML=years.map(y=>{
      const count  =projects.filter(p=>p.cat===cat&&p.year===y&&!p.archived).length;
      const overdue=projects.filter(p=>p.cat===cat&&p.year===y&&!p.archived&&p.deadline&&deadlineStatus(p.deadline)==='over'&&p.status!=='done').length;
      const active =selectedCat===cat&&selectedYear===y;
      return `<div class="year-item ${active?'active':''}" data-y="${y}" data-c="${cat}">
        <span>${y}${overdue?` <span class="overdue-badge">☠${overdue}</span>`:''}</span>
        <span class="year-count">${count}</span>
      </div>`;
    }).join('')+`<div class="year-item year-item-add" data-y="new" data-c="${cat}"><i class="ti ti-plus" style="font-size:0.65rem"></i> Année</div>`;

    container.querySelectorAll('.year-item').forEach(item=>{
      item.addEventListener('click',()=>{
        if (item.dataset.y==='new') {
          const y=prompt('Nouvelle année (ex: 2027)');
          if (y&&!isNaN(y)){selectedYear=parseInt(y);selectedCat=cat;renderSidebar();renderView();}
          return;
        }
        selectedYear=parseInt(item.dataset.y); selectedCat=item.dataset.c;
        renderSidebar(); renderView();
      });
    });
  });
  const btn=g('toggle-archived');
  if (btn) btn.textContent=showArchived?'↑ Masquer archivés':'↓ Voir archivés';
  const logout=g('btn-logout');
  if (logout&&currentUser) logout.title=currentUser.email;
}

/* ============================================================
   VIEW ROUTER  (projects list vs dashboard)
   ============================================================ */
function renderView() {
  const dashBtn=g('btn-dashboard');
  if (dashBtn) {
    dashBtn.innerHTML=showDashboard
      ?`<i class="ti ti-list"></i>Projets`
      :`<i class="ti ti-chart-bar"></i>Stats`;
  }
  if (showDashboard) {
    renderDashboard();
  } else {
    renderProjects();
  }
}

/* ============================================================
   INLINE STATUS DROPDOWN
   ============================================================ */
function openInlineStatus(pid,anchorEl) {
  closeInlineStatus();
  const p=projects.find(x=>x.id===pid);
  if (!p) return;
  const dropdown=document.createElement('div');
  dropdown.id='inline-status-dropdown';
  dropdown.className='inline-status-dropdown';
  dropdown.innerHTML=Object.entries(STATUS_LABELS).map(([k,v])=>`
    <div class="isd-item ${p.status===k?'active':''}" data-status="${k}" data-pid="${pid}">
      <span class="status-badge ${STATUS_CLASS[k]}">${v}</span>
      ${p.status===k?'<i class="ti ti-check" style="font-size:0.7rem;margin-left:auto;color:var(--text-tertiary)"></i>':''}
    </div>`).join('');
  document.body.appendChild(dropdown);
  const rect=anchorEl.getBoundingClientRect();
  dropdown.style.top =`${rect.bottom+4+window.scrollY}px`;
  dropdown.style.left=`${Math.min(rect.left+window.scrollX,window.innerWidth-180)}px`;
  dropdown.querySelectorAll('.isd-item').forEach(item=>{
    item.addEventListener('click',async e=>{
      e.stopPropagation();
      const newStatus=item.dataset.status;
      const p=projects.find(x=>x.id===item.dataset.pid);
      if (!p) return;
      const wasNotDone=p.status!=='done';
      p.status=newStatus;
      p.progress=AUTO_PROG[newStatus]!==null?AUTO_PROG[newStatus]:p.progress;
      if (newStatus==='done'&&wasNotDone) p.ended=todayISO();
      if (newStatus!=='done') p.ended=null;
      p.updatedAt=todayISO();
      closeInlineStatus(); renderProjects();
      await saveProject({...p},false);
      toast(`Statut → ${STATUS_LABELS[newStatus]} ✓`);
      renderSidebar();
    });
  });
  setTimeout(()=>document.addEventListener('click',closeInlineStatus,{once:true}),10);
}
function closeInlineStatus(){const d=g('inline-status-dropdown');if(d)d.remove();}

/* ============================================================
   DRAG & DROP
   ============================================================ */
function setupDragDrop(container) {
  container.querySelectorAll('.proj-card[draggable]').forEach(card=>{
    card.addEventListener('dragstart',e=>{dragSrcId=card.dataset.pid;card.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
    card.addEventListener('dragend',  ()=>{card.classList.remove('dragging');container.querySelectorAll('.proj-card').forEach(c=>c.classList.remove('drag-over'));dragSrcId=null;});
    card.addEventListener('dragover', e=>{e.preventDefault();e.dataTransfer.dropEffect='move';if(card.dataset.pid===dragSrcId)return;container.querySelectorAll('.proj-card').forEach(c=>c.classList.remove('drag-over'));card.classList.add('drag-over');});
    card.addEventListener('drop',e=>{e.preventDefault();if(!dragSrcId)return;const tid=card.dataset.pid;if(tid===dragSrcId)return;const list=getFiltered();const si=list.findIndex(p=>p.id===dragSrcId),ti=list.findIndex(p=>p.id===tid);if(si===-1||ti===-1)return;const[m]=list.splice(si,1);list.splice(ti,0,m);saveOrder(list);renderProjects();});
  });
}

/* ============================================================
   FILTERING
   ============================================================ */
function getFiltered() {
  const q   =g('search').value.toLowerCase();
  const st  =g('filter-status').value;
  const imp =g('filter-imp').value;
  const sort=g('sort-by').value;
  let list=projects.filter(p=>p.cat===selectedCat&&p.year===selectedYear&&(showArchived?p.archived:!p.archived));
  if(q)   list=list.filter(p=>p.name.toLowerCase().includes(q)||p.number.toLowerCase().includes(q)||(p.editor&&p.editor.toLowerCase().includes(q))||(p.client&&p.client.toLowerCase().includes(q))||p.notes.some(n=>n.text.toLowerCase().includes(q)));
  if(st)  list=list.filter(p=>p.status===st);
  if(imp) list=list.filter(p=>p.importance===imp);
  if(sort==='manual')   return getOrderedList(list);
  if(sort==='number')   return list.sort((a,b)=>a.number.localeCompare(b.number));
  if(sort==='name')     return list.sort((a,b)=>a.name.localeCompare(b.name));
  if(sort==='progress') return list.sort((a,b)=>b.progress-a.progress);
  if(sort==='deadline') return list.sort((a,b)=>{if(!a.deadline)return 1;if(!b.deadline)return-1;return new Date(a.deadline)-new Date(b.deadline);});
  return list.sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
}

/* ============================================================
   RENDER PROJECT LIST
   ============================================================ */
function renderProjects() {
  const title=g('topbar-title');
  if(title) title.textContent=`${selectedCat==='pro'?'Pro':'Perso'} · ${selectedYear}${showArchived?' · Archives':''}`;
  const list=getFiltered();
  const container=g('project-list');
  if (!container) return;
  const isDraggable=g('sort-by').value==='manual';
  if (!list.length) {
    container.innerHTML=`<div class="empty-state"><i class="ti ti-inbox"></i><p>${showArchived?'Aucun projet archivé':'Aucun projet — appuie sur N pour commencer'}</p></div>`;
    return;
  }
  container.innerHTML=list.map(p=>buildCard(p,isDraggable)).join('');
  attachCardListeners();
  if(isDraggable) setupDragDrop(container);
}

function buildCard(p,draggable=false) {
  const open=expandedIds.has(p.id);
  const dls=deadlineStatus(p.deadline);
  const dlClass=dls==='over'?'dl-over':dls==='warn'?'dl-warn':'';
  const tags=[
    `<span class="imp-dot ${IMP_DOT[p.importance]}" title="${IMP_LBL[p.importance]}"></span>`,
    p.editor?`<span class="tag-chip"><i class="ti ti-building" style="font-size:0.6rem"></i>${p.editor}</span>`:'',
    p.client?`<span class="tag-chip"><i class="ti ti-user" style="font-size:0.6rem"></i>${p.client}</span>`:'',
    p.deadline?`<span class="tag-chip ${dlClass}">☠ ${toEuropean(p.deadline)}</span>`:'',
    p.archived?`<span class="tag-chip" style="color:var(--text-tertiary)"><i class="ti ti-archive" style="font-size:0.6rem"></i>Archivé</span>`:'',
  ].filter(Boolean).join('');

  let detail='';
  if (open) {
    const subsHTML=`
      <div class="section-label">Sous-projets
        <button class="btn-inline" data-action="new-sub" data-pid="${p.id}"><i class="ti ti-plus"></i>Ajouter</button>
      </div>
      ${p.subprojects.map(s=>`
        <div class="sub-row" data-action="edit-sub" data-pid="${p.id}" data-sid="${s.id}">
          <div class="sub-info"><div class="sub-num">${s.number}</div><div class="sub-name">${s.name}</div></div>
          <div class="sub-prog">${pb(s.progress,s.status,'4px')}</div>
          <div class="sub-status"><span class="status-badge ${STATUS_CLASS[s.status]} clickable-status" data-action="inline-status" data-pid="${p.id}">${STATUS_LABELS[s.status]}</span></div>
          <button class="btn-icon" data-action="edit-sub" data-pid="${p.id}" data-sid="${s.id}"><i class="ti ti-edit"></i></button>
        </div>`).join('')}`;

    const notesHTML=p.notes&&p.notes.length
      ?[...p.notes].reverse().map(n=>`<div class="note-item"><div class="note-date"><i class="ti ti-clock" style="font-size:0.6rem"></i>${toEuropean(n.date)}</div><div class="note-text">${n.text}</div></div>`).join('')
      :`<div class="note-empty">Aucune note pour ce projet</div>`;

    detail=`<div class="proj-detail">
      <div class="det-meta-grid">
        <div class="det-meta-item"><div class="det-meta-label">Éditeur</div><div class="det-meta-val">${p.editor||'—'}</div></div>
        <div class="det-meta-item"><div class="det-meta-label">Client</div><div class="det-meta-val">${p.client||'—'}</div></div>
        <div class="det-meta-item"><div class="det-meta-label">Importance</div><div class="det-meta-val"><span class="imp-dot ${IMP_DOT[p.importance]}"></span>${IMP_LBL[p.importance]}</div></div>
        <div class="det-meta-item"><div class="det-meta-label">Date début</div><div class="det-meta-val">${toEuropean(p.date)}</div></div>
        <div class="det-meta-item ${dls?'dl-'+dls:''}"><div class="det-meta-label">☠ Deadline</div><div class="det-meta-val ${dlClass}">${toEuropean(p.deadline)}</div></div>
        ${p.ended?`<div class="det-meta-item done-item"><div class="det-meta-label">✓ Terminé le</div><div class="det-meta-val ended">${toEuropean(p.ended)}</div></div>`:''}
      </div>
      <div class="subproj-section">${subsHTML}</div>
      <div class="sep"></div>
      <div class="notes-section">
        <div class="section-label">Historique des notes
          <button class="btn-inline" data-action="add-note" data-pid="${p.id}"><i class="ti ti-plus"></i>Nouvelle note</button>
        </div>
        ${notesHTML}
      </div>
      <div class="det-actions">
        <button class="btn-sm-action" data-action="edit-proj" data-pid="${p.id}"><i class="ti ti-edit"></i>Modifier</button>
        <button class="btn-sm-action" data-action="archive-proj" data-pid="${p.id}"><i class="ti ti-${p.archived?'archive-off':'archive'}"></i>${p.archived?'Désarchiver':'Archiver'}</button>
        <button class="btn-sm-action danger" data-action="delete-proj" data-pid="${p.id}"><i class="ti ti-trash"></i>Supprimer</button>
      </div>
    </div>`;
  }

  const dragHandle=draggable?`<div class="drag-handle" title="Glisser pour réordonner"><i class="ti ti-grip-vertical"></i></div>`:'';
  return `<div class="proj-card" data-pid="${p.id}" ${draggable?'draggable="true"':''}>
    <div class="proj-row" data-action="toggle" data-pid="${p.id}">
      ${dragHandle}
      <i class="ti ti-chevron-right pr-chevron ${open?'open':''}"></i>
      <div class="pr-info">
        <div class="proj-num">${p.number}</div>
        <div class="proj-name">${p.name}</div>
        <div class="proj-tags">${tags}</div>
      </div>
      <div class="pr-prog">${pb(p.progress,p.status)}</div>
      <div class="pr-status"><span class="status-badge ${STATUS_CLASS[p.status]} clickable-status" data-action="inline-status" data-pid="${p.id}">${STATUS_LABELS[p.status]}</span></div>
      <div class="pr-date proj-meta">${toEuropean(p.updatedAt)}</div>
      <div class="pr-edit"><button class="btn-icon" data-action="edit-proj" data-pid="${p.id}"><i class="ti ti-edit"></i></button></div>
    </div>
    ${detail}
  </div>`;
}

function attachCardListeners() {
  g('project-list').querySelectorAll('[data-action]').forEach(node=>{
    node.addEventListener('click',e=>{
      e.stopPropagation();
      const {action,pid,sid}=node.dataset;
      // IDs are UUIDs — no parseInt
      switch(action){
        case 'toggle':        toggleExpand(pid);           break;
        case 'edit-proj':     openEdit(pid);               break;
        case 'delete-proj':   confirmDelete(pid);          break;
        case 'archive-proj':  toggleArchive(pid);          break;
        case 'new-sub':       openNewSub(pid);             break;
        case 'edit-sub':      openEditSub(pid,sid);        break;
        case 'add-note':      openAddNote(pid);            break;
        case 'inline-status': openInlineStatus(pid,node);  break;
      }
    });
  });
}

function toggleExpand(id){expandedIds.has(id)?expandedIds.delete(id):expandedIds.add(id);renderProjects();}

async function toggleArchive(id){
  const p=projects.find(x=>x.id===id);if(!p)return;
  p.archived=!p.archived;
  await saveProject({...p},false);
  toast(p.archived?'Projet archivé':'Projet désarchivé');
  renderSidebar();renderView();
}

async function confirmDelete(id){
  const p=projects.find(x=>x.id===id);
  if(!confirm(`Supprimer "${p?.name}" ?\nCette action est irréversible.`))return;
  if(await deleteProjectFromDb(id)){
    projects=projects.filter(p=>p.id!==id);expandedIds.delete(id);
    toast('Projet supprimé');renderSidebar();renderView();
  }
}

/* ============================================================
   MODAL HELPERS
   ============================================================ */
function resetModal(){
  editingId=null;editingSubParentId=null;addingNoteTo=null;sliderManual=false;
  ['f-num','f-name','f-editor','f-client','f-note'].forEach(id=>{g(id).value='';g(id).disabled=false;});
  g('f-status-m').value='ready';g('f-imp').value='medium';
  g('f-progress').value=0;g('f-progress-val').textContent='0%';
  g('f-date').value=todayISO();g('f-deadline').value='';
  g('f-cat').value=selectedCat;
  g('note-field-wrap').style.display='block';
  g('note-label').textContent='Note initiale';
  g('f-note').placeholder='Ajouter une note…';
  g('prog-hint').textContent='Auto selon le statut — ajustable manuellement';
  g('editor-suggest').style.display='none';
  g('client-suggest').style.display='none';
}

function openModal(title,icon='ti-folder'){
  g('modal-title').innerHTML=`<i class="ti ${icon}"></i>${title}`;
  g('modal-overlay').classList.add('open');
}
function closeModal(){g('modal-overlay').classList.remove('open');resetModal();}

function syncSlider(status){
  const auto=AUTO_PROG[status];if(auto===null)return;
  if(!sliderManual){g('f-progress').value=auto;g('f-progress-val').textContent=`${auto}%`;}
  g('prog-hint').textContent=`Auto : ${auto}% pour "${STATUS_LABELS[status]}" — ajustable`;
}

function openNewProject(){resetModal();syncSlider('ready');openModal('Nouveau projet','ti-folder-plus');}

function openEdit(id){
  resetModal();editingId=id;sliderManual=true;
  const p=projects.find(x=>x.id===id);
  if(!p){toast('Projet introuvable','error');return;}  // UUID guard
  sv('f-num',p.number);sv('f-name',p.name);sv('f-editor',p.editor);sv('f-client',p.client);
  g('f-status-m').value=p.status;g('f-imp').value=p.importance||'medium';
  g('f-progress').value=p.progress;g('f-progress-val').textContent=`${p.progress}%`;
  sv('f-date',p.date);sv('f-deadline',p.deadline);g('f-cat').value=p.cat;
  g('note-label').textContent='Nouvelle note (optionnel)';
  g('f-note').placeholder='Laisser vide pour ne pas ajouter…';
  g('prog-hint').textContent='Valeur personnalisée';
  openModal('Modifier le projet','ti-edit');
}

function openAddNote(id){
  resetModal();addingNoteTo=id;sliderManual=true;
  const p=projects.find(x=>x.id===id);
  if(!p){toast('Projet introuvable','error');return;}
  sv('f-num',p.number);sv('f-name',p.name);sv('f-editor',p.editor);sv('f-client',p.client);
  g('f-num').disabled=true;g('f-name').disabled=true;
  g('f-status-m').value=p.status;g('f-imp').value=p.importance||'medium';
  g('f-progress').value=p.progress;g('f-progress-val').textContent=`${p.progress}%`;
  sv('f-deadline',p.deadline);g('f-cat').value=p.cat;
  g('note-label').textContent='Nouvelle note';
  g('f-note').placeholder="Décris l'avancement…";
  g('prog-hint').textContent='Valeur personnalisée';
  openModal(`Note — ${p.number}`,'ti-notes');
}

function openNewSub(parentId){
  resetModal();editingSubParentId=parentId;
  const parent=projects.find(x=>x.id===parentId);
  if(!parent){toast('Projet parent introuvable','error');return;}
  sv('f-num',`${parent.number}_${String(parent.subprojects.length+1).padStart(2,'0')}`);
  g('note-field-wrap').style.display='none';
  openModal('Nouveau sous-projet','ti-folders');
}

function openEditSub(parentId,subId){
  resetModal();editingSubParentId=parentId;editingId=subId;sliderManual=true;
  const parent=projects.find(x=>x.id===parentId);
  if(!parent){toast('Projet parent introuvable','error');return;}
  const s=parent.subprojects.find(x=>x.id===subId);  // subId is also UUID string
  if(!s){toast('Sous-projet introuvable','error');return;}
  sv('f-num',s.number);sv('f-name',s.name);
  g('f-status-m').value=s.status;
  g('f-progress').value=s.progress;g('f-progress-val').textContent=`${s.progress}%`;
  g('note-field-wrap').style.display='none';
  g('prog-hint').textContent='Valeur personnalisée';
  openModal('Modifier le sous-projet','ti-edit');
}

/* ============================================================
   AUTH
   ============================================================ */
function renderLoginScreen(){
  document.body.innerHTML=`
    <div id="login-screen">
      <div id="login-box">
        <div class="login-logo">
          <div class="logo-icon">✦</div>
          <div>
            <div style="font-size:1.15rem;font-weight:600;color:var(--text-primary)">La fabrique</div>
            <div style="font-size:0.71rem;color:var(--text-tertiary);letter-spacing:.05em;text-transform:uppercase">gestion de projets</div>
          </div>
        </div>
        <div id="login-error" class="login-error" style="display:none"></div>
        <div class="fg"><label>Email</label><input type="email" id="auth-email" placeholder="vous@exemple.com" autocomplete="email"/></div>
        <div class="fg"><label>Mot de passe</label><input type="password" id="auth-password" placeholder="••••••••" autocomplete="current-password"/></div>
        <button id="auth-btn" class="btn-primary" style="width:100%;justify-content:center;height:38px;font-size:0.928rem;margin-top:4px">Se connecter</button>
        <p id="auth-switch" style="text-align:center;font-size:0.75rem;color:var(--text-tertiary);margin-top:10px;cursor:pointer">
          Pas encore de compte ? <span style="color:var(--gold);font-weight:500">Créer un compte</span>
        </p>
        <p id="forgot-pw" style="text-align:center;font-size:0.71rem;color:var(--text-tertiary);margin-top:6px;cursor:pointer">
          Mot de passe oublié ?
        </p>
      </div>
    </div>`;

  let isSignUp=false;

  g('auth-switch').addEventListener('click',()=>{
    isSignUp=!isSignUp;
    g('auth-btn').textContent=isSignUp?'Créer le compte':'Se connecter';
    g('auth-switch').innerHTML=isSignUp
      ?`Déjà un compte ? <span style="color:var(--gold);font-weight:500">Se connecter</span>`
      :`Pas encore de compte ? <span style="color:var(--gold);font-weight:500">Créer un compte</span>`;
  });

  g('forgot-pw').addEventListener('click',async()=>{
    const email=g('auth-email').value.trim();
    const errBox=g('login-error');
    if (!email){errBox.textContent='Entrez votre email ci-dessus.';errBox.style.display='block';return;}
    const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});
    errBox.style.cssText='display:block;background:#EAF3DE;color:#3B6D11;border-radius:8px;padding:8px 10px;font-size:0.75rem;margin-bottom:10px';
    errBox.textContent=error?error.message:'Email de réinitialisation envoyé — vérifiez votre boîte.';
  });

  const doAuth=async()=>{
    const email=g('auth-email').value.trim(),password=g('auth-password').value;
    const errBox=g('login-error');
    errBox.style.display='none';
    if(!email||!password){errBox.textContent='Merci de remplir tous les champs.';errBox.style.display='block';return;}
    g('auth-btn').disabled=true;g('auth-btn').textContent='Chargement…';
    const {data,error}=isSignUp
      ?await db.auth.signUp({email,password})
      :await db.auth.signInWithPassword({email,password});
    if (error){errBox.textContent=error.message;errBox.style.display='block';g('auth-btn').disabled=false;g('auth-btn').textContent=isSignUp?'Créer le compte':'Se connecter';return;}
    if (isSignUp&&!data.session){
      errBox.style.cssText='display:block;background:#EAF3DE;color:#3B6D11;border-radius:8px;padding:8px 10px;font-size:0.75rem;margin-bottom:10px';
      errBox.textContent='Compte créé ! Vérifiez votre email pour confirmer.';
      g('auth-btn').disabled=false;g('auth-btn').textContent='Se connecter';isSignUp=false;return;
    }
    location.reload();
  };

  g('auth-btn').addEventListener('click',doAuth);
  [g('auth-email'),g('auth-password')].forEach(i=>i.addEventListener('keydown',e=>{if(e.key==='Enter')doAuth();}));
}

async function checkAuth(){
  const {data:{session}}=await db.auth.getSession();
  if (session?.user){
    currentUser=session.user;
    loadOrder();
    fetchProjects();
    const logout=g('btn-logout');
    if(logout) logout.title=`Connecté : ${currentUser.email}`;
  } else {
    renderLoginScreen();
  }
}

/* ============================================================
   MODAL SAVE
   ============================================================ */
async function handleSave(){
  const num=gv('f-num'),name=gv('f-name'),status=g('f-status-m').value;
  const progress=parseInt(g('f-progress').value)||0;
  const deadline=g('f-deadline').value,date=g('f-date').value;
  const noteText=gv('f-note'),editor=gv('f-editor'),client=gv('f-client');
  const importance=g('f-imp').value,cat=g('f-cat').value,now=todayISO();

  g('btn-save').disabled=true;g('btn-save').textContent='Enregistrement…';
  try {
    if (addingNoteTo!==null){
      const p=projects.find(x=>x.id===addingNoteTo);
      const wasNotDone=p.status!=='done';
      Object.assign(p,{status,progress,importance,updatedAt:now});
      if(status==='done'&&wasNotDone)p.ended=now;
      if(status!=='done')p.ended=null;
      await saveProject({...p},false);
      if(noteText){await saveNote(p.id,noteText);p.notes.push({date:now,text:noteText});}
      toast('Note ajoutée ✓');closeModal();renderView();return;
    }
    if (editingSubParentId!==null&&editingId!==null){
      if(!num||!name)return;
      const parent=projects.find(x=>x.id===editingSubParentId);
      const sub=parent.subprojects.find(x=>x.id===editingId);  // UUID string comparison
      Object.assign(sub,{number:num,name,status,progress});
      await saveSubproject(editingSubParentId,sub,false);
      parent.updatedAt=now;await saveProject({...parent},false);
      toast('Sous-projet mis à jour ✓');
    } else if (editingSubParentId!==null){
      if(!num||!name)return;
      const parent=projects.find(x=>x.id===editingSubParentId);
      const newId=await saveSubproject(editingSubParentId,{number:num,name,status,progress},true);
      if(newId){parent.subprojects.push({id:newId,number:num,name,status,progress});parent.updatedAt=now;await saveProject({...parent},false);}
      toast('Sous-projet créé ✓');
    } else if (editingId!==null){
      if(!name)return;
      const p=projects.find(x=>x.id===editingId);
      if(!p){toast('Projet introuvable','error');return;}
      const wasNotDone=p.status!=='done';
      Object.assign(p,{name,status,progress,date,deadline,editor,client,importance,cat,updatedAt:now});
      if(status==='done'&&wasNotDone)p.ended=now;
      if(status!=='done')p.ended=null;
      await saveProject({...p},false);
      if(noteText){await saveNote(p.id,noteText);p.notes.push({date:now,text:noteText});}
      toast('Projet mis à jour ✓');
    } else {
      if(!num||!name)return;
      const year=parseInt(num.split('_')[0])||new Date().getFullYear();
      const newP={number:num,name,cat,status,progress,importance,editor,client,date,deadline,
        ended:status==='done'?now:null,archived:false,updatedAt:now,year,subprojects:[],notes:[]};
      const newId=await saveProject({...newP},true);
      if(newId){
        newP.id=newId;
        if(noteText){await saveNote(newId,noteText);newP.notes.push({date:now,text:noteText});}
        projects.push(newP);selectedYear=year;selectedCat=cat;
        toast('Projet créé ✓');
      }
    }
    closeModal();renderSidebar();renderView();
  } finally {
    g('btn-save').disabled=false;g('btn-save').textContent='Enregistrer';
  }
}

/* ============================================================
   CSS
   ============================================================ */
document.head.insertAdjacentHTML('beforeend',`<style>
  @keyframes spin    {to{transform:rotate(360deg)}}
  @keyframes slideIn {from{transform:translateY(8px);opacity:0}to{transform:translateY(0);opacity:1}}

  /* Auth */
  #login-screen{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg)}
  #login-box{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:28px 24px;width:340px;box-shadow:var(--shadow-md)}
  .login-logo{display:flex;align-items:center;gap:10px;margin-bottom:20px}
  .login-error{background:#FBEAF0;color:#993356;border-radius:var(--radius-md);padding:8px 10px;font-size:0.75rem;margin-bottom:10px}
  #forgot-pw:hover{color:var(--gold)!important}

  /* Inline status */
  .inline-status-dropdown{position:absolute;background:var(--bg-card);border:1px solid var(--border-md);border-radius:var(--radius-md);box-shadow:var(--shadow-md);z-index:500;min-width:160px;padding:4px}
  .isd-item{display:flex;align-items:center;gap:6px;padding:5px 7px;border-radius:5px;cursor:pointer;transition:background .1s}
  .isd-item:hover,.isd-item.active{background:var(--bg-hover)}
  .clickable-status{cursor:pointer;transition:opacity .12s}
  .clickable-status:hover{opacity:.75}

  /* Drag */
  .drag-handle{flex:0 0 14px;color:var(--text-tertiary);cursor:grab;font-size:0.85rem;display:flex;align-items:center;opacity:0;transition:opacity .15s}
  .proj-row:hover .drag-handle{opacity:1}
  .dragging{opacity:.45;border:1.5px dashed var(--border-md)!important}
  .drag-over{border-color:var(--gold)!important;box-shadow:0 0 0 2px var(--gold-light)!important}
  .overdue-badge{color:var(--dl-over);font-size:0.6rem}

  /* Dashboard */
  .dashboard{padding:8px;display:flex;flex-direction:column;gap:8px}
  .dash-row{display:flex;gap:8px;flex-wrap:wrap}
  .dash-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:12px 14px;flex:1;min-width:180px}
  .dash-wide{flex:2;min-width:280px}
  .dash-sm{flex:0 0 160px;min-width:140px}
  .dash-title{font-size:0.75rem;font-weight:600;color:var(--text-secondary);margin-bottom:10px;display:flex;align-items:center;gap:5px;text-transform:uppercase;letter-spacing:.04em}
  .dash-status-grid{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
  .dash-stat-pill{display:flex;align-items:center;gap:5px}
  .dash-stat-num{font-size:0.85rem;font-weight:600;color:var(--text-primary)}
  .dash-progress-row{display:flex;align-items:center;gap:0;margin-top:6px;border-top:1px solid var(--border);padding-top:8px}
  .dash-big-num{font-size:2.2rem;font-weight:700;color:var(--text-primary);line-height:1;margin:8px 0 4px}
  .dash-alert{display:flex;align-items:center;gap:6px;padding:5px 7px;border-radius:var(--radius-md);margin-bottom:3px;font-size:0.75rem}
  .dash-alert.over{background:#FBEAF0;color:#993356}
  .dash-alert.warn{background:#FAEEDA;color:#854F0B}
  .dash-alert-num{font-family:var(--font-mono);font-size:0.65rem;opacity:.8}
  .dash-alert-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
  .dash-alert-dl{font-size:0.65rem;opacity:.8;white-space:nowrap}
  .dash-empty{font-size:0.75rem;color:var(--text-tertiary);font-style:italic;padding:4px 0}
  .dash-imp-row{display:flex;align-items:center;gap:7px;margin-bottom:7px}
  .dash-client-row{display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)}
  .dash-client-row:last-child{border-bottom:none}
  .dash-badge{background:var(--bg-hover);color:var(--text-secondary);font-size:0.65rem;font-weight:600;padding:1px 6px;border-radius:10px}
  .dash-summary-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:0.75rem;color:var(--text-secondary);border-bottom:1px solid var(--border)}
  .dash-summary-row:last-child{border-bottom:none}
  .dash-summary-row strong{font-size:0.85rem;color:var(--text-primary)}
</style>`);

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener('DOMContentLoaded',()=>{

  /* ---- Modal ---- */
  g('btn-new')?.addEventListener('click',openNewProject);
  g('btn-cancel')?.addEventListener('click',closeModal);
  g('btn-save')?.addEventListener('click',handleSave);
  g('modal-overlay')?.addEventListener('click',e=>{if(e.target===g('modal-overlay'))closeModal();});
  g('f-status-m')?.addEventListener('change',function(){sliderManual=false;syncSlider(this.value);});
  g('f-progress')?.addEventListener('input',function(){
    sliderManual=true;g('f-progress-val').textContent=`${this.value}%`;
    g('prog-hint').textContent='Valeur personnalisée';
  });

  /* ---- Topbar filters ---- */
  g('search')?.addEventListener('input',renderView);
  g('filter-status')?.addEventListener('change',renderView);
  g('filter-imp')?.addEventListener('change',renderView);
  g('sort-by')?.addEventListener('change',renderView);

  /* ---- Sidebar actions ---- */
  g('toggle-archived')?.addEventListener('click',()=>{
    showArchived=!showArchived;
    g('toggle-archived').textContent=showArchived?'↑ Masquer archivés':'↓ Voir archivés';
    renderView();
  });

  g('btn-dashboard')?.addEventListener('click',()=>{
    showDashboard=!showDashboard;
    // Update sidebar tool button active state
    g('btn-dashboard')?.classList.toggle('active', showDashboard);
    renderView();
  });

  g('btn-export')?.addEventListener('click',exportCSV);

  g('btn-logout')?.addEventListener('click',async()=>{
    await db.auth.signOut(); currentUser=null; renderLoginScreen();
  });

  /* ---- Mobile hamburger ---- */
  function openSidebar() {
    g('sidebar')?.classList.add('open');
    g('sidebar-overlay')?.classList.add('open');
  }
  function closeSidebar() {
    g('sidebar')?.classList.remove('open');
    g('sidebar-overlay')?.classList.remove('open');
  }

  g('btn-menu')?.addEventListener('click', openSidebar);
  g('sidebar-overlay')?.addEventListener('click', closeSidebar);

  // Close sidebar when a year is selected on mobile
  document.addEventListener('click', e => {
    if (e.target.closest('.year-item') && window.innerWidth <= 640) {
      setTimeout(closeSidebar, 120);
    }
  });

  /* ---- Mobile new project button ---- */
  g('btn-new-mobile')?.addEventListener('click', openNewProject);

  /* ---- Bottom nav ---- */
  document.querySelectorAll('.bnav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      const cat  = btn.dataset.cat;

      document.querySelectorAll('.bnav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      if (view === 'new') {
        // Don't mark new as active — go back to previous
        btn.classList.remove('active');
        const prev = document.querySelector(`.bnav-item[data-cat="${selectedCat}"]`);
        prev?.classList.add('active');
        openNewProject();
        return;
      }
      if (view === 'stats') {
        showDashboard = true;
        renderView();
        return;
      }
      if (cat) {
        showDashboard = false;
        selectedCat  = cat;
        // Pick most recent year for this cat
        const years = [...new Set(projects.filter(p=>p.cat===cat).map(p=>p.year))].sort((a,b)=>b-a);
        if (years.length) selectedYear = years[0];
        renderSidebar();
        renderView();
      }
    });
  });

  /* ---- Sidebar resize (desktop only) ---- */
  const resizer  = g('sidebar-resizer');
  const sidebar  = g('sidebar');
  let isResizing = false;
  let startX     = 0;
  let startW     = 0;

  // Restore saved width
  const savedW = localStorage.getItem('lf_sidebar_w');
  if (savedW && sidebar) {
    sidebar.style.width = savedW + 'px';
  }

  resizer?.addEventListener('mousedown', e => {
    if (window.innerWidth <= 640) return; // disable on mobile
    isResizing = true;
    startX = e.clientX;
    startW = sidebar.offsetWidth;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', e => {
    if (!isResizing) return;
    const dx  = e.clientX - startX;
    const min = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-min')) || 120;
    const max = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-max')) || 280;
    const newW = Math.min(max, Math.max(min, startW + dx));
    sidebar.style.width = newW + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    resizer?.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Persist width
    try { localStorage.setItem('lf_sidebar_w', sidebar.offsetWidth); } catch(_) {}
  });

  /* ---- Keyboard shortcuts ---- */
  document.addEventListener('keydown', e => {
    if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT') return;
    if (e.key==='n'||e.key==='N') { e.preventDefault(); openNewProject(); }
    if (e.key==='Escape')         { closeModal(); closeInlineStatus(); closeSidebar(); }
    if (e.key==='d'||e.key==='D') { showDashboard=!showDashboard; g('btn-dashboard')?.classList.toggle('active',showDashboard); renderView(); }
  });

  /* ---- Autocomplete ---- */
  setupAC('f-editor','editor-suggest',()=>getUniqueList('editor'));
  setupAC('f-client','client-suggest',()=>getUniqueList('client'));

  /* ---- Go ---- */
  checkAuth();
});
