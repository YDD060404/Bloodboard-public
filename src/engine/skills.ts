/**
 * Skill & Trait catalogue for the Third Season rulebook (printed pp.123-138).
 *
 * support:
 *  - 'implemented'  : the engine applies this skill wherever it matters for
 *                     the supported actions.
 *  - 'noEffect'     : the skill only matters in parts of the game outside
 *                     this version's scope (post-game league play) and never
 *                     changes a supported action.
 *  - 'partial'      : part of the skill is implemented; the rest is disabled
 *                     (see `note`).
 *  - 'unsupported'  : not implemented. Anything the skill could affect is
 *                     disabled with an explanation instead of being
 *                     approximated.
 */
export type SkillSupport = 'implemented' | 'noEffect' | 'partial' | 'unsupported';
export type SkillCategory = 'Agility' | 'Devious' | 'General' | 'Mutation' | 'Passing' | 'Strength' | 'Trait';

export interface SkillDef {
  id: string;
  name: string;
  category: SkillCategory;
  /** Active skills need the player to be Standing and not Distracted (p.121). */
  active: boolean;
  /** Marked with * : must always be used when applicable. */
  mandatory: boolean;
  page: number;
  support: SkillSupport;
  /** Short rules summary (paraphrased) shown in the interface. */
  summary: string;
  note?: string;
  /** Takes a value, e.g. Loner (4+). */
  valued?: boolean;
  /** Takes a keyword, e.g. Hatred (Undead). */
  keyworded?: boolean;
}

const S = (d: SkillDef) => d;

