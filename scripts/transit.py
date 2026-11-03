#!/usr/bin/env python3
"""Commuter-rail timetables for the guides' "train to the city" panel (stdlib only).

    python3 scripts/transit.py build              # every city in TRANSIT, writes transit-<city>.json
    python3 scripts/transit.py build stamford     # one city
    python3 scripts/transit.py build --gtfs path/to/feed.zip --today 2026-11-02   # offline / tests
    python3 scripts/transit.py status             # how many days of timetable each file has left
    python3 scripts/transit.py status --min-days 14   # ...and exit 1 if any has fewer (CI alarm)

The page cannot read a GTFS zip (4 MB, every visit), so this bakes the slice it needs:
direct trains between a city's home stations and its hub, for the next WINDOW_DAYS days,
deduplicated so a train that runs the same times on many dates is stored once with a
day bitmask. The page then overlays the agency's live GTFS-realtime feed (CORS-open) on
top, by train number. `.github/workflows/transit.yml` reruns `build` weekly, so keeping
this current needs no one.

Output (transit-<city>.json):
    home    ["NH", ...]        keys of the stations you can start from
    stops   [{k, n, id, ll, mi}]   home stations first (mi = track miles to the hub), then
                               via stops, hub last
    days    ["YYYYMMDD", ...]  the service dates covered, day 0 first
    trains  [[num, dir, peak, mask, [min, ...]]]
            dir 1 = toward the hub, 0 = home; peak 1/0 from the feed's peak_offpeak;
            mask bit i = runs on days[i]; minutes after midnight of the service date per
            stop in `stops` order (null = doesn't stop, or can't board/alight there in that
            direction). Times past 1440 are after-midnight runs of the same service day.
"""
import argparse, csv, datetime as dt, io, json, math, os, pathlib, sys, tempfile, time, urllib.request, zipfile
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parent.parent
WINDOW_DAYS = 28

TRANSIT = {
    'stamford': {
        'file': 'transit-stamford.json',
        'agency': 'Metro-North Railroad',
        'line': 'New Haven Line',
        'gtfs': 'https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip',
        'rt': 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr',
        # home stations (nearest first), then stops on the way, the hub last
        'home': [('NH', 'Noroton Heights'), ('DA', 'Darien'), ('SM', 'Stamford')],
        'via': [('125', 'Harlem-125 St')],
        'hub': ('GCT', 'Grand Central'),
    },
}


def load_gtfs(src):
    """{name: rows} for the four files we read, from a URL or a local zip."""
    if src.startswith('http'):
        blob = fetch(src)
    else:
        blob = pathlib.Path(src).read_bytes()
    z = zipfile.ZipFile(io.BytesIO(blob))
    read = lambda n: list(csv.DictReader(io.TextIOWrapper(z.open(n), encoding='utf-8-sig')))
    have = set(z.namelist())
    return {n: read(n + '.txt') if n + '.txt' in have else []
            for n in ('stops', 'trips', 'stop_times', 'calendar_dates', 'shapes')}


def fetch(url, tries=3, wait=5, opener=None):
    """GET with retries: one dropped connection to S3 shouldn't fail the weekly refresh.
    Waits wait, then 2*wait, ... seconds between attempts."""
    opener = opener or urllib.request.urlopen
    req = urllib.request.Request(url, headers={'User-Agent': 'things-to-do-transit/1.0'})
    for i in range(tries):
        try:
            with opener(req, timeout=120) as r:
                return r.read()
        except OSError as e:   # URLError, HTTPError, timeouts and resets are all OSErrors
            if i == tries - 1:
                raise
            print(f'  fetch failed ({e}); retrying in {wait * 2 ** i}s', file=sys.stderr)
            time.sleep(wait * 2 ** i)


def write_atomic(path, text):
    """Write via a temp file in the same folder, then rename: an interrupted run leaves the
    old timetable in place instead of a half-written one the page can't parse."""
    path = pathlib.Path(path)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.' + path.name, suffix='.tmp')
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        pathlib.Path(tmp).unlink(missing_ok=True)
        raise


def service_dates(g):
    """service_id -> set of YYYYMMDD. Metro-North publishes calendar_dates only; a feed
    with calendar.txt would need its weekday ranges expanded here too."""
    on = defaultdict(set)
    for r in g['calendar_dates']:
        (on[r['service_id']].add if r['exception_type'] == '1' else on[r['service_id']].discard)(r['date'])
    return on


