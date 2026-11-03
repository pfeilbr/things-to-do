// Train board for Things To Do — loaded by index.html just ahead of its main script.
// Kept out of index.html so the generic renderer stays inside its size budget; it shares
// the page's globals (state, CITY, GUIDE, skey, $, render…), which it only touches at
// call time, after the main script has run.
// ---- train to the city ("🚆 To NYC") ----------------------------------------------------
// A city whose CONFIG entry names a `transit` file gets a live departures board for the
// commuter rail into the big city. The file is a baked slice of the agency's GTFS timetable
// (scripts/transit.py, refreshed weekly by .github/workflows/transit.yml); the page lays the
// agency's GTFS-realtime feed over it by train number for live times, tracks and status.
// The editorial half (fares, bike rules, parking, the app, the last mile) is the guide
// file's `transit` block, so the schedule can regenerate without touching copy.
let TRANSIT = null;
const TRANSITCACHE = {};      // cityId -> timetable JSON, or null when the file failed
let LIVE = null, liveAt = 0, liveFail = false, liveFails = 0, liveBusy = false;
const TZ = "America/New_York";
const TINFO = () => (GUIDE && GUIDE.transit) || {};

// New York wall clock for an instant: {ymd:"20261102", min:minutes after midnight, dow:0-6}
function nyClock(ms){
  const p = {};
  for(const x of new Intl.DateTimeFormat("en-US",{timeZone:TZ,hourCycle:"h23",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",weekday:"short"}).formatToParts(new Date(ms))) p[x.type] = x.value;
  return {ymd:p.year+p.month+p.day, min:(+p.hour)*60 + (+p.minute), dow:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(p.weekday)};
}
// the instant a service-day time (minutes after midnight, may pass 1440) falls on in New York
function nyMs(ymd, min){
  const guess = Date.UTC(+ymd.slice(0,4), +ymd.slice(4,6)-1, +ymd.slice(6,8)) + min*60000;
  let ms = guess;
  for(let k=0;k<2;k++){ const c = nyClock(ms); ms += (guess - (Date.UTC(+c.ymd.slice(0,4), +c.ymd.slice(4,6)-1, +c.ymd.slice(6,8)) + c.min*60000)); }
  return ms;
}
function fmtClock(min){
  const m = ((min % 1440) + 1440) % 1440, h = Math.floor(m/60);
  return `${h%12||12}:${String(m%60).padStart(2,"0")}${h<12?"a":"p"}`;
}
// every direct train on day index `di` between home station `si` and the hub, in `dir`
// (1 = to the hub). Times are minutes after midnight of that service day.
function trainRuns(T, di, si, dir){
  const hub = T.stops.length - 1, ymd = T.days[di];
  if(!ymd) return [];
  return T.trains.filter(t => t[1]===dir && Math.floor(t[3] / 2**di) % 2 === 1 && t[4][si]!=null && t[4][hub]!=null)
    .map(t => {
      const dep = dir ? t[4][si] : t[4][hub], arr = dir ? t[4][hub] : t[4][si];
      return {num:t[0], peak:!!t[2], dir, ymd, dep, arr, ride:arr-dep, depMs:nyMs(ymd, dep), arrMs:nyMs(ymd, arr)};
    }).sort((a,b)=>a.dep-b.dep);
}

// GTFS-realtime is protobuf; the page needs five fields of it, so a 20-line reader beats a library.
function pbFields(b, s=0, e=b.length){
  const out = []; let i = s;
  const vint = () => { let r = 0, m = 1, x; do { x = b[i++]; r += (x & 127) * m; m *= 128; } while(x >= 128 && i < e); return r; };
  while(i < e){
    const k = vint(), f = Math.floor(k/8), w = k % 8;
    if(w===0) out.push([f, vint()]);
    else if(w===2){ const n = vint(); out.push([f, [i, i+n]]); i += n; }
    else if(w===1) i += 8;
    else if(w===5) i += 4;
    else break;
  }
  return out;
}
// Metro-North's feed: entity id = train number; trip_update.trip.start_date; per stop the
// predicted arrival/departure epoch and the MTA railroad extension (1005: track, status).
function mnrLive(b){
  const str = ([s,e]) => new TextDecoder().decode(b.subarray(s,e));
  const sub = (r, f) => pbFields(b, r[0], r[1]).filter(x=>x[0]===f).map(x=>x[1]);
  const out = {ts:0, trains:{}};
  for(const [f,v] of pbFields(b)){
    if(f===1){ out.ts = (sub(v,3)[0]) || 0; continue; }
    if(f!==2) continue;
    const id = sub(v,1)[0], tu = sub(v,3)[0];
    if(!id || !tu) continue;
    const trip = sub(tu,1)[0], t = {date:"", cancelled:false, stops:{}};
    if(trip){ const d = sub(trip,3)[0]; if(d) t.date = str(d); t.cancelled = sub(trip,4)[0] === 3; }
    for(const su of sub(tu,2)){
      const sid = sub(su,4)[0]; if(!sid) continue;
      const ev = sub(su,3)[0] || sub(su,2)[0], ext = sub(su,1005)[0];
      const s = {t: ev ? (sub(ev,2)[0] || 0) : 0};
      if(ext){ const tr = sub(ext,1)[0], st = sub(ext,2)[0]; if(tr) s.track = str(tr); if(st) s.status = str(st); }
      t.stops[str(sid)] = s;
    }
    out.trains[str(id)] = t;
  }
  return out;
}
// live view of one scheduled run: predicted departure/arrival, track, status, minutes late
function liveRun(run, T, si){
  const lt = LIVE && LIVE.trains[run.num];
  if(!lt || (lt.date && lt.date !== run.ymd)) return null;
  const hub = T.stops[T.stops.length-1].id, home = T.stops[si].id;
  const a = lt.stops[run.dir ? home : hub], z = lt.stops[run.dir ? hub : home];
  const dep = a && a.t ? a.t*1000 : null, arr = z && z.t ? z.t*1000 : null;
  const status = (a && a.status) || (z && z.status) || "";
  return {dep, arr, track: a && a.track, status, cancelled: lt.cancelled || /cancel/i.test(status),
          late: dep ? Math.round((dep - run.depMs)/60000) : 0};
}
// text that came from the live feed is a third party's: escape it before it meets innerHTML
function escHtml(v){
  return String(v).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
}
async function fetchLive(force){
  if(!TRANSIT || !TRANSIT.rt || liveBusy) return;
  if(navigator.onLine === false){ liveFail = true; paintTransit(); return; }   // no doomed request offline
  // a feed that's down is retried less and less often (50s, 100s, 200s, then every 5 min)
  // rather than every tick; the first success resets it
  if(!force && Date.now() - liveAt < (liveFail ? Math.min(300000, 50000 * 2 ** Math.min(liveFails, 3)) : 50000)) return;
  liveBusy = true;
  try{
    // a hung request must not leave liveBusy set forever (it would freeze the board)
    const r = await fetch(TRANSIT.rt, {cache:"no-store",
      signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined});
    if(!r.ok) throw r.status;
    LIVE = mnrLive(new Uint8Array(await r.arrayBuffer()));
    liveFail = false; liveFails = 0;
  }catch(e){ liveFail = true; liveFails++; }
  liveAt = Date.now(); liveBusy = false;
  paintTransit();
}

// prefs: which station, which way, where you're headed, which day. Per city.
function tPrefs(){
  let p = {}; try { p = JSON.parse(localStorage.getItem(skey("train"))) || {}; } catch(e){}
  const keys = TRANSIT.home;
  const dests = (TINFO().dests||[]).map(d=>d.id);
  return {stn: keys.includes(p.stn) ? p.stn : (TINFO().home || keys[0]), dir: p.dir===0 ? 0 : 1,
          dest: dests.includes(p.dest) ? p.dest : (dests[0]||""), day: 0};
}
let tDay = 0, tShowAll = false;
function tSave(p){ try { localStorage.setItem(skey("train"), JSON.stringify({stn:p.stn, dir:p.dir, dest:p.dest})); } catch(e){} }

function fareFor(run, stnKey){
  const f = (TINFO().fares||{})[stnKey]; if(!f) return null;
  return run.peak ? {v:f.peak, k:"peak"} : {v:f.off, k:"off-peak"};
}
// Bikes follow their own clock, not the fare's: no bikes on weekday trains that reach the
// hub inside a rush window (`rush`, minutes at the hub per direction), none on blackout
// days, and holiday-week partial bans (`partial`). Windows are inclusive at both ends.
function bikeOK(run){
  const b = TINFO().bike; if(!b) return null;
  const iso = run.ymd.slice(0,4)+"-"+run.ymd.slice(4,6)+"-"+run.ymd.slice(6,8);
  const hubT = run.dir ? run.arr : run.dep, inW = ([a,z]) => hubT >= a && hubT <= z;
  if((b.blackout||[]).includes(iso)) return {ok:false, why:"holiday blackout"};
  for(const x of b.partial||[])
    if(x.dates.includes(iso) && (x.dir==null || x.dir===run.dir) && x.hub.some(inW)) return {ok:false, why:"holiday-week limits"};
  const dow = new Date(Date.UTC(+run.ymd.slice(0,4), +run.ymd.slice(4,6)-1, +run.ymd.slice(6,8))).getUTCDay();
  if(dow>=1 && dow<=5 && (b.rush||[]).some(w => w.dir===run.dir && inW(w.hub))) return {ok:false, why:"weekday rush hour"};
  return {ok:true, why:""};
}
// upcoming runs from now (or a whole later day), live-adjusted and still catchable
function upcoming(p, di){
  const T = TRANSIT, si = T.stops.findIndex(s=>s.k===p.stn), now = Date.now();
  const today = T.days.indexOf(nyClock(now).ymd);
  if(today < 0) return {expired:true, runs:[]};
  const day = today + di;
  // after midnight, last night's late trains still belong to yesterday's service day
  let runs = [...(day>0 && di===0 ? trainRuns(T, day-1, si, p.dir) : []), ...trainRuns(T, day, si, p.dir)];
  runs = runs.map(r => ({...r, live: liveRun(r, T, si)}));
  if(di===0) runs = runs.filter(r => ((r.live && r.live.dep) || r.depMs) >= now - 60000);
  return {expired:false, runs, si};
}
function destOf(p){ return (TINFO().dests||[]).find(d=>d.id===p.dest) || null; }

function tRunRow(r, p, i){
  const L = r.live, fare = fareFor(r, p.stn), bike = bikeOK(r), dest = destOf(p);
  const depMs = (L && L.dep) || r.depMs, arrMs = (L && L.arr) || r.arrMs;
  const inMin = Math.round((depMs - Date.now())/60000);
  const extra = p.dir && dest && dest.walk ? dest.walk : 0;
  const clock = ms => fmtClock(nyClock(ms).min);
  const status = !L ? "" : L.cancelled ? `<span class="tst bad">Cancelled</span>`
    : /bus/i.test(L.status) ? `<span class="tst warn" title="A bus replaces this train">Bus instead</span>`
    : L.late >= 2 ? `<span class="tst warn">${L.late} min late</span>`
    : /late/i.test(L.status) ? `<span class="tst warn">Running late</span>` : `<span class="tst ok">On time</span>`;
  return `<li class="trun${i===0?" first":""}${L&&L.cancelled?" gone":""}">
    <div class="tdep"><b>${clock(depMs)}</b>${L && L.late>=2 ? `<s>${fmtClock(r.dep)}</s>` : ""}<span>${inMin<=0 ? "now" : inMin<60 ? `in ${inMin} min` : `in ${Math.floor(inMin/60)} h ${inMin%60} m`}</span></div>
    <div class="tmid"><div class="tline"><i></i></div><span>${Math.round((arrMs-depMs)/60000)} min ride · #${r.num}${L && L.track ? ` · track ${escHtml(L.track)}` : ""}</span></div>
    <div class="tarr"><b>${clock(arrMs + extra*60000)}</b><span>${p.dir ? (extra ? dest.n : TRANSIT.stops[TRANSIT.stops.length-1].n) : TRANSIT.stops.find(s=>s.k===p.stn).n}</span></div>
    <div class="ttags">${status}${fare ? `<span class="ttag${fare.k==="peak"?" pk":""}">$${fare.v.toFixed(2)} ${fare.k}</span>` : ""}${bike ? `<span class="ttag ${bike.ok?"bk":"nobk"}" title="${bike.ok ? "Bikes allowed on this train" : "No bikes: "+bike.why}">🚲 ${bike.ok ? "OK" : "no"}</span>` : ""}</div>
  </li>`;
}

function renderTransit(){
  const T = TRANSIT, I = TINFO(), p = tPrefs();
  const stn = T.stops.find(s=>s.k===p.stn), hub = T.stops[T.stops.length-1], dest = destOf(p);
  const {expired, runs} = upcoming(p, tDay);
  const now = nyClock(Date.now());
  const dayOpts = [...Array(7)].map((_,i)=>{
    const ms = Date.now() + i*86400000, c = nyClock(ms);
    const lbl = i===0 ? "Today" : i===1 ? "Tomorrow" : new Intl.DateTimeFormat("en-US",{timeZone:TZ,weekday:"short",month:"numeric",day:"numeric"}).format(new Date(ms));
    return T.days.includes(c.ymd) ? `<option value="${i}"${i===tDay?" selected":""}>${lbl}</option>` : "";
  }).join("");
  const from = p.dir ? stn.n : hub.n, to = p.dir ? (dest && dest.walk ? dest.n : hub.n) : stn.n;
  const next = runs.find(r => !(r.live && r.live.cancelled));
  const rest = tDay ? runs : runs.filter(r => r !== next);
  const shown = tShowAll || tDay ? rest : rest.slice(0, 8);
  const liveNote = liveFail ? `<span class="tlive off">● live feed unreachable, showing the timetable</span>`
    : LIVE ? `<span class="tlive on">● live · updated ${fmtClock(nyClock(LIVE.ts*1000 || liveAt).min)}</span>` : `<span class="tlive">● connecting to live feed…</span>`;
  const fact = (v,k) => `<div class="gstat"><b>${v}</b><span>${k}</span></div>`;
  const fares = (I.fares||{})[p.stn];
  const sec = s => `<div class="gpanel"><h3>${s.icon ? s.icon+" " : ""}${s.title}</h3>${s.items.map(f=>`<div class="gitem"><span class="gi" aria-hidden="true">${f.icon||"ℹ️"}</span><div><b>${f.title}</b><p>${f.text}${f.u?` <a href="${f.u}" target="_blank" rel="noopener">Source ↗</a>`:""}</p></div></div>`).join("")}</div>`;
  $("transitview").innerHTML = `
    <section class="ghero thero" aria-labelledby="tTitle">
      <div class="geyebrow">${T.agency} · ${T.line}</div>
      <h2 id="tTitle">${from} <span class="tarrow">→</span> ${to}</h2>
      <div class="tclock">It's <b>${fmtClock(now.min)}</b> in New York · ${liveNote}</div>
      <div class="tctl">
        <div class="gseg" role="group" aria-label="Direction">${[[1,"To "+(I.city||"the city")],[0,"Back to "+stn.n]].map(([d,l])=>`<button data-tdir="${d}" aria-pressed="${p.dir===d}">${l}</button>`).join("")}</div>
        <div class="gseg" role="group" aria-label="Station">${T.stops.filter(s=>T.home.includes(s.k)).map(s=>`<button data-tstn="${s.k}" aria-pressed="${p.stn===s.k}">${s.n}</button>`).join("")}</div>
        ${p.dir && (I.dests||[]).length > 1 ? `<div class="gseg" role="group" aria-label="Headed to">${I.dests.map(d=>`<button data-tdest="${d.id}" aria-pressed="${p.dest===d.id}">${d.n}</button>`).join("")}</div>` : ""}
        <select id="tDay" class="tday" aria-label="Day">${dayOpts}</select>
      </div>
      ${expired ? `<div class="tnext"><p>The baked timetable has run out — run <code>python3 scripts/transit.py build</code>. Live times: the MTA TrainTime app.</p></div>`
      : next ? `<div class="tnext" aria-live="polite">
        <div class="tnl">${tDay ? "First train" : "Next train"}</div>
        <ol class="tlist">${tRunRow(next, p, 0)}</ol>
      </div>` : `<div class="tnext"><p>No more direct trains ${tDay ? "that day" : "tonight"} — pick tomorrow above.</p></div>`}
      <div class="gstats">
        ${fact(stn.mi ? stn.mi+" mi" : "—", "by rail, "+stn.n+" ↔ "+hub.n)}
        ${next ? fact(Math.round((((next.live&&next.live.arr)||next.arrMs)-((next.live&&next.live.dep)||next.depMs))/60000)+(p.dir&&dest&&dest.walk?dest.walk:0)+" min", p.dir&&dest&&dest.walk ? "train + "+dest.walk+" min walk to "+dest.n : "on the next train") : ""}
        ${fares ? fact("$"+fares.off.toFixed(2)+" / $"+fares.peak.toFixed(2), "one-way off-peak / peak") : ""}
        ${fact(String(runs.length), tDay ? "direct trains that day" : "more direct trains today")}
      </div>
      ${I.alert ? `<p class="talert">${I.alert}${I.alertU ? ` <a href="${I.alertU}" target="_blank" rel="noopener">Rules ↗</a>` : ""}</p>` : ""}
    </section>
    <section class="gsec"><div class="gsech"><h3>${tDay ? "Departures" : "After that"}</h3>
      <span class="gsub">${from} → ${to}. ${I.boardNote || "Live times replace the timetable as the feed reports them."}</span></div>
      ${shown.length ? `<ol class="tlist tboard">${shown.map((r,i)=>tRunRow(r,p,i+1)).join("")}</ol>` : `<div class="gempty">No direct trains left on this day.</div>`}
      ${!tDay && !tShowAll && rest.length > shown.length ? `<div class="gend"><button class="gbrowse" id="tMore">All ${rest.length} later trains today</button></div>` : ""}
    </section>
    ${(I.sections||[]).length ? `<section class="gsec tgrid">${I.sections.map(sec).join("")}</section>` : ""}
    ${I.sources ? `<p class="tsrc">${I.sources} Timetable built ${T.built} from the <a href="${T.source}" target="_blank" rel="noopener">${T.agency} GTFS feed</a>; live data from the MTA's GTFS-realtime feed.</p>` : ""}`;
}

// the slim live strip on every list of a city with a train: next departure at a glance
function renderTrainStrip(){
  const el = $("trainStrip");
  if(!el) return;
  const show = !!TRANSIT && !state.transit && !state.item && !state.allCities;
  el.hidden = !show;
  if(!show) return;
  const p = tPrefs(), I = TINFO(), {expired, runs} = upcoming({...p, dir:1}, 0);
  const r = runs.find(x => !(x.live && x.live.cancelled));
  const stn = TRANSIT.stops.find(s=>s.k===p.stn), hub = TRANSIT.stops[TRANSIT.stops.length-1];
  if(expired || !r){ el.innerHTML = `<span class="tsi">🚆</span><span class="tsm">Train to ${I.city||hub.n}</span><span class="tsgo">Timetable →</span>`; return; }
  const dep = (r.live && r.live.dep) || r.depMs, arr = (r.live && r.live.arr) || r.arrMs, inMin = Math.round((dep-Date.now())/60000);
  const late = r.live && !r.live.cancelled && r.live.late >= 2 ? ` <em class="warn">${r.live.late} min late</em>` : r.live ? ` <em class="ok">on time</em>` : "";
  el.innerHTML = `<span class="tsi">🚆</span><span class="tsm"><b>Next to ${hub.n}:</b> ${fmtClock(nyClock(dep).min)} from ${stn.n}${late}
    <span class="tsx">· ${inMin<=0?"now":inMin<60?`in ${inMin} min`:`in ${Math.floor(inMin/60)} h ${inMin%60} m`} · arrives ${fmtClock(nyClock(arr).min)}</span></span><span class="tsgo">All trains →</span>`;
}
// repaint whichever train surface is on screen (live data arrived, or the minute ticked)
function paintTransit(){
  if(!TRANSIT) return;
  if(state.transit && !state.item) renderTransit();
  else renderTrainStrip();
}
setInterval(()=>{
  if(!TRANSIT || document.hidden) return;
  if(state.transit || !$("trainStrip").hidden) fetchLive(false);
  paintTransit();
}, 30000);
document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && TRANSIT){ fetchLive(false); paintTransit(); } });

