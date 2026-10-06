const TIERS = [
  {id:"elite",  name:"Elite",          c:"var(--t-elite)", light:true},
  {id:"awesome",name:"Awesome",        c:"var(--t-awesome)", light:true},
  {id:"great",  name:"Great",          c:"var(--t-great)"},
  {id:"good",   name:"Good",           c:"var(--t-good)"},
  {id:"ok",     name:"Ok",             c:"var(--t-ok)"},
  {id:"skip",   name:"Could skip",     c:"var(--t-skip)"},
  {id:"bad",    name:"Bad",            c:"var(--t-bad)"},
  {id:"dr",     name:"Don't remember", c:"var(--t-dr)", light:true},
];
const TIER = Object.fromEntries(TIERS.map(t=>[t.id,t]));

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = d => { if(!d) return ""; const [y,m,dd]=d.split("-").map(Number); return `${MONTHS[m-1]} ${dd}, ${y}`; };
const hash = s => { let h=2166136261; for(const c of s){h^=c.charCodeAt(0); h=Math.imul(h,16777619);} return h>>>0; };
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
const clone = o => JSON.parse(JSON.stringify(o));
const ALASKA = new Set(["Denali","Gates of the Arctic","Glacier Bay","Katmai","Kenai Fjords","Kobuk Valley","Lake Clark","Wrangell–St. Elias","Wrangell-St. Elias"]);
/* ---------- state ---------- */
const CFG = window.PARKLOG_CONFIG || {};
const CONFIGURED = !!(CFG.supabaseUrl && CFG.supabaseKey && !/YOUR-/.test(CFG.supabaseUrl + CFG.supabaseKey));
const sb = (CONFIGURED && window.supabase) ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey) : null;
const CACHE_KEY = "parklog-cache-v2";

let state = {parks:[], stamps:[], never:[]};
let journal = {};
let session = null, editMode = false, canWrite = true;

const parkById = id => state.parks.find(p=>p.id===id);
const rankOf = id => state.parks.findIndex(p=>p.id===id) + 1;
function validData(d){ return d && Array.isArray(d.parks) && Array.isArray(d.stamps) && Array.isArray(d.never); }
function setData(d){
  state = clone({parks:d.parks, stamps:d.stamps, never:d.never});
  journal = clone(d.journal || {});
}
const snapshot = () => clone({parks:state.parks, stamps:state.stamps, never:state.never, journal});

function readCache(){ try{ return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); }catch(e){ return null; } }
function writeCache(dirty){ try{ localStorage.setItem(CACHE_KEY, JSON.stringify({data:snapshot(), dirty, at:Date.now()})); }catch(e){} }
async function fetchStarterData(){
  const r = await fetch("park-log-data.json", {cache:"no-cache"});
  if(!r.ok) throw new Error("Couldn't load park-log-data.json");
  return r.json();
}

let pushChain = Promise.resolve();
function push(){
  writeCache(true);
  if(!sb) return Promise.resolve({ok:true, note:"Saved on this device. Connect Supabase to sync it to your account."});
  if(!session) return Promise.resolve({ok:false, msg:"You're signed out. Sign in again to save to your account."});
  if(!navigator.onLine) return Promise.resolve({ok:true, note:"You're offline. Saved on this phone; it will sync when you're back online."});
  const row = {user_id: session.user.id, data: snapshot(), updated_at: new Date().toISOString()};
  pushChain = pushChain.then(async ()=>{
    const {error} = await sb.from("park_log").upsert(row, {onConflict:"user_id"});
    if(error) return {ok:false, msg:"Couldn't reach your account. Your change is saved on this device and will sync next time."};
    writeCache(false);
    return {ok:true};
  }).catch(()=>({ok:false, msg:"Couldn't reach your account. Your change is saved on this device and will sync next time."}));
  return pushChain;
}
const saveState = () => push();
const saveEntry = () => push();
function report(r, okMsg){ toast(r.ok ? (r.note || okMsg) : r.msg); }

/* ---------- guest view (read-only, no sign-in) ---------- */
const GUEST_KEY = "parklog-guest-v1";
const isGuest = () => !!sb && !session;
async function loadPublic(){
  let loaded = false;
  if(navigator.onLine){
    try{
      const {data, error} = await sb.from("park_log").select("data").limit(1).maybeSingle();
      if(!error && data && validData(data.data)){
        setData(data.data); loaded = true;
        try{ localStorage.setItem(GUEST_KEY, JSON.stringify(data.data)); }catch(e){}
      }
    }catch(e){}
  }
  if(!loaded){
    let g = null; try{ g = JSON.parse(localStorage.getItem(GUEST_KEY) || "null"); }catch(e){}
    if(validData(g)) setData(g);
    else { try{ setData(await fetchStarterData()); }catch(e){} }
  }
}

async function pull(){
  if(!sb || !session || !navigator.onLine || busy) return;
  const cached = readCache();
  if(cached && cached.dirty){ if(validData(cached.data)) setData(cached.data); renderAll(); report(await push(), "Changes you made offline are synced."); return; }
  const {data, error} = await sb.from("park_log").select("data").maybeSingle();
  if(error){ toast("Couldn't load from your account. Showing what's saved on this device."); return; }
  if(!data){
    if(!validData(state) || !state.parks.length) setData(await fetchStarterData());
    renderAll();
    report(await push(), "Your Park Log is set up and saved to your account.");
    return;
  }
  if(validData(data.data)){ setData(data.data); writeCache(false); if(!drag) renderAll(); }
}

let toastTimer;
function toast(msg, ms=3200){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toastTimer); if(ms) toastTimer=setTimeout(()=>t.classList.remove("show"), ms); }

/* ---------- live data ---------- */
function userIsTyping(){ const a=document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); }

