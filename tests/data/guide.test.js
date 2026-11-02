// The first-visit guides (guide-<city>.json). A guide holds only editorial copy and
// "tab|name" refs into its city's dataset, so the thing most likely to rot is a ref:
// a row gets renamed or pruned and the pick silently vanishes from the page. Every ref
// must resolve, every interest id must be one index.html knows, and nothing in a guide
// may carry a coordinate (the rows already have `ll`; the origin never does).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const INTEREST_IDS = new Set([...indexHtml.matchAll(/\{id:"(\w+)",\s*icon:/g)].map(m => m[1]));
const TOP_KEYS = new Set(['intro', 'stats', 'plan', 'picks', 'areas', 'know', 'transit']);
const WHY_MIN = 20, WHY_MAX = 240;

// CONFIG entries that name a guide: data:"data-x.json", guide:"guide-x.json"
const guided = [...indexHtml.matchAll(/data:"(data[^"]*\.json)",\s*guide:"(guide-[^"]+\.json)"/g)]
  .map(m => ({ data: m[1], guide: m[2] }));
const onDisk = fs.readdirSync(ROOT).filter(f => /^guide-.*\.json$/.test(f)).sort();

test('interest ids parse out of index.html', () => {
  assert.ok(INTEREST_IDS.size >= 8, `found ${INTEREST_IDS.size} interests`);
});

test('every guide file is referenced by CONFIG, precached, and vice versa', () => {
  assert.deepEqual(guided.map(g => g.guide).sort(), onDisk, 'CONFIG guide:"…" entries match guide-*.json on disk');
  for (const f of onDisk) assert.ok(swJs.includes(`"./${f}"`), `sw.js PRECACHE missing ${f}`);
});

