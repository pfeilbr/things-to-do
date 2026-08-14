// TDD spec for cross-city search (CONTRACTS §15).
//
// The #xfind strip (§10, already implemented in renderXfind()) gains ONE extra button
// `button#xfAll` AFTER the per-tab `.xf` buttons whenever the query is non-empty and
// tonight mode is off. Clicking it loads every CONFIG.cities dataset through the existing
// fetchCity/DATACACHE path and lists matching rows from EVERY city with a City column
// prepended, sorted by each row's own baked `d` ascending.
//
// Match rule replicated VERBATIM from rows() in index.html:
//   const q = state.q.trim().toLowerCase();
//   if(q) list = list.filter(r => (r.n+" "+(r.c||"")+" "+(r.s||"")+" "+(r.w||"")).toLowerCase().includes(q));
//
// Query choice: "omakase" matches in 20 of the 22 datasets (66 rows, 63 distinct names —
// "Sushi Nakazawa"/"Sushi on Me"/"Sushi by Bou" each appear in two cities), and every one
// of those matches lives in an `eats` tab, so the expected set is the same whether the
// implementation scans all tabs per city or only the matching tab. Philly (data.json) has
// exactly 3 of them, and NONE in the boot tab (attractions), so the single-city view is
// unambiguously smaller than the all-cities view.
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8956, URL = `http://localhost:${PORT}/`;
const Q = 'omakase';

async function typeQ(page, text) {
  await page.fill('#q', text);        // fill dispatches the input event
  await page.waitForTimeout(400);     // headroom in case a debounce lands with the feature
}

// waitForFunction that degrades into a FAIL instead of hanging/throwing
async function waitFor(page, fn, label, arg = null, timeout = 60000) {
  try { await page.waitForFunction(fn, arg, { timeout, polling: 250 }); check(true, label); return true; }
  catch (e) { check(false, `${label} — timed out after ${timeout}ms`); return false; }
}

const visible = (page, sel) => page.evaluate(sel => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const cs = getComputedStyle(el);
  return !el.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
}, sel);

// counts over the datasets currently in DATACACHE, using the app's own match rule
const counts = (page, q) => page.evaluate(q => {
  const qq = q.trim().toLowerCase();
  const hit = r => (r.n + " " + (r.c || "") + " " + (r.s || "") + " " + (r.w || "")).toLowerCase().includes(qq);
  let total = 0, withMatches = 0; const names = new Set();
  for (const c of CONFIG.cities) {
    const d = DATACACHE[c.id];
    if (!d) continue;
    const m = Object.values(d).flat().filter(hit);
    total += m.length; if (m.length) withMatches++;
    m.forEach(r => names.add(r.n));
  }
  const philly = Object.values(DATACACHE.philly || {}).flat().filter(hit).length;
  return { total, withMatches, distinct: names.size, philly, cached: Object.keys(DATACACHE).length, cities: CONFIG.cities.length };
}, q);

