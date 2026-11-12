#!/usr/bin/env python3
"""Meetup events for every city guide: pull live, keep what the owner is into, import.

Meetup only answers its event search for a signed-in browser, so the pull runs inside
Chrome (Claude in Chrome, on any meetup.com page) and the rest runs here:

  1. python3 scripts/meetup.py snippet [--start 2026-11-12] [--days 7]
       prints the JavaScript to run in the meetup.com tab. It searches every city's area
       for in-person events (an empty query plus ~30 interest keywords), keeps the results
       in window.__MU, and copies them out through a textarea + Cmd-A/Cmd-C, a city batch at
       a time (the page can't post to localhost). `pbpaste > .cache/meetup/raw-<date>.json`.
  2. python3 scripts/meetup.py curate .cache/meetup/raw-<date>.json <outdir>
       classifies each event (pickup sports, rides, runs, skating, climbing, hikes, dance,
       socials, sushi, Chinese culture…), drops what the guide isn't for (poker, church,
       networking, online, age- or identity-restricted groups…), dedupes cross-posts,
       caps each city at 40 rows (8 per category, 2 per Meetup group), and writes
       <data-stem>.events.json (dated one-offs) and <data-stem>.social.json (weekly series).
  3. python3 scripts/events.py import <outdir>   (then `prune`, the tests, BUILD bump)

Search centres are fitted from each guide's own nearest rows at run time; no origin
coordinate is stored anywhere. The raw pull stays in .cache/ (git-ignored) so it never has
to be fetched twice. Venue-less events (Meetup hides the venue from non-members) are
skipped: a row without `ll` can't be placed. Small cities need a hand pass afterwards.
"""
import json, re, sys, os, math, html, collections, argparse, glob
from datetime import datetime, date, timedelta

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAP = 40
# search radius in miles: neighbourhood guides tight, metro guides wide
RADIUS = {'foresthills': 4, 'flushing': 4, 'queens': 7, 'brooklyn': 6, 'nyc': 5, 'philly': 20, 'ithaca': 25,
          'verona': 45, 'stamford': 25, 'boston': 10, 'la': 20, 'ac': 30, 'vb': 20, 'buffalo': 25, 'cleveland': 25}
UTC_OFFSET = {'chicago': '-06:00', 'nashville': '-06:00', 'la': '-08:00', 'sf': '-08:00', 'seattle': '-08:00', 'sandiego': '-08:00'}


def centers():
    """Each guide's search centre: the mean of its 12 nearest rows (public venues)."""
    idx = open(os.path.join(REPO, 'index.html')).read()
    out = {}
    for cid, f in re.findall(r'\{ id:"(\w+)".*?data:"([^"]+)"', idx, re.S):
        D = json.load(open(os.path.join(REPO, f)))
        rows = sorted((r for t in D.values() for r in t if r.get('ll') and r.get('d') is not None), key=lambda r: r['d'])[:12]
        out[cid] = dict(id=cid, file=f, lat=round(sum(r['ll'][0] for r in rows) / len(rows), 3),
                        lon=round(sum(r['ll'][1] for r in rows) / len(rows), 3))
    return out


