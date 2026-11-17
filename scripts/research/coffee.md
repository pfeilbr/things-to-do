# Research brief: `coffee` (Coffee) tab

The repeatable recipe for filling, or refreshing, the Coffee tab for any city: popular coffee
shops with Wi-Fi where you can actually sit and work on a laptop. Stamford
(`data-stamford.json`) was the pilot. Read its `coffee` rows first, because they set the voice,
length and level of detail. Ithaca's `coffee` tab is the exception: it is a campus-café guide and
keeps its own voice.

## Output: one file per city

Write a JSON array to `<rows-dir>/<data-file-stem>.coffee.json`, where the stem is the city's data
file without `.json` (`data-nyc.coffee.json`; Philly's file is `data.json`, so `data.coffee.json`).
Then import everything with:

    python3 scripts/events.py import <rows-dir> --new-tab     # --dry-run first to preview
    python3 scripts/events.py coverage --tab coffee --min 8

Each row looks like this:

    {"n": "Name", "c": "Category", "s": "Summary", "u": "https://source", "r": 4.6, "rc": 812, "ll": [lat, lon]}

- **`n`**: the café's name, with the branch in parentheses when the name alone is ambiguous
  ("Gregorys Coffee (Greenwich Ave)"). It must be unique within that city's file across all tabs,
  with one exception: a café already in the city's `remote` tab may be listed again under its
  exact `remote` name (the consistency test allows the `remote`/`coffee` pair). `events.py add`
  skips names already in the file, so land those rows by copying `d`/`t`/`ll` from the `remote`
  row, and write a new summary: the quality suite rejects identical summaries.
- **`c`**: use ONLY these spellings: `Indie café`, `Roaster`, `Chain café`, `Bakery café`,
  `Tea house`, `Bookstore café`, `Brewery café`, `Library café`.
- **`s`**: 120–380 characters, in the guide's voice. Lead with the address or neighborhood, then
  what matters for working: Wi-Fi (and any time limit or password-on-receipt rule), seats and
  outlets, noise, the laptop policy (some shops ban laptops on weekends: say so), hours when
  published, and one line on the coffee or food. No hype, and no claim the source doesn't support.
  Every summary must be unique across the whole repo.
- **`u`**: the source that supports the row, Wi-Fi claim included. Prefer local press and
  laptop-café guides (Eater, the city's alt-weekly, StudyAnywhere, Workfrom), then the café's
  own site.
- **`r`/`rc`**: the rating and review count only when a source gives both; otherwise `null`.
  Popularity sorts the tab (`r × rc`).
- **`ll`**: the café's coordinates, from OpenStreetMap Nominatim
  (`https://nominatim.openstreetmap.org/search?q=...&format=json&limit=1`, generic User-Agent,
  1 request/second). These are public places. NEVER look up or write the city's origin point.
- Do NOT include `d`/`t`. `events.py` computes them from the fitted origin.

## What to find

Target 10–14 rows, all within roughly a 30-minute drive of the city's anchor (`place` in
CONFIG), weighted to the closest and to the neighborhoods people actually work from. Forest Hills
is a walking-distance guide, so its rows stay near Austin St. Popular means many reviews and a
good rating, or a named pick in a local "best cafés to work from" list. Mix indie shops and the
city's own roasters; a chain earns a row only when it is the best laptop bet in its area (big
seating, reliable Wi-Fi). Neighboring guides (NYC / Brooklyn / Queens / Flushing / Forest Hills)
should not repeat each other's cafés.

## Never

- Include a café that bans laptops, has no Wi-Fi, has no indoor seating, or that you can't
  confirm still operates.
- Invent a rating, an hour or a policy.
- Include personal information, or any coordinate for the city's origin.
