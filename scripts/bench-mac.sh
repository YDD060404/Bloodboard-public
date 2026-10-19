#!/bin/bash
# Engine benchmark for this computer: inline, then 1 / 2 / 4 workers, same fixed positions, fixed leaf cap.
set -e
cd "$(dirname "$0")/.."
ES=$(command -v esbuild || echo node_modules/.bin/esbuild)
mkdir -p build bench
$ES scripts/bench-engine.ts --bundle --platform=node --format=esm --target=node18 --outfile=build/bench-engine.mjs --log-level=warning --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
$ES src/platform/engine-worker.ts --bundle --format=iife --target=es2020 --outfile=build/engine-worker.js --log-level=warning
node build/bench-engine.mjs bench/positions.json --mode inline --leafcap 20000 --out bench/mac-inline.json
for w in 1 2 4; do node build/bench-engine.mjs bench/positions.json --mode pool --workers $w --leafcap 20000 --out bench/mac-w$w.json; done
for w in 1 2 4; do echo "== $w workers vs inline"; python3 scripts/bench-compare.py bench/mac-inline.json bench/mac-w$w.json; done
