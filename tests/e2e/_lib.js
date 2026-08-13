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
  // sandboxed test envs route outbound HTTPS (CDNs: leaflet, tiles) through a proxy
  if (process.env.HTTPS_PROXY) opts.proxy = { server: process.env.HTTPS_PROXY, bypass: 'localhost' };
  const browser = await pw().chromium.launch(opts);
  const origNewPage = browser.newPage.bind(browser);
  // block service workers so page.route sees every request (the app SW claims
  // clients immediately and would shadow CDN interception)
  browser.newPage = (o = {}) => origNewPage({ ignoreHTTPSErrors: true, serviceWorkers: 'block', ...o });
  return browser;
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

// Serve unpkg CDN assets from tests/e2e/vendor so map tests are hermetic
// (sandboxed CI/proxy environments can't reach unpkg; production still uses the CDN).
async function routeUnpkg(page) {
  await page.route('https://unpkg.com/**', route => {
    const m = route.request().url().match(/unpkg\.com\/([^@]+)@[^/]+\/(.+?)(\?.*)?$/);
    const file = m && path.join(__dirname, 'vendor', m[1], m[2]);
    if (file && fs.existsSync(file)) {
      const type = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
      route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(file) });
    } else route.abort();
  });
  // openstreetmap tiles are also unreachable — return a blank tile so the map settles
  const blank = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.route('https://tile.openstreetmap.org/**', route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: blank }));
}

module.exports = { serve, launch, check, fatal, done, ROOT, routeUnpkg };
