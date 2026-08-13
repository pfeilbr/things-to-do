// Runs every e2e spec in this directory sequentially; exits non-zero if any fails.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const specs = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let failed = [];
for (const f of specs) {
  process.stdout.write(`\n=== ${f} ===\n`);
  try {
    execFileSync('node', [path.join(__dirname, f)], { stdio: 'inherit', timeout: 300000 });
  } catch (e) {
    failed.push(f);
  }
}
console.log(failed.length ? `\nFAILED: ${failed.join(', ')}` : `\nALL ${specs.length} SPECS PASS`);
process.exit(failed.length ? 1 : 0);
