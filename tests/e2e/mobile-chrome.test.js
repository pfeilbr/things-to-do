// TDD spec for the mobile chrome budget (CONTRACTS §16).
//
// This session stacked several strips into the header (region bar, city bar,
// trip note, xfind, globalFavs, suggestion bar). On a 390x844 phone the FIRST
// result must still be reachable without excessive scrolling.
//
// Budget (fixed by the contract — do NOT loosen it; trim the chrome instead):
//   * no query typed : first `#cards .card` top <= 620 px (document coords)
//   * query typed    : first `#cards .card` top <= 760 px (xfind strip visible)
//   * neither state may scroll the page horizontally
//
// This is a MEASUREMENT spec: the numbers are printed regardless of pass/fail,
// together with a per-element height breakdown of the header chrome so whoever
// has to trim it knows exactly which strip to attack.
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8957, URL = `http://localhost:${PORT}/`;
const VW = 390, VH = 844;
const BUDGET_PLAIN = 620, BUDGET_QUERY = 760;
// A query with hits in the booted tab (attractions) AND in other philly tabs, so
// rows keep rendering while #xfind is on screen — the worst-case chrome stack.
const QUERY = 'park';

// Elements the contract calls out, plus the rest of the header stack for context.
// (contract-named ones first so they're easy to spot in the output)
const CHROME = [
  '#regionbar', '#citybar', '#tripNote', '.controls', '#xfind', '#globalFavs',
  'header', 'h1', '.sub', '#tabs', '#citySuggest', '.meta-line',
];

// Document-space top of the first mobile card (rect.top + scrollY), plus the
// measured height/visibility of every chrome element.
const measure = page => page.evaluate(sels => {
  const card = document.querySelector('#cards .card');
  const r = card && card.getBoundingClientRect();
  const parts = sels.map(sel => {
    const el = document.querySelector(sel);
    if (!el) return { sel, present: false, visible: false, h: 0 };
    const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const visible = !el.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && b.height > 0;
    // include the margin box: a strip's vertical margins push the table down too
    const mt = parseFloat(cs.marginTop) || 0, mb = parseFloat(cs.marginBottom) || 0;
    return { sel, present: true, visible, h: visible ? b.height + mt + mb : 0 };
  });
  return {
    cardTop: r ? Math.round((r.top + window.scrollY) * 10) / 10 : null,
    cards: document.querySelectorAll('#cards .card').length,
    rows: document.querySelectorAll('#tbody tr.rowmain').length,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    scrollY: window.scrollY,
    xfindShown: (() => {
      const el = document.getElementById('xfind');
      if (!el) return false;
      const cs = getComputedStyle(el);
      return !el.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
    })(),
    parts,
  };
}, CHROME).catch(e => { console.error('  measure() failed:', e.message.split('\n')[0]); return null; });

function report(label, m, budget) {
  console.log(`\n  ---- MEASURED: ${label} (${VW}x${VH}) ----`);
  console.log(`  first #cards .card top : ${m.cardTop === null ? 'NO CARD RENDERED' : m.cardTop + ' px'}   (budget ${budget} px)`);
  if (m.cardTop !== null) {
    const delta = Math.round((m.cardTop - budget) * 10) / 10;
    console.log(`  vs budget              : ${delta <= 0 ? `${Math.abs(delta)} px UNDER budget` : `${delta} px OVER budget`}`);
  }
  console.log(`  cards rendered         : ${m.cards} (desktop rows: ${m.rows})`);
  console.log(`  page width             : scrollWidth ${m.scrollWidth} vs innerWidth ${m.innerWidth}`);
  console.log(`  #xfind visible         : ${m.xfindShown}`);
  console.log('  header/chrome heights (margin box, 0 = hidden or absent):');
  const w = Math.max(...m.parts.map(p => p.sel.length));
  for (const p of m.parts) {
    const state = !p.present ? 'ABSENT' : (p.visible ? '' : 'hidden');
    console.log(`    ${p.sel.padEnd(w)}  ${String(Math.round(p.h * 10) / 10).padStart(7)} px  ${state}`);
  }
  const contributors = m.parts.filter(p => p.visible && p.sel !== 'header' && p.h > 0)
    .sort((a, b) => b.h - a.h).slice(0, 4)
    .map(p => `${p.sel} ${Math.round(p.h)}px`);
  console.log(`  biggest contributors   : ${contributors.join(', ') || 'none'}`);
}

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());          // philly default, no saved origin/favs
  await page.goto(URL, { waitUntil: 'networkidle' });

  // below 760px the table is display:none and rows render as #cards .card
  try { await page.waitForSelector('#cards .card', { timeout: 15000 }); }
  catch { await browser.close(); server.close(); fatal(`no #cards .card rendered at ${VW}px — mobile card layout did not boot`); }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  // ---- state A: no query ----------------------------------------------------
  const plain = await measure(page);
  if (!plain) { await browser.close(); server.close(); fatal('measurement evaluate failed (state: no query)'); }
  report('no query', plain, BUDGET_PLAIN);

  check(plain.cardTop !== null && plain.cardTop <= BUDGET_PLAIN,
    `no query: first card top ${plain.cardTop} px <= ${BUDGET_PLAIN} px budget`);
  check(plain.scrollWidth <= plain.innerWidth + 1,
    `no query: no horizontal page scroll (scrollWidth ${plain.scrollWidth} <= innerWidth ${plain.innerWidth} + 1)`);

  // ---- state B: query typed (xfind strip in play) ---------------------------
  // "park" matches in the active attractions tab AND in six other philly tabs, so
  // rows still render and the cross-tab hint strip (#xfind) is on screen.
  await page.fill('#q', QUERY);     // fill dispatches the input event
  await page.waitForTimeout(500);   // headroom for any debounce
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);

  const queried = await measure(page);
  if (!queried) { await browser.close(); server.close(); fatal('measurement evaluate failed (state: query typed)'); }
  report(`query "${QUERY}" typed`, queried, BUDGET_QUERY);

  // context only — the budget applies whether or not #xfind ended up visible
  if (!queried.xfindShown)
    console.log(`  NOTE: #xfind was not visible for "${QUERY}" — the queried-state measurement excludes that strip.`);

  check(queried.cards > 0, `query "${QUERY}": cards still render (${queried.cards})`);
  check(queried.cardTop !== null && queried.cardTop <= BUDGET_QUERY,
    `query typed: first card top ${queried.cardTop} px <= ${BUDGET_QUERY} px budget`);
  check(queried.scrollWidth <= queried.innerWidth + 1,
    `query typed: no horizontal page scroll (scrollWidth ${queried.scrollWidth} <= innerWidth ${queried.innerWidth} + 1)`);

  check(errors.length === 0, `no page errors (got: ${errors.join(' | ') || 'none'})`);

  // ---- summary always printed, pass or fail ---------------------------------
  console.log('\n  ==== §16 SUMMARY ====');
  console.log(`  no query      : ${plain.cardTop} px  / budget ${BUDGET_PLAIN} px`);
  console.log(`  query typed   : ${queried.cardTop} px  / budget ${BUDGET_QUERY} px`);
  console.log(`  horiz scroll  : ${plain.scrollWidth}/${plain.innerWidth} (plain), ${queried.scrollWidth}/${queried.innerWidth} (query)`);

  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.message));
