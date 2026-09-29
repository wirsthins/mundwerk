/* Mundwerk – App-Logik. Inhalte stehen in data.js, die Verbindung in config.js. */
'use strict';

const CFG = window.MUNDWERK_CONFIG || {};
const DIALEKT = CFG.dialekt || 'tirol';
const TABS = [['start','Start'],['situationen','Situationen'],['lernen','Lernen'],['laute','Lautregeln'],['ki','KI-Trainer'],['community','Community'],['listen','Meine Listen']];
const SCHWELLE = 20;
const ROLES = [
  {id:'dokter', label:'Beim Dokter', learner:'Patient oder Patientin'},
  {id:'gschaeft', label:'An der Theke', learner:'Kunde oder Kundin'},
  {id:'wirt', label:'Im Wirtshaus', learner:'Gast'},
  {id:'berg', label:'Auf der Hütte', learner:'Wanderer oder Wanderin'},
  {id:'baustell', label:'Auf der Baustelle', learner:'neuer Kollege oder neue Kollegin'},
  {id:'nachbar', label:'Im Stiegenhaus', learner:'neu eingezogene Person'}
];

/* ---------- Hilfen ---------- */
const $ = (s, r=document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-4);
const DAY = 864e5;
const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); };
const shuffle = a => { a = a.slice(); for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const norm = s => String(s||'').toLowerCase().replace(/å/g,'a').replace(/[^a-zäöüß0-9]/g,'');
const INTERVAL = [0,1,2,4,8,16];
let toastT;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2600); }

const BUILTIN = [];
SITS.forEach(s => s.p.forEach((p,i) => BUILTIN.push({id:s.id+':'+i, t:p[0], d:p[1], n:p[2]||'', sit:s.id})));

/* ---------- Backend (Supabase) ---------- */
const API = {
  client: null, user: null, name: '', isAdmin: false,
  get ready(){ return !!this.client; },
  async init(){
    if (!CFG.supabaseUrl || !CFG.supabaseAnonKey || !window.supabase) return;
    this.client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}});
    const {data} = await this.client.auth.getSession();
    this.user = (data && data.session && data.session.user) || null;
    if (this.user) await this.loadMe();
    this.client.auth.onAuthStateChange(async (_ev, session) => {
      const before = this.user && this.user.id;
      this.user = (session && session.user) || null;
      if ((this.user && this.user.id) !== before) { if (this.user) await this.loadMe(); else { this.name=''; this.isAdmin=false; } onAuthChanged(); }
    });
  },
  async loadMe(){
    const [p, a] = await Promise.all([
      this.client.from('profile').select('name').eq('user_id', this.user.id).maybeSingle(),
      this.client.from('admins').select('user_id').eq('user_id', this.user.id).maybeSingle()
    ]);
    this.name = (p.data && p.data.name) || '';
    this.isAdmin = !!a.data;
  },
  async sendLink(email){
    const {error} = await this.client.auth.signInWithOtp({email, options:{emailRedirectTo: location.origin + location.pathname}});
    if (error) throw error;
  },
  async logout(){ await this.client.auth.signOut(); },
  async setName(name){
    const {error} = await this.client.from('profile').upsert({user_id:this.user.id, name});
    if (error) throw error;
    this.name = name;
  },
  async loadState(){
    const {data, error} = await this.client.from('lernstand').select('state, updated_at').eq('user_id', this.user.id).maybeSingle();
    if (error) throw error;
    return data;
  },
  async saveState(state){
    const {error} = await this.client.from('lernstand').upsert({user_id:this.user.id, state, updated_at:new Date().toISOString()});
    if (error) throw error;
  },
  async accepted(){
    const {data, error} = await this.client.from('vorschlaege').select('id,t,d,n,sit,aufgenommen_at').eq('dialekt', DIALEKT).eq('status','aufgenommen').order('aufgenommen_at', {ascending:true}).limit(2000);
    if (error) throw error;
    return data || [];
  },
  async list(){
    const {data, error} = await this.client.from('vorschlaege_liste').select('*').eq('dialekt', DIALEKT).order('created_at', {ascending:false}).limit(1000);
    if (error) throw error;
    return data || [];
  },
  async myVotes(){
    if (!this.user) return [];
    const {data, error} = await this.client.from('stimmen').select('vorschlag_id').eq('user_id', this.user.id);
    if (error) throw error;
    return (data || []).map(r => r.vorschlag_id);
  },
  async propose(v){
    const {error} = await this.client.from('vorschlaege').insert({dialekt:DIALEKT, t:v.t, d:v.d, n:v.n, sit:v.sit});
    if (error) throw error;
  },
  async vote(id){ const {error} = await this.client.from('stimmen').insert({vorschlag_id:id, user_id:this.user.id}); if (error) throw error; },
  async unvote(id){ const {error} = await this.client.from('stimmen').delete().eq('vorschlag_id', id).eq('user_id', this.user.id); if (error) throw error; },
  async withdraw(id){ const {error} = await this.client.from('vorschlaege').delete().eq('id', id); if (error) throw error; },
  async setStatus(id, status){ const {error} = await this.client.from('vorschlaege').update({status}).eq('id', id); if (error) throw error; },
  async report(id){ const {error} = await this.client.from('meldungen').insert({vorschlag_id:id, user_id:this.user.id}); if (error) throw error; },
  async ki(body){
    const {data, error} = await this.client.functions.invoke('ki', {body});
    if (error) {
      let msg = 'Die KI ist gerade nicht erreichbar. Probier es gleich nochmal.';
      try { const j = await error.context.json(); if (j && j.fehler) msg = j.fehler; } catch(e) {}
      throw new Error(msg);
    }
    return data;
  }
};
function fehlerText(e, fallback){
  if (!e) return fallback;
  if (e.code === '23505') return 'Das hat schon jemand vorgeschlagen.';
  if (e.code === 'P0001' && e.message) return e.message;
  if (e.code === '42501') return 'Das ist nicht erlaubt.';
  return fallback;
}

/* ---------- Speicher ---------- */
const LSK = 'mundwerk.' + DIALEKT + '.v1';
function fresh(){ return {v:1, lists:[{id:'merk', name:'Merkliste', cards:[]}], prog:{}, updated:0}; }
function normalize(o){
  const s = fresh();
  if (o && Array.isArray(o.lists)) s.lists = o.lists.filter(l=>l && l.id).map(l=>({id:String(l.id), name:String(l.name||'Liste'), cards:Array.isArray(l.cards)?l.cards.filter(c=>c&&c.id).map(c=>({id:String(c.id),t:String(c.t||''),d:String(c.d||''),n:String(c.n||'')})):[]}));
  if (!s.lists.length) s.lists = fresh().lists;
  if (o && o.prog && typeof o.prog==='object') s.prog = o.prog;
  s.updated = (o && o.updated) || 0;
  return s;
}
let S = fresh();
try { const raw = localStorage.getItem(LSK); if (raw) S = normalize(JSON.parse(raw)); } catch(e) {}
let saveT = null, saving = false, dirty = false, synced = false;
function lsSave(){ try { localStorage.setItem(LSK, JSON.stringify(S)); } catch(e) {} }
function persist(){ S.updated = Date.now(); lsSave(); dirty = true; clearTimeout(saveT); saveT = setTimeout(flush, 1500); }
async function flush(){
  if (!API.user || !synced || saving || !dirty) return;
  saving = true; dirty = false;
  try { await API.saveState(S); setStatus(true); }
  catch(e){ dirty = true; setStatus(false, 'Speichern im Konto fehlgeschlagen'); }
  finally { saving = false; if (dirty) saveT = setTimeout(flush, 5000); }
}
function setStatus(acc, text){
  const el = $('#saveStatus');
  el.className = 'pill' + (acc ? ' ok' : '');
  el.textContent = text || (acc ? 'In deinem Konto gespeichert' : 'Nur in diesem Browser gespeichert');
}
async function syncState(){
  synced = false;
  if (!API.user) { setStatus(false); return; }
  try {
    const r = await API.loadState();
    const remoteT = r ? new Date(r.updated_at).getTime() : 0;
    if (r && r.state && (r.state.updated || remoteT) >= (S.updated || 0)) { S = normalize(r.state); lsSave(); }
    else if (S.updated) dirty = true;
    synced = true; setStatus(true); flush(); refresh();
  } catch(e) { setStatus(false, 'Konto nicht erreichbar, lokal gespeichert'); }
}
document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) { clearTimeout(saveT); flush(); } });

