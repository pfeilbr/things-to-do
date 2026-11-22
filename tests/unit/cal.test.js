// Unit tests for "Add to calendar" (cal.js): how a row's `w` string turns into calendar
// events, the city-clock → UTC conversion, the .ics text and the Google Calendar link.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const today = fs.readFileSync(path.join(ROOT, 'today.js'), 'utf8');
const grab = (src, re) => { const m = src.match(re); if (!m) throw new Error('extraction failed: ' + re); return m[0]; };
const ctx = vm.createContext({ Intl, Date, Math, URLSearchParams, TextEncoder, String, Array, Set, Object });
const C = vm.runInContext([
  grab(html, /const MONNUM = \{[^\n]*\n/), grab(html, /const DOWNUM = \{[^\n]*\n/), grab(html, /const DAYRE\s*=\s*"[^"]*";/),
  grab(html, /function daysIn[\s\S]*?\n\}/), grab(html, /function wSpan[\s\S]*?\n\}/),
  grab(today, /const CITY_TZ = \{[\s\S]*?\};/), grab(today, /const cityTZ = [^\n]*/),
  grab(today, /function cityClock[\s\S]*?\n\}/), grab(today, /function wTimes[\s\S]*?\n\}/),
  fs.readFileSync(path.join(ROOT, 'cal.js'), 'utf8'),
].join('\n') + '\n;({ calPlan, calTimes, cityMs, icsText, gcalUrl, calBtn, wSpan });', ctx);

const NOW = new Date(2026, 10, 22, 10, 0);        // Sun Nov 22 2026, 10a
const NY = 'America/New_York';
const plan = w => { const p = C.calPlan(w, NOW); return p && JSON.parse(JSON.stringify(p)); };
const day = (y, mo, d, days = 1) => ({ y, mo, d, days });

test('one dated day, with and without a time', () => {
  assert.deepEqual(plan('Sat 11/28 · 7p–9p'), { occ: [day(2026, 11, 28)], tm: { s: 1140, e: 1260 }, rrule: null });
  assert.deepEqual(plan('Thu 12/10'), { occ: [day(2026, 12, 10)], tm: null, rrule: null });
  assert.equal(plan('Sat 11/21 · 5p'), null, 'already past');
  assert.deepEqual(plan('Sat 1/9 · 8p').occ, [day(2027, 1, 9)], 'January rolls into next year');
});

test('a meetup series becomes one event per remaining date', () => {
  assert.deepEqual(plan('Sat 11/21 & Sat 11/28 & Sat 12/5 · 10a–12p').occ, [day(2026, 11, 28), day(2026, 12, 5)]);
  assert.deepEqual(plan('Tue 12/29 & Tue 1/5 · 6p–8p').occ, [day(2026, 12, 29), day(2027, 1, 5)]);
});

test('runs: short timed ones nightly, long or untimed ones as an all-day span', () => {
  assert.deepEqual(plan('Fri–Sun 12/4–6 · 10a–5p').occ, [day(2026, 12, 4), day(2026, 12, 5), day(2026, 12, 6)]);
  assert.deepEqual(plan('Sat–Sun 12/12–13'), { occ: [day(2026, 12, 12, 2)], tm: null, rrule: null });
  assert.deepEqual(plan('Fri 11/27 – Sun 1/3'), { occ: [day(2026, 11, 27, 38)], tm: null, rrule: null });
  assert.deepEqual(plan('Fri 11/20 – Sun 11/22').occ, [day(2026, 11, 20, 3)], 'a run that includes today stays');
  assert.deepEqual(plan('Thru 12/31').occ, [day(2026, 11, 22, 40)], '"thru" starts today');
});

