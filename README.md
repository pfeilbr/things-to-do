# Willow Grove Local Guide

A single-page, fully client-side "field guide" web app for the Willow Grove, PA area — local attractions, weekend events, and fishing spots in one sortable, searchable table.

**Live site:** https://pfeilbr.github.io/things-to-do/

## Features

- **Three datasets** in tabs:
  - **Attractions** — 50 places nearby (parks, breweries, museums, escape rooms, state parks, farms, golf, movies, wineries, historic sites), sorted by distance by default
  - **Weekend Events** — real, verifiable events for the covered weekend, each with a source link
  - **Fishing** — 20 creeks, lakes, and reservoirs with species info and PFBC stocked-trout notes, sorted by popularity by default
- **Sortable columns** — click any header to sort, click again to reverse; a sort dropdown appears on mobile
- **Live search** across name, category, summary, and event times
- **Filters** — category dropdown and max-drive-time dropdown (≤10/20/30/45/60 min)
- **Expandable rows** — tap any row to reveal a detail panel with an embedded Google Map, directions, and website links
- **Responsive** — full table on desktop, stacked cards below 760px; visible keyboard focus; respects `prefers-reduced-motion`
- No build step, no dependencies, no backend — just `index.html`

## How distances work

Distances are straight-line (haversine) from central Willow Grove, multiplied by a 1.3 road factor; drive times assume roughly 32 mph average. They're estimates — verify before you go.

## Data sources

Google Places ratings, VisitPhilly, Metro Philadelphia, Visit Bucks County, PA DCNR, PFBC stream guides, and local event calendars. Event data is time-sensitive and reflects the weekend noted in the page header.

> Fishing requires a PA license (plus a trout stamp on stocked water).

## Development

Open `index.html` in a browser. That's it. Pushes to `main` deploy automatically via GitHub Pages.
