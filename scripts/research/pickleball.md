# Research brief: `pickleball` tab

The repeatable recipe for filling, or refreshing, a city's Pickleball tab (`T_PICKLE` in
index.html, key `pickleball`). Stamford (`data-stamford.json`) is the pilot: read its
`pickleball` rows first, because they set the voice, length and level of detail. The tab carries
`opt:1`, so a city shows it only once its data file has a `pickleball` key; `tests/data/schema.test.js`
lists it in `OPTIONAL_TABS`.

The question the tab answers: *where can I play pickleball this week, and how do I get on a court?*
So every row must say how you actually get to play (drop-in open play, reserve online, first come,
membership, permit) and what it costs.

## Output: one file per city

Write a JSON array to `<rows-dir>/<data-file-stem>.pickleball.json` (e.g. `data-nyc.pickleball.json`;
Philly's stem is `data`). Then import everything with:

    python3 scripts/events.py import <rows-dir> --new-tab --dry-run   # preview
    python3 scripts/events.py import <rows-dir> --new-tab
    python3 scripts/events.py coverage --tab pickleball --min 8

Each row:

    {"n": "Name", "c": "Category", "s": "Summary", "u": "https://source", "ll": [lat, lon]}

- **`n`**: the venue name. It must be unique within that city's file across ALL tabs, so if the
  park already appears in another tab use e.g. "Cove Island Park pickleball courts". Grep first.
- **`c`**: ONLY these spellings (the consistency test rejects variants):
  - `Outdoor courts`: public outdoor courts, dedicated or lined on tennis courts.
  - `Indoor club`: a pay-to-play indoor facility (dedicated pickleball club, racquet club with
    pickleball courts).
  - `Indoor open play`: drop-in sessions in a rec center, YMCA, community center or school gym.
  - `Pickleball bar`: courts plus food and drinks (an "eatertainment" venue); good for a date or a group.
  - `Club & league`: a local association, ladder or league that runs open play across courts.
  Today's "Get outside" block falls back to `Indoor…` and `Pickleball bar` rows after dark and in
  the rain, so get the indoor/outdoor split right.
- **`s`**: 140–330 characters (NYC-area files: 140–260, they are near the 120 KB file budget).
  Facts in the guide's voice: number of courts, dedicated or shared with tennis, lights, permanent
  nets or bring-your-own, surface; how to play (open-play days and hours, reservation app/site,
  first-come rotation with paddles stacked); price (drop-in fee, court hourly, membership, NYC Parks
  permit); season (outdoor courts that close for winter, indoor winter programs). The skill level
  of the crowd where a source says so. No hype, no claim the source doesn't support. Every summary
  must be unique across the whole repo, so the same venue in two cities' files gets two summaries
  written from each city's vantage.
- **`u`**: the best current source. Prefer the official page (city/town parks department page for
  the courts, the club's own site or booking page), then USA Pickleball's places2play.org or
  pickleheads.com court pages, then local press. It must load in a browser and be current (2025–26).
- **`ll`**: the courts' coordinates, from OpenStreetMap Nominatim
  (`https://nominatim.openstreetmap.org/search?q=...&format=json&limit=1`, generic User-Agent,
  1 request/second) or the park's own map. These are public places. NEVER look up or write the
  city's origin point.
- Do NOT include `d`/`t`/`r`/`rc`: `events.py` computes `d`/`t` from the fitted origin and sets
  ratings to `null`.

## What to find

Target 8–14 rows per city, within about a 40-minute drive of the city's anchor (`place` in
CONFIG), weighted to the closest. Forest Hills is a neighborhood guide: keep it to roughly 4 miles.

1. The public outdoor courts people actually use: dedicated pickleball courts first, then the
   busiest tennis courts lined for pickleball. Say whether they are lit and whether nets are permanent.
2. Indoor clubs and pay-to-play facilities (The Picklr, Pickleball Kingdom, Pickle Haus, local
   racquet clubs), with drop-in/open-play prices and booking app.
3. Indoor open play at rec centers and Ys, with days and hours, because that is the winter option.
4. Pickleball bars (Chicken N Pickle, Pickle & Social, Dink, Smash, etc.) when the city has one.
5. The local club or association that runs open play, ladders and clinics, if it has a public page.

Use user-generated sources (Reddit, pickleheads reviews, Facebook group posts quoted in press) to
judge crowding, wait times and level, and to catch courts that were removed or converted.

## Never

- Invent a venue, court count, price or schedule.
- Include a venue you can't confirm still operates in 2026 (clubs open and close fast).
- Include a private club that doesn't sell guest play, drop-in or a day pass.
- Include personal information, or any coordinate for the city's origin.
