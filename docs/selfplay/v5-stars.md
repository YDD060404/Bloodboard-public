# V5 Star Players in actual play — computer v computer self-play

Twelve whole matches, computer against computer with normal random dice (`node build/star-selfplay.mjs 301 --md`,
seeds 301–312, V5 step 6, 27 Sep 2026), between Tournament / Exhibition teams that each hired two Star Players — 48
hires of 42 different Star Players, from Griff Oberwald to Gretchen Wächter — with a 1,200,000 gp budget.
Every input was checked with `validateInput` before it was executed and the state with `validateState` after every step.

**Result: 12 matches, 0 illegal inputs, 0 engine errors.**

"Rules used" counts the log lines of a Star Player's special rule. V5 step 6: the computer now also *starts* the rules
used at the start of an activation when its exact evaluation says they pay — marked "(the computer started it)": here
Thorsson's Beer Barrel Bash, Zzharg's blast (twice), Maple's Vicious Vines (twice), Zolcath's Distraction, Kiroth's
Black Ink, Jeremiah Kool's Flashing Blade and Gretchen's Incorporeal. Matches 9-12 were added in step 6 for these
rules. A rule "not used" simply did not come up (or did not pay) in that match; each rule is also covered by
`tests/stars.test.ts`, `tests/stars2.test.ts` and `tests/stars-ai.test.ts`.

| Home (balanced) | Away (offensive) | Seed | Score | Illegal inputs | Star Player rules used (log) | Not used in this match |
|---|---|---|---|---|---|---|
| Human + Griff Oberwald & The Mighty Zug | Orc + Varag Ghoul-Chewer & Ripper Bolgrot | 301 | 1-0 | 0 | Griff Oberwald: Consummate Professional ×1; Varag Ghoul-Chewer: Krump and Smash ×1 | The Mighty Zug, Ripper Bolgrot |
| Elven Union + Lucien Swift & Roxanna Darknail | Lizardmen + Dribl & Anqi Panqi | 302 | 0-3 | 0 | Roxanna Darknail: Slashing Nails ×2 | Lucien Swift, Dribl, Anqi Panqi |
| Dwarf + Grombrindal & Josef Bugman | Goblin + The Black Gobbo & Scrappa Sorehead | 303 | 1-0 | 0 | — | Grombrindal, Josef Bugman, The Black Gobbo, Scrappa Sorehead |
| Nurgle + Bilerot Vomitflesh & Guffle Pusmaw | Khorne + Scyla Anfingrimm & Max Spleenripper | 304 | 1-0 | 0 | Bilerot Vomitflesh: Putrid Regurgitation ×2 | Guffle Pusmaw, Scyla Anfingrimm, Max Spleenripper |
| Vampire + Count Luthor von Drakenborg & Wilhelm Chaney | Wood Elf + Jordell Freshbreeze & Willow Rosebark | 305 | 0-1 | 0 | Wilhelm Chaney: Savage Mauling ×1; Willow Rosebark: Woodland Fury ×1 | Count Luthor von Drakenborg, Jordell Freshbreeze |
| Halfling + Deeproot Strongbranch & Rodney Roachbait | Underworld Denizens + Skitter Stab-Stab & Glart Smashrip | 306 | 0-0 | 0 | Glart Smashrip: Frenzied Rush ×2 | Deeproot Strongbranch, Rodney Roachbait, Skitter Stab-Stab |
| Chaos Dwarf + H'Thark the Unstoppable & Zzharg Madeye | Norse + Lord Borak the Despoiler & Grashnak Blackhoof | 307 | 0-1 | 0 | Zzharg Madeye: Blastin' Solves Everything ×1 (the computer started it ×1); Grashnak Blackhoof: Gored by the Bull ×1 | H'Thark the Unstoppable, Lord Borak the Despoiler |
| Imperial Nobility + Helmut Wulf & Karla von Kill | Skaven + Hakflem Skuttlespike & Kreek Rustgouger | 308 | 0-0 | 0 | Helmut Wulf: Old Pro ×1; Karla von Kill: Indomitable ×1; Kreek Rustgouger: I'll Be Back ×1 | Hakflem Skuttlespike |
| Dwarf + Thorsson Stoutmead & The Mighty Zug | Chaos Dwarf + Zzharg Madeye & H'Thark the Unstoppable | 309 | 0-0 | 0 | Thorsson Stoutmead: Beer Barrel Bash ×1 (the computer started it ×1); Zzharg Madeye: Blastin' Solves Everything ×1 (the computer started it ×1) | The Mighty Zug, H'Thark the Unstoppable |
| Wood Elf + Swiftvine Glimmershard & Maple Highgrove | Lizardmen + Boa Kon'ssstriktr & Zolcath the Zoat | 310 | 1-1 | 0 | Maple Highgrove: Vicious Vines ×2 (the computer started it ×2); Zolcath the Zoat: Excuse me, are you a Zoat? ×1 (the computer started it ×1) | Swiftvine Glimmershard, Boa Kon'ssstriktr |
| High Elf + Kiroth Krakeneye & Jeremiah Kool | Goblin + Nobbla Blackwart & Scrappa Sorehead | 311 | 1-0 | 0 | Kiroth Krakeneye: Black Ink ×1 (the computer started it ×1); Jeremiah Kool: The Flashing Blade ×1 (the computer started it ×1) | Nobbla Blackwart, Scrappa Sorehead |
| Shambling Undead + Gretchen Wächter & Ivan 'the Animal' Deathshroud | Wood Elf + Rodney Roachbait & Willow Rosebark | 312 | 0-1 | 0 | Gretchen Wächter: Incorporeal ×1 (the computer started it ×1) | Ivan 'the Animal' Deathshroud, Rodney Roachbait, Willow Rosebark |
