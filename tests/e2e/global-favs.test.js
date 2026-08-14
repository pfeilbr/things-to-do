// TDD spec for global favorites across cities (CONTRACTS §13).
//
// Favorites are stored per city in localStorage under `<ns>-favs` (see skey() in
// index.html) as a JSON array of ROW KEYS, each `"<tabKey>|<row name>"` (see rkey()).
// Seeded here: wg-favs (philly, tab "attractions"), nyc-favs and sea-favs
// (tab "spots" — the first tab of every non-philly city).
const { serve, launch, check, fatal, done } = require('./_lib');
const PORT = 8952, URL = `http://localhost:${PORT}/`;

const PHILLY_FAV = 'Willow Grove Park Mall';   // data.json      -> attractions
const NYC_FAV = 'The High Line';               // data-nyc.json  -> spots
const SEA_FAV = 'Space Needle';                // data-seattle.json -> spots

const SEED = {
  'guide-city': 'philly',
  'wg-favs': JSON.stringify([`attractions|${PHILLY_FAV}`]),
  'nyc-favs': JSON.stringify([`spots|${NYC_FAV}`]),
  'sea-favs': JSON.stringify([`spots|${SEA_FAV}`]),
};

// visible = present in the DOM, not [hidden], and actually laid out
const VISIBLE = sel => {
  const e = document.querySelector(sel);
  if (!e) return false;
  if (e.hidden) return false;
  const st = getComputedStyle(e);
  if (st.display === 'none' || st.visibility === 'hidden') return false;
  return e.getClientRects().length > 0;
};

async function seed(page, kv) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(pairs => {
    localStorage.clear();
    for (const [k, v] of Object.entries(pairs)) localStorage.setItem(k, v);
  }, kv);
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#tbody tr.rowmain', { timeout: 15000 });
}

const names = page => page.$$eval('#tbody tr.rowmain', els => els.map(e => e.textContent));

(async () => {
  const server = await serve(PORT);
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // ---- scenario A: favorites in philly (active) + nyc + seattle ------------------------
  await seed(page, SEED);
  check(await page.evaluate(() => localStorage.getItem('guide-city')) === 'philly', 'boots into philly with seeded favorites');

  await page.click('#favToggle');
  await page.waitForTimeout(400);
  check(await page.$eval('#favToggle', e => e.getAttribute('aria-pressed')) === 'true', '★ Favs is pressed');

  const shown = await names(page);
  check(shown.length === 1 && shown[0].includes(PHILLY_FAV),
    `active-city favorite renders in the table (got ${shown.length} row(s): ${shown.map(t => t.trim().slice(0, 40)).join(' | ') || 'none'})`);

  const hasGlobal = !!(await page.$('#globalFavs'));
  check(hasGlobal, '#globalFavs element exists while ★ Favs is on with out-of-city favorites');
  check(hasGlobal && await page.evaluate(VISIBLE, '#globalFavs'), '#globalFavs is visible');

  const gfavs = await page.$$eval('.gfav', els => els.map(e => ({ city: e.dataset.city, text: e.textContent })));
  check(gfavs.length === 2, `two .gfav items — one per out-of-city favorite (got ${gfavs.length})`);
  const cities = gfavs.map(g => g.city).sort();
  check(JSON.stringify(cities) === JSON.stringify(['nyc', 'seattle']),
    `.gfav data-city values are nyc + seattle (got ${cities.join(',') || 'none'})`);
  const allText = gfavs.map(g => g.text).join(' ');
  check(allText.includes(NYC_FAV), `.gfav list names the NYC favorite "${NYC_FAV}"`);
  check(allText.includes(SEA_FAV), `.gfav list names the Seattle favorite "${SEA_FAV}"`);
  check(/new york|nyc/i.test(allText), '.gfav list carries a NYC city label');
  check(/seattle/i.test(allText), '.gfav list carries a Seattle city label');

  // ---- clicking a .gfav switches city, keeps ★ Favs on ---------------------------------
  if (await page.$('.gfav[data-city="seattle"]')) {
    await page.click('.gfav[data-city="seattle"]');
    let switched = true;
    try {
      await page.waitForFunction(() => localStorage.getItem('guide-city') === 'seattle', null, { timeout: 15000 });
    } catch (e) { switched = false; }
    check(switched, 'clicking the Seattle .gfav makes seattle the active city (localStorage guide-city)');
    await page.waitForTimeout(600);
    check(await page.$eval('#hPlace', e => e.textContent).catch(() => '') === 'Seattle', 'header place shows Seattle after the jump');
    check(await page.$eval('#favToggle', e => e.getAttribute('aria-pressed')) === 'true', '★ Favs stays pressed after the jump');
    const seaRows = await names(page);
    check(seaRows.length === 1 && seaRows[0].includes(SEA_FAV),
      `Seattle favorite "${SEA_FAV}" renders after the jump (got ${seaRows.length} row(s): ${seaRows.map(t => t.trim().slice(0, 40)).join(' | ') || 'none'})`);
    const after = await page.$$eval('.gfav', els => els.map(e => e.dataset.city).sort());
    check(JSON.stringify(after) === JSON.stringify(['nyc', 'philly']),
      `#globalFavs now lists the other cities' favorites: philly + nyc (got ${after.join(',') || 'none'})`);
  } else {
    check(false, 'clicking the Seattle .gfav switches city — SKIPPED, no .gfav[data-city="seattle"] rendered');
  }

  // ---- ★ Favs off hides the global list ------------------------------------------------
  await page.click('#favToggle');
  await page.waitForTimeout(300);
  check(await page.$eval('#favToggle', e => e.getAttribute('aria-pressed')) === 'false', '★ Favs toggles back off');
  check(!(await page.evaluate(VISIBLE, '#globalFavs')), '#globalFavs hidden when ★ Favs is off');

  // ---- scenario B: only active-city favorites -> no global list -------------------------
  await seed(page, { 'guide-city': 'philly', 'wg-favs': SEED['wg-favs'] });
  await page.click('#favToggle');
  await page.waitForTimeout(400);
  const onlyLocal = await names(page);
  check(onlyLocal.length === 1 && onlyLocal[0].includes(PHILLY_FAV), 'philly-only favorites still filter the table');
  check(!(await page.evaluate(VISIBLE, '#globalFavs')), '#globalFavs hidden when there are no out-of-city favorites');
  check((await page.$$('.gfav')).length === 0, 'no .gfav items when there are no out-of-city favorites');

  check(errors.length === 0, `no page errors (got: ${errors.join(' | ') || 'none'})`);
  await browser.close(); server.close();
  done();
})().catch(e => fatal(e.message));
