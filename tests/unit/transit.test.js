// The train board's core: New York wall-clock math (the viewer may be in any time zone),
// reading a day's runs out of the baked timetable's day bitmasks, and decoding the
// GTFS-realtime protobuf by hand.
const test = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./extract');
const { buildFeed } = require('../fixtures/gtfsrt');

test('nyClock reads New York wall time from any instant, across DST', () => {
  const { nyClock } = loadCore();
  assert.deepEqual(nyClock(Date.UTC(2026, 10, 2, 13, 5)), { ymd: '20261102', min: 8 * 60 + 5, dow: 1 });   // EST
  assert.deepEqual(nyClock(Date.UTC(2026, 6, 4, 3, 30)), { ymd: '20260703', min: 23 * 60 + 30, dow: 5 });  // EDT, still the 3rd
});

test('nyMs is the inverse of nyClock, including after-midnight service times', () => {
  const { nyMs, nyClock } = loadCore();
  assert.equal(nyMs('20261102', 8 * 60 + 5), Date.UTC(2026, 10, 2, 13, 5));
  assert.equal(nyMs('20260704', 12 * 60), Date.UTC(2026, 6, 4, 16, 0));
  // 25:10 on the 2nd is 1:10a on the 3rd
  assert.deepEqual(nyClock(nyMs('20261102', 25 * 60 + 10)), { ymd: '20261103', min: 70, dow: 2 });
});

test('fmtClock', () => {
  const { fmtClock } = loadCore();
  assert.equal(fmtClock(0), '12:00a');
  assert.equal(fmtClock(9 * 60 + 5), '9:05a');
  assert.equal(fmtClock(12 * 60), '12:00p');
  assert.equal(fmtClock(25 * 60 + 10), '1:10a');
});

const T = {
  home: ['A', 'B'],
  stops: [{ k: 'A', id: '10' }, { k: 'B', id: '11' }, { k: 'H', id: '1' }],
  days: ['20261102', '20261103'],
  trains: [
    ['100', 1, 1, 0b01, [420, 425, 480]],      // day 0 only, peak, both stations
    ['102', 1, 0, 0b11, [600, null, 655]],     // both days, skips B
    ['101', 0, 0, 0b10, [800, 795, 740]],      // day 1 only, outbound
  ],
};

test('trainRuns honours direction, the day bitmask and skipped stops', () => {
  const { trainRuns } = loadCore();
  assert.deepEqual(trainRuns(T, 0, 0, 1).map(r => r.num), ['100', '102']);
  assert.deepEqual(trainRuns(T, 0, 1, 1).map(r => r.num), ['100']);
  assert.deepEqual(trainRuns(T, 1, 0, 1).map(r => r.num), ['102']);
  const out = trainRuns(T, 1, 0, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0].dep, 740);      // outbound leaves the hub
  assert.equal(out[0].arr, 800);
  assert.equal(out[0].ride, 60);
  assert.equal(trainRuns(T, 0, 0, 1)[0].peak, true);
  assert.deepEqual(trainRuns(T, 5, 0, 1), []);
});

test('mnrLive decodes train number, date, stops, track, status and cancellations', () => {
  const { mnrLive } = loadCore();
  const feed = buildFeed({ ts: 1793622771, trains: [
    { num: '1433', date: '20261102', stops: [{ id: '127', t: 1793624520, track: '3', status: 'On-Time' }, { id: '1', t: 1793628120 }] },
    { num: '1437', date: '20261102', cancelled: true, stops: [{ id: '127', t: 1793626740, status: 'Cancelled' }] },
  ] });
  const L = mnrLive(new Uint8Array(feed));
  assert.equal(L.ts, 1793622771);
  assert.equal(L.trains['1433'].date, '20261102');
  assert.equal(L.trains['1433'].stops['127'].t, 1793624520);
  assert.equal(L.trains['1433'].stops['127'].track, '3');
  assert.equal(L.trains['1433'].stops['127'].status, 'On-Time');
  assert.equal(L.trains['1433'].stops['1'].t, 1793628120);
  assert.equal(L.trains['1433'].cancelled, false);
  assert.equal(L.trains['1437'].cancelled, true);
});