/* ---------- stamps ---------- */
let stampSeq = 0;
function stampSVG(s){
  const h = hash(s.name+s.date+s.loc);
  const rot = (h % 25) - 12;
  const ink = `var(--stamp-${(h>>5)%4+1})`;
  const [y,m,d] = (s.date||"2000-01-01").split("-").map(Number);
  const id = "sp"+(stampSeq++);
  const ring = (s.name + "  ✦  " + s.loc + "  ✦  ").toUpperCase();
  const dash = s.park ? "" : 'stroke-dasharray="4 3"';
  const fs = ring.length > 58 ? 6.2 : ring.length > 44 ? 7.2 : 8.2;
  return `<svg viewBox="0 0 120 120" role="img" aria-label="${esc(s.name)}, ${esc(s.loc)}, ${fmtDate(s.date)}">
    <g transform="rotate(${rot} 60 60)" filter="url(#ink)" fill="${ink}" stroke="${ink}" opacity=".9">
      <circle cx="60" cy="60" r="56" fill="none" stroke-width="2.6" ${dash}/>
      <circle cx="60" cy="60" r="36" fill="none" stroke-width="1.2"/>
      <path id="${id}" d="M60,60 m-46,0 a46,46 0 1,1 92,0 a46,46 0 1,1 -92,0" fill="none" stroke="none"/>
      <text font-family="Big Shoulders Display, Arial Narrow, sans-serif" font-weight="800" font-size="${fs}" letter-spacing=".6" stroke="none"><textPath href="#${id}" textLength="286" lengthAdjust="spacingAndGlyphs">${esc(ring)}</textPath></text>
      <text x="60" y="58" text-anchor="middle" font-family="Big Shoulders Display, Arial Narrow, sans-serif" font-weight="900" font-size="17" stroke="none">${MONTHS[m-1].toUpperCase()} ${d}</text>
      <text x="60" y="76" text-anchor="middle" font-family="Big Shoulders Display, Arial Narrow, sans-serif" font-weight="800" font-size="15" stroke="none">${y}</text>
    </g></svg>`;
}

/* ---------- page renders ---------- */
const TIER_OPTIONS = sel => TIERS.map(t=>`<option value="${t.id}"${t.id===sel?" selected":""}>${t.name}</option>`).join("");
function tierChip(t){ const T=TIER[t]||TIER.ok; return `<span class="tier-chip" style="--c:${T.c}"><i></i>${T.name}</span>`; }

function renderHeader(){
  const n = state.parks.length, total = n + state.never.length;
  $("#headline").textContent = state.parks[0] ? `${state.parks[0].name} is number one.` : "Park Log";
  $("#tally").innerHTML = state.parks.map(p=>`<span class="v${p.tier==="elite"?" top":p.tier==="awesome"?" aw":""}"></span>`).join("") + state.never.map(()=>"<span></span>").join("");
  $("#tallyText").innerHTML = `<strong>${n} of ${total}</strong> national parks visited. Gold dots are my elite parks, green are awesome, and white are the ones still to go.`;
  $("#rankIntro").textContent = isGuest() ? `All ${n}, best to worst. Open a park to see my thoughts, hikes, and every stamp from it.` : `All ${n}, best to worst. Open a park to write about it, log your hikes, and see every stamp from that park.`;
  const left = state.never.length, ak = state.never.filter(x=>ALASKA.has(x)).length;
  $("#todoIntro").textContent = left ? `${left} park${left>1?"s":""} left to go${ak?`, ${ak} of them in Alaska`:""}.` : "Every park visited. Time to start over.";
}

function renderRanking(){
  $("#rankList").innerHTML = state.parks.map((p,i)=>{
    const j = journal[p.id] || {};
    const hikes = (j.hikes||[]).length;
    const miles = (j.hikes||[]).reduce((a,h)=>a+(parseFloat(h.miles)||0),0);
    const cov = coverOf(p.id);
    return `<li class="rank-row${p.tier==="elite"?" elite":""}" data-park="${p.id}">
      <button class="grip" type="button" data-grip aria-label="Move ${esc(p.name)}. Drag, or use the up and down arrow keys.">⠿</button>
      <div class="rank-num">${i+1}</div>
      <div class="row-main">
        <button class="name-btn" type="button"><h2 class="park-name">${esc(p.name)}</h2></button>
        <p class="park-meta"><span>${esc(p.state)}</span>${tierChip(p.tier)}</p>
        ${j.blurb ? `<p class="blurb">${esc(j.blurb)}</p>` : (isGuest() ? "" : `<p class="blurb empty">No thoughts written yet. Open to add them.</p>`)}
        ${hikes ? `<p class="hike-count">${hikes} hike${hikes>1?"s":""} logged${miles?`, ${+miles.toFixed(1)} miles`:""}</p>`:""}
      </div>
      ${cov ? `<img class="row-thumb" src="${esc(photoUrl(cov.thumb))}" alt="" loading="lazy" decoding="async" width="88" height="88">` : ""}
      <div class="latest">${p.latest || "—"}<small>${p.latest ? "last visit" : "year not logged"}</small></div>
    </li>`;
  }).join("");
}

function renderTiers(){
  $("#tierList").innerHTML = TIERS.map(t=>{
    const ps = state.parks.map((p,i)=>({...p,rank:i+1})).filter(p=>p.tier===t.id);
    return `<div class="tier-row${t.light?" light-label":""}" style="--c:${t.c}">
      <div class="tier-label">${t.name}</div>
      <div class="tier-parks">${ps.map(p=>`<button class="park-chip" data-park="${p.id}" type="button"><span>${p.rank}</span>${esc(p.name)}</button>`).join("")}</div>
    </div>`;
  }).join("");
}

function renderPassport(){
  const byYear = {};
  state.stamps.slice().sort((a,b)=>a.date.localeCompare(b.date)).forEach(s=>{ (byYear[s.date.slice(0,4)] ||= []).push(s); });
  $("#passportList").innerHTML = Object.keys(byYear).sort((a,b)=>b-a).map(y=>{
    const list = byYear[y];
    const parks = new Set(list.filter(s=>s.park).map(s=>s.park)).size;
    return `<div class="year-block">
      <div class="year-label">${y}<small>${list.length} stamp${list.length>1?"s":""}${parks?`, ${parks} park${parks>1?"s":""}`:""}</small></div>
      <div class="stamps">${list.map(s=>{
        const clickable = editMode || (s.park && parkById(s.park));
        return clickable ? `<button class="stamp${s.park?" np":""}" type="button" data-stamp="${s.id}">${stampSVG(s)}</button>` : `<div class="stamp">${stampSVG(s)}</div>`;
      }).join("")}</div>
    </div>`;
  }).join("") || `<p class="muted">No stamps yet. Turn on Edit to add your first one.</p>`;
}

