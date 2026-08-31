# Things To Do

A single-page, fully client-side web app — pick a city from the dropdown, get things to do in one sortable, searchable table. Ships with twenty-four guides: **Philly (Willow Grove) · Forest Hills · NYC · Brooklyn · Queens · Flushing · Ithaca (Cornell) · Atlantic City · Baltimore · Washington DC · Pittsburgh · Richmond · Boston · Virginia Beach · Buffalo · Cleveland · Raleigh-Durham · Chicago · Toronto · Nashville · Los Angeles · San Francisco · Seattle · San Diego**.

**Live site:** https://pfeilbr.github.io/things-to-do/

## Features

- **City switcher** — a region-grouped dropdown in the app bar swaps the whole guide (tabs, data, distances, favorites) between cities; your pick is remembered, and `?city=nyc` links directly
- **Interest-focused tabs** per city:
  - **Spots / Attractions** — date-worthy highlights and experiences, sorted by distance
  - **Nightlife** — dance floors and hip-hop/R&B nights first, then lounges, live music, speakeasies, and KTV
  - **Sushi & Eats** — omakase and sushi across price points, plus standout Japanese/Korean/SEA spots
  - **Chinese 中华** — authentic Chinese food and culture: Sichuan restaurants, dim sum, hot pot, bakeries & tea, markets, temples, festivals (Flushing's is the deepest)
  - **Fishing** — piers, lakes, party boats, and surf spots with license notes
  - **MTB** — real mountain-bike trails within a drive, labeled honestly (singletrack vs. greenway)
  - **Social** — recurring series where strangers actually talk: dance socials, run clubs, trivia, language exchanges, night markets — with a "today" badge on ones happening now
  - **Events** — dated, source-verified listings for the next few weeks, on Philly, Ithaca and the five NYC-area guides; the ones happening today get a TODAY badge
  - **Coffee** — on the Ithaca/Cornell guide only: campus cafés and Ithaca's roasters, sorted by popularity
- **Everyday-life tabs** on the seven guides for places actually lived in (Forest Hills, NYC, Brooklyn, Queens, Flushing, Boston, Ithaca) — the stuff you actually look up when you live somewhere rather than visit it:
  - **Museums** — museums and galleries, from the Met down to a museum inside a Tribeca freight elevator
  - **Sights** — things worth looking at: observation decks, public art, architecture, World's Fair ruins, oddities like Grand Central's whispering gallery
  - **Walks** — walking *routes*, not just parks: greenways, promenades, park loops, woodland trails, boardwalks, brownstone wanders
  - **Shops** — bookstores, record shops, vintage, markets, department stores and the specialist places worth crossing town for
  - **Essentials** — the errand layer: gas stations, pharmacies, hardware, laundromats, urgent care, licensed dispensaries, post offices, car washes, bike repair
- **Forest Hills** is a *neighborhood* guide rather than a borough one — nearly everything in it is inside a two-mile walk of Austin Street
- **Ithaca** is a campus guide — everything is measured from central campus at Cornell, and it carries a Coffee tab of its own alongside the gorges, Collegetown and the Finger Lakes around it
- **Boston** covers the whole metro: Cambridge, Somerville, Brookline, Charlestown, Quincy, Salem and the Blue Hills, not just the peninsula
- **☀ Tonight** — one tap shows everything happening today in the active city (events + recurring socials), with a live count badge; shareable via `#tonight=1`
- **Smart search** — cross-tab hints ("also 10 in Sushi & Eats") that keep your query when you tap through
- **Near-me city switch** — using 📍 in another covered city offers to swap you to that guide
- **Trip notes** — every away city shows its distance from home base ("≈1¾ hr drive")
- **Favorites** — star any row (saved in your browser, per city); filter to favorites with ★
- **Near me** — recompute all distances from your current location (computed entirely in-browser)
- **Map view** — see the current filtered list as pins on an OpenStreetMap map
- **Shareable links** — tab, search, filters, and sort are encoded in the URL hash
- **Per-item permalinks** — every row's detail panel has a Share button (native share sheet on phones, copy-link elsewhere); the link opens the app with that item expanded and scrolled into view
- **Sortable columns** — click any header to sort, click again to reverse; a sort dropdown appears on mobile
- **Live search** across name, category, summary, and event times
- **Filters** — a category chip bar with live per-category counts (tap the active chip to clear it), and one distance control covering both walking bands (≤ ½ mi / 1 mi / 2 mi) and drive times (≤10/20/30/45/60/90 min and up); a "clear: …" button appears whenever anything is filtering
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
