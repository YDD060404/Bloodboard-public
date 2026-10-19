# Rules coverage (V4)

Source: the supplied **Blood Bowl Third Season rulebook** (the English compilation that includes the November 2025 FAQ, updated 2026-01-30). Every page number here and in the app is the **printed** page number (PDF page = printed page + 2). Nothing was taken from any older digital Blood Bowl game.

Scope: practice positions played hot-seat from any Turn, and **whole matches** between two saved teams (pre-game, set-up, kick-off, Kick-off Events, Drives, half-time, full time), against another coach or the computer. V4: in League matches, Star Player Points and the MVP are recorded and added to the saved teams, and players advance by the Advancement Table; the rest of League administration (winnings, lasting injuries, hiring, standings) is outside the app.

**V4 changes:** Foul Actions (p.69) with Sent-offs, Argue the Call and Bribes, and the fouling skills Dirty Player, Sneaky Git, Lone Fouler, Put the Boot In and Quick Foul; the Leader Re-roll now follows p.130 exactly (gained at the start of each half only with a Leader on the pitch, lost when every Leader is a Casualty or Sent-off); Insignificant is checked on Team Draft Lists; every Skill and Trait of the catalogue now works (108 of 108): first the ones the four team rosters can learn — Diving Catch, Multiple Block, Dump-off, On the Ball, Pile Driver, Punt, Fumblerooski, Violent Innovator, Lethal Flight — then those only custom League players can have: Trickster, Saboteur, Swoop, Animal Savagery, Bloodlust, Take Root, Plague Ridden and the Special Actions Stab, Chainsaw, Breathe Fire, Chomp, Hypnotic Gaze, Throw Bomb, Kick Team-mate and Ball & Chain. League matches now record Star Player Points and the MVP, and League players advance by the Advancement Table. The optional **D6 difficulty** for matches against the computer is a house rule, not part of Blood Bowl (see the end of this file). **V4 build 3:** an optional **Blood Bowl Sevens** mode (Spike! Journal 22, 2026) — see the Sevens section at the end of this file and `docs/SEVENS_RULES.md`; the standard rules below are unchanged. Two more Team Rosters, **Lizardmen** and **Norse**, with their Leagues and team special rules (see *Team Rosters*).

Legend: ✅ implemented · ◐ partly implemented (the rest is disabled) · ⛔ not implemented — **disabled with an explanation, never approximated**.

## Core rules

| Rule | Pages | Status | Notes |
|---|---|---|---|
| Dice, target numbers, natural 1 / natural 6, modifiers | 32–33 | ✅ | D6 tests: a natural 1 always fails, a natural 6 always succeeds; modified results are clamped to 1–6. |
| Re-rolls (skills, Team Re-rolls, Leader, Pro, Loner) | 33, 130, 131, 133 | ✅ | A die is never re-rolled twice. Team Re-rolls: only in your own Turn, as many as you like, never on Armour, Injury, Casualty, Scatter, Throw-in or Crowd rolls. Replenished at half-time in a match. Leader Re-roll (V4, p.130): gained at the kick-off that starts each half if a player with Leader is on the pitch then; not carried into the next half; usable only while a Leader is on the pitch (a Knocked-out Leader suspends it); lost as soon as every Leader is a Casualty or Sent-off. |
| Deviate, Scatter, Bounce (D8 template) | 34 | ✅ | |
| Turnovers | 35 | ✅ | Knocked Down / Falls Over, failed pick-up or Secure the Ball, pass or hand-off not caught by your team, fumble, interception, Touchdown, Stalling crowd hit, thrown team-mate eaten or landing badly as described on p.76-78. |
| Take-backs | 35 | — | Once dice are rolled a decision stands. The app's **Undo** is a practice tool outside the rules and says so before undoing. |
| Player characteristics (MA, ST, AG, PA, AV) | 36–37 | ✅ | PA "-" players cannot declare a Pass (no rule for a PA "-" Passing Test was found). |
| Tackle Zones, Marking, Open players | 38 | ✅ | |
| Distracted, Prone, Stunned, Placed Prone | 39 | ✅ | Stunned players roll over to Prone at the end of their team's next Turn. |
| Falls Over, Knocked Down | 40 | ✅ | |
| A Game of Two Halves; introductory rules | 44 | ✅ | 8 Turns per team per half. Match option *introductory rules*: equal Fan Factor, Perfect Conditions, no Kick-off Event. |
| The Fans (Fan Factor = D3 + Dedicated Fans) | 45 | ✅ | Used by Pitch Invasion. |
| The Weather | 46 | ✅ | Rolled on 2D6 in a match (chosen in the editor for practice positions). Very Sunny −1 to Passing Tests; Pouring Rain −1 to pick up, Catch and Intercept; Blizzard −1 to Rush and only Quick/Short Passes; Sweltering Heat: at the end of each Drive D3 randomly selected players per team miss the next Drive. |
| Determine the kicking team | 46 | ✅ | Roll-off (ties rolled again); the winner chooses to kick or receive. |
| Start of a Drive: set-up | 47 | ✅ | 11 players (or all available) in your own half, at least 3 on the Line of Scrimmage in the Centre Field (all of them if 3 or fewer), at most 2 per Wide Zone; kicking team first. **An illegal set-up is rejected with the reason and nothing changes.** Players who cannot play (KO, Casualty, Sent-off, Sweltering Heat) cannot be set up. |
| The kick-off | 47 | ✅ | Kicker on the pitch, not on the Line of Scrimmage or in a Wide Zone unless there is no other option; target in the opponent's half; Deviate D8 + D6 (D3 with Kick, p.130). |
| Kick-off Event Table | 48 | ✅ | All eleven results. Get the Ref: free Bribes (used for Secret Weapons at the end of a Drive). Solid Defence / Quick Snap: the coach re-arranges Open players, validated. High Kick: an Open player can be placed under the ball. Cheering Fans: +1 Offensive Assist on the first Block Action of the next Turn. Brilliant Coaching: a free Team Re-roll lost at the end of the Drive. Changing Weather (Perfect → the ball Scatters 3 in the air). Charge!: see *Interpretations*. Dodgy Snack (lowest roll affected; −1 MA/AV for the Drive or the Reserves Box). Pitch Invasion (lowest D6 + Fan Factor: D3 random players Stunned). |
| Landing the kick, Touchbacks | 49 | ✅ | Catch (no extra modifier) or Bounce; leaving the pitch or ending in the kicking half is a Touchback: the receiving coach gives the ball to a Standing player (or places it). |
| A team's Turn, activations, declaring Actions | 50–51 | ✅ | One Blitz, one Pass, one Hand-off, one Secure the Ball and one Throw Team-mate per Turn. |
| Forego Activation, End Turn | 52 | ✅ | |
| Move Actions, Standing Up | 54 | ✅ | Standing up costs 3 squares; with MA below 3 a 4+ roll is needed. |
| Dodging | 55 | ✅ | −1 per player Marking the destination square. |
| Jumping over Prone/Stunned players | 56 | ✅ | Leap and Pogo too (p.130, p.133). |
| Picking up the ball | 57 | ✅ | |
| Rushing | 58 | ✅ | 2+, at most two Rushes (three with Sprint). |
| Secure the Ball Action | 59 | ✅ | D6 2+ instead of an Agility Test; not allowed with a Standing, non-Distracted opponent within 2 squares of the ball, or for Big Guys. |
| Block Actions, block dice, choosing the die | 60, 62 | ✅ | |
| Assists (offensive and defensive) | 61 | ✅ | Guard, Defensive and Eye Gouge are applied. |
| Push Back, Chain Pushes, pushed into the crowd, Follow-up | 62–63 | ✅ | You choose push squares and the follow-up during execution. |
| Blitz Actions | 64 | ✅ | The Block costs one square of movement (it may be a Rush). |
| Armour Rolls, Injury Rolls, Stunty Injury Table | 37, 66 | ✅ | |
| Casualty Rolls | 67 | ✅ | Rolled and logged; there is no post-game sequence, so lasting effects are not tracked. |
| Injury by the Crowd | 68 | ✅ | |
| Apothecaries | 68 | ✅ | Once per match: a KO'd player becomes Stunned in place (Reserves Box if hurt by the crowd); after a Casualty Roll a second roll is made and the coach chooses; Badly Hurt → Reserves Box. Previews assume it is kept. |
| Foul Actions, Sent-off, Argue the Call | 69, 144 | ✅ | V4. One Foul per Turn; the fouler may move first, then fouls an adjacent Prone or Stunned opponent: an Armour Roll with +1 per Offensive and −1 per Defensive Assist (assists as for a Block, but Guard only helps Block Actions — Put the Boot In does it for Fouls). A natural double on the Armour Roll or the Injury Roll: Sent-off after the Foul (Turnover). Argue the Call (1: coach ejected, 6: stays on the pitch but the Turnover stands), then a Bribe if the team has one (2+: stays, no Turnover). Iron Hard Skin cancels all modifiers to the Foul's Armour Roll. Foul Casualties give no Star Player Points (p.96). |
| Pass Actions: range, Passing Test (Accurate / Inaccurate / Fumbled) | 70–71 | ✅ | Quick 0, Short −1, Long −2, Long Bomb −3. A modified result of 1 or a natural 1 is a Fumble. |
| Interceptions | 71 | ✅ | Range Ruler geometry: see *Interpretations* below. |
| Catching the ball | 72 | ✅ | −1 for a bouncing or thrown-in ball, −1 per player Marking the catcher. |
| Throw-ins, corner throw-ins | 73 | ✅ | |
| Hand-off Actions | 74 | ✅ | |
| Throw Team-mate Actions | 76–78 | ✅ | Right Stuff team-mate, Quick/Short range only, Passing Ability test (superb/subpar/fumbled), Scatter, landing Agility Test, crash landings, landing in the crowd, Always Hungry, Strong Arm, Bullseye. Swoop and Lethal Flight are not offered. |
| Touchdowns, including in the opponent's Turn | 80 | ✅ | Practice positions stop at the end of the Drive; in a match **End the Drive** continues. |
| Stalling and The Crowd Takes Action | 80–81 | ✅ | Also checked when you end the Turn with an unactivated carrier who could score without dice. |
| End of a Drive: Secret Weapons, end-of-Drive effects, KO recovery (4+), the Drive ends | 82 | ✅ | Secret Weapons are Sent-off (Argue the Call, Bribes); Sweltering Heat first; Drive effects (Dodgy Snack, Brilliant Coaching re-roll, Cheering Fans) expire. |
| Restarting / ending the game: scoring team kicks, half-time swap, winner or draw | 83 | ✅ | Extra Time and Penalty Shoot-outs are ⛔ (a drawn match ends as a draw). |
| Team Draft (tournament / exhibition template) | 89–91 | ✅ | 1,000,000 gp, 11–16 players within roster limits and roster profiles, ≤ 8 Team Re-rolls at the roster price, Apothecary if allowed (50k), ≤ 6 Assistant Coaches and ≤ 6 Cheerleaders (10k), Dedicated Fans 1–3 (5k per step). League teams are free-form. |
| Pre-game in League Play: Journeymen, Inducements (Petty Cash, Treasury) | 94 | ⛔ | Not included for League teams (no Current Team Value / Treasury in the app yet). |
| Inducements in Exhibition / Matched Play | 110, 116, 141-147 | ✅ (V5, most) | Bought on a Tournament / Exhibition Team Draft List out of its Team Draft Budget (1,000,000 gp, or 1,100,000 / 1,150,000 / 1,200,000 as usual in Matched Play, p.110). See "Inducements" below. |
| Star Player Points and the MVP (League matches) | 96 | ✅ | V4. Recorded during League matches only: Completion 1 (an Accurate Pass caught without a Bounce), Superb Throw Team-mate that lands 1, safe landing 1, Interception 2, Casualty 2 (a player Knocked Down by a Block and suffering a Casualty, even if saved; Violent Innovator adds Special Actions), Touchdown 3, MVP 4. After full time each coach nominates up to six players who played and rolls a D6 for the MVP; “Add the SPP to the saved teams” adds them once per match. |
| Advancement (League teams) | 97, 121, 37 | ✅ | V4. The team editor's “Advance” dialog: Randomly select a Primary Skill (two rolls on the Skill Table, choose one; a skill the player has or cannot use is rolled again), Choose a Primary / Secondary Skill, Characteristic Improvement (D8 table, or a chosen skill instead with the SPP spent); costs by advancements already taken (3/4/6/8/10/15 … 14/16/20/24/28/38 SPP), at most six; characteristics at most twice and within the limits of p.37; value increases incl. Elite Skills. |
| Post-game sequence: winnings, Dedicated Fans, lasting injuries, hiring, standings | 95+ | ⛔ | Not included. |
| Special Actions from Skills/Traits | 123–138 | ✅ | **Throw Team-mate** and **Projectile Vomit** (V3), and in V4 every other one: **Stab**, **Chainsaw Attack** (and chainsaw Fouls), **Breathe Fire**, **Chomp** (Monstrous Mouth), **Hypnotic Gaze**, **Throw Bomb** (Bombardier), **Punt**, **Kick Team-mate** (also the free one in Charge!) and **Ball & Chain**. Stab, Chainsaw, Breathe Fire, Chomp and Projectile Vomit may replace the Block of a Blitz (chosen in the Blitz plan). The computer opponent uses Projectile Vomit only. |
| Star Players | 148, 194-211 | ✅ | **V5 step 5.** All 66 Star Players of the rulebook, hired by Tournament / Exhibition teams — see *Star Players* below. |

