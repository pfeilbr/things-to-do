// Distance integrity — WITHOUT knowing any origin.
//
// Every row's `d` is 1.3 x the straight-line miles from its city's origin, so
// for any two rows in the same city the triangle inequality must hold:
//     |d_i - d_j|  <=  1.3 * haversine(p_i, p_j)
// A row whose `d` drifted from its coordinates breaks this against its
// neighbours. The check needs no origin, so nothing sensitive lives here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const files = fs.readdirSync(ROOT).filter(f => /^data.*\.json$/.test(f)).sort();
const SLACK = 0.35; // `d` is rounded to 0.1, so pairs carry ±0.2 of rounding slop

function haversineMi(a, b) {
  const rad = x => x * Math.PI / 180;
  const s = Math.sin(rad(b[0] - a[0]) / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(s));
}

for (const file of files) {
  test(`${file}: distances agree with coordinates`, () => {
    const rows = Object.entries(JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')))
      .flatMap(([tab, rs]) => rs.filter(r => r.ll).map(r => ({ ...r, tab })));
    const blame = new Map();
    let pairs = 0;
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const gap = Math.abs(rows[i].d - rows[j].d);
        const reach = 1.3 * haversineMi(rows[i].ll, rows[j].ll);
        if (gap - reach > SLACK) {
          pairs++;
          for (const r of [rows[i], rows[j]]) blame.set(r.n, (blame.get(r.n) || 0) + 1);
        }
      }
    }
    const worst = [...blame.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([n, c]) => `${n} (${c} pairs)`);
    assert.equal(pairs, 0,
      `${pairs} row pairs violate the triangle inequality — a row's d no longer matches its ll.\n` +
      `  most implicated: ${worst.join(', ')}\n` +
      `  fix: recompute d/t from ll with the documented formula (see CLAUDE.md).`);
  });

  test(`${file}: drive times follow from distances`, () => {
    const bad = [];
    for (const [tab, rs] of Object.entries(JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')))) {
      for (const r of rs) {
        const want = Math.max(1, Math.round(r.d / Math.min(55, 24 + 0.45 * r.d) * 60));
        if (Math.abs(want - r.t) > 1) bad.push(`${tab}/${r.n}: d=${r.d} → t should be ~${want}, is ${r.t}`);
      }
    }
    assert.equal(bad.length, 0, `drive times off the documented speed curve:\n  ${bad.slice(0, 10).join('\n  ')}`);
  });
}