SNIPPET = r"""(async()=>{window.__MU={};window.__MUdone=false;
const C=%(cities)s;
const KW=%(kw)s;
const q=`query($f: EventSearchFilter!,$a:String){ eventSearch(filter:$f, first:100, after:$a){ pageInfo{hasNextPage endCursor} edges{ node{ id title dateTime endTime eventUrl isOnline venue{name address city lat lon} group{name urlname} rsvps{totalCount} maxTickets feeSettings{amount currency} series{description} description } } } }`;
for(const [id,lat,lon,rad,tz] of C){ const all=new Map();
  await Promise.all(KW.map(async k=>{let a=null,p=0;try{do{
    const r=await fetch('/gql2',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:q,variables:{a,f:{query:k,lat,lon,radius:rad,eventType:'PHYSICAL',startDateRange:'%(start)sT00:00:00'+tz,endDateRange:'%(end)sT23:59:00'+tz}}})});
    const j=await r.json();const es=j.data&&j.data.eventSearch;if(!es)break;
    for(const {node:n} of es.edges){ if(n.isOnline) continue; const o=all.get(n.id)||{id:n.id,t:n.title,dt:n.dateTime,et:n.endTime,u:n.eventUrl.split('?')[0],v:n.venue,g:n.group&&n.group.name,gu:n.group&&n.group.urlname,rs:n.rsvps&&n.rsvps.totalCount,mx:n.maxTickets,fee:n.feeSettings&&n.feeSettings.amount,ser:n.series&&n.series.description,d:(n.description||'').replace(/\s+/g,' ').slice(0,500),kw:[]}; o.kw.push(k||'*'); all.set(n.id,o); }
    a=es.pageInfo.hasNextPage?es.pageInfo.endCursor:null;p++;
  }while(a&&p<(k?2:12));}catch(e){}}));
  window.__MU[id]=[...all.values()]; }
window.__MUdone=true;
let t=document.getElementById('__xfer'); if(!t){t=document.createElement('textarea');t.id='__xfer';t.style.cssText='position:fixed;top:10px;left:10px;width:300px;height:100px;z-index:999999';document.body.appendChild(t);}
})();"""
KEYWORDS = ['', 'basketball', 'pickup soccer', 'volleyball', 'pickleball', 'tennis', 'ultimate frisbee', 'run club',
            'bike ride cycling', 'mountain bike', 'rollerblading inline skating', 'roller skating', 'ice skating',
            'climbing bouldering', 'hiking', 'kayak paddle', 'fishing', 'salsa bachata', 'hip hop dance', 'dance party',
            'nightlife', 'singles mixer', 'speed dating', 'happy hour social', 'sushi', 'japanese food',
            'dumplings dim sum hot pot', 'chinese mandarin', 'language exchange', 'foodies dinner', 'skiing snowboard',
            'trivia', 'karaoke', 'bowling', 'social']


def snippet(start, days):
    C = centers()
    end = (date.fromisoformat(start) + timedelta(days=days - 1)).isoformat()
    cities = [[c, v['lat'], v['lon'], RADIUS.get(c, 15), UTC_OFFSET.get(c, '-05:00')] for c, v in C.items()]
    return SNIPPET % dict(cities=json.dumps(cities), kw=json.dumps(KEYWORDS), start=start, end=end)


