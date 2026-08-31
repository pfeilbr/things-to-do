// Schema + consistency tests for every city dataset. Protects manual edits
// and the recurring events-refresh automation from shipping broken data.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const ALLOWED = new Set(['n', 'c', 's', 'd', 't', 'u', 'r', 'rc', 'll', 'w']);
const PHILLY_TABS = ['attractions', 'events', 'nightlife', 'eats', 'biking', 'social', 'fishing', 'chinese'];
const CITY_TABS = ['spots', 'nightlife', 'eats', 'chinese', 'fishing', 'biking', 'social'];
// The NYC-area guides carry the everyday-life tabs on top of the interest tabs (see
// HOME_TABS in index.html). Forest Hills is a walking-distance neighborhood guide, so it
// drops the two tabs that are inherently a drive away.
const DAILY_TABS = ['museums', 'sights', 'walks', 'shops', 'essentials'];
// the NYC-area guides also carry dated events (Boston does not, yet)
const NYC_EXTRA = [...DAILY_TABS, 'events'];
const LAYOUTS = {
  'data.json': PHILLY_TABS,
  'data-nyc.json': [...CITY_TABS, ...NYC_EXTRA],
  'data-brooklyn.json': [...CITY_TABS, ...NYC_EXTRA],
  'data-queens.json': [...CITY_TABS, ...NYC_EXTRA],
  'data-flushing.json': [...CITY_TABS, ...NYC_EXTRA],
  'data-boston.json': [...CITY_TABS, ...DAILY_TABS],
  'data-foresthills.json': ['spots', 'nightlife', 'eats', 'chinese', 'social', ...NYC_EXTRA],
  // Ithaca is a campus guide: the everyday tabs plus a Coffee tab of its own.
  'data-ithaca.json': [...CITY_TABS, ...NYC_EXTRA, 'coffee'],
};

const dataFiles = fs.readdirSync(ROOT).filter(f => /^data.*\.json$/.test(f)).sort();
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

for (const file of dataFiles) {
  test(`${file}: schema`, () => {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const keys = Object.keys(d).sort();
    const layout = LAYOUTS[file] || CITY_TABS;
    assert.deepEqual(keys, [...layout].sort(), `${file} tab keys`);
    let rows = 0, withLL = 0;
    for (const [tab, list] of Object.entries(d)) {
      assert.ok(Array.isArray(list), `${tab} is an array`);
      const seen = new Set();
      const wTab = tab === 'social' || tab === 'events';
      for (const r of list) {
        rows++;
        const id = `${file}/${tab}/${r.n}`;
        for (const k of Object.keys(r)) assert.ok(ALLOWED.has(k), `${id}: unknown key ${k}`);
        for (const k of ['n', 'c', 's']) assert.ok(typeof r[k] === 'string' && r[k].length, `${id}: ${k}`);
        assert.ok(typeof r.d === 'number' && r.d >= 0 && r.d <= 250, `${id}: d=${r.d}`);
        assert.ok(Number.isInteger(r.t) && r.t >= 0 && r.t <= 250, `${id}: t=${r.t}`); // t=0 allowed: delivery-service rows
        if (r.u != null) assert.match(r.u, /^https?:\/\//, `${id}: u`);
        if (r.r != null) assert.ok(typeof r.r === 'number' && r.r >= 1 && r.r <= 5, `${id}: r=${r.r}`);
        if (r.rc != null) assert.ok(Number.isInteger(r.rc) && r.rc > 0, `${id}: rc=${r.rc}`);
        if (r.ll != null) {
          withLL++;
          assert.ok(Array.isArray(r.ll) && r.ll.length === 2, `${id}: ll shape`);
          const [lat, lon] = r.ll;
          assert.ok(lat > 24 && lat < 50 && lon > -130 && lon < -60, `${id}: ll range ${r.ll}`);
        }
        if (wTab) assert.ok(typeof r.w === 'string' && r.w.length, `${id}: w required in ${tab}`);
        else assert.ok(!('w' in r), `${id}: w not allowed in ${tab}`);
        assert.ok(!seen.has(r.n), `${id}: duplicate name in tab`);
        seen.add(r.n);
      }
    }
    const coverage = withLL / rows;
    // 10 legacy Philly rows have no findable OSM entry (verified by geocode
    // attempt Aug 2026) + 1 virtual delivery row; ratchet upward as resolved.
    const minCoverage = file === 'data.json' ? 0.98 : 1.0;
    assert.ok(coverage >= minCoverage, `${file}: ll coverage ${(coverage * 100).toFixed(1)}% < ${minCoverage * 100}%`);
  });
}

test('every dataset tab key is a tab index.html renders', () => {
  const declared = new Set([...indexHtml.matchAll(/key:"(\w+)",\s*label:/g)].map(m => m[1]));
  for (const file of dataFiles) {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    for (const tab of Object.keys(d)) {
      assert.ok(declared.has(tab), `${file}: tab "${tab}" has no matching tab definition in index.html`);
    }
  }
});

test('CONFIG references every data file and vice versa', () => {
  const referenced = [...indexHtml.matchAll(/data:"(data[^"]*\.json)"/g)].map(m => m[1]);
  for (const f of referenced) assert.ok(dataFiles.includes(f), `CONFIG references missing file ${f}`);
  for (const f of dataFiles) assert.ok(referenced.includes(f), `${f} on disk but not in CONFIG`);
});

test('sw.js precaches every data file, valid cache version', () => {
  for (const f of dataFiles) assert.ok(swJs.includes(`"./${f}"`), `sw.js PRECACHE missing ${f}`);
  assert.match(swJs, /const CACHE = "wg-guide-v\d+"/);
});

test('BUILD constant format', () => {
  assert.match(indexHtml, /const BUILD = "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z"/);
});

test('CI runs on a schedule (freshness rots with time, not commits)', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.ok(ci.includes('schedule:'), 'ci.yml needs a schedule trigger');
  assert.ok(ci.includes('workflow_dispatch'), 'ci.yml needs manual dispatch');
});

test('CI runs the browser e2e suite on PRs', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.ok(/\be2e:/.test(ci), 'ci.yml needs an e2e job');
  assert.ok(ci.includes('playwright install'), 'e2e job must install a browser');
  assert.ok(ci.includes('tests/e2e'), 'e2e job must run the specs');
});
