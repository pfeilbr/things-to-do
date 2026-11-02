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
const TOP_KEYS = new Set(['intro', 'stats', 'plan', 'picks', 'areas', 'know']);
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

    // no coordinates of any kind in a guide file
    assert.ok(!/"ll"\s*:/.test(JSON.stringify(g)), `${guide}: guides must not carry ll`);
    assert.ok(!/-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/.test(JSON.stringify(g)), `${guide}: looks like a lat,lng pair`);
  });
}
