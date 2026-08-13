// Extracts the pure core functions out of index.html's inline script and
// evaluates them in a vm sandbox, optionally with a frozen "now" so the
// date-aware logic (happensToday) is deterministic under test.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCore(opts = {}) {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
  const src = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const grab = re => {
    const m = src.match(re);
    if (!m) throw new Error('extraction failed: ' + re);
    return m[0];
  };
  const parts = [
    grab(/const MONNUM = \{[^\n]*\n/),
    grab(/const DOWNUM = \{[^\n]*\n/),
    grab(/const DAYRE\s*=\s*"[^"]*";/),
    grab(/function havMi[\s\S]*?\n\}/),
    grab(/function ride[\s\S]*?\n\}/),
    grab(/function daysIn[\s\S]*?\n\}/),
    grab(/function happensToday[\s\S]*?\n\}/),
    grab(/function slugify[\s\S]*?\n\}/),
    grab(/function pop\(row\)[^\n]*\n/),
  ].join('\n');

  const RealDate = Date;
  const sandbox = {};
  if (opts.now) {
    const fixed = new RealDate(opts.now);
    if (isNaN(fixed)) throw new Error('bad now: ' + opts.now);
    class FakeDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(fixed.getTime());
        else super(...args);
      }
      static now() { return fixed.getTime(); }
    }
    sandbox.Date = FakeDate;
  } else {
    sandbox.Date = RealDate;
  }
  vm.createContext(sandbox);
  return vm.runInContext(
    parts + '\n;({ havMi, ride, daysIn, happensToday, slugify, pop });',
    sandbox);
}

module.exports = { loadCore };
