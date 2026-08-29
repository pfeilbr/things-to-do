// Spec for the category chip bar and the two-band distance filter.
//
// The chip bar (#catChips) replaces the old category <select>: one chip per
// category in the active tab, each with a count taken from the WHOLE tab (not
// the filtered list, so the numbers hold still while you click). Clicking a chip
// filters; clicking the active chip clears it. #distFilter carries walking
// distance ("d:<mi>") and drive minutes (a bare number) in one control, and only
// one band is ever active. Whenever anything is filtering, a "clear: …" button
// appears in the meta line and resets every filter at once.
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8941, URL = `http://localhost:${PORT}/`;

const chips = page => page.$$eval('#catChips .catchip', els => els.map(e => ({
  cat: e.dataset.cat,
  count: +e.querySelector('.cnt').textContent,
  active: e.getAttribute('aria-pressed') === 'true',
})));
const shownCount = page => page.$$eval('#tbody tr.rowmain', r => r.length);

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${URL}#city=foresthills`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#hPlace').textContent.includes('Forest Hills'), null, { timeout: 15000 });

  if (!(await page.$('#catChips'))) { await browser.close(); server.close(); fatal('missing #catChips — filter bar not implemented'); }

  // --- the everyday-life tabs exist on this guide -------------------------------------
  const tabs = await page.$$eval('#tabs .tab', els => els.map(e => e.dataset.tab));
  for (const t of ['museums', 'sights', 'walks', 'shops', 'essentials']) {
    check(tabs.includes(t), `Forest Hills renders the "${t}" tab`);
  }

  // --- chips: an "All" chip plus one per category, counts summing to the tab ----------
  await page.click('.tab[data-tab="essentials"]');
  await page.waitForFunction(() => document.querySelectorAll('#catChips .catchip').length > 1);
  const cs = await chips(page);
  const all = cs[0], cats = cs.slice(1);
  check(all.cat === '' && all.active, 'first chip is "All" and starts active');
  check(cats.length >= 3, `essentials has several category chips (got ${cats.length})`);
  const tabRows = await page.evaluate(() => DATA.essentials.length);
  const sum = cats.reduce((n, c) => n + c.count, 0);
  check(sum === tabRows, `chip counts sum to the tab's row count (${sum} == ${tabRows})`);
  check(all.count === tabRows, `"All" chip count is the tab's row count (${all.count})`);

  // --- clicking a chip filters, and the counts do not move -----------------------------
  const target = cats[0];
  await page.click(`#catChips .catchip[data-cat="${target.cat}"]`);
  await page.waitForFunction(n => document.querySelectorAll('#tbody tr.rowmain').length === n, target.count);
  check(await shownCount(page) === target.count, `clicking "${target.cat}" shows exactly its ${target.count} rows`);
  const after = await chips(page);
  check(after.slice(1).every((c, i) => c.count === cats[i].count),
    'chip counts are unchanged by filtering (counted against the whole tab)');
  check(after.find(c => c.cat === target.cat).active, 'the clicked chip is marked active');

  // --- clicking the active chip clears it ----------------------------------------------
  await page.click(`#catChips .catchip[data-cat="${target.cat}"]`);
  await page.waitForFunction(n => document.querySelectorAll('#tbody tr.rowmain').length === n, tabRows);
  check(await shownCount(page) === tabRows, 'clicking the active chip clears the category filter');

  // --- the clear button appears only while something is filtering ----------------------
  check(await page.$('#clearFilters') === null, 'no clear button when nothing is filtering');
  await page.click(`#catChips .catchip[data-cat="${target.cat}"]`);
  await page.fill('#q', 'a');
  await page.waitForSelector('#clearFilters');
  const label = await page.$eval('#clearFilters', e => e.textContent);
  check(label.includes(target.cat), `clear button names the active category (got "${label}")`);
  await page.click('#clearFilters');
  await page.waitForFunction(() => !document.querySelector('#clearFilters'));
  check(await page.$eval('#q', e => e.value) === '', 'clear resets the search box');
  check(await shownCount(page) === tabRows, 'clear restores the full tab');

  // --- distance filter: the walking band uses miles, not drive minutes -----------------
  await page.selectOption('#distFilter', 'd:1');
  await page.waitForFunction(() => state.maxD === '1');
  check(await page.evaluate(() => state.maxT === ''), 'picking a walk band clears the drive-time band');
  const walkRows = await page.$$eval('#tbody tr.rowmain', rows => rows.length);
  const within = await page.evaluate(() => DATA.essentials.filter(r => r.d <= 1).length);
  check(walkRows === within, `"≤ 1 mi walk" shows the ${within} rows inside a mile (got ${walkRows})`);

  await page.selectOption('#distFilter', '10');
  await page.waitForFunction(() => state.maxT === '10');
  check(await page.evaluate(() => state.maxD === ''), 'picking a drive band clears the walk band');

  // --- both bands round-trip through the URL hash --------------------------------------
  await page.selectOption('#distFilter', 'd:0.5');
  await page.waitForFunction(() => location.hash.includes('mi=0.5'));
  check((await page.evaluate(() => location.hash)).includes('mi=0.5'), 'walk band is written to the hash');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => state.maxD === '0.5', null, { timeout: 15000 });
  check(await page.$eval('#distFilter', e => e.value) === 'd:0.5',
    'the walk band survives a reload and the select reflects it');

  check(errors.length === 0, `no page errors (got: ${errors.join('; ') || 'none'})`);
  await browser.close();
  server.close();
  done();
})();
