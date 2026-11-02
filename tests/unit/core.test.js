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
  // holiday runs that wrap past New Year
  ['Sat 11/21 – Mon 1/4',             '2026-12-25T12:00:00', true],
  ['Sat 11/21 – Mon 1/4',             '2027-01-02T12:00:00', true],
  ['Sat 11/21 – Mon 1/4',             '2026-11-20T12:00:00', false],
  ['Sat 11/21 – Mon 1/4',             '2027-01-05T12:00:00', false],
];
for (const [w, now, expected] of cases) {
  test(`happensToday("${w}") @ ${now.slice(0, 10)} -> ${expected}`, () => {
    const { happensToday } = loadCore({ now });
    assert.equal(happensToday(w), expected);
  });
}

// wSpan(): the guide's "Happening soon" rail reads first/last dates out of `w` strings.
// Years are resolved around `now`, and every earlier date is the latest one not after the
// date that follows it, so New-Year runs and long exhibitions land in the right season.
const spanCases = [
  ['Sat 11/7 · 8p',            '2026-11-02', '2026-11-07', '2026-11-07'],
  ['Fri–Sun 11/27–29',         '2026-11-02', '2026-11-27', '2026-11-29'],
  ['Sat 11/21 – Mon 1/4',      '2026-11-02', '2026-11-21', '2027-01-04'],
  ['Sat 7/25 – Sun 3/28',      '2026-11-02', '2026-07-25', '2027-03-28'],
  ['Sat 12/12 – Sun 12/20',    '2026-12-15', '2026-12-12', '2026-12-20'],
  ['Sat 11/7 · 8p',            '2027-01-10', '2026-11-07', '2026-11-07'],   // last season's, i.e. past
  ['Thu 1/14 · 7p',            '2026-11-02', '2027-01-14', '2027-01-14'],
];
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
for (const [w, now, start, end] of spanCases) {
  test(`wSpan("${w}") @ ${now} -> ${start}..${end}`, () => {
    const { wSpan } = loadCore();
    const sp = wSpan(w, new Date(now + 'T12:00:00'));
    assert.deepEqual([iso(sp.start), iso(sp.end)], [start, end]);
  });
}
test('wSpan(): recurring strings have no span', () => {
  const { wSpan } = loadCore();
  assert.equal(wSpan('Saturdays · 9a–1p', new Date()), null);
});
