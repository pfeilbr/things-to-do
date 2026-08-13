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

const dataFiles = fs.readdirSync(ROOT).filter(f => /^data.*\.json$/.test(f)).sort();
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

for (const file of dataFiles) {
  test(`${file}: schema`, () => {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const keys = Object.keys(d).sort();
    const layout = file === 'data.json' ? PHILLY_TABS : CITY_TABS;
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
    const minCoverage = file === 'data.json' ? 0.95 : 1.0; // legacy Philly rows predate the ll mandate
    assert.ok(coverage >= minCoverage, `${file}: ll coverage ${(coverage * 100).toFixed(1)}% < ${minCoverage * 100}%`);
  });
}

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