// the rendered grid: header labels (sort arrows stripped), first-cell text and distance per row
const grid = page => page.evaluate(() => ({
  headers: [...document.querySelectorAll('#theadRow th')].map(th => th.textContent.replace(/[↕▲▼]/g, '').trim()),
  activeTabs: [...document.querySelectorAll('.tab.active')].map(t => t.dataset.tab),
  showing: (document.getElementById('showing') || {}).textContent || '',
  rows: [...document.querySelectorAll('#tbody tr.rowmain')].map(tr => {
    const td = tr.querySelector('td');
    const dtxt = [...tr.querySelectorAll('.dist')].map(x => x.textContent).find(t => /mi\b/.test(t)) || '';
    const m = dtxt.match(/([\d.]+)\s*mi/);
    return { first: (td ? td.textContent : '').replace(/[★☆▶📍]/g, '').trim(), d: m ? parseFloat(m[1]) : null };
  })
}));

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
  check(await page.evaluate(() => CITY.id) === 'philly', 'boots into philly');

  const labels = await page.evaluate(() => CONFIG.cities.map(c => ({ id: c.id, chip: c.chip, short: c.placeShort })));
  const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const cityOf = txt => {
    const t = norm(txt);
    const hit = labels.find(c => norm(c.chip) === t || norm(c.short) === t);
    return hit ? hit.id : null;
  };

  // ---- absent while the query is empty ---------------------------------------
  check(!(await page.$('#xfAll')), '#xfAll absent with an empty query');

  // ---- absent in tonight mode, even with a query ------------------------------
  if (!(await page.$('#tonightBtn'))) { await browser.close(); server.close(); fatal('missing #tonightBtn — cannot test tonight suppression'); }
  await page.click('#tonightBtn');
  await page.waitForTimeout(200);
  check(await page.$eval('#tonightBtn', e => e.getAttribute('aria-pressed')) === 'true', 'tonight mode enabled');
  await typeQ(page, Q);
  check(!(await page.$('#xfAll')), '#xfAll absent while tonight mode is on');
  await page.click('#tonightBtn');           // back to normal single-city view
  await page.waitForTimeout(300);
  await typeQ(page, '');
  await page.waitForTimeout(100);

  // ---- boot philly, type the query -> #xfAll exists ---------------------------
  await typeQ(page, Q);
  const before = await counts(page, Q);
  check(before.philly === 3, `precondition: philly has ${before.philly} "${Q}" matches (expected 3)`);
  check(before.cached === 1, `no dataset loading on keystroke (DATACACHE holds ${before.cached} of ${before.cities})`);
  const single = (await grid(page)).rows.length;

  if (!(await page.$('#xfAll'))) {
    const diag = await page.evaluate(() => {
      const el = document.getElementById('xfind');
      return { xfind: !!el, hidden: el ? el.hidden : null, xf: el ? el.querySelectorAll('.xf').length : 0 };
    });
    await browser.close(); server.close();
    fatal(`missing #xfAll after typing "${Q}" — cross-city search not implemented ` +
      `(#xfind present: ${diag.xfind}, hidden: ${diag.hidden}, .xf buttons: ${diag.xf})`);
  }

  check(await visible(page, '#xfAll'), '#xfAll is visible');
  check(await page.$('#xfind #xfAll') !== null, '#xfAll lives inside the #xfind strip');
  const place = await page.evaluate(() => {
    const b = document.getElementById('xfAll');
    const xf = [...document.querySelectorAll('#xfind .xf')];
    return {
      text: b.textContent.trim(),
      afterAll: xf.every(x => x.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING),
      isXf: b.classList.contains('xf'),
      xfCount: xf.length
    };
  });
  check(/all\s*cities/i.test(place.text), `#xfAll is labelled "all cities" (got "${place.text}")`);
  check(place.afterAll, `#xfAll comes after the ${place.xfCount} per-tab .xf button(s)`);
  // §10's spec treats "#xfind with zero .xf buttons" as hidden and asserts every .xf maps to
  // a tab — so this button must NOT carry the .xf class or search-hints.test.js breaks.
  check(!place.isXf, '#xfAll does not carry the .xf class (keeps §10 per-tab hints intact)');

  // ---- click it: all 22 datasets load, all-cities view renders -----------------
  await page.click('#xfAll');
  const loaded = await waitFor(page, () => Object.keys(DATACACHE).length === CONFIG.cities.length,
    'clicking #xfAll loads every city dataset via fetchCity/DATACACHE');
  // let the render settle: row count stable across two polls
  await page.waitForTimeout(1000);
  let prev = -1, now = 0;
  for (let i = 0; i < 40 && prev !== now; i++) {
    prev = now;
    await page.waitForTimeout(250);
    now = await page.$$eval('#tbody tr.rowmain', e => e.length);
  }

  const exp = await counts(page, Q);
  console.log(`  info: expected all-cities matches = ${exp.total} rows / ${exp.distinct} distinct names across ${exp.withMatches} cities; philly-only = ${exp.philly}; single-city view showed ${single}`);
  const g = await grid(page);
  console.log(`  info: rendered ${g.rows.length} rows, headers = [${g.headers.join(' | ')}]`);

  check(g.rows.length > exp.philly, `all-cities renders ${g.rows.length} rows > philly-only match count ${exp.philly}`);
  check(g.rows.length > single, `all-cities renders ${g.rows.length} rows > single-city view's ${single}`);
  check(g.rows.length >= exp.distinct && g.rows.length <= exp.total,
    `row count ${g.rows.length} within [${exp.distinct} deduped, ${exp.total} raw] cross-city matches`);

  // City column, first position
  check(/^city$/i.test(g.headers[0] || ''), `first column header is "City" (got "${g.headers[0]}")`);
  check(g.headers.filter(h => /^city$/i.test(h)).length === 1, 'exactly one City header');
  check(g.headers.length >= 5, `standard columns kept alongside City (got ${g.headers.length} headers)`);

  // every City cell is a real chip/placeShort, and several cities are represented
  const ids = g.rows.map(r => cityOf(r.first));
  const bad = g.rows.filter((r, i) => !ids[i]).map(r => r.first);
  check(bad.length === 0, `every City cell is a CONFIG chip/placeShort (unrecognized: ${[...new Set(bad)].slice(0, 5).join(', ') || 'none'})`);
  const distinctCities = new Set(ids.filter(Boolean));
  check(distinctCities.size >= 3, `at least 3 distinct city labels rendered (got ${distinctCities.size}: ${[...distinctCities].slice(0, 8).join(', ')})`);

  // sorted by each row's own baked d, ascending
  const ds = g.rows.map(r => r.d).filter(d => d != null);
  let firstBreak = -1;
  for (let i = 1; i < ds.length; i++) if (ds[i] < ds[i - 1] - 0.001) { firstBreak = i; break; }
  check(ds.length > 0 && firstBreak === -1,
    firstBreak === -1 ? `distances ascending across ${ds.length} rows` : `distances ascending (broke at row ${firstBreak}: ${ds[firstBreak - 1]} then ${ds[firstBreak]})`);

  // mode markers
  check(g.activeTabs.length === 0, `no .tab is active in all-cities mode (got [${g.activeTabs}])`);
  check(/all\s*cities/i.test(g.showing), `#showing mentions "all cities" (got "${g.showing}")`);
  check(await page.$eval('#q', e => e.value) === Q, `#q input still "${Q}"`);
  check(await page.evaluate(q => state.q === q, Q), 'state.q preserved in all-cities mode');
  check(loaded && exp.cached === exp.cities, `all ${exp.cities} datasets cached`);

  // ---- a row's detail panel still opens ---------------------------------------
  const summary = await page.$('#tbody tr.rowmain .summary');
  if (summary) await summary.click();
  else { await page.$eval('#tbody tr.rowmain', el => el.focus()); await page.keyboard.press('Enter'); }
  await page.waitForTimeout(300);
  check(await page.$$eval('#tbody tr.detail', e => e.length) >= 1, 'a row detail panel opens in all-cities mode');
  const colspan = await page.$eval('#tbody tr.detail td', td => +td.getAttribute('colspan')).catch(() => null);
  check(colspan === g.headers.length, `detail row spans all ${g.headers.length} columns (got colspan=${colspan})`);

  // ---- clicking a tab exits back to the normal single-city view ----------------
  await page.click('.tab');
  await page.waitForTimeout(400);
  const back = await grid(page);
  check(back.activeTabs.length === 1, `a .tab is active again after clicking a tab (got [${back.activeTabs}])`);
  check(!/^city$/i.test(back.headers[0] || ''), `City column gone after exiting (first header "${back.headers[0]}")`);
  check(!/all\s*cities/i.test(back.showing), `#showing no longer mentions all cities (got "${back.showing}")`);
  check(back.rows.length > 0, `single-city view renders again (${back.rows.length} rows)`);
  check(await page.evaluate(() => CITY.id) === 'philly', 'active city is still philly after exiting');

  // ---- clearing the query also exits -------------------------------------------
  await typeQ(page, Q);
  if (await page.$('#xfAll')) {
    await page.click('#xfAll');
    await waitFor(page, () => /all\s*cities/i.test(document.getElementById('showing').textContent),
      're-entered all-cities mode', null, 60000);
    await typeQ(page, '');
    await page.waitForTimeout(400);
    const cleared = await grid(page);
    check(cleared.activeTabs.length === 1, `clearing the query exits all-cities mode (active tab [${cleared.activeTabs}])`);
    check(!/^city$/i.test(cleared.headers[0] || ''), `City column gone after clearing the query (first header "${cleared.headers[0]}")`);
    check(!/all\s*cities/i.test(cleared.showing), `#showing back to normal after clearing (got "${cleared.showing}")`);
    check(!(await page.$('#xfAll')), '#xfAll gone once the query is empty');
  } else check(false, '#xfAll missing when re-typing the query after exiting');

  check(errors.length === 0, `no page errors (got: ${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.stack || e.message));