for (const { data, guide } of guided) {
  test(`${guide}: shape, refs and copy`, () => {
    const g = JSON.parse(fs.readFileSync(path.join(ROOT, guide), 'utf8'));
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, data), 'utf8'));
    for (const k of Object.keys(g)) assert.ok(TOP_KEYS.has(k), `${guide}: unknown key ${k}`);
    assert.ok(typeof g.intro === 'string' && g.intro.length >= 60 && g.intro.length <= 420, `${guide}: intro length`);

    const resolves = ref => {
      const i = ref.indexOf('|');
      return i > 0 && (d[ref.slice(0, i)] || []).some(r => r.n === ref.slice(i + 1));
    };
    const why = (s, where) => assert.ok(typeof s === 'string' && s.length >= WHY_MIN && s.length <= WHY_MAX,
      `${guide} ${where}: why must be ${WHY_MIN}-${WHY_MAX} chars (got ${s && s.length})`);

    assert.ok(Array.isArray(g.plan) && g.plan.length >= 1, `${guide}: plan needs at least one day`);
    for (const [di, day] of g.plan.entries()) {
      assert.ok(day.title, `${guide}: plan[${di}] title`);
      assert.ok(day.slots.length >= 3, `${guide}: plan[${di}] needs 3+ slots`);
      for (const [si, slot] of day.slots.entries()) {
        assert.ok(slot.when && slot.options.length, `${guide}: plan[${di}].slots[${si}]`);
        // the last option is the fallback when none of the tagged ones match your interests
        // or the season, so it carries neither tag
        const last = slot.options[slot.options.length - 1];
        assert.ok(!last.i && !last.months,
          `${guide}: plan[${di}].slots[${si}] last option must be untagged so the slot never empties`);
        for (const o of slot.options) {
          assert.ok(resolves(o.ref), `${guide}: plan ref "${o.ref}" is not a row in ${data}`);
          if (o.i) assert.ok(INTEREST_IDS.has(o.i), `${guide}: unknown interest "${o.i}"`);
          if (o.months) assert.ok(o.months.length && o.months.every(m => Number.isInteger(m) && m >= 1 && m <= 12),
            `${guide}: "${o.ref}" months must be 1–12`);
          why(o.why, `plan "${o.ref}"`);
        }
      }
    }

    for (const [id, list] of Object.entries(g.picks || {})) {
      assert.ok(INTEREST_IDS.has(id), `${guide}: picks for unknown interest "${id}"`);
      assert.ok(list.length >= 2 && list.length <= 6, `${guide}: picks.${id} wants 2–6 picks`);
      const seen = new Set();
      for (const p of list) {
        assert.ok(resolves(p.ref), `${guide}: pick ref "${p.ref}" is not a row in ${data}`);
        assert.ok(!seen.has(p.ref), `${guide}: duplicate pick ${p.ref}`); seen.add(p.ref);
        why(p.why, `picks.${id} "${p.ref}"`);
      }
    }

    for (const a of g.areas || []) assert.ok(a.n && a.s && a.s.length <= WHY_MAX, `${guide}: area ${a.n}`);
    for (const f of g.know || []) {
      assert.ok(f.title && f.text && f.text.length <= WHY_MAX, `${guide}: know "${f.title}"`);
      assert.match(f.u || '', /^https:\/\//, `${guide}: know "${f.title}" needs a source URL`);
    }

    // the train board's editorial half (transit.js reads it; the timetable is transit-<city>.json)
    if (g.transit) {
      const t = g.transit, tf = data.replace(/^data-/, 'transit-');
      const T = fs.existsSync(path.join(ROOT, tf)) ? JSON.parse(fs.readFileSync(path.join(ROOT, tf), 'utf8')) : null;
      assert.ok(T, `${guide}: has a transit block but ${tf} is missing`);
      assert.ok(t.tab && t.city, `${guide}: transit.tab and transit.city`);
      if (t.alert) assert.match(t.alertU || '', /^https:\/\//, `${guide}: transit.alert needs a source (alertU)`);
      if (t.home) assert.ok(T.home.includes(t.home), `${guide}: transit.home "${t.home}" is not a home station`);
      assert.ok(Array.isArray(t.dests) && t.dests.length && t.dests[0].walk === 0, `${guide}: first dest is the hub itself (walk 0)`);
      for (const d of t.dests) assert.ok(d.id && d.n && Number.isInteger(d.walk) && d.walk >= 0 && d.walk < 60, `${guide}: dest ${d.id}`);
      for (const [k, f] of Object.entries(t.fares || {})) {
        assert.ok(T.home.includes(k), `${guide}: fares for unknown station ${k}`);
        assert.ok(f.peak > 0 && f.off > 0 && f.off <= f.peak, `${guide}: fares.${k} peak/off`);
      }
      if (t.fares) assert.match(t.faresU || '', /^https:\/\//, `${guide}: fares need a source (faresU)`);
      if (t.bike) {
        const win = w => Array.isArray(w) && w.length === 2 && w.every(Number.isInteger) && w[0] < w[1] && w[1] <= 1800;
        for (const r of t.bike.rush || []) assert.ok((r.dir === 0 || r.dir === 1) && win(r.hub), `${guide}: bike.rush ${JSON.stringify(r)}`);
        for (const d of t.bike.blackout || []) assert.match(d, /^\d{4}-\d\d-\d\d$/, `${guide}: bike blackout ${d}`);
        for (const x of t.bike.partial || []) {
          assert.ok(x.dates.every(d => /^\d{4}-\d\d-\d\d$/.test(d)) && x.hub.every(win), `${guide}: bike.partial ${JSON.stringify(x)}`);
          if ('dir' in x) assert.ok(x.dir === 0 || x.dir === 1, `${guide}: bike.partial dir`);
        }
        assert.match(t.bike.u || '', /^https:\/\//, `${guide}: bike rules need a source`);
      }
      for (const sec of t.sections || []) {
        assert.ok(sec.title && sec.items.length, `${guide}: transit section ${sec.title}`);
        for (const f of sec.items) {
          assert.ok(f.title && f.text && f.text.length <= 320, `${guide}: transit "${f.title}" (text <= 320)`);
          assert.match(f.u || '', /^https:\/\//, `${guide}: transit "${f.title}" needs a source URL`);
        }
      }
    }

    // no coordinates of any kind in a guide file
    assert.ok(!/"ll"\s*:/.test(JSON.stringify(g)), `${guide}: guides must not carry ll`);
    assert.ok(!/-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/.test(JSON.stringify(g)), `${guide}: looks like a lat,lng pair`);
  });
}
