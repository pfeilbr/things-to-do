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
