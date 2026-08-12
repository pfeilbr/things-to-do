# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

A client-side, **multi-city** local guide published via GitHub Pages from `main` branch root. No build step, no dependencies, no backend. Keep it that way.

The files that matter:
- **`index.html`** — a *generic* renderer. Nothing in it names a location outside the `CONFIG` block. `CONFIG.cities` is the city registry; a chip bar in the header switches between them (choice persists in `localStorage["guide-city"]`, shareable via `?city=` or `#city=`).
- **`data.json`** — the Philly/Willow Grove datasets (the default city), fetched at boot.
- **`data-nyc.json`, `data-brooklyn.json`, `data-queens.json`, `data-flushing.json`, `data-ac.json`, `data-baltimore.json`, `data-dc.json`** — one dataset file per additional city, fetched lazily on first switch and cached in memory.

To add a city: build its data file (same row schema), append an entry to `CONFIG.cities` (id, chip, place NAME, ns, data file, blurb/note/sources, tabs — usually the shared `CITY_TABS`), and add the file to `PRECACHE` in `sw.js`. Each city gets its own localStorage namespace (`ns`) so favorites and custom origins never bleed between cities (`wg` = Philly keeps pre-multi-city favorites intact).

The guide is deliberately geared to the owner's interests: fishing, mountain biking, nightlife (hip-hop/R&B and dancing), sushi & omakase, Chinese culture 中华, date-worthy spots, and recurring socials for meeting people. Keep new rows in that editorial voice — venue/event-focused and tasteful, never framed as targeting people.

Because data is fetched, **the page doesn't work over `file://`** — serve it (`python3 -m http.server`) when testing locally. The boot path detects that case and says so rather than rendering an empty table.

It's an installable PWA: `manifest.webmanifest`, `sw.js` (network-first, cache fallback — deploys still land immediately), and `icons/` (all rasterized from `icon.svg`; regenerate with `qlmanage -t -s <size>` + `sips`, using a full-bleed variant for maskable/apple-touch). The ☰ menu in the header holds the Install action and is the place to hang future navigation/features.

## Privacy

This is a public repo. Never add personal information: no addresses, no names/emails.

**The origin is never a coordinate in this repo.** Rows carry `ll:[lat,lng]` for *public places* — that's fine and required. But the point distances are measured *from* is only ever a place NAME (each city's `place` in `CONFIG.cities`, e.g. `"Willow Grove, PA"`, `"Union Square, Manhattan, NY"`); its coordinates are resolved at runtime by geocoder, never committed. Never put origin lat/long in page text, JS constants, URLs, README, or commit messages. When you need origin-relative math offline, do it in a scratchpad script.

## Structure of index.html

- `<style>` — field-guide palette (CSS vars: `--pine`, `--creek`, `--paper`, `--moss`, `--clay`); Barlow Condensed display, Inter body, JetBrains Mono data; mobile card layout below 760px.
- `CONFIG` (top of the `<script>`) — global branding plus the `cities` registry. Each city entry: `id`, `chip` (city-bar label), `place`/`placeShort`/`originLabel` (NAMES, never coordinates), `ns` (localStorage namespace), `data` (dataset file), `blurb`/`note`/`sources` (header + footer copy), and `tabs`. Shared column layouts (`C_STD`/`C_WHEN`/`C_FISH`) and shared interest tabs (`T_SPOTS`, `T_NIGHT`, `T_EATS`, `T_CHINESE`, `T_FISH`, `T_BIKE`, `T_SOCIAL`, bundled as `CITY_TABS`) live beside it. `TABS`/`COLS`/`TABLABEL`/`HOME` are re-derived per city by `setCityConfig()`; adding or removing a tab is a one-place edit.
- Dataset files — one JSON key per tab in that city's `tabs`. Philly's `data.json` has `attractions`/`events`/`nightlife`/`eats`/`biking`/`social`/`fishing`/`chinese`; the other cities have `spots`/`nightlife`/`eats`/`chinese`/`fishing`/`biking`/`social`. Row fields:
  - `n` name, `c` category, `s` summary, `d` distance (mi), `t` drive time (min), `u` source URL or `null`
  - `r` Google rating + `rc` review count (popularity = `r × rc`); `r:null` for rows without ratings
  - `w` when string (tabs with a When column only — Philly `events` and every `social` tab, e.g. `"Sat 7/25 · 9:30a–1p"` or `"Saturdays · 9:30a–1p"`)
  - `ll:[lat,lon]` — venue coordinates (NOT the origin; these are public places). Powers the map view and "near me" mode. ALWAYS include `ll` on new rows, and NEVER drop existing `ll` fields when regenerating data.