function renderTodo(){
  $("#todoList").innerHTML = state.never.map((n,i)=>`<li><span class="nm">${esc(n)}</span>
    <span class="todo-actions"><button class="link-btn" type="button" data-visited="${i}">I went</button><button class="link-btn" type="button" data-unlist="${i}" aria-label="Remove ${esc(n)} from the list">Remove</button></span></li>`).join("");
}

function renderAll(){
  if(document.body.classList.contains("signed-out")) return;
  renderHeader(); renderRanking(); renderTiers(); renderPhotos(); renderPassport(); renderTodo();
  if(dlg.open && dlgMode && dlgMode.type==="park" && !editingBlurb && !userIsTyping()) renderDialog();
}

/* ---------- dialog ---------- */
const dlg = $("#dlg");
let dlgMode = null, editingBlurb = false;

function detailsForm(p, isNew){
  const n = state.parks.length + (isNew?1:0);
  const rank = isNew ? n : rankOf(p.id);
  return `<form class="details-form" id="detailsForm" autocomplete="off">
    <label class="full">Park name<input name="name" required value="${esc(p.name||"")}"></label>
    <label>State<input name="state" value="${esc(p.state||"")}"></label>
    <label>Tier<select name="tier">${TIER_OPTIONS(p.tier||"ok")}</select></label>
    <label>Rank (1 to ${n})<input name="rank" type="number" min="1" max="${n}" value="${rank}"></label>
    <label>Last visit year<input name="latest" type="number" min="1900" max="2100" inputmode="numeric" value="${p.latest||""}"></label>
    <label class="full">Known for<textarea name="known" style="min-height:4.5rem">${esc(p.known||"")}</textarea></label>
    <div class="row-btns full" style="margin-top:0">
      <button class="btn" type="submit">${isNew?"Add park":"Save details"}</button>
      ${isNew ? `<button class="btn ghost" type="button" data-close>Cancel</button>` : `<button class="btn danger" type="button" data-remove-park>Remove park</button>`}
    </div>
  </form>`;
}

function renderDialog(){
  if(!dlgMode) return;
  if(dlgMode.type==="new") return renderNewPark();
  if(dlgMode.type==="stamp") return renderStampDialog();
  const id = dlgMode.id; const p = parkById(id);
  if(!p){ dlg.close(); return; }
  const T = TIER[p.tier]||TIER.ok;
  const j = journal[id] || {blurb:"",hikes:[]};
  const st = state.stamps.filter(s=>s.park===id).sort((a,b)=>a.date.localeCompare(b.date));
  const hikes = (j.hikes||[]).slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const cov = coverOf(id), photos = photosOf(id), owner = canPhoto();
  dlg.innerHTML = `
    <div class="dlg-head${cov?" has-cover":(T.light?" light-label":"")}" style="--c:${T.c}">
      ${cov ? `<img class="head-img" src="${esc(photoUrl(cov.full))}" alt="">` : ""}
      <button class="close-btn" type="button" data-close aria-label="Close">×</button>
      <div class="rk"><i class="tier-dot"></i>#${rankOf(id)} of ${state.parks.length}, ${T.name}</div>
      <h2 id="dlgTitle">${esc(p.name)}</h2>
      <p>${esc(p.state)}${p.latest?`, last visited ${p.latest}`:""}</p>
    </div>
    <div class="dlg-body">
      ${editMode ? `<div class="edit-panel"><h3>Park details</h3>${detailsForm(p,false)}</div>` : (p.known?`<p class="known">${esc(p.known)}</p>`:"")}

      ${(photos.length || owner) ? `<div>
        <h3>Photos ${owner ? `<label class="link-btn photo-pick">Add photos<input type="file" accept="image/*" multiple data-photo-input="${id}"></label>` : ""}</h3>
        ${photos.length ? `<div class="photo-strip">${photos.map((ph,i)=>`<button class="photo-tile" type="button" data-view-park="${id}" data-index="${i}" aria-label="Open photo ${i+1} of ${photos.length}"><img src="${esc(photoUrl(ph.thumb))}" alt="${esc(ph.caption||"")}" loading="lazy" decoding="async">${photos.length>1 && cov && cov.id===ph.id ? `<span class="cover-tag">Cover</span>` : ""}</button>`).join("")}</div>`
          : `<p class="muted" style="margin:0">No photos yet. Add some from your phone's photo library or your computer.</p>`}
      </div>` : ""}

      <div>
        <h3>My thoughts ${!editingBlurb && !isGuest() ? `<button class="link-btn" type="button" data-edit>${j.blurb?"Edit":"Write"}</button>`:""}</h3>
        ${editingBlurb
          ? `<textarea id="blurbInput" aria-label="Your thoughts on ${esc(p.name)}" placeholder="What made it great (or not)? Best moment, what you'd do differently, who should go.">${esc(j.blurb||"")}</textarea>
             <div class="row-btns"><button class="btn" type="button" data-save>Save thoughts</button><button class="btn ghost" type="button" data-cancel>Cancel</button></div>`
          : (j.blurb ? `<p style="margin:0;white-space:pre-wrap">${esc(j.blurb)}</p>` : `<p class="muted" style="margin:0">Nothing written yet.</p>`)}
      </div>

      <div>
        <h3>Hikes</h3>
        ${hikes.length ? `<ul class="hikes">${hikes.map(h=>`<li><span>${esc(h.name)}</span><span class="mi">${h.miles?esc(h.miles)+" mi":""}</span><span class="dt">${h.date?fmtDate(h.date):""}${isGuest() ? "" : ` <button class="link-btn" type="button" data-del="${esc(h.key)}" aria-label="Remove ${esc(h.name)}">Remove</button>`}</span></li>`).join("")}</ul>` : `<p class="muted" style="margin:0">No hikes logged yet.</p>`}
        ${isGuest() ? "" : `<form class="hike-form" id="hikeForm" autocomplete="off">
          <input name="name" placeholder="Trail name" aria-label="Trail name" required>
          <input name="miles" type="number" step="0.1" min="0" inputmode="decimal" placeholder="Miles" aria-label="Miles">
          <input name="date" type="date" aria-label="Date hiked">
          <button class="btn" type="submit">Add hike</button>
        </form>`}
      </div>

      <div>
        <h3>Passport stamps</h3>
        ${st.length ? `<div class="dlg-stamps">${st.map(s=>`<div class="stamp-wrap"><div class="stamp">${stampSVG(s)}</div>${editMode?`<button class="link-btn" type="button" data-del-stamp="${s.id}">Remove</button>`:""}</div>`).join("")}</div>
          <p class="muted" style="margin:.5rem 0 0;font-size:.95rem">${[...new Set(st.map(s=>s.date))].map(fmtDate).join(", ")}</p>`
          : `<p class="muted" style="margin:0">No stamps from this park in the book.</p>`}
        ${editMode ? `<form class="stamp-form" id="parkStampForm" autocomplete="off">
          <input name="loc" placeholder="Where (visitor center, town)" aria-label="Stamp location" required>
          <input name="date" type="date" aria-label="Stamp date" required>
          <button class="btn" type="submit">Add stamp</button>
        </form>`:""}
      </div>
    </div>`;
}