def hav_mi(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 2 * 3958.8 * math.asin(math.sqrt(h))


def track_miles(g, trip_ids, a, b):
    """Miles along the line between stop coords a and b, measured on the shape of the first
    trip that has one (the feed leaves shape_dist_traveled blank, so walk the polyline)."""
    shape_of = {t['trip_id']: t.get('shape_id') for t in g['trips']}
    pts = defaultdict(list)
    for r in g['shapes']:
        pts[r['shape_id']].append((int(r['shape_pt_sequence']), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
    for tid in trip_ids:
        line = [(la, lo) for _, la, lo in sorted(pts.get(shape_of.get(tid), []))]
        if len(line) < 2:
            continue
        near = lambda p: min(range(len(line)), key=lambda i: hav_mi(line[i], p))
        i, j = sorted((near(a), near(b)))
        return round(sum(hav_mi(line[k], line[k + 1]) for k in range(i, j)), 1)
    return None


def minutes(hms):
    h, m, _ = (int(x) for x in hms.split(':'))
    return h * 60 + m


def build(city, g, today):
    cfg = TRANSIT[city]
    order = cfg['home'] + cfg['via'] + [cfg['hub']]
    by_name = {r['stop_name']: r for r in g['stops']}
    missing = [n for _, n in order if n not in by_name]
    if missing:
        raise SystemExit(f'{city}: stops not in the feed: {missing}')
    sid = {by_name[n]['stop_id']: i for i, (_, n) in enumerate(order)}
    hub_i, n_home = len(order) - 1, len(cfg['home'])

    days = [(today + dt.timedelta(days=i)).strftime('%Y%m%d') for i in range(WINDOW_DAYS)]
    on = service_dates(g)
    trips = {t['trip_id']: t for t in g['trips']}
    seen = defaultdict(lambda: [None] * len(order))
    for st in g['stop_times']:
        i = sid.get(st['stop_id'])
        if i is None:
            continue
        seen[st['trip_id']][i] = (minutes(st['departure_time'] or st['arrival_time']),
                                  st['pickup_type'] != '1', st['drop_off_type'] != '1')

    merged, sample = {}, defaultdict(list)
    for tid, stops in seen.items():
        t = trips[tid]
        to_hub = t['direction_id'] == '1'
        # board at home and alight at the hub, or the reverse
        def usable(i, s):
            if s is None:
                return None
            board, alight = s[1], s[2]
            if i == hub_i:
                return s[0] if (alight if to_hub else board) else None
            if i < n_home:
                return s[0] if (board if to_hub else alight) else None
            return s[0] if (alight if to_hub else board) else None   # via: on the city side of the trip
        times = [usable(i, s) for i, s in enumerate(stops)]
        if times[hub_i] is None or not any(x is not None for x in times[:n_home]):
            continue
        mask = sum(1 << i for i, d in enumerate(days) if d in on[t['service_id']])
        if not mask:
            continue
        key = (t['trip_short_name'], int(to_hub), int(t.get('peak_offpeak') == '1'), tuple(times))
        for i in range(n_home):
            if times[i] is not None:
                sample[i].append(tid)
        merged[key] = merged.get(key, 0) | mask

    first = lambda k: min(x for x in k[3] if x is not None)
    trains = [[k[0], k[1], k[2], m, list(k[3])] for k, m in sorted(merged.items(), key=lambda kv: (kv[0][1], first(kv[0])))]
    stops = [{'k': k, 'n': n, 'id': by_name[n]['stop_id'],
              'll': [round(float(by_name[n]['stop_lat']), 4), round(float(by_name[n]['stop_lon']), 4)]}
             for k, n in order]
    hub_ll = stops[hub_i]['ll']
    for i in range(n_home):
        stops[i]['mi'] = track_miles(g, sample[i], stops[i]['ll'], hub_ll)
    return {'agency': cfg['agency'], 'line': cfg['line'], 'rt': cfg['rt'], 'source': cfg['gtfs'],
            'built': today.isoformat(), 'home': [k for k, _ in cfg['home']], 'stops': stops, 'days': days, 'trains': trains}


def cmd_build(args):
    today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()
    cities = args.cities or list(TRANSIT)
    feeds = {}
    for city in cities:
        if city not in TRANSIT:
            raise SystemExit(f'unknown city {city}; known: {", ".join(TRANSIT)}')
        src = args.gtfs or TRANSIT[city]['gtfs']
        if src not in feeds:
            feeds[src] = load_gtfs(src)
        out = build(city, feeds[src], today)
        path = ROOT / TRANSIT[city]['file'] if not args.out else pathlib.Path(args.out)
        per_day = [sum(1 for t in out['trains'] if t[3] >> i & 1) for i in range(len(out['days']))]
        print(f"{TRANSIT[city]['file']}: {len(out['trains'])} trains, {min(per_day)}-{max(per_day)} a day, "
              f"{out['days'][0]}..{out['days'][-1]}")
        if not min(per_day):
            print(f'  warning: no trains on {out["days"][per_day.index(0)]} — does the published feed end early?')
        if not args.dry_run:
            write_atomic(path, json.dumps(out, separators=(',', ':')) + '\n')


def cmd_status(args):
    today = dt.date.fromisoformat(args.today) if args.today else dt.date.today()
    short = []
    for city, cfg in TRANSIT.items():
        p = ROOT / cfg['file']
        if not p.exists():
            print(f"{cfg['file']}: missing — run build"); short.append(cfg['file']); continue
        d = json.loads(p.read_text())
        last = dt.datetime.strptime(d['days'][-1], '%Y%m%d').date()
        left = (last - today).days
        print(f"{cfg['file']}: built {d['built']}, covers through {last} ({left} days left)")
        if args.min_days is not None and left < args.min_days:
            short.append(cfg['file'])
    if args.min_days is not None and short:
        raise SystemExit(f"under {args.min_days} days of timetable left: {', '.join(short)}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    b = sub.add_parser('build'); b.add_argument('cities', nargs='*')
    b.add_argument('--gtfs', help='local GTFS zip or URL instead of the configured feed')
    b.add_argument('--today'); b.add_argument('--out'); b.add_argument('--dry-run', action='store_true')
    s = sub.add_parser('status'); s.add_argument('--today')
    s.add_argument('--min-days', type=int, help='exit 1 if any timetable has fewer days left')
    a = ap.parse_args(argv)
    {'build': cmd_build, 'status': cmd_status}[a.cmd](a)


if __name__ == '__main__':
    main()
