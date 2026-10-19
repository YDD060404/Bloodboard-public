# Reproducing this release from source

Source identity: the archive `Bloodboard-<version>-source.tar.gz` published next to the package (its SHA-256 is in `SHA256SUMS-release`). `MANIFEST.json` → `testedSourceSha256` is the hash of the deterministic tar stream of `src tests scripts package.json tsconfig.json native online lan build_mac_app.sh` (without the generated `lan/engine.mjs` and the private `lan/rooms`) that the full unit suite ran against; recompute it with:

```
tar --sort=name --mtime=@0 --owner=0 --group=0 --exclude=node_modules --exclude=verification-reports --exclude=lan/engine.mjs --exclude=lan/rooms \
    -cf - src tests scripts package.json tsconfig.json native online lan build_mac_app.sh | sha256sum
```
(GNU tar). Build:
```
npm install                                   # node 22
export ESBUILD=$PWD/node_modules/.bin/esbuild
npx tsc --noEmit -p .                         # typecheck
node scripts/build.mjs                        # dist/web, generated docs + schemas, fingerprints
node scripts/run-tests.mjs                    # full suite (~22 min on 2 cores; one instance at a time; CPU-sensitive tests such as pool.test fail under load)
node scripts/package-release.mjs --lab <Lab folder> [--sync-lab]   # release/Bloodboard-<version>/ + MANIFEST.json + SHA256SUMS
```
`package-release.mjs` rebuilds the Match Lab runner and worker from the same sources (compare `MANIFEST.json` → `lab` with `web/build-info.json` → `engine-worker.js`: they must be equal). Online component tests: `cd online && npm install && npm test`. Interface flows (Chromium): `PLAYWRIGHT_MODULE=<path> node scripts/ui-flow-v7-online.mjs` (also `-play`, `-autostart`).
