// Shared helpers for the plain-node Playwright e2e tests.
// Run: node tests/e2e/<file>.test.js  (playwright resolved from CI install or the session scratchpad)
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const MIME = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serve(port) {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const p = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
      fs.readFile(p, (err, buf) => {
        if (err) { res.writeHead(404); res.end('404'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    s.listen(port, () => resolve(s));
  });
}

function pw() {
  try { return require('/tmp/claude-0/-home-user-things-to-do/b2cdd658-8da3-5427-a29b-f3731d8dd0d4/scratchpad/node_modules/playwright'); }
  catch (e) { return require('playwright'); }
}

async function launch() {
  const opts = {};
  if (fs.existsSync('/opt/pw-browsers/chromium')) opts.executablePath = '/opt/pw-browsers/chromium';
  return pw().chromium.launch(opts);
}

let fails = 0;
function check(cond, msg) {
  if (cond) console.log('  PASS', msg);
  else { console.error('  FAIL', msg); fails++; }
}
function fatal(msg) { console.error('FATAL', msg); process.exit(1); }
function done() {
  console.log(fails ? `${fails} FAILURE(S)` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
}

module.exports = { serve, launch, check, fatal, done, ROOT };
