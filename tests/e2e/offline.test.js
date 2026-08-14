// TDD spec for offline PWA behavior (CONTRACTS §12).
// The README claims the installed app keeps working offline with the last
// fetched data. This spec verifies that end-to-end against the real service
// worker: boot online, let sw.js install + precache, switch to a second city,
// then take the browser context offline and reload.
//
// NOTE: _lib's launch() patches browser.newPage to pass serviceWorkers:'block'
// (map specs need page.route to win over the SW). This spec is about the SW
// itself, so it does NOT use browser.newPage — it builds its own context where
// service workers are allowed by default.
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8951, URL = `http://localhost:${PORT}/`;

const ROWS = '#tbody tr.rowmain';

// Boot-failure state: bootFailed() unhides #empty and writes "Couldn't load
// <file> — check your connection…" into it. Any visible "couldn't load"/"can't
// load" copy anywhere on the page counts as a broken offline boot.
const BOOT_FAIL = `(() => {
  const out = [];
  const empty = document.getElementById('empty');
  if (empty && !empty.hidden && getComputedStyle(empty).display !== 'none') {
    const t = (empty.textContent || '').trim();
    if (/couldn.?t load|can.?t load|check your connection|browsers block/i.test(t)) out.push('#empty: ' + t);
  }
  const toast = document.getElementById('toast');
  if (toast && /couldn.?t load/i.test(toast.textContent || '')) out.push('#toast: ' + toast.textContent.trim());
  return out;
})()`;

