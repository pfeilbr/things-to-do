# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

A client-side local guide published via GitHub Pages from `main` branch root. No build step, no dependencies, no backend. Keep it that way.

Two files matter:
- **`index.html`** — a *generic* renderer. Nothing in it names a location outside the `CONFIG` block.
- **`data.json`** — the datasets, fetched at boot. This is the only per-location artifact.

To retarget the guide at another place, edit `CONFIG` and swap `data.json`. Because data is fetched, **the page no longer works over `file://`** — serve it (`python3 -m http.server`) when testing locally. The boot path detects that case and says so rather than rendering an empty table.

It's an installable PWA: `manifest.webmanifest`, `sw.js` (network-first, cache fallback — deploys still land immediately), and `icons/` (all rasterized from `icon.svg`; regenerate with `qlmanage -t -s <size>` + `sips`, using a full-bleed variant for maskable/apple-touch). The ☰ menu in the header holds the Install action and is the place to hang future navigation/features.

## Privacy

This is a public repo. Never add personal information: no addresses, no names/emails.

**The origin is never a coordinate in this repo.** Rows carry `ll:[lat,lng]` for *public places* — that's fine and required. But the point distances are measured *from* is only ever the place name `"Willow Grove, PA"` (`DEFAULT_PLACE`); its coordinates are resolved at runtime by geocoder, never committed. Never put origin lat/long in page text, JS constants, URLs, README, or commit messages. When you need origin-relative math offline, do it in a scratchpad script.

## Structure of index.html

- `<style>` — field-guide palette (CSS vars: `--pine`, `--creek`, `--paper`, `--moss`, `--clay`); Barlow Condensed display, Inter body, JetBrains Mono data; mobile card layout below 760px.
- `CONFIG` (top of the `<script>`) — place name, branding, localStorage namespace, footer copy, and the `tabs` array. `COLS`, `TABLABEL`, the tab buttons, per-tab default sorts and the tab counts are all derived from `CONFIG.tabs`; adding or removing a tab is a one-place edit. `CONFIG.place` is a NAME, never coordinates.
- `data.json` — `{ attractions: [...], events: [...], fishing: [...], chinese: [...] }`, one key per `CONFIG.tabs` entry. Row fields:
  - `n` name, `c` category, `s` summary, `d` distance (mi), `t` drive time (min), `u` source URL or `null`
  - `r` Google rating + `rc` review count (popularity = `r × rc`); `r:null` for rows without ratings
  - `w` when string (events only, e.g. `"Sat 7/25 · 9:30a–1p"` or `"Saturdays · 9:30a–1p"`)
  - `ll:[lat,lon]` — venue coordinates (NOT the origin; these are public places). Powers the map view and "near me" mode. ALWAYS include `ll` on new rows, and NEVER drop existing `ll` fields when regenerating data.
- The `chinese` tab is a curated guide to authentic Chinese life for a Sichuan family: Sichuan restaurants, dim sum, hot pot, bakeries/tea, Asian groceries, Chinatown culture, annual Chinese festivals. Names include Chinese characters where apt. Keep the bar high: authentic spots only, no Americanized takeout. Refresh its annual-event dates when they're announced (Mid-Autumn Festival, Lunar New Year).
- `render()` builds the table, mobile cards, and expandable detail panels (Google Maps embed + directions + website links).
- Default sorts come from `CONFIG.tabs[].sort` — attractions/events/chinese by distance asc, fishing by popularity desc.
- **Bump `CACHE` in `sw.js` whenever `data.json`'s shape changes**, and keep `data.json` in its `PRECACHE` list.

## The origin is a parameter

The guide is not hard-wired to Willow Grove. `eff(r)` returns each row's effective `d`/`t` against the active origin, which is one of three things:

1. **Default** — no origin set: the baked `d`/`t` on each row are used as-is (they are the precomputed values for `DEFAULT_PLACE`).
2. **A named place** — the dotted link in the `.sub` line, `?from=Doylestown,PA`, or `setOrigin(name)`. Geocoded via OSM Nominatim, cached in `localStorage` under `wg-origin`, distances recomputed from `ll`.
3. **Geolocation** — the "📍 Near me" button.

Consequences to respect when editing:
- A row without `ll` shows "—" and drops out of drive-time filters under modes 2 and 3. That's why `ll` is mandatory on new rows.
- Never reintroduce a hardcoded `"…, PA"` suffix in the Maps/directions/embed URLs — the guide now spans PA/NJ/NY/MD/DE, so those links are built from `ll`.
- Keep branding generic. The `<h1>` place, `document.title`, and the origin link all follow the active origin; don't hardcode "Willow Grove" into new UI copy.

## Updating events (recurring task)

The owner will periodically ask to refresh the Events tab via web search:

1. Web-search for real events in the Willow Grove / Montgomery County / Bucks County / Philadelphia area for the upcoming weekend (farmers markets, festivals, concerts, car shows, sports, fairs).
2. **Only include events you can verify with a source URL** (`u` field). Never pad with guesses.
3. Recurring weekly/seasonal entries (farmers markets, Friday food-truck nights, summer concert series) are wanted — keep them and refresh their `w` string; do not delete them just because a given weekend's listing page has rotated. This was an explicit owner correction.
4. Estimate `d`/`t` per the formula below and keep the footer's "data gathered" month current.
5. Attractions and fishing data change rarely — only touch them if asked or clearly stale.

## Distance/drive-time formula

Straight-line haversine miles from central Willow Grove ×1.3 road factor = `d` (the displayed distance). Drive time `t` = `d / mph × 60` rounded to whole minutes, where `mph = min(55, 24 + 0.45 × d)` — average speed scales with trip length so highway trips aren't overestimated. This method is disclosed in the footer — don't change one without the other. Attractions scope: anything with `t ≤ 210` min (~3½-hr band; reaches NYC, Baltimore, the Poconos, the Jersey/Delaware shore, Gettysburg, and Washington DC with its close-in VA/MD suburbs at ~185–205 min). Never put the origin coordinates in the repo — do distance math in a scratchpad script.

## Publishing

`git push` to `main` — GitHub Pages (legacy build, main branch root) auto-deploys in ~1 minute. Verify the live URL picked up the change (curl for a string unique to the new version, not just HTTP 200).

**Always bump the `BUILD` constant** (top of the `<script>` in `index.html`) to the current UTC timestamp on every deploy — the page fetches itself with `cache:"no-store"` and auto-reloads visitors holding a stale cached copy (GitHub Pages caches for ~10 min). If BUILD isn't bumped, visitors won't get the refresh.