function renderNewPark(){
  dlg.innerHTML = `
    <div class="dlg-head plain">
      <button class="close-btn" type="button" data-close aria-label="Close">×</button>
      <div class="rk">New park</div>
      <h2 id="dlgTitle">${esc(dlgMode.prefill||"Add a park")}</h2>
      <p>It goes to the bottom of the ranking unless you pick a rank.</p>
    </div>
    <div class="dlg-body">${detailsForm({name:dlgMode.prefill||"", tier:"ok", latest:new Date().getFullYear()}, true)}</div>`;
}

function renderStampDialog(){
  const s = dlgMode.id ? state.stamps.find(x=>x.id===dlgMode.id) : {name:"",loc:"",date:"",park:null};
  if(!s){ dlg.close(); return; }
  const opts = `<option value="">Not a national park</option>` + state.parks.map(p=>`<option value="${p.id}"${p.id===s.park?" selected":""}>${esc(p.name)}</option>`).join("");
  dlg.innerHTML = `
    <div class="dlg-head plain">
      <button class="close-btn" type="button" data-close aria-label="Close">×</button>
      <div class="rk">${dlgMode.id?"Passport stamp":"New stamp"}</div>
      <h2 id="dlgTitle">${esc(s.name||"Add a stamp")}</h2>
      <p>${s.date?fmtDate(s.date):"Log a stamp from your passport book."}</p>
    </div>
    <div class="dlg-body">
      ${dlgMode.id ? `<div style="width:140px">${stampSVG(s)}</div>`:""}
      <form class="details-form" id="stampForm" autocomplete="off">
        <label>National park<select name="park">${opts}</select></label>
        <label>Stamp name<input name="name" value="${esc(s.name)}" placeholder="Filled in from the park if left blank"></label>
        <label>Location<input name="loc" required value="${esc(s.loc)}"></label>
        <label>Date<input name="date" type="date" required value="${esc(s.date)}"></label>
        <div class="row-btns full" style="margin-top:0">
          <button class="btn" type="submit">${dlgMode.id?"Save stamp":"Add stamp"}</button>
          ${dlgMode.id?`<button class="btn danger" type="button" data-del-stamp="${s.id}">Remove stamp</button>`:`<button class="btn ghost" type="button" data-close>Cancel</button>`}
        </div>
      </form>
    </div>`;
}

