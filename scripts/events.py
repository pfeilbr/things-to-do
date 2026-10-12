#!/usr/bin/env python3
"""Events maintenance for the dated `events` tabs, plus distance-computed row adds to any tab (stdlib only).

    python3 scripts/events.py status            # upcoming counts per guide
    python3 scripts/events.py prune [--dry-run] # drop one-offs whose dates have passed
    python3 scripts/events.py add data-nyc.json rows.json [--dry-run]
    python3 scripts/events.py add data-nyc.json rows.json --tab museums   # any tab

`add` takes a JSON array of researched rows ({n, c, s, u, w, ll} plus optional r/rc)
and computes each row's d/t with the documented formula (haversine x1.3 road factor,
mph = min(55, 24 + 0.45 d)). The origin is NOT stored anywhere: it is fitted at run
time to the city's existing rows, so new rows agree with the baked distances exactly
and no origin coordinate ever lands in the repo. `--today YYYY-MM-DD` overrides the
date (tests use it).
"""
import argparse, datetime as dt, json, math, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
MD = re.compile(r'(\d{1,2})/(\d{1,2})')
SAME_MONTH_END = re.compile(r'(\d{1,2})/(\d{1,2})\s*[–-]\s*(\d{1,2})(?![\d/])')


def last_explicit_date(w, today):
    """Port of lastExplicitDate() in tests/data/freshness.test.js — keep them in step."""
    dates = [(int(a), int(b)) for a, b in MD.findall(w)]
    dates += [(int(m.group(1)), int(m.group(3))) for m in SAME_MONTH_END.finditer(w)]
    dates = [(mo, d) for mo, d in dates if 1 <= mo <= 12 and 1 <= d <= 31]
    if not dates:
        return None                     # recurring / evergreen
    last = None
    for mo, d in dates:
        year = today.year + (1 if mo < today.month - 6 else 0)   # Dec->Jan spans roll forward
        day = dt.date(year, mo, 1) + dt.timedelta(days=d - 1)    # JS Date overflow semantics
        last = day if last is None or day > last else last
    return last


def hav_mi(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 2 * 3958.8 * math.asin(math.sqrt(h))


def drive(d):
    return max(1, round(d / min(55, 24 + 0.45 * d) * 60))


def fit_origin(rows):
    """Least-squares point whose 1.3 x haversine best reproduces the rows' baked d."""
    pts = [r for r in rows if r.get('ll') and r['d'] < 60]
    if len(pts) < 3:
        raise SystemExit('need at least 3 rows with ll to fit an origin')
    cost = lambda o: sum((hav_mi(o, r['ll']) * 1.3 - r['d']) ** 2 for r in pts)
    o = list(min(pts, key=lambda r: r['d'])['ll'])               # nearest row as the seed
    step = 0.05
    while step > 1e-6:
        best = min(([o[0] + a * step, o[1] + b * step] for a in (-1, 0, 1) for b in (-1, 0, 1)), key=cost)
        if best == o:
            step /= 2
        else:
            o = best
    return o, math.sqrt(cost(o) / len(pts))


def load(path):
    raw = path.read_text()
    return json.loads(raw), '\n' in raw


def save(path, data, pretty):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) if pretty
                    else json.dumps(data, ensure_ascii=False, separators=(',', ':')))


def event_files(root):
    return [p for p in sorted(root.glob('data*.json')) if 'events' in load(p)[0]]


def cmd_status(root, today):
    for p in event_files(root):
        ev = load(p)[0]['events']
        lasts = [last_explicit_date(r['w'], today) for r in ev]
        past = sum(1 for l in lasts if l and l < today)
        soon = sum(1 for l in lasts if l and today <= l <= today + dt.timedelta(days=14))
        latest = max((l for l in lasts if l), default=None)
        print(f'{p.name:24} {len(ev):3} events  {past:3} past  {soon:3} in next 14d  latest {latest}')


def cmd_prune(root, today, dry):
    total = 0
    for p in event_files(root):
        data, pretty = load(p)
        gone = [r['n'] for r in data['events'] if (l := last_explicit_date(r['w'], today)) and l < today]
        if not gone:
            continue
        total += len(gone)
        print(f'{p.name}: pruning {len(gone)}: ' + '; '.join(gone))
        if not dry:
            data['events'] = [r for r in data['events'] if r['n'] not in set(gone)]
            save(p, data, pretty)
    print(f'{total} past event(s) {"would be " if dry else ""}removed')


REQUIRED = ('n', 'c', 's', 'u', 'll')
WHEN_TABS = ('events', 'social')        # tabs with a When column: rows need a `w` string


def cmd_add(root, file, src, dry, tab='events'):
    path = root / file
    data, pretty = load(path)
    if tab not in data:
        raise SystemExit(f'{file} has no {tab} tab')
    required = REQUIRED + (('w',) if tab in WHEN_TABS else ())
    existing = [r for rows in data.values() for r in rows]
    names = {r['n'] for r in existing}
    origin, rms = fit_origin(existing)
    if rms > 0.5:
        raise SystemExit(f'{file}: origin fit is poor (rms {rms:.2f} mi) — check the baked distances')
    added = skipped = 0
    for r in json.loads(pathlib.Path(src).read_text()):
        missing = [k for k in required if not r.get(k)]
        if missing:
            print(f'  skip "{r.get("n")}": missing {missing}'); skipped += 1; continue
        if r['n'] in names:
            print(f'  skip "{r["n"]}": name already in {file}'); skipped += 1; continue
        ll = [round(r['ll'][0], 4), round(r['ll'][1], 4)]
        d = round(hav_mi(origin, ll) * 1.3, 1)
        new = {'n': r['n'], 'c': r['c'], 's': r['s'], 'd': d, 't': drive(d), 'u': r['u'],
               'r': r.get('r'), 'rc': r.get('rc'), 'll': ll}
        if tab in WHEN_TABS:
            new['w'] = r['w']
        data[tab].append(new)
        names.add(r['n']); added += 1
    if not dry:
        save(path, data, pretty)
    print(f'{file}: {added} added, {skipped} skipped, {len(data[tab])} {tab} (origin fit rms {rms:.2f} mi)')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--root', type=pathlib.Path, default=ROOT)
    ap.add_argument('--today', type=dt.date.fromisoformat, default=dt.date.today())
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('status')
    pr = sub.add_parser('prune'); pr.add_argument('--dry-run', action='store_true')
    ad = sub.add_parser('add'); ad.add_argument('file'); ad.add_argument('rows'); ad.add_argument('--dry-run', action='store_true')
    ad.add_argument('--tab', default='events', help='tab to append to (default: events)')
    a = ap.parse_args(argv)
    if a.cmd == 'status':
        cmd_status(a.root, a.today)
    elif a.cmd == 'prune':
        cmd_prune(a.root, a.today, a.dry_run)
    else:
        cmd_add(a.root, a.file, a.rows, a.dry_run, a.tab)


if __name__ == '__main__':
    sys.exit(main())
