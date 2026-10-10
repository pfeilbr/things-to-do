# Tests for scripts/events.py — stdlib unittest, run with:
#   python3 -m unittest discover -s tests/scripts
import datetime as dt, importlib.util, json, pathlib, subprocess, sys, tempfile, unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('events', ROOT / 'scripts' / 'events.py')
ev = importlib.util.module_from_spec(spec); spec.loader.exec_module(ev)

TODAY = dt.date(2026, 10, 10)
# A synthetic origin for the fixtures — a made-up point, not any city's real origin.
FAKE_ORIGIN = (41.0, -74.5)


def row(n, ll, **kw):
    d = round(ev.hav_mi(FAKE_ORIGIN, ll) * 1.3, 1)
    return {'n': n, 'c': 'X', 's': f'about {n}', 'd': d, 't': ev.drive(d), 'u': None, 'r': None, 'rc': None, 'll': list(ll), **kw}


class LastExplicitDate(unittest.TestCase):
    def check(self, w, want):
        self.assertEqual(ev.last_explicit_date(w, TODAY), want, w)

    def test_forms(self):
        self.check('Sat 10/17 · 8p', dt.date(2026, 10, 17))
        self.check('Fri–Sun 10/16–18', dt.date(2026, 10, 18))
        self.check('Sat 9/26 · 10a–5p', dt.date(2026, 9, 26))
        self.check('10/12 – 11/10', dt.date(2026, 11, 10))
        self.check('Sat 11/21 – Mon 1/4', dt.date(2027, 1, 4))      # wraps the year
        self.check('Saturdays · 9a–1p', None)                       # recurring
        self.check('Thursdays · 6p (Apr–Nov)', None)

    def test_matches_node_freshness_logic(self):
        # same strings through the JS original; skipped when node isn't installed
        ws = ['Sat 10/17 · 8p', 'Fri–Sun 10/16–18', '10/12 – 11/10', 'Sat 11/21 – Mon 1/4', 'Saturdays · 9a–1p', 'Sun 2/30']
        src = (ROOT / 'tests/data/freshness.test.js').read_text()
        fn = src[src.index('function lastExplicitDate'):src.index('const now = new Date()')]
        js = fn + ('const now = new Date(2026, 9, 10);' + f'const ws = {json.dumps(ws)};' +
                   'console.log(JSON.stringify(ws.map(w => { const d = lastExplicitDate(w, now);' +
                   ' return d && [d.getFullYear(), d.getMonth() + 1, d.getDate()]; })));')
        try:
            out = subprocess.run(['node', '-e', js], capture_output=True, text=True, check=True).stdout
        except FileNotFoundError:
            self.skipTest('node not installed')
        for w, got in zip(ws, json.loads(out)):
            py = ev.last_explicit_date(w, TODAY)
            self.assertEqual(py and [py.year, py.month, py.day], got, w)


class Distances(unittest.TestCase):
    def test_drive_formula(self):
        self.assertEqual(ev.drive(0.1), 1)          # floor of 1 minute
        self.assertEqual(ev.drive(10), 21)          # 10 / 28.5 mph
        self.assertEqual(ev.drive(100), 109)        # capped at 55 mph

    def test_fit_recovers_origin(self):
        rows = [row(f'r{i}', ll) for i, ll in enumerate([(41.02, -74.48), (40.9, -74.6), (41.1, -74.3), (40.95, -74.7), (41.2, -74.55)])]
        o, rms = ev.fit_origin(rows)
        self.assertLess(ev.hav_mi(o, FAKE_ORIGIN), 0.2)
        self.assertLess(rms, 0.1)


class Commands(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = pathlib.Path(self.tmp.name)
        spots = [row(f's{i}', ll) for i, ll in enumerate([(41.01, -74.49), (40.92, -74.61), (41.08, -74.33), (40.97, -74.68)])]
        events = [row('Past show', (41.0, -74.4), w='Sat 10/3 · 8p'), row('Future show', (41.0, -74.4), w='Sat 10/24 · 8p'),
                  row('Weekly market', (41.0, -74.4), w='Saturdays · 9a–1p')]
        (self.root / 'data-x.json').write_text(json.dumps({'spots': spots, 'events': events}, separators=(',', ':')))
        (self.root / 'data-y.json').write_text(json.dumps({'spots': spots}, indent=1))   # no events tab

    def tearDown(self):
        self.tmp.cleanup()

    def data(self):
        return json.loads((self.root / 'data-x.json').read_text())

    def run_cli(self, *args):
        ev.main(['--root', str(self.root), '--today', '2026-10-10', *args])

    def test_prune_drops_only_past_one_offs_and_keeps_format(self):
        self.run_cli('prune')
        self.assertEqual([r['n'] for r in self.data()['events']], ['Future show', 'Weekly market'])
        self.assertNotIn('\n', (self.root / 'data-x.json').read_text())    # compact stays compact

    def test_prune_dry_run_writes_nothing(self):
        before = (self.root / 'data-x.json').read_text()
        self.run_cli('prune', '--dry-run')
        self.assertEqual((self.root / 'data-x.json').read_text(), before)

    def test_add_computes_distance_and_skips_bad_rows(self):
        src = self.root / 'new.json'
        src.write_text(json.dumps([
            {'n': 'New gig', 'c': 'Concert', 's': 'x', 'u': 'https://e.x', 'w': 'Fri 10/30 · 8p', 'll': [41.05, -74.45]},
            {'n': 'Future show', 'c': 'Concert', 's': 'x', 'u': 'https://e.x', 'w': 'Sat 10/24', 'll': [41.0, -74.4]},  # dup
            {'n': 'No coords', 'c': 'Concert', 's': 'x', 'u': 'https://e.x', 'w': 'Sat 10/24'},                     # no ll
        ]))
        self.run_cli('add', 'data-x.json', str(src))
        new = [r for r in self.data()['events'] if r['n'] == 'New gig']
        self.assertEqual(len(new), 1)
        self.assertEqual(len(self.data()['events']), 4)
        want = round(ev.hav_mi(FAKE_ORIGIN, (41.05, -74.45)) * 1.3, 1)
        self.assertLessEqual(abs(new[0]['d'] - want), 0.1)
        self.assertEqual(new[0]['t'], ev.drive(new[0]['d']))
        self.assertEqual(list(new[0])[-1], 'w')

    def test_event_files_skips_guides_without_events(self):
        self.assertEqual([p.name for p in ev.event_files(self.root)], ['data-x.json'])


class RealData(unittest.TestCase):
    def test_every_events_guide_fits_its_origin(self):
        # the baked distances must be self-consistent enough for `add` to work on every guide
        for p in ev.event_files(ROOT):
            data = json.loads(p.read_text())
            _, rms = ev.fit_origin([r for rows in data.values() for r in rows])
            self.assertLess(rms, 0.5, p.name)


if __name__ == '__main__':
    unittest.main()
