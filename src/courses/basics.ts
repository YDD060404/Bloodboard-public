/**
 * Basic Tutorials: short playable lessons on the core rules, written for this
 * app from the Blood Bowl rulebook (page numbers are printed pages). Each one
 * is a normal position played with Plan → Review → Confirm; the objective is
 * checked after every confirmed action (engine: checkGoal).
 */
import type { ScenarioSpec, TutorialGoal } from '../engine/index';

export interface Tutorial {
  id: string;
  title: string;
  summary: string;
  rules: Array<{ page: number; title: string }>;
  /** Short explanation shown before playing (our words). */
  intro: string[];
  objective: string;
  goal: TutorialGoal;
  scenario: ScenarioSpec | null;
  seed: number;
  hints: string[];
  solution: string[];
}

const HO = { A: { name: 'Humans', roster: 'human' }, B: { name: 'Orcs', roster: 'orc' } };

export const TUTORIALS: Tutorial[] = [
  {
    id: 'T1',
    title: 'Moving and Rushing',
    summary: 'Move Allowance, the two Rush squares, and what a Rush costs.',
    rules: [
      { page: 54, title: 'Move Actions' },
      { page: 58, title: 'Rushing' },
      { page: 80, title: 'Touchdown!' },
    ],
    intro: [
      'A player may move up to their Movement Allowance (MA) in squares, one square at a time in any direction.',
      'They may then Rush up to two extra squares. Each Rush needs a D6 roll of 2+; a 1 means the player Falls Over and the Turn ends (a Turnover).',
      'Select your Catcher: green squares are within MA, yellow squares need Rushes. Click a square to plan the move there.',
    ],
    objective: 'Score a Touchdown with the Catcher (#1) carrying the ball into the Orc End Zone (column Z).',
    goal: { kind: 'touchdown' },
    scenario: {
      teams: HO,
      players: [
        { id: 'C', team: 'A', roster: 'human', position: 'catcher', at: [15, 7], number: 1 },
        { id: 'O1', team: 'B', roster: 'orc', position: 'lineman', at: [3, 2], number: 4 },
      ],
      ball: { holder: 'C' },
      rerolls: { A: 1, B: 1 },
    },
    seed: 11,
    hints: ['Column Z is 10 squares away; the Catcher has MA 8.', 'Click the End Zone square in the yellow area: the plan shows two Rush rolls of 2+.', 'Review shows how the two 5-in-6 chances combine, and how a Team Re-roll helps.'],
    solution: ['Move the Catcher straight along row 8 to Z8: 8 normal squares and 2 Rushes (2+ each).', 'Chance without re-rolls: (5/6)² ≈ 69.4%; with a Team Re-roll for a failed Rush it is higher (shown in Review).'],
  },
  {
    id: 'T2',
    title: 'Tackle Zones and Dodging',
    summary: 'Leaving a Marked square needs a Dodge; the square you Dodge into matters.',
    rules: [
      { page: 38, title: 'Tackle Zones, Marking, Open players' },
      { page: 55, title: 'Dodging' },
    ],
    intro: [
      'A Standing opposition player Marks every square next to them (their Tackle Zone).',
      'A player who leaves a square where they are Marked must Dodge: an Agility Test, with −1 for each opposition player Marking the square they move into.',
      'The auto-route picks the lowest-risk path: here it Dodges into a square nobody Marks, then runs round the Orcs.',
    ],
    objective: 'Get the Human Lineman (#3) past the two Orcs to column S or beyond, Standing.',
    goal: { kind: 'reach', player: 'L', area: [18, 0, 25, 14] },
    scenario: {
      teams: HO,
      players: [
        { id: 'L', team: 'A', roster: 'human', position: 'lineman', at: [14, 7], number: 3 },
        { id: 'O1', team: 'B', roster: 'orc', position: 'lineman', at: [15, 7], number: 4 },
        { id: 'O2', team: 'B', roster: 'orc', position: 'lineman', at: [15, 6], number: 5 },
      ],
      ball: { at: [2, 12] },
      rerolls: { A: 1, B: 0 },
    },
    seed: 22,
    hints: ['Turn on Tackle Zone shading (T) to see which squares are Marked.', 'Dodging straight past O1 means moving into a square both Orcs Mark (−2).', 'Dodge away first into a square no Orc Marks (AG 3+ with no modifier), then go round.'],
    solution: ['Dodge from O8 to N9 (no Orc Marks N9: 3+ on the Agility Test), then move O10, P10, Q10, R9, S9 — no more rolls.', 'The one Dodge succeeds 4 times in 6 (66.7%); a Team Re-roll raises it to 88.9%.'],
  },
  {
    id: 'T3',
    title: 'Picking up the ball',
    summary: 'Move onto the ball and pick it up — or use Secure the Ball.',
    rules: [
      { page: 57, title: 'Picking up the Ball' },
      { page: 59, title: 'Secure the Ball Actions' },
    ],
    intro: [
      'Moving into the ball\'s square means trying to pick it up: an Agility Test (−1 per opposition player Marking the player). Failing is a Turnover and the ball bounces.',
      'Secure the Ball is an Action a team may declare once per Turn when no Standing opposition player is within 2 squares of the ball: move onto it and pick it up on a 2+.',
    ],
    objective: 'Get the ball into the hands of the Human Catcher (#1).',
    goal: { kind: 'holds', player: 'C' },
    scenario: {
      teams: HO,
      players: [
        { id: 'C', team: 'A', roster: 'human', position: 'catcher', at: [10, 7], number: 1 },
        { id: 'O1', team: 'B', roster: 'orc', position: 'lineman', at: [17, 8], number: 4 },
      ],
      ball: { at: [13, 8] },
      rerolls: { A: 1, B: 0 },
    },
    seed: 33,
    hints: ['Compare the two plans: a Move onto the ball, and Secure the Ball.', 'Review shows the pick-up chance of each.'],
    solution: ['Secure the Ball: move to N9 and roll 2+ (83.3%).', 'A Move onto the ball needs the Catcher\'s Agility Test instead (3+, 66.7%).'],
  },
  {
    id: 'T4',
    title: 'Passing',
    summary: 'Range bands, the Passing Ability test, and the Catch.',
    rules: [
      { page: 70, title: 'Pass Actions' },
      { page: 71, title: 'Passing Range Chart' },
      { page: 72, title: 'Catching the Ball' },
    ],
    intro: [
      'Choose Pass: the board shades the range bands from the thrower — Quick, Short, Long and Long Bomb. Longer passes get bigger penalties.',
      'The thrower tests Passing Ability; an accurate pass is caught with an Agility Test. Opposition players under the Range Ruler may try to Intercept.',
    ],
    objective: 'Complete a pass to the Human Catcher (#1).',
    goal: { kind: 'holds', player: 'C' },
    scenario: {
      teams: HO,
      players: [
        { id: 'T', team: 'A', roster: 'human', position: 'thrower', at: [10, 7], number: 2 },
        { id: 'C', team: 'A', roster: 'human', position: 'catcher', at: [16, 5], number: 1 },
        { id: 'O1', team: 'B', roster: 'orc', position: 'lineman', at: [13, 10], number: 4 },
      ],
      ball: { holder: 'T' },
      rerolls: { A: 1, B: 0 },
    },
    seed: 44,
    hints: ['Select the Thrower and choose Pass; click the Catcher to throw to them.', 'Moving the Thrower closer first can turn a Short pass into a Quick one — watch the range bands change as you edit the path.'],
    solution: ['Pass straight to the Catcher: a Short pass (−1). Review shows the accuracy and catch chances and whether the Orc can Intercept.', 'Or move the Thrower three squares to N7 first: from there it is a Quick pass (no modifier).'],
  },
  {
    id: 'T5',
    title: 'Hand-off and score',
    summary: 'Two activations in one Turn: a Hand-off, then a run.',
    rules: [
      { page: 74, title: 'Hand-off Actions' },
      { page: 72, title: 'Catching the Ball' },
    ],
    intro: [
      'A Hand-off gives the ball to an adjacent Standing team-mate, who must Catch it (no Passing test). One Hand-off Action per Turn.',
      'Each player is activated one at a time: finish the Blitzer\'s activation, then activate the Catcher.',
    ],
    objective: 'Score a Touchdown this Turn.',
    goal: { kind: 'touchdown' },
    scenario: {
      teams: HO,
      players: [
        { id: 'B', team: 'A', roster: 'human', position: 'blitzer', at: [20, 7], number: 5 },
        { id: 'C', team: 'A', roster: 'human', position: 'catcher', at: [22, 4], number: 1 },
        { id: 'O1', team: 'B', roster: 'orc', position: 'lineman', at: [18, 11], number: 4 },
      ],
      ball: { holder: 'B' },
      rerolls: { A: 1, B: 0 },
    },
    seed: 55,
    hints: ['Plan a Hand-off with the Blitzer: move next to the Catcher, then click the Catcher.', 'Then select the Catcher and move into column Z.'],
    solution: ['Blitzer: Hand-off — move to V6, then hand the ball to the Catcher (Catch 3+, with the Catch skill re-roll).', 'Catcher: Move three squares to Z5 for the Touchdown.'],
  },
  {
    id: 'T6',
    title: 'Blocking and assists',
    summary: 'Block dice, assists, pushes and follow-ups.',
    rules: [
      { page: 60, title: 'Block Actions' },
      { page: 61, title: 'Assisting a Block Action' },
      { page: 62, title: 'Block Dice' },
    ],
    intro: [
      'Compare Strength, each side adding +1 for every team-mate who Marks the opposing player and is not Marked by anyone else. Equal: 1 die; stronger: 2 dice and the stronger side picks; more than double: 3 dice.',
      'Block dice: Player Down (attacker down), Both Down, Push Back, Stumble (a Push Back if the target has Dodge, otherwise POW) and POW (pushed and Knocked Down).',
      'For much more practice counting dice, try the Block School course.',
    ],
    objective: 'Knock the Orc Lineman (#4) down.',
    goal: { kind: 'down', player: 'Y' },
    scenario: {
      teams: HO,
      players: [
        { id: 'X', team: 'A', roster: 'human', position: 'blitzer', at: [12, 7], number: 5 },
        { id: 'A1', team: 'A', roster: 'human', position: 'lineman', at: [12, 6], number: 6 },
        { id: 'A2', team: 'A', roster: 'human', position: 'lineman', at: [14, 8], number: 7 },
        { id: 'Y', team: 'B', roster: 'orc', position: 'lineman', at: [13, 7], number: 4 },
      ],
      ball: { at: [3, 3] },
      rerolls: { A: 1, B: 0 },
    },
    seed: 66,
    hints: ['Two of your Linemen Mark the Orc and nobody Marks them: two assists.', 'ST 3 + 2 against ST 3 → 2 dice, you choose.'],
    solution: ['Block the Orc with the Blitzer: 2 dice, you choose. POW and Stumble (the Orc has no Dodge) knock it down, and because the Blitzer has Block, Both Down knocks down only the Orc: 3 good faces of 6, so with 2 dice the Orc goes down 3 times in 4.'],
  },
  {
    id: 'T7',
    title: 'Blitz the ball carrier',
    summary: 'Move and Block in one Action — once per Turn.',
    rules: [{ page: 64, title: 'Blitz Actions' }],
    intro: ['A Blitz lets one player per Turn Move and make one Block during the move. The Block costs one square of movement.', 'Declare the target first by clicking it, then plan the path next to it.'],
    objective: 'Knock down the Orc ball carrier (#4).',
    goal: { kind: 'down', player: 'Y' },
    scenario: {
      teams: HO,
      players: [
        { id: 'X', team: 'A', roster: 'human', position: 'blitzer', at: [9, 7], number: 5 },
        { id: 'A1', team: 'A', roster: 'human', position: 'lineman', at: [15, 8], number: 6 },
        { id: 'Y', team: 'B', roster: 'orc', position: 'lineman', at: [14, 7], number: 4 },
      ],
      ball: { holder: 'Y' },
      rerolls: { A: 1, B: 0 },
    },
    seed: 77,
    hints: ['Choose Blitz and click the Orc carrier to declare it as the target, then click a square next to it (for example N8).', 'Your Lineman on P9 already Marks the carrier and nobody Marks the Lineman: that is an assist, so 2 dice.'],
    solution: ['Blitz: move to N8 (4 squares) and Block the carrier with the Lineman assisting: ST 4 v 3, 2 dice you choose; with Block on the Blitzer the carrier goes down 3 times in 4 and drops the ball.'],
  },
  {
    id: 'T8',
    title: 'Throw Team-mate',
    summary: 'A big player throws a small one — with the ball.',
    rules: [{ page: 76, title: 'Throw Team-mate Actions' }],
    intro: [
      'A player with Throw Team-mate can throw an adjacent team-mate with Right Stuff to a square within Quick or Short range. The throw is a Passing Ability test; the flight Scatters, then the thrown player must land (Agility Test).',
      'If the thrown player holds the ball and lands Standing in the End Zone, it is a Touchdown.',
      'Watch out: the Ogre has Bone Head (a 1 on its activation roll and it does nothing) and Loner (Team Re-rolls only on a 4+).',
    ],
    objective: 'Throw the Halfling (with the ball) into the End Zone and land it for a Touchdown.',
    goal: { kind: 'touchdown' },
    scenario: {
      teams: HO,
      players: [
        { id: 'O', team: 'A', roster: 'human', position: 'ogre', at: [19, 7], number: 9 },
        { id: 'H', team: 'A', roster: 'human', position: 'halfling', at: [20, 7], number: 12 },
        { id: 'B1', team: 'B', roster: 'orc', position: 'lineman', at: [14, 2], number: 4 },
      ],
      ball: { holder: 'H' },
      rerolls: { A: 1, B: 0 },
    },
    seed: 88,
    hints: ['Choose Throw Team-mate with the Ogre, click the Halfling, then switch clicks to “target” and click a square in column Z.', 'Aim deep in the End Zone so a scatter still lands inside it.'],
    solution: ['Throw the Halfling at Z8 (Short range). Review lists the Bone Head roll, the throw, three scatter dice and the landing test.'],
  },
  {
    id: 'T9',
    title: 'Projectile Vomit',
    summary: 'A Special Action that hits armour directly.',
    rules: [{ page: 133, title: 'Projectile Vomit' }],
    intro: [
      'Projectile Vomit is a Trait (from rosters not included in this app — added here to an Orc for the lesson). Instead of a Block, the player targets an adjacent Standing opponent and rolls a D6: on 2+ the target makes an Armour Roll (no modifiers); on a 1 the vomiting player does instead.',
      'It is used instead of a Block Action, or instead of the Block in a Blitz.',
    ],
    objective: 'Use Projectile Vomit on the Human Blitzer.',
    goal: { kind: 'action', action: 'special' },
    scenario: {
      teams: { A: { name: 'Orcs', roster: 'orc' }, B: { name: 'Humans', roster: 'human' } },
      players: [
        { id: 'V', team: 'A', roster: 'orc', position: 'bigUn', at: [12, 7], number: 7, extraSkills: [{ id: 'projectileVomit' }] },
        { id: 'H', team: 'B', roster: 'human', position: 'blitzer', at: [13, 7], number: 5 },
      ],
      ball: { holder: 'H' },
      rerolls: { A: 1, B: 0 },
    },
    seed: 99,
    hints: ['Select the Big Un: the Special button offers Projectile Vomit. Click the Human Blitzer.'],
    solution: ['Declare Projectile Vomit on the Blitzer: 2+ (83.3%) to hit, then an Armour Roll against AV 9+ without modifiers.'],
  },
  {
    id: 'T10',
    title: 'A whole match: set-up and kick-off',
    summary: 'Pre-game, set-up rules, the kick-off and Kick-off Events.',
    rules: [
      { page: 44, title: 'A Game of Two Halves' },
      { page: 47, title: 'Start of a Drive' },
      { page: 48, title: 'Kick-off Event Table' },
      { page: 49, title: 'Touchbacks' },
    ],
    intro: [
      'A match: roll for Fan Factor and Weather, roll off for who kicks, then each Drive starts with both teams setting up (kicking team first): 11 players in your own half, at least 3 on the Line of Scrimmage in the Centre Field, at most 2 in each Wide Zone.',
      'The kicking team nominates a kicker and places the kick in the opponent\'s half; it Deviates D8 + D6 squares, a Kick-off Event is rolled, then the ball lands. A ball that leaves the pitch or lands in the kicking half is a Touchback.',
      'The button below starts a practice match between two ready-made teams with the introductory rules (no Fan Factor, Weather or Kick-off Events).',
    ],
    objective: 'Start a practice match and play through set-up and the kick-off.',
    goal: { kind: 'info' },
    scenario: null,
    seed: 1010,
    hints: ['Use “Default formation” for a legal set-up, then move players around; illegal set-ups are explained and rejected.'],
    solution: ['There is no single solution: follow the Match panel from the pre-game to the first Turn.'],
  },
];

export const TUTORIAL_BY_ID: Record<string, Tutorial> = Object.fromEntries(TUTORIALS.map((t) => [t.id, t]));