**Team Rosters.** The rulebook prints 31 Team Rosters (printed pp.160–190) and **all 31 are in the app** (V5): Amazon (p.160), Black Orc (161), Bretonnian (162), Chaos Chosen (163), Chaos Dwarf (164), Chaos Renegade (165), Dark Elf (166), Dwarf (167), Elven Union (168), Gnome (169), Goblin (170), Halfling (171), High Elf (172), Human (173), Imperial Nobility (174), Khorne (175), Lizardmen (176), Necromantic Horror (177), Norse (178), Nurgle (179), Ogre (180), Old World Alliance (181), Orc (182), Shambling Undead (183), Skaven (184), Slann (185), Snotling (186), Tomb Kings (187), Underworld Denizens (188), Vampire (189) and Wood Elf (190) — every position's QTY, cost, MA/ST/AG/PA/AV, Skills and Traits (with their values: Loner (3+/4+), Bloodlust (2+/3+), Hatred (Troll), Animosity (all / Goblin)), keywords, Primary/Secondary categories, the re-roll price and Apothecary, the Leagues and team special rules, and the printed cross-position limits ("a single Big Guy, chosen from the following" — Chaos Chosen, Old World Alliance, Underworld Denizens; "up to three Big Guy players" — Chaos Renegade). The 25 added in V5 were transcribed from the page images (the OCR text was only used to cross-check; where they disagreed — e.g. the Deathroller's AV 11+ — the image was read again). The book carries the FAQ (Nov 2025) values (e.g. Old World Alliance Halfling Hopefuls 0-3). League teams can also use custom players with any profile and any skill from the list below; tournament teams must use an included roster. Every Skill and Trait on the rosters is implemented (below); the V5 rosters were each played in a whole computer-v-computer match (`scripts/roster-selfplay.ts`, report `docs/selfplay/v5-rosters.md`) with every input checked, and three pairs are in the unit tests (`tests/rosters-v5.test.ts`). V4 build 3 checks for Lizardmen and Norse: `tests/rosters.test.ts`.

**Leagues and team special rules (pp.152–155).** Each included roster records its League(s) and special rules; a roster with two Leagues (Norse: Chaos Clash or Old World Classic) must choose one when drafted (the team builder asks), and the Norse gain *Favoured of Khorne* with Chaos Clash. The match shows each team's League and rules. What they change:

| Team rule | Rosters here | Status |
|---|---|---|
| None | Amazon, Bretonnian, Dark Elf, Elven Union, Gnome, Halfling, High Elf, Imperial Nobility, Lizardmen, Norse (Old World Classic), Old World Alliance, Skaven, Slann, Wood Elf | — |
| Favoured of… (p.154) | Chaos Chosen (choose any: Hashut, Khorne, Nurgle, Slaanesh, Tzeentch, Undivided), Chaos Renegade (Khorne, Nurgle, Slaanesh, Tzeentch or Undivided), Chaos Dwarf (Hashut), Khorne (Khorne), Nurgle (Nurgle), Norse with Chaos Clash (Khorne) | ✅ recorded; a team with a choice picks its alignment in the team builder when drafted (V5). It only decides which Star Players and Inducements a team may hire (V5 later steps) |
| Leagues | all | ✅ recorded; like Favoured of…, they only matter for Star Players and Inducements (V5 later steps) |
| Bribery and Corruption (p.154) | Black Orc, Dwarf, Goblin, Snotling, Underworld Denizens | ✅ **V5.** Once per game, a 1 rolled to Argue the Call may be re-rolled (the coach is asked; the computer accepts). |
| Low Cost Linemen (p.155) | Ogre, Snotling | ✅ recorded. It only changes the League Current Team Value (Linemen count 0 gp), which the app does not compute (League Inducements are not in the app). It also unlocks the Riotous Rookies Inducement (below). |
| Swarming (p.155) | Snotling | ✅ **V5.** After both teams have set up, the team rolls a D3 and may set up that many more Lineman players from the Reserves Box, following the usual set-up rules (own half, Wide Zone limits), so it may have more than 11 players on the pitch for that Drive; the kicking team swarms first when both can. A Swarming card (and tray bar) lists the Linemen in the Reserves Box, placed by click or drag; "Place them for me" / the computer put them one or two squares behind the Line of Scrimmage. Later set-up checks in the Drive (Solid Defence) allow the extra players. Sevens: applied the same way (Spike! 22 does not change it). |
| Team Captain (p.155) | Human, Orc | ✅ **V5.** One player (never a Big Guy) may be nominated in the team builder (radio in the Position column; quick teams nominate their first Blitzer); it gains **Pro** at no cost when the match starts; **while the Captain is on the pitch** (standing, Prone or Stunned), every Team Re-roll used is followed by a D6 — **a natural 6 makes it free** (given back; a Brilliant Coaching re-roll stays a Drive re-roll) — also inside the exact ball-chain previews (a separate 1/6 branch); set-ups must include the Captain if able (the default formation fields it). League-only parts not in the app: firing restrictions and appointing a new Captain after a death (nominate again in the team builder). |
| Brawlin' Brutes (p.154) | Orc | ✅ **V5.** League matches: 3 SPP for a Casualty, 2 for a Touchdown (the log names the rule; post-game table and saved SPP use it). |
| Masters of Undeath (p.155) | Tomb Kings | ✅ **V5.** Once per game, when an opposition player with ST 4 or less and without Stunty suffers a **Dead** result that stands (not saved by an Apothecary or Regeneration), the coach may **Raise the Dead**: a Skeleton Lineman joins the Reserves Box (even past 16); the computer always accepts. In a League the raised player is hired for free when the SPP are added after the game, unless the Team Draft List already has 16 players. Sevens: the Sevens Injury Table's Dead result counts (Sevens makes no Casualty Roll). |

**Inducements (V5 step 3, pp.141-147).** A Tournament / Exhibition team buys them in the team builder ("Inducements" table: cost, 0-N, who may buy them, effect), and they count towards its Team Draft Budget (pp.110, 116: in Exhibition and Matched Play Inducements come out of the budget; a team needs at least 11 players). League teams would buy them in the pre-game with Petty Cash and their Treasury (p.94) — not in the app; Blood Bowl Sevens has its own list (Spike! 22) — not in the app. The match card lists both teams' Inducements.

