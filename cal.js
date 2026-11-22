// "Add to calendar" (📅 in the When column) for Things To Do. Loaded by index.html next to
// today.js, ahead of the main script; like it, it only touches the page's globals (CITY,
// DATA, state, wSpan, daysIn, wTimes, cityClock, cityTZ, permalink…) at call time.
//
// A row's `w` string becomes calendar events: one dated day ("Sat 11/21 · 7p–9p"), a meetup
// series ("Tue 11/24 & Tue 12/1 · 6p–8p" → one event per date), a short timed run ("Fri–Sun
// 12/4–6 · 10a–5p" → one per day), a longer run (an all-day span), or a recurring series
// ("Wednesdays · 7p", "2nd Fri · 5p–9p (May–Oct)" → a repeating event with an RRULE). Times
// are the city's wall clock, written out in UTC so every calendar app agrees. Strings that
// don't pin down a date ("Most Weds", "Monthly · varies", "Select Sats") get no button.
// The menu offers Google Calendar (a prefilled link) and an .ics file (Apple / Outlook).

const ICSDAY = ["SU","MO","TU","WE","TH","FR","SA"];
const CAL_ORD = {"1st":1,first:1,"2nd":2,second:2,"3rd":3,third:3,"4th":4,fourth:4,last:-1};
const CAL_VAGUE = /every other|\bmost\b|select|monthly|quarterly|full-moon|twice|x monthly|\/mo\b|varies|ongoing|seasonal|\bin (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/;

// city wall clock (y, mo, d, minutes after midnight; minutes may pass 1440) → epoch ms
function cityMs(y, mo, d, min, tz){
  const want = Date.UTC(y, mo-1, d, 0, min);
  let ms = want;
  for(let i = 0; i < 2; i++){ const c = cityClock(ms, tz); ms += want - Date.UTC(c.y, c.mo-1, c.d, 0, c.min); }
  return ms;
}

// month window of a recurring string: "(Apr–Nov)", "(summer)"; null = year-round,
// false = a window it can't read ("(late Jun–Jul)") — better no button than a wrong series
function calWindow(s){
  const p = s.match(/\(([^)]*)\)/);
  if(!p || /^(weekly|year-round)$/.test(p[1].trim())) return null;
  if(p[1].trim() === "summer") return [6,7,8];
  const m = p[1].trim().match(/^([a-z]{3})[a-z]*\s*[–-]\s*([a-z]{3})[a-z]*$/);
  if(!m || !MONNUM[m[1]] || !MONNUM[m[2]]) return false;
  const out = [];
  for(let i = MONNUM[m[1]];; i = i % 12 + 1){ out.push(i); if(i === MONNUM[m[2]]) break; }
  return out;
}

// What to put on the calendar for a `w` string, as of `now`:
// {occ:[{y,mo,d,days}], tm:{s,e}|null, rrule:string|null}, or null when it can't be pinned down.
function calPlan(w, now){
  const s = String(w||"").toLowerCase();
  if(!s || CAL_VAGUE.test(s)) return null;
  const head = s.split("·")[0];
  // several times of day ("Wed 6p & Sat 8a", "Sun · 6p & Mon · 5:30p") can't share one event
  if((s.match(/·/g)||[]).length > 1 || /\d\s*[ap]m?\b|\d:\d\d|noon/.test(head)) return null;
  const tm = wTimes(w);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ymd = (dt, days=1) => ({y:dt.getFullYear(), mo:dt.getMonth()+1, d:dt.getDate(), days});
  const plus = (dt, n) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()+n);

  if(/\d{1,2}\/\d{1,2}/.test(s)){
    let occ;
    if(/&/.test(head) && !/\d\s*[–-]\s*(?:[a-z]{3,4}\s+)?\d/.test(head)){
      // a list of separate dates: "Tue 11/24 & Tue 12/1"
      occ = [...head.matchAll(/(\d{1,2})\/(\d{1,2})/g)].map(m => wSpan(m[0], now).start).map(dt => ymd(dt));
    } else {
      const sp = wSpan(w, now);
      let start = sp.start;
      if(/thru/.test(s) && +sp.start === +sp.end && sp.end >= today) start = today;   // "Thru 12/31"
      const n = Math.round((sp.end - start) / 864e5) + 1;
      occ = n === 1 ? [ymd(start)]
        : tm && n <= 7 ? Array.from({length:n}, (_, i) => ymd(plus(start, i)))      // nightly through a short run
        : [ymd(start, n)];                                                          // one all-day span
    }
    occ = occ.filter(o => new Date(o.y, o.mo-1, o.d + o.days - 1) >= today);
    if(!occ.length) return null;
    return {occ, tm: occ.some(o => o.days > 1) ? null : tm, rrule:null};
  }

  // recurring: needs a time of day and the weekdays it falls on
  if(!tm) return null;
  const days = /daily|nightly/.test(head) ? new Set([0,1,2,3,4,5,6])
    : /week(day|night)s/.test(head) ? new Set([1,2,3,4,5])
    : /weekends?\b/.test(head) ? new Set([0,6]) : daysIn(head);
  if(!days || !days.size) return null;
  const win = calWindow(s);
  if(win === false) return null;
  const ords = [...head.matchAll(/\b(1st|2nd|3rd|4th|first|second|third|fourth|last)\b/g)].map(m => CAL_ORD[m[1]]);
  const dl = [...days].sort();
  const by = ords.length ? ords.flatMap(o => dl.map(i => o + ICSDAY[i])) : dl.map(i => ICSDAY[i]);
  const rrule = `FREQ=${ords.length ? "MONTHLY" : "WEEKLY"};BYDAY=${by.join(",")}` + (win ? `;BYMONTH=${win.join(",")}` : "");
  // first date on or after today that fits the rule
  for(let i = 0; i < 400; i++){
    const dt = plus(today, i), mo = dt.getMonth()+1, dom = dt.getDate();
    if(!days.has(dt.getDay()) || (win && !win.includes(mo))) continue;
    const nth = Math.ceil(dom/7), last = plus(dt, 7).getMonth() !== dt.getMonth();
    if(ords.length && !ords.some(o => o === nth || (o === -1 && last))) continue;
    return {occ:[ymd(dt)], tm, rrule};
  }
  return null;
}

