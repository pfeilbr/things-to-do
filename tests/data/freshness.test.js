// Date-rot guard: rows in `events`/`social` tabs whose `w` string carries only
// explicit calendar dates must not be stale. Recurring strings (no explicit
// dates) always pass. Events get 1 day of grace; social/annual entries get 45
// days before they're considered rotten and in need of a refresh.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const GRACE_DAYS = { events: 1, social: 45 };
const MS_DAY = 86400000;

function lastExplicitDate(w, now) {
  const dates = [...w.matchAll(/(\d{1,2})\/(\d{1,2})/g)]
    .map(m => ({ mo: +m[1], day: +m[2] }));
  // same-month range ends: "8/12–16" runs through the 16th
  for (const m of w.matchAll(/(\d{1,2})\/(\d{1,2})\s*[–-]\s*(\d{1,2})(?![\d/])/g))
    dates.push({ mo: +m[1], day: +m[3] });
  const valid = dates.filter(x => x.mo >= 1 && x.mo <= 12 && x.day >= 1 && x.day <= 31);
  if (!valid.length) return null;
  dates.length = 0; dates.push(...valid);
  if (!dates.length) return null; // recurring / evergreen
  let last = null;
  for (const { mo, day } of dates) {
    // year inference: dates more than ~6 months behind "now" roll to next year (Dec->Jan spans)
    let year = now.getFullYear();
    if (mo < now.getMonth() + 1 - 6) year++;
    const d = new Date(year, mo - 1, day);
    if (!last || d > last) last = d;
  }
  return last;
}

const now = new Date();
const dataFiles = fs.readdirSync(ROOT).filter(f => /^data.*\.json$/.test(f)).sort();

for (const file of dataFiles) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  for (const tab of ['events', 'social']) {
    if (!d[tab]) continue;
    test(`${file}/${tab}: no stale one-off dates`, () => {
      const stale = [];
      for (const r of d[tab]) {
        const last = lastExplicitDate(r.w, now);
        if (last && (now - last) / MS_DAY > GRACE_DAYS[tab]) {
          stale.push(`"${r.n}" (w="${r.w}", last ${last.toISOString().slice(0, 10)})`);
        }
      }
      assert.equal(stale.length, 0, `stale rows need refresh or pruning:\n  ${stale.join('\n  ')}`);
    });
  }
}
