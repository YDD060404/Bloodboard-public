# Blood Bowl Sevens — rules checklist (V4, updated for V5.5)

Written 27 Sep 2026, before implementation, from the primary source the user supplied (interpretation 5 added during implementation).

## Which ruleset

**Implemented: *Spike! Journal: Sevens* (Spike! The Fantasy Football Journal, Issue 22), © Games Workshop 2026** —
the official Sevens rules for the current (Third Season / "2025") Blood Bowl rules, which is the rulebook the
rest of Bloodboard implements. Page numbers below are the journal's printed page numbers (the PDF's page
number minus 2). The journal says (p.10): anything it does not change "will almost certainly work the same as
it is described in the *Blood Bowl Rulebook*", so everything not listed here follows the Third Season rulebook
exactly as standard mode already does.

Other versions checked and **not** used (not mixed in):

| Version | Status | Main differences from Spike! 22 |
|---|---|---|
| *Death Zone* Sevens (GW, 2020, for the Second Season rules) | Superseded for Third Season play; still the version on the NAF "Variants" page when checked | Re-rolls 0-6 at double the roster cost, only when drafting; its own kick-off table (e.g. Time-out on turn 4+, Pitch Invasion D3 players, no Kick Team-mate in Charge!); normal Injury/Casualty tables; Argue the Call as the rulebook |
| NAF Sevens 2019 | Fan/organisation rules for the older edition | Written for BB2016 |
| "Blood Bowl Sevens – 2025 Edition" (Hull's Angels / East Yorkshire leagues) | Unofficial club adaptation of the 2020 rules | Same base as Death Zone 2020 |

No official FAQ/errata for the Spike! 22 Sevens rules was found (searched 27 Sep 2026). The Warhammer Community
*Designer's Notes on Blood Bowl Sevens* article (3 Aug 2026) matches the journal (600,000 gp, max 4
non-Linemen, six Turns a half, 100,000 gp re-rolls, a slower Lineman Veteran with a once-per-game re-roll).

## Checklist