function openDialog(mode){
  dlgMode = mode; editingBlurb = false;
  renderDialog();
  if(!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}
dlg.addEventListener("close",()=>{ dlgMode=null; editingBlurb=false; });

function bumpLatest(parkId, date){
  const p = parkById(parkId); const y = parseInt((date||"").slice(0,4));
  if(p && y && (!p.latest || y > p.latest)) p.latest = y;
}

dlg.addEventListener("click", async e=>{
  if(e.target === dlg || e.target.closest("[data-close]")) { dlg.close(); return; }
  const vp = e.target.closest("[data-view-park]");
  if(vp){ openViewer({type:"park", id:vp.dataset.viewPark}, +vp.dataset.index); return; }
  if(e.target.closest("[data-edit]")) { editingBlurb = true; renderDialog(); $("#blurbInput").focus(); return; }
  if(e.target.closest("[data-cancel]")) { editingBlurb = false; renderDialog(); return; }
  if(e.target.closest("[data-save]")) {
    const id = dlgMode.id;
    journal[id] = {...(journal[id]||{hikes:[]}), blurb: $("#blurbInput").value.trim()};
    editingBlurb = false;
    renderRanking(); renderDialog();
    report(await saveEntry(id), "Thoughts saved.");
    return;
  }
  const del = e.target.closest("[data-del]");
  if(del){
    const id = dlgMode.id; const j = journal[id] || {hikes:[]};
    journal[id] = {...j, hikes:(j.hikes||[]).filter(h=>h.key!==del.dataset.del)};
    renderRanking(); renderDialog();
    report(await saveEntry(id), "Hike removed.");
    return;
  }
  const ds = e.target.closest("[data-del-stamp]");
  if(ds){
    const s = state.stamps.find(x=>x.id===ds.dataset.delStamp);
    if(!s || !confirm(`Remove the ${s.name} stamp from ${fmtDate(s.date)}?`)) return;
    state.stamps = state.stamps.filter(x=>x!==s);
    if(dlgMode.type==="stamp") dlg.close();
    renderAll();
    report(await saveState(), "Stamp removed.");
    return;
  }
  if(e.target.closest("[data-remove-park]")){
    const p = parkById(dlgMode.id);
    if(!confirm(`Remove ${p.name} from your ranking? Its stamps stay in the passport, and it goes back on your still-to-go list.`)) return;
    state.parks = state.parks.filter(x=>x!==p);
    state.stamps.forEach(s=>{ if(s.park===p.id) s.park = null; });
    if(!state.never.includes(p.name)) state.never.push(p.name);
    dlg.close(); renderAll();
    report(await saveState(), `${p.name} removed.`);
  }
});

dlg.addEventListener("submit", async e=>{
  e.preventDefault();
  const f = new FormData(e.target);
  const val = k => String(f.get(k)||"").trim();

  if(e.target.id === "hikeForm"){
    const id = dlgMode.id; const name = val("name"); if(!name) return;
    const hike = {key: uid(""), name, miles:val("miles"), date:val("date")};
    const j = journal[id] || {blurb:"",hikes:[]};
    journal[id] = {...j, hikes:[...(j.hikes||[]), hike]};
    renderRanking(); renderDialog();
    report(await saveEntry(id), `Added ${name}.`);
    return;
  }

  if(e.target.id === "detailsForm"){
    const isNew = dlgMode.type === "new";
    const name = val("name"); if(!name) return;
    const latest = parseInt(val("latest")) || null;
    let p;
    if(isNew){
      p = {id: uid("p"), name, state:"", tier:"ok", latest:null, known:""};
      state.parks.push(p);
      state.never = state.never.filter(n=>n.toLowerCase() !== name.toLowerCase() && n !== dlgMode.prefill);
    } else {
      p = parkById(dlgMode.id);
    }
    Object.assign(p, {name, state:val("state"), tier:val("tier")||"ok", latest, known:val("known")});
    const target = Math.min(Math.max(parseInt(val("rank")) || state.parks.length, 1), state.parks.length);
    state.parks = state.parks.filter(x=>x!==p); state.parks.splice(target-1, 0, p);
    dlgMode = {type:"park", id:p.id};
    renderAll(); renderDialog();
    report(await saveState(), isNew ? `${name} added at #${target}.` : "Details saved.");
    return;
  }

  if(e.target.id === "parkStampForm"){
    const p = parkById(dlgMode.id);
    const s = {id:uid("s"), name:p.name, loc:val("loc"), date:val("date"), park:p.id};
    if(!s.loc || !s.date) return;
    state.stamps.push(s); bumpLatest(p.id, s.date);
    renderAll(); renderDialog();
    report(await saveState(), "Stamp added.");
    return;
  }

  if(e.target.id === "stampForm"){
    const park = val("park") || null;
    const name = val("name") || (park ? parkById(park).name : "");
    if(!name){ toast("Give the stamp a name or pick its national park."); return; }
    const data = {name, loc:val("loc"), date:val("date"), park};
    if(dlgMode.id){ Object.assign(state.stamps.find(x=>x.id===dlgMode.id), data); }
    else { state.stamps.push({id:uid("s"), ...data}); }
    if(park) bumpLatest(park, data.date);
    const wasNew = !dlgMode.id;
    dlg.close(); renderAll();
    report(await saveState(), wasNew ? "Stamp added." : "Stamp saved.");
  }
});

/* ---------- drag to reorder ---------- */
let drag = null;
const list = $("#rankList");
function renumber(){ [...list.children].forEach((li,i)=>{ const n=li.querySelector(".rank-num"); if(n) n.textContent=i+1; }); }
async function commitOrder(){
  const ids = [...list.children].map(li=>li.dataset.park);
  const before = state.parks.map(p=>p.id).join();
  if(ids.join() === before){ return; }
  state.parks = ids.map(parkById).filter(Boolean);
  renderAll();
  report(await saveState(), "Ranking saved.");
}
list.addEventListener("pointerdown", e=>{
  const g = e.target.closest("[data-grip]"); if(!g || !editMode) return;
  e.preventDefault();
  const li = g.closest(".rank-row");
  drag = {li, moved:false};
  li.classList.add("dragging"); document.body.classList.add("dragging-any");
  try{ g.setPointerCapture(e.pointerId); }catch(_){}
});
list.addEventListener("pointermove", e=>{
  if(!drag) return;
  const y = e.clientY;
  const rows = [...list.children].filter(r=>r!==drag.li);
  let before = null;
  for(const r of rows){ const b=r.getBoundingClientRect(); if(y < b.top + b.height/2){ before=r; break; } }
  if(drag.li.nextElementSibling !== before || (before===null && list.lastElementChild!==drag.li)){
    list.insertBefore(drag.li, before); drag.moved = true; renumber();
  }
  if(y < 90) window.scrollBy(0,-14); else if(y > innerHeight-90) window.scrollBy(0,14);
});
function endDrag(){
  if(!drag) return;
  drag.li.classList.remove("dragging"); document.body.classList.remove("dragging-any");
  const moved = drag.moved; drag = null;
  if(moved) commitOrder();
}
list.addEventListener("pointerup", endDrag);
list.addEventListener("pointercancel", endDrag);
list.addEventListener("keydown", async e=>{
  const g = e.target.closest("[data-grip]"); if(!g || (e.key!=="ArrowUp" && e.key!=="ArrowDown")) return;
  e.preventDefault(); e.stopPropagation();
  const id = g.closest(".rank-row").dataset.park;
  const i = state.parks.findIndex(p=>p.id===id); const j = i + (e.key==="ArrowUp"?-1:1);
  if(j<0 || j>=state.parks.length) return;
  [state.parks[i], state.parks[j]] = [state.parks[j], state.parks[i]];
  renderAll();
  list.querySelector(`[data-park="${id}"] [data-grip]`).focus();
  report(await saveState(), `${parkById(id).name} moved to #${j+1}.`);
});

/* ---------- page wiring ---------- */
document.addEventListener("click", async e=>{
  if(dlg.contains(e.target)) return;
  if(e.target.closest("[data-grip]")) return;
  if(e.target.closest("[data-add-park]")) { openDialog({type:"new", prefill:""}); return; }
  if(e.target.closest("[data-add-stamp]")) { openDialog({type:"stamp", id:null}); return; }
  const vis = e.target.closest("[data-visited]");
  if(vis){ openDialog({type:"new", prefill:state.never[+vis.dataset.visited]}); return; }
  const un = e.target.closest("[data-unlist]");
  if(un){
    const name = state.never[+un.dataset.unlist];
    state.never.splice(+un.dataset.unlist,1); renderAll();
    report(await saveState(), `${name} removed from the list.`); return;
  }
  const stampEl = e.target.closest("[data-stamp]");
  if(stampEl){
    const s = state.stamps.find(x=>x.id===stampEl.dataset.stamp); if(!s) return;
    if(editMode) openDialog({type:"stamp", id:s.id});
    else if(s.park && parkById(s.park)) openDialog({type:"park", id:s.park});
    return;
  }
  const el = e.target.closest("[data-park]"); if(el) openDialog({type:"park", id:el.dataset.park});
});
$("#addTodo").addEventListener("submit", async e=>{
  e.preventDefault();
  const inp = e.target.elements.name; const name = inp.value.trim(); if(!name) return;
  if(!state.never.includes(name)) state.never.push(name);
  inp.value = ""; renderAll();
  report(await saveState(), `${name} added to the list.`);
});
$("#editToggle").addEventListener("click", ()=>{
  if(isGuest()) return;
  editMode = !editMode;
  document.body.classList.toggle("editing", editMode);
  const b = $("#editToggle"); b.setAttribute("aria-pressed", editMode); b.textContent = editMode ? "Done" : "Edit";
  renderAll();
  toast(editMode ? "Editing on. Drag parks to reorder, or open anything to change it." : "Editing off.");
});
document.querySelectorAll("nav.tabs [data-tab]").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll("nav.tabs [data-tab]").forEach(x=>x.setAttribute("aria-selected", x===b));
  document.querySelectorAll("main section").forEach(s=>s.hidden = s.id !== b.dataset.tab);
  const nav = document.querySelector("nav.tabs");
  if(nav.getBoundingClientRect().top <= 1) window.scrollTo({top: nav.offsetTop, behavior:"auto"});
}));


