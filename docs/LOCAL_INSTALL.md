# Local installation, verification and safe cleanup (Mac)

Evidence class of this document: the scripts were tested in the cloud against a simulated Mac folder layout (Linux, fake home directory). They have **not** yet been run on your Mac. The native build, the app launch and the real Application Support folders are verified only when you run the steps below and the report shows it.

## 1. Install

```
cd ~/Desktop/Claude\ outputs            # or wherever you downloaded Bloodboard-7.0.2.zip
shasum -a 256 -c SHA256SUMS-release      # at least the 7.0.2 lines must say OK
mkdir -p ~/Desktop/Bloodboard-7.0.2-unpacked && unzip -q Bloodboard-7.0.2.zip -d ~/Desktop/Bloodboard-7.0.2-unpacked
cd ~/Desktop/Bloodboard-7.0.2-unpacked/Bloodboard-7.0.2
bash install_bloodboard.sh --dry-run     # shows what would happen; changes nothing
bash install_bloodboard.sh               # real install (add --bridge-native for the bridge launcher in the app)
```

What the installer does, in order: verifies every file against `SHA256SUMS` and reads `MANIFEST.json`; copies the verified package to `~/Desktop/Bloodboard/V7/Bloodboard-7.0.2/` and points `V7/current` at it (the previous target is kept as `V7/previous`, which is your rollback); checks the web build against `build-info.json` and the engine/rules hashes inside `web/engine.js`; backs up and then replaces only the Match Lab **code** (`runner/`, `lab`, `ui/`, `lab.mjs`, `ai-tools.mjs`) and compares the runner and worker hashes and the runner's own `fingerprint` output (engine, rules and API hashes, 120000 ms decision ceiling) with the game; builds `Bloodboard V6.app` inside the installed folder when Apple Command Line Tools are present and links it as `V7/Bloodboard-current.app`; starts the bridge on a temporary port with a temporary state folder, checks that it refuses unpaired requests and reports 7.0.2, then stops it; migrates older AI folders into the one shared AI folder (copy-only, backed up first) and lists the coaches the Match Lab loads from it; takes a before/after snapshot of the user data folders. The full report is written to `~/Desktop/Bloodboard/install-reports/install-<time>.txt`.

It never removes files, never reads or changes credentials, and leaves your teams, histories, settings, runs and exports alone. The old `Bloodboard V6.app` in your V6 checkout is untouched.

## 2. Coaches: the one shared AI folder

Every component reads and writes the same folder:

```
~/Library/Application Support/Bloodboard/AI/
```

The installer resolves it with the same policy as the native app, the online-coach installer, the coach loader and the Match Lab (`online/aidir.mjs`; `docs/AI_FOLDER.md`), creates it, and then **migrates** older version-specific folders (`Bloodboard V6/AI`, `Bloodboard Endgame Workshop/AI` and any other `Bloodboard*/AI` it finds) into it. The migration is copy-only: the older folders are backed up first (verified byte for byte, under `~/Library/Application Support/Bloodboard/AI-migration-backups/`) and are never changed or removed. Identical files (same SHA-256) are stored once; a different file with the same name is a conflict, both versions are kept (the newest keeps the name, the other goes to `AI/_migration-conflicts/`) and it is reported; files that look like credentials are not copied. Run it twice and the second run changes nothing. `--no-migrate` skips the merge; `--dry-run` prints what would happen.

`bash install_bloodboard.sh --coach /path/to/coach.js` installs that coach once into the shared folder (a different existing file is first copied to `.backup-<time>`) and prints its SHA-256; it refuses files that look like they contain a credential and `*SAMPLE-UNPAIRED*` files. After the install the report lists the coaches the Match Lab loads from that folder, with hashes, so you can compare them with `shasum -a 256` and with the game's coach picker. If the default folder cannot be used, the app's **Choose AI Folder…** menu (or `node online/aidir.mjs choose /absolute/folder`) records a supported alternative that every component then honours; there is never a silent fallback to a second writable folder. Credentials and bridge state live in `Bloodboard Online`, never in the AI folder.

## 3. Manual acceptance (about 15 minutes; this is what makes the install "verified")

1. Open `~/Desktop/Bloodboard/V7/Bloodboard-current.app` (right-click, Open, the first time). Check the About/version text says 7.0.2.
2. Teams, saved matches and settings from your previous app are still listed (a V6 data folder is shared by the V6-named app).
3. Open the coach picker: your existing coaches load, no error banner. Pick one that declares 60 s and one that declares more: the displayed limit is the coach's own, never above 120 s.
4. Start a short match against a built-in coach; finish or abandon it. Open a saved replay.
5. Open Match Lab (`~/Desktop/Bloodboard/match-lab/Launch Match Lab.command`): the setup page offers "120 s"; run a 2-game swap batch with built-in coaches; the run record shows engine hash `8312c9eff23a…`, the same as the game.
6. If you built with `--bridge-native`: Online coaches panel shows the bridge as running. Live DeepSeek and Luna still need your own key and sign-in (`docs/LOCAL_VERIFICATION.md`).
7. Send me `install-<time>.txt` and tell me which of steps 1 to 6 passed.

## 4. Safe retirement of obsolete installations (after step 3 passes)

```
bash retire_obsolete.sh inventory                  # read-only; writes a classification table and a candidate list
# edit the candidate list: delete any line you want to keep
bash retire_obsolete.sh archive  <candidate-list>  # tar.gz + SHA-256 manifest in ~/Documents/BB/archive/retired-v7-<date>/
bash retire_obsolete.sh retire   <candidate-list> --confirm-verified   # MOVES (never deletes) the originals into that archive folder
```

Rules built into the tool: nothing is listed until the V7 install exists; an old `.app` bundle can only be retired after the V7 app was built; release packages are candidates only when an identical copy exists elsewhere (a unique copy is always kept); launch shortcuts are only reported (`REVIEW`) because the tool cannot know what they start; Application Support, Claude data, iCloud/CloudDocs, `.git`, Match Lab data, Hopeful/AI-model baselines, V5.8 (the documented stable fallback) and the V7 install itself are protected and refused even if listed. Restoring is moving an item back or extracting its archive.

## 5. Rollback

`V7/previous` (if any), the Match Lab code backup `~/Desktop/Bloodboard/releases/match-lab-code-before-<version>-<time>.tar.gz`, the `runner.old-<time>`, `lab.old-<time>`, `ui.old-<time>` folders beside the Lab, and the untouched 7.0.0 package give a complete way back.
