# Research brief: `skating` (Rollerblading) and `iceskating` (Ice skating) tabs

The repeatable recipe for filling, or refreshing, the two skating tabs for any city. Stamford
(`data-stamford.json`) was the pilot. Read its `skating` and `iceskating` rows first, because
they set the voice, length and level of detail. Every city in `CONFIG.cities` carries both tabs
(`T_SKATE`, `T_ICE` in index.html).

## Output: one file per city per tab

Write a JSON array to `<rows-dir>/<data-file-stem>.<tab>.json`, where the stem is the city's data
file without `.json`. For example, `data-nyc.skating.json` and `data-nyc.iceskating.json`. Philly's
file is `data.json`, so its stem is `data` (`data.skating.json`). Then import everything with:

    python3 scripts/events.py import <rows-dir> --new-tab     # --dry-run first to preview
    python3 scripts/events.py coverage --tab skating --tab iceskating

Each row looks like this:

    {"n": "Name", "c": "Category", "s": "Summary", "u": "https://source", "ll": [lat, lon]}

- **`n`**: the venue or route name. It must be unique within that city's file across ALL tabs.
  If the place already appears in another tab, use a distinct name, e.g. "Cove Island Park
  skate loop" rather than "Cove Island Park". Check by grepping the data file.
- **`c`**: use ONLY these spellings, because the consistency test rejects variants.
  - skating: `Paved loop`, `Paved rail-trail`, `Paved river path`, `Boardwalk`, `Skate plaza`,
    `Car-free road`, `Skatepark`, `Indoor rink`, `Seasonal rink`, `Skate scene`, `Group skate`
  - iceskating: `Indoor rink`, `Outdoor rink`, `Natural ice`
- **`s`**: 120–380 characters, a factual one-liner or two in the guide's voice. Say what makes it
  good or bad for skating: surface, flatness, length, crowding, hours or season, price, rentals,
  passes, and the current season's dates where published. No hype, no filler, and no claim that
  the source doesn't support. Every summary must be unique across the whole repo, so the same
  venue in two cities' files needs two different summaries, each written from that city's vantage.
- **`u`**: the source URL that supports the row. Prefer the official venue or park page, then a
  skater guide (skatecity.com, TrailLink inline-skating pages), local press, or Meetup.
  Make sure it loads in a browser.
- **`ll`**: the venue's coordinates, from OpenStreetMap Nominatim
  (`https://nominatim.openstreetmap.org/search?q=...&format=json&limit=1`, generic User-Agent,
  1 request/second). These are public places. NEVER look up or write the city's origin point.
- Do NOT include `d`/`t`. `events.py` computes them from the fitted origin.

## What to find

Target 8–12 rows per tab, all within roughly a 60-minute drive of the city's anchor
(`place` in CONFIG), weighted to the closest.

**Rollerblading (`skating`)**: flat, smooth places first. Look for paved park loops, paved
rail-trails and riverfront paths that allow inline skating, boardwalks that allow skates, big
flat plazas, and car-free road days (e.g. Sunday closures). Then add indoor roller rinks (note
whether inline rentals exist), seasonal roller sessions, skateparks that allow inline skates,
and the local skate scene: dance-skate circles, group skates and Meetup clubs. Use
user-generated sources (Reddit, Meetup, TrailLink reviews, skater guides) to judge surface
quality and to catch bans: some boardwalks and trails prohibit skates, so leave those out or say so.

**Ice skating (`iceskating`)**: public-skate rinks. Include city and town indoor rinks with
public sessions, outdoor and seasonal rinks (downtown holiday rinks, park rinks), and officially
maintained natural ice where it exists (e.g. groomed lake or canal skating). Include 2026–27
season dates, hours and admission when the venue publishes them. Warm-weather cities still get
their indoor rinks and any holiday pop-up rink.

## Never

- Invent a venue, a date, a price or a rule.
- Include a place you can't confirm still operates (closed rinks, rinks with no current season).
- Include personal information, or any coordinate for the city's origin.
