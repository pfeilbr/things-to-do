// Today view ("☀ Today") for Things To Do — the page every city opens on.
// Loaded by index.html next to transit.js, ahead of the main script. Like transit.js it
// only touches the page's globals (state, CITY, DATA, TABS, render, gEvent…) at call time.
//
// What it answers, in this order: what's on today from now on (morning = the whole day,
// afternoon = from now on, evening = what's still going), what to do outdoors given the
// season, the daylight left and the weather (ride / rollerblade / ice skate / ski / walk /
// fish), and where to go tonight. Every card is a row from the city's own dataset, so
// distances, favorites and the item view stay live.

// ---- the city's own clock -------------------------------------------------------------
// Times in `w` strings are local to the city, so "from now on" is judged on its clock,
// not the visitor's (an LA guide read from New York at 9p still has its evening ahead).
const CITY_TZ = {chicago:"America/Chicago", nashville:"America/Chicago", la:"America/Los_Angeles",
  sf:"America/Los_Angeles", seattle:"America/Los_Angeles", sandiego:"America/Los_Angeles", toronto:"America/Toronto"};
const cityTZ = id => CITY_TZ[id] || "America/New_York";
function cityClock(ms, tz){
  const p = {};
  for(const x of new Intl.DateTimeFormat("en-US",{timeZone:tz,hourCycle:"h23",year:"numeric",month:"numeric",day:"numeric",
    hour:"numeric",minute:"numeric",weekday:"long"}).formatToParts(new Date(ms))) p[x.type] = x.value;
  return {y:+p.year, mo:+p.month, d:+p.day, min:(+p.hour)*60 + (+p.minute), wd:p.weekday};
}
const fmtTime = (ms, tz) => new Date(ms).toLocaleTimeString("en-US",{timeZone:tz,hour:"numeric",minute:"2-digit"});

// Start/end of a `w` string's time of day, in minutes after midnight: "Sat 11/14 · 2p–5p",
// "Tuesdays · 6:15p", "Fridays · 10p–2a" (end rolls past midnight), "7–9p" (start borrows
// the end's a/p). Dates never carry a/p, so they can't be mistaken for times. null = all day.
function wTimes(w){
  const s = String(w||"").toLowerCase().replace(/\bnoon\b/g,"12p").replace(/\bmidnight\b/g,"12a");
  const t = s.includes("·") ? s.slice(s.lastIndexOf("·")) : s;
  const mins = (h, m, ap) => (+h % 12 + (ap === "p" ? 12 : 0)) * 60 + (+m || 0);
  let m = t.match(/(\d{1,2})(?::(\d\d))?\s*([ap])?m?\s*[–-]\s*(\d{1,2})(?::(\d\d))?\s*([ap])m?\b/);
  if(m){
    let a = mins(m[1], m[2], m[3] || m[6]), b = mins(m[4], m[5], m[6]);
    if(!m[3] && a > b) a -= 720;            // "11–2p" is 11a–2p
    if(b <= a) b += 1440;                    // "10p–2a" ends tomorrow
    return {s:a, e:b};
  }
  m = t.match(/(\d{1,2})(?::(\d\d))?\s*([ap])m?\b/);
  return m ? {s:mins(m[1], m[2], m[3]), e:null} : null;
}

// Sunrise/sunset (NOAA's sunrise equation, good to a minute or two) as epoch ms, for the
// city's local date — so "light left for a ride" works offline, without a weather call.
function sunTimes(lat, lon, y, mo, d){
  const rad = Math.PI/180, J = Date.UTC(y, mo-1, d, 12)/864e5 + 2440587.5;
  const n = J - 2451545, Js = n - lon/360;
  const M = (357.5291 + 0.98560028*Js) % 360;
  const C = 1.9148*Math.sin(M*rad) + 0.02*Math.sin(2*M*rad) + 0.0003*Math.sin(3*M*rad);
  const L = (M + C + 282.9372) % 360;
  const Jt = 2451545 + Js + 0.0053*Math.sin(M*rad) - 0.0069*Math.sin(2*L*rad);
  const dec = Math.asin(Math.sin(L*rad)*Math.sin(23.4397*rad));
  const cw = (Math.sin(-0.833*rad) - Math.sin(lat*rad)*Math.sin(dec)) / (Math.cos(lat*rad)*Math.cos(dec));
  if(cw < -1 || cw > 1) return null;
  const w0 = Math.acos(cw)/rad/360, ms = j => (j - 2440587.5)*864e5;
  return {rise:ms(Jt - w0), set:ms(Jt + w0)};
}

