// TDD spec for the fixed back-to-top button (CONTRACTS §11).
// #toTop: fixed, bottom-right, aria-label "Back to top"; hidden while
// scrollY <= 600, visible beyond; click returns to top (scrollY < 50) and hides.
// Runs the same scenario at 1280px (desktop table) and 390px (mobile cards).
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8939, URL = `http://localhost:${PORT}/`;

// Visibility predicate as a string expression so it works in both
// page.evaluate and page.waitForFunction. Tolerant of display/visibility/
// opacity-based show-hide implementations.
const VISIBLE = `(() => {
  const el = document.getElementById('toTop');
  if (!el) return false;
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  return cs.display !== 'none' && cs.visibility !== 'hidden'
    && parseFloat(cs.opacity) > 0.1 && r.width > 0 && r.height > 0;
})()`;
const HIDDEN = `!${VISIBLE}`;

async function scrollAndPing(page, y) {
  // drive scrolling explicitly and dispatch a scroll event so listener-based
  // implementations react even if the programmatic scroll coalesces events
  await page.evaluate(t => { window.scrollTo(0, t); window.dispatchEvent(new Event('scroll')); }, y);
  await page.waitForTimeout(300);
}

async function scenario(browser, width, height) {
  console.log(`--- viewport ${width}x${height} ---`);
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'networkidle' });
  // below 760px the table is display:none and rows render as #cards .card
  const rowSel = width <= 760 ? '#cards .card' : '#tbody tr.rowmain';
  try { await page.waitForSelector(rowSel, { timeout: 15000 }); }
  catch {
    check(false, `app booted at ${width}px (${rowSel} rendered)`);
    await page.close(); return;
  }

  // --- §11: the button exists at all ---
  if (!await page.$('#toTop')) {
    check(false, `#toTop button exists in the DOM at ${width}px`);
    console.log(`  (skipping remaining §11 checks at ${width}px — no #toTop)`);
    await page.close(); return;
  }
  check(true, `#toTop button exists in the DOM at ${width}px`);

  const meta = await page.evaluate(() => {
    const el = document.getElementById('toTop'), cs = getComputedStyle(el);
    return { aria: el.getAttribute('aria-label'), position: cs.position };
  });
  check(meta.aria === 'Back to top', `#toTop aria-label is "Back to top" (got ${JSON.stringify(meta.aria)})`);
  check(meta.position === 'fixed', `#toTop is position:fixed (got ${meta.position})`);

  // --- §11: hidden while scrollY <= 600 ---
  await scrollAndPing(page, 0);
  check(await page.evaluate(HIDDEN), `#toTop hidden at scrollY=0 (${width}px)`);
  await scrollAndPing(page, 300);
  check(await page.evaluate(HIDDEN), `#toTop still hidden at scrollY=300, below the 600px threshold (${width}px)`);

  // --- §11: visible after a deep scroll ---
  await scrollAndPing(page, 5000);
  const deepY = await page.evaluate(() => window.scrollY);
  check(deepY > 600, `page long enough — scrollY beyond 600 after scrollTo(0,5000) (got ${deepY})`);
  let visible = true;
  try { await page.waitForFunction(VISIBLE, { timeout: 5000 }); }
  catch { visible = false; }
  check(visible, `#toTop visible after scrolling deep (${width}px)`);

  if (visible) {
    // bottom-right, fully inside the viewport
    const r = await page.$eval('#toTop', el => {
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
    });
    const inView = r.x >= 0 && r.y >= 0 && r.right <= width + 1 && r.bottom <= height + 1;
    check(inView, `#toTop inside the ${width}x${height} viewport (rect ${Math.round(r.x)},${Math.round(r.y)}→${Math.round(r.right)},${Math.round(r.bottom)})`);
    check(r.cx > width / 2 && r.cy > height / 2,
      `#toTop anchored bottom-right (center ${Math.round(r.cx)},${Math.round(r.cy)} in ${width}x${height})`);
  }

  // --- §11: click scrolls back to top... ---
  try {
    await page.click('#toTop', { timeout: 5000 });
    await page.waitForFunction(() => window.scrollY < 50, { timeout: 8000 }); // tolerate smooth scroll
    check(true, `clicking #toTop returns to top, scrollY < 50 (${width}px)`);
  } catch (e) {
    check(false, `clicking #toTop returns to top, scrollY < 50 (${width}px) — ${e.message.split('\n')[0]}`);
  }

  // --- §11: ...and it hides again ---
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
  let hidden = true;
  try { await page.waitForFunction(HIDDEN, { timeout: 5000 }); }
  catch { hidden = false; }
  check(hidden, `#toTop hidden again once back at top (${width}px)`);

  check(errors.length === 0, `no page errors at ${width}px (got: ${errors.join(' | ') || 'none'})`);
  await page.close();
}

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  await scenario(browser, 1280, 900); // desktop table layout
  await scenario(browser, 390, 844);  // mobile card layout
  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.message));
