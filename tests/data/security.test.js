// Security guardrails for the page shell. These pin protections that are already in place,
// so a later edit can't quietly drop one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('every target="_blank" link carries rel="noopener" (no window.opener handoff)', () => {
  for (const f of ['index.html', 'transit.js']) {
    const bad = [...read(f).matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)]
      .map(m => m[0]).filter(tag => !/\brel="[^"]*\bnoopener\b/.test(tag));
    assert.deepEqual(bad, [], `${f}: _blank links without rel="noopener"`);
  }
});

test('Content-Security-Policy keeps its hardening directives', () => {
  const m = read('index.html').match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(m, 'CSP meta tag present');
  const dir = Object.fromEntries(m[1].split(';').map(s => s.trim()).filter(Boolean)
    .map(s => { const [k, ...v] = s.split(/\s+/); return [k, v]; }));
  assert.deepEqual(dir['object-src'], ["'none'"], 'no plugins');
  assert.deepEqual(dir['base-uri'], ["'self'"], 'no <base> hijack');
  assert.deepEqual(dir['form-action'], ["'self'"], 'forms post nowhere else');
  assert.ok(dir['default-src'] && dir['default-src'].includes("'self'"), 'default-src self');
  for (const [k, v] of Object.entries(dir)) {
    assert.ok(!v.includes("'unsafe-eval'"), `${k}: no unsafe-eval`);
    assert.ok(!v.includes('*') && !v.some(x => /^(https?:|data:)$/.test(x) && k.startsWith('script')),
      `${k}: no wildcard or scheme-wide script source`);
  }
});

test('referrer policy never leaks paths or #hash state to other sites', () => {
  const m = read('index.html').match(/<meta name="referrer" content="([^"]+)">/);
  assert.ok(m, 'referrer meta present');
  assert.ok(['strict-origin-when-cross-origin', 'strict-origin', 'same-origin', 'no-referrer'].includes(m[1]), m[1]);
});

// Dataset strings are interpolated into innerHTML (and names into attributes such as
// title="Map of …"), so a stray tag, handler or quote in a data file would become markup.
test('dataset strings cannot inject markup', () => {
  const files = fs.readdirSync(ROOT).filter(f => /^(data.*|guide-.*)\.json$/.test(f));
  const bad = [];
  for (const f of files) {
    const walk = (v, where, key) => {
      if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`, key));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`, k);
      else if (typeof v === 'string') {
        if (/[<>]/.test(v) || /javascript:/i.test(v) || /\bon[a-z]+\s*=/i.test(v)) bad.push(`${f}${where}: ${v.slice(0, 80)}`);
        if (key === 'n' && v.includes('"')) bad.push(`${f}${where}: name contains a double quote`);
      }
    };
    walk(JSON.parse(read(f)), '', '');
  }
  assert.deepEqual(bad, []);
});

// Offline integrity: one cache.addAll() failure aborts the whole service-worker install,
// so the list must be clean — no duplicates, nothing cross-origin, nothing absolute.
test('sw.js PRECACHE is unique, relative and same-origin', () => {
  const sw = read('sw.js');
  const list = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);
  assert.equal(new Set(list).size, list.length, 'duplicate PRECACHE entries');
  for (const u of list) assert.match(u, /^\.\/[^:]*$/, `${u}: must be a ./relative path`);
  assert.match(sw, /const CACHE = "[\w.-]+";/, 'CACHE name declared');
});
