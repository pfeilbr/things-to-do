// Spec for the region-grouped city dropdown that replaced the two chip bars.
//
// The header is one row now: wordmark, city <select>, menu. The regions survive as
// <optgroup>s so every city is still reachable in two interactions, the selected city
// is the picker's visible label (#hPlace), and the choice persists across a reload.
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8931, URL = `http://localhost:${PORT}/`;

const REGIONS = ['HOME', 'NYC', 'EAST', 'GREAT LAKES', 'SOUTH', 'WEST'];

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'networkidle' });

  if (!(await page.$('#citySelect'))) { await browser.close(); server.close(); fatal('missing #citySelect — city dropdown not implemented'); }

  // --- the old chip bars are gone --------------------------------------------------
  check(await page.$('#regionbar') === null, 'the region chip bar is gone');
  check(await page.$('#citybar') === null, 'the city chip bar is gone');

  // --- regions survive as optgroups, in order --------------------------------------
  const groups = await page.$$eval('#citySelect optgroup', gs => gs.map(g => g.label));
  check(JSON.stringify(groups) === JSON.stringify(REGIONS), `6 optgroups in order (got ${groups.join(',')})`);

  // every city in CONFIG is selectable, exactly once
  const { optionCount, cityCount, missing } = await page.evaluate(() => {
    const opts = [...document.querySelectorAll('#citySelect option')].map(o => o.value);
    return {
      optionCount: opts.length,
      cityCount: CONFIG.cities.length,
      missing: CONFIG.cities.filter(c => !opts.includes(c.id)).map(c => c.id),
    };
  });
  check(missing.length === 0, `every CONFIG city is in the dropdown (missing: ${missing.join(',') || 'none'})`);
  check(optionCount === cityCount, `one option per city (${optionCount} options, ${cityCount} cities)`);

  // --- boot state -------------------------------------------------------------------
  check(await page.$eval('#citySelect', e => e.value) === 'philly', 'philly selected on boot');
  check((await page.$eval('#hPlace', e => e.textContent)).includes('Willow Grove'), 'picker label names the active city');

  // --- switching across a region boundary works in one interaction -------------------
  await page.selectOption('#citySelect', 'la');
  await page.waitForFunction(() => document.querySelector('#hPlace').textContent.includes('Los Angeles'), null, { timeout: 15000 });
  check(true, 'selecting LA switches the guide');
  check(await page.$eval('#citySelect', e => e.value) === 'la', 'the select reflects the active city');
  const tabs = await page.$$eval('#tabs .tab', els => els.length);
  check(tabs > 0, `tabs re-rendered for the new city (${tabs})`);

  // --- reload keeps it ---------------------------------------------------------------
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#hPlace').textContent.includes('Los Angeles'), null, { timeout: 15000 });
  check(await page.$eval('#citySelect', e => e.value) === 'la', 'LA persists across reload');

  // --- the header stays one row, and nothing overflows the phone ---------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  check(await page.$eval('.appbar', e => e.offsetHeight <= 60), 'app bar is a single compact row at 390px');
  check(await page.$eval('#citySelect', e => e.offsetWidth > 0 && e.offsetHeight > 0), 'city picker is usable at 390px');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal page scroll at 390px');
  // the origin control must stay reachable on a phone — it is how you re-centre the guide
  check(await page.$eval('#originBtn', e => e.offsetWidth > 0 && e.offsetHeight > 0), 'origin picker is visible at 390px');

  check(errors.length === 0, `no page errors (got: ${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.message));