function openTransit(){
  state.transit = true; state.guide = false; state.item = null; state.fromGuide = false;
  state.tonight = false; state.allCities = false; ALLROWS = [];
  $("tonightBtn").setAttribute("aria-pressed","false");
  tDay = 0; tShowAll = false;
  render(); window.scrollTo(0,0); fetchLive(true);
}
function syncTransitTab(){
  const g = $("transitTab"); if(!g) return;
  const on = state.transit && !state.item;
  g.classList.toggle("active", on);
  g.setAttribute("aria-selected", on);
}
document.getElementById("trainStrip").addEventListener("click", ()=>openTransit());
document.getElementById("transitview").addEventListener("click", e=>{
  if(e.target.closest("a")) return;
  const p = tPrefs();
  const d = e.target.closest("[data-tdir]"), s = e.target.closest("[data-tstn]"), x = e.target.closest("[data-tdest]");
  if(d){ p.dir = +d.dataset.tdir; tSave(p); tShowAll = false; renderTransit(); return; }
  if(s){ p.stn = s.dataset.tstn; tSave(p); tShowAll = false; renderTransit(); return; }
  if(x){ p.dest = x.dataset.tdest; tSave(p); renderTransit(); return; }
  if(e.target.closest("#tMore")){ tShowAll = true; renderTransit(); }
});
document.getElementById("transitview").addEventListener("change", e=>{
  if(e.target.id==="tDay"){ tDay = +e.target.value; tShowAll = false; renderTransit(); }
});
