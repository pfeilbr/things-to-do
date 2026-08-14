// Boot health (CONTRACTS §14): clean boot, fast first paint, and lazy datasets.
// The service worker is blocked by _lib's launch(), which is what we want here —
// every dataset request has to hit the network so page.on('request') can see it.
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8953, URL = `http://localhost:${PORT}/`;

const DATA_RE = /data[^/]*\.json(\?|$)/;

// The Google Fonts <link> in <head> is render-blocking, and sandboxed test envs
// can't reach it — the request sits until the proxy resets it (~13s observed),
// which would gate first paint on a host that answers in milliseconds in prod.
// Stub it (same idea as _lib's unpkg/tile routing) so the 10s budget below
// measures the app's own boot rather than the sandbox's network.
async function stubFonts(page) {
  await page.route('https://fonts.googleapis.com/**', r =>
    r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
}

// Console noise we don't own: the sandbox can't reach these hosts, and a missing
// favicon is not an app error. Anything else counts as a real console error.
const NOISE = [/unpkg\.com/, /tile\.openstreetmap\.org/, /nominatim/i, /favicon/i,
  /net::ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED|PROXY|TUNNEL|CONNECTION)/];
const isNoise = t => NOISE.some(re => re.test(t));

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const errors = [], consoleErrors = [], noisy = [];
  let dataReqs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    (isNoise(m.text()) ? noisy : consoleErrors).push(m.text());
  });
  // instrumented BEFORE any navigation so the boot fetch is counted
  page.on('request', r => { if (DATA_RE.test(r.url())) dataReqs.push(r.url()); });
  await stubFonts(page);

  // start from a clean slate: no persisted city, no favourites
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });

  // ---- (c) rows rendered within 10s of navigation, (d) at most 2 data files ----
  dataReqs = [];
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: 'commit' });
  try {
    await page.waitForSelector('#tbody tr.rowmain', { timeout: 10000 });
  } catch (e) {
    check(false, 'boot rendered #tbody tr.rowmain within 10s (timed out)');
    console.error('  pageerrors:', errors.join(' | ') || 'none');
    await browser.close(); server.close(); done();
  }
  const bootMs = Date.now() - t0;
  const rowCount = await page.$$eval('#tbody tr.rowmain', els => els.length);
  check(rowCount > 0, `boot rendered ${rowCount} rows in ${bootMs} ms (< 10000 ms budget)`);

  // let anything speculative settle before counting boot fetches
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  const bootFetches = [...new Set(dataReqs.map(u => u.split('/').pop()))];
  check(bootFetches.length <= 2,
    `boot fetched ${bootFetches.length} JSON dataset(s) (<= 2): ${bootFetches.join(', ') || 'none'}`);
  check(dataReqs.length === bootFetches.length,
    `no duplicate dataset requests on boot (${dataReqs.length} request(s) for ${bootFetches.length} file(s))`);

  // ---- (e) switching city fetches exactly one more dataset ----
  if (!(await page.$('.regionchip[data-region="NYC"]'))) {
    await browser.close(); server.close(); fatal('missing NYC regionchip — cannot drive the city switch');
  }
  await page.click('.regionchip[data-region="NYC"]');
  await page.waitForSelector('.citychip[data-city="nyc"]', { timeout: 5000 });
  dataReqs = [];                                   // reset AFTER the region click
  await page.click('.citychip[data-city="nyc"]');
  await page.waitForFunction(() => document.querySelector('#hPlace').textContent.includes('New York'),
    null, { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  check(dataReqs.length === 1,
    `city switch fetched exactly 1 dataset (got ${dataReqs.length}: ${dataReqs.map(u => u.split('/').pop()).join(', ') || 'none'})`);
  check(dataReqs.every(u => /data-nyc\.json/.test(u)),
    `the fetched dataset is data-nyc.json (${dataReqs.map(u => u.split('/').pop()).join(', ') || 'none'})`);

  // switching back to an already-loaded city must not refetch (in-memory cache)
  dataReqs = [];
  await page.click('.regionchip[data-region="HOME"]');
  await page.waitForSelector('.citychip[data-city="philly"]', { timeout: 5000 });
  await page.click('.citychip[data-city="philly"]');
  await page.waitForFunction(() => !document.querySelector('#hPlace').textContent.includes('New York'),
    null, { timeout: 15000 });
  await page.waitForTimeout(500);
  check(dataReqs.length === 0,
    `switching back to a cached city refetched nothing (got ${dataReqs.length})`);

  // ---- (a) + (b) clean console ----
  check(errors.length === 0, `no page errors (got: ${errors.join(' | ') || 'none'})`);
  check(consoleErrors.length === 0,
    `no console errors beyond blocked-host noise (got: ${consoleErrors.join(' | ') || 'none'})`);
  if (noisy.length) console.log(`  info: ignored ${noisy.length} network-noise console message(s)`);
  console.log(`  info: boot ${bootMs} ms, ${rowCount} rows, boot datasets [${bootFetches.join(', ')}]`);

  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.stack || e.message));