/* ---------- Community-Daten ---------- */
const COM = {state:'off', list:[], accepted:[], votes:new Set(), filter:'offen', draft:{t:'', d:'', sit:'', n:''}, msg:'', confirm:null, busy:new Set(), loadedAt:0};
const builtinAll = () => COM.accepted.length ? BUILTIN.concat(COM.accepted) : BUILTIN;
async function loadAccepted(){
  try {
    const rows = await API.accepted();
    COM.accepted = rows.filter(r => SITS.some(s=>s.id===r.sit)).map(r => ({id:'k:'+r.id, t:r.t, d:r.d, n:r.n||'', sit:r.sit, com:true}));
    refresh();
  } catch(e) {}
}
async function loadCommunity(){
  if (!API.ready) return;
  try {
    const [rows, votes] = await Promise.all([API.list(), API.myVotes()]);
    COM.list = rows; COM.votes = new Set(votes); COM.state = 'on'; COM.loadedAt = Date.now();
  } catch(e) { COM.state = 'error'; }
  if (cur === 'community') { if ($('#comList')) updateComList(); else render(); }
  else refresh();
}
setInterval(() => { if (cur === 'community' && !document.hidden && API.ready && Date.now() - COM.loadedAt > 45000) loadCommunity(); }, 15000);

/* ---------- Karten & Fortschritt ---------- */
function deckCards(key){
  if (key === 'all') return builtinAll();
  if (key.startsWith('sit:')) return builtinAll().filter(c => c.sit === key.slice(4));
  if (key.startsWith('list:')) { const l = S.lists.find(x => x.id === key.slice(5)); return l ? l.cards : []; }
  return [];
}
function deckName(key){
  if (key === 'all') return 'Alle Situationen';
  if (key.startsWith('sit:')) { const s = SITS.find(x=>x.id===key.slice(4)); return s ? s.t : ''; }
  const l = S.lists.find(x => x.id === key.slice(5)); return l ? l.name : '';
}
const box = id => (S.prog[id] && S.prog[id].b) || 0;
const isDue = id => S.prog[id] && S.prog[id].b > 0 && S.prog[id].due <= today();
function grade(id, g){
  const p = S.prog[id] || {b:0, due:0};
  if (g === 'again') { p.b = 1; p.due = today(); }
  else if (g === 'hard') { p.b = Math.max(1, p.b); p.due = today() + DAY; }
  else { p.b = Math.min(5, p.b + 1); p.due = today() + INTERVAL[p.b] * DAY; }
  S.prog[id] = p;
}
function counts(cards){
  let due=0, neu=0, sure=0;
  cards.forEach(c => { const b = box(c.id); if (!b) neu++; else { if (isDue(c.id)) due++; if (b >= 4) sure++; } });
  return {due, neu, sure};
}
function dots(id){ const b = box(id); return '<span class="dots" title="Lernstufe '+b+' von 5">' + [1,2,3,4,5].map(i=>'<i class="'+(i<=b?'on':'')+'"></i>').join('') + '</span>'; }
function deckOptions(sel){
  let h = '<option value="all"'+(sel==='all'?' selected':'')+'>Alle Situationen</option><optgroup label="Situationen">';
  SITS.forEach(s => h += '<option value="sit:'+s.id+'"'+(sel==='sit:'+s.id?' selected':'')+'>'+esc(s.t)+' · '+esc(s.d)+'</option>');
  h += '</optgroup><optgroup label="Meine Listen">';
  S.lists.forEach(l => h += '<option value="list:'+esc(l.id)+'"'+(sel==='list:'+l.id?' selected':'')+'>'+esc(l.name)+' ('+l.cards.length+')</option>');
  return h + '</optgroup>';
}
function listOptions(sel){ return S.lists.map(l => '<option value="'+esc(l.id)+'"'+(sel===l.id?' selected':'')+'>'+esc(l.name)+'</option>').join(''); }
function addToList(listId, card){
  const l = S.lists.find(x=>x.id===listId) || S.lists[0];
  if (l.cards.some(c => c.t === card.t && c.d === card.d)) { toast('Steht schon in „'+l.name+'"'); return false; }
  l.cards.push({id:'c:'+uid(), t:card.t, d:card.d, n:card.n||''}); persist(); toast('Zu „'+l.name+'" hinzugefügt'); return true;
}

/* ---------- Zustand der Ansichten ---------- */
let cur = 'start';
const UI = {sit:null, cover:false, target:'merk', learnMode:'karten', deck:'all', dir:'t2d', list:'merk', kiMode:'rolle', confirmDel:null, genTarget:'merk', trTarget:'merk'};
let FC = null, Q = null, RQ = null, CH = null, GEN = null, TR = null;