async function snapshot(page) {
  return page.evaluate(() => ({
    rows: document.querySelectorAll('#tbody tr.rowmain').length,
    regionChips: document.querySelectorAll('#regionbar .regionchip').length,
    cityChips: document.querySelectorAll('#citybar .citychip').length,
    activeCityChip: (document.querySelector('#citybar .citychip.active') || {}).textContent || null,
    activeRegionChip: (document.querySelector('#regionbar .regionchip.active') || {}).textContent || null,
    tabs: [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.tab),
    activeTab: (document.querySelector('#tabs .tab.active') || {}).dataset?.tab || null,
    place: (document.getElementById('hPlace') || {}).textContent || '',
    storedCity: localStorage.getItem('guide-city'),
    controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller)
  }));
}

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  // own context: service workers ALLOWED (the thing under test)
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // ---------- online boot ----------
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  try { await page.waitForSelector(ROWS, { timeout: 20000 }); }
  catch { await browser.close(); server.close(); fatal('app never booted online — no ' + ROWS + ' rendered'); }
  check(true, 'app boots online (rows rendered)');

  // ---------- service worker installs + activates ----------
  let swActive = false, swScope = null;
  try {
    swScope = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return null;
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise(r => setTimeout(() => r(null), 20000))
      ]);
      return reg ? { scope: reg.scope, state: reg.active && reg.active.state } : null;
    });
    swActive = !!(swScope && swScope.state === 'activated');
  } catch (e) { errors.push('serviceWorker.ready threw: ' + e.message); }
  check(swActive, `service worker registered and activated (navigator.serviceWorker.ready → ${JSON.stringify(swScope)})`);
  if (!swActive) {
    console.error('  (SW never activated — the offline assertions below cannot pass without it)');
  }
  // give install-time caches.addAll(PRECACHE) a beat to settle
  await page.waitForTimeout(1500);

  // the page must actually be under SW control for the reload to be served from cache
  let controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  if (!controlled) {
    // clients.claim() can land just after first paint; a reload guarantees control
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(ROWS, { timeout: 20000 }).catch(() => {});
    controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  }
  check(controlled, 'page is controlled by the service worker before going offline');

  // ---------- switch to a second city so its data file is fetched too ----------
  await page.click('#regionbar .regionchip[data-region="NYC"]').catch(() => {});
  await page.click('#citybar .citychip[data-city="nyc"]').catch(() => {});
  await page.waitForFunction(() => localStorage.getItem('guide-city') === 'nyc', { timeout: 15000 })
    .catch(() => {});
  const online = await snapshot(page);
  check(online.storedCity === 'nyc', `switched to a second city online (guide-city=${online.storedCity})`);
  check(online.rows > 0, `second city renders online (${online.rows} rows)`);
  await page.waitForTimeout(1000); // let the SW cache data-nyc.json

  // ---------- go offline ----------
  await context.setOffline(true);
  let navErr = null;
  // networkidle can hang offline — domcontentloaded only
  try { await page.reload({ waitUntil: 'domcontentloaded' }); }
  catch (e) { navErr = e.message.split('\n')[0]; }
  if (navErr) {
    // the SW never served the document from cache: the navigation itself died
    check(false, `offline reload navigated at all — the document was NOT served from cache, navigation failed (${navErr}). sw.js's fetch handler must fall back to the cache for navigations too.`);
    check(false, 'no boot-failure text shown offline — page never loaded offline');
    check(false, "offline reload renders the active city's rows — page never loaded offline");
    check(false, 'region/city bar renders offline — page never loaded offline');
    check(false, 'tab switching works offline — page never loaded offline');
    await context.setOffline(false);
    await page.goto(URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await context.close(); await browser.close(); server.close();
    done();
    return;
  }
  let booted = true;
  try { await page.waitForSelector(ROWS, { timeout: 20000 }); }
  catch { booted = false; }

  const fails = await page.evaluate(BOOT_FAIL);
  check(fails.length === 0, `no boot-failure text shown offline (${fails.length ? 'GOT → ' + fails.join(' | ') : 'clean'})`);

  const off = await snapshot(page);
  check(booted && off.rows > 0,
    booted && off.rows > 0
      ? `offline reload renders the active city's rows (${off.rows} rows, city=${off.storedCity})`
      : `offline reload rendered ZERO rows — the app did not come back up offline (rows=${off.rows}, city=${off.storedCity}, sw controller=${off.controlled})`);
  check(off.regionChips === 6, `region bar renders offline (${off.regionChips} .regionchip, expected 6)`);
  check(off.cityChips > 0, `city bar renders offline (${off.cityChips} .citychip)`);
  check(off.activeCityChip !== null, `active city chip still marked offline (${off.activeCityChip})`);
  check(off.storedCity === 'nyc' && /new york|nyc|manhattan|union/i.test(off.place),
    `offline boot restores the last active city (guide-city=${off.storedCity}, h1 place="${off.place}")`);

  // ---------- tab switching still works offline (within the loaded city) ----------
  const otherTab = off.tabs.find(t => t !== off.activeTab);
  if (!otherTab) {
    check(false, `offline page rendered a second tab to switch to (tabs=${JSON.stringify(off.tabs)})`);
  } else {
    let switched = false, tabRows = 0;
    try {
      await page.click(`#tabs .tab[data-tab="${otherTab}"]`, { timeout: 5000 });
      await page.waitForFunction(t => document.querySelector(`#tabs .tab[data-tab="${t}"]`).classList.contains('active'),
        otherTab, { timeout: 5000 });
      tabRows = await page.$$eval(ROWS, r => r.length);
      switched = true;
    } catch (e) { errors.push('offline tab switch threw: ' + e.message.split('\n')[0]); }
    check(switched && tabRows > 0,
      switched && tabRows > 0
        ? `tab switching works offline (→ ${otherTab}, ${tabRows} rows)`
        : `tab switching BROKE offline (→ ${otherTab}, switched=${switched}, rows=${tabRows})`);
    const fails2 = await page.evaluate(BOOT_FAIL);
    check(fails2.length === 0, `no failure text after an offline tab switch (${fails2.join(' | ') || 'clean'})`);
  }

  // informational: sw.js precaches every city dataset, so a cold city switch
  // offline should also work. Not a §12 requirement — logged, not asserted.
  await page.click('#regionbar .regionchip[data-region="HOME"]').catch(() => {});
  await page.click('#citybar .citychip[data-city="philly"]').catch(() => {});
  await page.waitForTimeout(2500);
  const crossCity = await snapshot(page);
  console.log(`  INFO offline city switch → guide-city=${crossCity.storedCity}, rows=${crossCity.rows}` +
    (crossCity.storedCity === 'philly' && crossCity.rows > 0 ? ' (precached datasets served offline)' : ' (NOT served offline)'));

  // ---------- back online ----------
  await context.setOffline(false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  let backUp = true;
  try { await page.waitForSelector(ROWS, { timeout: 20000 }); } catch { backUp = false; }
  const on2 = await snapshot(page);
  const fails3 = await page.evaluate(BOOT_FAIL);
  check(backUp && on2.rows > 0 && fails3.length === 0,
    backUp && on2.rows > 0 && fails3.length === 0
      ? `normal operation resumes back online (${on2.rows} rows, city=${on2.storedCity})`
      : `back online the app did not recover (booted=${backUp}, rows=${on2.rows}, failures=${fails3.join(' | ') || 'none'})`);

  check(errors.length === 0, `no page errors across the whole run (${errors.join(' | ') || 'none'})`);

  await context.close();
  await browser.close();
  server.close();
  done();
})().catch(e => fatal(e.stack || e.message));
