// Blocked storage: with site data blocked (or in some private modes) every localStorage
// access throws a SecurityError. The guide must still boot, and starring a row, picking
// a trip length or resetting the origin must not throw — they just won't persist.
const { serve, launch, check, done } = require('./_lib');
const PORT = 8971, URL = `http://localhost:${PORT}/`;

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('The operation is insecure.', 'SecurityError'); }
    });
  });

  await page.goto(URL);
  let rows = 0;
  try { await page.waitForSelector('#tbody tr.rowmain', { timeout: 10000 }); rows = await page.$$eval('#tbody tr.rowmain', x => x.length); } catch (e) {}
  check(rows > 0, `boots with storage blocked (${rows} rows)`);

  if (rows) {
    const before = await page.$eval('#tbody tr.rowmain .favbtn', b => b.getAttribute('aria-pressed') || b.textContent).catch(() => null);
    await page.click('#tbody tr.rowmain .favbtn').catch(() => {});
    await page.waitForTimeout(200);
    const after = await page.$eval('#tbody tr.rowmain .favbtn', b => b.getAttribute('aria-pressed') || b.textContent).catch(() => null);
    check(before !== null && before !== after, `starring a row still works in-session (${before} → ${after})`);
    // a city with a first-visit guide exercises the guide's own storage reads and writes
    await page.goto(URL + '?city=stamford');
    await page.waitForTimeout(1500);
    await page.click('#gSkip').catch(() => {});
    await page.waitForTimeout(300);
  }
  check(errors.length === 0, `no page errors (got: ${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close(); done();
})();