export const SKILLS: SkillDef[] = [
  S({ id: 'accurate', name: 'Accurate', category: 'Passing', active: true, mandatory: false, page: 123, support: 'implemented', summary: '+1 to the Passing Ability Test for a Quick or Short Pass.' }),
  S({ id: 'alwaysHungry', name: 'Always Hungry', category: 'Trait', active: true, mandatory: true, page: 123, support: 'implemented', summary: 'Throw Team-mate: roll a D6 before the Passing Ability Test; on a 1 roll again: 2+ the team-mate squirms free (Fumbled Throw), 1 the team-mate is eaten (Turnover).' }),
  S({ id: 'animalSavagery', name: 'Animal Savagery', category: 'Trait', active: false, mandatory: true, page: 123, support: 'implemented', summary: 'After declaring an Action: D6 (+2 for a Block or Blitz), 4+ acts as declared. On 1-3 an adjacent Standing team-mate (the coach\'s choice) is Knocked Down — Claws and Mighty Blow must be used on its Armour Roll; no Turnover unless it held the ball — or, with none adjacent, the player is Distracted.', note: 'Interpretation: after lashing out the declared Action is not performed (the activation ends).' }),
  S({ id: 'animosity', name: 'Animosity', category: 'Trait', active: true, mandatory: true, page: 123, support: 'implemented', keyworded: true, summary: 'Pass/Hand-off to a team-mate with the keyword: roll a D6, on a 1 the player refuses and the activation ends.' }),
  S({ id: 'armBar', name: 'Arm Bar', category: 'Strength', active: true, mandatory: false, page: 123, support: 'implemented', summary: 'If an opponent Falls Over dodging/jumping/leaping out of this Tackle Zone, +1 to the Armour or Injury Roll.' }),
  S({ id: 'ballAndChain', name: 'Ball & Chain', category: 'Trait', active: true, mandatory: true, page: 124, support: 'implemented', summary: 'The only Action is the Ball & Chain Special Action: each step the Throw-in Template faces an End Zone or a Sideline and a D6 picks the square (no Dodges, no Shadowing or Tentacles); a Standing player there is Blocked (Foul Appearance ignored; against a team-mate this coach picks the result), a Prone / Stunned one is Pushed Back with an Armour Roll, the ball Bounces (no Turnover); off the pitch: the crowd. Up to MA steps, Rushes as normal (a failed Rush moves first). Knocked Down, Falls Over or Placed Prone: an Injury Roll at once, Stunned counts as Knocked-out.', note: 'Each step is planned and confirmed on its own (choose the facing, Confirm). Interpretation: going into the crowd is a Turnover.' }),
  S({ id: 'bigHand', name: 'Big Hand', category: 'Mutation', active: true, mandatory: false, page: 124, support: 'implemented', summary: 'Ignores all negative modifiers when picking up the ball.' }),
  S({ id: 'block', name: 'Block', category: 'General', active: true, mandatory: false, page: 124, support: 'implemented', summary: 'May choose not to be Knocked Down on a Both Down result.' }),
  S({ id: 'bloodlust', name: 'Bloodlust', category: 'Trait', active: false, mandatory: true, page: 125, support: 'implemented', valued: true, summary: 'After declaring an Action: D6 (+1 for a Block or Blitz); below X+ or a natural 1: the Action may become a Move Action, and the player must bite an adjacent Thrall Lineman (Injury Roll, Casualty → Badly Hurt) before a Pass, a Hand-off or scoring, or at the end of the activation — otherwise Turnover, Distracted, the ball dropped.', note: 'A Thrall is a team-mate with the Thrall keyword (custom League players).' }),
  S({ id: 'bombardier', name: 'Bombardier', category: 'Trait', active: true, mandatory: false, page: 125, support: 'implemented', summary: 'Throw Bomb Special Action (one per Turn, no move first): thrown like a Pass (range, Passing Ability Test, Pass skills except On the Ball, Interceptions). Where it comes to rest — or in the hands of a player who drops it, or of a fumbling thrower — it explodes: the player in the square is hit, each adjacent player on 4+; Standing → Knocked Down, Prone / Stunned → Armour Roll. Caught or intercepted: thrown again at once.', note: 'Interpretations: a bomb that leaves the pitch explodes harmlessly in the crowd; a Safe Pass natural 1 keeps the bomb, which fizzles out; a player without Passing Ability who catches it cannot throw it (it explodes). Previews stop exploring below 1 in 10,000.' }),
  S({ id: 'boneHead', name: 'Bone Head', category: 'Trait', active: false, mandatory: true, page: 126, support: 'implemented', summary: 'After declaring an Action roll a D6: on a 1 the player becomes Distracted.' }),
  S({ id: 'brawler', name: 'Brawler', category: 'Strength', active: true, mandatory: false, page: 126, support: 'implemented', summary: 'When it declares a Block Action, may re-roll a single Both Down result — once per Block Action (FAQ 2026; earlier matches keep their recorded behaviour).' }),
  S({ id: 'breakTackle', name: 'Break Tackle', category: 'Strength', active: true, mandatory: false, page: 126, support: 'implemented', summary: 'Once per Turn, +1 (ST 3 or less), +2 (ST 4) or +3 (ST 5+) to a Dodge Agility Test.' }),
  S({ id: 'breatheFire', name: 'Breathe Fire', category: 'Trait', active: true, mandatory: false, page: 126, support: 'implemented', summary: 'Breathe Fire Special Action: D6 against a Standing opponent this player Marks (−1 if its ST is 5+): 1 this player is Knocked Down, 2-3 nothing, 4+ the target is Placed Prone, a natural 6 Knocks it Down; may replace the Block of a Blitz; the activation ends.' }),
  S({ id: 'bullseye', name: 'Bullseye', category: 'Strength', active: true, mandatory: false, page: 126, support: 'implemented', summary: 'A Superb Throw lands in the target square without scattering.' }),
  S({ id: 'cannoneer', name: 'Cannoneer', category: 'Passing', active: true, mandatory: false, page: 126, support: 'implemented', summary: '+1 to the Passing Ability Test for a Long Pass or Long Bomb.' }),
  S({ id: 'catch', name: 'Catch', category: 'Agility', active: true, mandatory: false, page: 126, support: 'implemented', summary: 'May re-roll a failed Agility Test to Catch the ball.' }),
  S({ id: 'chainsaw', name: 'Chainsaw', category: 'Trait', active: true, mandatory: true, page: 126, support: 'implemented', summary: 'Chainsaw Attack Special Action: D6, 1 Kick-back (this player is Knocked Down), 2+ an Armour Roll +3 against an adjacent Standing opponent; may replace the Block of a Blitz; may be used for a Foul (+3, Kick-back first). +3 to Armour Rolls against this player whenever it goes down.', note: 'Iron Hard Skin cancels the +3 against its owner.' }),
  S({ id: 'claws', name: 'Claws', category: 'Mutation', active: false, mandatory: false, page: 127, support: 'implemented', summary: 'Armour of a player it Knocks Down in a Block breaks on a natural 8+.' }),
  S({ id: 'cloudBurster', name: 'Cloud Burster', category: 'Passing', active: true, mandatory: false, page: 127, support: 'implemented', summary: 'Opponents may not Intercept this player\'s passes.' }),
  S({ id: 'dauntless', name: 'Dauntless', category: 'General', active: true, mandatory: false, page: 127, support: 'implemented', summary: 'Blocking a stronger player: roll D6 + ST; if higher than the target\'s ST, use the target\'s ST.' }),
  S({ id: 'decay', name: 'Decay', category: 'Trait', active: false, mandatory: true, page: 127, support: 'implemented', summary: '+1 to Casualty Rolls against this player.' }),
  S({ id: 'defensive', name: 'Defensive', category: 'Agility', active: true, mandatory: false, page: 127, support: 'implemented', summary: 'In the opponent\'s Turn, opponents Marked by this player cannot use Guard.' }),
  S({ id: 'dirtyPlayer', name: 'Dirty Player', category: 'Devious', active: true, mandatory: false, page: 127, support: 'implemented', summary: 'Foul Action: +1 to the Armour Roll or the Injury Roll (chosen after the roll).' }),
  S({ id: 'disturbingPresence', name: 'Disturbing Presence', category: 'Mutation', active: false, mandatory: true, page: 127, support: 'implemented', summary: '-1 to opponents\' Pass, Catch and Intercept tests for each such player within 3 squares.' }),
  S({ id: 'divingCatch', name: 'Diving Catch', category: 'Agility', active: true, mandatory: false, page: 127, support: 'implemented', summary: 'May try to Catch a pass, throw-in or kick-off landing in an empty square next to them (not a bouncing ball); +1 to Catch a pass in the target square.', note: 'Interpretation: the diving player catches from their own square (they are not moved); one attempt, the active team\'s coach (the receiving team\'s at a kick-off) choosing first; a failed attempt bounces the ball from the landing square.' }),
  S({ id: 'divingTackle', name: 'Diving Tackle', category: 'Agility', active: true, mandatory: false, page: 127, support: 'implemented', summary: 'After an opponent\'s Dodge/Jump/Leap test, apply -2 and be Placed Prone in the vacated square.' }),
  S({ id: 'dodge', name: 'Dodge', category: 'Agility', active: true, mandatory: false, page: 127, support: 'implemented', summary: 'Once per Turn re-roll a Dodge test; Stumble becomes Push Back.' }),
  S({ id: 'drunkard', name: 'Drunkard', category: 'Trait', active: false, mandatory: true, page: 127, support: 'implemented', summary: '-1 to Rush rolls.' }),
  S({ id: 'dumpOff', name: 'Dump-off', category: 'Passing', active: true, mandatory: false, page: 128, support: 'implemented', summary: 'Targeted by a Block or a Special Action while holding the ball: may first make a Quick Pass (normal rules, never a Turnover).' }),
  S({ id: 'extraArms', name: 'Extra Arms', category: 'Mutation', active: true, mandatory: false, page: 128, support: 'implemented', summary: '+1 to Catch, Pick Up and Intercept.' }),
  S({ id: 'eyeGouge', name: 'Eye Gouge', category: 'Devious', active: true, mandatory: false, page: 128, support: 'implemented', summary: 'Opponents it Pushes Back cannot assist until next activated.' }),
  S({ id: 'fend', name: 'Fend', category: 'General', active: true, mandatory: false, page: 128, support: 'implemented', summary: 'When Pushed Back by a Block, the blocker may not Follow-up.' }),
  S({ id: 'foulAppearance', name: 'Foul Appearance', category: 'Mutation', active: false, mandatory: true, page: 128, support: 'implemented', summary: 'A player blocking it rolls a D6 first: on a 1 the Block is cancelled and its activation ends.' }),
  S({ id: 'frenzy', name: 'Frenzy', category: 'General', active: true, mandatory: true, page: 128, support: 'implemented', summary: 'Must Follow-up; if the target is still Standing, must Block it again.' }),
  S({ id: 'fumblerooski', name: 'Fumblerooski', category: 'Devious', active: true, mandatory: false, page: 128, support: 'implemented', summary: 'During a Move Action with the ball: may leave the ball in a square the player moves out of (no Turnover).', note: 'In the plan: tick Fumblerooski to leave the ball in the square the move starts from (plan the move in parts to drop it further on). The computer opponent does not use it.' }),
  S({ id: 'giveAndGo', name: 'Give and Go', category: 'Passing', active: true, mandatory: false, page: 128, support: 'implemented', summary: 'After a Quick Pass or Hand-off without a Turnover, may keep moving.' }),
  S({ id: 'grab', name: 'Grab', category: 'Strength', active: true, mandatory: false, page: 128, support: 'implemented', summary: 'Block Action: push the target into any unoccupied adjacent square; target cannot Sidestep (FAQ 2026 clarifications apply to new matches).' }),
  S({ id: 'guard', name: 'Guard', category: 'Strength', active: true, mandatory: false, page: 129, support: 'implemented', summary: 'Assists Blocks however many opponents are Marking it.' }),
  S({ id: 'hailMaryPass', name: 'Hail Mary Pass', category: 'Passing', active: true, mandatory: false, page: 129, support: 'implemented', summary: 'May pass to any square as a Long Bomb; never Accurate; cannot be Intercepted.' }),
  S({ id: 'hatred', name: 'Hatred', category: 'Trait', active: true, mandatory: true, page: 129, support: 'implemented', keyworded: true, summary: 'Blocking a player with the keyword: may re-roll a single Player Down result.' }),
  S({ id: 'hitAndRun', name: 'Hit and Run', category: 'Agility', active: true, mandatory: false, page: 129, support: 'implemented', summary: 'After a Block, may move one free square ending unmarked. FAQ 2026: also after a Blitz Stab (the activation then ends).' }),
  S({ id: 'horns', name: 'Horns', category: 'Mutation', active: true, mandatory: false, page: 129, support: 'implemented', summary: '+1 ST for Blocks during a Blitz.' }),
  S({ id: 'hypnoticGaze', name: 'Hypnotic Gaze', category: 'Trait', active: true, mandatory: false, page: 129, support: 'implemented', summary: 'Hypnotic Gaze Special Action (move first): D6 3+ against an adjacent Standing opponent — it is Distracted; the activation ends either way.' }),
  S({ id: 'insignificant', name: 'Insignificant', category: 'Trait', active: false, mandatory: true, page: 129, support: 'implemented', summary: 'Team Draft List: no more players with this Trait than players without it (checked when building a team).' }),
  S({ id: 'ironHardSkin', name: 'Iron Hard Skin', category: 'Mutation', active: false, mandatory: false, page: 129, support: 'implemented', summary: 'Opponents cannot modify Armour Rolls against it; Claws does not work against it.' }),
  S({ id: 'juggernaut', name: 'Juggernaut', category: 'Strength', active: true, mandatory: false, page: 129, support: 'implemented', summary: 'Blitz: Both Down may be treated as Push Back; target cannot use Fend, Stand Firm or Wrestle.' }),
  S({ id: 'jumpUp', name: 'Jump Up', category: 'Agility', active: true, mandatory: false, page: 130, support: 'implemented', summary: 'Stands up for free; may Block from Prone after an Agility Test (+1).' }),
  S({ id: 'kick', name: 'Kick', category: 'General', active: true, mandatory: false, page: 130, support: 'implemented', summary: 'Kicking player may make the kick Deviate D3 instead of D6 squares (match play).', note: 'Match play only: chosen when the kick is placed, before the Deviation roll.' }),
  S({ id: 'kickTeamMate', name: 'Kick Team-mate', category: 'Trait', active: false, mandatory: false, page: 130, support: 'implemented', summary: 'Kick Team-mate Special Action (one per Turn, move first allowed): like Throw Team-mate but not the team\'s Throw Team-mate Action; a Fumbled kick is an Injury Roll for the kicked player (Stunned counts as Knocked-out; the ball Bounces).' }),
  S({ id: 'leader', name: 'Leader', category: 'Passing', active: false, mandatory: false, page: 130, support: 'implemented', summary: 'A Leader on the pitch at the start of a half gives one Leader Re-roll for that half, usable while a Leader is on the pitch; lost if every Leader becomes a Casualty or is Sent-off before it is used.' }),
  S({ id: 'leap', name: 'Leap', category: 'Agility', active: true, mandatory: false, page: 130, support: 'implemented', summary: 'May Leap over any adjacent square like a Jump; negative modifiers reduced by 1 (minimum -1).' }),
  S({ id: 'lethalFlight', name: 'Lethal Flight', category: 'Devious', active: true, mandatory: false, page: 130, support: 'implemented', summary: 'Thrown by a team-mate and crash-landing on an opponent (also after a Bounce) who is Knocked Down: +1 to their Armour or Injury Roll (chosen after the roll); a Casualty is credited to this player (SPP in League matches).', note: 'Needs the Right Stuff Trait.' }),
  S({ id: 'loneFouler', name: 'Lone Fouler', category: 'Devious', active: true, mandatory: false, page: 130, support: 'implemented', summary: 'Foul Action with no Offensive or Defensive Assists: may re-roll a failed Armour Roll.' }),
  S({ id: 'loner', name: 'Loner', category: 'Trait', active: false, mandatory: true, page: 131, support: 'implemented', valued: true, summary: 'Using a Team Re-roll requires a D6 roll of X+ or the re-roll is lost.' }),
  S({ id: 'mightyBlow', name: 'Mighty Blow', category: 'Strength', active: true, mandatory: false, page: 131, support: 'implemented', summary: '+1 to the Armour or Injury Roll of a player it Knocks Down in a Block.' }),
  S({ id: 'monstrousMouth', name: 'Monstrous Mouth', category: 'Mutation', active: true, mandatory: false, page: 131, support: 'implemented', summary: 'Chomp Special Action: D6 3+ against a Standing opponent this player Marks — it cannot leave its square while this player Marks it; may replace the Block of a Blitz (the Blitz goes on). Strip Ball cannot be used against this player.', note: 'Interpretation: Chomped stops the player\'s own movement (moves, Dodges, Jumps, Follow-ups); a Block can still Push it Back.' }),
  S({ id: 'multipleBlock', name: 'Multiple Block', category: 'Strength', active: true, mandatory: false, page: 132, support: 'implemented', summary: 'When declaring a Block Action: Block two different opponents it Marks at the same time, at ST −2 for both, no Follow-up; both are resolved in full even if one causes a Turnover. Not with Frenzy.', note: 'Interpretation: both strengths (Dauntless first, then −2) are fixed before any dice; the dice are rolled one Block after the other; if the first Block knocks the blocker down, a Player Down / Both Down in the second only affects the target and the blocker\'s Active skills (e.g. Tackle) no longer apply (p.123); Pile Driver is not used. The computer opponent does not use Multiple Block.' }),
  S({ id: 'myBall', name: 'My Ball', category: 'Trait', active: false, mandatory: true, page: 132, support: 'implemented', summary: 'May not Pass or Hand-off the ball.' }),
  S({ id: 'nervesOfSteel', name: 'Nerves of Steel', category: 'Passing', active: true, mandatory: false, page: 132, support: 'implemented', summary: 'Ignores Marking modifiers when Catching or Passing.' }),
  S({ id: 'noBall', name: 'No Ball', category: 'Trait', active: false, mandatory: true, page: 132, support: 'implemented', summary: 'Automatically fails to Catch or Pick Up; cannot Intercept.' }),
  S({ id: 'onTheBall', name: 'On the Ball', category: 'Passing', active: true, mandatory: false, page: 132, support: 'implemented', summary: 'When an opponent passes (after the target is declared, before the Passing Ability Test): move up to 3 squares, no Rush, one player at a time; a fall ends the moves. At the kick-off (after the Deviation): one Open receiving player moves up to 3 squares in their own half (not on a Touchback).', note: 'The coach picks a player and a destination; the route with the fewest Dodges is walked (Jumps and Leaps not offered). The computer opponent does not use On the Ball; previews assume it is not used.' }),
  S({ id: 'pass', name: 'Pass', category: 'Passing', active: true, mandatory: false, page: 132, support: 'implemented', summary: 'May re-roll a failed Passing Ability Test.' }),
  S({ id: 'pickMeUp', name: 'Pick-me-up', category: 'Trait', active: true, mandatory: false, page: 132, support: 'implemented', summary: 'At the end of the opponent\'s Turn, Prone team-mates within 3 squares stand up on a 5+.' }),
  S({ id: 'pileDriver', name: 'Pile Driver', category: 'Devious', active: true, mandatory: false, page: 133, support: 'implemented', summary: 'After Knocking Down an opponent in a Block Action and still Marking them: a free Foul on them, then this player is Placed Prone and the activation ends.', note: 'The free Foul is not the team\'s Foul Action of the Turn (interpretation).' }),
  S({ id: 'plagueRidden', name: 'Plague Ridden', category: 'Trait', active: false, mandatory: false, page: 133, support: 'implemented', summary: 'Once per game: a Dead result (not saved by an Apothecary) from this player\'s Block adds a new Lineman of the Team Roster to the Reserves Box (not against Big Guys or players with Decay, Regeneration or Stunty).', note: 'Matches only (the new player needs a Team Roster); hiring the player after the game is not part of this app.' }),
  S({ id: 'pogo', name: 'Pogo', category: 'Trait', active: true, mandatory: false, page: 133, support: 'implemented', summary: 'May Pogo over any adjacent square like a Jump, ignoring negative modifiers.' }),
  S({ id: 'prehensileTail', name: 'Prehensile Tail', category: 'Mutation', active: true, mandatory: false, page: 133, support: 'implemented', summary: '-1 to opponents Dodging, Jumping or Leaping out of its Tackle Zone.' }),
  S({ id: 'pro', name: 'Pro', category: 'General', active: true, mandatory: false, page: 133, support: 'implemented', summary: 'Once per activation, on a 3+ re-roll one dice (not Armour/Injury/Casualty).' }),
  S({ id: 'projectileVomit', name: 'Projectile Vomit', category: 'Trait', active: true, mandatory: false, page: 133, support: 'implemented', summary: 'Special Action (or instead of a Blitz\'s Block): D6 2+ → unmodified Armour Roll for an adjacent Standing opponent; on a 1 → unmodified Armour Roll for this player.' }),
  S({ id: 'punt', name: 'Punt', category: 'Passing', active: true, mandatory: false, page: 134, support: 'implemented', summary: 'Punt Special Action (one per Turn): move first, then with the ball face the Throw-in Template to an End Zone or a Sideline; D6 direction, D6 distance; catch or Bounce where it lands. No Turnover if it ends on the ground; a Turnover if an opponent has it or it went into the crowd. Kick: may re-roll the direction and/or the distance.', note: 'Interpretation: \'in the crowd\' is the punted ball leaving the pitch in flight; a later Bounce out of the pitch is thrown in without a Turnover (unless an opponent ends with the ball). The computer opponent does not punt.' }),
  S({ id: 'putTheBootIn', name: 'Put the Boot In', category: 'Devious', active: true, mandatory: false, page: 134, support: 'implemented', summary: 'Gives Offensive Assists to a team-mate\'s Foul however many opponents Mark this player (not while Marked by a Defensive player in the opponent\'s Turn).' }),
  S({ id: 'quickFoul', name: 'Quick Foul', category: 'Devious', active: true, mandatory: false, page: 134, support: 'implemented', summary: 'The activation does not end after a Foul: the player may keep moving with any movement left.' }),
  S({ id: 'reallyStupid', name: 'Really Stupid', category: 'Trait', active: false, mandatory: true, page: 135, support: 'implemented', summary: 'After declaring an Action roll a D6 (+2 with a helpful adjacent team-mate): on 1-3 becomes Distracted.' }),
  S({ id: 'regeneration', name: 'Regeneration', category: 'Trait', active: false, mandatory: false, page: 135, support: 'implemented', summary: 'On a Casualty, a 4+ sends the player to the Reserves instead.' }),
  S({ id: 'rightStuff', name: 'Right Stuff', category: 'Trait', active: false, mandatory: true, page: 135, support: 'implemented', summary: 'Can be thrown by a team-mate with Throw Team-mate, even if Prone.' }),
  S({ id: 'saboteur', name: 'Saboteur', category: 'Devious', active: true, mandatory: false, page: 135, support: 'implemented', summary: 'Knocked Down by an opposition Block: D6 4+ before the Armour Roll — the blocker is also Knocked Down (no Turnover unless holding the ball) and this player is Knocked-out.' }),
  S({ id: 'safePairOfHands', name: 'Safe Pair of Hands', category: 'Agility', active: true, mandatory: false, page: 135, support: 'implemented', summary: 'When going down with the ball, may place it in an adjacent unoccupied square instead of Bouncing.' }),
  S({ id: 'safePass', name: 'Safe Pass', category: 'Passing', active: true, mandatory: false, page: 135, support: 'implemented', summary: 'A natural 1 on the Passing Ability Test is not a Fumble: keep the ball, activation ends, no Turnover.' }),
  S({ id: 'secretWeapon', name: 'Secret Weapon', category: 'Trait', active: false, mandatory: true, page: 135, support: 'implemented', summary: 'Sent-off at the end of each Drive the player took part in (match play; Argue the Call / Bribes offered).', note: 'Match play only. Practice positions have no Drives, so it has no effect there.' }),
  S({ id: 'shadowing', name: 'Shadowing', category: 'Devious', active: true, mandatory: false, page: 135, support: 'implemented', summary: 'When an opponent Dodges out of its Tackle Zone, on a 4+ move into the vacated square (MA times per Turn).' }),
  S({ id: 'sidestep', name: 'Sidestep', category: 'Agility', active: true, mandatory: false, page: 135, support: 'implemented', summary: 'When Pushed Back, its coach chooses any adjacent unoccupied square.' }),
  S({ id: 'sneakyGit', name: 'Sneaky Git', category: 'Devious', active: true, mandatory: false, page: 136, support: 'implemented', summary: 'Not Sent-off for a natural double on the Foul\'s Armour Roll unless the armour is broken.' }),
  S({ id: 'sprint', name: 'Sprint', category: 'Agility', active: true, mandatory: false, page: 136, support: 'implemented', summary: 'May Rush one extra time during a Move Action.' }),
  S({ id: 'stab', name: 'Stab', category: 'Trait', active: true, mandatory: false, page: 136, support: 'implemented', summary: 'Stab Special Action (any number per Turn): an unmodified Armour Roll against an adjacent Standing opponent, an Injury Roll if broken; may replace the Block of a Blitz; the activation ends.' }),
  S({ id: 'standFirm', name: 'Stand Firm', category: 'Strength', active: true, mandatory: false, page: 136, support: 'implemented', summary: 'May choose not to be Pushed Back (including Chain Pushes).' }),
  S({ id: 'steadyFooting', name: 'Steady Footing', category: 'General', active: true, mandatory: false, page: 136, support: 'implemented', summary: 'When it would be Knocked Down or Fall Over, a 6 on a D6 keeps it on its feet. FAQ 2026: after a failed Dodge, Rush or Jump the player stays Standing and the submitted path may continue (matches started before the FAQ keep the earlier handling).' }),
  S({ id: 'stripBall', name: 'Strip Ball', category: 'General', active: true, mandatory: false, page: 136, support: 'implemented', summary: 'A ball carrier it Pushes Back drops the ball.' }),
  S({ id: 'strongArm', name: 'Strong Arm', category: 'Strength', active: true, mandatory: false, page: 136, support: 'implemented', summary: '+1 to the Passing Ability Test of a Throw Team-mate Action.' }),
  S({ id: 'stunty', name: 'Stunty', category: 'Trait', active: false, mandatory: true, page: 136, support: 'implemented', summary: 'Ignores Marking modifiers when Dodging; -1 to Intercept; uses the Stunty Injury Table.' }),
  S({ id: 'sureFeet', name: 'Sure Feet', category: 'Agility', active: true, mandatory: false, page: 136, support: 'implemented', summary: 'Once per Turn re-roll a Rush.' }),
  S({ id: 'sureHands', name: 'Sure Hands', category: 'General', active: true, mandatory: false, page: 136, support: 'implemented', summary: 'May re-roll a failed Pick Up (not Secure the Ball); Strip Ball does not work against it.' }),
  S({ id: 'swoop', name: 'Swoop', category: 'Trait', active: true, mandatory: false, page: 137, support: 'implemented', summary: 'When thrown (not a Fumbled Throw): may travel with the Throw-in Template from the target square (D6 direction, D6 squares) instead of scattering, and then may re-roll the landing test.', note: 'Interpretation: the template is placed on the target square. Previews assume Swoop is not used (you choose during execution).' }),
  S({ id: 'tackle', name: 'Tackle', category: 'General', active: true, mandatory: false, page: 137, support: 'implemented', summary: 'Opponents dodging out of its Tackle Zone cannot use Dodge; Stumble ignores Dodge when it blocks.' }),
  S({ id: 'takeRoot', name: 'Take Root', category: 'Trait', active: false, mandatory: true, page: 137, support: 'implemented', summary: 'After declaring an Action while Standing: D6, on a 1 the player is Rooted — no moving (a planned move is not made), no Follow-up, cannot be Pushed Back — until Knocked Down, Placed Prone or the end of the Drive.' }),
  S({ id: 'taunt', name: 'Taunt', category: 'General', active: true, mandatory: false, page: 137, support: 'implemented', summary: 'When Pushed Back by a Block, may force the blocker to Follow-up.' }),
  S({ id: 'tentacles', name: 'Tentacles', category: 'Mutation', active: true, mandatory: false, page: 137, support: 'implemented', summary: 'Opponent leaving its Tackle Zone: D6 + own ST - their ST >= 6 holds them in place.' }),
  S({ id: 'thickSkull', name: 'Thick Skull', category: 'Strength', active: false, mandatory: false, page: 137, support: 'implemented', summary: 'Injury 8 is Stunned instead of KO (Stunty: 7 instead of KO).' }),
  S({ id: 'throwTeamMate', name: 'Throw Team-mate', category: 'Trait', active: true, mandatory: false, page: 137, support: 'implemented', summary: 'May declare Throw Team-mate Actions (p.76-78).' }),
  S({ id: 'timmmber', name: 'Timmm-ber!', category: 'Trait', active: false, mandatory: false, page: 137, support: 'implemented', summary: 'MA 2 or less: +1 per adjacent Open Standing team-mate to the stand-up roll.' }),
  S({ id: 'titchy', name: 'Titchy', category: 'Trait', active: false, mandatory: true, page: 138, support: 'implemented', summary: '+1 to Dodge; does not apply the -1 Marking modifier to opponents dodging into its Tackle Zone.' }),
  S({ id: 'trickster', name: 'Trickster', category: 'Trait', active: true, mandatory: false, page: 138, support: 'implemented', summary: 'Targeted by a Block or a Special Action (not a Ball & Chain Block): before the dice, may move to any unoccupied square next to the acting player; placed on the ball, may try to pick it up. FAQ 2026: a rooted player cannot move; the Chomped state is cleared (earlier matches: held in place).' }),
  S({ id: 'twoHeads', name: 'Two Heads', category: 'Mutation', active: true, mandatory: false, page: 138, support: 'implemented', summary: '+1 to Dodge.' }),
  S({ id: 'unchannelledFury', name: 'Unchannelled Fury', category: 'Trait', active: false, mandatory: true, page: 138, support: 'implemented', summary: 'After declaring an Action roll a D6 (+2 for Block/Blitz): on 1-3 the activation ends.' }),
  S({ id: 'unsteady', name: 'Unsteady', category: 'Trait', active: false, mandatory: true, page: 138, support: 'implemented', summary: 'May not declare Secure the Ball Actions.' }),
  S({ id: 'veryLongLegs', name: 'Very Long Legs', category: 'Mutation', active: true, mandatory: false, page: 138, support: 'implemented', summary: '+1 to Leap/Jump, +2 to Intercept; ignores Cloud Burster.' }),
  S({ id: 'violentInnovator', name: 'Violent Innovator', category: 'Devious', active: true, mandatory: false, page: 138, support: 'implemented', summary: 'A Casualty this player causes with a Special Action earns Star Player Points (2 SPP, League matches).', note: 'Needs a Trait with a Special Action; in this app the Special Action offered is Projectile Vomit (the others are not implemented yet).' }),
  S({ id: 'wrestle', name: 'Wrestle', category: 'General', active: true, mandatory: false, page: 138, support: 'implemented', summary: 'On Both Down, may Place both players Prone (no Armour Rolls).' }),
];