# ---------------------------------------------------------------- classification
# (category, tier, regex) — first match wins; tier 1 = what the guide is geared to
RULES = [
    ('Pickup sports', 1, r'\b(pick[- ]?up|basketball|hoops|soccer|futsal|volleyball|pickleball|tennis|badminton|ping ?pong|table tennis|ultimate frisbee|frisbee|ultimate pickup|kickball|dodgeball|softball|flag football|street hockey|ice hockey|rec league)\b'),
    ('Skate meetup', 1, r'\b(rollerblad\w*|inline skat\w*|roller ?skat\w*|ice skat\w*|skate night|skating|roller disco|skate)\b'),
    ('Group ride', 1, r'\b(bike|biking|bicycl\w*|cycling|cyclists?|mtb|mountain bik\w*|gravel ride|group ride|critical mass)\b'),
    ('Run club', 1, r'\b(run club|running club|runners?|group run|\d+k run|5k|10k|jog\w*|fun run|trail run\w*)\b'),
    ('Climbing meetup', 1, r'\b(climbing|rock climb\w*|boulder\w*|climbing gym)\b'),
    ('Ski club', 1, r'\b(ski|skiing|snowboard\w*)\b'),
    ('Paddling', 1, r'\b(kayak\w*|paddl\w*|canoe\w*|rowing|dragon boat)\b'),
    ('Fishing meetup', 1, r'\b(fishing|angl(?:er|ing)s?|fly ?fish\w*)\b'),
    ('Hiking club', 1, r'\b(hike|hiking|hikers?|trail walk)\b'),
    ('Salsa social', 1, r'\b(salsa|bachata|kizomba|zouk|merengue|latin danc\w*|latin night|rueda)\b'),
    ('Dance party', 1, r'\b(hip[- ]?hop|r&b|afro ?beats?|afro ?dance|dancehall|amapiano|reggaeton|club night|dance party|dj set|silent disco)\b'),
    ('Swing dance', 2, r'\b(swing|lindy|west coast swing|blues danc\w*|two[- ]step)\b'),
    ('Chinese culture', 1, r'(中文|华|\b(mandarin|chinese|cantonese|sichuan|szechuan|dim sum|dumplings?|hot ?pot|lunar new year|hong kong mahjong|chinese mahjong)\b)'),
    ('Chinese culture', 3, r'\b(tai ?chi|taiji|kung fu|qigong|push hands)\b'),
    ('Language exchange', 3, r'\b(language exchange|tandem|conversation (club|exchange)|polyglot)\b'),
    ('Food meetup', 2, r'\b(sushi|omakase|ramen|izakaya|japanese|korean bbq|foodies?|food crawl|food tour|dinner club|supper club|tasting)\b'),
    ('Speed dating', 2, r'\b(speed dating|singles?)\b'),
    ('Social mixer', 2, r'\b(happy hour|mixer|make (new )?friends|new (to|in) (town|the city|\w+)|meet new people|social night|skip the small talk|bar crawl|pub crawl|rooftop)\b'),
    ('Language exchange', 3, r'\b(language exchange|tandem|conversation (club|exchange)|polyglot)\b'),
    ('Trivia night', 3, r'\b(trivia|quiz)\b'),
    ('Karaoke night', 3, r'\bkaraoke\b'),
    ('Board games', 3, r'\b(board ?games?|game night|mahjong|mah jongg)\b'),
]
RULES = [(c, t, re.compile(rx, re.I)) for c, t, rx in RULES]

EXCLUDE = re.compile(r'''\b(poker|holdem|hold'?em|plo|omaha|bible|church|worship|prayer|pray|ministry|jesus|christ|gospel|
  meditat\w*|therapy|therapist|support group|recovery|grief|sobriety|alcoholics|
  business|networking|startup|founders?|investors?|real estate|marketing|toastmasters|public speaking|entrepreneur\w*|career|
  coding|python|javascript|developers?|AI|LLM|crypto|bitcoin|webinar|online|zoom|virtual|
  psychic|tarot|astrolog\w*|spiritual\w*|buddh\w*|kirtan|satsang|reiki|sound bath|breathwork|
  naked|nude|nudist|swingers?|polyam\w*|kink\w*|fetish|tantra|
  airfare|trip to|vacation|cruise|all-inclusive|travel experiences|
  seniors?|boomers?|retirees?|moms?|mothers|dads|parents|kids|children|toddlers?|teens?|
  lgbt\w*|lgbtq\w*|gay|lesbian|queer|trans|sapphic|women|womens|woman|ladies|girls?|female|sisterhood|
  christian|catholic|jewish|muslim|mormon|
  writing|writers|book club|knit\w*|crochet|sewing|painting class|figure drawing|
  50\+|60\+|over 50|over 60|40s and 50s|50s|60s|
  dog|dogs|puppy|pet|
  bus trip|charter|tour package|class series registration|volunteer\w*|paint\w*|car show|car & bike show|brittany|chess|quilting|game dev|quadball|diabetes|herbalism|musical|storytelling|comedy|book meeting|crafting|crafty|affinity|bipoc|qftw|girlz|girlies|golden|cleanup|customer success|over \d0)\b|\bages?\s*\d|\b\d\d\s*[-–]\s*\d\d\b(?!\s*(mi|miles|k|min))|\b\d0'?s\b|\b\d\d\s*\+'''.replace('\n', '').replace('  ', ''), re.I)
