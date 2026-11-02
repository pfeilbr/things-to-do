// Builds a minimal Metro-North-style GTFS-realtime feed (protobuf) so the unit and e2e
// tests can exercise the page's live overlay without the network. Mirrors the fields
// mnrLive() in index.html reads: entity id = train number, trip.start_date, trip
// schedule_relationship, and per stop the departure time plus the MTA railroad
// extension (field 1005: 1 track, 2 status).
const varint = n => { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n) b |= 128; o.push(b); } while (n); return o; };
const key = (f, w) => varint(f * 8 + w);
const vfield = (f, n) => [...key(f, 0), ...varint(n)];
const bytes = (f, b) => [...key(f, 2), ...varint(b.length), ...b];
const str = (f, s) => bytes(f, [...Buffer.from(s, 'utf8')]);

function buildFeed({ ts, trains }) {
  const header = [...str(1, '2.0'), ...vfield(3, ts)];
  const out = [...bytes(1, header)];
  for (const t of trains) {
    const trip = [...str(1, 'rt-' + t.num), ...str(3, t.date), ...(t.cancelled ? vfield(4, 3) : [])];
    const stus = t.stops.map(s => {
      const ext = [...(s.track ? str(1, s.track) : []), ...(s.status ? str(2, s.status) : [])];
      return bytes(2, [...bytes(2, vfield(2, s.t)), ...bytes(3, vfield(2, s.t)), ...str(4, s.id), ...bytes(1005, ext)]);
    }).flat();
    const tu = [...bytes(1, trip), ...stus];
    out.push(...bytes(2, [...str(1, t.num), ...bytes(3, tu)]));
  }
  return Buffer.from(out);
}

module.exports = { buildFeed };