export const SKILL_BY_ID: Record<string, SkillDef> = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export function skillName(ref: { id: string; value?: number; keyword?: string }): string {
  const def = SKILL_BY_ID[ref.id];
  const base = def ? def.name : ref.id;
  if (ref.value !== undefined) return `${base} (${ref.value}+)`;
  if (ref.keyword) return `${base} (${ref.keyword})`;
  return base;
}

/**
 * Rules code for a skill is only switched on once the skill is marked as
 * supported (implemented / partial / noEffect) in this catalogue and covered by
 * tests. While a skill is still 'unsupported', `gated(id)` is true and the
 * cautious V3 behaviour stays in place (the affected actions are disabled with
 * an explanation instead of being approximated).
 */
export function gated(id: string): boolean {
  return SKILL_BY_ID[id]?.support === 'unsupported' || PENDING_VERIFICATION.has(id);
}

/** Partially supported skills whose remaining V4 rules code is written but not yet verified (kept off). */
const PENDING_VERIFICATION = new Set<string>([]);

/** Skills that prevent a player from being activated while they are still gated. */
export const BLOCKS_ACTIVATION = ['animalSavagery', 'bloodlust', 'takeRoot', 'ballAndChain'];
/** Skills on a Block target that disable Blocks/Blitzes against it while they are still gated. */
export const BLOCKS_BEING_BLOCKED = ['ballAndChain', 'saboteur', 'trickster'];
