// TDD spec for the region-grouped city picker (CONTRACTS §1).
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8931, URL = `http://localhost:${PORT}/`;

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'networkidle' });

  if (!(await page.$('#regionbar'))) { await browser.close(); server.close(); fatal('missing #regionbar — feature not implemented'); }

  const regions = await page.$$eval('#regionbar .regionchip', els => els.map(e => e.dataset.region));
  check(JSON.stringify(regions) === JSON.stringify(['HOME', 'NYC', 'EAST', 'GREAT LAKES', 'SOUTH', 'WEST']),
    `6 region chips in order (got ${regions.join(',')})`);
  check(await page.$eval('#regionbar .regionchip.active', e => e.dataset.region) === 'HOME', 'HOME region active on boot');
  let chips = await page.$$eval('#citybar .citychip', els => els.map(e => e.dataset.city));
  check(chips.length === 1 && chips[0] === 'philly', 'citybar shows only PHILLY on boot');
  check(await page.$eval('#citybar .citychip.active', e => e.dataset.city) === 'philly', 'philly chip active');

  // click WEST: shows 4 west chips, does NOT switch city
  const h1Before = await page.$eval('#hPlace', e => e.textContent);
  await page.click('.regionchip[data-region="WEST"]');
  chips = await page.$$eval('#citybar .citychip', els => els.map(e => e.dataset.city));
  check(JSON.stringify(chips) === JSON.stringify(['la', 'sf', 'seattle', 'sandiego']), `WEST shows la,sf,seattle,sandiego (got ${chips.join(',')})`);
  check((await page.$$('#citybar .citychip.active')).length === 0, 'no active city chip when displayed region != active city region');
  check(await page.$eval('#regionbar .regionchip.active', e => e.dataset.region) === 'WEST', 'WEST regionchip active after click');
  check(await page.$eval('#hPlace', e => e.textContent) === h1Before, 'active city unchanged by region click');

  // click LA: switches city
  await page.click('.citychip[data-city="la"]');
  await page.waitForFunction(() => document.querySelector('#hPlace').textContent.includes('Los Angeles'), null, { timeout: 15000 });
  check(true, 'h1 shows Los Angeles after clicking LA');
  check(await page.$eval('#citybar .citychip.active', e => e.dataset.city) === 'la', 'LA chip active');
  check(await page.$eval('#regionbar .regionchip.active', e => e.dataset.region) === 'WEST', 'WEST region active after switch');

  // click GREAT LAKES: 4 chips, none active
  await page.click('.regionchip[data-region="GREAT LAKES"]');
  chips = await page.$$eval('#citybar .citychip', els => els.map(e => e.dataset.city));
  check(JSON.stringify(chips) === JSON.stringify(['buffalo', 'cleveland', 'chicago', 'toronto']), `GREAT LAKES chips (got ${chips.join(',')})`);
  check((await page.$$('#citybar .citychip.active')).length === 0, 'no active chip in GREAT LAKES while LA is the city');

  // reload: LA persists, WEST displayed
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#hPlace').textContent.includes('Los Angeles'), null, { timeout: 15000 });
  check(true, 'LA persists across reload');
  check(await page.$eval('#regionbar .regionchip.active', e => e.dataset.region) === 'WEST', 'WEST region displayed after reload');

  // mobile: bars visible, no horizontal page scroll
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  check(await page.$eval('#regionbar', e => e.offsetHeight > 0), 'regionbar visible at 390px');
  check(await page.$eval('#citybar', e => e.offsetHeight > 0), 'citybar visible at 390px');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal scroll at 390px');

  check(errors.length === 0, `no page errors (got: ${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.message));
