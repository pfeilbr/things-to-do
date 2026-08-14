// Data-quality audit (CONTRACTS §17). Deterministic editorial guards over every
// dataset — these catch the failure modes of bulk/agent-generated rows that a
// pure schema check (schema.test.js) happily accepts: copy-pasted summaries,
// half-filled ratings, stub or runaway blurbs, category fields that just echo
// the venue name, and datasets shipped without sources.
//
// Every assertion names file/tab/row-index/row-name so an offender can be found
// and fixed without re-deriving the query. Failures here mean the DATA is wrong;
// fix the rows, don't loosen the rule. The one calibrated number is U_FLOOR
// (see its comment) — the contract explicitly pins it to today's worst file.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const files = fs.readdirSync(ROOT).filter(f => /^data.*\.json$/.test(f)).sort();

// Flatten every dataset once. `id` is the human-readable coordinate used in all
// assertion messages. Shape validation belongs to schema.test.js; this file
// skips anything non-array rather than duplicating that failure.
const rows = [];
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  for (const [tab, list] of Object.entries(data)) {
    if (!Array.isArray(list)) continue;
    list.forEach((r, i) => rows.push({ file, tab, i, r, id: `${file} / ${tab}[${i}] "${r.n}"` }));
  }
}

// Without this the whole suite would pass vacuously if the glob ever broke.
test('datasets load and contain rows', () => {
  assert.ok(files.length >= 20, `expected the full city registry on disk, found ${files.length} data files`);
  assert.ok(rows.length > 2000, `expected >2000 rows across all datasets, found ${rows.length}`);
});

// --- 1. No duplicate summaries -----------------------------------------------
// Identical `s` text in two rows is almost always a copy-paste artifact from
// whichever agent generated that batch of cities (or a row duplicated within a
// tab under two names). Comparison is exact, per §17.
//
// ALLOWLIST: empty, and it should stay that way. Today's repo has ZERO exact
// duplicates across all 2594 rows — and zero even under case/punctuation/
// whitespace normalization — so no boilerplate exemption is justified. If a
// genuine chain (two locations of one venue) ever needs the same blurb, prefer
// differentiating the text by neighborhood; only add here as a last resort.
const DUP_SUMMARY_ALLOW = new Set([]);

test('no two rows share an identical summary', () => {
  const bySummary = new Map();
  for (const e of rows) {
    if (!bySummary.has(e.r.s)) bySummary.set(e.r.s, []);
    bySummary.get(e.r.s).push(e);
  }
  const offenders = [];
  for (const [s, list] of bySummary) {
    if (list.length < 2 || DUP_SUMMARY_ALLOW.has(s)) continue;
    offenders.push(`  [${list.length}x] "${s}"\n${list.map(e => `      ${e.id}`).join('\n')}`);
  }
  assert.equal(offenders.length, 0,
    `${offenders.length} summary text(s) reused across rows — rewrite the duplicates:\n${offenders.join('\n')}`);
});

// --- 2. Ratings are all-or-nothing -------------------------------------------
// pop() ranks by r × rc, so a row with a rating but no review count sorts as if
// it had zero popularity — worse than being unrated. Either fill in rc from the
// same Google listing the rating came from, or null the rating too.
test('r and rc are both present or both null', () => {
  const offenders = rows
    .filter(e => (e.r.r != null) !== (e.r.rc != null))
    .map(e => `  ${e.id}: r=${JSON.stringify(e.r.r)} rc=${JSON.stringify(e.r.rc)}`);
  assert.equal(offenders.length, 0,
    `${offenders.length} half-rated row(s) — set both r and rc, or neither:\n${offenders.join('\n')}`);
});

// --- 3. Summary length band ---------------------------------------------------
// Under 25 chars is a stub that tells the reader nothing; over 400 breaks the
// card layout on mobile. Today's data spans 33–207 chars, comfortably inside.
const S_MIN = 25, S_MAX = 400;

test(`summaries are ${S_MIN}-${S_MAX} characters`, () => {
  const short = rows.filter(e => e.r.s.length < S_MIN)
    .map(e => `  ${e.id}: ${e.r.s.length} chars — "${e.r.s}"`);
  const long = rows.filter(e => e.r.s.length > S_MAX)
    .map(e => `  ${e.id}: ${e.r.s.length} chars — "${e.r.s.slice(0, 80)}…"`);
  assert.equal(short.length, 0,
    `${short.length} summary/summaries under ${S_MIN} chars — write a real one-liner:\n${short.join('\n')}`);
  assert.equal(long.length, 0,
    `${long.length} summary/summaries over ${S_MAX} chars — trim to a one-liner:\n${long.join('\n')}`);
});

// --- 4. Category must not echo the name ---------------------------------------
// `c` is a browse/filter facet, so restating the venue name there ("Reading
// Terminal Market" / "Reading Terminal Market") wastes the column and makes the
// category filter useless.
//
// ALLOWLIST (1 entry, justified): SF's Michelin-starred counter is literally
// named "Omakase", and it sits in a run of five rows (Kusakabe, Ju-Ni, Omakase,
// Akikos, Robin) that all correctly carry c="Omakase". The category is right and
// shared with its neighbors; the collision is coincidence, not a lazy fill. The
// entry is keyed on file+tab+name so it cannot silently cover any future row.
const NAME_IN_CAT_ALLOW = new Set([
  'data-sf.json/eats/Omakase',
]);

test('a row name never appears verbatim inside its own category', () => {
  const offenders = rows
    .filter(e => e.r.c.includes(e.r.n) && !NAME_IN_CAT_ALLOW.has(`${e.file}/${e.tab}/${e.r.n}`))
    .map(e => `  ${e.id}: c="${e.r.c}" repeats the name`);
  assert.equal(offenders.length, 0,
    `${offenders.length} row(s) whose category echoes the name — use a real category:\n${offenders.join('\n')}`);
});

// --- 5. Source-URL coverage ---------------------------------------------------
// §17 nominates 70%, but that is aspirational against the CURRENT repo: the
// worst file measures 57.30% (data-cleveland.json, 51/89 — its eats tab has just
// 1 of 14 rows sourced; data-vb.json 59.26% and data-toronto.json 61.96% are the
// next worst). Per the contract, the floor is calibrated just below today's
// worst value so this acts as a RATCHET against further rot instead of failing
// on day one. Raise it as sources get filled in; never lower it.
const U_FLOOR = 0.57;

test(`every dataset has >= ${(U_FLOOR * 100).toFixed(0)}% of rows sourced (non-null u)`, () => {
  const coverage = files.map(file => {
    const list = rows.filter(e => e.file === file);
    const withU = list.filter(e => e.r.u != null).length;
    return { file, withU, total: list.length, pct: list.length ? withU / list.length : 1 };
  }).sort((a, b) => a.pct - b.pct);

  // Printed regardless of pass/fail so the real numbers stay visible.
  console.log('u-coverage by file (worst first):');
  for (const c of coverage) {
    console.log(`  ${(c.pct * 100).toFixed(1).padStart(5)}%  ${String(c.withU).padStart(3)}/${String(c.total).padEnd(3)}  ${c.file}`);
  }

  const offenders = coverage
    .filter(c => c.pct < U_FLOOR)
    .map(c => `  ${c.file}: ${(c.pct * 100).toFixed(1)}% sourced (${c.withU}/${c.total} rows have a u)`);
  assert.equal(offenders.length, 0,
    `${offenders.length} dataset(s) below the ${(U_FLOOR * 100).toFixed(0)}% source-URL floor:\n${offenders.join('\n')}`);
});