# (women/ladies/girls/gay/etc.: identity- or gender-specific groups the owner wouldn't be the audience for)

def classify(e):
    title, group = e['t'], e['g'] or ''
    full = f"{title} {group} {e.get('d') or ''}"
    if EXCLUDE.search(f"{title} {group}"):
        return None
    # the title decides; the group name only breaks a tie (a ski club's beer night is a social)
    GROUP_OK = ('Pickup sports', 'Run club', 'Group ride', 'Skate meetup', 'Climbing meetup', 'Hiking club',
                'Paddling', 'Fishing meetup', 'Ski club')
    OUTING = re.compile(r'\b(game|games|session|play|open|pick-?up|drop-?in|run|ride|walk|hike|climb|paddle|skate|league|match|park|preserve|trail|reservation|lake|loop|mountain|canyon|falls|beach|river|woods|field|court)\b', re.I)
    for src in (title, group):
        for cat, tier, rx in RULES:
            if src is group and cat not in GROUP_OK:
                continue
            if rx.search(src):
                if src is group:
                    # an activity club's night out is a social; anything else needs to look like an outing
                    if re.search(r'\b(beer|happy hour|drinks|social|party|dinner|brunch|bar|pub|mixer|meetup)\b', title, re.I):
                        return ('Social mixer', 2)
                    if not OUTING.search(title):
                        continue
                return cat, tier
    for cat, tier, rx in RULES[:11]:
        if cat in ('Pickup sports', 'Salsa social', 'Skate meetup', 'Group ride') and rx.search(e.get('d') or ''):
            if EXCLUDE.search(full):
                return None
            return cat, tier + 1
    return None

def refine(cat, tier, title):
    if cat in ('Salsa social', 'Dance party', 'Swing dance') and re.search(r'\b(class(es)?|lessons?|beginners?|workshop|footwork|bootcamp)\b', title, re.I):
        return 'Dance class', tier
    if re.search(r'\b(tango|ballroom)\b', title, re.I):
        return 'Dance class', 2
    return cat, tier

# ---------------------------------------------------------------- text cleanup
EMOJI = re.compile('[\U0001F000-\U0001FAFF☀-➿⬀-⯿️‍←-⇿⌀-⏿■-◿✀-➿\U000E0000-\U000E007F]')

def clean_name(t):
    t = re.sub(r'[\ud800-\udfff]', '', html.unescape(t)).replace('"', '')
    t = EMOJI.sub(' ', t)
    t = re.sub(r'\[[^\]]*spots?[^\]]*\]', ' ', t, flags=re.I)
    t = re.sub(r'^.*?sign ?up\s*:\s*', '', t, flags=re.I)
    t = re.sub(r'^\s*(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{1,2}(?:st|nd|rd|th)?|\d{1,2}/\s*\d{0,2})\s*,?\s*(?:\d{1,2}(?::\d\d)?\s*(?:am|pm|a|p)\b)?\s*[-–~:.]*\s*', '', t, flags=re.I)
    t = re.sub(r'\s*[:\-–]\s*\$[^:]*$|\s*[:,]?\s*\$?\d*\.?\d*\s*off rsvp.*$|\s+rsvp by.*$', '', t, flags=re.I)
    t = re.sub(r'\((?:\s*)\)', ' ', t)
    t = re.sub(r'\s*\([^)]*[^\x00-\u024f\u2000-\u206f\u3000-\u9fff][^)]*\)?', '', t)
    t = re.sub(r'[|•·]+', ' - ', t)
    t = re.sub(r'\s*-\s*-\s*', ' - ', t)
    t = re.sub(r'!{2,}', '!', t)
    t = re.sub(r'\s+', ' ', t).strip(' -–—:*,')
    letters = re.sub(r'[^A-Za-z]', '', t)
    if letters and sum(ch.isupper() for ch in letters) / len(letters) > 0.7 and len(letters) > 6:
        t = ' '.join(w if re.search(r'\d|^[A-Z]{2,3}$', w) else w.capitalize() for w in t.lower().split())
    if len(t) > 80:
        t = t[:77].rsplit(' ', 1)[0].rstrip(' -–—:,') + '…'
    return t

