# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

**Things To Do** — a client-side, **multi-city** guide published via GitHub Pages from `main` branch root. No build step, no dependencies, no backend. Keep it that way.

The branding is deliberately generic: the product is "Things To Do", the active city is a choice in a dropdown, not part of the name. Don't reintroduce place-specific or outdoorsy branding — the palette is blue/neutral (`--brand`, `--accent`, `--hot`, `--bg`, `--text`, `--muted`), the type is Inter + JetBrains Mono, and there is no field-guide voice left in the chrome.

The files that matter:
- **`index.html`** — a *generic* renderer. Nothing in it names a location outside the `CONFIG` block. `CONFIG.cities` is the city registry; a region-grouped `<select>` in the app bar switches between them (choice persists in `localStorage["guide-city"]`, shareable via `?city=` or `#city=`).
- **`data.json`** — the Philly/Willow Grove datasets (the default city), fetched at boot.
- **`data-<city>.json`** (foresthills, nyc, brooklyn, queens, flushing, ithaca, ac, baltimore, dc, pittsburgh, richmond, boston, …) — one dataset file per additional city, fetched lazily on first switch and cached in memory. The authoritative city list is `CONFIG.cities` in `index.html`.

To add a city: build its data file (same row schema), append an entry to `CONFIG.cities` (id, chip, place NAME, ns, data file, blurb/note/sources, tabs — usually the shared `CITY_TABS`), and add the file to `PRECACHE` in `sw.js`. Each city gets its own localStorage namespace (`ns`) so favorites and custom origins never bleed between cities (`wg` = Philly keeps pre-multi-city favorites intact).

The guide is deliberately geared to the owner's interests: fishing, mountain biking, nightlife (hip-hop/R&B and dancing), sushi & omakase, Chinese culture 中华, date-worthy spots, and recurring socials for meeting people. Keep new rows in that editorial voice — venue/event-focused and tasteful, never framed as targeting people.

Because data is fetched, **the page doesn't work over `file://`** — serve it (`python3 -m http.server`) when testing locally. The boot path detects that case and says so rather than rendering an empty table.

It's an installable PWA: `manifest.webmanifest`, `sw.js` (network-first, cache fallback — deploys still land immediately), and `icons/` (all rasterized from `icon.svg`; regenerate with `qlmanage -t -s <size>` + `sips`, using a full-bleed variant for maskable/apple-touch). The ☰ menu in the header holds the Install action and is the place to hang future navigation/features.

## Privacy

This is a public repo. Never add personal information: no addresses, no names/emails.

**The origin is never a coordinate in this repo.** Rows carry `ll:[lat,lng]` for *public places* — that's fine and required. But the point distances are measured *from* is only ever a place NAME (each city's `place` in `CONFIG.cities`, e.g. `"Willow Grove, PA"`, `"Union Square, Manhattan, NY"`); its coordinates are resolved at runtime by geocoder, never committed. Never put origin lat/long in page text, JS constants, URLs, README, or commit messages. When you need origin-relative math offline, do it in a scratchpad script.

## Structure of index.html

- `<style>` — neutral blue palette (CSS vars: `--brand` navy, `--accent` blue, `--accent-soft`, `--hot` amber, `--bg`, `--text`, `--muted`, `--line`, `--card`); Inter for everything except data, which is JetBrains Mono; mobile card layout below 760px.
- **Header layout** — one `.appbar` row: wordmark, `.citypick` (a `<span id="hPlace">` label with a transparent native `<select id="citySelect">` laid over it, so the control is a real accessible select), then the ☰ menu. Below it a scrollable `.tabwrap`/`.tabs` strip. Nothing else lives in the header: the city blurb went to the footer (`#subBlurb`) and the trip note + origin picker to the `.meta-line` under the controls. `#hPlace` always names the **city**, never the origin — it is the picker's label, so `syncOrigin()` must not touch it.
- `CONFIG` (top of the `<script>`) — global branding plus the `cities` registry. Each city entry: `id`, `chip` (city-bar label), `place`/`placeShort`/`originLabel` (NAMES, never coordinates), `ns` (localStorage namespace), `data` (dataset file), `blurb`/`note`/`sources` (header + footer copy), and `tabs`. Shared column layouts (`C_STD`/`C_WHEN`/`C_FISH`) and shared interest tabs (`T_SPOTS`, `T_NIGHT`, `T_EATS`, `T_CHINESE`, `T_FISH`, `T_BIKE`, `T_SOCIAL`, bundled as `CITY_TABS`) live beside it. `TABS`/`COLS`/`TABLABEL`/`HOME` are re-derived per city by `setCityConfig()`; adding or removing a tab is a one-place edit.
- Dataset files — one JSON key per tab in that city's `tabs`. Philly's `data.json` has `attractions`/`events`/`nightlife`/`eats`/`biking`/`social`/`fishing`/`chinese`; visitor-guide cities have `spots`/`nightlife`/`eats`/`chinese`/`fishing`/`biking`/`social`; the **home cities** (Forest Hills, NYC, Brooklyn, Queens, Flushing, Boston — `HOME_TABS`) add `museums`/`sights`/`walks`/`shops`/`essentials` on top. Row fields:
  - `n` name, `c` category, `s` summary, `d` distance (mi), `t` drive time (min), `u` source URL or `null`
  - `r` Google rating + `rc` review count (popularity = `r × rc`); `r:null` for rows without ratings
  - `w` when string (tabs with a When column only — Philly `events` and every `social` tab, e.g. `"Sat 7/25 · 9:30a–1p"` or `"Saturdays · 9:30a–1p"`)
  - `ll:[lat,lon]` — venue coordinates (NOT the origin; these are public places). Powers the map view and "near me" mode. ALWAYS include `ll` on new rows, and NEVER drop existing `ll` fields when regenerating data.
