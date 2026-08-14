// Size budget (CONTRACTS §14). These are REGRESSION CEILINGS, not aspirations:
// every one of them passes comfortably today. If a budget starts failing, the fix
// is normally to trim the data (or split it), not to raise the number here.
// Observed sizes at the time of writing (Aug 2026):
//   index.html 69.0 KB · largest dataset data-nyc.json 27.8 KB
//   data.json 157.8 KB · all root JSON 669.8 KB · sw.js PRECACHE 27 entries
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const KB = 1024, MB = 1024 * 1024;

const size = f => fs.statSync(path.join(ROOT, f)).size;
const kb = bytes => (bytes / KB).toFixed(1);
const mb = bytes => (bytes / MB).toFixed(2);

const jsonFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.json')).sort();
const cityFiles = jsonFiles.filter(f => /^data-.*\.json$/.test(f));

test('index.html <= 120 KB', () => {
  const b = size('index.html');
  assert.ok(b <= 120 * KB, `index.html is ${kb(b)} KB, over the 120.0 KB budget`);
});

test('each data-<city>.json <= 120 KB', () => {
  assert.ok(cityFiles.length > 0, 'expected at least one data-<city>.json in the repo root');
  for (const f of cityFiles) {
    const b = size(f);
    assert.ok(b <= 120 * KB, `${f} is ${kb(b)} KB, over the 120.0 KB per-city budget`);
  }
});

test('data.json <= 400 KB', () => {
  const b = size('data.json');
  assert.ok(b <= 400 * KB, `data.json is ${kb(b)} KB, over the 400.0 KB budget`);
});

test('total repo-root JSON payload <= 2.5 MB', () => {
  const total = jsonFiles.reduce((sum, f) => sum + size(f), 0);
  const biggest = jsonFiles
    .map(f => [f, size(f)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([f, b]) => `${f} ${kb(b)} KB`)
    .join(', ');
  assert.ok(total <= 2.5 * MB,
    `repo-root JSON totals ${mb(total)} MB across ${jsonFiles.length} files, over the 2.50 MB budget (largest: ${biggest})`);
});

test('sw.js PRECACHE lists <= 40 entries', () => {
  const swPath = path.join(ROOT, 'sw.js');
  const sw = fs.readFileSync(swPath, 'utf8');
  const m = sw.match(/const PRECACHE = \[([\s\S]*?)\]/);
  assert.ok(m, 'sw.js: could not find the PRECACHE array');
  const entries = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
  assert.ok(entries.length <= 40,
    `sw.js PRECACHE has ${entries.length} entries, over the 40-entry budget (last: ${entries.at(-1)})`);
});
