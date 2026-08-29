// Editorial-consistency guards over the whole 22-city corpus.
// These catch drift that the per-file schema tests can't see: category
// spellings that diverge between cities, and rows accidentally duplicated
// across tabs of one city.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const files = fs.readdirSync(ROOT).filter(f => /^data.*\.json$/.test(f)).sort();
const load = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

// Same concept, different spelling: case, punctuation, "&"/"+", plural head
// nouns and appended Chinese glosses all collapse to one fingerprint.
function fingerprint(c) {
  let s = c.toLowerCase().trim()
    .replace(/&/g, ' and ').replace(/\+/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim()
    .replace(/\b(bar|club|spot|trail|park|market|shop|room|garden|lounge|hall)s\b/g, '$1')
    .replace(/\bhip hop\b/g, 'hiphop');
  return s.replace(/\s+/g, '');
}

test('one spelling per category concept across all cities', () => {
  const byPrint = new Map();
  for (const f of files) {
    const d = load(f);
    for (const [tab, rows] of Object.entries(d)) {
      for (const r of rows) {
        const p = fingerprint(r.c);
        if (!byPrint.has(p)) byPrint.set(p, new Map());
        const m = byPrint.get(p);
        m.set(r.c, (m.get(r.c) || 0) + 1);
      }
    }
  }
  const clashes = [...byPrint.values()].filter(m => m.size > 1)
    .map(m => [...m.entries()].map(([c, n]) => `"${c}"×${n}`).join(' vs '));
  assert.equal(clashes.length, 0,
    `categories that mean the same thing but are spelled differently:\n  ${clashes.join('\n  ')}`);
});

// A venue may legitimately appear in two tabs of one city when it serves two
// different interests (a park that is also a trail system). Those pairings are
// pinned here so NEW accidental duplication fails the build.
const INTENTIONAL_CROSS_TAB = new Set([
  'data.json|Keswick Theatre|attractions,nightlife',        // venue + live-music room
  'data.json|Glenside Farmers Market|attractions,events',   // place + recurring event
  'data.json|Lorimer Park|attractions,biking',              // parks that are also trail systems
  'data.json|Wissahickon Valley Park|attractions,biking',
  'data.json|Tyler State Park|attractions,biking',
  'data.json|Evansburg State Park|attractions,biking',
  'data.json|Marsh Creek State Park|attractions,biking',
  'data.json|French Creek State Park|attractions,biking',
  'data.json|Philadelphia Chinese Lantern Festival|events,chinese', // event + 中华 culture
  'data.json|Lake Nockamixon|biking,fishing',               // trails + fishing lake
  // NYC-area: routes that are genuinely both a walk and a ride, listed in each tab
  // because the reason you'd pick them differs (pace, surface, where you start).
  'data-nyc.json|Hudson River Greenway|walks,biking',
  'data-nyc.json|Central Park Loop|walks,biking',
  'data-brooklyn.json|Prospect Park Loop|walks,biking',
  'data-brooklyn.json|Shirley Chisholm State Park|walks,biking',
  'data-queens.json|Rockaway Boardwalk|walks,biking',
  'data-flushing.json|Kissena Velodrome|sights,biking',   // landmark + the track itself
]);

test('no unvetted duplicate rows across tabs of one city', () => {
  const surprises = [];
  for (const f of files) {
    const d = load(f);
    const where = new Map();
    for (const [tab, rows] of Object.entries(d))
      for (const r of rows) where.set(r.n, [...(where.get(r.n) || []), tab]);
    for (const [name, tabs] of where) {
      if (tabs.length < 2) continue;
      const key = `${f}|${name}|${tabs.join(',')}`;
      if (!INTENTIONAL_CROSS_TAB.has(key)) surprises.push(key);
    }
  }
  assert.equal(surprises.length, 0,
    `rows duplicated across tabs — merge them, or add to INTENTIONAL_CROSS_TAB if the double listing is deliberate:\n  ${surprises.join('\n  ')}`);
});