- The `chinese` tabs are curated guides to authentic Chinese life (the owner has Sichuan family ties): Sichuan restaurants, dim sum, hot pot, bakeries/tea, Asian groceries, Chinatown culture, annual Chinese festivals. Names include Chinese characters where apt. Keep the bar high: authentic spots only, no Americanized takeout. Flushing's `chinese` tab is the flagship — the deepest one in the app. Refresh annual-event dates when they're announced (Mid-Autumn Festival, Lunar New Year, dragon boat).
- Ithaca (`data-ithaca.json`, ns `ith`) is a **campus** guide: distances are measured from central campus at Cornell, and it is the only city with a `coffee` tab (`T_COFFEE`) — campus cafés plus the town's roasters. Its layout is `CAMPUS_TABS`. It carries the everyday-life tabs because the guide assumes a term spent living on the hill, and its rows reach the Finger Lakes around it (Taughannock, Shindagin Hollow, Corning).
- The **everyday-life tabs** exist only where the owner actually lives and spends time (the five NYC-area guides, plus Boston — whose rows span the metro: Cambridge, Somerville, Brookline, Charlestown, Salem, the Blue Hills — and Ithaca). `museums` is museums and galleries; `sights` is things worth looking at — observation decks, public art, architecture, ruins, oddities; `walks` is walking *routes and paths*, not just parks; `shops` is retail worth crossing town for; `essentials` is the errand layer — gas, pharmacy, hardware, laundromat, urgent care, licensed dispensaries, post office, car wash. Keep `essentials` honest and specific: a row has to be one you'd actually use, not a generic chain listing. Don't add these tabs to a visitor city — a guide to Cleveland has no business listing a laundromat.
- Forest Hills (`data-foresthills.json`, ns `fh`) is a **neighborhood** guide, not a borough one: it drops `fishing`/`biking` and its rows are weighted to walking distance of Austin St. Queens (`data-queens.json`) stays the borough-wide guide, anchored on the same origin.
- The `social` tabs hold *recurring* series (dance socials, run clubs, trivia, language exchanges, night markets) — evergreen `w` strings like `"Fridays · 10p–2a"` preferred over one-off dates so they don't rot.
- `render()` builds the table, mobile cards, and expandable detail panels (Google Maps embed + directions + website links).
- **Filtering**: the category filter is a chip bar (`#catChips`, `drawCats()`) with per-category counts computed against `rowsUnfiltered()`, not the filtered list, so the numbers don't shuffle as you click; clicking the active chip clears it. `#distFilter` carries two bands in one control — `d:<miles>` for walking distance (`state.maxD`) and a bare number for drive minutes (`state.maxT`) — and only one is ever active. `drawClear()` puts a "clear: …" button in the meta line whenever any filter is on. Deep links round-trip through `?cat=`, `?t=` and `?mi=`.
- Default sorts come from each tab's `sort` — spots/attractions/events/chinese/biking/social by distance asc; nightlife/eats/fishing by popularity desc.
- **Bump `CACHE` in `sw.js` whenever any dataset's shape changes**, and keep every city's data file in its `PRECACHE` list.

## The origin is a parameter

The guide is not hard-wired to any city. `eff(r)` returns each row's effective `d`/`t` against the active origin, which is one of three things:

