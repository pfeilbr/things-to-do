// "Add to calendar" (📅 in the When column, cal.js). Clicking it opens a two-item menu without
// expanding the row: a prefilled Google Calendar link and an .ics download (Apple / Outlook)
// holding the event's dates, times, summary and place. Esc and outside clicks close it.
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8947, BASE = `http://localhost:${PORT}/`;

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(`${BASE}#tab=events`, { waitUntil: 'networkidle' });
  const btns = await page.$$('#tbody .calbtn');
  check(btns.length > 0, `events carry calendar buttons (${btns.length})`);
  const inWhen = await page.$eval('#tbody .calbtn', b => !!b.closest('.when'));
  check(inWhen, 'the button sits in the When column');

  // the first row whose plan is a single timed date, so the link's dates are predictable
  const pick = await page.evaluate(() => {
    for (const b of document.querySelectorAll('#tbody .calbtn')) {
      const r = CALROWS.get(b.dataset.cal), p = calPlan(r.w, new Date());
      if (p && p.tm && p.occ.length === 1 && !p.rrule) { b.id = 'pickCal'; return { n: r.n, w: r.w, ll: r.ll }; }
    }
    return null;
  });
  if (!pick) { await browser.close(); server.close(); fatal('no single timed event to test with'); }

  await page.click('#pickCal');
  check(await page.$eval('#pickCal', b => b.getAttribute('aria-expanded')) === 'true', 'button reports the menu open');
  check(await page.$$eval('#tbody tr.detail', d => d.length) === 0, 'clicking it does not expand the row');
  const items = await page.$$eval('.calmenu [role=menuitem]', els => els.map(e => e.textContent.trim()));
  check(items.length === 2 && /Google/.test(items[0]) && /\.ics/.test(items[1]), `menu offers Google and .ics (${items.join(' | ')})`);
  check(await page.evaluate(() => document.activeElement.closest('.calmenu') != null), 'focus moves into the menu');

  const href = await page.$eval('.calmenu a', a => a.href);
  const u = new URL(href);
  check(u.hostname === 'calendar.google.com' && u.searchParams.get('action') === 'TEMPLATE', 'Google link is a prefilled event');
  check(u.searchParams.get('text') === await page.evaluate(n => calText(n), pick.n), 'Google link carries the title');
  check(/^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/.test(u.searchParams.get('dates') || ''), `Google link has UTC start/end (${u.searchParams.get('dates')})`);
  check((u.searchParams.get('details') || '').includes(`When: `), 'Google link carries the details');
  check(u.searchParams.get('location') === `${pick.ll[0]},${pick.ll[1]}`, 'Google link carries the place');
  check(await page.$eval('.calmenu a', a => a.target === '_blank' && /noopener/.test(a.rel)), 'opens in a new tab with noopener');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.calmenu [data-ics]')]);
  check(dl.suggestedFilename().endsWith('.ics'), `downloads an .ics (${dl.suggestedFilename()})`);
  const ics = require('node:fs').readFileSync(await dl.path(), 'utf8').replace(/\r\n /g, '');
  check(ics.startsWith('BEGIN:VCALENDAR') && /BEGIN:VEVENT[\s\S]*END:VEVENT/.test(ics), '.ics holds a VEVENT');
  check(ics.includes(`DTSTART:${u.searchParams.get('dates').split('/')[0]}`), '.ics start matches the Google link');
  check(/SUMMARY:.+/.test(ics) && /DESCRIPTION:.+/.test(ics) && /GEO:/.test(ics), '.ics carries summary, description, place');
  await page.waitForTimeout(50);
  check(!(await page.$('.calmenu')), 'menu closes after choosing');

  // Esc and outside clicks close it; Enter on the button doesn't toggle the row
  await page.click('#pickCal');
  await page.keyboard.press('Escape');
  check(!(await page.$('.calmenu')), 'Esc closes the menu');
  check(await page.evaluate(() => document.activeElement.id === 'pickCal'), 'focus returns to the button');
  await page.keyboard.press('Enter');
  check(!!(await page.$('.calmenu')) && await page.$$eval('#tbody tr.detail', d => d.length) === 0, 'Enter opens it without expanding the row');
  await page.mouse.click(5, 880);
  check(!(await page.$('.calmenu')), 'outside click closes the menu');

  // recurring series in Social get one too, with a recurrence rule
  await page.click('.tab[data-tab="social"]');
  const rec = await page.evaluate(() => {
    const b = [...document.querySelectorAll('#tbody .calbtn')].find(b => calPlan(CALROWS.get(b.dataset.cal).w, new Date()).rrule);
    if (b) b.id = 'recCal';
    return !!b;
  });
  check(rec, 'recurring social rows carry the button');
  if (rec) {
    await page.click('#recCal');
    check(/^RRULE:FREQ=(WEEKLY|MONTHLY);BYDAY=/.test(new URL(await page.$eval('.calmenu a', a => a.href)).searchParams.get('recur') || ''), 'Google link repeats the series');
    await page.keyboard.press('Escape');
  }

  // a tab without a When column has no buttons; phone cards carry them too
  await page.click('.tab[data-tab="nightlife"]');
  check((await page.$$('.calbtn')).length === 0, 'no buttons without a When column');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.click('.tab[data-tab="events"]');
  check((await page.$$('#cards .calbtn')).length > 0, 'mobile cards carry the button');

  check(errors.length === 0, `no page errors (${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.stack || e));