// Each occurrence as {allDay, start, end}: epoch ms for timed ones, "YYYYMMDD" for all-day
// (end exclusive, as both calendar formats want). A start with no end is given two hours.
function calTimes(plan, tz){
  const p2 = n => String(n).padStart(2, "0");
  const day = (y, mo, d) => { const t = new Date(Date.UTC(y, mo-1, d)); return `${t.getUTCFullYear()}${p2(t.getUTCMonth()+1)}${p2(t.getUTCDate())}`; };
  return plan.occ.map(o => {
    if(!plan.tm) return {allDay:true, start:day(o.y, o.mo, o.d), end:day(o.y, o.mo, o.d + o.days)};
    const start = cityMs(o.y, o.mo, o.d, plan.tm.s, tz);
    const end = plan.tm.e == null ? start + 72e5 : cityMs(o.y, o.mo, o.d, plan.tm.e, tz);
    return {allDay:false, start, end};
  });
}
const icsUtc = ms => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// the row's text, decoded (rows are written for innerHTML, so they may carry &amp; and friends)
function calText(x){
  x = String(x == null ? "" : x);
  if(typeof document === "undefined" || !/&\w+;|&#/.test(x)) return x;
  const t = document.createElement("textarea"); t.innerHTML = x; return t.value;
}
function calInfo(r){
  const city = r._city || CITY, tab = !r._city && Object.keys(DATA).find(t => (DATA[t]||[]).includes(r));
  let link = "";
  try { if(tab) link = permalink(`${tab}|${r.n}`); } catch(e) {}
  return {
    title: calText(r.n),
    details: [calText(r.s), "", `When: ${calText(r.w)}`, r.u ? `Info: ${r.u}` : "", link ? `Guide: ${link}` : ""].filter((x, i) => x || i === 1).join("\n").trim(),
    location: r.ll ? `${r.ll[0]},${r.ll[1]}` : calText(city.place || ""),
    tz: cityTZ(city.id),
  };
}

function icsText(r, plan, info, nowMs){
  const esc = x => String(x).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const fold = line => {                       // RFC 5545: lines of at most 75 octets
    const enc = new TextEncoder(), out = [];
    let cur = "";
    for(const ch of line){
      if(enc.encode(cur + ch).length > (out.length ? 74 : 75)){ out.push(cur); cur = ""; }
      cur += ch;
    }
    out.push(cur);
    return out.join("\r\n ");
  };
  const uid = String(r.n).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event";
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Things To Do//Guide//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for(const t of calTimes(plan, info.tz)){
    L.push("BEGIN:VEVENT", `UID:${uid}-${t.allDay ? t.start : icsUtc(t.start)}@things-to-do`, `DTSTAMP:${icsUtc(nowMs)}`);
    if(t.allDay) L.push(`DTSTART;VALUE=DATE:${t.start}`, `DTEND;VALUE=DATE:${t.end}`);
    else L.push(`DTSTART:${icsUtc(t.start)}`, `DTEND:${icsUtc(t.end)}`);
    if(plan.rrule) L.push(`RRULE:${plan.rrule}`);
    L.push(`SUMMARY:${esc(info.title)}`, `DESCRIPTION:${esc(info.details)}`, `LOCATION:${esc(info.location)}`);
    if(r.ll) L.push(`GEO:${r.ll[0]};${r.ll[1]}`);
    if(r.u) L.push(`URL:${r.u}`);
    L.push("END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}

// Google's prefilled-event link takes one event: the first upcoming date (the details keep
// the full `w` string, so the rest of a series is still in front of you).
function gcalUrl(plan, info){
  const t = calTimes(plan, info.tz)[0];
  const p = new URLSearchParams({action:"TEMPLATE", text:info.title,
    dates: t.allDay ? `${t.start}/${t.end}` : `${icsUtc(t.start)}/${icsUtc(t.end)}`,
    details:info.details, location:info.location, ctz:info.tz});
  if(plan.rrule) p.set("recur", `RRULE:${plan.rrule}`);
  return "https://calendar.google.com/calendar/render?" + p.toString();
}

// ---- the button and its menu ------------------------------------------------------------
const CALROWS = new Map();          // "name|w" → row, for the click handler
const calKey = r => `${r.n}|${r.w}`;
const calAttr = x => String(x).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
function calBtn(r){
  if(!r || !r.w || !calPlan(r.w, new Date())) return "";
  CALROWS.set(calKey(r), r);
  const name = calAttr(calText(r.n));
  return `<button type="button" class="calbtn" data-cal="${calAttr(calKey(r))}" aria-haspopup="menu" aria-expanded="false" title="Add to calendar" aria-label="Add ${name} to calendar">📅</button>`;
}

let calOpen = null;                 // {btn, menu}
function calClose(){
  if(!calOpen) return;
  calOpen.menu.remove();
  calOpen.btn.setAttribute("aria-expanded", "false");
  calOpen = null;
}
function calMenu(btn){
  const r = CALROWS.get(btn.dataset.cal), now = new Date();
  const plan = r && calPlan(r.w, now);
  if(!plan) return;
  const info = calInfo(r);
  const menu = document.createElement("div");
  menu.className = "calmenu"; menu.setAttribute("role", "menu");
  menu.innerHTML = `<a role="menuitem" href="${calAttr(gcalUrl(plan, info))}" target="_blank" rel="noopener"><span class="mico">🗓️</span>Google Calendar</a>`
    + `<button type="button" role="menuitem" data-ics="1"><span class="mico">📥</span>Apple / Outlook (.ics)</button>`;
  menu._ics = () => {
    const url = URL.createObjectURL(new Blob([icsText(r, plan, info, now.getTime())], {type:"text/calendar;charset=utf-8"}));
    const a = document.createElement("a");
    a.href = url; a.download = `${String(info.title).replace(/[\\/:*?"<>|]+/g, "").slice(0, 80) || "event"}.ics`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1e4);
  };
  document.body.appendChild(menu);
  const b = btn.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(b.left, innerWidth - mw - 8)) + "px";
  menu.style.top = (b.bottom + mh + 8 > innerHeight && b.top > mh + 8 ? b.top - mh - 4 : b.bottom + 4) + "px";
  btn.setAttribute("aria-expanded", "true");
  calOpen = {btn, menu};
  menu.querySelector("[role=menuitem]").focus({preventScroll:true});
}

if(typeof document !== "undefined"){
  // capture phase, so the row underneath never sees the click and doesn't expand
  document.addEventListener("click", e => {
    const btn = e.target.closest && e.target.closest(".calbtn");
    if(btn){
      e.stopPropagation(); e.preventDefault();
      const same = calOpen && calOpen.btn === btn;
      calClose();
      if(!same) calMenu(btn);
      return;
    }
    if(calOpen && calOpen.menu.contains(e.target)){
      if(e.target.closest("[data-ics]")) calOpen.menu._ics();
      setTimeout(calClose, 0);
      return;
    }
    calClose();
  }, true);
  document.addEventListener("keydown", e => {
    if(e.key === "Escape" && calOpen){ const b = calOpen.btn; calClose(); b.focus(); e.stopPropagation(); return; }
    if((e.key === "Enter" || e.key === " ") && e.target.closest && e.target.closest(".calbtn, .calmenu")) e.stopPropagation();
    if(calOpen && (e.key === "ArrowDown" || e.key === "ArrowUp") && calOpen.menu.contains(e.target)){
      const items = [...calOpen.menu.querySelectorAll("[role=menuitem]")];
      items[(items.indexOf(e.target) + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
      e.preventDefault();
    }
  }, true);
  addEventListener("scroll", calClose, {passive:true});
  addEventListener("resize", calClose);

  const st = document.createElement("style");
  st.textContent = `
.calbtn{background:none;border:none;cursor:pointer;font-size:12px;padding:0 2px;margin-left:6px;opacity:.75;vertical-align:0;line-height:1}
.calbtn:hover,.calbtn[aria-expanded="true"]{opacity:1}
.calbtn:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
.calmenu{position:fixed;z-index:60;min-width:210px;background:var(--card);border-radius:var(--radius,10px);
  box-shadow:0 6px 24px rgba(21,48,78,.28);padding:6px}
.calmenu a,.calmenu button{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:none;border:none;
  border-radius:7px;cursor:pointer;font-family:'Inter',sans-serif;font-size:14px;color:var(--text);padding:10px 12px;text-decoration:none}
.calmenu a:hover,.calmenu button:hover,.calmenu a:focus-visible,.calmenu button:focus-visible{background:#eef2f7;outline:none}
.calmenu .mico{width:20px;text-align:center}`;
  document.head.appendChild(st);
}
