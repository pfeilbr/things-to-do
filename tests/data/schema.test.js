// Schema + consistency tests for every city dataset. Protects manual edits
// and the recurring events-refresh automation from shipping broken data.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const ALLOWED = new Set(['n', 'c', 's', 'd', 't', 'u', 'r', 'rc', 'll', 'w', 'p', 'b']);
// Every city carries the two skating tabs (scripts/research/skating-iceskating.md).
const SKATE_TABS = ['skating', 'iceskating'];
const PHILLY_TABS = ['attractions', 'events', 'nightlife', 'eats', 'biking', 'social', 'fishing', 'chinese', 'remote', ...SKATE_TABS];
const CITY_TABS = ['spots', 'nightlife', 'eats', 'chinese', 'fishing', 'biking', 'remote', 'social', ...SKATE_TABS];
// The NYC-area guides carry the everyday-life tabs on top of the interest tabs (see
// NYC_TABS in index.html). Forest Hills is a walking-distance neighborhood guide, so it
// drops the two tabs that are inherently a drive away.
const DAILY_TABS = ['museums', 'sights', 'walks', 'shops', 'essentials'];
// the NYC-area guides and Boston also carry dated events
const NYC_EXTRA = [...DAILY_TABS, 'events'];
const LAYOUTS = {
  'data.json': PHILLY_TABS,
  'data-nyc.json': [...CITY_TABS, ...NYC_EXTRA],
  'data-brooklyn.json': [...CITY_TABS, ...NYC_EXTRA],
  'data-queens.json': [...CITY_TABS, ...NYC_EXTRA],
  'data-flushing.json': [...CITY_TABS, ...NYC_EXTRA],
  'data-boston.json': [...CITY_TABS, ...NYC_EXTRA],
  'data-foresthills.json': ['spots', 'nightlife', 'eats', 'chinese', 'social', 'remote', ...SKATE_TABS, ...NYC_EXTRA],
  // Ithaca is a campus guide: the everyday tabs plus a Coffee tab of its own.
  'data-ithaca.json': [...CITY_TABS, ...NYC_EXTRA, 'coffee'],
  // Stamford is a visitor guide with the first Skiing tab.
  'data-stamford.json': [...CITY_TABS, 'events', 'skiing'],
};

const dataFiles = fs.readdirSync(ROOT).filter(f => /^data.*\.json$/.test(f)).sort();
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');

for (const file of dataFiles) {
  test(`${file}: schema`, () => {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    const keys = Object.keys(d).sort();
    const layout = LAYOUTS[file] || [...CITY_TABS, 'events']; // every visitor guide carries dated Events
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
        // the Remote work tab's Cost column: every row says what it costs, and only there
        if (tab === 'remote') assert.ok(typeof r.p === 'string' && r.p.length, `${id}: p required in remote`);
        else assert.ok(!('p' in r), `${id}: p not allowed in ${tab}`);
        // ...and its Crowd column: how busy it gets (or "No crowd data yet"), short enough for a cell
        if (tab === 'remote') assert.ok(typeof r.b === 'string' && r.b.length && r.b.length <= 90, `${id}: b (crowd line, <=90 chars) required in remote`);
        else assert.ok(!('b' in r), `${id}: b not allowed in ${tab}`);
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

// A deploy once shipped a blank site: a careless BUILD bump also rewrote the regex
// literal that reads BUILD back, leaving an unmatched ')' that killed the whole
// <script> at parse time. Every test above still passed, because none of them ever
// parsed the page's JavaScript. This one does.
test('index.html inline script parses as JavaScript', () => {
  const scripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length, 'index.html has at least one inline script');
  for (const [i, body] of scripts.entries()) {
    assert.doesNotThrow(() => new Function(body), `inline <script> #${i + 1} must parse`);
  }
});

test('BUILD is declared exactly once', () => {
  const decls = indexHtml.match(/^const BUILD = "[^"]*";$/gm) || [];
  assert.equal(decls.length, 1, `one BUILD declaration (found ${decls.length})`);
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

// transit.js and sw.js are loaded by src, so the inline-script check above never sees them
test('standalone scripts parse as JavaScript', () => {
  for (const f of ['transit.js', 'sw.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotThrow(() => new Function(src), `${f} must parse`);
  }
});

// every CDN file the page lazy-loads is pinned by a Subresource Integrity hash
test('CDN scripts and styles carry SRI hashes', () => {
  const urls = [...new Set(indexHtml.match(/https:\/\/unpkg\.com\/[^"'\s]+\.(?:js|css)/g) || [])];
  assert.ok(urls.length, 'index.html lazy-loads from unpkg');
  const sri = indexHtml.match(/const SRI = \{([\s\S]*?)\};/);
  assert.ok(sri, 'index.html declares an SRI table');
  for (const u of urls) assert.match(sri[1], new RegExp(`"${u.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}": "sha384-[A-Za-z0-9+/=]{64}"`), `${u} has a sha384 hash`);
});

// The Pages deploy publishes the repo root minus tests/, scripts/, dotfiles and *.md
// (.github/workflows/pages.yml). Anything the page or its service worker asks for must
// exist and must not live under one of those, or the live site would 404 it.
test('every precached and manifest file exists and is published', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const pre = [...sw.match(/const PRECACHE = \[([\s\S]*?)\]/)[1].matchAll(/"\.\/([^"]*)"/g)].map(m => m[1]).filter(Boolean);
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  const refs = [...pre, ...man.icons.map(i => i.src), 'icon.svg', 'icons/apple-touch-icon.png', 'transit.js', 'sw.js'];
  for (const f of refs) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is referenced but missing`);
    assert.ok(!/^(tests|scripts)\/|(^|\/)\.|\.md$/.test(f), `${f} would be left out of the Pages deploy`);
  }
});

// The CSP <meta> allow-lists every host the page talks to. A new live feed or CDN that
// isn't listed would be blocked silently in the browser, so pin them here.
test('Content-Security-Policy covers the CDN, geocoder and every live train feed', () => {
  const csp = (indexHtml.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
  assert.ok(csp, 'index.html declares a CSP');
  const dir = name => (csp.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' ')) || '').split(/\s+/).slice(1);
  assert.ok(dir('object-src').includes("'none'"), 'object-src none');
  assert.ok(dir('script-src').includes('https://unpkg.com'), 'scripts may come from unpkg');
  const connect = dir('connect-src');
  assert.ok(connect.includes('https://nominatim.openstreetmap.org'), 'geocoder reachable');
  for (const f of fs.readdirSync(ROOT).filter(f => /^transit-.*\.json$/.test(f))) {
    const rt = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')).rt;
    if (rt) assert.ok(connect.includes(new URL(rt).origin), `${f}: connect-src must allow ${new URL(rt).origin}`);
  }
});
