# The one shared AI folder

Canonical folder (macOS): `~/Library/Application Support/Bloodboard/AI/`

The native app, the online-coach installer (`bridge.mjs install-coach` and the panel's Install button), the coach loader and the Match Lab all read and write this same folder. There is no second copy and no version-specific AI folder any more.

## Resolution policy (identical everywhere)

Implemented in `online/aidir.mjs` (also shipped byte-identically as `match-lab/aidir.mjs`; the packager checks the two hashes) and in `native/main.swift` (same table, unverified until compiled on a Mac).

| Order | Source | Meaning |
|---|---|---|
| 1 | `BLOODBOARD_AI_DIR` (absolute path) | tests and unusual setups |
| 2 | `~/Library/Application Support/Bloodboard/ai-location.json` `{"path": "/abs/dir"}` | written by the supported selection flow |
| 3 | `~/Library/Application Support/Bloodboard/AI` | the default |

There is no further fallback. If the resolved folder cannot be created or written, resolution fails with an explicit message and the remedy; nothing falls back to another writable folder.

## Supported selection and permission flow

- Menu **Choose AI Folder…** in the app (folder picker; the choice is saved in `ai-location.json`), or `node online/aidir.mjs choose /absolute/folder`. Every component then uses that folder.
- **Show AI Folder** reveals the resolved folder. Drag-and-drop import and the panel's Install write into it.
- A folder that is, contains or sits inside the credential/state folder `Bloodboard Online` is refused.
- Credentials never live in the AI folder. Generated online coaches contain only the local pairing capability (64 hex characters), not a provider key.

## Migration of older folders

`node online/aidir.mjs migrate` (dry run) and `migrate --apply`; `install_bloodboard.sh` runs the apply by default (`--no-migrate` to skip). Sources: `Bloodboard V6/AI`, `Bloodboard Endgame Workshop/AI`, and any other `Bloodboard*/AI` folder.

1. Back up the source folders first to `Bloodboard/AI-migration-backups/<stamp>/`, verified byte for byte, with a manifest; skipped when nothing changed since the last backup.
2. Copy only. The older folders are never changed or removed.
3. Deduplicate by SHA-256: identical bytes are stored once.
4. A different file at an occupied path is a conflict: the newest version keeps the name, the other is preserved under `AI/_migration-conflicts/<source>/` and reported (including the coach ID). Nothing is overwritten.
5. Files that look like credentials (by name or content) are not copied; they are reported and remain in their original folder and the backup.
6. Companion and model files in sub-folders are migrated with their relative paths.
7. Selections are by stable coach ID, so a coach keeps being selected after migration. If two files carry the same ID, the report lists it (`collisions`).
8. State and report: `AI/.migration/last-report.json`, `history.jsonl`, `state.json`. A second run changes nothing.

The game and the Match Lab warn (never read) when an older folder still holds files the shared folder lacks. Both skip `_migration-*` and hidden folders. The game reads the top level of the folder; the Lab does the same for the shared folder.

## Verification status

- Simulated Mac layout (temporary HOME) plus a browser with a stand-in for the Swift bridge: `scripts/ai-folder-shared-flow.mjs`, 21 checks — canonical path, dry run, dedupe, conflict preserved, companion files, credentials kept out, idempotence, the game and the Lab list the same files with identical SHA-256, an update to one file is seen by both, restart persistence, chosen folder honoured, credential-folder overlap refused.
- Not verified: the compiled native app, and the real migration on your Mac. Run `install_bloodboard.sh` and the checklist in `docs/LOCAL_INSTALL.md`.