def clean_desc(d):
    if not d:
        return ''
    d = re.sub(r'[\ud800-\udfff]', '', html.unescape(d))
    d = re.sub(r'!\[[^\]]*\]\([^)]*\)', ' ', d)
    d = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', d)
    d = re.sub(r'https?://\S+|www\.\S+', ' ', d)
    d = re.sub(r'\S+@\S+\.\w+', ' ', d)
    d = re.sub(r'\+?\d[\d\s().-]{7,}\d', ' ', d)          # phone numbers
    d = re.sub(r'[*_#>`~\\]+', ' ', d)
    d = EMOJI.sub(' ', d)
    d = re.sub(r'\s+', ' ', d).strip()
    return d

def first_sentences(d, limit=210):
    if not d:
        return ''
    parts = re.split(r'(?<=[.!?])\s+', d)
    if len(d) >= 480 or not re.search(r'[.!?]$', d):
        parts = parts[:-1]                                   # the API text was cut mid-sentence
    GOOD = re.compile(r'\b(join|every|weekly|class|game|games|run|runs|ride|rides|hike|hikes|dance|dancing|play|level|levels|beginners?|miles?|loop|trail|court|courts|field|park|dj|music|social|friendly|meet|welcome|all|pace|route|lessons?|practice|night|morning|evening|teams?|players?|food|dinner|brunch|menu)\b', re.I)
    BAD = re.compile(r"\b(i|i'm|i'll|me|my|don't|doesn't|won't|didn't|privacy|guarantee|spot checks?|rules?|removed?|expect|parking lot|directions|locat\w*)\b", re.I)
    out = ''
    for p in parts:
        p = p.strip()
        if not p:
            continue
        letters = re.sub(r'[^A-Za-z]', '', p)
        if letters and sum(ch.isupper() for ch in letters) / len(letters) > 0.5:
            continue                                         # skip SHOUTED notices
        if re.search(r'\b(please|rsvp|note|refund|waitlist|cancel\w*|sign[- ]?up|tickets?|venmo|zelle|cash ?app|paypal|contact|call|text|tel|phone|leader|organi[sz]er|host(ed|ing)?|welcome|hello|whatsapp|member(ship)?s? (only|must)|must|introduction|appointment|account|t\.?b\.?d|update|change)\b', p, re.I):
            continue
        if p.endswith('?') or p.endswith(':') or re.search(r'[!?]\s*[!?]|\(\s*\.|^\W|\b[A-Z]{4,}\b|cross-post|instagram|facebook|telegram|discord|http|\[|\bmembers?\b|deprioriti|\bchanges?\b|^(Both|They|It|That|These|Those|Here|Hi|Hey|Hello)\b', p) or not re.search(r'[a-z]{3}', p):
            continue
        if not GOOD.search(p) or BAD.search(p):
            continue
        if len(out) + len(p) + 1 > limit:
            if not out and len(p) > 40:
                out = p[:limit - 1].rsplit(' ', 1)[0].rstrip(',;:') + '…'
            break
        out = (out + ' ' + p).strip()
    return out

# ---------------------------------------------------------------- when strings
DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
PLURAL = {'Monday': 'Mondays', 'Tuesday': 'Tuesdays', 'Wednesday': 'Wednesdays', 'Thursday': 'Thursdays',
          'Friday': 'Fridays', 'Saturday': 'Saturdays', 'Sunday': 'Sundays'}

def hm(dt):
    h, m = dt.hour, dt.minute
    s = f"{h % 12 or 12}" + (f":{m:02d}" if m else '') + ('a' if h < 12 else 'p')
    return s

