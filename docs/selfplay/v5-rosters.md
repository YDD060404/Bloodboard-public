# V5 rosters in actual play — computer v computer self-play

Every Team Roster added in V5 (25 of them) played one whole match, computer against computer, with
normal random dice (`node build/roster-selfplay.mjs 101 --md`, seeds 101–125, run 27 Sep 2026).
Each team is a Tournament / Exhibition draft of that roster (non-Linemen first, at most two of each,
one Big Guy, then Linemen, within 1,000,000 gp). Every input was checked with `validateInput` before
it was executed and the state with `validateState` after every step.

**Result: 25 matches, 0 illegal inputs, 0 engine errors.**

"Seen" means the Skill, Trait or team special rule is named in the match log (it was used or rolled for
at least once). "Not seen" skills simply did not come up in that one match — they are covered by the
unit tests (`tests/rosters-v5.test.ts`, `tests/specialrules.test.ts`, `tests/traits.test.ts`, …).
A ✓ after a team rule means it appeared in the log.

| Roster (you, balanced) | Opponent (offensive) | Seed | Score | Illegal inputs | Skills & Traits seen in the log | Not seen | Team rules |
|---|---|---|---|---|---|---|---|
| Amazon | Elven Union | 101 | 0-1 | 0 | Dodge, Hit and Run, Jump Up | Defensive, On the Ball, Pass, Safe Pass | — |
| Black Orc | Gnome | 102 | 2-0 | 0 | Dodge, Grab, Mighty Blow, Projectile Vomit, Really Stupid, Stunty, Thick Skull | Always Hungry, Brawler, Regeneration, Right Stuff, Throw Team-mate | Brawlin' Brutes, Bribery and Corruption |
| Dwarf | Goblin | 103 | 1-1 | 0 | Block, Dauntless, Frenzy, Tackle, Thick Skull | Defensive, Diving Tackle, Hatred, Sprint, Sure Hands | Brawlin' Brutes, Bribery and Corruption ✓ |
| Chaos Chosen | Halfling | 104 | 0-0 | 0 | Horns, Loner, Mighty Blow, Projectile Vomit, Really Stupid, Thick Skull | Always Hungry, Arm Bar, Regeneration, Throw Team-mate | Favoured of Undivided |
| Chaos Dwarf | High Elf | 105 | 1-0 | 0 | Block, Disturbing Presence, Shadowing, Stab, Sure Feet, Thick Skull | Brawler, Breathe Fire, Iron Hard Skin, Sprint, Unsteady | Favoured of Hashut |
| Chaos Renegade | Imperial Nobility | 106 | 1-0 | 0 | Animosity, Loner, Mighty Blow, Projectile Vomit, Really Stupid | Always Hungry, Pass, Regeneration, Sure Hands, Throw Team-mate | Favoured of Undivided |
| Dark Elf | Khorne | 107 | 1-0 | 0 | Block, Dump-off, Hit and Run | Punt, Shadowing, Stab | — |
| Elven Union | Necromantic Horror | 108 | 1-1 | 0 | Block, Catch, Sidestep | Diving Catch, Fumblerooski, Hail Mary Pass, Nerves of Steel, Pass | — |
| Gnome | Nurgle | 109 | 0-0 | 0 | Dodge, Jump Up, Mighty Blow, Sidestep, Stand Firm, Stunty, Take Root, Thick Skull, Trickster, Wrestle | Guard, My Ball, Right Stuff, Strong Arm, Throw Team-mate, Timmm-ber! | — |
| Goblin | Ogre | 110 | 1-0 | 0 | Ball & Chain, Chainsaw, Disturbing Presence, Dodge, Mighty Blow, Pogo, Projectile Vomit, Really Stupid, Secret Weapon, Stunty, Taunt | Always Hungry, Bombardier, Dirty Player, No Ball, Regeneration, Right Stuff, Swoop, Throw Team-mate | Bribery and Corruption |
| Halfling | Old World Alliance | 111 | 2-0 | 0 | Catch, Dodge, Fend, Mighty Blow, Stand Firm, Stunty, Take Root, Thick Skull | Right Stuff, Sprint, Strong Arm, Throw Team-mate, Timmm-ber! | — |
| High Elf | Shambling Undead | 112 | 0-0 | 0 | Block, Catch | Cloud Burster, Pass, Safe Pass | — |
| Imperial Nobility | Skaven | 113 | 1-1 | 0 | Block, Bone Head, Fend, Loner, Mighty Blow, Pro, Wrestle | Catch, Give and Go, Pass, Stand Firm, Thick Skull, Throw Team-mate | — |
| Khorne | Slann | 114 | 2-0 | 0 | Claws, Frenzy, Horns, Juggernaut, Jump Up, Loner, Mighty Blow, Thick Skull, Unchannelled Fury | — | Brawlin' Brutes, Favoured of Khorne |
| Necromantic Horror | Snotling | 115 | 2-0 | 0 | Block, Claws, Dodge, Eye Gouge, Frenzy, Sidestep, Stand Firm | Foul Appearance, No Ball, Regeneration, Thick Skull, Unsteady | Masters of Undeath |
| Nurgle | Underworld Denizens | 116 | 0-0 | 0 | Foul Appearance, Horns, Loner, Mighty Blow, Pick-me-up, Really Stupid, Steady Footing, Tentacles, Thick Skull | Decay, Disturbing Presence, Plague Ridden, Regeneration, Stand Firm, Unsteady | Brawlin' Brutes, Favoured of Nurgle |
| Ogre | Vampire | 117 | 0-0 | 0 | Bone Head, Dodge, Mighty Blow, Sidestep, Stunty, Titchy | Kick Team-mate, Right Stuff, Thick Skull, Throw Team-mate | Brawlin' Brutes, Low Cost Linemen |
| Old World Alliance | Wood Elf | 118 | 0-0 | 0 | Block, Bone Head, Catch, Dodge, Frenzy, Thick Skull | Dauntless, Diving Tackle, Hatred, Loner, Mighty Blow, Pass, Sprint, Sure Hands, Tackle, Throw Team-mate | — |
| Shambling Undead | Bretonnian | 119 | 1-1 | 0 | Block, Dodge, Mighty Blow, Regeneration, Thick Skull | Tackle | Masters of Undeath |
| Skaven | Tomb Kings | 120 | 1-0 | 0 | Animal Savagery, Block, Dodge, Frenzy, Loner, Mighty Blow | Pass, Prehensile Tail, Stab, Strip Ball, Sure Hands | — |
| Slann | Human | 121 | 0-1 | 0 | Bone Head, Hit and Run, Jump Up, Mighty Blow, Prehensile Tail, Thick Skull | Diving Catch, Diving Tackle, Loner, On the Ball, Pogo, Very Long Legs | — |
| Snotling | Orc | 122 | 0-2 | 0 | Dodge, Really Stupid, Secret Weapon, Sidestep, Stand Firm, Stunty, Titchy | Bombardier, Dirty Player, Insignificant, Juggernaut, Mighty Blow, Pogo, Right Stuff, Sprint | Bribery and Corruption, Low Cost Linemen, Swarming ✓ |
| Underworld Denizens | Lizardmen | 123 | 1-3 | 0 | Block, Dodge, Loner, Mighty Blow, Projectile Vomit, Really Stupid, Strip Ball, Stunty, Sure Hands | Always Hungry, Animosity, Pass, Regeneration, Right Stuff, Stab, Throw Team-mate | Bribery and Corruption |
| Vampire | Norse | 124 | 0-1 | 0 | Bloodlust, Juggernaut, Regeneration | Hypnotic Gaze, Pass | Masters of Undeath |
| Wood Elf | Amazon | 125 | 0-0 | 0 | Block, Catch, Dodge | Leap, Pass, Safe Pair of Hands, Sprint | — |
