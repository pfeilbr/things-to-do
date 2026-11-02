// Train board ("🚆 To NYC"). A city whose CONFIG entry names a `transit` timetable gets a
// tab with the next trains to the hub, live-adjusted from the GTFS-realtime feed, and a
// slim "next train" strip above every list. The clock is frozen on the timetable's first
// day and the live feed is a synthetic protobuf, so this runs without the network.
const fs = require('fs'), path = require('path');
const { serve, launch, check, fatal, done, ROOT } = require('./_lib');
const { loadCore } = require('../unit/extract');
const { buildFeed } = require('../fixtures/gtfsrt');
const PORT = 8943, URL = `http://localhost:${PORT}/`;

const visible = (page, sel) => page.$eval(sel, e => !e.hidden && e.offsetHeight > 0).catch(() => false);
const text = (page, sel) => page.$eval(sel, e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const city = await (async () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const m = html.match(/\{ id:"(\w+)",[^{}]*?transit:"(transit-[^"]+\.json)"/);
    return m && { id: m[1], file: m[2] };
  })();
  if (!city) { await browser.close(); server.close(); fatal('no city has a transit timetable'); }
  const T = JSON.parse(fs.readFileSync(path.join(ROOT, city.file), 'utf8'));
  const { nyMs, trainRuns, fmtClock, nyClock } = loadCore();

  // 7:30a New York on the timetable's first day; the next train from the first home station
  const now = nyMs(T.days[0], 7 * 60 + 30);
  const runs = trainRuns(T, 0, 0, 1).filter(r => r.depMs >= now);
  if (runs.length < 3) { await browser.close(); server.close(); fatal('not enough morning trains in the fixture day'); }
  const [first, second] = runs;
  const hubId = T.stops[T.stops.length - 1].id, homeId = T.stops[0].id;
  // live: the first train runs 6 min late on track 3; the second is cancelled
  let feedMode = 'ok';
  await page.route(/api-endpoint\.mta\.info/, route => {
    if (feedMode === 'down') return route.abort();
    route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: buildFeed({ ts: Math.floor(now / 1000), trains: [
      { num: first.num, date: T.days[0], stops: [
        { id: homeId, t: Math.floor(first.depMs / 1000) + 360, track: '3', status: 'Late' },
        { id: hubId, t: Math.floor(first.arrMs / 1000) + 360, status: 'Late' }] },
      { num: second.num, date: T.days[0], cancelled: true, stops: [{ id: homeId, t: Math.floor(second.depMs / 1000) }] },
    ] }) });
  });
  await page.clock.setFixedTime(new Date(now));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());

  // a city without a timetable: no train tab, no strip
  check(!(await page.$('#transitTab')), 'default city has no train tab');
  check(!(await visible(page, '#trainStrip')), 'default city has no train strip');

  // deep link straight to the board
  await page.goto(`${URL}#city=${city.id}&train=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#transitview .thero');
  check(await visible(page, '#transitview'), 'train=1 opens the board');
  check(await page.$eval('#transitTab', e => e.classList.contains('active')), 'train tab is active');
  check(!(await visible(page, '#tbl')) && !(await visible(page, '.controls')), 'lists hidden behind the board');
  check(!(await visible(page, '#trainStrip')), 'strip hidden on the board itself');
  await page.waitForSelector('.tlive.on', { timeout: 10000 });
  check((await text(page, '.tclock')).includes(fmtClock(7 * 60 + 30)), 'shows the New York time');

  const next = await text(page, '.tnext');
  check(next.includes('#' + first.num), `next train is #${first.num}`);
  check(next.includes('6 min late'), 'live delay shown');
  check(next.includes(fmtClock(nyClock(first.depMs + 360000).min)), 'live departure time replaces the timetable');
  check(next.includes('track 3'), 'live track shown');
  // bikes follow their own rush windows: a weekday train reaching the hub 6–10 AM carries none
  const dow = new Date(T.days[0].replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3T12:00:00Z')).getUTCDay();
  const hasBikeRules = await page.evaluate(() => !!(GUIDE && GUIDE.transit && GUIDE.transit.bike));
  if (hasBikeRules && dow >= 1 && dow <= 5 && first.arr >= 360 && first.arr <= 600)
    check(next.includes('🚲 no'), 'weekday rush train is marked no-bike');
  if (hasBikeRules) {
    await page.selectOption('#tDay', String([...Array(7).keys()].find(i => {
      const d = new Date(T.days[0].replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3T12:00:00Z')); d.setUTCDate(d.getUTCDate() + i);
      return d.getUTCDay() === 6;
    })));
    check((await text(page, '.tboard')).includes('🚲 OK'), 'Saturday trains take bikes');
    await page.selectOption('#tDay', '0');
  }
  const board = await text(page, '.tboard');
  check(board.includes('Cancelled'), 'cancelled train flagged on the board');
  check(!board.includes('#' + first.num), 'board starts after the next train');

  // station, direction, destination
  const stn = T.stops[T.home.length - 1];
  await page.click(`[data-tstn="${stn.k}"]`);
  check((await text(page, '#tTitle')).startsWith(stn.n), `station switch → ${stn.n}`);
  check(await page.evaluate(k => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(x => x.endsWith('-train')))).stn === k, stn.k), 'station choice persists');
  await page.click('[data-tdir="0"]');
  check((await text(page, '#tTitle')).endsWith(stn.n) && (await text(page, '#tTitle')).startsWith(T.stops[T.stops.length - 1].n), 'direction flips to the ride home');
  await page.click('[data-tdir="1"]');
  const dests = await page.$$eval('[data-tdest]', els => els.map(e => e.dataset.tdest));
  if (dests.length > 1) {
    await page.click(`[data-tdest="${dests[1]}"]`);
    check((await text(page, '#tTitle')).includes(await page.$eval(`[data-tdest="${dests[1]}"]`, e => e.textContent)), 'destination switch retitles the board');
  }

  // a later day lists that day's trains from the first one
  await page.selectOption('#tDay', '1');
  check((await text(page, '.tnl')) === 'First train', 'tomorrow shows the first train');
  check(await page.$$eval('.tboard .trun', els => els.length) > 10, 'tomorrow lists the whole day');

  // the strip on the lists, and back
  await page.click('.tab[data-tab="spots"]');
  check(await visible(page, '#trainStrip'), 'strip shows above the lists');
  check((await text(page, '#trainStrip')).includes('Next to'), 'strip names the next train');
  await page.click('#trainStrip');
  check(await visible(page, '#transitview'), 'strip opens the board');
  check((await page.evaluate(() => location.hash)).includes('train=1'), 'board is deep-linkable');

  // live feed down: the timetable still works and says so
  feedMode = 'down';
  await page.evaluate(() => fetchLive(true));
  await page.waitForSelector('.tlive.off');
  check(await page.$$eval('.tboard .trun', els => els.length) > 0, 'timetable still shown without the live feed');

  // phone width: no sideways scroll
  await page.setViewportSize({ width: 375, height: 812 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll at 375px');

  check(errors.length === 0, `no page errors (${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.stack || e));