// ---- weather (Open-Meteo: CORS-open, no key; sw.js never caches it) --------------------
// Only a city-wide centroid of public places is sent, never the origin. One call per city
// per half hour; if it fails the page just doesn't mention the weather.
let WX = {};
const WXCODE = [[0,"Clear","☀️"],[2,"Partly cloudy","⛅"],[3,"Overcast","☁️"],[48,"Fog","🌫️"],[57,"Drizzle","🌦️"],
  [67,"Rain","🌧️"],[77,"Snow","🌨️"],[82,"Showers","🌧️"],[86,"Snow showers","🌨️"],[99,"Thunderstorms","⛈️"]];
function fetchWeather(c, ll){
  const k = c.id, w = WX[k];
  if(!ll || (w && Date.now() - w.at < 18e5)) return;
  WX[k] = {at:Date.now()};
  fetch(`https://api.open-meteo.com/v1/forecast?latitude=${ll[0].toFixed(2)}&longitude=${ll[1].toFixed(2)}`
    + "&current=temperature_2m,weather_code,precipitation,wind_speed_10m&daily=temperature_2m_max,precipitation_probability_max"
    + "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1")
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(j => {
      const code = j.current.weather_code, row = WXCODE.find(x => code <= x[0]) || WXCODE[0];
      WX[k] = {at:Date.now(), t:Math.round(j.current.temperature_2m), hi:Math.round(j.daily.temperature_2m_max[0]),
        pp:j.daily.precipitation_probability_max[0], wind:Math.round(j.current.wind_speed_10m), code, label:row[1], icon:row[2],
        wet: j.current.precipitation > 0 || code >= 51};
      if(state.today && CITY && CITY.id === k) renderToday();
    }).catch(() => {});
}

// ---- what to do outside, by season, light and weather ---------------------------------
// `indoor` picks the rows that still work after dark or in the rain.
const MOVES = [
  {tab:"biking",     icon:"🚲", label:"Ride",        out:true, indoor:/indoor|velodrome/i},
  {tab:"skating",    icon:"🛼", label:"Rollerblade", out:true, indoor:/indoor/i},
  {tab:"iceskating", icon:"⛸️", label:"Ice skate",   indoor:/indoor/i},
  {tab:"skiing",     icon:"⛷️", label:"Ski",         months:[12,1,2,3]},
  {tab:"walks",      icon:"🚶", label:"Walk",        out:true},
  {tab:"fishing",    icon:"🎣", label:"Fish",        out:true, months:[4,5,6,7,8,9,10,11]}
];
// how much each activity suits the month (higher = earlier on the page)
const SEASON = {
  biking:    [1,1,2,3,3,3,3,3,3,3,2,1], skating:[1,1,2,3,3,3,3,3,3,3,2,1],
  iceskating:[3,3,2,1,1,1,1,1,1,1,3,3], skiing: [3,3,2,0,0,0,0,0,0,0,1,3],
  walks:     [1,1,2,2,2,2,2,2,2,3,2,1], fishing:[0,0,1,2,3,3,2,2,3,3,1,0]
};
const ACTIVE = /pickup|sport|ride|run|skate|skating|climb|hik|paddl|fish|ski|league|volleyball|fitness|bike|cycl|walk|soccer|basketball|tennis|pickleball|kayak|row|rink/i;
const TFILTERS = [
  ["all", "Everything"],
  ["move", "Active", ACTIVE],
  ["night", "Dancing & nights out", /danc|salsa|swing|bachata|tango|night|dj|party|club|music|concert|jazz|karaoke|comedy|show/i],
  ["meet", "Meet people", /social|mixer|dating|trivia|board|game|language|exchange|meetup|chinese|culture/i],
  ["see", "Food, culture & shows", /food|chinese|culture|festival|holiday|market|exhibit|museum|theat|comedy|film|tour|talk|concert|art/i]
];
let tFilter = "all", tAll = false;

function todayRows(){
  const seen = new Set(), out = [];
  for(const t of TABS) for(const r of (DATA[t.key]||[]))
    if(r.w && happensToday(r.w) && !seen.has(r.n)){ seen.add(r.n); out.push({tab:t.key, r, tm:wTimes(r.w)}); }
  return out;
}
function movePicks(mv, dark, wet, mo){
  let rows = (DATA[mv.tab]||[]).slice();
  if(!rows.length) return null;
  const indoorOnly = mv.out && (dark || wet), iceIndoor = mv.tab === "iceskating" && (mo >= 4 && mo <= 10 || wet);
  if(indoorOnly || iceIndoor){
    if(!mv.indoor) return null;
    rows = rows.filter(r => mv.indoor.test(r.c + " " + r.n));
    if(!rows.length) return null;
  }
  // nearest first, but a much better-loved spot may jump a closer one
  const t = r => { const e = eff(r).t; return e == null ? 999 : e; };
  rows.sort((a,b) => (t(a) - Math.min(15, pop(a)/400)) - (t(b) - Math.min(15, pop(b)/400)));
  return {rows: rows.slice(0, 3), note: indoorOnly ? (wet ? "Wet out: indoor picks" : "After dark: indoor picks") : iceIndoor ? "Indoor ice this time of year" : ""};
}