/* ---------- photos ---------- */
const BUCKET = "park-photos";
let busy = false;                       // true while photos are uploading
let photoFilter = "all";
const canPhoto = () => !!sb && !!session;
const photosOf = id => ((journal[id] && journal[id].photos) || []);
function coverOf(id){
  const j = journal[id]; const ps = photosOf(id);
  if(!ps.length) return null;
  return ps.find(x=>x.id === (j && j.cover)) || ps[0];
}
const photoUrl = path => (sb && path) ? sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : "";
function galleryItems(filter){
  const out = [];
  state.parks.forEach(p=>{ if(filter==="all" || filter===p.id) photosOf(p.id).forEach(ph=>out.push({park:p.id, photo:ph})); });
  return out;
}

function renderPhotos(){
  const all = galleryItems("all");
  const parksWith = state.parks.filter(p=>photosOf(p.id).length);
  if(photoFilter !== "all" && !parksWith.some(p=>p.id===photoFilter)) photoFilter = "all";
  const n = all.length, m = parksWith.length;
  $("#photosIntro").textContent = n
    ? `${n} photo${n>1?"s":""} from ${m} park${m>1?"s":""}, in ranking order. Tap any photo to see it full size.`
    : (canPhoto() ? "No photos yet. Pick a park, tap Add photos, and choose from your photo library or computer." : "No photos yet.");
  $("#photoFilters").innerHTML = m > 1
    ? [`<button type="button" data-pfilter="all" aria-pressed="${photoFilter==="all"}">All<span>${n}</span></button>`]
        .concat(parksWith.map(p=>`<button type="button" data-pfilter="${p.id}" aria-pressed="${photoFilter===p.id}">${esc(p.name)}<span>${photosOf(p.id).length}</span></button>`)).join("")
    : "";
  const up = $("#photoUpload"); up.hidden = !canPhoto();
  const sel = $("#photoPark"); const keep = photoFilter !== "all" ? photoFilter : sel.value;
  sel.innerHTML = state.parks.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join("");
  if(keep && parkById(keep)) sel.value = keep;
  const items = galleryItems(photoFilter);
  $("#photoGrid").innerHTML = items.map((it,i)=>`<button class="photo-tile" type="button" data-view-all="${i}" aria-label="${esc(parkById(it.park).name)} photo">
      <img src="${esc(photoUrl(it.photo.thumb))}" alt="${esc(it.photo.caption||"")}" loading="lazy" decoding="async">
      ${photoFilter==="all" ? `<span class="tile-label">${esc(parkById(it.park).name)}</span>` : ""}
    </button>`).join("");
}

/* resize on the device before upload: smaller files, and the GPS location is stripped */
function loadImage(file){
  return new Promise((res,rej)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>res({img, url});
    img.onerror = ()=>{ URL.revokeObjectURL(url); rej(new Error("unreadable")); };
    img.src = url;
  });
}
function drawScaled(src, sw, sh, max, quality){
  const s = Math.min(1, max / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw*s)), h = Math.max(1, Math.round(sh*s));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,w,h);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  return new Promise((res,rej)=>c.toBlob(b=>{ b ? res({blob:b, w, h, canvas:c}) : rej(new Error("encode")); }, "image/jpeg", quality));
}

async function uploadPhotos(parkId, files){
  const p = parkById(parkId);
  if(!canPhoto() || !p) return;
  if(busy){ toast("Still uploading the last batch. Give it a moment."); return; }
  if(!navigator.onLine){ toast("You're offline. Photos need a connection to upload."); return; }
  const list = files.filter(f=>/^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name||""));
  if(!list.length){ toast("Those files aren't photos."); return; }
  busy = true;
  let done = 0; const failed = [];
  try{
    for(let k=0; k<list.length; k++){
      const f = list[k];
      toast(`Uploading photo ${k+1} of ${list.length} to ${p.name}…`, 0);
      try{
        const {img, url} = await loadImage(f);
        const full = await drawScaled(img, img.naturalWidth, img.naturalHeight, 2048, 0.82);
        URL.revokeObjectURL(url);
        const thumb = await drawScaled(full.canvas, full.w, full.h, 640, 0.78);
        full.canvas.width = full.canvas.height = 0; thumb.canvas.width = thumb.canvas.height = 0;
        const id = uid("ph");
        const base = `${session.user.id}/${parkId}/${id}`;
        const store = sb.storage.from(BUCKET);
        const opts = {contentType:"image/jpeg", cacheControl:"31536000", upsert:false};
        let r = await store.upload(`${base}.jpg`, full.blob, opts);
        if(r.error) throw r.error;
        r = await store.upload(`${base}-t.jpg`, thumb.blob, opts);
        if(r.error){ await store.remove([`${base}.jpg`]); throw r.error; }
        const j = journal[parkId] || {blurb:"", hikes:[]};
        journal[parkId] = {...j, photos:[...(j.photos||[]), {id, full:`${base}.jpg`, thumb:`${base}-t.jpg`, w:full.w, h:full.h, caption:"", added:new Date().toISOString()}]};
        done++;
        renderAll();
        await push();
      }catch(err){
        console.warn("Photo upload failed:", f.name, err);
        failed.push(/heic|heif/i.test(f.name||"") || (err && err.message==="unreadable") ? `${f.name||"a photo"} (this browser can't open that format)` : (f.name||"a photo"));
      }
    }
  } finally {
    busy = false;
  }
  if(failed.length && done) toast(`Added ${done} photo${done>1?"s":""} to ${p.name}. Couldn't add: ${failed.join(", ")}.`, 7000);
  else if(failed.length) toast(`Couldn't add ${failed.join(", ")}. Check your connection and that you're signed in, then try again.`, 7000);
  else toast(`Added ${done} photo${done>1?"s":""} to ${p.name}.`);
}

