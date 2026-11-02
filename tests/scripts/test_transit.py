# Tests for scripts/transit.py — stdlib unittest, run with:
#   python3 -m unittest discover -s tests/scripts
# A tiny synthetic GTFS feed stands in for Metro-North's: three stations on a line, a hub,
# trains that run on different service days, a train that only drops off, and one that
# never reaches the hub.
import datetime as dt, importlib.util, io, json, pathlib, tempfile, unittest, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('transit', ROOT / 'scripts' / 'transit.py')
tr = importlib.util.module_from_spec(spec); spec.loader.exec_module(tr)

TODAY = dt.date(2026, 11, 2)   # a Monday

STOPS = [('1', 'Hub', 40.75, -73.98), ('4', 'Via', 40.80, -73.94),
         ('124', 'Home C', 41.05, -73.54), ('127', 'Home A', 41.07, -73.50), ('128', 'Home B', 41.08, -73.47)]
TRIPS = [  # route, service, trip, short name, direction, peak, shape
    ('3', 'WK', 't1', '1001', '1', '1', 's1'),
    ('3', 'WE', 't2', '2001', '1', '0', 's1'),
    ('3', 'WK', 't3', '1002', '0', '0', 's1'),
    ('3', 'WK', 't4', '1003', '1', '0', 's1'),   # skips the hub (short turn): dropped
    ('3', 'WE', 't5', '2001', '1', '0', 's1'),   # same times as t2 on another service: merged
]
TIMES = [  # trip, stop, time, pickup, dropoff
    ('t1', '128', '07:00:00', '0', '1'), ('t1', '127', '07:04:00', '0', '1'), ('t1', '124', '07:12:00', '0', '1'),
    ('t1', '4', '07:55:00', '1', '0'), ('t1', '1', '08:06:00', '1', '0'),
    ('t2', '127', '09:30:00', '0', '1'), ('t2', '1', '10:35:00', '1', '0'),
    ('t3', '1', '25:10:00', '0', '1'), ('t3', '124', '26:05:00', '1', '0'), ('t3', '127', '26:12:00', '1', '0'),
    ('t4', '127', '11:00:00', '0', '1'), ('t4', '124', '11:08:00', '1', '0'),
    ('t5', '127', '09:30:00', '0', '1'), ('t5', '1', '10:35:00', '1', '0'),
]
CAL = [('WK', d, '1') for d in ('20261102', '20261103', '20261104', '20261105', '20261106')] + \
      [('WE', '20261107', '1'), ('WE', '20261108', '1')] + [('WK', '20261103', '2')]   # 11/3 removed


def gtfs_zip():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('stops.txt', 'stop_id,stop_name,stop_lat,stop_lon\n' + ''.join(f'{a},{b},{c},{d}\n' for a, b, c, d in STOPS))
        z.writestr('trips.txt', 'route_id,service_id,trip_id,trip_short_name,direction_id,peak_offpeak,shape_id\n'
                   + ''.join(','.join(t) + '\n' for t in TRIPS))
        z.writestr('stop_times.txt', 'trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\n'
                   + ''.join(f'{t},{tm},{tm},{s},0,{p},{d}\n' for t, s, tm, p, d in TIMES))
        z.writestr('calendar_dates.txt', 'service_id,date,exception_type\n' + ''.join(','.join(c) + '\n' for c in CAL))
        z.writestr('shapes.txt', 'shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n'
                   + ''.join(f's1,{la},{lo},{i}\n' for i, (_, _, la, lo) in enumerate(sorted(STOPS, key=lambda s: s[2]))))
    return buf.getvalue()


class Build(unittest.TestCase):
    def setUp(self):
        tr.TRANSIT['test'] = {'file': 'x.json', 'agency': 'A', 'line': 'L', 'gtfs': '', 'rt': 'https://rt.example/feed',
                              'home': [('A', 'Home A'), ('B', 'Home B'), ('C', 'Home C')], 'via': [('V', 'Via')], 'hub': ('H', 'Hub')}
        self.tmp = tempfile.TemporaryDirectory()
        self.zip = pathlib.Path(self.tmp.name) / 'g.zip'
        self.zip.write_bytes(gtfs_zip())
        self.out = tr.build('test', tr.load_gtfs(str(self.zip)), TODAY)

    def tearDown(self):
        del tr.TRANSIT['test']; self.tmp.cleanup()

    def train(self, num, d):
        return [t for t in self.out['trains'] if t[0] == num and t[1] == d]

    def test_shape(self):
        o = self.out
        self.assertEqual(o['home'], ['A', 'B', 'C'])
        self.assertEqual([s['k'] for s in o['stops']], ['A', 'B', 'C', 'V', 'H'])
        self.assertEqual(len(o['days']), tr.WINDOW_DAYS)
        self.assertEqual(o['days'][0], '20261102')
        self.assertTrue(all('mi' in s for s in o['stops'][:3]))
        self.assertTrue(o['stops'][0]['mi'] > 0)

    def test_times_masks_and_peak(self):
        [t1] = self.train('1001', 1)
        self.assertEqual(t1[2], 1)                                   # peak
        self.assertEqual(t1[4], [424, 420, 432, 475, 486])           # A B C via hub, minutes
        self.assertEqual(t1[3], 0b11101)                             # Mon, Wed-Fri: Tue removed

    def test_after_midnight_and_reverse_direction(self):
        [t3] = self.train('1002', 0)
        self.assertEqual(t3[4][4], 25 * 60 + 10)                     # leaves the hub at 1:10a, same service day
        self.assertEqual(t3[4][0], 26 * 60 + 12)

    def test_duplicates_merge_and_short_turns_drop(self):
        self.assertEqual(len(self.train('2001', 1)), 1)
        self.assertEqual(self.train('2001', 1)[0][3], 0b1100000)     # Sat + Sun
        self.assertEqual(self.train('1003', 1), [])                  # never reaches the hub

    def test_no_boarding_where_pickup_is_forbidden(self):
        # the via stop is drop-off only toward the hub: kept (time to alight there)
        [t1] = self.train('1001', 1)
        self.assertIsNotNone(t1[4][3])

    def test_cli_writes_and_status_reads(self):
        out = pathlib.Path(self.tmp.name) / 'o.json'
        tr.main(['build', 'test', '--gtfs', str(self.zip), '--today', '2026-11-02', '--out', str(out)])
        d = json.loads(out.read_text())
        self.assertEqual(d['days'][0], '20261102')
        self.assertEqual(d['rt'], 'https://rt.example/feed')


if __name__ == '__main__':
    unittest.main()