/* ---------- Konto ---------- */
function renderAccount(){
  const el = $('#account');
  if (!API.ready) { el.innerHTML = ''; return; }
  el.innerHTML = API.user
    ? '<span class="who">'+esc(API.name || 'Ohne Namen')+'</span>'+(API.isAdmin?' <span class="pill">Admin</span>':'')+'<button class="btn ghost small" data-act="profil">Name</button><button class="btn ghost small" data-act="logout">Abmelden</button>'
    : '<button class="btn small" data-act="login">Anmelden</button>';
}
function showSheet(html){ const o = $('#overlay'); o.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">'+html+'</div>'; o.hidden = false; const f = o.querySelector('input'); if (f) f.focus(); }
function hideSheet(){ const o = $('#overlay'); o.hidden = true; o.innerHTML = ''; }
function loginSheet(msg){
  showSheet('<h2>Anmelden</h2><p class="muted" style="margin:0">Wir schicken dir einen Anmelde-Link per E-Mail. Ein Passwort brauchst du nicht.</p>'+
    '<form class="stack" data-form="login" style="gap:10px"><div class="field"><label class="label" for="loginMail">E-Mail-Adresse</label><input class="inp" id="loginMail" type="email" required autocomplete="email"></div>'+
    (msg?'<div class="err-text">'+esc(msg)+'</div>':'')+
    '<div class="row"><button class="btn primary" type="submit">Link senden</button><button class="btn ghost" type="button" data-act="closesheet">Abbrechen</button></div></form>'+
    '<p class="small muted" style="margin:0">Mit der Anmeldung werden dein Lernstand, deine Listen und deine Vorschläge in deinem Konto gespeichert. Mehr dazu im <a href="datenschutz.html">Datenschutz</a>.</p>');
}
function nameSheet(msg, required){
  showSheet('<h2>'+(required?'Wie sollen wir dich nennen?':'Anzeigename ändern')+'</h2><p class="muted" style="margin:0">Dieser Name steht bei deinen Vorschlägen in der Community.</p>'+
    '<form class="stack" data-form="name" style="gap:10px"><div class="field"><label class="label" for="nameIn">Anzeigename</label><input class="inp" id="nameIn" required minlength="2" maxlength="30" value="'+esc(API.name)+'" autocomplete="nickname"></div>'+
    (msg?'<div class="err-text">'+esc(msg)+'</div>':'')+
    '<div class="row"><button class="btn primary" type="submit">Speichern</button><button class="btn ghost" type="button" data-act="closesheet">'+(required?'Später':'Abbrechen')+'</button></div></form>');
}
function onAuthChanged(){
  renderAccount(); syncState(); loadCommunity();
  if (API.user && !API.name) nameSheet('', true);
  render();
}

/* ---------- Render ---------- */
function renderTabs(){
  $('#tabs').innerHTML = TABS.map(([id,l]) => '<button class="tab" role="tab" data-tab="'+id+'" aria-current="'+(cur===id)+'">'+l+'</button>').join('');
}
function go(tab){
  cur = tab; try { history.replaceState(null,'','#'+tab); } catch(e) {}
  renderTabs(); render(); window.scrollTo({top:0});
  if (tab === 'community' && API.ready && Date.now() - COM.loadedAt > 15000) loadCommunity();
}
function refresh(){ if (!FC && !Q && !RQ) { if (cur === 'community' && $('#comList')) updateComList(); else if (cur !== 'ki' && cur !== 'listen') render(); } }
function render(){
  const v = $('#view');
  v.innerHTML = ({start:vStart, situationen:vSits, lernen:vLernen, laute:vLaute, ki:vKI, community:vCommunity, listen:vListen}[cur] || vStart)();
  if (cur === 'community') updateComList();
  if (cur === 'ki' && UI.kiMode === 'rolle' && CH) { const c = $('#chat'); if (c) c.scrollTop = c.scrollHeight; }
}

function vStart(){
  const all = [...builtinAll(), ...S.lists.flatMap(l=>l.cards)];
  const c = counts(all);
  const dist = [1,2,3,4,5].map(b => all.filter(x => box(x.id)===b).length);
  const max = Math.max(1, ...dist);
  const d = BUILTIN[Math.floor(Date.now()/DAY) % BUILTIN.length];
  const sit = SITS.find(s=>s.id===d.sit);
  const open = COM.list.filter(i=>i.status==='offen').length;
  return '<div class="stack">'+
  '<section class="hello">'+
    '<div class="panel stack">'+
      '<div><div class="label">Tirolerisch</div><h1>Griaß di!</h1><p class="muted" style="margin:.4em 0 0;max-width:52ch">Lern Tirolerisch so, wie man es beim Dokter, im Gschäft oder am Berg wirklich hört. Situationen durchgehen, Karteikarten wiederholen, mit der KI üben.</p></div>'+
      '<div class="stats">'+
        '<div class="stat"><b>'+c.due+'</b><span class="small muted">heute fällig</span></div>'+
        '<div class="stat"><b>'+c.neu+'</b><span class="small muted">noch neu</span></div>'+
        '<div class="stat"><b>'+c.sure+'</b><span class="small muted">sitzen fest</span></div>'+
      '</div>'+
      '<div class="row"><button class="btn primary" data-act="quickstart">'+(c.due ? c.due+' fällige Karten lernen' : 'Neue Karten lernen')+'</button><button class="btn" data-go="situationen">Situationen ansehen</button></div>'+
    '</div>'+
    '<div class="panel stack">'+
      '<div class="label">Lernkasten</div>'+
      '<div><div class="boxes">'+dist.map(n=>'<div class="'+(n?'fill':'')+'" style="height:'+Math.max(4,Math.round(n/max*100))+'%"><span>'+n+'</span></div>').join('')+'</div>'+
      '<div class="boxlabels">'+['1 Tag','2 Tage','4 Tage','8 Tage','16 Tage'].map(x=>'<span>'+x+'</span>').join('')+'</div></div>'+
      '<p class="small muted" style="margin:0">Jede Karte wandert ein Fach weiter, wenn du sie weißt, und zurück ins erste, wenn nicht. Der Abstand bis zur nächsten Wiederholung verdoppelt sich mit jedem Fach.</p>'+
    '</div>'+
  '</section>'+
  '<section class="panel daily stack" style="gap:6px"><div class="label">Satz des Tages · '+esc(sit.t)+'</div><div class="dia">'+esc(d.t)+'</div><div class="muted">'+esc(d.d)+(d.n?' · <i>'+esc(d.n)+'</i>':'')+'</div>'+
    '<div class="row" style="margin-top:6px"><button class="btn small" data-add-builtin="'+esc(d.id)+'">Zur Merkliste</button></div></section>'+
  '<section class="stack" style="gap:10px"><div class="row between"><h2 style="font-size:18px">Situationen</h2><button class="btn ghost small" data-go="situationen">Alle</button></div>'+
    '<div class="grid">'+SITS.slice(0,4).map(sitCard).join('')+'</div></section>'+
  (API.ready ? '<section class="panel row between"><div><div class="label">Community</div><div style="margin-top:2px">'+(open?open+' Vorschläge warten auf Stimmen':'Fehlt dir ein Wort? Schlag es vor.')+(COM.accepted.length?' · '+COM.accepted.length+' schon aufgenommen':'')+'</div></div><button class="btn" data-go="community">Zur Community</button></section>' : '')+
  '<p class="note">Tirolerisch ist nicht einheitlich. Im Oberland, im Unterland, im Zillertal und in Osttirol klingt vieles anders. Die Sätze hier folgen der Umgangssprache rund um Innsbruck. Wenn du es in deinem Tal anders sagst, leg dir eine eigene Liste an oder schlag es in der Community vor.</p>'+
  '</div>';
}
function sitCard(s){
  const cards = builtinAll().filter(c=>c.sit===s.id);
  const learned = cards.filter(c=>box(c.id)>=2).length;
  return '<button class="sit" data-sit="'+s.id+'"><span class="dia">'+esc(s.t)+'</span><span class="muted small">'+esc(s.d)+'</span>'+
    '<span class="meta"><span>'+cards.length+' Sätze'+(DIALOGS[s.id]?' · Dialog':'')+'</span><span class="bar" title="'+learned+' von '+cards.length+' gelernt"><i style="width:'+Math.round(learned/cards.length*100)+'%"></i></span></span></button>';
}

function vSits(){
  if (!UI.sit) return '<div class="stack"><div><h2 style="font-size:22px">Situationen</h2><p class="muted" style="margin:.3em 0 0">Wähl eine Alltagssituation. Jede hat Sätze zum Nachlesen, einige einen Dialog.</p></div><div class="grid">'+SITS.map(sitCard).join('')+'</div></div>';
  const s = SITS.find(x=>x.id===UI.sit);
  const cards = builtinAll().filter(c=>c.sit===s.id);
  const dlg = DIALOGS[s.id];
  const coverBtn = '<button class="btn ghost small" data-act="cover">'+(UI.cover?'Hochdeutsch zeigen':'Hochdeutsch verdecken')+'</button>';
  return '<div class="stack">'+
   '<div class="row between"><button class="btn ghost small" data-act="sitback">← Alle Situationen</button>'+
   '<div class="row"><button class="btn small" data-learn="sit:'+s.id+'" data-mode="karten">Karteikarten</button><button class="btn small" data-learn="sit:'+s.id+'" data-mode="quiz">Quiz</button></div></div>'+
   '<div><h2 class="dia" style="font-size:36px;line-height:1.05">'+esc(s.t)+'</h2><div class="muted">'+esc(s.d)+'</div></div>'+
   (dlg ? '<section class="panel stack"><div class="row between"><div class="label">Dialog · '+esc(dlg.title)+'</div>'+coverBtn+'</div><div class="dialog'+(UI.cover?' cover':'')+'">'+
     dlg.lines.map(l=>'<div class="line"><div class="who">'+esc(l[0])+'</div><div><div class="dia">'+esc(l[1])+'</div><div class="hd" data-reveal>'+esc(l[2])+'</div></div></div>').join('')+'</div></section>' : '')+
   '<section class="panel stack"><div class="row between"><div class="label">Sätze & Wörter</div><div class="row small">'+coverBtn+
     '<label class="muted" for="target">Speichern in</label><select class="inp" id="target" data-change="target">'+listOptions(UI.target)+'</select></div></div>'+
   '<div class="phrases'+(UI.cover?' cover':'')+'">'+cards.map(c=>'<div class="phrase"><div class="dia">'+esc(c.t)+' '+dots(c.id)+(c.com?' <span class="pill com">Community</span>':'')+'</div><div class="act"><button class="btn small" data-add-builtin="'+esc(c.id)+'" aria-label="Zur Liste hinzufügen">+ Liste</button></div><div class="hd" data-reveal>'+esc(c.d)+'</div>'+(c.n?'<div class="nt">'+esc(c.n)+'</div>':'')+'</div>').join('')+'</div>'+
   (UI.cover?'<p class="small muted" style="margin:0">Tipp auf ein graues Feld, um die Übersetzung aufzudecken.</p>':'')+
   (API.ready?'<div class="row between" style="border-top:1px solid var(--line);padding-top:12px"><span class="small muted">Fehlt ein Wort oder eine Redewendung?</span><button class="btn small" data-propose="'+s.id+'">Vorschlagen</button></div>':'')+
   '</section></div>';
}

function vLernen(){
  if (FC) return vFlash();
  if (Q) return vQuiz();
  const cards = deckCards(UI.deck);
  const c = counts(cards);
  return '<div class="stack"><div><h2 style="font-size:22px">Lernen</h2><p class="muted" style="margin:.3em 0 0">Karteikarten wiederholen nach dem Lernkasten-Prinzip, das Quiz prüft kurz ab.</p></div>'+
   '<div class="panel stack">'+
   '<div class="seg" role="group" aria-label="Methode"><button data-lmode="karten" aria-pressed="'+(UI.learnMode==='karten')+'">Karteikarten</button><button data-lmode="quiz" aria-pressed="'+(UI.learnMode==='quiz')+'">Quiz</button></div>'+
   '<div class="row" style="align-items:flex-end">'+
     '<div class="field" style="flex:1 1 240px"><label class="label" for="deck">Stapel</label><select class="inp" id="deck" data-change="deck">'+deckOptions(UI.deck)+'</select></div>'+
     '<div class="field" style="flex:1 1 200px"><label class="label" for="dir">Richtung</label><select class="inp" id="dir" data-change="dir"><option value="t2d"'+(UI.dir==='t2d'?' selected':'')+'>Tirolerisch → Hochdeutsch</option><option value="d2t"'+(UI.dir==='d2t'?' selected':'')+'>Hochdeutsch → Tirolerisch</option></select></div>'+
   '</div>'+
   '<div class="small muted">'+cards.length+' Karten · '+c.due+' fällig · '+c.neu+' neu · '+c.sure+' sitzen fest</div>'+
   (cards.length ? '<div class="row">'+(UI.learnMode==='karten'
      ? '<button class="btn primary" data-act="fcstart">'+(c.due?'Fällige + neue lernen':'Neue Karten lernen')+'</button><button class="btn" data-act="fcall">Ganzen Stapel durchgehen</button>'
      : '<button class="btn primary" data-act="qstart">Quiz mit 10 Fragen</button>')+'</div>'
    : '<div class="empty">Dieser Stapel ist leer. Füg unter „Meine Listen" Karten hinzu oder lass sie von der KI erstellen.</div>')+
   '</div>'+
   '<p class="note">Sag jede Karte laut, bevor du sie umdrehst. Beim Dialekt hilft das Aussprechen mehr als das stille Lesen. Tastatur: Leertaste dreht um, 1 / 2 / 3 bewertet.</p></div>';
}
function startFlash(all){
  const cards = deckCards(UI.deck);
  let q;
  if (all) q = shuffle(cards);
  else {
    const due = shuffle(cards.filter(c=>isDue(c.id)));
    const neu = cards.filter(c=>!box(c.id)).slice(0, Math.max(0, 15 - due.length));
    q = [...due, ...neu];
    if (!q.length) { toast('Heute ist nichts fällig. Du kannst den ganzen Stapel durchgehen.'); return; }
  }
  FC = {q, done:0, total:q.length, flip:false, again:new Set(), stats:{good:0,hard:0,again:0}};
  cur = 'lernen'; renderTabs(); render();
}
function vFlash(){
  if (!FC.q.length) {
    const s = FC.stats;
    return '<div class="panel stack" style="max-width:560px;margin:0 auto;text-align:center;align-items:center"><div class="label">Fertig</div><h2 class="dia" style="font-size:34px">Bärig!</h2>'+
      '<p class="muted" style="margin:0">'+s.good+' gewusst · '+s.hard+' schwer · '+s.again+' nochmal</p><div class="row"><button class="btn primary" data-act="fcend">Zurück</button></div></div>';
  }
  const c = FC.q[0];
  const front = UI.dir==='t2d' ? '<div class="big dia">'+esc(c.t)+'</div>' : '<div class="big ui">'+esc(c.d)+'</div>';
  const back = UI.dir==='t2d' ? '<div class="big ui">'+esc(c.d)+'</div><div class="dia muted" style="font-size:20px">'+esc(c.t)+'</div>' : '<div class="big dia">'+esc(c.t)+'</div><div class="muted">'+esc(c.d)+'</div>';
  const pct = Math.round(FC.done / (FC.total + FC.again.size) * 100);
  const nextInt = INTERVAL[Math.min(5,box(c.id)+1)];
  return '<div class="stack">'+
   '<div class="row between"><button class="btn ghost small" data-act="fcend">← Beenden</button><span class="small muted">'+esc(deckName(UI.deck))+' · noch '+FC.q.length+'</span></div>'+
   '<div class="progress"><i style="width:'+pct+'%"></i></div>'+
   '<div class="card-stage"><div class="fcard'+(FC.flip?' flip':'')+'" data-act="flip" role="button" tabindex="0" aria-label="Karte umdrehen">'+
     '<div class="face"><div class="corner"><span class="label">'+(UI.dir==='t2d'?'Tirolerisch':'Hochdeutsch')+'</span>'+dots(c.id)+'</div>'+front+'<div class="small muted">Tippen zum Umdrehen</div></div>'+
     '<div class="face back"><div class="corner"><span class="label">'+(UI.dir==='t2d'?'Hochdeutsch':'Tirolerisch')+'</span>'+dots(c.id)+'</div>'+back+(c.n?'<div class="small muted" style="font-style:italic;max-width:40ch">'+esc(c.n)+'</div>':'')+'</div>'+
   '</div></div>'+
   (FC.flip ? '<div class="rate"><button class="btn again" data-grade="again">Nochmal<small>kommt gleich wieder</small></button><button class="btn" data-grade="hard">Schwer<small>morgen wieder</small></button><button class="btn good" data-grade="good">Gewusst<small>'+nextInt+(nextInt===1?' Tag':' Tage')+'</small></button></div>'
     : '<div class="row" style="justify-content:center"><button class="btn primary" data-act="flip">Umdrehen</button></div>')+
   '</div>';
}
function startQuiz(){
  const cards = deckCards(UI.deck);
  if (!cards.length) return;
  const pool = cards.length >= 4 ? cards : [...cards, ...BUILTIN];
  const items = shuffle(cards).slice(0, 10).map(c => {
    const key = UI.dir==='t2d' ? 'd' : 't';
    const others = shuffle(pool.filter(o => o[key] !== c[key])).reduce((a,o)=>{ if (a.length<3 && !a.some(x=>x[key]===o[key])) a.push(o); return a; }, []);
    return {c, opts: shuffle([c, ...others]).map(o=>o[key]), ans:c[key]};
  });
  Q = {items, i:0, score:0, picked:null, wrong:[]};
  cur = 'lernen'; renderTabs(); render();
}
function vQuiz(){
  if (Q.i >= Q.items.length) {
    return '<div class="panel stack" style="max-width:560px;margin:0 auto;text-align:center;align-items:center"><div class="label">Ergebnis</div><h2 class="dia" style="font-size:40px">'+Q.score+' / '+Q.items.length+'</h2>'+
     '<p class="muted" style="margin:0">'+(Q.score===Q.items.length?'Alles richtig. Des isch bärig!':Q.wrong.length+' falsche Antworten kommen heute als Karteikarte nochmal dran.')+'</p>'+
     '<div class="row"><button class="btn" data-act="qend">Zurück</button><button class="btn primary" data-act="qstart">Neues Quiz</button></div></div>';
  }
  const it = Q.items[Q.i];
  const prompt = UI.dir==='t2d' ? '<div class="dia" style="font-size:30px">'+esc(it.c.t)+'</div>' : '<div style="font-size:22px;font-weight:600">'+esc(it.c.d)+'</div>';
  return '<div class="stack" style="max-width:600px;margin:0 auto;width:100%">'+
   '<div class="row between"><button class="btn ghost small" data-act="qend">← Beenden</button><span class="small muted">Frage '+(Q.i+1)+' von '+Q.items.length+' · '+Q.score+' richtig</span></div>'+
   '<div class="progress"><i style="width:'+Math.round(Q.i/Q.items.length*100)+'%"></i></div>'+
   '<div class="panel stack"><div class="label">'+(UI.dir==='t2d'?'Was heißt das auf Hochdeutsch?':'Wie sagt man das auf Tirolerisch?')+'</div>'+prompt+
   '<div class="opts">'+it.opts.map((o,k)=>{
      let cls = 'opt' + (UI.dir==='d2t'?' dia':'');
      if (Q.picked!==null) { if (o===it.ans) cls+=' ok'; else if (k===Q.picked) cls+=' bad'; }
      return '<button class="'+cls+'" data-qpick="'+k+'"'+(Q.picked!==null?' disabled':'')+'>'+esc(o)+'</button>';
    }).join('')+'</div>'+
   (Q.picked!==null ? (it.c.n?'<div class="small muted"><i>'+esc(it.c.n)+'</i></div>':'')+'<div class="row"><button class="btn primary" data-act="qnext">'+(Q.i+1<Q.items.length?'Weiter':'Ergebnis')+'</button></div>' : '')+
   '</div></div>';
}

function vLaute(){
  if (RQ) return vRuleQuiz();
  return '<div class="stack"><div><h2 style="font-size:22px">Lautregeln</h2><p class="muted" style="margin:.3em 0 0;max-width:62ch">Wer die Muster kennt, kann viele Wörter selbst ableiten. Die Regeln gelten nicht ausnahmslos, aber sie erklären den Großteil dessen, was man in Innsbruck hört.</p></div>'+
   '<div class="row"><button class="btn primary" data-act="rqstart">Regel-Quiz starten</button></div>'+
   '<section class="panel">'+RULES.map(r=>'<div class="rule"><div class="pat">'+esc(r.pat)+'</div><div class="stack" style="gap:6px"><div>'+esc(r.txt)+'</div><div class="ex">'+r.ex.map(e=>'<span><span class="muted">'+esc(e[0])+'</span> → <b>'+esc(e[1])+'</b></span>').join('')+'</div></div></div>').join('')+'</section></div>';
}
function startRuleQuiz(){ RQ = {items: shuffle(RULEQ).slice(0,12).map(q=>({q, opts:shuffle([q[1],...q[2]])})), i:0, score:0, picked:null}; render(); }
function vRuleQuiz(){
  if (RQ.i >= RQ.items.length) return '<div class="panel stack" style="max-width:560px;margin:0 auto;text-align:center;align-items:center"><div class="label">Ergebnis</div><h2 class="dia" style="font-size:40px">'+RQ.score+' / '+RQ.items.length+'</h2><div class="row"><button class="btn" data-act="rqend">Zu den Regeln</button><button class="btn primary" data-act="rqstart">Nochmal</button></div></div>';
  const it = RQ.items[RQ.i], q = it.q, rule = RULES[q[3]];
  return '<div class="stack" style="max-width:600px;margin:0 auto;width:100%">'+
   '<div class="row between"><button class="btn ghost small" data-act="rqend">← Beenden</button><span class="small muted">'+(RQ.i+1)+' von '+RQ.items.length+' · '+RQ.score+' richtig</span></div>'+
   '<div class="progress"><i style="width:'+Math.round(RQ.i/RQ.items.length*100)+'%"></i></div>'+
   '<div class="panel stack"><div class="label">Wie klingt das auf Tirolerisch?</div><div style="font-size:26px;font-weight:600">'+esc(q[0])+'</div>'+
   '<div class="opts">'+it.opts.map((o,k)=>{ let cls='opt dia'; if (RQ.picked!==null){ if(o===q[1]) cls+=' ok'; else if(k===RQ.picked) cls+=' bad'; } return '<button class="'+cls+'" data-rqpick="'+k+'"'+(RQ.picked!==null?' disabled':'')+'>'+esc(o)+'</button>'; }).join('')+'</div>'+
   (RQ.picked!==null ? '<div class="small"><b style="color:var(--accent)">'+esc(rule.pat)+'</b> <span class="muted">'+esc(q[4]||rule.txt)+'</span></div><div class="row"><button class="btn primary" data-act="rqnext">Weiter</button></div>' : '')+
   '</div></div>';
}

/* ---------- KI-Trainer ---------- */
function vKI(){
  const head = '<div><h2 style="font-size:22px">KI-Trainer</h2><p class="muted" style="margin:.3em 0 0;max-width:62ch">Sprich mit einer Tirolerin im Rollenspiel, lass dir Sätze übertragen oder ganze Kartensätze zu einem Thema erstellen.</p></div>'+
    '<div class="seg" role="group" aria-label="Werkzeug"><button data-kimode="rolle" aria-pressed="'+(UI.kiMode==='rolle')+'">Rollenspiel</button><button data-kimode="uebers" aria-pressed="'+(UI.kiMode==='uebers')+'">Übersetzen</button><button data-kimode="karten" aria-pressed="'+(UI.kiMode==='karten')+'">Karten erstellen</button></div>';
  if (!API.ready) return '<div class="stack">'+head+'<div class="empty">Die KI ist auf dieser Seite noch nicht eingerichtet.</div></div>';
  if (!API.user) return '<div class="stack">'+head+'<div class="empty stack" style="align-items:center">Melde dich an, um die KI zu nutzen. Das ist kostenlos.<button class="btn primary" data-act="login">Anmelden</button></div></div>';
  const body = UI.kiMode === 'rolle' ? vChat() : UI.kiMode === 'uebers' ? vTrans() : vGen();
  return '<div class="stack">'+head+body+'<p class="small muted" style="margin:0">Die KI kann sich im Dialekt irren. Was sicher stimmt, kannst du in der Community vorschlagen.</p></div>';
}
function parseAI(text){
  const o = {t:'', d:'', tip:''}; let last = null;
  String(text).split('\n').forEach(l => {
    const m = l.match(/^\s*\**\s*(TIROL|DEUTSCH|TIPP)\s*\**\s*:\s*(.*)$/i);
    if (m) { last = {tirol:'t', deutsch:'d', tipp:'tip'}[m[1].toLowerCase()]; o[last] = m[2].trim(); }
    else if (last && l.trim()) o[last] += ' ' + l.trim();
  });
  if (!o.t && !o.d) o.t = String(text).trim();
  return o;
}
function vChat(){
  if (!CH) return '<div class="panel stack"><div class="label">Situation wählen</div><div class="grid">'+ROLES.map(r=>'<button class="sit" data-role="'+r.id+'"><span class="dia" style="font-size:21px">'+esc(r.label)+'</span><span class="small muted">Du: '+esc(r.learner)+'</span></button>').join('')+'</div>'+
    '<p class="small muted" style="margin:0">Du kannst auf Hochdeutsch oder im Dialekt antworten. Jede Antwort kommt mit Übersetzung, und wenn du Hochdeutsch schreibst, zeigt dir die KI, wie man es auf Tirolerisch sagt.</p></div>';
  const r = ROLES.find(x=>x.id===CH.role);
  return '<div class="panel stack"><div class="row between"><div><div class="label">Rollenspiel</div><div style="font-weight:600">'+esc(r.label)+'</div></div><button class="btn ghost small" data-act="chend">Neue Situation</button></div>'+
   '<div class="chat" id="chat">'+CH.view.map((m,i)=>{
     if (m.me) return '<div class="msg me"><div>'+esc(m.text)+'</div></div>';
     const p = m.p || {};
     return '<div class="msg them"><div class="dia">'+esc(p.t||'')+'</div>'+(p.d?'<div class="hd">'+esc(p.d)+'</div>':'')+(p.tip?'<div class="tip"><b>Tipp:</b> '+esc(p.tip)+'</div>':'')+
       (p.t ? '<div><button class="btn ghost small" data-savechat="'+i+'">Als Karte merken</button></div>':'')+'</div>';
   }).join('')+(CH.busy?'<div class="msg them"><span class="muted small"><span class="spin"></span> denkt nach…</span></div>':'')+'</div>'+
   (CH.err?'<div class="err-text">'+esc(CH.err)+'</div>':'')+
   '<form class="row" data-form="chat"><input class="inp" id="chatIn" style="flex:1 1 220px" maxlength="500" placeholder="Deine Antwort, gern auch auf Hochdeutsch" autocomplete="off"'+(CH.busy?' disabled':'')+'>'+
   '<button class="btn primary" type="submit"'+(CH.busy?' disabled':'')+'>Senden</button></form></div>';
}
async function chatSend(userText){
  const chat = CH;
  if (userText) { chat.turns.push({role:'user', content:userText}); chat.view.push({me:true, text:userText}); }
  chat.busy = true; chat.err = ''; if (cur==='ki') render();
  try {
    const res = await API.ki({aufgabe:'rolle', rolle:chat.role, verlauf:chat.turns.slice(-18)});
    if (CH !== chat) return;
    chat.turns.push({role:'assistant', content:res.text});
    chat.view.push({p:parseAI(res.text)});
  } catch(e) { if (CH !== chat) return; chat.err = e.message; }
  chat.busy = false;
  if (cur==='ki') { render(); const i=$('#chatIn'); if (i) i.focus(); }
}
function vTrans(){
  TR = TR || {text:'', res:null, busy:false, err:''};
  return '<div class="panel stack"><form class="stack" data-form="trans"><div class="field"><label class="label" for="trIn">Hochdeutscher Satz</label><textarea class="inp" id="trIn" rows="2" maxlength="600" placeholder="z. B. Kannst du mir bitte die Butter geben?">'+esc(TR.text)+'</textarea></div>'+
   '<div class="row"><button class="btn primary" type="submit"'+(TR.busy?' disabled':'')+'>'+(TR.busy?'<span class="spin"></span> Überträgt…':'Auf Tirolerisch')+'</button></div></form>'+
   (TR.err?'<div class="err-text">'+esc(TR.err)+'</div>':'')+
   (TR.res ? '<div class="stack" style="gap:6px;border-top:1px solid var(--line);padding-top:14px"><div class="dia" style="font-size:28px;line-height:1.2">'+esc(TR.res.t)+'</div><div class="muted">'+esc(TR.res.d)+'</div>'+(TR.res.n?'<div class="small muted"><i>'+esc(TR.res.n)+'</i></div>':'')+
     '<div class="row small"><label class="muted" for="trTarget">Speichern in</label><select class="inp" id="trTarget" data-change="trTarget">'+listOptions(UI.trTarget)+'</select><button class="btn small" data-act="trsave">Als Karte speichern</button></div></div>' : '')+'</div>';
}
async function doTrans(text){
  TR = {text, res:null, busy:true, err:''}; render();
  try {
    const r = (await API.ki({aufgabe:'uebersetzen', text})).daten;
    if (!r || !r.t) throw new Error('Die Antwort war nicht lesbar. Probier es nochmal.');
    TR.res = {t:String(r.t), d:text, n:String(r.n||'')};
  } catch(e) { TR.err = e.message; }
  TR.busy = false; if (cur==='ki') render();
}
function vGen(){
  GEN = GEN || {topic:'', n:12, items:null, busy:false, err:''};
  return '<div class="panel stack"><form class="stack" data-form="gen">'+
   '<div class="row" style="align-items:flex-end"><div class="field" style="flex:3 1 240px"><label class="label" for="genTopic">Thema</label><input class="inp" id="genTopic" maxlength="200" placeholder="z. B. Beim Friseur, Skifahren, Essen bestellen" value="'+esc(GEN.topic)+'"></div>'+
   '<div class="field" style="flex:1 1 90px"><label class="label" for="genN">Anzahl</label><select class="inp" id="genN">'+[6,12,20].map(n=>'<option'+(GEN.n===n?' selected':'')+'>'+n+'</option>').join('')+'</select></div></div>'+
   '<div class="row"><button class="btn primary" type="submit"'+(GEN.busy?' disabled':'')+'>'+(GEN.busy?'<span class="spin"></span> Erstellt Karten…':'Karten erstellen')+'</button></div></form>'+
   (GEN.err?'<div class="err-text">'+esc(GEN.err)+'</div>':'')+
   (GEN.items ? '<div class="stack" style="gap:8px;border-top:1px solid var(--line);padding-top:14px"><div class="label">'+GEN.items.length+' Vorschläge · abwählen, was nicht passt</div>'+
     '<div class="gen-list">'+GEN.items.map((c,i)=>'<label class="gen-item" for="g'+i+'"><input type="checkbox" id="g'+i+'" data-genpick="'+i+'"'+(c.on?' checked':'')+'><span><span class="dia">'+esc(c.t)+'</span><br><span class="muted">'+esc(c.d)+'</span>'+(c.n?'<br><span class="small muted"><i>'+esc(c.n)+'</i></span>':'')+'</span></label>').join('')+'</div>'+
     '<div class="row small"><label class="muted" for="genTarget">Hinzufügen zu</label><select class="inp" id="genTarget" data-change="genTarget">'+listOptions(UI.genTarget)+'<option value="__new">Neue Liste „'+esc(GEN.topic.slice(0,40))+'"</option></select><button class="btn primary small" data-act="gensave">Ausgewählte speichern</button></div></div>' : '')+
   '</div>';
}
async function doGen(topic, n){
  GEN = {topic, n, items:null, busy:true, err:''}; render();
  const mine = GEN;
  try {
    const r = (await API.ki({aufgabe:'karten', thema:topic, anzahl:n})).daten;
    const arr = Array.isArray(r) ? r : (r && Array.isArray(r.cards) ? r.cards : []);
    mine.items = arr.filter(x=>x && x.t && x.d).slice(0,30).map(x=>({t:String(x.t), d:String(x.d), n:String(x.n||''), on:true}));
    if (!mine.items.length) { mine.items = null; mine.err = 'Es kamen keine brauchbaren Karten zurück. Probier ein genaueres Thema.'; }
  } catch(e) { mine.err = e.message; }
  mine.busy = false; if (cur==='ki' && GEN === mine) render();
}

/* ---------- Community ---------- */
function vCommunity(){
  const head = '<div><h2 style="font-size:22px">Community</h2><p class="muted" style="margin:.3em 0 0;max-width:64ch">Fehlt ein Wort oder eine Redewendung? Schlag sie vor. Sobald ein Vorschlag '+SCHWELLE+' Stimmen hat, kommt er automatisch in seine Situation und in die Karteikarten.</p></div>';
  if (!API.ready) return '<div class="stack">'+head+'<div class="empty">Die Community ist auf dieser Seite noch nicht eingerichtet.</div></div>';
  if (COM.state === 'error') return '<div class="stack">'+head+'<div class="empty stack" style="align-items:center">Die Vorschläge konnten nicht geladen werden.<button class="btn" data-act="comreload">Nochmal versuchen</button></div></div>';
  const dr = COM.draft;
  let form;
  if (!API.user) form = '<div class="panel row between"><span>Melde dich an, um Wörter vorzuschlagen und abzustimmen.</span><button class="btn primary" data-act="login">Anmelden</button></div>';
  else if (!API.name) form = '<div class="panel row between"><span>Leg zuerst einen Anzeigenamen fest. Er steht bei deinen Vorschlägen.</span><button class="btn primary" data-act="profil">Namen festlegen</button></div>';
  else form = '<form class="panel stack" data-form="propose"><div class="label">Neuer Vorschlag</div><div class="addform">'+
      '<div class="field"><label class="label" for="cpT">Tirolerisch</label><input class="inp" id="cpT" data-draft="t" maxlength="120" required placeholder="Des isch a Gaudi!" value="'+esc(dr.t)+'" autocomplete="off"></div>'+
      '<div class="field"><label class="label" for="cpD">Hochdeutsch</label><input class="inp" id="cpD" data-draft="d" maxlength="160" required placeholder="Das macht Spaß!" value="'+esc(dr.d)+'" autocomplete="off"></div>'+
      '<div class="field"><label class="label" for="cpS">Situation</label><select class="inp" id="cpS" data-draft="sit" required><option value="">Bitte wählen</option>'+SITS.map(s=>'<option value="'+s.id+'"'+(dr.sit===s.id?' selected':'')+'>'+esc(s.t)+' · '+esc(s.d)+'</option>').join('')+'</select></div>'+
      '<div class="field"><label class="label" for="cpN">Notiz (optional)</label><input class="inp" id="cpN" data-draft="n" maxlength="160" placeholder="Region, Aussprache, wann man es sagt" value="'+esc(dr.n)+'" autocomplete="off"></div>'+
      '</div>'+(COM.msg?'<div class="err-text">'+esc(COM.msg)+'</div>':'')+'<div class="row"><button class="btn primary" type="submit" id="cpSubmit">Vorschlagen</button><span class="small muted">Für eigene Vorschläge kannst du nicht selbst stimmen.</span></div></form>';
  const filters = [['offen','Offen'],['neu','Neueste'],['aufgenommen','Aufgenommen'],['meine','Meine']];
  if (API.isAdmin) filters.push(['pruefen','Zu prüfen']);
  return '<div class="stack">'+head+form+
    '<div class="seg" role="group" aria-label="Filter">'+filters.map(([k,l])=>'<button data-comfilter="'+k+'" aria-pressed="'+(COM.filter===k)+'">'+l+'</button>').join('')+'</div>'+
    '<div class="panel" id="comList"></div></div>';
}
function updateComList(){
  const el = $('#comList'); if (!el) return;
  if (COM.state !== 'on') { el.innerHTML = '<div class="muted"><span class="spin"></span> Vorschläge werden geladen…</div>'; return; }
  const me = API.user && API.user.id;
  let items = COM.list.slice();
  const f = COM.filter;
  if (f === 'offen') items = items.filter(i=>i.status==='offen').sort((a,b)=>b.stimmen-a.stimmen || String(b.created_at).localeCompare(String(a.created_at)));
  else if (f === 'neu') items = items.filter(i=>i.status==='offen'||i.status==='aufgenommen');
  else if (f === 'aufgenommen') items = items.filter(i=>i.status==='aufgenommen').sort((a,b)=>String(b.aufgenommen_at).localeCompare(String(a.aufgenommen_at)));
  else if (f === 'meine') items = items.filter(i=>i.user_id===me);
  else if (f === 'pruefen') items = items.filter(i=>i.status==='pruefen' || i.meldungen > 0);
  if (!items.length) {
    el.innerHTML = '<div class="empty" style="border:0">'+({offen:'Gerade wartet kein Vorschlag auf Stimmen. Fehlt dir etwas? Schlag es oben vor.', neu:'Noch keine Vorschläge. Mach den Anfang.', aufgenommen:'Noch ist kein Vorschlag auf '+SCHWELLE+' Stimmen gekommen.', meine:'Du hast noch nichts vorgeschlagen.', pruefen:'Nichts zu prüfen.'})[f]+'</div>';
    return;
  }
  const arrow = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 10.5 9h-9z"/></svg>';
  el.innerHTML = '<div class="citems">'+items.slice(0,300).map(i=>{
    const s = SITS.find(x=>x.id===i.sit), mine = i.user_id===me, on = COM.votes.has(i.id), busy = COM.busy.has(i.id);
    const date = i.created_at ? new Date(i.created_at).toLocaleDateString('de-AT',{day:'numeric',month:'short',year:'numeric'}) : '';
    let side;
    if (i.status === 'aufgenommen') side = '<div class="vote"><span class="done-badge">Aufgenommen</span><span class="small muted">'+i.stimmen+' Stimmen</span></div>';
    else if (i.status === 'pruefen') side = '<div class="vote"><span class="pill">Wird geprüft</span></div>';
    else if (i.status === 'entfernt') side = '<div class="vote"><span class="pill">Entfernt</span></div>';
    else side = '<div class="vote"><button class="vbtn" data-vote="'+esc(i.id)+'" aria-pressed="'+on+'" aria-label="'+(on?'Stimme zurückziehen':'Dafür stimmen')+'"'+(mine||!API.user||busy?' disabled':'')+' title="'+(mine?'Eigener Vorschlag':!API.user?'Zum Abstimmen anmelden':'')+'">'+arrow+i.stimmen+'</button>'+
      '<span class="bar" title="'+i.stimmen+' von '+SCHWELLE+' Stimmen"><i style="width:'+Math.min(100,Math.round(i.stimmen/SCHWELLE*100))+'%"></i></span><span class="small muted">noch '+Math.max(0,SCHWELLE-i.stimmen)+'</span></div>';
    let tools = '';
    if (COM.confirm && COM.confirm.id === i.id) {
      const label = {zurueck:'Wirklich zurückziehen', melden:'Wirklich melden', entfernen:'Wirklich entfernen'}[COM.confirm.what];
      tools = '<button class="btn small" data-comdo="'+esc(i.id)+'" style="color:var(--accent);border-color:var(--accent)">'+label+'</button><button class="btn ghost small" data-comconfirm="">Abbrechen</button>';
    } else {
      if (mine && (i.status === 'offen' || i.status === 'pruefen')) tools += '<button class="btn ghost small" data-comconfirm="'+esc(i.id)+'" data-what="zurueck">Zurückziehen</button>';
      if (!mine && API.user && !API.isAdmin) tools += '<button class="btn ghost small" data-comconfirm="'+esc(i.id)+'" data-what="melden">Melden</button>';
      if (API.isAdmin) {
        if (i.status !== 'aufgenommen' && i.status !== 'entfernt') tools += '<button class="btn ghost small" data-comstatus="'+esc(i.id)+'" data-to="aufgenommen">Direkt aufnehmen</button>';
        if (i.status === 'pruefen') tools += '<button class="btn ghost small" data-comstatus="'+esc(i.id)+'" data-to="offen">Freigeben</button>';
        if (i.status !== 'entfernt') tools += '<button class="btn ghost small" data-comconfirm="'+esc(i.id)+'" data-what="entfernen">Entfernen</button>';
        if (i.meldungen) tools += '<span class="pill">'+i.meldungen+' Meldung'+(i.meldungen>1?'en':'')+'</span>';
      }
    }
    return '<div class="citem"><div class="main"><div class="dia">'+esc(i.t)+'</div><div class="muted">'+esc(i.d)+'</div>'+(i.n?'<div class="small muted"><i>'+esc(i.n)+'</i></div>':'')+
      '<div class="meta"><span class="pill">'+esc(s?s.t:i.sit)+'</span><span>'+(mine?'von dir':'von '+esc(i.autor||'jemandem aus der Community'))+'</span><span>'+esc(date)+'</span>'+tools+'</div></div>'+side+'</div>';
  }).join('')+'</div>';
}
async function comVote(id){
  const it = COM.list.find(x=>x.id===id); if (!it || !API.user || COM.busy.has(id)) return;
  const on = COM.votes.has(id);
  COM.busy.add(id);
  if (on) { COM.votes.delete(id); it.stimmen--; } else { COM.votes.add(id); it.stimmen++; }
  updateComList();
  try {
    if (on) await API.unvote(id); else await API.vote(id);
    if (!on && it.stimmen >= SCHWELLE) { const s = SITS.find(x=>x.id===it.sit); toast('Aufgenommen in „'+(s?s.t:'')+'"'); loadAccepted(); }
  } catch(e) {
    if (on) { COM.votes.add(id); it.stimmen++; } else { COM.votes.delete(id); it.stimmen--; }
    toast('Deine Stimme konnte nicht gespeichert werden.');
  }
  COM.busy.delete(id);
  loadCommunity();
}

/* ---------- Meine Listen ---------- */
function vListen(){
  if (!S.lists.find(l=>l.id===UI.list)) UI.list = S.lists[0].id;
  const l = S.lists.find(x=>x.id===UI.list);
  return '<div class="stack"><div><h2 style="font-size:22px">Meine Listen</h2><p class="muted" style="margin:.3em 0 0">Eigene Vokabellisten anlegen, Karten von Hand eintragen oder im KI-Trainer erstellen lassen.</p></div>'+
   '<div class="lists"><div class="stack" style="gap:10px"><div class="listnav">'+S.lists.map(x=>'<button data-list="'+esc(x.id)+'" aria-current="'+(x.id===UI.list)+'"><span>'+esc(x.name)+'</span><span>'+x.cards.length+'</span></button>').join('')+'</div>'+
   '<form class="row" data-form="newlist"><input class="inp" id="newListName" style="flex:1 1 120px" maxlength="40" placeholder="Neue Liste" autocomplete="off"><button class="btn small" type="submit">Anlegen</button></form>'+
   '<button class="btn ghost small" data-kigo="karten" style="align-self:flex-start">Liste von der KI erstellen lassen</button></div>'+
   '<div class="panel stack">'+
     '<div class="row between"><h3 style="font-size:20px">'+esc(l.name)+'</h3><div class="row"><button class="btn small" data-learn="list:'+esc(l.id)+'" data-mode="karten"'+(l.cards.length?'':' disabled')+'>Karteikarten</button><button class="btn small" data-learn="list:'+esc(l.id)+'" data-mode="quiz"'+(l.cards.length?'':' disabled')+'>Quiz</button>'+
     (l.id!=='merk' ? (UI.confirmDel===l.id ? '<button class="btn small" data-act="dellist" style="color:var(--accent);border-color:var(--accent)">Wirklich löschen</button><button class="btn ghost small" data-act="nodel">Abbrechen</button>' : '<button class="btn ghost small" data-act="askdel">Liste löschen</button>') : '')+'</div></div>'+
     '<form class="addform" data-form="addcard"><div class="field"><label class="label" for="acT">Tirolerisch</label><input class="inp" id="acT" required maxlength="120" placeholder="Wås isch los?" autocomplete="off"></div>'+
     '<div class="field"><label class="label" for="acD">Hochdeutsch</label><input class="inp" id="acD" required maxlength="160" placeholder="Was ist los?" autocomplete="off"></div>'+
     '<div class="field full"><label class="label" for="acN">Notiz (optional)</label><input class="inp" id="acN" maxlength="160" placeholder="Aussprache, Region, wann man es sagt" autocomplete="off"></div>'+
     '<div class="full"><button class="btn primary small" type="submit">Karte hinzufügen</button></div></form>'+
     (l.cards.length ? '<div class="phrases">'+l.cards.map(c=>'<div class="phrase"><div class="dia">'+esc(c.t)+' '+dots(c.id)+'</div><div class="act"><button class="btn ghost small" data-delcard="'+esc(c.id)+'" aria-label="Karte löschen">Entfernen</button></div><div class="hd">'+esc(c.d)+'</div>'+(c.n?'<div class="nt">'+esc(c.n)+'</div>':'')+'</div>').join('')+'</div>'
       : '<div class="empty">Noch keine Karten. Trag oben eine ein, tipp in einer Situation auf „+ Liste" oder lass dir im KI-Trainer welche erstellen.</div>')+
   '</div></div></div>';
}

/* ---------- Ereignisse ---------- */
document.addEventListener('click', e => {
  if (e.target.id === 'overlay') { hideSheet(); return; }
  const t = e.target.closest('[data-tab],[data-go],[data-sit],[data-act],[data-add-builtin],[data-learn],[data-lmode],[data-grade],[data-qpick],[data-rqpick],[data-kimode],[data-role],[data-savechat],[data-genpick],[data-list],[data-delcard],[data-kigo],[data-reveal],[data-vote],[data-comfilter],[data-comconfirm],[data-comdo],[data-comstatus],[data-propose]');
  if (!t) return;
  const d = t.dataset;
  if (d.tab) return go(d.tab);
  if (d.go) return go(d.go);
  if (d.propose !== undefined) { COM.draft.sit = d.propose; COM.msg = ''; return go('community'); }
  if (d.comfilter) { COM.filter = d.comfilter; COM.confirm = null; return render(); }
  if (d.comconfirm !== undefined) { COM.confirm = d.comconfirm ? {id:d.comconfirm, what:d.what} : null; return updateComList(); }
  if (d.vote) return comVote(d.vote);
  if (d.comdo) {
    const c = COM.confirm; COM.confirm = null; if (!c) return;
    const act = c.what === 'zurueck' ? API.withdraw(c.id) : c.what === 'melden' ? API.report(c.id) : API.setStatus(c.id, 'entfernt');
    act.then(() => { toast({zurueck:'Vorschlag zurückgezogen', melden:'Danke, wir sehen uns das an', entfernen:'Vorschlag entfernt'}[c.what]); loadCommunity(); loadAccepted(); })
       .catch(err => { toast(err && err.code === '23505' ? 'Du hast das schon gemeldet.' : 'Das hat nicht geklappt.'); updateComList(); });
    return;
  }
  if (d.comstatus) { API.setStatus(d.comstatus, d.to).then(() => { toast(d.to==='aufgenommen'?'Aufgenommen':'Freigegeben'); loadCommunity(); loadAccepted(); }).catch(() => toast('Das hat nicht geklappt.')); return; }
  if (d.sit) { UI.sit = d.sit; if (cur !== 'situationen') go('situationen'); else { render(); window.scrollTo({top:0}); } return; }
  if (d.reveal !== undefined) { if (UI.cover) t.classList.toggle('shown'); return; }
  if (d.addBuiltin) { const c = builtinAll().find(x=>x.id===d.addBuiltin); if (c) addToList(cur==='situationen'?UI.target:'merk', c); return; }
  if (d.learn) { UI.deck = d.learn; UI.learnMode = d.mode; FC = null; Q = null; if (d.mode==='quiz') startQuiz(); else { startFlash(false); if (!FC) go('lernen'); } window.scrollTo({top:0}); return; }
  if (d.lmode) { UI.learnMode = d.lmode; return render(); }
  if (d.grade) {
    const c = FC.q.shift(); grade(c.id, d.grade); FC.stats[d.grade]++;
    if (d.grade === 'again' && !FC.again.has(c.id)) { FC.again.add(c.id); FC.q.push(c); } else FC.done++;
    FC.flip = false; persist(); return render();
  }
  if (d.qpick) { if (Q.picked!==null) return; const k = +d.qpick, it = Q.items[Q.i]; Q.picked = k; if (it.opts[k]===it.ans) { Q.score++; grade(it.c.id,'good'); } else { Q.wrong.push(it.c.id); grade(it.c.id,'again'); } persist(); return render(); }
  if (d.rqpick) { if (RQ.picked!==null) return; const k=+d.rqpick, it=RQ.items[RQ.i]; RQ.picked=k; if (it.opts[k]===it.q[1]) RQ.score++; return render(); }
  if (d.kimode) { UI.kiMode = d.kimode; return render(); }
  if (d.kigo) { UI.kiMode = d.kigo; return go('ki'); }
  if (d.role) { CH = {role:d.role, turns:[{role:'user', content:'Beginne das Gespräch mit deinem ersten Satz.'}], view:[], busy:false, err:''}; chatSend(null); return; }
  if (d.savechat) { const m = CH.view[+d.savechat]; if (m && m.p) addToList('merk', {t:m.p.t, d:m.p.d||'', n:'Aus dem Rollenspiel'}); return; }
  if (d.genpick) { const it = GEN.items[+d.genpick]; if (it) it.on = t.checked; return; }
  if (d.list) { UI.list = d.list; UI.confirmDel = null; return render(); }
  if (d.delcard) { const l = S.lists.find(x=>x.id===UI.list); l.cards = l.cards.filter(c=>c.id!==d.delcard); delete S.prog[d.delcard]; persist(); return render(); }
  switch (d.act) {
    case 'login': loginSheet(); break;
    case 'logout': API.logout(); break;
    case 'profil': nameSheet('', false); break;
    case 'closesheet': hideSheet(); break;
    case 'comreload': COM.state = 'off'; render(); loadCommunity(); break;
    case 'quickstart': {
      UI.deck = 'all'; UI.learnMode = 'karten';
      if (!counts(builtinAll()).due) { const l = S.lists.find(l=>counts(l.cards).due); if (l) UI.deck = 'list:'+l.id; }
      startFlash(false); if (!FC) go('lernen'); break; }
    case 'sitback': UI.sit = null; render(); break;
    case 'cover': UI.cover = !UI.cover; render(); break;
    case 'fcstart': startFlash(false); break;
    case 'fcall': startFlash(true); break;
    case 'flip': if (FC) { FC.flip = !FC.flip; render(); } break;
    case 'fcend': FC = null; render(); break;
    case 'qstart': startQuiz(); break;
    case 'qnext': Q.i++; Q.picked = null; render(); break;
    case 'qend': Q = null; render(); break;
    case 'rqstart': startRuleQuiz(); break;
    case 'rqnext': RQ.i++; RQ.picked = null; render(); break;
    case 'rqend': RQ = null; render(); break;
    case 'chend': CH = null; render(); break;
    case 'trsave': if (TR && TR.res) addToList(UI.trTarget, TR.res); break;
    case 'gensave': {
      const pick = GEN.items.filter(x=>x.on); if (!pick.length) { toast('Keine Karte ausgewählt'); break; }
      let l;
      if (UI.genTarget === '__new') { l = {id:'l'+uid(), name:(GEN.topic||'KI-Liste').slice(0,40), cards:[]}; S.lists.push(l); }
      else l = S.lists.find(x=>x.id===UI.genTarget) || S.lists[0];
      let n = 0; pick.forEach(c => { if (!l.cards.some(x=>x.t===c.t && x.d===c.d)) { l.cards.push({id:'c:'+uid(), t:c.t, d:c.d, n:c.n}); n++; } });
      persist(); toast(n+' Karten in „'+l.name+'" gespeichert'); UI.genTarget = l.id; GEN.items = null; render(); break; }
    case 'askdel': UI.confirmDel = UI.list; render(); break;
    case 'nodel': UI.confirmDel = null; render(); break;
    case 'dellist': { const l = S.lists.find(x=>x.id===UI.list); if (l && l.id!=='merk') { l.cards.forEach(c=>delete S.prog[c.id]); S.lists = S.lists.filter(x=>x!==l); UI.list = 'merk'; UI.confirmDel = null; persist(); toast('Liste gelöscht'); render(); } break; }
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#overlay').hidden) { hideSheet(); return; }
  if (cur==='lernen' && FC && FC.q.length && !e.target.closest('input,textarea,select')) {
    if (e.key===' ' || e.key==='Enter') { if (e.target.closest('button') && !e.target.closest('.fcard')) return; e.preventDefault(); FC.flip = !FC.flip; render(); }
    else if (FC.flip && ['1','2','3'].includes(e.key)) { const b = document.querySelector('[data-grade="'+['again','hard','good'][+e.key-1]+'"]'); if (b) b.click(); }
  }
});
document.addEventListener('input', e => { const k = e.target.dataset && e.target.dataset.draft; if (k) COM.draft[k] = e.target.value; });
document.addEventListener('change', e => {
  const k = e.target.dataset.change;
  if (!k) return;
  UI[k] = e.target.value;
  if (k === 'deck' || k === 'dir') render();
});
document.addEventListener('submit', async e => {
  const f = e.target.dataset.form; if (!f) return;
  e.preventDefault();
  if (f === 'login') {
    const mail = $('#loginMail').value.trim(); if (!mail) return;
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try { await API.sendLink(mail); showSheet('<h2>Schau in dein Postfach</h2><p style="margin:0">Wir haben einen Anmelde-Link an <b>'+esc(mail)+'</b> geschickt. Öffne ihn auf diesem Gerät, dann bist du angemeldet.</p><div class="row"><button class="btn" data-act="closesheet">Schließen</button></div>'); }
    catch(err) { loginSheet(err && err.status === 429 ? 'Zu viele Versuche. Warte kurz und probier es dann nochmal.' : 'Der Link konnte nicht gesendet werden. Stimmt die Adresse?'); }
    return;
  }
  if (f === 'name') {
    const name = $('#nameIn').value.trim();
    if (name.length < 2) return nameSheet('Mindestens 2 Zeichen.', !API.name);
    try { await API.setName(name); hideSheet(); renderAccount(); render(); toast('Name gespeichert'); }
    catch(err) { nameSheet(err && err.code === '23505' ? 'Diesen Namen gibt es schon. Nimm einen anderen.' : 'Speichern hat nicht geklappt.', !API.name); }
    return;
  }
  if (f === 'propose') {
    const dr = {t:$('#cpT').value.trim(), d:$('#cpD').value.trim(), sit:$('#cpS').value, n:$('#cpN').value.trim()};
    COM.draft = {...dr};
    if (!dr.t || !dr.d || !dr.sit) { COM.msg = 'Bitte Tirolerisch, Hochdeutsch und Situation ausfüllen.'; return render(); }
    const nt = norm(dr.t);
    if (BUILTIN.some(c=>norm(c.t)===nt)) { COM.msg = 'Das steht schon in den Situationen.'; return render(); }
    const dup = COM.list.find(c=>norm(c.t)===nt && c.status!=='entfernt');
    if (dup) { COM.msg = dup.status==='aufgenommen' ? 'Das wurde schon aufgenommen.' : 'Das hat schon jemand vorgeschlagen. Stimm dort dafür.'; COM.filter = 'offen'; return render(); }
    const btn = $('#cpSubmit'); if (btn) btn.disabled = true;
    try {
      await API.propose(dr);
      COM.draft = {t:'', d:'', sit:'', n:''}; COM.msg = ''; COM.filter = 'meine';
      toast('Vorschlag eingereicht'); await loadCommunity(); render();
    } catch(err) { COM.msg = fehlerText(err, 'Der Vorschlag konnte nicht gespeichert werden.'); render(); }
    return;
  }
  if (f === 'chat') { const v = $('#chatIn').value.trim(); if (v && CH && !CH.busy) chatSend(v); }
  if (f === 'trans') { const v = $('#trIn').value.trim(); if (v) doTrans(v); }
  if (f === 'gen') { const v = $('#genTopic').value.trim(); if (!v) { toast('Gib ein Thema ein'); return; } doGen(v, +$('#genN').value); }
  if (f === 'newlist') { const v = $('#newListName').value.trim(); if (!v) return; const l = {id:'l'+uid(), name:v.slice(0,40), cards:[]}; S.lists.push(l); UI.list = l.id; persist(); render(); }
  if (f === 'addcard') {
    const t = $('#acT').value.trim(), dd = $('#acD').value.trim(), n = $('#acN').value.trim();
    if (!t || !dd) return;
    const l = S.lists.find(x=>x.id===UI.list); l.cards.unshift({id:'c:'+uid(), t, d:dd, n}); persist(); render(); $('#acT').focus();
  }
});

/* ---------- Start ---------- */
(async function boot(){
  const h = (location.hash||'').slice(1);
  if (TABS.some(x=>x[0]===h)) cur = h;
  renderTabs(); render();
  try { await API.init(); } catch(e) { console.error(e); }
  renderAccount();
  if (API.ready) {
    loadAccepted(); loadCommunity();
    if (API.user) { syncState(); if (!API.name) nameSheet('', true); }
  }
  render();
})();