def times(e):
    s = datetime.fromisoformat(e['dt'])
    t = hm(s)
    if e.get('et'):
        en = datetime.fromisoformat(e['et'])
        if 0 < (en - s).total_seconds() <= 8 * 3600:
            t += '–' + hm(en)
    return s, t

def weekly_days(ser):
    m = re.match(r'Every week on ([A-Za-z, ]+?)(?: until .*)?$', ser or '')
    if not m:
        return None
    days = [x.strip() for x in m.group(1).split(',')]
    if not all(d in PLURAL for d in days):
        return None
    return days

# ---------------------------------------------------------------- geography
def hav(a, b):
    t = math.radians
    s = math.sin(t(b[0] - a[0]) / 2) ** 2 + math.cos(t(a[0])) * math.cos(t(b[0])) * math.sin(t(b[1] - a[1]) / 2) ** 2
    return 2 * 3958.8 * math.asin(math.sqrt(s))

NYC = ['foresthills', 'flushing', 'queens', 'brooklyn', 'nyc']

def home_city(cid, ll, CENTERS):
    """The 5 NYC-area guides overlap; each event lives in exactly one of them."""
    if cid not in NYC:
        return cid
    best = None
    for c in NYC:
        C = CENTERS[c]
        d = hav(ll, (C['lat'], C['lon']))
        r = {'foresthills': 3, 'flushing': 3, 'queens': 7, 'brooklyn': 6, 'nyc': 5}[c]
        if d <= r and (best is None or d / r < best[0]):
            best = (d / r, c)
    return best[1] if best else cid



