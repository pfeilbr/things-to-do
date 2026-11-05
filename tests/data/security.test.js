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
