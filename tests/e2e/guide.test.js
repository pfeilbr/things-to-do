// First-visit guide ("✦ Start here"). A city whose CONFIG entry names a guide opens on an
// interest picker the first time; after "Build my guide" it shows the plan and picks, the
// interests reshape both, a pick opens the item view with a way back, and the second
// visit lands on the lists. Cities without a guide never show any of it.
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8941, URL = `http://localhost:${PORT}/`;

const visible = (page, sel) => page.$eval(sel, e => !e.hidden && e.offsetHeight > 0).catch(() => false);

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());

  const guided = await page.evaluate(() => CONFIG.cities.filter(c => c.guide).map(c => c.id));
  if (!guided.length) { await browser.close(); server.close(); fatal('no city has a guide'); }
  const city = guided[0];

  // a city without a guide: no Start-here tab, lists as before
  check(!(await page.$('#guideTab')), 'default city has no guide tab');
  check(!(await visible(page, '#guideview')), 'default city boots on the lists');

  // first visit to the guided city: onboarding
  await page.goto(`${URL}#city=${city}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#guideview .gonb', { timeout: 15000 });
  check(await visible(page, '#guideview'), 'first visit opens the guide');
  check(!(await visible(page, '#tbl')) && !(await visible(page, '.controls')), 'table and controls hidden behind the guide');
  check(await page.$eval('#guideTab', e => e.classList.contains('active')), 'Start here tab is active');
  const chips = await page.$$eval('.gonb .gint', els => els.length);
  check(chips >= 6, `onboarding offers interests (${chips})`);
  check(await page.$$eval('.gonb .gint[aria-pressed="true"]', els => els.length) === chips, 'all interests start on');

  // turn one interest off, pick a day trip, build
  await page.click('.gonb .gint[data-int="sushi"]');
  await page.click('.gonb [data-trip="day"]');
  check(await page.$eval('.gonb .gint[data-int="sushi"]', e => e.getAttribute('aria-pressed')) === 'false', 'toggling a chip turns it off');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('guide-interests')).includes('sushi')) === false, 'interests persist globally');
  await page.click('#gBuild');
  await page.waitForSelector('#guideview .ghero:not(.gonb)');
  check(await page.$$eval('.gday', els => els.length) === 1, 'day trip shows one plan day');
  check(await page.$$eval('.gstop', els => els.length) >= 3, 'plan has stops');
  check(!(await page.$('.gblock .gbh [data-gotab="eats"]')), 'no sushi block when sushi is off');
  check(await page.$$eval('.gcard', els => els.length) >= 6, 'picks render as cards');

  // weekend → two days; sushi back on → its block appears
  await page.click('.gprefs [data-trip="weekend"]');
  check(await page.$$eval('.gday', els => els.length) === 2, 'weekend shows two plan days');
  await page.click('.gprefs .gint[data-int="sushi"]');
  check(!!(await page.$('.gblock [data-gotab="eats"]')), 'sushi block returns when sushi is on');

  // every card resolves to a real row (refs are live)
  const unresolved = await page.evaluate(() =>
    [...document.querySelectorAll('#guideview [data-ref]')].map(e => e.dataset.ref).filter(r => !guideRow(r)));
  check(unresolved.length === 0, `every guide card resolves (${unresolved.join(', ') || 'all ok'})`);

  // open a pick → item view → back to the guide
  const name = await page.$eval('.gcard h4', e => e.textContent);
  await page.click('.gcard');
  await page.waitForSelector('#itemview:not([hidden]) h2');
  check((await page.$eval('#itemview h2', e => e.textContent)).includes(name), 'pick opens its item view');
  check((await page.$eval('#backBtn', e => e.textContent)).includes('guide'), 'back button returns to the guide');
  await page.click('#backBtn');
  check(await visible(page, '#guideview'), 'back lands on the guide');

  // "All N →" jumps to that tab
  await page.click('.gblock [data-gotab="eats"]');
  check(await visible(page, '#tbl') && !(await visible(page, '#guideview')), 'All → opens the list');
  check(await page.$eval('.tab[data-tab="eats"]', e => e.classList.contains('active')), 'that tab is active');

  // second visit: straight to the lists, guide still one click away
  await page.goto(`${URL}#city=${city}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#guideTab');
  check(!(await visible(page, '#guideview')), 'second visit opens the lists');
  await page.click('#guideTab');
  check(await visible(page, '#guideview .ghero'), 'Start here reopens the guide');
  check((await page.evaluate(() => location.hash)).includes('guide=1'), 'guide is deep-linkable');

  // phone width: no horizontal page scroll in the guide
  await page.setViewportSize({ width: 375, height: 812 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll at 375px');

  check(errors.length === 0, `no page errors (${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.stack || e));