document.addEventListener("change", e=>{
  const input = e.target.closest && e.target.closest("[data-photo-input]");
  if(!input) return;
  const files = [...(input.files||[])];
  input.value = "";
  const parkId = input.dataset.photoInput || $("#photoPark").value;
  if(files.length) uploadPhotos(parkId, files);
});

/* ---------- photo viewer ---------- */
const viewerEl = $("#viewer");
let viewer = {source:null, i:0, editing:false};
function viewerItems(){
  if(!viewer.source) return [];
  return viewer.source.type === "park"
    ? photosOf(viewer.source.id).map(ph=>({park:viewer.source.id, photo:ph}))
    : galleryItems(viewer.source.filter);
}
function openViewer(source, index){
  viewer = {source, i:index, editing:false};
  renderViewer();
  if(!viewerEl.open) viewerEl.showModal();
}
function renderViewer(){
  const items = viewerItems();
  if(!items.length){ if(viewerEl.open) viewerEl.close(); return; }
  viewer.i = Math.max(0, Math.min(viewer.i, items.length-1));
  const it = items[viewer.i], ph = it.photo, p = parkById(it.park);
  if(!p){ viewerEl.close(); return; }
  const n = items.length, owner = canPhoto();
  const isCover = (coverOf(it.park)||{}).id === ph.id;
  viewerEl.innerHTML = `
    <div class="v-top"><span>${viewer.i+1} of ${n}</span><button class="close-btn" type="button" data-vclose aria-label="Close photo">×</button></div>
    <div class="v-stage" id="vStage">
      ${n>1 ? `<button class="v-nav v-prev" type="button" data-vstep="-1" aria-label="Previous photo">‹</button>` : ""}
      <img class="v-img" src="${esc(photoUrl(ph.full))}" alt="${esc(ph.caption || p.name)}" style="background-image:url('${esc(photoUrl(ph.thumb))}')" ${ph.w&&ph.h?`width="${ph.w}" height="${ph.h}"`:""}>
      ${n>1 ? `<button class="v-nav v-next" type="button" data-vstep="1" aria-label="Next photo">›</button>` : ""}
    </div>
    <div class="v-bar">
      <div class="v-info">
        ${viewer.editing
          ? `<form class="v-edit" id="vCapForm" autocomplete="off"><input name="cap" maxlength="200" placeholder="Caption, like 'Lamar Valley bison'" value="${esc(ph.caption||"")}" aria-label="Photo caption"><button class="btn" type="submit">Save</button><button class="btn ghost" type="button" data-vcapcancel style="color:#EEF0E6;border-color:rgba(238,240,230,.6)">Cancel</button></form>`
          : (ph.caption ? `<p class="v-cap">${esc(ph.caption)}</p>` : "")}
        <button class="v-park" type="button" data-vpark>${esc(p.name)}, #${rankOf(p.id)}</button>
      </div>
      ${owner && !viewer.editing ? `<div class="v-actions">
        ${isCover ? `<span class="v-badge">Cover photo</span>` : `<button type="button" data-vcover>Set as cover</button>`}
        <button type="button" data-vcaption>${ph.caption ? "Edit caption" : "Add caption"}</button>
        <button type="button" class="danger" data-vdelete>Delete</button>
      </div>` : ""}
    </div>`;
  if(viewer.editing){ const inp = viewerEl.querySelector("#vCapForm input"); inp.focus(); inp.select(); }
}
function stepViewer(d){
  const n = viewerItems().length; if(n < 2 || viewer.editing) return;
  viewer.i = (viewer.i + d + n) % n; renderViewer();
}

viewerEl.addEventListener("close", ()=>{ viewer = {source:null, i:0, editing:false}; viewerEl.innerHTML = ""; });
viewerEl.addEventListener("click", async e=>{
  if(e.target.closest("[data-vclose]")){ viewerEl.close(); return; }
  const step = e.target.closest("[data-vstep]"); if(step){ stepViewer(+step.dataset.vstep); return; }
  const it = viewerItems()[viewer.i]; if(!it) return;
  if(e.target.closest("[data-vpark]")){
    viewerEl.close();
    if(!(dlg.open && dlgMode && dlgMode.type==="park" && dlgMode.id===it.park)) openDialog({type:"park", id:it.park});
    return;
  }
  if(e.target.closest("[data-vcaption]")){ viewer.editing = true; renderViewer(); return; }
  if(e.target.closest("[data-vcapcancel]")){ viewer.editing = false; renderViewer(); return; }
  if(e.target.closest("[data-vcover]")){
    journal[it.park] = {...journal[it.park], cover: it.photo.id};
    renderAll(); renderViewer();
    report(await push(), `Cover photo set for ${parkById(it.park).name}.`);
    return;
  }
  if(e.target.closest("[data-vdelete]")){
    if(!confirm("Delete this photo? This can't be undone.")) return;
    const j = journal[it.park]; const ph = it.photo;
    const next = {...j, photos: photosOf(it.park).filter(x=>x.id!==ph.id)};
    if(next.cover === ph.id) delete next.cover;
    journal[it.park] = next;
    renderAll(); renderViewer();
    const r = await push();
    sb.storage.from(BUCKET).remove([ph.full, ph.thumb]).catch(()=>{});
    report(r, "Photo deleted.");
  }
});
viewerEl.addEventListener("submit", async e=>{
  if(e.target.id !== "vCapForm") return;
  e.preventDefault();
  const it = viewerItems()[viewer.i]; if(!it) return;
  const cap = e.target.elements.cap.value.trim().slice(0,200);
  journal[it.park] = {...journal[it.park], photos: photosOf(it.park).map(x=>x.id===it.photo.id ? {...x, caption:cap} : x)};
  viewer.editing = false;
  renderAll(); renderViewer();
  report(await push(), "Caption saved.");
});
document.addEventListener("keydown", e=>{
  if(!viewerEl.open || viewer.editing) return;
  if(e.key==="ArrowLeft"){ e.preventDefault(); stepViewer(-1); }
  if(e.key==="ArrowRight"){ e.preventDefault(); stepViewer(1); }
});
let touchStart = null;
viewerEl.addEventListener("touchstart", e=>{
  if(!e.target.closest("#vStage") || e.touches.length !== 1){ touchStart = null; return; }
  touchStart = {x:e.touches[0].clientX, y:e.touches[0].clientY};
}, {passive:true});
viewerEl.addEventListener("touchend", e=>{
  if(!touchStart) return;
  const t = e.changedTouches[0]; const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
  touchStart = null;
  if(Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)*1.5) stepViewer(dx < 0 ? 1 : -1);
}, {passive:true});