| Inducement | Cost · limit | In play |
|---|---|---|
| Part-time Assistant Coaches | 20,000 · 0-5 | ✅ +1 Assistant Coach each for the game (Brilliant Coaching) |
| Temp Agency Cheerleaders | 5,000 · 0-5 | ✅ +1 Cheerleader each (Cheering Fans) |
| Team Mascot | 25,000 · 0-1 | ✅ An extra Team Re-roll each half, offered with the other re-rolls; a D6 first: 4+ used, 1-3 lost for the half and another re-roll may be used (Loner still applies). A natural 1 for Cheering Fans is re-rolled. Previews use it exactly, the exact ball-bounce solver too (V5 step 6: after the other re-rolls, 4+ first, Loner checked). |
| Weather Mage | 25,000 · 0-1 | ✅ Once per game at the start of the team's Turn (before any activation): 2D6 with a chosen modifier −2…+2 on the Weather Table (a control on the match card; input `weatherMage`). The computer does not use it. |
| Blitzer's Best Kegs | 50,000 · 0-2 | ✅ +1 per Keg to each Knocked-out recovery roll |
| Bribes | 100,000 · 0-3 (Bribery and Corruption: 50,000 · 0-6) | ✅ The team starts with them (the existing Bribe rule, after Argue the Call) |
| Extra Team Training | 100,000 · 0-8 | ✅ +1 Team Re-roll each for the game. Interpretation: it is part of the team's re-rolls and is replenished at half-time with them. |
| Mortuary Assistant | 100,000 · 0-1, Masters of Undeath | ✅ Once per game, re-roll a failed Regeneration roll (asked) |
| Plague Doctor | 100,000 · 0-1, Favoured of Nurgle | ✅ Once per game: re-roll a failed Regeneration roll, or be used as an Apothecary |
| Riotous Rookies | 150,000 · 0-1, Low Cost Linemen | ✅ In the pre-game, 2D3+1 Journeymen (the roster's Lineman with Loner (4+)) join the Reserves Box for the game |
| Wandering Apothecary | 100,000 · 0-2, teams that can hire an Apothecary | ✅ Each once per game like the Apothecary (the team's own is offered first) |
| Halfling Master Chef | 300,000 (Halfling 100,000) · 0-1 | ✅ At the start of each half, 3D6: each 4+ gives a Team Re-roll for the half and takes one from the opponent (not below 0; not Brilliant Coaching re-rolls) |
| Biased Referee: Dodgy League Rep | 120,000 (Bribery and Corruption 80,000) · 0-1 | ✅ Close Scrutiny: after an opposition Foul that did not end in a Sent-off, D6 5+ sends the fouler off (the usual Sent-off procedure: Argue the Call, Bribe; Turnover). "I didn't see a thing": +1 to the team's Argue the Call (a natural 1 still ejects the coach). |
| Infamous Coaching Staff: Josef Bugman | 100,000 · 0-1 | ✅ +1 to Knocked-out recovery; Dwarfen Wisdom: once per game, after the set-ups (and Swarming) and before the kick, the coach is asked; D3 players may be set up again (the Solid Defence card, input `dwarfenWisdom`). The computer does not use Dwarfen Wisdom. A team with this Inducement cannot also hire Josef Bugman the Star Player (V5 step 5). |
| Mercenary Players | roster cost + 30,000 · 0-3 | ✅ A roster player marked Mercenary (tick "Add players as Mercenaries"): counts towards the position's limit, Loner (4+) in the match, one Primary skill for +50,000 gp |
| Prayers to Nuffle | 10,000 · 0-3 | ✅ **V5 step 4.** A D16 each in the pre-game (a result the team already has is rolled again), shown on the match card; effects for the game (p.143): 1 Treacherous Trapdoor (the Trapdoors are drawn at (6,1) and (19,13), Sevens (5,1) / (14,9); entering one — a move, Jump / Leap, a push or a Follow-up — then a D6: 1 falls through, a Crowd Injury Roll, a held ball bounces from the Trapdoor; interpretation: the roll comes once the move into the square is complete (pushed players after the Block is resolved), and a player of the active team falling through in their own activation is a Turnover), 2 Friends with the Ref (Argue 5-6), 3 Stiletto (random player: Stab), 4 Iron Man (chosen: AV +1, max 11+), 5 Knuckle Dusters (chosen: Mighty Blow), 6 Bad Habits (D3 random opponents: Loner (2+)), 7 Greasy Cleats (random opponent: MA −1, min 1), 8 Blessing of Nuffle (random: Pro), 9 Moles under the Pitch (opponents −1 to Rush, also in previews and routes), 10-13 the SPP Prayers (recorded; Exhibition teams earn no SPP, so no effect in the app), 14 Throw a Rock (a control on the match card at the start of a Turn, input `throwARock`: a random opponent on the pitch, 4+ Knocked Down, no Turnover; the computer uses it at once), 15 Under Scrutiny (an opposing fouler who breaks armour is Sent-off), 16 Intensive Training (random player, a Primary skill of the coach's choice). Random players come from the team's players still in the match. |
| Star Players | varies · 0-2 | ✅ **V5 step 5** — see *Star Players* below |
| Wizard (Sports-Wizard) | 150,000 · 0-1 | ✅ **V5 step 6** (p.149). Once per game, "at the end of any Turn, before the next Turn begins": **Fireball** (any square: a D6 for each player in it or next to it, both teams, 4+ hit — Standing: Knocked Down with +1 to the Armour Roll; Prone / Stunned: an Armour Roll with +1; the modifier always applies) or **Zap!** (any player on the pitch: D6 ≥ ST or a natural 6, never a natural 1 → a Frog: MA 5, ST 1, AG 2+, PA -, AV 5+, Dodge, Leap, No Ball, Stunty, Titchy, Very Long Legs; a ball carrier's ball Bounces; a Frog's Casualty is always Badly Hurt, no Casualty Roll, no Apothecary; back to normal at the end of the Drive, Reserves Box). **Interpretations:** the gap between two Turns stays open from the end of a Turn until the next Turn's first activation (or Weather Mage / Throw a Rock), so either coach may cast then; also after the last Turn of a Drive (Touchdown, end of the half) until the next Drive — the ball is dead then and is not bounced; nothing a spell causes is a Turnover; the Fireball's +1 applies even against Iron Hard Skin (it is not a player's modifier); a Frog cannot use a Star Player's special rule. Interface: the match card (Fireball… / Zap!…, click the square or player, review the odds, Cast — or "End the Turn and cast" during your own Turn); the dice appear in the dice tray. Computer: at the start of its own Turn it weighs Zap! on the opponents that matter and Fireball on the squares that hit most opponents, evaluates them exactly and casts only if the gain beats keeping the spell (worth more early in the match). Not in the Blood Bowl Sevens Inducement list (Spike! 22 p.14; only through the Magic Scroll Desperate Measure, not in the app). |

## Star Players (V5 step 5, pp.148, 194-211)

**Hiring (Tournament / Exhibition teams).** The team builder lists the Star Players who play for the team — the
League it chose, or a special rule such as Favoured of Nurgle (p.194); "any team" and Morg 'n' Thorg's "any team
except the Sylvanian Spotlight" too — with cost, profile, Skills & Traits and special rule ("Show every Star Player"
lists the rest with the reason). At most two per team, a pair (Grak & Crumbleberry, Dribl & Drull, the Swift Twins)
counting as one and paid once but taking two places; never more than 16 players; Star Players count towards the 11
(p.110) and their fee is part of the Inducements in the Team Draft Budget. A team with Josef Bugman as Infamous
Coaching Staff cannot hire Josef Bugman the Star Player (p.147). In the match they keep the printed profile, earn no
Star Player Points and are not MVP nominees, and a Prayer to Nuffle never selects them (p.142); Casualties are waived
after the game (nothing to record for these teams). Set-up: the "Default formation" (which the computer uses for its
own set-up) fields the hired Star Players — and the Team Captain — when a team has more than 11 players available;
the highest-numbered others wait in the Reserves Box (a coach can still set up any legal formation by hand). League teams (Petty Cash and Treasury, p.94), Matched Play Skill
Points (p.112) and Blood Bowl Sevens teams: not in the app yet.

**Special rules in play** (each once per game unless noted; "asked" = a decision for the Star Player's coach):

| Star Player (page) | Rule | How it works in the app |
|---|---|---|
| Akhorne the Squirrel (195) | Blind Rage | Dauntless may be re-rolled (the re-roll offered with the others). |
| Anqi Panqi (195) | Savage Blow | On a Block: re-roll any selection of the Block dice (asked). |
| Barik Farblast (195) | Blast It! | His Hail Mary Pass: after the scatter, any of the three D8 may be re-rolled (asked — the option that gives his team the best chance of ending with the ball is marked); a team-mate catching it +1. **Step 6:** previews use the exact landing distribution with that best re-roll (every ball chain solved exactly), and the computer makes the same choice. |
| Bilerot Vomitflesh (195) | Putrid Regurgitation | Once per half, Projectile Vomit without the Trait — as a Special Action, or right after his Block Action (asked). |
| The Black Gobbo (196) | Sneakiest of the Lot | Two Foul Actions per Turn, one of them by him. |
| Boa Kon'ssstriktr (196) | Look Into My Eyes | At the start of his activation, Marking the ball carrier: D6 2+ he takes the ball and his activation ends; on a 1 it goes on. |
| Bomber Dribblesnot (196) | Kaboom! | An opponent who catches his bomb: it explodes instead (asked). |
| Captain Karina von Riesz (196) | Tasty Morsel | After a failed Bloodlust roll, an adjacent opposition player with ST 3 or less (not a Star Player) may be bitten as a Thrall (Casualty = Badly Hurt; the bite feeds her). |
| Cindy Piewhistle (197) | All You Can Eat | Ticked when planning the Throw Bomb: after the first bomb, a second one (target asked), then D6 1-3 Sent-off (Argue the Call / Bribe; Turnover unless Bribed). |
| Count Luthor von Drakenborg (197) | Star of the Show | His Touchdown: +1 Team Re-roll added when the next Drive starts (after half-time too), lost at its end. |
| Crumbleberry (197) & Grak (200) | I'll Carry You | Once per half, Grak next to Crumbleberry picks him up at the start of his activation (Grak has Break Tackle and Dodge meanwhile); at the end of the activation Crumbleberry is set down next to Grak (square asked; no free square: Reserves Box). |
| Deeproot Strongbranch (197) | Reliable | His Fumbled Throw Team-mate: the thrown player bounces and lands safely (a bounce onto a player still crash-lands). |
| Dribl & Drull (198) | A Sneaky Pair | +1 to a Foul or a Stab against a player Marked by both. |
| Eldril Sidewinder (198) | Mesmerizing Dance | Once per half, re-roll a Hypnotic Gaze. |
| Estelle la Veneaux (198) | Baleful Hex | At the start of her activation, an opponent within 5 squares: D6 2+ Distracted and cannot be activated during their team's next Turn (in the same half). |
| Fungus the Loon (199) | Whirling Dervish | Once per activation, re-roll the Ball & Chain direction D6 (asked). |
| Glart Smashrip (199) | Frenzied Rush | Once per half, declaring a Blitz: Frenzy for the activation (asked), and no Grab. |
| Gloriel Summerbloom (199) | Shot to Nothing | Declaring a Pass Action: Hail Mary Pass for the activation (asked). |
| Glotl Stop (199) | Primal Savagery | A failed Animal Savagery may lash out at an adjacent opposition player (Knocked Down, Claws / Mighty Blow as for the team-mate rule; no Turnover). |
| Grashnak Blackhoof (200) | Gored by the Bull | Blocking in a Blitz: one more Block die (max 3), also for the Frenzy second Block (asked). |
| Gretchen Wächter (200) | Incorporeal | At the start of her activation: no Dodge rolls for the rest of it (so no Diving Tackle and no Shadowing on them; Tentacles still apply). |
| Griff Oberwald (200) | Consummate Professional | +1 to an Agility Test (Dodge, Jump / Leap, pick-up, catch, Interception, landing) after seeing the roll (asked). Previews (step odds, the exact ball-chain solver, the choice of interceptor) count it when it turns a failure into a success. |
| Grim Ironjaw (201) | Slayer | Knocking Down a Big Guy with a Block: +1 to the Armour or the Injury Roll after the roll. |
| Grombrindal (201) | Wisdom of the White Dwarf | At the start of his activation: a team-mate within 2 squares gains Break Tackle, Dauntless, Mighty Blow or Sure Feet until the end of the Turn. |
| Guffle Pusmaw (201) | Quick Bite | An opponent he Marks catches the ball: an Armour Roll against them (asked); broken — Guffle has the ball, no Turnover for it. **Step 6:** the previews include it (the exact ball-chain solver makes the Armour Roll after every catch next to him; previews assume he uses it). |
| Hakflem Skuttlespike (201) | Treacherous | At the start of his activation: takes the ball from an adjacent team-mate, who is Knocked Down (no Turnover). |
| Helmut Wulf (202) | Old Pro | Pro (3+) to re-roll one die of an Armour Roll: his chainsaw's or Block's against an opponent, or one against him (asked). |
| H'Thark the Unstoppable (202) | Unstoppable Momentum | Every Block in a Blitz: re-roll one Block die. |
| Ivan 'the Animal' Deathshroud (202) | Dwarven Scourge | Knocking Down an opponent with a Block: +1 (+2 against a Dwarf) to the Armour or the Injury Roll after the roll. |
| Ivar Eriksson (202) | Raiding Party | Once per Drive, at the start of his activation: an Open team-mate within 5 squares moves 1 square to a square where they Mark an opponent (not onto the ball). |
| Jeremiah Kool (203) | The Flashing Blade | At the start of his Move Action: a Stab against an opponent he Marks, then the Move. |
| Jordell Freshbreeze (203) | Swift as the Breeze | A Dodge, Leap or Rush test passes on a 2+ regardless of modifiers, after seeing the roll (asked). |
| Josef Bugman (203) | Dwarfen Grit | When his armour is broken: the Armour Roll is re-rolled (asked; the opponent's modifiers apply again). |
| Karla von Kill (203) | Indomitable | A successful Dauntless: her ST becomes double the target's (asked). |
| Kiroth Krakeneye (204) | Black Ink | At the start of an activation: an opponent he Marks becomes Distracted until next activated. |
| Kreek Rustgouger (204) | I'll Be Back | The first Secret Weapon Sent-off of the game does not happen (no Argue the Call). |
| Lord Borak the Despoiler (204) | Lord of Chaos | On a Block: re-roll one Block die. |
| Maple Highgrove (204) | Vicious Vines | Once per half, a Block Action against a Standing opponent exactly 2 squares away (pushed away from Maple's square), no Follow-up. |
| Max Spleenripper (205) | Maximum Carnage | After a Chainsaw Attack, another one against a different adjacent opponent (asked). |
| The Mighty Zug (205) | Crushing Blow | Knocking Down an opponent with a Block: +1 to the Armour Roll after the roll. |
| Morg 'n' Thorg (205) | The Ballista | Re-roll the Passing Ability Test of a Throw Team-mate. |
| Nobbla Blackwart (205) | Kick 'em While They're Down! | A Chainsaw Attack on a Prone or Stunned adjacent opponent (not a Foul, never Sent-off for it). |
| Puggy Baconbreath (206) | Halfling Luck | Re-roll one die he rolled — a test or one Block die (never Armour, Injury or Casualty). |
| Rashnak Backstabber (206) | Toxin Connoisseur | A Stab that breaks armour: +1 to the Injury Roll after the roll. |
| Ripper Bolgrot (206) | Thinking Man's Troll | As Halfling Luck, once per half. |
| Rodney Roachbait (206) | Catch of the Day | Once per half, Standing at the start of his activation within 3 squares of the ball on the ground: D6 3+ and he has it. |
| Rowana Forestfoot (207) | Bounding Leap | Chosen before any dice for the Leap: no negative modifiers to its Agility Test, and a re-roll. |
| Roxanna Darknail (207) | Slashing Nails | Once per half, declaring a Blitz: Claws for the activation (asked). |
| Rumbelow Sheepskin (207) | Ram | Knocking Down an opponent with a Block: +1 to the Armour or the Injury Roll after the roll. |
| Scrappa Sorehead (207) | Yoink! | Trying to Intercept: D6 2+ he intercepts without the Agility Test (asked; on a 1 he rolls as normal). |
| Scyla Anfingrimm (208) | Fury of the Blood God | A 1 for Unchannelled Fury on a Block Action: two Block Actions instead (the second target asked after the first is resolved). |
| Skitter Stab-Stab (208) | Master Assassin | Re-roll the Armour Roll of a Stab. |
| Skrorg Snowpelt (208) | Pump Up the Crowd | A Casualty from a Block Action he is part of: +1 Team Re-roll until the end of the Drive. |
| Skrull Halfheight (208) | Strong Passing Game | A Pass Action: add his ST to the Passing Ability Test result (at most 6), after seeing the roll (asked). |
| Lucien & Valen Swift (209) | Working in Tandem | Lucien: re-roll one Block die against a player Valen also Marks. Valen: a Pass to Lucien's square has no range modifier. |
| Swiftvine Glimmershard (209) | Furious Outburst | Once per half, Standing: placed next to a Standing opponent within 3 squares (square asked), a Stab, then placed in any free square within 3 (or stays); her activation ends; it is the team's Blitz. Placing ignores Tackle Zones; landing on the ball makes it bounce. |
| Thorsson Stoutmead (209) | Beer Barrel Bash | Once per Drive, at the start of his activation: an opponent within 3 squares — D6 3+ Knocked Down, 2 nothing, 1 he Falls Over (Turnover); his activation ends. |
| Varag Ghoul-Chewer (210) | Krump and Smash | Knocking Down an opponent with a Block: re-roll the Armour Roll when it holds (asked). |
| Wilhelm Chaney (210) | Savage Mauling | Re-roll an Injury Roll against an opponent caused by his Block or Foul (asked). |
| Willow Rosebark (210) | Woodland Fury | A Block that would Knock her Down: re-roll one Block die. |
| Withergrasp Doubledrool (210) | Watch Out! | The first Block against him each Drive: he counts as having Dodge for it. |
| Zolcath the Zoat (211) | "Excuse me, are you a Zoat?" | At the start of his activation: an opponent within 3 squares becomes Distracted. |
| Zzharg Madeye (211) | "Blastin' Solves Everything" | Once per half, at the start of his activation: a Standing opponent within 3 squares — D6 3+ hit, 2 the opposing coach picks a player within 3 squares of them, 1 Zzharg — an Armour Roll (Injury if broken; not Knocked Down); his activation ends. |

**Using a rule at the start of an activation** (Kiroth, Zolcath, Estelle, Boa, Hakflem, Ivar, Grombrindal, Rodney,
Grak, Jeremiah, Gretchen, Thorsson, Zzharg, Swiftvine; Maple, Nobbla, Bilerot): the selected Star Player's "★ rule"
button in the tray uses it at once (then the activation goes on as a Move Action, or ends); to use it with another
Action, tick "★ … at the start of this activation" while planning that Action (the preview includes it). The choices
(target, square, skill) are asked as decisions after the Action is declared and after any activation roll (Bone Head
etc.). In the engine: the player action input field `starRule: true` (and optionally `starTarget`, the rule's target
chosen in advance), decisions of type `starRule`.

**The computer and these rules (V5 step 6).** The computer now starts them itself when they pay: Thorsson, Zzharg,
Swiftvine, Boa and Rodney are weighed as actions of their own (on their two best targets: the opposing ball carrier
first, then opponents next to its own carrier, then the strongest); Kiroth, Zolcath, Jeremiah Kool and Gretchen as
their player's two best actions with the rule used first; Maple's, Nobbla's and Bilerot's variants as Blocks /
Special Actions. Every option is evaluated exactly with the engine's own outcome tree, and the value of keeping the
rule for later is subtracted (1.5 for a once-per-game rule, 0.8 per half, 0.5 per Drive) — so, for example,
Thorsson bashes the opposing ball carrier but not when he holds the ball himself (a 1 would drop it). Not used by
the computer (their value lies outside a one-action look-ahead): Estelle's Hex, Hakflem's Treacherous, Ivar's
Raiding Party, Grombrindal's Wisdom, Grak's I'll Carry You, Cindy's second bomb. Zzharg's D6 2 choice for the other
coach: the computer picks one of Zzharg's own team if it can (lowest AV), otherwise its own player least likely to
be hurt. Self-play: `docs/selfplay/v5-stars.md`.

**Previews (V5 step 6).** The exact ball-chain solver resolves each catch exactly as the match does with the
previews' decision policy — Griff's +1 after the roll, Puggy's / Ripper's re-roll (after the Catch skill), Pro, the
Sevens Veteran, Team / Leader Re-rolls (Team Captain), the Team Mascot (4+ first), Loner checks — and makes Guffle's
Quick Bite Armour Roll after a catch next to him (tests: `tests/stars-preview.test.ts` compare the solver with the
match code's own catch). Barik's Hail Mary uses the best re-roll of the three D8 (the computer makes the same
choice). The step odds shown while planning include a Star Player's +1 / 2+ after the roll.

## Match modes and Tournament play (V5 step 6)

The app has three modes — **League**, **Tournament**, **Exhibition** — and two formats, **11-a-side** and **Sevens**
(Spike! Journal 22), chosen within Tournament and Exhibition. Practice is not a mode any more: its free set-up board
is the Exhibition card's **Tactical board**.

| Mode | Formats | Team building | Skills |
|---|---|---|---|
| League | 11-a-side (Sevens League play, Spike! 22 pp.14-17, not in the app) | saved team state (flexible) | Star Player Points and advancement (pp.96-97); never Skill Points |
| Tournament | 11-a-side, Sevens | **Matched Play**: 11-a-side pp.110-113 — Team Draft Budget 1,100,000 / 1,150,000 / 1,200,000 gp (1,100,000 by default), Dedicated Fans start at 0 (5,000 gp each, max 3); Sevens Spike! 22 pp.18-19 — 600,000 gp, Dedicated Fans from 0 (20,000 gp each) | **Skill Points by Tier** — 11-a-side Tier 1-4 = 6 / 8 / 9 / 10 (p.112), Sevens 1 / 2 / 3 / 4 (Spike! 22 p.19); a Primary skill 1, a Secondary skill 2; 11-a-side at most 1 / 2 / 3 / 4 Secondary skills by Tier, Sevens one for the team; one extra skill per player; Elite skills (Block, Dodge, Guard, Mighty Blow) at most 4 (11-a-side) / 2 (Sevens); 11-a-side Star Players cost 2 Skill Points each (a pair once), Tier 1 teams at most one, Star Players cannot be given skills. Skills bought do not add to the team's cost. |
| Exhibition | 11-a-side, Sevens | drafted like before (pp.89-91, Sevens pp.8-9; Exhibition Play pp.114-117) | no purchased skills (a team moved from Tournament keeps its purchases on file, unused, with a warning) |

**Tiers.** The rulebook and Spike! 22 give the Skill Points *per Tier* but not the Tier list (it is in the Blood Bowl
Designers' Commentary). The coach chooses a Tournament team's Tier; the Tiers the sources do state are suggested:
Sevens — Norse Tier 1 (Spike! 22 p.26), Goblin Tier 4 (p.27), Chaos Chosen Tier 2 (p.29); 11-a-side — Wood Elf
Tier 1 (rulebook p.113, the Skill Points example). Any other roster starts at Tier 2 until the coach changes it; the
Home screen remembers the Tier chosen for each roster and format. **Mega-stars** (4 Skill Points, at most one) are
also listed only in the Designers' Commentary: no Star Player is treated as a Mega-star.

**The quick Sevens Tournament against the computer** (Home, Tournament card — the default format): the Skill Points
of both teams are set from their Tiers and shown on the match card. The ready-made teams keep exactly the players
they had before and buy no skills (how to spend the points is not decided for you — "Edit a copy…" saves your team as
a Tournament team to spend them in the team builder, and the Home screen then offers that saved team). Tournament
matches use standard dice (the D6 difficulty house rule is offered for Exhibition and League matches only).

**Saved teams from earlier versions:** drafted teams without a mode are Exhibition teams (their data is unchanged);
the team editor's "Mode" moves a team to Tournament (it then needs a Tier).

## Unsupported actions (summary)

Extra Time and Penalties; League-play Inducements and Journeymen; the post-game sequence except Star Player Points, the MVP and advancement. They are shown disabled with a reason where they would appear. (V4: every Skill and Trait of the catalogue below is implemented — 108 of 108.)

## How unsupported skills are kept out

A skill is never silently ignored when it would change a supported action. The mechanism is kept for the future (`gated()` in `src/engine/skills.ts` switches a skill's rules off while it is not verified; a player with such an activation Trait cannot be activated, Blocks against such a player and Passes past such an opponent are disabled with the reason), but in V4 **no skill is switched off**: every Skill and Trait in the catalogue is implemented, each with tests.

## Interpretations (where the rulebook leaves room)

These are stated in the app where they matter, and can be checked in the tests.

1. **Range Ruler for Interceptions (p.71).** The ruler is modelled as a strip 1.8 squares wide from the centre of the thrower's square to the far edge of the landing square (with a rounded end). An opponent can intercept if that strip overlaps their square. The width can be changed per position in Setup ("Ruler width").
2. **Inaccurate passes that leave the pitch** cannot be intercepted; the ball is thrown in.
3. A **throw-in** that lands in an empty square Bounces.
4. **Ending the Turn** while a ball carrier who could score without rolling dice has not been activated counts as foregoing that player's activation, so the Stalling check (The Crowd Takes Action) applies.
5. **Tentacles** is resolved before the Dodge roll; **Shadowing** after the Dodge roll whether it succeeded or not.
6. In a **chain push**, a square occupied by a player who uses Stand Firm counts as blocked.
7. **Re-rolls** are offered only after a failed roll.
8. After a failed **Pro** check, the same die cannot be re-rolled with a Team Re-roll (a die is never re-rolled twice).
9. **Pouring Rain** also applies its −1 to the Secure the Ball roll ("whenever a player attempts to pick up the ball").
10. A player whose **PA is "-"** cannot declare a Pass Action.
11. **Charge! (p.48).** Up to D3+3 Open players of the kicking team are activated for a free Move (one may Blitz, one may Throw a Team-mate) while the ball is in the air; the Turn marker does not move. Any Turnover-type event of a selected player (Falls Over, Knocked Down, a thrown team-mate eaten or crashing) ends the Charge; the kicking coach may also end it. Then the ball lands.
12. **Cheering Fans (p.48)** applies to the first *Block Action* of the team's next Turn, not to the Block of a Blitz Action (literal reading of "Block Action").
13. **Brilliant Coaching (p.48)**: the free Team Re-roll is spent before the normal ones (it would be lost at the end of the Drive anyway).
14. **Kick (p.130)** is chosen when the kick is placed, before the Deviation roll.
15. **Throw Team-mate**: a thrown player who leaves the pitch causes a Turnover even without the ball; landing on the ball's square makes the ball bounce; a Stunned team-mate can be thrown (the landing then fails). **Projectile Vomit**: a Stunned result on the vomiting player is not a Turnover unless they held the ball.
16. **Take-backs (p.35)**: the app's Undo exists for practice and analysis only; it restores the whole state including the dice generator, so repeating the same action gives the same dice.

## Assumptions behind the previewed probabilities

The preview never rolls dice. When a result depends on a choice that has not been made yet, it states the assumption instead of pretending there is one exact number. The app shows these under every preview:

- **Re-rolls:** a failed roll is re-rolled with a skill first (Dodge, Sure Feet, Sure Hands, Catch, Pass), then Pro, then a Team/Leader Re-roll. Probabilities are shown both without and with Team Re-rolls. You still choose every re-roll during execution.
- **Block dice:** the choosing coach takes the result that is best for them (knock-down without falling > push > nothing > both down > player down), taking Block, Dodge, Tackle, Wrestle and Juggernaut into account. The attacker re-rolls block dice only when every result is bad for them. The block panel also lists the chance of each face appearing, which does not depend on any choice.
- **Pushes:** the first listed push square is assumed; you pick the real one during execution. The defender uses Stand Firm, Fend and Sidestep.
- **Mighty Blow / Arm Bar:** used on the Armour Roll only if that breaks the armour, otherwise on the Injury Roll.
- **Opponents** always use Diving Tackle, Tentacles and Shadowing when able, and always try the most likely Interception.
- **Casualty and Regeneration** rolls are not explored (they cannot change anything else during the Turn); the **Apothecary** is assumed not to be used.
- **Follow-up:** follow up after a push (a toggle in the plan panel lets you preview not following up).

Probabilities are computed by exact enumeration of every dice outcome with the same code that executes the action (bouncing-ball chains are solved exactly as a Markov chain). Branches less likely than 1 in a billion are not expanded; their total is shown as "not computed" instead of being guessed.

## Skills and Traits (pp.123–138)

The table below is generated from the engine's skill catalogue (`src/engine/skills.ts`).

<!-- skills:start -->
108 Skills and Traits: 108 implemented, 0 partly, 0 with no effect on anything the app can do, 0 not implemented.

| Skill / Trait | Page | Type | Status | What it does in the app |
|---|---|---|---|---|
| Accurate | 123 | Passing | ✅ implemented | +1 to the Passing Ability Test for a Quick or Short Pass. |
| Always Hungry* | 123 | Trait | ✅ implemented | Throw Team-mate: roll a D6 before the Passing Ability Test; on a 1 roll again: 2+ the team-mate squirms free (Fumbled Throw), 1 the team-mate is eaten (Turnover). |
| Animal Savagery* | 123 | Trait | ✅ implemented | After declaring an Action: D6 (+2 for a Block or Blitz), 4+ acts as declared. On 1-3 an adjacent Standing team-mate (the coach's choice) is Knocked Down — Claws and Mighty Blow must be used on its Armour Roll; no Turnover unless it held the ball — or, with none adjacent, the player is Distracted. **Interpretation: after lashing out the declared Action is not performed (the activation ends).** |
| Animosity* | 123 | Trait | ✅ implemented | Pass/Hand-off to a team-mate with the keyword: roll a D6, on a 1 the player refuses and the activation ends. |
| Arm Bar | 123 | Strength | ✅ implemented | If an opponent Falls Over dodging/jumping/leaping out of this Tackle Zone, +1 to the Armour or Injury Roll. |
| Ball & Chain* | 124 | Trait | ✅ implemented | The only Action is the Ball & Chain Special Action: each step the Throw-in Template faces an End Zone or a Sideline and a D6 picks the square (no Dodges, no Shadowing or Tentacles); a Standing player there is Blocked (Foul Appearance ignored; against a team-mate this coach picks the result), a Prone / Stunned one is Pushed Back with an Armour Roll, the ball Bounces (no Turnover); off the pitch: the crowd. Up to MA steps, Rushes as normal (a failed Rush moves first). Knocked Down, Falls Over or Placed Prone: an Injury Roll at once, Stunned counts as Knocked-out. **Each step is planned and confirmed on its own (choose the facing, Confirm). Interpretation: going into the crowd is a Turnover.** |
| Big Hand | 124 | Mutation | ✅ implemented | Ignores all negative modifiers when picking up the ball. |
| Block | 124 | General | ✅ implemented | May choose not to be Knocked Down on a Both Down result. |
| Bloodlust* | 125 | Trait | ✅ implemented | After declaring an Action: D6 (+1 for a Block or Blitz); below X+ or a natural 1: the Action may become a Move Action, and the player must bite an adjacent Thrall Lineman (Injury Roll, Casualty → Badly Hurt) before a Pass, a Hand-off or scoring, or at the end of the activation — otherwise Turnover, Distracted, the ball dropped. **A Thrall is a team-mate with the Thrall keyword (custom League players).** |
| Bombardier | 125 | Trait | ✅ implemented | Throw Bomb Special Action (one per Turn, no move first): thrown like a Pass (range, Passing Ability Test, Pass skills except On the Ball, Interceptions). Where it comes to rest — or in the hands of a player who drops it, or of a fumbling thrower — it explodes: the player in the square is hit, each adjacent player on 4+; Standing → Knocked Down, Prone / Stunned → Armour Roll. Caught or intercepted: thrown again at once. **Interpretations: a bomb that leaves the pitch explodes harmlessly in the crowd; a Safe Pass natural 1 keeps the bomb, which fizzles out; a player without Passing Ability who catches it cannot throw it (it explodes). Previews stop exploring below 1 in 10,000.** |
| Bone Head* | 126 | Trait | ✅ implemented | After declaring an Action roll a D6: on a 1 the player becomes Distracted. |
| Brawler | 126 | Strength | ✅ implemented | When it declares a Block Action, may re-roll a single Both Down result — once per Block Action (FAQ 2026; earlier matches keep their recorded behaviour). |
| Break Tackle | 126 | Strength | ✅ implemented | Once per Turn, +1 (ST 3 or less), +2 (ST 4) or +3 (ST 5+) to a Dodge Agility Test. |
| Breathe Fire | 126 | Trait | ✅ implemented | Breathe Fire Special Action: D6 against a Standing opponent this player Marks (−1 if its ST is 5+): 1 this player is Knocked Down, 2-3 nothing, 4+ the target is Placed Prone, a natural 6 Knocks it Down; may replace the Block of a Blitz; the activation ends. |
| Bullseye | 126 | Strength | ✅ implemented | A Superb Throw lands in the target square without scattering. |
| Cannoneer | 126 | Passing | ✅ implemented | +1 to the Passing Ability Test for a Long Pass or Long Bomb. |
| Catch | 126 | Agility | ✅ implemented | May re-roll a failed Agility Test to Catch the ball. |
| Chainsaw* | 126 | Trait | ✅ implemented | Chainsaw Attack Special Action: D6, 1 Kick-back (this player is Knocked Down), 2+ an Armour Roll +3 against an adjacent Standing opponent; may replace the Block of a Blitz; may be used for a Foul (+3, Kick-back first). +3 to Armour Rolls against this player whenever it goes down. **Iron Hard Skin cancels the +3 against its owner.** |
| Claws | 127 | Mutation | ✅ implemented | Armour of a player it Knocks Down in a Block breaks on a natural 8+. |
| Cloud Burster | 127 | Passing | ✅ implemented | Opponents may not Intercept this player's passes. |
| Dauntless | 127 | General | ✅ implemented | Blocking a stronger player: roll D6 + ST; if higher than the target's ST, use the target's ST. |
| Decay* | 127 | Trait | ✅ implemented | +1 to Casualty Rolls against this player. |
| Defensive | 127 | Agility | ✅ implemented | In the opponent's Turn, opponents Marked by this player cannot use Guard. |
| Dirty Player | 127 | Devious | ✅ implemented | Foul Action: +1 to the Armour Roll or the Injury Roll (chosen after the roll). |
| Disturbing Presence* | 127 | Mutation | ✅ implemented | -1 to opponents' Pass, Catch and Intercept tests for each such player within 3 squares. |
| Diving Catch | 127 | Agility | ✅ implemented | May try to Catch a pass, throw-in or kick-off landing in an empty square next to them (not a bouncing ball); +1 to Catch a pass in the target square. **Interpretation: the diving player catches from their own square (they are not moved); one attempt, the active team's coach (the receiving team's at a kick-off) choosing first; a failed attempt bounces the ball from the landing square.** |
| Diving Tackle | 127 | Agility | ✅ implemented | After an opponent's Dodge/Jump/Leap test, apply -2 and be Placed Prone in the vacated square. |
| Dodge | 127 | Agility | ✅ implemented | Once per Turn re-roll a Dodge test; Stumble becomes Push Back. |
| Drunkard* | 127 | Trait | ✅ implemented | -1 to Rush rolls. |
| Dump-off | 128 | Passing | ✅ implemented | Targeted by a Block or a Special Action while holding the ball: may first make a Quick Pass (normal rules, never a Turnover). |
| Extra Arms | 128 | Mutation | ✅ implemented | +1 to Catch, Pick Up and Intercept. |
| Eye Gouge | 128 | Devious | ✅ implemented | Opponents it Pushes Back cannot assist until next activated. |
| Fend | 128 | General | ✅ implemented | When Pushed Back by a Block, the blocker may not Follow-up. |
| Foul Appearance* | 128 | Mutation | ✅ implemented | A player blocking it rolls a D6 first: on a 1 the Block is cancelled and its activation ends. |
| Frenzy* | 128 | General | ✅ implemented | Must Follow-up; if the target is still Standing, must Block it again. |
| Fumblerooski | 128 | Devious | ✅ implemented | During a Move Action with the ball: may leave the ball in a square the player moves out of (no Turnover). **In the plan: tick Fumblerooski to leave the ball in the square the move starts from (plan the move in parts to drop it further on). The computer opponent does not use it.** |
| Give and Go | 128 | Passing | ✅ implemented | After a Quick Pass or Hand-off without a Turnover, may keep moving. |
| Grab | 128 | Strength | ✅ implemented | Block Action: push the target into any unoccupied adjacent square; target cannot Sidestep (FAQ 2026 clarifications apply to new matches). |
| Guard | 129 | Strength | ✅ implemented | Assists Blocks however many opponents are Marking it. |
| Hail Mary Pass | 129 | Passing | ✅ implemented | May pass to any square as a Long Bomb; never Accurate; cannot be Intercepted. |
| Hatred* | 129 | Trait | ✅ implemented | Blocking a player with the keyword: may re-roll a single Player Down result. |
| Hit and Run | 129 | Agility | ✅ implemented | After a Block, may move one free square ending unmarked. FAQ 2026: also after a Blitz Stab (the activation then ends). |
| Horns | 129 | Mutation | ✅ implemented | +1 ST for Blocks during a Blitz. |
| Hypnotic Gaze | 129 | Trait | ✅ implemented | Hypnotic Gaze Special Action (move first): D6 3+ against an adjacent Standing opponent — it is Distracted; the activation ends either way. |
| Insignificant* | 129 | Trait | ✅ implemented | Team Draft List: no more players with this Trait than players without it (checked when building a team). |
| Iron Hard Skin | 129 | Mutation | ✅ implemented | Opponents cannot modify Armour Rolls against it; Claws does not work against it. |
| Juggernaut | 129 | Strength | ✅ implemented | Blitz: Both Down may be treated as Push Back; target cannot use Fend, Stand Firm or Wrestle. |
| Jump Up | 130 | Agility | ✅ implemented | Stands up for free; may Block from Prone after an Agility Test (+1). |
| Kick | 130 | General | ✅ implemented | Kicking player may make the kick Deviate D3 instead of D6 squares (match play). **Match play only: chosen when the kick is placed, before the Deviation roll.** |
| Kick Team-mate | 130 | Trait | ✅ implemented | Kick Team-mate Special Action (one per Turn, move first allowed): like Throw Team-mate but not the team's Throw Team-mate Action; a Fumbled kick is an Injury Roll for the kicked player (Stunned counts as Knocked-out; the ball Bounces). |
| Leader | 130 | Passing | ✅ implemented | A Leader on the pitch at the start of a half gives one Leader Re-roll for that half, usable while a Leader is on the pitch; lost if every Leader becomes a Casualty or is Sent-off before it is used. |
| Leap | 130 | Agility | ✅ implemented | May Leap over any adjacent square like a Jump; negative modifiers reduced by 1 (minimum -1). |
| Lethal Flight | 130 | Devious | ✅ implemented | Thrown by a team-mate and crash-landing on an opponent (also after a Bounce) who is Knocked Down: +1 to their Armour or Injury Roll (chosen after the roll); a Casualty is credited to this player (SPP in League matches). **Needs the Right Stuff Trait.** |
| Lone Fouler | 130 | Devious | ✅ implemented | Foul Action with no Offensive or Defensive Assists: may re-roll a failed Armour Roll. |
| Loner* | 131 | Trait | ✅ implemented | Using a Team Re-roll requires a D6 roll of X+ or the re-roll is lost. |
| Mighty Blow | 131 | Strength | ✅ implemented | +1 to the Armour or Injury Roll of a player it Knocks Down in a Block. |
| Monstrous Mouth | 131 | Mutation | ✅ implemented | Chomp Special Action: D6 3+ against a Standing opponent this player Marks — it cannot leave its square while this player Marks it; may replace the Block of a Blitz (the Blitz goes on). Strip Ball cannot be used against this player. **Interpretation: Chomped stops the player's own movement (moves, Dodges, Jumps, Follow-ups); a Block can still Push it Back.** |
| Multiple Block | 132 | Strength | ✅ implemented | When declaring a Block Action: Block two different opponents it Marks at the same time, at ST −2 for both, no Follow-up; both are resolved in full even if one causes a Turnover. Not with Frenzy. **Interpretation: both strengths (Dauntless first, then −2) are fixed before any dice; the dice are rolled one Block after the other; if the first Block knocks the blocker down, a Player Down / Both Down in the second only affects the target and the blocker's Active skills (e.g. Tackle) no longer apply (p.123); Pile Driver is not used. The computer opponent does not use Multiple Block.** |
| My Ball* | 132 | Trait | ✅ implemented | May not Pass or Hand-off the ball. |
| Nerves of Steel | 132 | Passing | ✅ implemented | Ignores Marking modifiers when Catching or Passing. |
| No Ball* | 132 | Trait | ✅ implemented | Automatically fails to Catch or Pick Up; cannot Intercept. |
| On the Ball | 132 | Passing | ✅ implemented | When an opponent passes (after the target is declared, before the Passing Ability Test): move up to 3 squares, no Rush, one player at a time; a fall ends the moves. At the kick-off (after the Deviation): one Open receiving player moves up to 3 squares in their own half (not on a Touchback). **The coach picks a player and a destination; the route with the fewest Dodges is walked (Jumps and Leaps not offered). The computer opponent does not use On the Ball; previews assume it is not used.** |
| Pass | 132 | Passing | ✅ implemented | May re-roll a failed Passing Ability Test. |
| Pick-me-up | 132 | Trait | ✅ implemented | At the end of the opponent's Turn, Prone team-mates within 3 squares stand up on a 5+. |
| Pile Driver | 133 | Devious | ✅ implemented | After Knocking Down an opponent in a Block Action and still Marking them: a free Foul on them, then this player is Placed Prone and the activation ends. **The free Foul is not the team's Foul Action of the Turn (interpretation).** |
| Plague Ridden | 133 | Trait | ✅ implemented | Once per game: a Dead result (not saved by an Apothecary) from this player's Block adds a new Lineman of the Team Roster to the Reserves Box (not against Big Guys or players with Decay, Regeneration or Stunty). **Matches only (the new player needs a Team Roster); hiring the player after the game is not part of this app.** |
| Pogo | 133 | Trait | ✅ implemented | May Pogo over any adjacent square like a Jump, ignoring negative modifiers. |
| Prehensile Tail | 133 | Mutation | ✅ implemented | -1 to opponents Dodging, Jumping or Leaping out of its Tackle Zone. |
| Pro | 133 | General | ✅ implemented | Once per activation, on a 3+ re-roll one dice (not Armour/Injury/Casualty). |
| Projectile Vomit | 133 | Trait | ✅ implemented | Special Action (or instead of a Blitz's Block): D6 2+ → unmodified Armour Roll for an adjacent Standing opponent; on a 1 → unmodified Armour Roll for this player. |
| Punt | 134 | Passing | ✅ implemented | Punt Special Action (one per Turn): move first, then with the ball face the Throw-in Template to an End Zone or a Sideline; D6 direction, D6 distance; catch or Bounce where it lands. No Turnover if it ends on the ground; a Turnover if an opponent has it or it went into the crowd. Kick: may re-roll the direction and/or the distance. **Interpretation: 'in the crowd' is the punted ball leaving the pitch in flight; a later Bounce out of the pitch is thrown in without a Turnover (unless an opponent ends with the ball). The computer opponent does not punt.** |
| Put the Boot In | 134 | Devious | ✅ implemented | Gives Offensive Assists to a team-mate's Foul however many opponents Mark this player (not while Marked by a Defensive player in the opponent's Turn). |
| Quick Foul | 134 | Devious | ✅ implemented | The activation does not end after a Foul: the player may keep moving with any movement left. |
| Really Stupid* | 135 | Trait | ✅ implemented | After declaring an Action roll a D6 (+2 with a helpful adjacent team-mate): on 1-3 becomes Distracted. |
| Regeneration | 135 | Trait | ✅ implemented | On a Casualty, a 4+ sends the player to the Reserves instead. |
| Right Stuff* | 135 | Trait | ✅ implemented | Can be thrown by a team-mate with Throw Team-mate, even if Prone. |
| Saboteur | 135 | Devious | ✅ implemented | Knocked Down by an opposition Block: D6 4+ before the Armour Roll — the blocker is also Knocked Down (no Turnover unless holding the ball) and this player is Knocked-out. |
| Safe Pair of Hands | 135 | Agility | ✅ implemented | When going down with the ball, may place it in an adjacent unoccupied square instead of Bouncing. |
| Safe Pass | 135 | Passing | ✅ implemented | A natural 1 on the Passing Ability Test is not a Fumble: keep the ball, activation ends, no Turnover. |
| Secret Weapon* | 135 | Trait | ✅ implemented | Sent-off at the end of each Drive the player took part in (match play; Argue the Call / Bribes offered). **Match play only. Practice positions have no Drives, so it has no effect there.** |
| Shadowing | 135 | Devious | ✅ implemented | When an opponent Dodges out of its Tackle Zone, on a 4+ move into the vacated square (MA times per Turn). |
| Sidestep | 135 | Agility | ✅ implemented | When Pushed Back, its coach chooses any adjacent unoccupied square. |
| Sneaky Git | 136 | Devious | ✅ implemented | Not Sent-off for a natural double on the Foul's Armour Roll unless the armour is broken. |
| Sprint | 136 | Agility | ✅ implemented | May Rush one extra time during a Move Action. |
| Stab | 136 | Trait | ✅ implemented | Stab Special Action (any number per Turn): an unmodified Armour Roll against an adjacent Standing opponent, an Injury Roll if broken; may replace the Block of a Blitz; the activation ends. |
| Stand Firm | 136 | Strength | ✅ implemented | May choose not to be Pushed Back (including Chain Pushes). |
| Steady Footing | 136 | General | ✅ implemented | When it would be Knocked Down or Fall Over, a 6 on a D6 keeps it on its feet. FAQ 2026: after a failed Dodge, Rush or Jump the player stays Standing and the submitted path may continue (matches started before the FAQ keep the earlier handling). |
| Strip Ball | 136 | General | ✅ implemented | A ball carrier it Pushes Back drops the ball. |
| Strong Arm | 136 | Strength | ✅ implemented | +1 to the Passing Ability Test of a Throw Team-mate Action. |
| Stunty* | 136 | Trait | ✅ implemented | Ignores Marking modifiers when Dodging; -1 to Intercept; uses the Stunty Injury Table. |
| Sure Feet | 136 | Agility | ✅ implemented | Once per Turn re-roll a Rush. |
| Sure Hands | 136 | General | ✅ implemented | May re-roll a failed Pick Up (not Secure the Ball); Strip Ball does not work against it. |
| Swoop | 137 | Trait | ✅ implemented | When thrown (not a Fumbled Throw): may travel with the Throw-in Template from the target square (D6 direction, D6 squares) instead of scattering, and then may re-roll the landing test. **Interpretation: the template is placed on the target square. Previews assume Swoop is not used (you choose during execution).** |
| Tackle | 137 | General | ✅ implemented | Opponents dodging out of its Tackle Zone cannot use Dodge; Stumble ignores Dodge when it blocks. |
| Take Root* | 137 | Trait | ✅ implemented | After declaring an Action while Standing: D6, on a 1 the player is Rooted — no moving (a planned move is not made), no Follow-up, cannot be Pushed Back — until Knocked Down, Placed Prone or the end of the Drive. |
| Taunt | 137 | General | ✅ implemented | When Pushed Back by a Block, may force the blocker to Follow-up. |
| Tentacles | 137 | Mutation | ✅ implemented | Opponent leaving its Tackle Zone: D6 + own ST - their ST >= 6 holds them in place. |
| Thick Skull | 137 | Strength | ✅ implemented | Injury 8 is Stunned instead of KO (Stunty: 7 instead of KO). |
| Throw Team-mate | 137 | Trait | ✅ implemented | May declare Throw Team-mate Actions (p.76-78). |
| Timmm-ber! | 137 | Trait | ✅ implemented | MA 2 or less: +1 per adjacent Open Standing team-mate to the stand-up roll. |
| Titchy* | 138 | Trait | ✅ implemented | +1 to Dodge; does not apply the -1 Marking modifier to opponents dodging into its Tackle Zone. |
| Trickster | 138 | Trait | ✅ implemented | Targeted by a Block or a Special Action (not a Ball & Chain Block): before the dice, may move to any unoccupied square next to the acting player; placed on the ball, may try to pick it up. FAQ 2026: a rooted player cannot move; the Chomped state is cleared (earlier matches: held in place). |
| Two Heads | 138 | Mutation | ✅ implemented | +1 to Dodge. |
| Unchannelled Fury* | 138 | Trait | ✅ implemented | After declaring an Action roll a D6 (+2 for Block/Blitz): on 1-3 the activation ends. |
| Unsteady* | 138 | Trait | ✅ implemented | May not declare Secure the Ball Actions. |
| Very Long Legs | 138 | Mutation | ✅ implemented | +1 to Leap/Jump, +2 to Intercept; ignores Cloud Burster. |
| Violent Innovator | 138 | Devious | ✅ implemented | A Casualty this player causes with a Special Action earns Star Player Points (2 SPP, League matches). **Needs a Trait with a Special Action; in this app the Special Action offered is Projectile Vomit (the others are not implemented yet).** |
| Wrestle | 138 | General | ✅ implemented | On Both Down, may Place both players Prone (no Armour Rolls). |

\* = must always be used when it applies (compulsory in the rulebook).
<!-- skills:end -->

## Interpretations added in V4

- **Foul — Lone Fouler (p.130):** the re-rolled Armour Roll replaces the first one; only the dice that stand (the re-roll) are checked for a natural double.
- **Foul — Dirty Player (p.127):** like Mighty Blow, the +1 can go to the Armour Roll after it is rolled (offered only when it breaks the armour) or be kept for the Injury Roll. Iron Hard Skin blocks it on the Armour Roll only.
- **Foul — Sneaky Git (p.136):** only the double on the Armour Roll is forgiven (and only while the armour is not broken); a double on the Injury Roll still sends the player off.
- **Foul — assists:** Guard (p.129) is worded for Block Actions, so it does not help a Foul; Put the Boot In (p.134) is the Foul equivalent, cancelled by Defensive (p.127) during the opponent's Turn.
- **Sent-off fouler holding the ball:** the ball Bounces from the square they were in.
- **Argue the Call in a practice position:** a roll of 1 ejects the coach for the rest of that position (recorded on the team).
- **Leader (p.130):** "the start of a half" is taken as the kick-off of the half's first Drive (after both set-ups); a Leader in the Reserves Box or KO box then does not give the re-roll for that half.
- **Diving Catch (p.127):** the diving player catches from their own square (they are not moved into the landing square). Only an empty landing square is dived for (a player in the landing square catches as normal). One attempt: the active team's coach chooses first (the receiving team's coach at a kick-off), then the other coach; a failed dive bounces the ball from the landing square. Previews assume the dive is always tried.
- **Multiple Block (p.132):** both strengths (Dauntless first, then −2) are fixed before any dice; the dice are rolled one Block after the other. If the first Block knocks the blocker down, a Player Down / Both Down in the second only affects the target, and the blocker's Active skills (Tackle, Mighty Blow) no longer apply because they need a Standing player (p.123). Pile Driver is not used with it. The computer opponent does not use Multiple Block.
- **Trickster (p.138):** asked after Foul Appearance and before any dice (also against a Frenzy second Block and against targeted Special Actions); placed on the ball, the pick-up is tried at once (no Team Re-roll: it is not that team's Turn) and a failure bounces the ball without a Turnover.
- **Dump-off (p.128):** the Quick Pass may go to any square within Quick Pass range (normal rules: interceptions, catches, bounces); it is never a Turnover. A Frenzy second Block asks again only if the target still holds the ball.
- **Saboteur (p.135):** offered when the player is Knocked Down by an opposition Block (including the Block of a Blitz); on 4+ the blocker is Knocked Down (Armour Roll as usual; no Turnover unless the blocker held the ball) and the saboteur goes to the KO box without an Armour Roll.
- **Pile Driver (p.133):** "during a Block Action" includes the Block of a Blitz; the free Foul follows the Foul rules (assists, Sent-off on a double, Argue the Call) but is not the team's one Foul Action of the Turn; the player is then Placed Prone (a Turnover only if they hold the ball) and the activation ends.
- **On the Ball (p.132):** the coach picks the player, then the destination; the engine walks the route with the fewest Dodges (then the fewest squares); Jumps and Leaps are not offered for this move, and no Team Re-roll can be used (not that team's Turn). After the moves the Passing modifiers (Marked, Disturbing Presence) are worked out again. At the kick-off it is offered when the Deviated kick lands in the receiving half (a kick that Deviates off the pitch or into the kicking half causes a Touchback, so no move); a Touchback that only arises later (a Kick-off Event) does not undo a move already made.
- **MVP (p.96):** “played during the match” = set up for at least one Drive. The coach ticks up to six such players (six are ticked by default: the most SPP first, then by number), numbered 1–6 in shirt-number order; a D6 with no nominee under it is rolled again (so fewer than six nominees are equally likely). The computer's MVP uses the default nomination. The MVP D6 is a neutral roll (the D6 difficulty house rule does not change it).
- **Adding SPP:** each saved League team remembers the matches whose SPP it received (dice seed + team ids), so Undo or reloading a saved full-time match cannot add them twice. League teams stay free-form: SPP can also be typed in the team editor.
- **Advancement dice** are rolled by the interface with the browser's random generator (they are not part of a match's seeded dice) and are saved with the player at once, so closing and reopening the dialog shows the same roll until it is used. A player with enough SPP for a Characteristic Improvement is marked “Advance!” (p.96 says they must advance before the next game); the app does not stop the team from playing.
- **Punt (p.134):** the facing is chosen in the plan (the side panel or the tray); the move comes first and the Punt ends the activation. “In the crowd” is read as the punted ball leaving the pitch in flight (Turnover, then the Throw-in); a later Bounce out of the pitch is thrown in without a Turnover unless an opponent ends up with the ball. The player must hold the ball when punting (a plan without the ball is refused). With Kick, the direction is kept or re-rolled before the distance is rolled; previews assume no Kick re-roll.
- **Fumblerooski (p.128):** only in a Move Action; the ball is left in the square the planned move starts from (plan the move in parts to leave it further on). It is not a Turnover and the ball is not a “bounce” — it simply lies there.
- **Lethal Flight (p.130) / Swoop (p.137):** Lethal Flight works like Mighty Blow on the Armour or Injury Roll of an opponent the thrown player crash-lands on (also after a Bounce), never against a team-mate. Swoop places the Throw-in Template on the target square of the throw (not after a Fumbled Throw); the landing may then be re-rolled once with Swoop.
- **Animal Savagery (p.123):** after lashing out (1-3) the declared Action is not performed and the activation ends; the coach picks the team-mate; Claws and Mighty Blow are applied to that team-mate's Armour Roll automatically.
- **Bloodlust (p.125):** a Thrall is a team-mate with the Thrall keyword. When the roll fails in the same planned action as a Pass or Hand-off and no Thrall is adjacent, that Pass / Hand-off is not made (the dice have been rolled, so the plan is not refused afterwards); the activation continues while a Thrall can still be reached (V5.5, below); a player who is already “hungry” cannot plan one without an adjacent Thrall. The bite is offered at the end of the activation (or before a Pass, a Hand-off or scoring).
- **Take Root (p.137):** rolled only by a Standing player; if they take root on the activation roll, the planned move is not made and the activation continues without moving (a Blitz can still Block an adjacent target).
- **Special Actions (V4):** Chomp stops the Chomped player's own movement (moves, Dodges, Jumps, Follow-ups) while the chomper Marks it; a Block can still Push it Back. In a Blitz, Stab, the Chainsaw, Breathe Fire and Projectile Vomit end the activation; Chomp does not (the Blitz goes on). Throw Bomb: a bomb that leaves the pitch explodes harmlessly in the crowd; a Safe Pass natural 1 keeps the bomb, which fizzles out; a player without Passing Ability who catches it cannot throw it (it explodes); a catcher throws it at once (their coach picks the square); previews stop exploring below 1 in 10,000. Ball & Chain: one template step per confirmed action (the next step is planned with the same facing); a Ball & Chain player whirling into the crowd is a Turnover. Kick Team-mate: the free one of Charge! is offered to one selected player with the Trait.
- **Computer coach and the new reactions:** it uses Trickster to step away from other opponents who could assist the Block, always rolls for Saboteur and always dives with Diving Catch, and does not use Dump-off, Pile Driver, On the Ball or Multiple Block. Previews assume Trickster, Dump-off and On the Ball are not used and Saboteur is always rolled.

## Interpretations and additions in V5.5

- **Bloodlust — a resolved Turnover passes the Turn (p.125).** A hungry player's activation (failed Bloodlust roll, no
  bite yet) stays open while it can still lead somewhere: the declared Action's main part is still to come (the Block of
  a Blitz, the Foul, the Special Action, a Throw Team-mate) or the player can still move next to a Thrall (or, for
  Karina, a Tasty Morsel). As soon as neither is possible the activation ends at once: with a Thrall next to the player
  the coach is asked whether to bite (“No bite (Turnover)”), otherwise the Turnover is resolved and the Turn passes —
  no dummy action of another player is needed. A failed roll itself never ends the activation early, a natural 1 still
  fails despite the +1 for a Block / Blitz, and “Change to a Move Action” continues as a Move. Planning another
  player's Action while the hungry player has no Thrall next to them is refused with the reason and a one-click
  *End activation (Bloodlust Turnover)* (ending it that way would stop that Action anyway). Tests: `tests/traits.test.ts`
  (including the reported match-log case), `scripts/ui-flow-v55-bloodlust.mjs`.
- **The same saved team on both sides.** Allowed in every mode and format: Player 2 plays an independent match copy
  (own team and player ids, name + “*”, colours inverted); resources, player states and Star Player rule uses are per
  side; the saved team is never changed by the copy (League: only Player 1's side receives SPP). Two teams hiring the
  same Star Player is legal anyway (p.148: “one of them is simply just a very talented imposter”).
- **Tiers (May 2026 list) and Mega-stars.** The official list gives the Tier of 30 rosters; the legacy Slann has none —
  an event Tier must be chosen and is labelled as event-specific; any Tier other than the official one is labelled
  likewise. Sevens uses the Tiers Spike! 22 states (Norse 1, Goblin 4, Chaos Chosen 2) and otherwise suggests the May
  2026 Tier, labelled as a suggestion (no Sevens list in the sources). Mega-stars (Griff Oberwald, Hakflem
  Skuttlespike, H'Thark the Unstoppable, Ivan 'the Animal' Deathshroud, Morg 'n' Thorg) cost 4 Skill Points instead
  of 2 and a team may have only one (p.113).
- **League pre-match (p.94).** The higher-CTV team may spend Treasury first; the other gets Petty Cash = the difference
  + what was spent, and may add up to 50,000 gp of its Treasury; Petty Cash not spent is lost. Star Players hired this
  way are temporary (for the match only). The Treasury gold spent is taken off the saved team when the match starts.
- **Sevens.** The Insignificant exception (user's choice), the Sevens Inducements, Desperate Measures and Prayers, and
  the On the Ball GW / NAF settings: `docs/SEVENS_RULES.md`.

## Optional house rule: difficulty (matches against the computer only; V5.5: outcome-based)

V5.5 replaced the V4 D6 tilt described below: every consequential roll — Block dice, Armour, Injury and Casualty Rolls, the
tests of actions and other rolls made for one side (rolls whose result helps neither side stay neutral) — is weighed by whom its result helps (the chooser of a
Block die, skills such as Block / Dodge, possession), so a “high” number is never assumed to be good. The human side's
good results become a little less likely (0-3), the computer side's a little more (0-3); mutually neutral outcomes stay
neutral, every result stays possible, Off = standard dice, and the plan previews use exactly the odds the dice use
(`tests/difficulty.test.ts`). It is chosen in the match set-up (not offered in Tournament matches or when both sides
are human or both computer), recorded in the match and shown on the match card and in the log. The V4 text:



**Not standard Blood Bowl.** In a match against the computer, two independent settings (Off, Slight, Moderate, Strong) change the chance of each face of a numeric D6: the human coach's dice make low results more likely, the computer's dice make high results more likely. P(face f) = (1 + d·t·(f − 3.5)/2.5)/6 with t = 0, 0.15, 0.3, 0.5 and d = −1 (you) or +1 (computer), so every face stays possible (at Strong, 8.3%–25%). Applied to every D6 a coach rolls for their own team's tests and checks (Dodge, Rush, Pick-up, Catch, Pass, Intercept, Foul Appearance, Bone Head…, Pro, Loner, Regeneration, KO recovery, roll-offs, Kick-off Event team rolls) and to Armour and Injury Rolls, which are the opposing coach's rolls. Never applied to Block dice, D3 / D8 / D16 dice, or neutral rolls (Weather, Kick-off Event 2D6, scatter, bounce, throw-in and deviation dice, the Crowd's Stalling roll, random selection). Off = exactly the standard generator. The previews and the computer's own analysis use the same odds; the dice stay seeded and reproducible. The setting is stored with the match and shown on the board; it cannot be used in practice positions or games between two human coaches.

## Blood Bowl Sevens (V4 build 3)

Source: *Spike! Journal: Sevens*, Issue 22 (Games Workshop 2026), printed pages in the table ("S.p."). The sourced checklist, the versions compared (Death Zone 2020, NAF 2019, a club "2025 Edition" — none mixed in) and the interpretations (1–5) are in `docs/SEVENS_RULES.md`. Everything not listed here works exactly as in the standard game (the journal says so on S.p.10). All Sevens differences live in one table in `src/engine/variant.ts` (`RULESETS.sevens`); a state is a Sevens game when `state.variant === 'sevens'`.

| Rule | Pages | Status | Notes |
|---|---|---|---|
| Pitch 20 × 11: End Zones, Wide Zones 2 squares, Centre Field 7, two Lines of Scrimmage, No Man's Land | S.p.7 | ✅ | Team A's area x 0–6, No Man's Land x 7–12, Team B's area x 13–19 (6 + 6 + 6 squares between the End Zones, as the printed pitch). The two Trapdoors are drawn but do nothing (they only matter with the Treacherous Trapdoor Prayer, an Inducement). |
| Six Turns a half; Turn tracker 1–6 | S.p.7 | ✅ | The half ends after both teams' Turn 6; Time-out (below) uses Turns 5–6. |
| Team Draft: 600,000 gp, 7–11 players, ≤ 4 without the Lineman keyword, roster QTY limits | S.p.8 | ✅ | Sevens teams are Exhibition or Tournament teams (their own list on the Teams screen). V5.5: the Insignificant exception for Snotlings (user's choice, labelled) — `docs/SEVENS_RULES.md`. |
| Team Re-rolls 100,000 gp; Assistant Coaches / Cheerleaders 20,000 (max 3 each); Apothecary 80,000; Dedicated Fans 1–5 (20,000 per step) | S.p.9 | ✅ | Re-roll maximum: the rulebook's 8 (Spike! gives none; the budget cannot reach it). |
| Veteran: one Lineman, MA −1, once per game re-roll a failed pick-up, catch or Pass Action, or block dice that would Knock it Down | S.p.13 | ✅ | Not a Team Re-roll (no Loner roll); a die is never re-rolled twice. Interpretation 3 in `docs/SEVENS_RULES.md`. The previews count it as a re-roll source. |
| Set-up: 7 players (or all available), kicking team first, between own End Zone and Line of Scrimmage, max 1 per Wide Zone, min 3 on the Line of Scrimmage in the Centre Field, never in No Man's Land; ≤ 3 players → all on the Line of Scrimmage | S.p.10 | ✅ | Concede Without Penalty is not offered (conceding is not part of the app). |
| Kick-off: Deviation distance = lower of two D6; Touchback only off the pitch or across the kicking team's Line of Scrimmage (landing in No Man's Land is fine) | S.p.10 | ✅ | The kick is aimed into the receiving team's area (interpretation 1). Kick (p.130) replaces the distance with a D3 (interpretation 5 below). |
| Sevens Kick-off Event Table: Get the Ref; Time-out (Turn 5–6 back); **Alert Defence** (D3+1 kicking players one square, even into No Man's Land); High Kick (not when the ball comes down in No Man's Land); Cheering Fans; Brilliant Coaching; Changing Weather; Quick Snap (D3+1); Charge! (D3+1); Dodgy Snack; Pitch Invasion (one player) | S.p.11 | ✅ | Alert Defence uses the same one-square arrangement as Quick Snap. |
| Sevens Injury Table and Stunty Injury Table, no Casualty Roll (10 / 9–10 Badly Hurt, 11 Seriously Hurt, 12 Dead) | S.p.12 | ✅ | Thick Skull, Mighty Blow, Claws etc. apply as usual. The Apothecary patches up a KO as in the rulebook but cannot patch up a Casualty (no Casualty Roll to repeat — interpretation 2); Decay has nothing to apply to. |
| Amateur Referees: Argue the Call 1–4 still Sent-off, 5–6 not Sent-off (Turnover stands), no coach ejection | S.p.13 | ✅ | Fouls and Secret Weapons alike. |
| Throw-ins: distance D6+2 | S.p.13 | ✅ | Execution and exact previews. |
| Team Re-rolls reset | rulebook p.33 | ✅ | Unchanged by Sevens: full at the start of each half, not per Drive; Brilliant Coaching's extra one is lost at the end of its Drive. Tested at Drive and half boundaries (`tests/sevens.test.ts`). |
| Sevens League play (no SPP; a random skill after each game; Journeymen at < 7; re-draft; retention) | S.p.14–17 | ⛔ | Not implemented: Sevens teams play Exhibition and Tournament matches (the League mode is 11-a-side). |
| Sevens Inducements, Prayers to Nuffle and Desperate Measures | S.p.14–15 | ✅ | V5.5: bought from the Sevens budget in the team builder (Sevens' own list; 11-a-side Inducements, Star Players and Mercenaries are not offered, with the reason) and used in matches — `docs/SEVENS_RULES.md`, *Sevens Inducements*. |
| Matched Play Skill Points and Tiers | S.p.18–19 | ✅ | V5 step 6 / V5.5: Tournament Sevens teams spend Skill Points 1 / 2 / 3 / 4 by Tier (one Secondary for the team, two Elite skills); Tiers from Spike! 22 where stated, otherwise the May 2026 Tier as a labelled suggestion. |
| Computer opponent in Sevens | — | ✅ | Same AI; it reads the pitch size, turn count and the Sevens kick deviation. Checked by a whole Sevens match in the unit tests and through the interface, and by Sevens self-play (`node build/ai-selfplay.mjs 12 301 --sevens`). |

**Interpretation 5 — Kick in Sevens.** Kick (p.130) lets the kick "Deviate D3 squares rather than the usual D6"; in Sevens the usual roll is the lower of two D6, so a kicker using Kick rolls a single D3 for the distance.
