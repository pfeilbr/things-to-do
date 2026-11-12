# Tests for scripts/meetup.py — stdlib unittest, run with:
#   python3 -m unittest discover -s tests/scripts
import importlib.util, pathlib, unittest
from datetime import datetime

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('meetup', ROOT / 'scripts' / 'meetup.py')
mu = importlib.util.module_from_spec(spec); spec.loader.exec_module(mu)


def ev(t, g='Some Group', d=''):
    return {'t': t, 'g': g, 'd': d}


class Classify(unittest.TestCase):
    def cat(self, *a, **k):
        r = mu.classify(ev(*a, **k))
        return r and r[0]

    def test_interests(self):
        self.assertEqual(self.cat('Mens Indoor Pick-up Basketball in Long Island City'), 'Pickup sports')
        self.assertEqual(self.cat('Tuesday Night Skate (TNS)'), 'Skate meetup')
        self.assertEqual(self.cat('College Park Bicycles Sunday Ride'), 'Group ride')
        self.assertEqual(self.cat('Thursday Night Sunset Run', g='Central Park Runners'), 'Run club')
        self.assertEqual(self.cat('Timba Night (Salsa Social Dance)'), 'Salsa social')
        self.assertEqual(self.cat('Dim Sum Brunch in Chinatown'), 'Chinese culture')
        self.assertEqual(self.cat('Wednesday Night Climbing'), 'Climbing meetup')

    def test_title_beats_group(self):
        # a ski club's beer night is a social, not skiing
        self.assertEqual(self.cat('Tuesday Night Beer Meetup @ Remnant', g='Boston Ski & Snowboard Club'), 'Social mixer')
        self.assertIsNone(self.cat('Chess Club Night', g='SF Salsa Crazy'))
        self.assertEqual(self.cat('Ultimate Karaoke Wednesdays', g='Karaoke Fans'), 'Karaoke night')  # not frisbee

    def test_exclusions(self):
        for t in ['Poker NLH 2/5', 'Bible study on AI', 'Startup Pitch Events NYC', 'ONLINE LIVE- Word Game Party',
                  "40's & Over Mixer", 'Bachata Singles Social - Ages 25–45', 'Game Dev Lunch', 'Support group night']:
            self.assertIsNone(mu.classify(ev(t)), t)


class Strings(unittest.TestCase):
    def test_weekly_days(self):
        self.assertEqual(mu.weekly_days('Every week on Wednesday'), ['Wednesday'])
        self.assertEqual(mu.weekly_days('Every week on Tuesday, Thursday until December 31, 2026'), ['Tuesday', 'Thursday'])
        self.assertIsNone(mu.weekly_days('Every 2 weeks on Friday'))
        self.assertIsNone(mu.weekly_days('Every 3rd Wednesday of the month'))
        self.assertIsNone(mu.weekly_days(None))

    def test_times_match_the_guide_format(self):
        self.assertEqual(mu.times({'dt': '2026-11-12T19:00:00-05:00', 'et': '2026-11-12T21:30:00-05:00'})[1], '7p–9:30p')
        self.assertEqual(mu.times({'dt': '2026-11-13T22:00:00-05:00', 'et': '2026-11-14T02:00:00-05:00'})[1], '10p–2a')
        self.assertEqual(mu.times({'dt': '2026-11-15T09:45:00-05:00', 'et': None})[1], '9:45a')

    def test_clean_name(self):
        self.assertEqual(mu.clean_name('[17 spots] JJ Walker - Wed 6pm'), 'JJ Walker - Wed 6pm')
        self.assertEqual(mu.clean_name('THU. INDOOR SESSION 1: $1 Off RSVP By Wed, 8pm'), 'Thu. Indoor Session 1')
        self.assertNotIn('"', mu.clean_name('"Snag Yourself A Hero" Singles Mixer'))
        self.assertEqual(mu.clean_name('NOV 12, 6:15 pm - Urban Stair Climbing Hike'), 'Urban Stair Climbing Hike')

    def test_summaries_drop_logistics(self):
        d = mu.clean_desc('Please RSVP by Friday! Join us every Sunday for free salsa in the park. Call 917-555-0100 for info.')
        self.assertEqual(mu.first_sentences(d), 'Join us every Sunday for free salsa in the park.')


if __name__ == '__main__':
    unittest.main()
