// TDD spec for trip-from-home notes (CONTRACTS §7).
// Every non-HOME CONFIG city carries a `trip` string. Since the header became a single
// app bar the note sits in the meta line beside the origin picker — distance context
// next to the distances — hidden/empty for philly, showing exactly CITY.trip for every
// other active city, and persisting across reloads.
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8935, URL = `http://localhost:${PORT}/`;

// Switch city through the region-grouped dropdown.
async function goCity(page, region, id, placeShort) {
  await page.selectOption('#citySelect', id);
  await page.waitForFunction(
    ps => document.querySelector('#hPlace').textContent.includes(ps),
    placeShort, { timeout: 15000 });
}

const tripText = page => page.$eval('#tripNote', e => e.textContent.trim());
const tripVisible = page => page.$eval('#tripNote', e => e.offsetWidth > 0 && e.offsetHeight > 0);
const cfgTrip = (page, id) => page.evaluate(cid => CONFIG.cities.find(c => c.id === cid).trip, id);

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'networkidle' });

  if (!(await page.$('#tripNote'))) { await browser.close(); server.close(); fatal('missing #tripNote — feature not implemented'); }

  // placement: in the meta line, alongside the origin picker
  check(await page.evaluate(() => {
    const t = document.querySelector('#tripNote');
    return !!t.closest('.meta-line') && !!t.parentElement.querySelector('#originBtn');
  }), '#tripNote sits in the meta line next to the origin picker');

  // every non-HOME city entry carries a non-empty trip string; philly does not need one
  const missing = await page.evaluate(() =>
    CONFIG.cities.filter(c => c.id !== 'philly' && !(typeof c.trip === 'string' && c.trip.trim().length)).map(c => c.id));
  check(missing.length === 0, `every non-philly city has a trip string (missing: ${missing.join(',') || 'none'})`);

  // boot (philly): hidden or empty
  check(!(await tripVisible(page)) || (await tripText(page)) === '', 'tripNote hidden/empty for philly on boot');

  // switch to a NYC-region city → visible, contains "hr", shows exactly CITY.trip
  await goCity(page, 'NYC', 'nyc', 'New York City');
  check(await tripVisible(page), 'tripNote visible for nyc');
  const nycTrip = await tripText(page);
  check(/hr/.test(nycTrip), `nyc trip mentions "hr" (got "${nycTrip}")`);
  check(nycTrip === (await cfgTrip(page, 'nyc')), 'nyc tripNote text equals CONFIG trip exactly');

  // switch to a city in another region → text changes to that city's trip
  await goCity(page, 'EAST', 'baltimore', 'Baltimore');
  check(await tripVisible(page), 'tripNote visible for baltimore');
  const balTrip = await tripText(page);
  check(balTrip !== nycTrip, 'tripNote text changed after switching regions');
  check(balTrip === (await cfgTrip(page, 'baltimore')), 'baltimore tripNote text equals CONFIG trip exactly');

  // reload → persists with the active city
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#hPlace').textContent.includes('Baltimore'), null, { timeout: 15000 });
  check(await tripVisible(page), 'tripNote still visible after reload');
  check((await tripText(page)) === (await cfgTrip(page, 'baltimore')), 'baltimore trip persists across reload');

  // and back home: philly hides/empties it again
  await goCity(page, 'HOME', 'philly', 'Willow Grove');
  check(!(await tripVisible(page)) || (await tripText(page)) === '', 'tripNote hidden/empty again after returning to philly');

  check(errors.length === 0, `no page errors (got: ${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.message));