function tdRow({tab, r, tm}, nowMin){
  const e = eff(r), ref = tab + "|" + r.n;
  const live = tm && tm.s <= nowMin && (tm.e ? nowMin < tm.e : nowMin < tm.s + 90);
  const when = tm ? fmtClock(tm.s) + (tm.e ? "–" + fmtClock(tm.e) : "") : "All day";
  return `<li class="tdi" data-ref="${esc(ref)}" tabindex="0" role="button" aria-label="${esc(r.n)}: details">
    <span class="tdt${live ? " live" : ""}">${live ? "Now" : tm ? fmtClock(tm.s) : "All day"}</span>
    <div class="tdb"><h4>${r.n}</h4>
    <div class="gmeta"><span class="cat">${r.c}</span><span class="dist">${when}${e.d != null ? ` · ${e.d.toFixed(1)} mi · ~${e.t} min` : ""}</span>
    ${/meetup\.com/.test(r.u||"") ? '<span class="tdm">Meetup</span>' : ""}</div></div>${favStar(ref)}</li>`;
}

function renderToday(){
  const tz = cityTZ(CITY.id), now = Date.now(), ck = cityClock(now, tz), nowMin = ck.min, mo = ck.mo;
  const ll = cityCentroid(DATA);
  fetchWeather(CITY, ll);
  const wx = WX[CITY.id] && WX[CITY.id].label ? WX[CITY.id] : null;
  const sun = ll ? sunTimes(ll[0], ll[1], ck.y, ck.mo, ck.d) : null;
  // before sunrise the day is still ahead, so only the evening's darkness rules out the outdoors
  const dark = sun ? now > sun.set - 30*6e4 : nowMin >= 17*60;
  const wet = !!(wx && (wx.wet || wx.pp >= 70));
  const phase = nowMin < 12*60 ? "morning" : nowMin < 17*60 ? "afternoon" : "evening";
  // morning: the whole day; later: only what hasn't finished yet (no end time = give it 2h)
  const all = todayRows(), rows = all
    .filter(x => phase === "morning" || !x.tm || (x.tm.e != null ? x.tm.e : x.tm.s + 120) > nowMin)
    .sort((a,b) => (a.tm ? a.tm.s : -1) - (b.tm ? b.tm.s : -1) || ((eff(a.r).t||999) - (eff(b.r).t||999)));
  const f = TFILTERS.find(x => x[0] === tFilter) || TFILTERS[0];
  const shown = f[2] ? rows.filter(x => f[2].test(x.r.c + " " + x.r.n)) : rows;
  const cap = tAll ? shown.length : 12;

  // the outdoors block: activities ordered by how well they suit this month, today
  const moves = MOVES.filter(m => (!m.months || m.months.includes(mo)) && (SEASON[m.tab]||[])[mo-1] !== 0)
    .map(m => ({m, p:movePicks(m, dark, wet, mo)})).filter(x => x.p)
    .sort((a,b) => (SEASON[b.m.tab][mo-1] - SEASON[a.m.tab][mo-1]) - (dark || wet ? (+!a.m.out - +!b.m.out) : 0))
    .slice(0, 4);
  const groupMoves = rows.filter(x => ACTIVE.test(x.r.c + " " + x.r.n)).slice(0, 6);
  const light = sun ? (now < sun.rise ? `Sunrise ${fmtTime(sun.rise, tz)}`
    : now < sun.set ? `${Math.floor((sun.set-now)/36e5)}h ${Math.round((sun.set-now)%36e5/6e4)}m of daylight left · sunset ${fmtTime(sun.set, tz)}`
    : `Sunset was ${fmtTime(sun.set, tz)}`) : "";
  const card = (r, tab, why) => {
    const ref = tab + "|" + r.n;
    return `<article class="gcard" data-ref="${esc(ref)}" tabindex="0" role="button" aria-label="${esc(r.n)}: details">
      <div class="gtop"><span class="cat">${r.c}</span>${favStar(ref)}</div><h4>${r.n}</h4>
      <p class="gwhy">${why || r.s}</p><div class="gmeta">${gMeta(r)}</div></article>`;
  };

  const night = ["nightlife","eats"].filter(k => (DATA[k]||[]).length).map(k => {
    const near = DATA[k].filter(r => { const t = eff(r).t; return t != null && t <= 30; });
    return (near.length >= 3 ? near : DATA[k]).slice().sort((a,b) => pop(b) - pop(a)).slice(0, 3).map(r => card(r, k)).join("");
  }).join("");
  const week = typeof soonEvents === "function" ? soonEvents(7).filter(x => !happensToday(x.r.w)).slice(0, 10) : [];
  const head = {morning:"Here's the whole day.", afternoon:"Here's the rest of today, from this afternoon on.", evening:"Here's what's still on tonight."}[phase];

  document.getElementById("todayview").innerHTML = `
    <section class="ghero tdhero" aria-labelledby="tdTitle">
      <div class="geyebrow">${ck.wd} · ${fmtTime(now, tz)}</div>
      <h2 id="tdTitle">Today in ${CITY.placeShort}</h2>
      <p class="gintro">${head} ${rows.length ? `${rows.length} thing${rows.length>1?"s":""} on${phase==="morning"?" today":""}, ${groupMoves.length ? "a few of them group rides, runs and games you can just show up to" : "nearest first within each hour"}.` : "Nothing dated is on for the rest of today, so the picks below lean on what's always there."}</p>
      <div class="gstats">
        ${wx ? `<div class="gstat"><b>${wx.icon} ${wx.t}°F</b><span>${wx.label}${wx.hi > wx.t ? ` · high ${wx.hi}°` : ""}${wx.pp != null ? ` · ${wx.pp}% rain` : ""}</span></div>` : ""}
        ${light ? `<div class="gstat"><b>${dark || now < sun.rise ? "🌙 Dark out" : "🌤️ Daylight"}</b><span>${light}</span></div>` : ""}
        <div class="gstat"><b>${rows.length}</b><span>${phase === "evening" ? "still on tonight" : "on today"}</span></div>
      </div>
    </section>
    ${moves.length || groupMoves.length ? `<section class="gsec"><div class="gsech"><h3>${dark ? "Get moving tonight" : "Get outside today"}</h3>
      <span class="gsub">${wet ? (wx.wet ? "It's wet out" : `Rain likely today (${wx.pp}%)`) + ", so the outdoor picks are indoor ones." : dark ? "It's dark, so the outdoor picks are rinks and indoor spots." : "Riding, skating and the rest, ordered for this time of year."}</span></div>
      ${groupMoves.length ? `<div class="gblock"><div class="gbh"><span class="gico" aria-hidden="true">🏃</span><h4>Show up and play</h4></div>
        <ul class="tdl">${groupMoves.map(x => tdRow(x, nowMin)).join("")}</ul></div>` : ""}
      ${moves.map(({m, p}) => `<div class="gblock"><div class="gbh"><span class="gico" aria-hidden="true">${m.icon}</span><h4>${m.label}</h4>
        ${p.note ? `<span class="gsub">${p.note}</span>` : ""}<button class="gall" data-gotab="${m.tab}">All ${(DATA[m.tab]||[]).length} →</button></div>
        <div class="ggrid">${p.rows.map(r => card(r, m.tab)).join("")}</div></div>`).join("")}
    </section>` : ""}
    <section class="gsec"><div class="gsech"><h3>${phase === "evening" ? "Still on tonight" : phase === "afternoon" ? "From now on" : "On today"}</h3>
      <span class="gsub">Events, Meetups and weekly regulars, by start time.</span></div>
      <div class="gints tdf" role="group" aria-label="Show">${TFILTERS.map(x => `<button class="gint" data-tf="${x[0]}" aria-pressed="${tFilter===x[0]}">${x[1]}</button>`).join("")}</div>
      ${shown.length ? `<ul class="tdl">${shown.slice(0, cap).map(x => tdRow(x, nowMin)).join("")}</ul>
        ${shown.length > cap ? `<button class="gall tdmore" data-tmore="1">Show all ${shown.length} →</button>` : ""}`
        : `<div class="gempty">Nothing ${f[2] ? "like that " : ""}left on today. ${week.length ? "This week's dates are below." : ""}</div>`}
    </section>
    ${night ? `<section class="gsec"><div class="gsech"><h3>${phase === "morning" ? "Tonight, if you're going out" : "Tonight"}</h3>
      <span class="gsub">The best-loved floors and tables within about half an hour.</span></div><div class="ggrid">${night}</div></section>` : ""}
    ${week.length ? `<section class="gsec"><div class="gsech"><h3>Later this week</h3>
      <button class="gall" data-gotab="events">All ${(DATA.events||[]).length} events →</button></div>
      <div class="gscroll">${week.map(gEvent).join("")}</div></section>` : ""}
    <div class="gend"><button class="gbrowse" data-gotab="${HOME}">Browse every list →</button>
      <label class="tdpref"><input type="checkbox" id="tdPref" ${lsGet("open-on") === "lists" ? "" : "checked"}> Open on Today</label></div>`;
  document.title = `Today in ${CITY.placeShort} · ${CONFIG.brand}`;
}

