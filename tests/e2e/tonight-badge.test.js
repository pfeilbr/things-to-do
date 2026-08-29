// TDD spec for the Tonight count badge (CONTRACTS §8).
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8936, URL = `http://localhost:${PORT}/`;

// In-page expected count: rows across the ACTIVE city's tabs with w && happensToday(w).
function expectedCount(page) {
  return page.evaluate(() =>
    Object.values(DATA).flat().filter(r => r.w && happensToday(r.w)).length);
}

async function badgeText(page) {
  return (await page.$eval('#tonightCnt', e => e.textContent)).trim();
}

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'networkidle' });

  if (!(await page.$('#tonightBtn'))) { await browser.close(); server.close(); fatal('missing #tonightBtn — tonight mode not implemented'); }
  if (!(await page.$('#tonightCnt'))) { await browser.close(); server.close(); fatal('missing #tonightCnt — badge not implemented'); }

  // badge markup: <span id="tonightCnt" class="cnt"> INSIDE #tonightBtn
  check(!!(await page.$('#tonightBtn span#tonightCnt')), 'badge is a <span> inside #tonightBtn');
  check(await page.$eval('#tonightCnt', e => e.classList.contains('cnt')), 'badge carries class "cnt"');

  // boot: badge equals the in-page computed count (0 must render as "0")
  const expPhilly = await expectedCount(page);
  let txt = await badgeText(page);
  check(txt === String(expPhilly), `boot (philly): badge "${txt}" == expected count ${expPhilly}`);

  // switch to a city in a DIFFERENT region — one interaction through the dropdown
  await page.selectOption('#citySelect', 'nyc');
  await page.waitForFunction(() => document.querySelector('#hPlace').textContent.includes('New York'), null, { timeout: 15000 });
  await page.waitForTimeout(200);
  const expNyc = await expectedCount(page);
  txt = await badgeText(page);
  check(txt === String(expNyc), `after city switch (nyc): badge "${txt}" == expected count ${expNyc}`);
  console.log(`  info: philly count ${expPhilly}, nyc count ${expNyc}`);

  // toggling tonight mode ON does not change the badge...
  await page.click('#tonightBtn');
  await page.waitForTimeout(200);
  check(await page.$eval('#tonightBtn', e => e.getAttribute('aria-pressed')) === 'true', 'tonight mode toggled on');
  txt = await badgeText(page);
  check(txt === String(expNyc), `badge unchanged while tonight mode is ON ("${txt}")`);

  // ...and neither does toggling it back OFF
  await page.click('#tonightBtn');
  await page.waitForTimeout(200);
  check(await page.$eval('#tonightBtn', e => e.getAttribute('aria-pressed')) === 'false', 'tonight mode toggled back off');
  txt = await badgeText(page);
  check(txt === String(expNyc), `badge unchanged after tonight mode toggled back off ("${txt}")`);

  check(errors.length === 0, `no page errors (got: ${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.message));
