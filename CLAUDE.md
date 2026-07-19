# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

A single-file, client-side local guide for Willow Grove, PA published via GitHub Pages from `main` branch root. Everything lives in `index.html` — no build step, no dependencies, no backend. Keep it that way.

## Privacy

This is a public repo. Never add personal information: no precise coordinates, no addresses, no names/emails. The distance origin is always the generic "central Willow Grove" / `"Willow Grove, PA"` place name — never exact lat/long in page text, JS constants, URLs, README, or commit messages.

## Structure of index.html

- `<style>` — field-guide palette (CSS vars: `--pine`, `--creek`, `--paper`, `--moss`, `--clay`); Barlow Condensed display, Inter body, JetBrains Mono data; mobile card layout below 760px.
- `const DATA = { attractions: [...], events: [...], fishing: [...] }` — the three datasets. Row fields:
  - `n` name, `c` category, `s` summary, `d` distance (mi), `t` drive time (min), `u` source URL or `null`
  - `r` Google rating + `rc` review count (attractions/fishing; popularity = `r × rc`)
  - `w` when string (events only, e.g. `"Sat 7/18 · 9:30a–1p"`)
- `COLS` — per-tab column definitions; `render()` builds the table, mobile cards, and expandable detail panels (Google Maps embed + directions + website links).
- Default sorts: attractions/events by distance asc, fishing by popularity desc.

## Updating events (recurring task)

The owner will periodically ask to refresh the Weekend Events tab via web search:

1. Web-search for real events in the Willow Grove / Montgomery County / Bucks County / Philadelphia area for the upcoming weekend (farmers markets, festivals, concerts, car shows, sports, fairs).
2. **Only include events you can verify with a source URL** (`u` field). Never pad with guesses or recurring events you can't confirm for that specific weekend.
3. Estimate `d`/`t` per the formula below; update the weekend date range in the header `.sub` line and keep the footer's "data gathered" month current.
4. Attractions and fishing data change rarely — only touch them if asked or clearly stale.

## Distance/drive-time formula

Straight-line haversine miles from central Willow Grove ×1.3 road factor = `d` (the displayed distance). Drive time `t` = `d / mph × 60` rounded to whole minutes, where `mph = min(55, 24 + 0.45 × d)` — average speed scales with trip length so highway trips aren't overestimated. This method is disclosed in the footer — don't change one without the other. Attractions scope: anything with `t ≤ 120` min. Never put the origin coordinates in the repo — do distance math in a scratchpad script.

## Publishing

`git push` to `main` — GitHub Pages (legacy build, main branch root) auto-deploys in ~1 minute. Verify the live URL picked up the change (curl for a string unique to the new version, not just HTTP 200).

**Always bump the `BUILD` constant** (top of the `<script>` in `index.html`) to the current UTC timestamp on every deploy — the page fetches itself with `cache:"no-store"` and auto-reloads visitors holding a stale cached copy (GitHub Pages caches for ~10 min). If BUILD isn't bumped, visitors won't get the refresh.