- The `chinese` tabs are curated guides to authentic Chinese life (the owner has Sichuan family ties): Sichuan restaurants, dim sum, hot pot, bakeries/tea, Asian groceries, Chinatown culture, annual Chinese festivals. Names include Chinese characters where apt. Keep the bar high: authentic spots only, no Americanized takeout. Flushing's `chinese` tab is the flagship — the deepest one in the app. Refresh annual-event dates when they're announced (Mid-Autumn Festival, Lunar New Year, dragon boat).
- The `social` tabs hold *recurring* series (dance socials, run clubs, trivia, language exchanges, night markets) — evergreen `w` strings like `"Fridays · 10p–2a"` preferred over one-off dates so they don't rot.
- `render()` builds the table, mobile cards, and expandable detail panels (Google Maps embed + directions + website links).
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

The owner will periodically ask to refresh the (Philly) Events tab via web search:

1. Web-search for real events in the Willow Grove / Montgomery County / Bucks County / Philadelphia area for the upcoming weekend (farmers markets, festivals, concerts, car shows, sports, fairs).
2. **Only include events you can verify with a source URL** (`u` field). Never pad with guesses.
3. Recurring weekly/seasonal entries (farmers markets, Friday food-truck nights, summer concert series) are wanted — keep them and refresh their `w` string; do not delete them just because a given weekend's listing page has rotated. This was an explicit owner correction.
4. Estimate `d`/`t` per the formula below and keep the footer's "data gathered" month current.
5. Attractions and fishing data change rarely — only touch them if asked or clearly stale.

## Distance/drive-time formula

Straight-line haversine miles from the city's origin place ×1.3 road factor = `d` (the displayed distance). Drive time `t` = `d / mph × 60` rounded to whole minutes, where `mph = min(55, 24 + 0.45 × d)` — average speed scales with trip length so highway trips aren't overestimated. This method is disclosed in the footer — don't change one without the other. Baked `d`/`t` are measured from each city's `place` (Philly: central Willow Grove; NYC: Union Square; Brooklyn: Barclays Center area; Queens: Forest Hills; Flushing: Main St & Roosevelt; Atlantic City: Boardwalk Hall area; Baltimore: Inner Harbor; DC: downtown/Freedom Plaza area). Philly attractions scope: anything with `t ≤ 210` min (~3½-hr band; reaches NYC, Baltimore, the Poconos, the Jersey/Delaware shore, Gettysburg, and Washington DC with its close-in VA/MD suburbs at ~185–205 min). City guides keep venues roughly within the metro (~≤60–90 min). Never put origin coordinates in the repo — do distance math in a scratchpad script.

## Publishing

`git push` to `main` — the `.github/workflows/pages.yml` workflow deploys the repo root to GitHub Pages in ~1 minute (it can also re-enable Pages by itself via `enablement: true` if Pages got turned off; it can be fired manually with a `workflow_dispatch`). Pages requires the repo to be **public** on the free plan — if the site 404s entirely, check repo visibility first. Verify the live URL picked up the change (curl for a string unique to the new version, not just HTTP 200).

**Always bump the `BUILD` constant** (top of the `<script>` in `index.html`) to the current UTC timestamp on every deploy — the page fetches itself with `cache:"no-store"` and auto-reloads visitors holding a stale cached copy (GitHub Pages caches for ~10 min). If BUILD isn't bumped, visitors won't get the refresh.
