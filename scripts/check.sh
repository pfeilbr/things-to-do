#!/bin/sh
# Every offline check CI runs, in one command:   sh scripts/check.sh
# Add --e2e to also run the Playwright browser suite (needs playwright + chromium).
set -e
cd "$(dirname "$0")/.."
node --test 'tests/unit/*.test.js' 'tests/data/*.test.js'
python3 -m unittest discover -s tests/scripts
python3 scripts/transit.py status --min-days 7
if [ "$1" = "--e2e" ]; then node tests/e2e/run-all.js; fi
echo "all checks passed"
