// TDD spec for cross-tab search hints (CONTRACTS §10).
//
// Match rule replicated VERBATIM from rows() in index.html:
//   const q = state.q.trim().toLowerCase();
//   if(q) list = list.filter(r => (r.n+" "+(r.c||"")+" "+(r.s||"")+" "+(r.w||"")).toLowerCase().includes(q));
// (#q has no debounce today — render() runs synchronously on each input event —
//  but the waits below tolerate one being added with the feature.)
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8938, URL = `http://localhost:${PORT}/`;

// Expected hints for the CURRENT active tab: {tabKey: matchCount} over every
// OTHER tab of the active city, zero-match tabs omitted.
const expectedHints = (page, q) => page.evaluate(q => {
  const qq = q.trim().toLowerCase();
  const out = {};
  for (const t of TABS) {
    if (t.key === state.tab) continue;
    const n = (DATA[t.key] || []).filter(r =>
      (r.n + " " + (r.c || "") + " " + (r.s || "") + " " + (r.w || "")).toLowerCase().includes(qq)).length;
    if (n > 0) out[t.key] = n;
  }
  return out;
}, q);

const qCount = (page, tab, q) => page.evaluate(([tab, q]) => {
  const qq = q.trim().toLowerCase();
  return (DATA[tab] || []).filter(r =>
    (r.n + " " + (r.c || "") + " " + (r.s || "") + " " + (r.w || "")).toLowerCase().includes(qq)).length;
}, [tab, q]);

async function typeQ(page, text) {
  await page.fill('#q', text); // fill dispatches the input event
  await page.waitForTimeout(500); // generous headroom for any debounce
}

// "hidden" = absent, [hidden], display:none/visibility:hidden, or offering no .xf buttons
const xfindHidden = page => page.evaluate(() => {
  const el = document.getElementById('xfind');
  if (!el) return true;
  const cs = getComputedStyle(el);
  if (el.hidden || cs.display === 'none' || cs.visibility === 'hidden') return true;
  return el.querySelectorAll('.xf').length === 0;
});

const xfButtons = page => page.evaluate(() =>
  [...document.querySelectorAll('#xfind .xf')].map(b => ({ tab: b.dataset.tab, text: b.textContent.trim() })));

const sameSet = (a, b) => a.slice().sort().join(',') === b.slice().sort().join(',');

async function assertHints(page, q, label) {
  const exp = await expectedHints(page, q);
  const expKeys = Object.keys(exp);
  const active = await page.evaluate(() => state.tab);
  const btns = await xfButtons(page);
  // contract: strip visible iff some OTHER tab has matches
  if (expKeys.length === 0) {
    check(await xfindHidden(page), `${label}: #xfind hidden (no other tab matches "${q}")`);
    return exp;
  }
  check(!(await xfindHidden(page)), `${label}: #xfind visible for "${q}"`);
  check(sameSet(btns.map(b => b.tab), expKeys),
    `${label}: .xf tabs [${btns.map(b => b.tab).sort()}] == expected [${expKeys.sort()}]`);
  check(!btns.some(b => b.tab === active), `${label}: no .xf for the active tab (${active})`);
  const labels = await page.evaluate(() => TABLABEL);
  for (const b of btns) {
    check(b.text.includes(labels[b.tab]), `${label}: .xf[${b.tab}] shows tab label "${labels[b.tab]}" (got "${b.text}")`);
    check(exp[b.tab] !== undefined && b.text.includes(String(exp[b.tab])),
      `${label}: .xf[${b.tab}] shows match count ${exp[b.tab]} (got "${b.text}")`);
  }
  return exp;
}

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#tbody tr.rowmain');

  // ---- boot philly, type "sushi" -------------------------------------------
  await typeQ(page, 'sushi');
  if (!(await page.$('#xfind'))) {
    await browser.close(); server.close();
    fatal('missing #xfind after typing a query — feature not implemented');
  }

  // sanity: the dataset really has cross-tab matches for this query
  const eatsExp = await qCount(page, 'eats', 'sushi');
  check(eatsExp > 0, `precondition: eats has ${eatsExp} "sushi" matches`);
  await assertHints(page, 'sushi', 'attractions+sushi');

  // ---- click the eats hint: switch tab, query preserved --------------------
  await page.click('#xfind .xf[data-tab="eats"]');
  await page.waitForTimeout(300);
  const activeTabs = await page.$$eval('.tab.active', els => els.map(e => e.dataset.tab));
  check(activeTabs.length === 1 && activeTabs[0] === 'eats', `eats tab chip active (got [${activeTabs}])`);
  check(await page.$eval('#q', e => e.value) === 'sushi', '#q input still "sushi" after .xf click');
  check(await page.evaluate(() => state.q === 'sushi'), 'state.q preserved');
  check(await page.evaluate(() => state.cat === '' && state.maxT === '' && !state.fav),
    'no other filters active (cat/maxT/fav clean)');
  const shown = await page.$$eval('#tbody tr.rowmain', els => els.length);
  check(shown === eatsExp, `eats renders ${shown} rows == expected match count ${eatsExp}`);
  await assertHints(page, 'sushi', 'eats+sushi (recomputed)');

  // ---- no matches anywhere -> hidden ----------------------------------------
  await typeQ(page, 'zzzqqqxx');
  check(Object.keys(await expectedHints(page, 'zzzqqqxx')).length === 0, 'precondition: no tab matches gibberish');
  check(await xfindHidden(page), '#xfind hidden for zero-match query');

  // ---- empty query -> hidden -------------------------------------------------
  await typeQ(page, '');
  check(await xfindHidden(page), '#xfind hidden when query cleared');

  // ---- tonight mode suppresses hints -----------------------------------------
  if (!(await page.$('#tonightBtn'))) { await browser.close(); server.close(); fatal('missing #tonightBtn — cannot test tonight suppression'); }
  await page.click('#tonightBtn');
  await page.waitForTimeout(200);
  check(await page.$eval('#tonightBtn', e => e.getAttribute('aria-pressed')) === 'true', 'tonight mode enabled');
  await typeQ(page, 'sushi');
  check(await xfindHidden(page), '#xfind stays hidden while tonight mode is on');

  // exiting tonight mode with the query still set brings hints back
  await page.click('#tonightBtn');
  await page.waitForTimeout(300);
  if (await page.evaluate(() => state.q === 'sushi')) {
    const exp = await expectedHints(page, 'sushi');
    if (Object.keys(exp).length > 0)
      check(!(await xfindHidden(page)), '#xfind visible again after exiting tonight mode with query set');
  }

  check(errors.length === 0, `no page errors (got: ${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.message));