test('recurring series get an RRULE and their next date', () => {
  assert.deepEqual(plan('Wednesdays · 7p–9p'), { occ: [day(2026, 11, 25)], tm: { s: 1140, e: 1260 }, rrule: 'FREQ=WEEKLY;BYDAY=WE' });
  assert.equal(plan('Sundays · 9p').occ[0].d, 22, 'today counts');
  assert.equal(plan('Tue & Thu · 7:15p–9:15p').rrule, 'FREQ=WEEKLY;BYDAY=TU,TH');
  assert.equal(plan('Daily · 7a–10p').rrule, 'FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA');
  assert.equal(plan('Mon–Fri · 12p').rrule, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  const m = plan('2nd Fri · 5p–9p');
  assert.equal(m.rrule, 'FREQ=MONTHLY;BYDAY=2FR');
  assert.deepEqual(m.occ, [day(2026, 12, 11)]);
  assert.equal(plan('1st & 3rd Sat · 9:30p–1:30a').rrule, 'FREQ=MONTHLY;BYDAY=1SA,3SA');
  assert.deepEqual(plan('Last Sun · 6p').occ, [day(2026, 11, 29)]);
  assert.equal(plan('Second & fourth Sundays · 7p–10p').rrule, 'FREQ=MONTHLY;BYDAY=2SU,4SU');
  const s = plan('Saturdays · 9:30a–1p (Apr–Nov)');
  assert.equal(s.rrule, 'FREQ=WEEKLY;BYDAY=SA;BYMONTH=4,5,6,7,8,9,10,11');
  assert.deepEqual(s.occ, [day(2026, 11, 28)]);
  assert.deepEqual(plan('Thursdays · 8:30a–11:30a (Jun–Sep)').occ, [day(2027, 6, 3)], 'out of season → next season');
  assert.equal(plan('Sundays · 8a–3p (year-round)').rrule, 'FREQ=WEEKLY;BYDAY=SU');
  assert.equal(plan('Saturdays · 8a (summer)').rrule, 'FREQ=WEEKLY;BYDAY=SA;BYMONTH=6,7,8');
});

test('strings that do not pin down a date get no calendar event', () => {
  for (const w of ['Most Weds · 6:30p', 'Monthly · varies', 'Select Sats · 7p', 'Every other Wed · 7p', '2 Weds/mo · 6p',
    'Fridays (weekly)', 'Wed 6p & Sat 8a', 'Sun · 6p & Mon · 5:30p', 'Ongoing thru Jan 2027', 'Weekends in October',
    'Tue–Sat · 6:45p (late Jun–Jul)', 'Weeknights · classes + socials', 'Ongoing', '', undefined])
    assert.equal(C.calPlan(w, NOW), null, String(w));
});

test('city wall clock converts to UTC across time zones and DST', () => {
  assert.equal(new Date(C.cityMs(2026, 11, 28, 19 * 60, NY)).toISOString(), '2026-11-29T00:00:00.000Z');
  assert.equal(new Date(C.cityMs(2026, 7, 4, 21 * 60, NY)).toISOString(), '2026-07-05T01:00:00.000Z');
  assert.equal(new Date(C.cityMs(2026, 11, 28, 19 * 60, 'America/Los_Angeles')).toISOString(), '2026-11-29T03:00:00.000Z');
  assert.equal(new Date(C.cityMs(2026, 11, 27, 26 * 60, NY)).toISOString(), '2026-11-28T07:00:00.000Z', 'past midnight');
});

test('times: end defaults to two hours, all-day ends are exclusive', () => {
  const [t] = C.calTimes(C.calPlan('Sat 11/28 · 7p', NOW), NY);
  assert.equal(t.end - t.start, 2 * 3600e3);
  const [a] = C.calTimes(C.calPlan('Sat–Sun 12/12–13', NOW), NY);
  assert.deepEqual({ ...a }, { allDay: true, start: '20261212', end: '20261214' });
  const [n] = C.calTimes(C.calPlan('Fri 11/27 · 10p–2a', NOW), NY);
  assert.equal(new Date(n.end).toISOString(), '2026-11-28T07:00:00.000Z', 'ends after midnight');
});

const ROW = { n: 'Holiday Lights, Market & Carols', s: 'Lights; carols, cocoa\nand a market', w: 'Tue 11/24 & Tue 12/1 · 6p–8p',
  u: 'https://example.org/lights', ll: [40.7, -73.9] };
const INFO = { title: ROW.n, details: 'Lights; carols, cocoa\nand a market\n\nWhen: ' + ROW.w, location: '40.7,-73.9', tz: NY };

test('.ics: content', () => {
  const p = C.calPlan(ROW.w, NOW);
  assert.equal(p.occ.length, 2);
  const ics = C.icsText(ROW, p, INFO, NOW.getTime());
  const unfolded = ics.replace(/\r\n /g, '');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  assert.ok(unfolded.includes('DTSTART:20261124T230000Z') && unfolded.includes('DTEND:20261125T010000Z'));
  assert.ok(unfolded.includes('DTSTART:20261201T230000Z'));
  assert.ok(unfolded.includes('SUMMARY:Holiday Lights\\, Market & Carols'));
  assert.ok(unfolded.includes('DESCRIPTION:Lights\\; carols\\, cocoa\\nand a market'));
  assert.ok(unfolded.includes('GEO:40.7;-73.9') && unfolded.includes('URL:https://example.org/lights'));
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
  const rec = C.icsText(ROW, C.calPlan('Wednesdays · 7p', NOW), INFO, NOW.getTime());
  assert.ok(rec.includes('RRULE:FREQ=WEEKLY;BYDAY=WE'));
  const allDay = C.icsText(ROW, C.calPlan('Sat–Sun 12/12–13', NOW), INFO, NOW.getTime());
  assert.ok(allDay.includes('DTSTART;VALUE=DATE:20261212') && allDay.includes('DTEND;VALUE=DATE:20261214'));
});

test('Google Calendar link: first upcoming date, details, location, recurrence', () => {
  const u = new URL(C.gcalUrl(C.calPlan(ROW.w, NOW), INFO));
  assert.equal(u.origin + u.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(u.searchParams.get('action'), 'TEMPLATE');
  assert.equal(u.searchParams.get('text'), ROW.n);
  assert.equal(u.searchParams.get('dates'), '20261124T230000Z/20261125T010000Z');
  assert.equal(u.searchParams.get('location'), '40.7,-73.9');
  assert.equal(u.searchParams.get('ctz'), NY);
  assert.ok(u.searchParams.get('details').includes('When: '));
  const r = new URL(C.gcalUrl(C.calPlan('2nd Fri · 5p–9p', NOW), INFO));
  assert.equal(r.searchParams.get('recur'), 'RRULE:FREQ=MONTHLY;BYDAY=2FR');
  const a = new URL(C.gcalUrl(C.calPlan('Thu 12/10', NOW), INFO));
  assert.equal(a.searchParams.get('dates'), '20261210/20261211');
});

test('every dated event in every dataset that is still ahead gets a button', () => {
  const misses = [];
  for (const f of fs.readdirSync(ROOT).filter(f => /^data(-[a-z]+)?\.json$/.test(f))) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    for (const tab of ['events', 'meetup']) for (const r of d[tab] || []) {
      if (!/\d{1,2}\/\d{1,2}/.test(r.w || '')) continue;
      const now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (C.wSpan(r.w, now).end < t0) continue;          // ended, waiting for `events.py prune`
      if (!C.calPlan(r.w, now)) misses.push(`${f} ${tab}: ${r.n} — ${r.w}`);
    }
  }
  assert.equal(misses.length, 0, `dated rows without a calendar event:\n${misses.join('\n')}`);
});