def curate(RAW, outdir):
    CENTERS = centers()
    data_file = {c['id']: c['file'] for c in CENTERS.values()}
    existing = {}
    for cid, f in data_file.items():
        D = json.load(open(os.path.join(REPO, f)))
        names = {r['n'].lower() for t in D.values() for r in t}
        urls = ' '.join((r.get('u') or '') for t in D.values() for r in t)
        existing[cid] = (names, urls)

    picked = collections.defaultdict(dict)   # cid -> key -> candidate
    seen_ids = set()
    for cid, evs in RAW.items():
        for e in evs:
            if e['id'] in seen_ids:
                continue
            v = e.get('v') or {}
            if v.get('lat') is None or v.get('lon') is None:
                continue
            cl = classify(e)
            if not cl:
                continue
            ll = [round(v['lat'], 4), round(v['lon'], 4)]
            if not (24 < ll[0] < 50 and -130 < ll[1] < -60):
                continue
            if cid == 'stamford' and ll[0] < 40.93:
                continue                                         # Long Island's north shore: close as the crow flies, not by road
            home = home_city(cid, ll, CENTERS)
            C = CENTERS[home]
            if hav(ll, (C['lat'], C['lon'])) > {'verona': 45, 'philly': 25, 'stamford': 27, 'ac': 30, 'ithaca': 27, 'buffalo': 27, 'cleveland': 27}.get(home, 22):
                continue
            names, urls = existing[home]
            if e['gu'] and f"meetup.com/{e['gu']}" in urls:
                continue                                         # group already curated by hand
            seen_ids.add(e['id'])
            cat, tier = refine(*cl, e['t'])
            name = clean_name(e['t'])
            if len(name) < 4 or name.lower() in names:
                continue
            days = weekly_days(e.get('ser'))
            start, tstr = times(e)
            key = (re.sub(r'[^a-z0-9]', '', re.split(r'\s[(\[]|\s[-–—]\s', name.lower())[0])[:24], round(ll[0], 2), round(ll[1], 2))
            c = picked[home].get(key)
            if c:
                c['dates'].append(start)
                continue
            picked[home][key] = dict(e=e, name=name, cat=cat, tier=tier, ll=ll, days=days, dates=[start], tstr=tstr)

    def summary(c):
        e = c['e']
        v = e['v']
        lead = first_sentences(clean_desc(e.get('d')))
        where = v.get('name') or ''
        if v.get('city') and v['city'].lower() not in where.lower():
            where = f"{where}, {v['city']}" if where else v['city']
        fee = e.get('fee')
        cost = f"${fee:g} on Meetup" if fee else 'no Meetup fee'
        group = clean_name(e['g'] or 'a local group')
        st = c['dates'][0]
        day = (' & '.join(PLURAL[d] for d in c['days']) if c['days'] else ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][st.weekday()])
        when = f"{day} from {hm(st)}"
        tail = f"{when} with {group} at {where} · {cost}." if where else f"{when} with {group} · {cost}."
        s = f"{lead} {tail}".strip() if lead else tail
        if len(s) > 400:
            s = s[:399].rsplit(' ', 1)[0] + '…'
        if len(s) < 25:
            s = f"{c['cat']} meetup. {s}"
        return s

    out = {}
    for cid, cands in picked.items():
        L = list(cands.values())
        for c in L:
            e = c['e']
            c['score'] = (c['tier'], -min(e.get('rs') or 0, 40) / 40 - (0.3 if c['days'] else 0))
        L.sort(key=lambda c: c['score'])
        # balance: at most 8 per category so one busy scene (salsa in LA) can't crowd out the rest
        per = collections.Counter()
        pergroup = collections.Counter()
        keep = []
        for c in L:
            if per[c['cat']] >= 8 or pergroup[c['e']['gu']] >= 2:
                continue
            pergroup[c['e']['gu']] += 1
            if c['tier'] == 3 and (c['e'].get('rs') or 0) < 4:
                continue
            per[c['cat']] += 1
            keep.append(c)
            if len(keep) >= CAP:
                break
        ev, so, used = [], [], set()
        for c in keep:
            e = c['e']
            n = c['name']
            if n in used:
                n = f"{n} ({clean_name(e['g'])})"[:90]
            used.add(n)
            row = dict(n=n, c=c['cat'], s=summary(c), u=e['u'], ll=c['ll'])
            if c['days']:
                dd = ' & '.join(PLURAL[d] if len(c['days']) == 1 else d[:3] for d in c['days'])
                row['w'] = f"{dd} · {c['tstr']}"
                so.append(row)
            else:
                ds = sorted(set(c['dates']))
                row['w'] = ' & '.join(f"{DOW[d.weekday()]} {d.month}/{d.day}" for d in ds[:3]) + f" · {c['tstr']}"
                ev.append(row)
        out[cid] = (ev, so)

    dst = outdir
    os.makedirs(dst, exist_ok=True)
    for f in os.listdir(dst):
        os.remove(os.path.join(dst, f))
    for cid, (ev, so) in sorted(out.items()):
        stem = data_file[cid][:-5]
        if ev:
            json.dump(ev, open(os.path.join(dst, f'{stem}.events.json'), 'w'), ensure_ascii=False, indent=1)
        if so:
            json.dump(so, open(os.path.join(dst, f'{stem}.social.json'), 'w'), ensure_ascii=False, indent=1)
        cats = collections.Counter(r['c'] for r in ev + so)
        print(f"{cid:12} events {len(ev):3} social {len(so):3}  {dict(cats.most_common(6))}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('snippet', help='print the Chrome JavaScript that pulls the events')
    s.add_argument('--start', default=date.today().isoformat())
    s.add_argument('--days', type=int, default=7)
    c = sub.add_parser('curate', help='turn a raw pull into importable rows')
    c.add_argument('raw', nargs='+', help='raw pull(s); later files add to earlier ones')
    c.add_argument('outdir')
    a = ap.parse_args(argv)
    if a.cmd == 'snippet':
        print(snippet(a.start, a.days))
        return 0
    raw = {}
    for f in a.raw:
        for k, v in json.load(open(f)).items():
            ids = {e['id'] for e in raw.get(k, [])}
            raw.setdefault(k, []).extend(e for e in v if e['id'] not in ids)
    curate(raw, a.outdir)
    return 0


if __name__ == '__main__':
    sys.exit(main())
