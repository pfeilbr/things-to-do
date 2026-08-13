// TDD spec for Tonight mode (CONTRACTS §2).
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8932, URL = `http://localhost:${PORT}/`;

async function assertTonight(page, label) {
  const expected = await page.evaluate(() =>
    Object.values(DATA).flat().filter(r => r.w && happensToday(r.w)).length);
  const shown = await page.$$eval('#tbody tr.rowmain', els => els.length);
  check(shown === expected, `${label}: renders ${shown} rows == expected happensToday count ${expected}`);
  const showing = await page.$eval('#showing', e => e.textContent);
  check(/tonight/i.test(showing), `${label}: #showing mentions tonight ("${showing}")`);
  if (expected === 0) {
    check(await page.$eval('#empty', e => !e.hidden), `${label}: empty state visible when nothing tonight`);
  } else {
    const heads = await page.$$eval('#theadRow th', els => els.map(e => e.textContent.trim().split(' ')[0]));
    check(heads.includes('When'), `${label}: When column present (got ${heads.join(',')})`);
  }
  check((await page.$$('.tab.active')).length === 0, `${label}: no tab is active in tonight mode`);
  return expected;
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

  if (!(await page.$('#tonightBtn'))) { await browser.close(); server.close(); fatal('missing #tonightBtn — feature not implemented'); }
  check(await page.$eval('#tonightBtn', e => !e.hidden), 'tonight button visible');

  await page.click('#tonightBtn');
  await page.waitForTimeout(200);
  check(await page.$eval('#tonightBtn', e => e.getAttribute('aria-pressed')) === 'true', 'aria-pressed true when on');
  check(await page.evaluate(() => location.hash.includes('tonight=1')), 'hash carries tonight=1');
  const n1 = await assertTonight(page, 'philly');

  if (n1 > 0) { // expand first row -> detail panel
    await page.click('#tbody tr.rowmain');
    await page.waitForTimeout(150);
    check((await page.$$('tr.detail')).length === 1, 'row expands to detail panel in tonight mode');
    await page.click('#tbody tr.rowmain'); // collapse again
  }

  // exit via button: previous tab view restored
  await page.click('#tonightBtn');
  await page.waitForTimeout(200);
  check(await page.$eval('#tonightBtn', e => e.getAttribute('aria-pressed')) === 'false', 'aria-pressed false after toggle off');
  check((await page.$$('.tab.active')).length === 1, 'a tab is active again after exiting');
  check(!(await page.evaluate(() => location.hash.includes('tonight=1'))), 'tonight=1 removed from hash');

  // hash boot: #tonight=1
  await page.goto(URL + '#tonight=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  check(await page.$eval('#tonightBtn', e => e.getAttribute('aria-pressed')) === 'true', 'boots into tonight mode from #tonight=1');
  await assertTonight(page, 'hash-boot');

  // second city recompute: switch via localStorage (citybar may be region-grouped)
  await page.evaluate(() => localStorage.setItem('guide-city', 'nyc'));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#hPlace').textContent.includes('New York'), null, { timeout: 15000 });
  await page.click('#tonightBtn');
  await page.waitForTimeout(200);
  await assertTonight(page, 'nyc');

  // clicking a tab exits tonight mode
  await page.click('.tab');
  await page.waitForTimeout(150);
  check(await page.$eval('#tonightBtn', e => e.getAttribute('aria-pressed')) === 'false', 'clicking a tab exits tonight mode');
  check((await page.$$('.tab.active')).length === 1, 'clicked tab becomes active');

  check(errors.length === 0, `no page errors (got: ${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.message));
