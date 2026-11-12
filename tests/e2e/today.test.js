// Today view: every city opens on it, it routes into items and tabs and back, it follows
// a city switch, deep links to a tab still land on the lists, and its "Open on Today"
// checkbox is the one switch that sends you straight to the lists instead.
const { serve, launch, check, done } = require('./_lib');
const PORT = 8981, URL = `http://localhost:${PORT}/`;

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, todayFirst: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  // the weather is decoration: stub it so the spec never depends on the network
  let wxCalls = 0;
  await page.route('https://api.open-meteo.com/**', r => { wxCalls++; r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ current: { temperature_2m: 50.2, weather_code: 2, precipitation: 0, wind_speed_10m: 6 },
      daily: { temperature_2m_max: [58], precipitation_probability_max: [10] } }) }); });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#todayview .tdhero', { timeout: 15000 });
  check(await page.$eval('#todayview', e => !e.hidden), 'boots on the Today view');
  check(await page.$eval('#tbl', e => getComputedStyle(e).display === 'none'), 'the table is hidden behind it');
  check(await page.$eval('#todayTab', e => e.classList.contains('active')), '☀ Today tab is active');
  check(/^Today in /.test(await page.$eval('#tdTitle', e => e.textContent)), 'hero names the city');
  check(await page.evaluate(() => location.hash === ''), `default city keeps a clean URL (${await page.evaluate(() => location.hash)})`);
  await page.waitForTimeout(400);
  check(wxCalls >= 1 && /°F/.test(await page.$eval('#todayview', e => e.textContent)), 'weather appears when the API answers');
  check(await page.$$eval('#todayview [data-tf]', b => b.length) === 5, 'timeline filter chips render');

  // a card opens the item view, and Back returns to Today
  const ref = await page.$eval('#todayview [data-ref]', e => e.dataset.ref);
  await page.click('#todayview [data-ref]');
  await page.waitForSelector('#itemview:not([hidden]) #backBtn');
  check(/Today/.test(await page.$eval('#backBtn', e => e.textContent)), `item view offers "Back to Today" (${ref})`);
  await page.click('#backBtn');
  await page.waitForSelector('#todayview:not([hidden])');
  check(true, 'Back lands on Today again');

  // filter chips toggle without leaving the page
  await page.click('#todayview [data-tf="move"]');
  check(await page.$eval('#todayview [data-tf="move"]', e => e.getAttribute('aria-pressed')) === 'true', 'Active chip selects');

  // a list tab leaves Today; the Today tab comes back
  await page.click('#tabs .tab[data-tab="events"]');
  await page.waitForSelector('#tbody tr.rowmain');
  check(await page.$eval('#todayview', e => e.hidden), 'a list tab hides Today');
  await page.click('#todayTab');
  await page.waitForSelector('#todayview:not([hidden])');
  check(await page.$eval('#todayTab', e => e.classList.contains('active')), '☀ Today tab brings it back');

  // switching city opens the new city on Today
  await page.selectOption('#citySelect', 'nyc');
  await page.waitForFunction(() => /New York/.test(document.querySelector('#tdTitle')?.textContent || ''), null, { timeout: 15000 });
  check(await page.$eval('#todayview', e => !e.hidden), 'city switch lands on Today');
  check(await page.evaluate(() => location.hash === '#city=nyc'), 'Today hash carries only the city');

  // a deep link to a tab still goes straight to that list
  await page.goto(URL + 'index.html?x=1#city=nyc&tab=events', { waitUntil: 'networkidle' });
  await page.waitForSelector('#tbody tr.rowmain');
  check(await page.$eval('#todayview', e => e.hidden), 'deep link to a tab skips Today');

  // the checkbox turns the default off (and on again)
  await page.goto(URL + 'index.html?x=2', { waitUntil: 'networkidle' });
  await page.waitForSelector('#tdPref');
  await page.uncheck('#tdPref');
  await page.goto(URL + 'index.html?x=3', { waitUntil: 'networkidle' });
  await page.waitForSelector('#tbody tr.rowmain');
  check(await page.$eval('#todayview', e => e.hidden), 'with "Open on Today" off it opens on the lists');
  await page.click('#todayTab');
  await page.check('#tdPref');
  await page.goto(URL + 'index.html?x=4', { waitUntil: 'networkidle' });
  await page.waitForSelector('#todayview .tdhero');
  check(true, 'turning it back on restores Today');

  // mobile: the timeline still lays out
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(over <= 1, `no horizontal overflow at 390px (${over}px)`);

  check(errors.length === 0, `no page errors (got: ${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close(); done();
})();
