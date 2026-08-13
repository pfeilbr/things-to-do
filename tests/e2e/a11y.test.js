// TDD spec for keyboard / a11y on expandable rows + control state attrs (CONTRACTS §6).
// Desktop only (1280px) — mobile cards are out of scope for this spec.
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8934, URL = `http://localhost:${PORT}/`;

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL, { waitUntil: 'networkidle' });
  try { await page.waitForSelector('#tbody tr.rowmain', { timeout: 15000 }); }
  catch { await browser.close(); server.close(); fatal('no #tbody tr.rowmain rendered — app failed to boot'); }

  // --- §6: every rowmain carries tabindex="0" + aria-expanded matching its detail state ---
  const auditRows = () => page.$$eval('#tbody tr.rowmain', els => ({
    total: els.length,
    tabbable: els.filter(e => e.getAttribute('tabindex') === '0').length,
    withExpanded: els.filter(e => ['true', 'false'].includes(e.getAttribute('aria-expanded'))).length,
    mismatched: els.filter(e => {
      const open = e.getAttribute('aria-expanded') === 'true';
      const det = !!(e.nextElementSibling && e.nextElementSibling.classList.contains('detail'));
      return open !== det;
    }).length,
  }));
  let audit = await auditRows();
  check(audit.total > 0, `rowmains rendered (${audit.total})`);
  check(audit.tabbable === audit.total, `every rowmain has tabindex="0" (${audit.tabbable}/${audit.total})`);
  check(audit.withExpanded === audit.total, `every rowmain has aria-expanded "true"/"false" (${audit.withExpanded}/${audit.total})`);
  check(audit.mismatched === 0, `aria-expanded matches detail state on every row (${audit.mismatched} mismatched)`);

  // --- §6: Enter expands / collapses the focused row ---
  // render() rebuilds #tbody on every toggle, so re-focus the (positionally stable)
  // first rowmain before each keypress instead of holding a stale element handle.
  const rowState = () => page.$eval('#tbody tr.rowmain', e => ({
    expanded: e.getAttribute('aria-expanded'),
    detail: !!(e.nextElementSibling && e.nextElementSibling.classList.contains('detail')),
  }));
  async function press(key) {
    await page.focus('#tbody tr.rowmain');
    await page.keyboard.press(key);
    await page.waitForTimeout(250);
  }

  await page.focus('#tbody tr.rowmain');
  check(await page.$eval('#tbody tr.rowmain', e => document.activeElement === e),
    'first rowmain is keyboard-focusable (receives focus)');

  await press('Enter');
  let st = await rowState();
  check(st.detail && st.expanded === 'true',
    `Enter expands: adjacent tr.detail + aria-expanded="true" (got detail=${st.detail}, aria-expanded=${st.expanded})`);
  await press('Enter');
  st = await rowState();
  check(!st.detail && st.expanded === 'false',
    `Enter again collapses (got detail=${st.detail}, aria-expanded=${st.expanded})`);

  // --- §6: Space toggles the same way and must NOT scroll the page ---
  const y0 = await page.evaluate(() => window.scrollY);
  await press('Space');
  st = await rowState();
  const y1 = await page.evaluate(() => window.scrollY);
  check(st.detail && st.expanded === 'true',
    `Space expands (got detail=${st.detail}, aria-expanded=${st.expanded})`);
  check(y1 === y0, `Space does not scroll the page (scrollY ${y0} → ${y1})`);
  await press('Space');
  st = await rowState();
  const y2 = await page.evaluate(() => window.scrollY);
  check(!st.detail && st.expanded === 'false',
    `Space again collapses (got detail=${st.detail}, aria-expanded=${st.expanded})`);
  check(y2 === y0, `page still unscrolled after second Space (scrollY ${y0} → ${y2})`);

  // full-table invariant still holds after keyboard toggling re-renders
  audit = await auditRows();
  check(audit.mismatched === 0 && audit.tabbable === audit.total,
    `attrs intact after keyboard toggles (${audit.mismatched} mismatched, ${audit.tabbable}/${audit.total} tabbable)`);

  // --- §6: named controls carry aria-pressed ---
  const ctl = await page.evaluate(ids => ids.map(id => {
    const el = document.getElementById(id);
    return { id, v: el ? el.getAttribute('aria-pressed') : '(missing element)' };
  }), ['tonightBtn', 'favToggle', 'mapToggle']);
  for (const { id, v } of ctl)
    check(v === 'true' || v === 'false', `#${id} has aria-pressed (got ${v})`);

  // --- §6: every regionchip/citychip carries aria-pressed ---
  const auditChips = () => page.evaluate(() => {
    const all = [...document.querySelectorAll('.regionchip, .citychip')];
    return { total: all.length, ok: all.filter(e => ['true', 'false'].includes(e.getAttribute('aria-pressed'))).length };
  });
  let chips = await auditChips();
  check(chips.total > 0, `region/city chips rendered (${chips.total})`);
  check(chips.ok === chips.total, `every chip has aria-pressed on boot (${chips.ok}/${chips.total})`);
  // chips re-rendered by a region switch keep the attribute
  if (await page.$('.regionchip[data-region="WEST"]')) {
    await page.click('.regionchip[data-region="WEST"]');
    await page.waitForTimeout(200);
    chips = await auditChips();
    check(chips.ok === chips.total, `every chip still has aria-pressed after region switch (${chips.ok}/${chips.total})`);
  } else {
    check(false, 'WEST regionchip present for re-render chip audit');
  }

  check(errors.length === 0, `no page errors (got: ${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.message));