// ---- wiring ---------------------------------------------------------------------------
// opening on Today is the default; the checkbox at the bottom turns it off (global, not per city)
const wantsToday = () => lsGet("open-on") !== "lists";
const todayTab = () => `<button class="gtab" id="todayTab" role="tab" aria-selected="false">☀ Today</button>`;
function syncTodayTab(){
  const t = document.getElementById("todayTab"); if(!t) return;
  const on = !!state.today && !state.item;
  t.classList.toggle("active", on); t.setAttribute("aria-selected", on);
  if(on) document.querySelectorAll("#tabs .tab").forEach(x => x.classList.remove("active"));
}
function openToday(){
  Object.assign(state, {today:true, guide:false, transit:false, item:null, fromGuide:false, tonight:false, allCities:false});
  ALLROWS = [];
  document.getElementById("tonightBtn").setAttribute("aria-pressed","false");
  render(); window.scrollTo(0,0);
}
document.getElementById("tabs").addEventListener("click", e => { if(e.target.closest("#todayTab")) openToday(); });
document.getElementById("todayview").addEventListener("click", e => {
  if(e.target.closest(".favbtn")){ favClick(e); return; }
  if(e.target.closest("a")) return;
  if(e.target.id === "tdPref"){ e.target.checked ? lsDel("open-on") : lsSet("open-on", "lists"); return; }
  const tf = e.target.closest("[data-tf]");
  if(tf){ tFilter = tf.dataset.tf; tAll = false; renderToday(); return; }
  if(e.target.closest("[data-tmore]")){ tAll = true; renderToday(); return; }
  const go = e.target.closest("[data-gotab]");
  if(go){ state.today = false; guideGoTab(go.dataset.gotab); return; }
  const card = e.target.closest("[data-ref]");
  if(card){
    const ref = card.dataset.ref;
    state.tab = keyParts(ref)[0]; state.item = ref; state.today = false; state.fromGuide = 2;
    render(); window.scrollTo(0,0);
  }
});
document.getElementById("todayview").addEventListener("keydown", e => {
  if(e.key !== "Enter" && e.key !== " ") return;
  const card = e.target.closest("[data-ref]");
  if(card && e.target === card){ e.preventDefault(); card.click(); }
});
// keep "from now on" honest while the page sits open
setInterval(() => { if(state.today && !document.hidden) renderToday(); }, 5*6e4);

