# High Elf: source conflict and how it was resolved (BB-ROSTER-001)

Status: resolved in the data in V7.0.2 by per-field adjudication. Nothing here was guessed; each decision names the evidence. The decision is **not** an official erratum: if an official publication contradicts it, change the single data value named below.

## Sources

| Label | Source | Notes |
|---|---|---|
| A | User-supplied quick-reference PDF dated 2026-07-14, physical page 21 (SHA-256 `c387623cfb663b6120b1c7569197f4d1ca27efa9d5abf88893886b3add144351`) | Chinese-language reference; English transcription in `HIGH_ELF_SOURCE_CONFLICT.md`. Not claimed to be final authority. |
| B | User-supplied one-page English High Elf sheet, Spike! 21, printed page 172 (SHA-256 `6f7c4bc86fda3c9eee83e45796c22db2eaaae36c4f65f3ebc05da2cab734394a`) | The printed team page. |
| C | Official designer article, Warhammer Community, 2026-03-10 ("What exactly do the High Elves do in Blood Bowl? Their designers tell all") | Confirms the new positions, profiles, fees and starting abilities; calls the Dragon Prince Blitzer / Elf / Runner. Does not give skill access. |
| D | Independent roster database `bloodbowlbase.ru/bb2025/teams/High_Elf/` | Third-party; used only as a tie-breaker, never as the sole authority. |

The May 2026 official errata does not settle either field.

## The two disputed fields

| Field | A | B | Other evidence | Decision | Why |
|---|---|---|---|---|---|
| Lineman Secondary access | P, S | S | D: S | **S** | Two independent sources (the printed page B and database D) agree; only A differs. |
| Dragon Prince keywords | Elf, Blitzer, Runner | Elf, Runner | C: Blitzer / Elf / Runner; D: includes Blitzer | **Elf, Blitzer, Runner** | The official designer article names Blitzer, supported by D and A; the printed page B omits it. |

All other fields (positions, quantities, MA/ST/AG/PA/AV, skills, costs, primary access, re-roll 50 000, Apothecary, league, no team special rules) agree between the sources and are implemented as printed. My Ball is a mandatory passive trait, not a purchasable skill. The sheet gives no Apothecary price, so none was invented.

## What is implemented

`src/engine/rosters.ts`, roster `highElf`: High Elf Lineman (0-16, 65 000), Phoenix Warrior (0-2, 90 000), Dragon Prince (0-2, 110 000, MA 8, PA 4+, Block + My Ball + Steady Footing), White Lion (0-2, 110 000, MA 7, Claws + Wrestle).

The earlier table (Lineman, Thrower, Catcher, Blitzer) is kept as `retiredPositions`. Teams saved under it still open and keep their players (looked up through `findPosition`); they are never silently converted into the new positionals. New hiring, the tournament validator and the Sevens validator state explicitly that a retired position can no longer be recruited. Tests: `tests/highelf-v7.test.ts`.

## How to change a value

Edit the one data line in `src/engine/rosters.ts` (the comment above the roster points here), rebuild, and run `tests/highelf-v7.test.ts`. The engine/rules hash changes; the new release needs a fresh freeze.
