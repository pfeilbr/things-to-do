// Pins the behavior of the pure core functions in index.html.
// 2026 calendar facts used below: Aug 14 = Friday, Aug 15 = Saturday,
// Aug 16 = Sunday, Sep 8 = Tuesday, Oct 17 = Saturday, Dec 19 = Saturday.
const test = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./extract');

test('extraction works', () => {
  const core = loadCore();
  for (const k of ['havMi', 'ride', 'daysIn', 'happensToday', 'slugify', 'pop'])
    assert.equal(typeof core[k], 'function', k);
});

test('ride(): road factor and speed curve', () => {
  const { ride } = loadCore();
  assert.deepEqual(ride(0), { d: 0, t: 1 });
  assert.deepEqual(ride(10), { d: 13, t: 26 });    // 13 mi at 29.85 mph
  assert.deepEqual(ride(100), { d: 130, t: 142 }); // capped at 55 mph
});

test('havMi(): haversine sanity', () => {
  const { havMi } = loadCore();
  assert.equal(havMi(40.7, -74.0, 40.7, -74.0), 0);
  const nycToLa = havMi(40.7128, -74.0060, 34.0522, -118.2437);
  assert.ok(Math.abs(nycToLa - 2445) < 10, `NYC->LA ~2445, got ${nycToLa}`);
});

test('pop(): rating x review count', () => {
  const { pop } = loadCore();
  assert.equal(pop({ r: 4.5, rc: 1000 }), 4500);
  assert.equal(pop({ r: null, rc: null }), 0);
  assert.equal(pop({}), 0);
});

test('slugify()', () => {
  const { slugify } = loadCore();
  assert.equal(slugify('Nom Wah Tea Parlor 南華茶室'), 'nom-wah-tea-parlor');
  assert.equal(slugify('!!!'), encodeURIComponent('!!!'));
});

const cases = [
  // [when-string, iso-now, expected]
  ['Saturdays · 9:30a–1p',            '2026-08-15T12:00:00', true],
  ['Saturdays · 9:30a–1p',            '2026-08-16T12:00:00', false],
  ['Sat 8/15 · 9p',                   '2026-08-15T12:00:00', true],
  ['Sat 8/15 · 9p',                   '2026-08-16T12:00:00', false],
  ['Fridays · 10p–2a',                '2026-08-15T12:00:00', false],
  ['Sat–Sun 8/15–16',                 '2026-08-15T12:00:00', true],
  ['Sat–Sun 8/15–16',                 '2026-08-16T12:00:00', true],
  ['Sat–Sun 8/15–16',                 '2026-08-17T12:00:00', false],
  ['Daily thru 9/7',                  '2026-08-15T12:00:00', true],
  ['Daily thru 9/7',                  '2026-09-08T12:00:00', false],
  ['Saturdays · 9:30a–1p (Apr–Nov)',  '2026-08-15T12:00:00', true],
  ['Saturdays · 9:30a–1p (Apr–Nov)',  '2026-12-19T12:00:00', false],
  ['Fri & Sat evenings (summer)',     '2026-08-15T12:00:00', true],
  ['Fri & Sat evenings (summer)',     '2026-10-17T12:00:00', false],
  ['2nd Fri · 5p–9p (May–Oct)',       '2026-08-14T12:00:00', true],
  ['2nd Fri · 5p–9p (May–Oct)',       '2026-08-15T12:00:00', false],
  ['TBA',                             '2026-08-15T12:00:00', false],
];
for (const [w, now, expected] of cases) {
  test(`happensToday("${w}") @ ${now.slice(0, 10)} -> ${expected}`, () => {
    const { happensToday } = loadCore({ now });
    assert.equal(happensToday(w), expected);
  });
}