document.head.insertAdjacentHTML("beforeend", `<style>
#todayview{margin-top:18px}
.tdhero .gintro{max-width:720px}
.tdl{list-style:none;background:var(--card);border-radius:14px;box-shadow:var(--shadow);overflow:hidden}
.tdi{display:grid;grid-template-columns:74px 1fr auto;gap:12px;align-items:center;padding:11px 14px;border-top:1px solid var(--line);cursor:pointer}
.tdi:first-child{border-top:0}
.tdi:hover h4{color:var(--accent)}
.tdi:focus-visible{outline:2px solid var(--hot);outline-offset:-2px}
.tdt{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--hot);text-transform:uppercase;letter-spacing:.6px}
.tdt.live{color:#fff;background:var(--accent);border-radius:6px;padding:3px 7px;justify-self:start}
.tdb h4{font-size:15px;color:var(--brand);line-height:1.3;transition:color .15s}
.tdb .gmeta{margin-top:4px}
.tdm{font-size:10.5px;font-weight:600;color:#c0392b;border:1px solid #f1c4bf;border-radius:5px;padding:1px 6px}
.tdf{margin:0 0 12px}
.tdf .gint{color:var(--brand);border-color:var(--line);background:var(--card)}
.tdf .gint[aria-pressed="true"]{background:var(--brand);color:#fff;border-color:var(--brand)}
.tdmore{margin-top:10px}
.tdpref{display:block;margin-top:14px;font-size:13px;color:var(--muted)}
.gsec .gblock{margin-top:18px}
@media (max-width:760px){.tdi{grid-template-columns:60px 1fr auto;padding:10px 12px}.tdf{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.tdf .gint{flex:0 0 auto}}
</style>`);