| # | Rule | Sevens (Spike! 22) | Source | Standard mode (unchanged) |
|---|---|---|---|---|
| 1 | Pitch size | 20 squares long × 11 wide: End Zone (1) + 6 squares to each Line of Scrimmage, 6 squares of No Man's Land between the two Lines of Scrimmage; Wide Zones 2 squares, Centre Field 7 | p.7 (text: zones and widths; pitch diagram: 20 × 11 squares counted from the printed diagram) | 26 × 15, Wide Zones 4 |
| 2 | Lines of Scrimmage / No Man's Land | Two Lines of Scrimmage split the pitch into three sections; the area between them (Wide Zone parts included) is No Man's Land | p.7 | One halfway line |
| 3 | Trapdoors | One per half, in a Wide Zone (drawn on the pitch) | p.7 | Only matter with the Treacherous Trapdoor Prayer to Nuffle (V5: implemented in both modes; Sevens uses its own D8 Prayers table, p.15) |
| 4 | Dugout / Turns | Turn and Team Re-roll trackers go up to 6; **six Turns per half** | p.7 | 8 Turns |
| 5 | Team Draft budget | 600,000 gp | p.8 | 1,000,000 gp |
| 6 | Players on the Team Draft List | Minimum 7 when drafted, never more than 11. Seven are set up per Drive; the others wait in the Reserves Box and can be set up for any later Drive (there is no seven-player roster cap). | p.8, p.10 | 11-16 |
| 7 | Positions | No more than 4 players **without the Lineman keyword**; each position's QTY limit still applies. **V5.5 exception (the user's explicit choice, also the optional NAF recommendation for BB2025 Sevens):** the Insignificant drafting-count restriction (no more Insignificant players than players without it) is **not applied in Sevens** — a Snotling team may draft Insignificant players up to the eleven-player limit. The trait stays on the players; budget, positional limits, the four-non-Lineman limit, fielding and Swarming are unchanged; the team builder and the rules summary label the exception (`SEVENS_INSIGNIFICANT`). Not a GW erratum. | p.8; NAF recommendations (optional) | Insignificant limit applies |
| 8 | Team Re-rolls | 100,000 gp each (instead of the roster cost), when drafting or later in a league | p.9 | Roster cost, 0-8 |
| 9 | Sideline Staff | Assistant Coaches 20,000 gp, max 3; Cheerleaders 20,000 gp, max 3; Apothecary 80,000 gp if the roster allows, max 1 | p.9 | 10k/10k (max 6 each), Apothecary 50k |
| 10 | Dedicated Fans | Start at 1; +1 for 20,000 gp each when drafting; never more than 5 or less than 1 | p.9 | 1-3, 5k per step |
| 11 | Veteran | Must pick one Lineman as the Veteran: MA −1; once per game may re-roll the dice when it fails to pick up the ball, catch the ball, make a Pass Action, or would be Knocked Down by its own Block Action | p.13 | — |
| 12 | Set-up | 7 players per Drive (or all available if fewer); kicking team first; fully within the area between their End Zone and their Line of Scrimmage; max 1 player in each of their Wide Zones; min 3 in the Centre Field adjacent to their Line of Scrimmage; never in No Man's Land | p.10 | 11 players, max 2 per Wide Zone |
| 13 | Too few for the Line of Scrimmage | May Concede Without Penalty (rulebook p.101) or set up all available players on the Line of Scrimmage | p.10 | Same "all on the LoS" rule (p.47) |
| 14 | Kick-off deviation | Distance = the **lower of two D6** (direction D8 as normal) | p.10 | D6 |
| 15 | Touchback | Only if the ball leaves the pitch or crosses the kicking team's Line of Scrimmage; a ball that lands in No Man's Land is **not** a Touchback | p.10 | Anything outside the receiving half |
| 16 | Kick-off Event Table | 2 Get the Ref (free Bribe each) · 3 Time-out (back if the kicking team's marker is on 5 or 6, otherwise forward) · 4 **Alert Defence** (kicking team: up to D3+1 Open players move one square, even into No Man's Land) · 5 High Kick (only if the ball will land between the receiving End Zone and Line of Scrimmage, not No Man's Land) · 6 Cheering Fans · 7 Brilliant Coaching (free re-roll for the Drive, lost at its end) · 8 Changing Weather · 9 Quick Snap (up to **D3+1**, one square, even into No Man's Land) · 10 Charge! (up to **D3+1**; one Blitz, one Throw Team-mate, one Kick Team-mate) · 11 Dodgy Snack · 12 Pitch Invasion (**one** random player of the lowest roller(s) Placed Prone and Stunned) | p.11 | Solid Defence D3+3 re-set-up, Quick Snap / Charge! D3+3, Pitch Invasion D3, Time-out on 6-8 |
| 17 | Injury tables | Sevens Injury Table: 2-7 Stunned, 8-9 KO, 10 Badly Hurt, 11 Seriously Hurt (League: miss next game), 12 Dead. Sevens Stunty table: 2-6 Stunned, 7-8 KO, 9-10 Badly Hurt, 11 Seriously Hurt, 12 Dead. **No Casualty Roll** | p.12 | Injury + Casualty tables |
| 18 | Argue the Call | 1-4 still Sent-off; 5-6 back in the square, not Sent-off, Turnover still caused (no coach ejection) | p.13 | Rulebook table |
| 19 | Throw-ins | Distance D6+2 instead of 2D6; everything else unchanged | p.13 | 2D6 |
| 20 | Team Re-rolls in play | Not changed by Sevens → rulebook p.33: full complement at the start of **each half**; not replenished per Drive; unused ones do not carry over. Brilliant Coaching's extra re-roll is lost at the end of its Drive (p.11) | p.10 + rulebook p.33 | Same |
| 21 | Skills, Traits, player Actions, Fouls, Blitz, Pass ranges, weather, Fan Factor, KO recovery, Secret Weapons, Bribes | Unchanged (rulebook) | p.10 | Same |
| 22 | League play | No Star Player Points; after every game one player gains a random Primary (2 picks by you, 1 by your opponent, D3) or Secondary skill; never Leader or Pro; Journeymen if fewer than 7 (Loner 5+); its own inducement list and Prayers / Desperate Measures; re-draft budget capped at 750,000 gp | pp.14-17 | — |
| 23 | Matched Play | 600,000 gp, unspent gp lost, Dedicated Fans start at 0, Inducements bought from the budget, Skill Points by Tier (Tier list in the Designer's Commentary); no advancement | pp.18-19 | The Tournament mode — Skill Points 1 / 2 / 3 / 4 by Tier, Primary 1 / Secondary 2 (one Secondary for the team), one extra skill per player, two Elite skills; Dedicated Fans from 0. **V5.5: the Sevens Inducements (p.14) are bought from the budget and used in matches** — see *Sevens Inducements* below. |
| 24 | Star Players / Mercenaries | Not on the Sevens Inducement list (p.14) | p.14 | Not offered to Sevens teams (explained in the team builder as a rules restriction). The All-Star Match (a custom Exhibition variant) may use Star Players in Sevens. |

## Interpretations (stated, not silent)

1. **Where the kick is aimed.** Spike! 22 does not restate where the ball is placed. The rulebook says "any
   square in the opponent's half" (p.47). A Sevens pitch has no halfway line — each team's own area is "between
   their End Zone and their Line of Scrimmage" (p.10) — so Bloodboard asks for the target in the receiving
   team's area. After the Deviation the ball may land in No Man's Land (no Touchback, p.10).
2. **Apothecary and Casualties.** The rulebook Apothecary (p.68) patches up a Casualty by making a second
   *Casualty Roll*; Sevens says "Do not make a Casualty Roll" (p.12). Bloodboard therefore lets a Sevens
   Apothecary patch up a Knocked-out player exactly as the rulebook describes, but not a Casualty (there is no
   Casualty Roll to repeat). Decay (roll the Casualty Table twice) has nothing to apply to in Sevens.
   Regeneration still works on any Casualty.
3. **Veteran "would be Knocked Down by their own Block Action".** Offered after the block dice are rolled
   when the result the chooser would take can Knock the Veteran Down: attacker chooses → every die is
   Attacker Down, or Both Down without Block; defender chooses → any such die. "Fails to make a Pass Action"
   = a Passing Ability Test that is not Accurate (the same trigger as the Pass skill). The Veteran re-roll is
   not a Team Re-roll (no Loner roll) and a die is still never re-rolled twice.
4. **Maximum Team Re-rolls.** Spike! 22 sets the price but no maximum; Bloodboard keeps the rulebook draft
   limit (0-8). At 100,000 gp each with at least seven players, a 600,000 gp team cannot reach it anyway.

5. **Kick.** Kick (rulebook p.130) lets the kick "only Deviate D3 squares rather than the usual D6"; in Sevens the usual roll is the lower of two D6, so a kicker who uses Kick rolls a single D3 for the distance.

6. **On the Ball at the kick-off (V5.5).** The rulebook (p.132) lets one Open receiving player move up to 3 squares
   but "not into the opposition half". The Designer's Commentary (May 2025, p.94) answers "Yes" to *"In Blood Bowl
   Sevens, can a player with the On the Ball skill use it to move into the area between both Lines of Scrimmage?"*.
   Bloodboard therefore offers every square of the receiving team's half of the pitch, divided at the halfway line —
   its side of No Man's Land included. (Three squares from the Line of Scrimmage never reach the halfway line, so no
   square of No Man's Land that the player can reach is refused.) The May 2026 Third Season Designer's Commentary has
   no Sevens entry that changes this.
   **Revalidated for V5.5 (source hierarchy):** the "Yes" is in the *Death Zone* section of GW's May 2025 Designer's
   Commentary (p.94), i.e. written for the 2020 Sevens rules; Spike! 22 (the Third Season Sevens rules) has no ruling
   of its own and no later GW FAQ changes it, so it remains the latest GW ruling and the default. The **NAF
   Recommendations and Clarifications for BB2025** (Sevens section, updated 26 Sep 2026) recommend the opposite — On
   the Ball may not enter No Man's Land — and state that adopting them is optional and declared in an event's rules
   pack. Bloodboard keeps the two apart: the match set-up's Sevens setting *On the Ball at the kick-off* offers "May
   move into No Man's Land (GW ruling — default)" and "Not into No Man's Land (NAF recommendation — optional)"
   (match option `sevensOnTheBall: 'ownArea'`, shown on the match card). Tested in `tests/ontheball.test.ts`.

## Sevens Inducements (V5.5, Spike! 22 p.14)

Bought from the Team Draft Budget in the team builder (Matched Play p.18: any amount, keeping at least seven players)
and used in the match. The list is Sevens' own; 11-a-side Inducements are not imported into Sevens.

| Inducement | Limit | Price | In the match |
|---|---|---|---|
| Temp Agency Cheerleaders | 0-2 | 15,000 | +1 Cheerleader each for the game |
| Part-Time Assistant Coaches | 0-2 | 15,000 | +1 Assistant Coach each for the game |
| Blitzer's Best Kegs | 0-2 | 50,000 | +1 to recover each Knocked-out player |
| Prayers to Nuffle | 0-2 | 5,000 | Rolled on the **Sevens D8 table** (p.15): 1 Treacherous Trapdoor, 2 Stiletto, 3 Iron Man, 4 Knuckle Dusters, 5 Blessing of Nuffle, 6 Moles under the Pitch, 7 Under Scrutiny, 8 Intensive Training (the rulebook's effects, p.143) |
| Extra Team Training | 0-6 | 125,000 | +1 Team Re-roll each |
| Bribes | 0-2 | 100,000 (50,000 with Bribery and Corruption) | As the rulebook |
| Wandering Apothecary | 0-1 | 100,000 | An extra Apothecary (the Sevens Apothecary rules above) |
| Mortuary Assistant / Plague Doctor | 0-1 | as the rulebook, for the teams that may hire them | As the rulebook |
| Halfling Master Chef | 0-1 | 300,000 (100,000 Halfling) | As the rulebook |
| Desperate Measures | 0-5 | 50,000 | D8 each (duplicates re-rolled, p.15): You Dope!, Razzle-Dazzle, Hangover, Grudge Match, Set Piece, Sports Espionage, Discarded Banana Skin, Magic Scroll (a free Wizard spell) — each used by the coach (or the computer) when its rule says |

Everything not on this list (Star Players, Mercenaries, Wizards bought as Inducements, Team Mascot, Weather Mage,
Biased Referee, Riotous Rookies…) is shown in the team builder as **not offered by the Sevens rules** — a rules
restriction, not unfinished work. Checked by `tests/sevens-inducements.test.ts` (purchases, limits, budget, every
Desperate Measure's effect, whole Sevens matches with them) and `scripts/ui-flow-v55-quick.mjs`.

## Not implemented in Sevens (as in standard mode unless noted)

- Sevens League play (random-skill advancement, Journeymen, re-draft, drafted-player retention) — Sevens
  teams play Tournament or Exhibition matches; there is no post-game advancement for them.
- Concede Without Penalty, Extra Time.
