// "☀ On today" on the When tabs (Events, Social, Meetup): a filter, not a sort. Pressed, the
// list keeps only rows whose `w` lands on today — an exact date, or a run whose start and end
// bracket today (happensToday). Its badge counts them, it shows up in the "clear:" button, it
// round-trips through the hash, and tabs without a When column never show it.
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8946, URL = `http://localhost:${PORT}/`;

const visible = (page, sel) => page.$eval(sel, e => !e.hidden && e.offsetHeight > 0).catch(() => false);

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(`${URL}#tab=events`, { waitUntil: 'networkidle' });
  if (!(await page.$('#todayBtn #todayCnt'))) { await browser.close(); server.close(); fatal('missing #todayCnt badge inside #todayBtn'); }
  check(await visible(page, '#todayBtn'), 'On today shows on Events');

  const want = await page.evaluate(() => DATA.events.filter(r => happensToday(r.w)).map(r => r.n).sort());
  const total = await page.evaluate(() => DATA.events.length);
  check((await page.$eval('#todayCnt', e => e.textContent.trim())) === String(want.length), `badge counts today's events (${want.length})`);

  // on: only today's rows, and they are exactly the happensToday set
  await page.click('#todayBtn');
  check(await page.$eval('#todayBtn', e => e.getAttribute('aria-pressed')) === 'true', 'button is pressed');
  const got = await page.evaluate(() => rows().map(r => r.n).sort());
  check(JSON.stringify(got) === JSON.stringify(want), `list is exactly today's events (${got.length} of ${total})`);
  check((await page.$eval('#showing', e => e.textContent)).includes(`showing ${want.length} of ${total}`), 'meta line reflects the filter');
  check((await page.evaluate(() => location.hash)).includes('now=1'), 'filter is in the hash');
  check((await page.$eval('#clearFilters', e => e.textContent).catch(() => '')).includes('on today'), 'clear button names it');

  // a multi-day run that spans today counts as on today; one that ended yesterday does not
  const spans = await page.evaluate(() => {
    const d = new Date(), md = x => `${x.getMonth() + 1}/${x.getDate()}`;
    const ago = new Date(d - 3 * 864e5), ahead = new Date(+d + 3 * 864e5), y = new Date(d - 864e5);
    return [happensToday(`${md(ago)} – ${md(ahead)}`), happensToday(`${md(ago)} – ${md(y)}`), happensToday(md(d))];
  });
  check(spans[0] && !spans[1] && spans[2], 'runs that bracket today match, past runs do not, exact dates match');

  // survives a reload from the deep link
  await page.goto(`${URL}#tab=events&now=1`, { waitUntil: 'networkidle' });
  check(await page.$eval('#todayBtn', e => e.getAttribute('aria-pressed')) === 'true', 'deep link restores the filter');
  check((await page.evaluate(() => rows().length)) === want.length, 'deep link shows the filtered list');

  // a tab without a When column hides the button and ignores the filter
  await page.click('.tab[data-tab="nightlife"]');
  check(!(await visible(page, '#todayBtn')), 'hidden on a tab with no When column');
  check((await page.evaluate(() => rows().length)) === (await page.evaluate(() => DATA.nightlife.length)), 'filter does not apply there');

  // clear: everything back
  await page.click('.tab[data-tab="events"]');
  await page.click('#clearFilters');
  check(await page.$eval('#todayBtn', e => e.getAttribute('aria-pressed')) === 'false', 'clear turns it off');
  check((await page.evaluate(() => rows().length)) === total, 'all events back after clear');

  check(errors.length === 0, `no page errors (${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.stack || e));
