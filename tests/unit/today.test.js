// Unit tests for the pure helpers behind the Today view (today.js): the `w` time-of-day
// parser that decides what is "still on", the city clock, and the offline sunrise math.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'today.js'), 'utf8');
const grab = re => { const m = src.match(re); if (!m) throw new Error('extraction failed: ' + re); return m[0]; };
const ctx = vm.createContext({ Intl, Date, Math });
const T = vm.runInContext([
  grab(/const CITY_TZ = \{[\s\S]*?\};/),
  grab(/const cityTZ = [^\n]*/),
  grab(/function cityClock[\s\S]*?\n\}/),
  grab(/function wTimes[\s\S]*?\n\}/),
  grab(/function sunTimes[\s\S]*?\n\}/),
].join('\n') + '\n;({ cityTZ, cityClock, wTimes, sunTimes });', ctx);

const h = (H, M = 0) => H * 60 + M;

test('wTimes: single start times', () => {
  assert.deepEqual({ ...T.wTimes('Tuesdays · 6:15p') }, { s: h(18, 15), e: null });
  assert.deepEqual({ ...T.wTimes('Wednesdays · 7:30p') }, { s: h(19, 30), e: null });
  assert.deepEqual({ ...T.wTimes('Sat 11/14 · 9:25a') }, { s: h(9, 25), e: null });
  assert.deepEqual({ ...T.wTimes('Sun 12/6 · noon') }, { s: h(12), e: null });
});

test('wTimes: ranges, borrowed a/p and past-midnight ends', () => {
  assert.deepEqual({ ...T.wTimes('Sat 11/21 · 3p–6p') }, { s: h(15), e: h(18) });
  assert.deepEqual({ ...T.wTimes('Saturdays · 9:30a–1p (Jun–Oct)') }, { s: h(9, 30), e: h(13) });
  assert.deepEqual({ ...T.wTimes('Thu 11/12 · 7–9p') }, { s: h(19), e: h(21) });
  assert.deepEqual({ ...T.wTimes('Sundays · 11–2p') }, { s: h(11), e: h(14) });
  assert.deepEqual({ ...T.wTimes('Fridays · 10p–2a') }, { s: h(22), e: h(26) });
  assert.deepEqual({ ...T.wTimes('Fri 11/13 · 8p–1a') }, { s: h(20), e: h(25) });
});

test('wTimes: dates alone are never read as times', () => {
  assert.equal(T.wTimes('Sat–Sun 11/14–15'), null);
  assert.equal(T.wTimes('Wed–Sun 7/29–8/2'), null);
  assert.equal(T.wTimes('Daily thru 1/4'), null);
  assert.equal(T.wTimes('Fridays (weekly)'), null);
  assert.equal(T.wTimes(''), null);
  assert.equal(T.wTimes(undefined), null);
});

test('cityClock reads the wall clock in the city, not the visitor', () => {
  const ms = Date.UTC(2026, 10, 13, 2, 30);   // 9:30p Thu in New York, 6:30p in LA
  const ny = T.cityClock(ms, T.cityTZ('nyc')), la = T.cityClock(ms, T.cityTZ('la'));
  assert.equal(ny.min, h(21, 30)); assert.equal(ny.wd, 'Thursday'); assert.equal(ny.d, 12);
  assert.equal(la.min, h(18, 30)); assert.equal(la.wd, 'Thursday');
  assert.equal(T.cityTZ('toronto'), 'America/Toronto');
  assert.equal(T.cityTZ('stamford'), 'America/New_York');
});

test('sunTimes lands within a few minutes of the almanac', () => {
  const fmt = (ms, tz) => { const c = T.cityClock(ms, tz); return c.min; };
  // New York, Nov 12: sunrise ~6:39a, sunset ~4:39p EST
  const ny = T.sunTimes(40.73, -73.99, 2026, 11, 12);
  assert.ok(Math.abs(fmt(ny.rise, 'America/New_York') - h(6, 39)) <= 4, 'NY sunrise');
  assert.ok(Math.abs(fmt(ny.set, 'America/New_York') - h(16, 39)) <= 4, 'NY sunset');
  // Seattle, Jun 21: sunrise ~5:11a, sunset ~9:11p PDT
  const sea = T.sunTimes(47.61, -122.33, 2026, 6, 21);
  assert.ok(Math.abs(fmt(sea.rise, 'America/Los_Angeles') - h(5, 11)) <= 5, 'Seattle sunrise');
  assert.ok(Math.abs(fmt(sea.set, 'America/Los_Angeles') - h(21, 11)) <= 5, 'Seattle sunset');
});