document.addEventListener("click", e=>{
  const f = e.target.closest("[data-pfilter]");
  if(f){ photoFilter = f.dataset.pfilter; renderPhotos(); return; }
  const t = e.target.closest("[data-view-all]");
  if(t){ openViewer({type:"all", filter:photoFilter}, +t.dataset.viewAll); }
});

/* ---------- sign in ---------- */
let signUpMode = false;
function showSignIn(msg){
  document.body.classList.add("signed-out");
  $("#headline").textContent = "Park Log";
  $("#authMsg").textContent = msg || "";
  setAuthMode(false);
}
function setAuthMode(up){
  signUpMode = up;
  $("#authTitle").textContent = up ? "Create your account" : "Sign in";
  $("#authSubmit").textContent = up ? "Create account" : "Sign in";
  $("#authSwitch").textContent = up ? "Already have an account? Sign in" : "First time here? Create your account";
  $("#authForm").elements.password.autocomplete = up ? "new-password" : "current-password";
}
function setEditMode(on){
  editMode = on;
  document.body.classList.toggle("editing", on);
  const b = $("#editToggle"); b.setAttribute("aria-pressed", on); b.textContent = on ? "Done" : "Edit";
}
async function showApp(){
  document.body.classList.remove("signed-out");
  document.body.classList.toggle("guest", isGuest());
  if(isGuest() && editMode) setEditMode(false);
  $("#who").textContent = !sb ? "Saving on this device only (Supabase not connected yet)." : session ? `Signed in as ${session.user.email}.` : "";
  $("#signOut").hidden = !(sb && session);
  $("#localBanner").hidden = !!sb;
  renderAll();
}
$("#signInBtn").addEventListener("click", ()=>{ if(viewerEl.open) viewerEl.close(); if(dlg.open) dlg.close(); showSignIn(); window.scrollTo(0,0); });
$("#authBack").addEventListener("click", ()=>{ showApp(); });
$("#authSwitch").addEventListener("click", ()=>{ setAuthMode(!signUpMode); $("#authMsg").textContent = ""; });
$("#authForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const f = e.target.elements; const email = f.email.value.trim(), password = f.password.value;
  const btn = $("#authSubmit"); btn.disabled = true; $("#authMsg").textContent = "";
  try{
    if(signUpMode){
      const {data, error} = await sb.auth.signUp({email, password});
      if(error) throw error;
      if(!data.session){ setAuthMode(false); $("#authMsg").textContent = "Account created. Check your email for a confirmation link, then come back here and sign in."; return; }
    } else {
      const {error} = await sb.auth.signInWithPassword({email, password});
      if(error) throw error;
    }
  }catch(err){
    $("#authMsg").textContent = /invalid login/i.test(err.message) ? "That email and password don't match. Check them and try again."
      : /not confirmed/i.test(err.message) ? "Confirm your email first: open the link Supabase sent you, then sign in here."
      : /signups? not allowed|disabled/i.test(err.message) ? "New accounts are turned off for this Park Log."
      : err.message;
  }finally{ btn.disabled = false; }
});
$("#signOut").addEventListener("click", async ()=>{
  const c = readCache();
  if(c && c.dirty && !confirm("Some changes haven't synced yet and will be lost if you sign out. Sign out anyway?")) return;
  await sb.auth.signOut();
  try{ localStorage.removeItem(CACHE_KEY); }catch(e){}
});

/* ---------- backups ---------- */
$("#backupBtn").addEventListener("click", ()=>{
  const blob = new Blob([JSON.stringify(snapshot(), null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `park-log-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
});
$("#restoreInput").addEventListener("change", async e=>{
  const file = e.target.files[0]; e.target.value = "";
  if(!file) return;
  try{
    const d = JSON.parse(await file.text());
    if(!validData(d)) throw new Error();
    if(!confirm(`Replace everything with this backup (${d.parks.length} parks, ${d.stamps.length} stamps)?`)) return;
    setData(d); renderAll();
    report(await push(), "Backup restored.");
  }catch(err){ toast("That file isn't a Park Log backup."); }
});

/* ---------- start up ---------- */
async function boot(){
  const cached = readCache();
  if(cached && validData(cached.data)) setData(cached.data);
  if(!sb){
    if(!state.parks.length){ try{ setData(await fetchStarterData()); writeCache(false); }catch(e){ toast(e.message); } }
    showApp(); return;
  }
  sb.auth.onAuthStateChange((event, s)=>{
    session = s;
    if(event === "SIGNED_IN") setTimeout(()=>{ showApp(); pull(); }, 0);
    if(event === "SIGNED_OUT") setTimeout(async ()=>{ setEditMode(false); if(viewerEl.open) viewerEl.close(); if(dlg.open) dlg.close(); await loadPublic(); showApp(); toast("Signed out. You're now seeing the public view."); }, 0);
  });
  const {data} = await sb.auth.getSession();
  session = data.session;
  if(!session){ await loadPublic(); showApp(); return; }
  showApp(); pull();
}
window.addEventListener("online", ()=>pull());
document.addEventListener("visibilitychange", ()=>{
  if(document.visibilityState !== "visible" || dlg.open || viewerEl.open || drag || busy) return;
  if(isGuest()){ if(!document.body.classList.contains("signed-out")) loadPublic().then(renderAll); }
  else pull();
});
if("serviceWorker" in navigator && location.protocol !== "file:"){
  window.addEventListener("load", ()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
}
boot();
