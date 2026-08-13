# Things To Do — Multi-City Local Guide

A single-page, fully client-side "field guide" web app — pick a city, get things to do in one sortable, searchable table. Ships with fifteen cities: **Philly (Willow Grove) · NYC · Brooklyn · Queens · Flushing · Atlantic City · Baltimore · Washington DC · Pittsburgh · Richmond · Boston · Virginia Beach · Buffalo · Cleveland · Raleigh-Durham**.

**Live site:** https://pfeilbr.github.io/things-to-do/

## Features

- **City switcher** — a chip bar in the header swaps the whole guide (tabs, data, distances, favorites) between cities; your pick is remembered, and `?city=nyc` links directly
- **Interest-focused tabs** per city:
  - **Spots / Attractions** — date-worthy highlights, views, museums, walks, sorted by distance
  - **Nightlife** — dance floors and hip-hop/R&B nights first, then lounges, live music, speakeasies, and KTV
  - **Sushi & Eats** — omakase and sushi across price points, plus standout Japanese/Korean/SEA spots
  - **Chinese 中华** — authentic Chinese food and culture: Sichuan restaurants, dim sum, hot pot, bakeries & tea, markets, temples, festivals (Flushing's is the deepest)
  - **Fishing** — piers, lakes, party boats, and surf spots with license notes
  - **MTB** — real mountain-bike trails within a drive, labeled honestly (singletrack vs. greenway)
  - **Social** — recurring series where strangers actually talk: dance socials, run clubs, trivia, language exchanges, night markets — with a "today" badge on ones happening now
  - Philly additionally keeps its **weekend Events** tab
- **Favorites** — star any row (saved in your browser, per city); filter to favorites with ★
- **Near me** — recompute all distances from your current location (computed entirely in-browser)
- **Map view** — see the current filtered list as pins on an OpenStreetMap map
- **Shareable links** — tab, search, filters, and sort are encoded in the URL hash
- **Per-item permalinks** — every row's detail panel has a Share button (native share sheet on phones, copy-link elsewhere); the link opens the app with that item expanded and scrolled into view
- **Sortable columns** — click any header to sort, click again to reverse; a sort dropdown appears on mobile
- **Live search** across name, category, summary, and event times
- **Filters** — category dropdown and max-drive-time dropdown (≤10/20/30/45/60 min)
- **Expandable rows** — tap any row to reveal a detail panel with an embedded Google Map, directions, and website links
- **Responsive** — full table on desktop, stacked cards below 760px; visible keyboard focus; respects `prefers-reduced-motion`
- **Installable PWA** — add it to your phone's home screen via the ☰ menu → "Install app" (manifest + service worker; works offline with last-fetched data)
- No build step, no dependencies, no backend — `index.html` plus a manifest, service worker, and icons

## How distances work

Distances are straight-line (haversine) from the active city's center (or any origin you set — tap the dotted place name, or use 📍 Near me), multiplied by a 1.3 road factor. Drive times use an average speed that scales with trip length (24 mph for short local hops up to 55 mph for highway trips: `mph = min(55, 24 + 0.45 × road_miles)`). They're estimates — verify before you go.

## Data sources

Google Places ratings, official venue sites, VisitPhilly, Visit Bucks County, Time Out NY, The Infatuation, PA DCNR, PFBC stream guides, and local event calendars. Event data is time-sensitive and reflects the weekend noted in the page header.

> Fishing licenses: PA license (+ trout stamp on stocked water) for the Philly guide; NY freshwater license or the free saltwater registry for the NYC guides.

## Development

Open `index.html` in a browser. That's it. Pushes to `main` deploy automatically via GitHub Pages.
