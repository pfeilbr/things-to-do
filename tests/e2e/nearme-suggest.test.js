// TDD spec for the near-me city suggestion (CONTRACTS §9).
// EXPECTED TO FAIL until §9 is implemented — the #citySuggest bar does not exist yet.
// Geolocation needs a real browser CONTEXT (launch()'s patched newPage isn't enough),
// so each scenario gets a fresh context (which also gives it fresh session/localStorage).
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8937, URL = `http://localhost:${PORT}/`;

const SEATTLE  = { latitude: 47.6089, longitude: -122.3401 }; // downtown Seattle
const PHILLY   = { latitude: 39.9526, longitude: -75.1652  }; // Philadelphia City Hall
const COLORADO = { latitude: 39.0,    longitude: -105.5    }; // rural Colorado
const SUGGEST_TIMEOUT = 15000; // suggestion needs all 22 datasets fetched first — be generous
const SETTLE_MS = 3500;        // per contract: assert the bar ABSENT only after a settled wait

const errors = [];

async function freshPage(browser, geolocation) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true, serviceWorkers: 'block',
    geolocation, permissions: ['geolocation'],
    viewport: { width: 1280, height: 900 },
  });
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const h = document.querySelector('#hPlace');
    return !!h && h.textContent.trim().length > 0;
  });
  return { context, page };
}

// The near-me control: #nearBtn per the contract; fall back to the app's current
// #geoToggle id so the geolocation flow still runs pre-§9 and the test fails on
// the actual contract surface (#citySuggest missing), not on a click timeout.
async function nearSel(page) {
  if (await page.$('#nearBtn')) return '#nearBtn';
  if (await page.$('#geoToggle')) {
    console.log('  info: #nearBtn not found — using the existing near-me control #geoToggle');
    return '#geoToggle';
  }
  return null;
}

async function tapNear(page, sel) {
  await page.click(sel);
  // geolocation success == the header flips to the near-you state
  await page.waitForFunction(
    () => /your location/i.test(document.querySelector('#hPlace').textContent),
    null, { timeout: 10000 });
}

function suggestVisible(page) { return page.isVisible('#citySuggest'); }

function waitForSuggest(page) {
  return page.waitForSelector('#citySuggest', { state: 'visible', timeout: SUGGEST_TIMEOUT })
    .then(() => true).catch(() => false);
}

(async () => {
  const server = await serve(PORT);
  const browser = await launch();

  // ---- Scenario 1: geo Seattle, boot philly, tap near-me → bar appears; Go switches city
  console.log('Scenario 1: Seattle geolocation → #citySuggest appears; Go switches to seattle');
  {
    const { context, page } = await freshPage(browser, SEATTLE);
    check(/Willow Grove/.test(await page.$eval('#hPlace', e => e.textContent)), 'boots into philly (Willow Grove)');
    const sel = await nearSel(page);
    if (!sel) { await browser.close(); server.close(); fatal('no near-me button on the page (#nearBtn / #geoToggle)'); }
    await tapNear(page, sel);
    const appeared = await waitForSuggest(page);
    check(appeared, `#citySuggest bar appears within ${SUGGEST_TIMEOUT / 1000}s of near-me success (§9 feature)`);
    if (appeared) {
      const txt = (await page.$eval('#citySuggest', e => e.textContent)).replace(/\s+/g, ' ').trim();
      check(/Seattle/.test(txt), `bar names the nearest city — "${txt}" contains "Seattle"`);
      check(!!(await page.$('#citySuggest #citySuggestGo')), 'bar contains a #citySuggestGo button');
      check(!!(await page.$('#citySuggest #citySuggestNo')), 'bar contains a #citySuggestNo dismiss button');
      await page.click('#citySuggestGo');
      const switched = await page.waitForFunction(
        () => localStorage.getItem('guide-city') === 'seattle', null, { timeout: 15000 })
        .then(() => true).catch(() => false);
      check(switched, 'Go switches the active city (localStorage guide-city == "seattle")');
      await page.waitForTimeout(500);
      check(/your location/i.test(await page.$eval('#hPlace', e => e.textContent)),
        '#hPlace still shows the near-you state after the switch (userLoc preserved)');
      check((await page.$eval(sel, e => e.getAttribute('aria-pressed'))) === 'true',
        'near-me control stays engaged after the switch (aria-pressed="true")');
      check(!(await suggestVisible(page)), 'bar hides after Go');
    } else {
      console.log('  SKIP  bar contents / Go behavior (bar never appeared)');
    }
    await context.close();
  }

  // ---- Scenario 2: geo Philadelphia City Hall — nearest centroid IS the active city → no bar
  console.log('Scenario 2: Philadelphia geolocation (nearest == active) → NO bar');
  {
    const { context, page } = await freshPage(browser, PHILLY);
    const sel = await nearSel(page);
    if (!sel) { await browser.close(); server.close(); fatal('no near-me button on the page'); }
    await tapNear(page, sel);
    await page.waitForTimeout(SETTLE_MS);
    check(!(await suggestVisible(page)), 'no #citySuggest when the nearest city is the active one');
    await context.close();
  }

  // ---- Scenario 3: rural Colorado — every centroid > 80 mi away → no bar
  console.log('Scenario 3: rural Colorado geolocation (nothing within 80 mi) → NO bar');
  {
    const { context, page } = await freshPage(browser, COLORADO);
    const sel = await nearSel(page);
    if (!sel) { await browser.close(); server.close(); fatal('no near-me button on the page'); }
    await tapNear(page, sel);
    await page.waitForTimeout(SETTLE_MS);
    check(!(await suggestVisible(page)), 'no #citySuggest when the nearest centroid is beyond 80 mi');
    await context.close();
  }

  // ---- Scenario 4: dismiss via No → not re-suggested this session
  console.log('Scenario 4: Seattle again on a fresh page → No dismisses; not re-suggested this session');
  {
    const { context, page } = await freshPage(browser, SEATTLE);
    const sel = await nearSel(page);
    if (!sel) { await browser.close(); server.close(); fatal('no near-me button on the page'); }
    await tapNear(page, sel);
    const appeared = await waitForSuggest(page);
    check(appeared, 'bar appears again on a fresh page (fresh sessionStorage)');
    if (appeared) {
      await page.click('#citySuggestNo');
      await page.waitForTimeout(300);
      check(!(await suggestVisible(page)), 'No hides the bar');
      check((await page.evaluate(() => localStorage.getItem('guide-city'))) !== 'seattle',
        'No does not switch the city');
      // literal contract step: tap the near button again → bar stays hidden
      await page.click(sel);
      await page.waitForTimeout(600);
      check(!(await suggestVisible(page)), 'bar stays hidden after tapping near-me again');
      // stronger: fully re-engage near-me (geolocation succeeds again) → still no re-suggest
      if ((await page.$eval(sel, e => e.getAttribute('aria-pressed'))) !== 'true') {
        await tapNear(page, sel);
      }
      await page.waitForTimeout(SETTLE_MS);
      check(!(await suggestVisible(page)),
        'Seattle is not re-suggested this session after re-engaging near-me (sessionStorage)');
    } else {
      console.log('  SKIP  dismiss flow (bar never appeared)');
    }
    await context.close();
  }

  check(errors.length === 0, `no page errors (got: ${errors.join(' | ') || 'none'})`);
  await browser.close();
  server.close();
  done();
})().catch(e => fatal(e.stack || e.message));
