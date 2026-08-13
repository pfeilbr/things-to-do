// TDD spec for map marker clustering (CONTRACTS §5).
const { serve, launch, check, fatal, done, routeUnpkg } = require('./_lib');
const PORT = 8933, URL = `http://localhost:${PORT}/`;

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await routeUnpkg(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'networkidle' });

  // philly attractions (384 rows) in map view
  await page.selectOption('#distFilter', '');
  await page.click('#mapToggle');
  await page.waitForFunction(() => window.map && document.querySelectorAll('.leaflet-marker-icon').length > 0,
    null, { timeout: 45000 }).catch(() => fatal('map markers never rendered (window.map/.leaflet-marker-icon)'));

  const withLL = await page.evaluate(() => DATA.attractions.filter(r => r.ll).length);
  const clusters = (await page.$$('.marker-cluster')).length;
  const icons = (await page.$$('.leaflet-marker-icon')).length;
  check(clusters >= 1, `clusters present on ${withLL}-marker attractions map (got ${clusters})`);
  check(icons > 0 && icons < withLL, `marker icons collapsed by clustering (${icons} icons < ${withLL} rows)`);

  // small tab: fishing -> plain markers, one per row with ll
  await page.click('.tab[data-tab="fishing"]');
  await page.waitForTimeout(800);
  const fishLL = await page.evaluate(() => DATA.fishing.filter(r => r.ll).length);
  await page.waitForFunction(ll => document.querySelectorAll('.leaflet-marker-icon').length === ll, fishLL, { timeout: 15000 })
    .catch(() => {});
  const fishClusters = (await page.$$('.marker-cluster')).length;
  const fishIcons = (await page.$$('.leaflet-marker-icon')).length;
  check(fishClusters === 0, `no clusters on small fishing map (got ${fishClusters})`);
  check(fishIcons === fishLL, `plain marker per fishing row with ll (${fishIcons}/${fishLL})`);

  check(errors.length === 0, `no page errors (got: ${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.message));