1. **Default** — no origin set: the baked `d`/`t` on each row are used as-is (they are the precomputed values for the active city's `place`).
2. **A named place** — the dotted link in the `.sub` line, `?from=Doylestown,PA`, or `setOrigin(name)`. Geocoded via OSM Nominatim, cached in `localStorage` under `<ns>-origin` (per city), distances recomputed from `ll`.
3. **Geolocation** — the "📍 Near me" button.

Consequences to respect when editing:
- A row without `ll` shows "—" and drops out of drive-time filters under modes 2 and 3. That's why `ll` is mandatory on new rows.
- Never reintroduce a hardcoded `"…, PA"` suffix in the Maps/directions/embed URLs — the guide now spans PA/NJ/NY/MD/DE, so those links are built from `ll`.
- Keep branding generic. The `<h1>` place, `document.title`, and the origin link all follow the active origin; don't hardcode "Willow Grove" into new UI copy.

## Updating events (recurring task)

Three guides carry dated `events`: **Philly** (`data.json`), **Ithaca** (`data-ithaca.json`) and the **five NYC-area cities**
(`data-nyc/brooklyn/queens/flushing/foresthills.json`, tab list `NYC_TABS`). Boston does
not yet. The routine is the same for both — the owner will ask to refresh a weekend or a
month:

1. Web-search for real events in the relevant area for the window asked for — Willow Grove / Montgomery / Bucks / Philadelphia for `data.json`; Manhattan, Brooklyn, Queens, Flushing and Forest Hills for the NYC set (festivals, parades, street fairs, concerts, sports, museum openings).
2. **Only include events you can verify with a source URL** (`u` field). Never pad with guesses.
3. Recurring weekly/seasonal entries (farmers markets, Friday food-truck nights, summer concert series) are wanted — keep them and refresh their `w` string; do not delete them just because a given weekend's listing page has rotated. This was an explicit owner correction.
4. Estimate `d`/`t` per the formula below and keep the footer's "data gathered" month current.
5. Attractions and fishing data change rarely — only touch them if asked or clearly stale.
6. **Don't duplicate a recurring series into `events`.** If a market/night market/greenmarket already has a row in `social` (or `shops`), fix that row's `w` string instead — the consistency test only catches exact name collisions, so near-identical names ("Queens Night Market" vs "Queens Night Market fall season") have to be caught by eye.
7. A one-off with no verifiable date does not belong in `events` at all; "check schedule" is not a `w` string.

## Distance/drive-time formula

Straight-line haversine miles from the city's origin place ×1.3 road factor = `d` (the displayed distance). Drive time `t` = `d / mph × 60` rounded to whole minutes, where `mph = min(55, 24 + 0.45 × d)` — average speed scales with trip length so highway trips aren't overestimated. This method is disclosed in the footer — don't change one without the other. Baked `d`/`t` are measured from each city's `place` (Philly: central Willow Grove; NYC: Union Square; Brooklyn: Barclays Center area; Queens: Forest Hills; Flushing: Main St & Roosevelt; Atlantic City: Boardwalk Hall area; Baltimore: Inner Harbor; DC: downtown/Freedom Plaza area; Pittsburgh: Point State Park area; Richmond: downtown; Boston: Boston Common (its rows reach the whole metro); Ithaca: central campus at Cornell; Forest Hills: Austin St & Continental Ave — and each newer city's entry names its own downtown anchor). Philly attractions scope: anything with `t ≤ 210` min (~3½-hr band; reaches NYC, Baltimore, the Poconos, the Jersey/Delaware shore, Gettysburg, and Washington DC with its close-in VA/MD suburbs at ~185–205 min). City guides keep venues roughly within the metro (~≤60–90 min). Never put origin coordinates in the repo — do distance math in a scratchpad script.

## Testing

`tests/` runs with node builtins only — no package.json, no dependencies:
- `node --test 'tests/unit/*.test.js' 'tests/data/*.test.js'` — unit tests for the core logic (extracted from index.html into a vm sandbox with injectable dates) and the data-schema/consistency suite over every city dataset (per-file tab layouts live in `LAYOUTS` in `tests/data/schema.test.js` — add an entry there when a city's tab set differs from the default) (also run by `.github/workflows/ci.yml` on push/PR). Run these after ANY data or index.html edit.
- `node tests/e2e/run-all.js` (or `node tests/e2e/<name>.test.js` individually) — self-contained Playwright specs (region picker, tonight mode + count badge, map clustering, search hints, near-me city suggestion, trip notes, back-to-top, keyboard a11y). They need chromium + the playwright package; in sandboxes the browser can't reach CDNs, so `tests/e2e/_lib.js` routes unpkg/tile requests to `tests/e2e/vendor/` and blocks the service worker (which would otherwise shadow interception). CI runs the full e2e suite on every pull request.
- The `w` when-strings power both the events "today" badge and Tonight mode — keep them in the formats `tests/unit/core.test.js` pins.

## Publishing

`git push` to `main` — the `.github/workflows/pages.yml` workflow deploys the repo root to GitHub Pages in ~1 minute (it can also re-enable Pages by itself via `enablement: true` if Pages got turned off; it can be fired manually with a `workflow_dispatch`). Pages requires the repo to be **public** on the free plan — if the site 404s entirely, check repo visibility first. Verify the live URL picked up the change (curl for a string unique to the new version, not just HTTP 200).

**Always bump the `BUILD` constant** (top of the `<script>` in `index.html`) to the current UTC timestamp on every deploy — the page fetches itself with `cache:"no-store"` and auto-reloads visitors holding a stale cached copy (GitHub Pages caches for ~10 min). If BUILD isn't bumped, visitors won't get the refresh.
