// The baked timetables (transit-<city>.json, written by scripts/transit.py). The page trusts
// their shape blindly, so pin it here: stops, a contiguous run of service days that still
// covers today, and train rows whose times make sense. A timetable that has run out fails
// CI — the weekly workflow (.github/workflows/transit.yml) is meant to keep that from happening.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const named = [...indexHtml.matchAll(/transit:"(transit-[^"]+\.json)"/g)].map(m => m[1]).sort();
const onDisk = fs.readdirSync(ROOT).filter(f => /^transit-.*\.json$/.test(f)).sort();
const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');

test('every timetable is named by CONFIG, precached, and vice versa', () => {
  assert.deepEqual(named, onDisk);
  for (const f of onDisk) assert.ok(swJs.includes(`"./${f}"`), `sw.js PRECACHE missing ${f}`);
});

for (const f of onDisk) {
  test(`${f}: shape`, () => {
    const T = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    assert.match(T.rt, /^https:\/\//, 'live feed URL');
    assert.ok(T.home.length >= 1);
    const keys = T.stops.map(s => s.k);
    for (const h of T.home) assert.ok(keys.includes(h), `home station ${h} in stops`);
    for (const s of T.stops) {
      assert.ok(s.n && s.id, `stop ${s.k}`);
      assert.ok(Array.isArray(s.ll) && s.ll.length === 2, `stop ${s.k} has station coordinates`);
    }
    for (const s of T.stops.filter(s => T.home.includes(s.k))) assert.ok(s.mi > 1 && s.mi < 200, `${s.k} track miles`);

    // days: contiguous YYYYMMDD, one after another
    for (let i = 1; i < T.days.length; i++) {
      const a = new Date(T.days[i - 1].replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3T12:00:00Z'));
      a.setUTCDate(a.getUTCDate() + 1);
      assert.equal(ymd(a), T.days[i], `days contiguous at ${T.days[i]}`);
    }
    const hub = T.stops.length - 1;
    for (const t of T.trains) {
      const [num, dir, peak, mask, times] = t;
      assert.ok(typeof num === 'string' && num, 'train number');
      assert.ok(dir === 0 || dir === 1, `${num} dir`);
      assert.ok(peak === 0 || peak === 1, `${num} peak`);
      assert.ok(Number.isInteger(mask) && mask > 0 && mask < 2 ** T.days.length, `${num} mask`);
      assert.equal(times.length, T.stops.length, `${num} times per stop`);
      assert.ok(times[hub] != null, `${num} reaches the hub`);
      assert.ok(times.slice(0, T.home.length).some(x => x != null), `${num} stops at home`);
      for (const x of times) if (x != null) assert.ok(Number.isInteger(x) && x >= 0 && x < 30 * 60, `${num} time ${x}`);
      const homeT = times.slice(0, T.home.length).filter(x => x != null);
      if (dir === 1) assert.ok(homeT.every(x => x < times[hub]), `${num} reaches the hub after leaving home`);
      else assert.ok(homeT.every(x => x > times[hub]), `${num} reaches home after leaving the hub`);
    }
    // every day in the window has trains each way
    T.days.forEach((d, i) => {
      for (const dir of [0, 1])
        assert.ok(T.trains.some(t => t[1] === dir && Math.floor(t[3] / 2 ** i) % 2), `${d}: no trains in dir ${dir}`);
    });
  });

  test(`${f}: still covers today`, () => {
    const T = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const today = ymd(new Date());
    assert.ok(T.days[T.days.length - 1] >= today,
      `${f} ran out on ${T.days[T.days.length - 1]} — run python3 scripts/transit.py build`);
  });
}
