/**
 * Bloodboard rules engine — core data formats.
 *
 * Everything in this file is plain JSON-serialisable data. The engine never
 * stores functions or class instances in the game state, so a state can be
 * saved, reloaded, diffed, or handed to an external agent (e.g. Claude or
 * Codex) without loss. See docs/INTERFACE.md for the full contract.
 */

export type TeamId = 'A' | 'B';

/** Game variant: standard Blood Bowl, or Blood Bowl Sevens (Spike! Journal 22; see variant.ts). */
export type Variant = 'standard' | 'sevens';

/** Pitch square. Standard pitch: x 0..25 (End Zones x=0 and x=25), y 0..14. Sevens pitch: x 0..19, y 0..10. */
export interface Coord {
  x: number;
  y: number;
}

export type Weather = 'perfect' | 'verySunny' | 'pouringRain' | 'blizzard' | 'swelteringHeat';

/** A skill or trait held by a player. `value` is used by Loner (X+),
 *  `keyword` by Hatred (X) and Animosity (X). */
export interface SkillRef {
  id: string;
  value?: number;
  keyword?: string;
  /** A skill gained for a while only (Star Player special rules): removed at the end of the activation / Turn / Drive. */
  until?: 'activation' | 'turn' | 'drive';
}

export type Location = 'pitch' | 'reserves' | 'ko' | 'cas' | 'sentOff';
export type Stance = 'standing' | 'prone' | 'stunned';

export interface Player {
  id: string;
  team: TeamId;
  number: number;
  name: string;
  /** Position title from the roster, e.g. "Orc Blitzer". */
  position: string;
  keywords: string[];
  ma: number;
  st: number;
  /** Agility target number (3 means 3+). */
  ag: number;
  /** Passing Ability target number, or null for a '-' profile. */
  pa: number | null;
  /** Armour Value target number (9 means 9+). */
  av: number;
  skills: SkillRef[];

  location: Location;
  pos: Coord | null;
  stance: Stance;
  /** Standing but without a Tackle Zone (p.39). Only meaningful when standing. */
  distracted: boolean;

  /** Has been activated during the current team turn. */
  activated: boolean;
  /** Eye Gouge: cannot provide assists until next activated (p.128). */
  eyeGouged?: boolean;
  /** Per-turn skill usage counters, reset at the start of every team turn. */
  usage: SkillUsage;
  /** Casualty table result, for display (p.67). */
  casualtyResult?: string;
  /** Match play: id of the player in the saved team (TeamDef) this player came from. */
  defId?: string;
  /** Match play: took part in the current Drive (Secret Weapon, p.135). */
  inDrive?: boolean;
  /** Match play: may not be set up for the next Drive (Sweltering Heat, p.46; Sevens Hangover). */
  benched?: boolean;
  /** Why `benched` (default: Sweltering Heat). */
  benchedWhy?: string;
  /** Sevens Desperate Measure You Dope! (Spike! 22 p.15): the characteristic improved for the game. */
  doped?: 'st' | 'ag';
  /** Take Root (p.137): cannot move, be Pushed Back or Follow-up until Knocked Down, Placed Prone or the Drive ends. */
  rooted?: boolean;
  /** Monstrous Mouth (p.131): id of the player whose Chomp holds this player (while they keep Marking them). */
  chompedBy?: string;
  /** Plague Ridden (p.133): already used this game. */
  plagueUsed?: boolean;
  /** Blood Bowl Sevens Veteran (Spike! 22 p.13): its once-per-game re-roll is 'ready' or 'used'. */
  veteran?: 'ready' | 'used';
  /** Team Captain (p.155): the team's nominated Captain (it has Pro; a natural 6 after a Team Re-roll makes it free). */
  captain?: boolean;
  /** Masters of Undeath (p.155): a Lineman raised during this game (its Team Roster position id). */
  raised?: string;
  /** Mercenary Player (Inducement, p.147): hired for this game (Loner (4+) added). */
  mercenary?: boolean;
  /** Journeyman for this game only (Riotous Rookies, p.145): a roster Lineman with Loner (4+). */
  journeyman?: boolean;
  /** Star Player (Inducement, p.148; profiles pp.195-211): the Star Player's id (stardata.ts). */
  star?: string;
  /** Star Player special rule uses: markers of when it was used ('game', 'h1', 'd3', 'a…' — see stars.ts). */
  starUsed?: string[];
  /** Estelle la Veneaux's Baleful Hex (p.198): cannot be activated during this Turn of their team. */
  hexed?: { half: 1 | 2; turn: number };
  /** Grak's I'll Carry You (p.200): Crumbleberry is carried by this player (off the pitch until set down). */
  carriedBy?: string;
  /** Where the carried player was picked up (fallback for setting them down). */
  carriedFrom?: Coord;
  /** Sports-Wizard's Zap! (p.149): turned into a Frog until the end of the Drive — the player's own profile, restored then. */
  frog?: { ma: number; st: number; ag: number; pa: number | null; av: number; skills: SkillRef[]; keywords: string[]; position: string };
}

export interface SkillUsage {
  dodgeReroll?: boolean;
  sureFeet?: boolean;
  breakTackle?: boolean;
  shadowing?: number;
}

export interface TeamState {
  id: TeamId;
  name: string;
  rosterId?: string;
  /** Primary colour (CSS) used by the interface. */
  color: string;
  /** Secondary colour used for numbers/outlines. */
  accent: string;
  rerolls: number;
  /** Leader re-roll available this half (p.130). Usable only while a Leader is on the pitch. */
  leaderReroll: boolean;
  score: number;
  /** Turn marker: the team's current (or last played) turn in this half, 0..8. */
  turn: number;
  /** Extra Team Re-rolls that expire at the end of the Drive (Brilliant Coaching, p.48). Used before normal ones. */
  bonusRerolls?: number;
  /** Apothecary (p.68): once per game. Absent = the team has none. */
  apothecary?: 'available' | 'used';
  /** Match play: the team's League and team special rules (pp.152-155), for display and the rules that use them. */
  league?: string;
  specialRules?: string[];
  /** Masters of Undeath (p.155): the once-per-game Raise the Dead has been used. */
  raiseDeadUsed?: boolean;
  /** Bribery and Corruption (p.154): the once-per-game re-roll of a 1 to Argue the Call has been used. */
  briberyUsed?: boolean;
  /** Team Mascot (Inducement, p.144): its extra Team Re-roll is still available this half. */
  mascotReroll?: boolean;
  /** Once-per-game Inducements already used this game (Weather Mage, Mortuary Assistant, Plague Doctor, Wandering Apothecaries, Dwarfen Wisdom): id → times used. */
  induceUsed?: Record<string, number>;
  /** Team Re-rolls gained for the next Drive only (Count Luthor von Drakenborg, p.197): added when it starts. */
  nextDriveRerolls?: number;
  /** Argue the Call rolled a 1 in a practice position (match play records it in MatchState.coachEjected). */
  coachEjected?: boolean;
}

export type BallState =
  | { kind: 'held'; playerId: string }
  | { kind: 'ground'; pos: Coord }
  | { kind: 'none' };

export type ActionType = 'move' | 'blitz' | 'block' | 'pass' | 'handoff' | 'secure' | 'foul' | 'ttm' | 'special';

/**
 * Special Actions (p.54, Skills & Traits pp.123-138), named by the skill or
 * trait that grants them: Projectile Vomit, Stab, Chainsaw Attack, Breathe
 * Fire, Hypnotic Gaze, Chomp (Monstrous Mouth), Throw Bomb (Bombardier),
 * Punt, Kick Team-mate and Ball & Chain.
 */
export type SpecialId = 'projectileVomit' | 'stab' | 'chainsaw' | 'breatheFire' | 'hypnoticGaze' | 'monstrousMouth' | 'bombardier' | 'punt' | 'kickTeamMate' | 'ballAndChain';

/** Direction a Throw-in Template faces (Punt, Ball & Chain): towards x=0 / x=25 End Zones or the y=0 / y=14 Sidelines. */
export type Facing = 'x-' | 'x+' | 'y-' | 'y+';

export interface Activation {
  playerId: string;
  action: ActionType;
  blitzTarget?: string;
  /** Squares of Move Allowance spent so far (standing up = 3, a Jump = 2, a Blitz's Block = 1). */
  maUsed: number;
  rushesUsed: number;
  blocksDone: number;
  /** Pass / Hand-off / Secure the Ball performed (activation normally ends). */
  ballActionDone: boolean;
  proUsed: boolean;
  /** Brawler's re-roll has been used in this activation (FAQ May 2026 p.126: once per activation, not once per Block). */
  brawlerUsed?: boolean;
  /** Stalling check prerequisites (p.80-81). */
  stallingCandidate: boolean;
  /** The activation can no longer continue (fell, distracted, finished...). */
  over: boolean;
  /** Foul made (Quick Foul lets the player keep moving afterwards, p.134). */
  foulDone?: boolean;
  /** Special Action performed (Hypnotic Gaze, Punt: no more movement afterwards). */
  specialDone?: boolean;
  /** The Special Action declared (action 'special'), so a continued activation keeps it. */
  special?: SpecialId;
  /** Bloodlust (p.125): 'hungry' after a failed roll until a Thrall is bitten ('fed'). */
  bloodlust?: 'hungry' | 'fed';
  /** Star Player special rules in effect for the rest of this activation (e.g. 'gored': Grashnak's extra Block die). */
  starFlags?: string[];
  /** Sevens Desperate Measures used for this activation: Razzle-Dazzle (the first Action, and the second once declared), Grudge Match, Set Piece. */
  razzle?: { first: ActionType; second?: ActionType };
  grudge?: boolean;
  setPiece?: boolean;
}

export interface TurnState {
  active: TeamId;
  half: 1 | 2;
  used: {
    blitz: boolean;
    pass: boolean;
    handoff: boolean;
    foul: boolean;
    secure: boolean;
    ttm: boolean;
    /** One Throw Bomb, Punt and Kick Team-mate Special Action per Turn (p.125, p.134, p.130). */
    bomb?: boolean;
    punt?: boolean;
    ktm?: boolean;
    /** Players who declared a Foul Action this Turn (the Black Gobbo allows two, p.196). */
    foulBy?: string[];
  };
  /** Ids of active-team players that started this turn Stunned (they roll over at turn end, p.39). */
  stunnedAtStart: string[];
  activation: Activation | null;
  /**
   * A Turn has just ended and the next one has not begun yet (no player activated): the moment "at the end of any
   * Turn, before the next Turn begins" when a Sports-Wizard may cast (p.149). Also true after the last Turn of a
   * Drive (Touchdown / end of the half) until the next Drive.
   */
  betweenTurns?: boolean;
  /** Teams whose (computer) coach decided not to cast their Wizard in this gap between Turns. */
  wizardDeclined?: TeamId[];
}

/**
 * 'setup' = free position editor; 'play' = a Turn is in progress; 'touchdown'
 * and 'halfOver' = the Drive has ended. Match play adds 'pregame' (fans,
 * weather, kicking team), 'driveSetup' (teams set up), 'kickoff' (kick,
 * Kick-off Event, landing) and 'fullTime'.
 */
export type Phase = 'setup' | 'play' | 'touchdown' | 'halfOver' | 'pregame' | 'driveSetup' | 'kickoff' | 'fullTime';

export interface RngState {
  /** 32-bit unsigned seed. */
  seed: number;
  /** Number of 32-bit draws consumed so far. */
  counter: number;
}

export interface RuleRef {
  /** Printed page number in the supplied Third Season rulebook (or in Spike! Journal 22 when source is 'sevens'). */
  page: number;
  title: string;
  /** 'sevens': Spike! Journal: Sevens (Issue 22, 2026). Absent: the Third Season rulebook. */
  source?: 'sevens';
}

/** One line of the action log. `text` is human readable; `data` is structured. */
export interface GameEvent {
  type: EventType;
  text: string;
  rule?: RuleRef;
  data?: Record<string, unknown>;
  /** Every die actually rolled for this event, in the order rolled (execution only). */
  dice?: DiceRecord[];
  /**
   * Board at the moment of this event (execution results only; not stored in
   * the log). Lets an interface replay a multi-step action stage by stage.
   */
  snap?: BoardSnap;
}

/** A physical roll: the dice type and the faces that came up (before any sorting). */
export interface DiceRecord {
  /** 'block' = Block dice (faces 1..6 mapped to results), otherwise the die size. */
  kind: 'block' | 'd3' | 'd6' | 'd8' | 'd16' | 'random';
  /** 'random' only: a random selection among `sides` candidates (e.g. a randomly selected player). */
  sides?: number;
  faces: number[];
  /** Block dice only: the result shown on each die, same order as `faces`. */
  block?: Array<'playerDown' | 'bothDown' | 'push' | 'stumble' | 'pow'>;
}

/** Compact board snapshot: [playerId, x, y, stance, location] (x = y = -1 off the pitch). */
export interface BoardSnap {
  players: Array<[string, number, number, Stance, Location]>;
  ball: BallState;
}

export type EventType =
  | 'declare'
  | 'move'
  | 'roll'
  | 'reroll'
  | 'decision'
  | 'status'
  | 'ball'
  | 'push'
  | 'block'
  | 'injury'
  | 'turnover'
  | 'touchdown'
  | 'turn'
  | 'activation'
  | 'note';

export interface LogEntry {
  id: number;
  team: TeamId;
  turn: number;
  /** One-line headline, e.g. "#5 Orc Blitzer — Blitz on #3". */
  title: string;
  /** Summary of the plan as reviewed before confirmation. */
  plan?: PlanSummaryForLog;
  input: ActionInput;
  events: GameEvent[];
  decisions: DecisionRecord[];
  outcome: 'completed' | 'turnover' | 'touchdown' | 'stopped';
}

export interface PlanSummaryForLog {
  headline: string;
  steps: string[];
  probabilities: string[];
  assumptions: string[];
}

export interface DecisionRecord {
  requestId: string;
  team: TeamId;
  prompt: string;
  optionId: string;
  label: string;
}

export interface PendingAction {
  /** Snapshot taken immediately before the action started (without `pending`). */
  base: GameState;
  input: ActionInput;
  decisions: DecisionRecord[];
  request: DecisionRequest;
  /** Events generated so far (for display). */
  events: GameEvent[];
  plan?: PlanSummaryForLog;
}

export interface GameOptions {
  /** Width of the Range Ruler in squares for the interception check (see docs). */
  rulerWidth: number;
}

export interface GameState {
  format: 'bloodboard-state';
  version: 1;
  /** Absent = standard Blood Bowl. 'sevens' = Blood Bowl Sevens (pitch, set-up, tables: see variant.ts). */
  variant?: Variant;
  phase: Phase;
  weather: Weather;
  teams: Record<TeamId, TeamState>;
  players: Player[];
  ball: BallState;
  turn: TurnState;
  rng: RngState;
  options: GameOptions;
  log: LogEntry[];
  pending: PendingAction | null;
  touchdown?: { team: TeamId; playerId: string; duringTeamTurn: TeamId };
  /** Present when this state is a full match between two saved teams (see match.ts). */
  match?: MatchState;
  /**
   * V7: which rules edition this match runs. 'faq2026' = the May 2026 FAQ corrections (BB-FAQ-006..018). Absent = a match started before
   * them: it keeps the earlier behaviour for those rules so its recorded history still replays dice-for-dice.
   */
  rulesEdition?: 'faq2026';
  /** Free-text notes shown in the position library. */
  title?: string;
  notes?: string;
  /**
   * V5.5: the match timer shown above the pitch (display only — the rules never read it; no time limits). Written
   * into saved matches so the accumulated times survive saving and loading.
   */
  clock?: MatchClock;
}

/** V5.5 match timer: milliseconds of match time in total, and used by each side (acting or deciding). */
export interface MatchClock {
  totalMs: number;
  A: number;
  B: number;
}

// ---------------------------------------------------------------------------
// Match play (p.44-49, p.80-83)
// ---------------------------------------------------------------------------

export type MatchKind = 'league' | 'tournament';

/** V5.5: the computer coach of a team — an AI file (docs/AI_EXTENSIONS.md). */
export interface CoachRef {
  /** The AI file's id (e.g. "bloodboard-balanced"). */
  ai: string;
  name?: string;
  version?: string;
  /** V5 step 6 saves only: the built-in AI's former style (now the bundled files "bloodboard-<style>"). */
  style?: 'balanced' | 'offensive' | 'defensive';
  /**
   * A temporary coaching takeover of a human-coached team: for one player activation, for the rest of the Turn, or
   * until the human takes control back. `half`/`turn`: when it began; `since`: the log id of the change.
   */
  takeover?: { mode: TakeoverMode; half: 1 | 2; turn: number; since: number };
}

export type TakeoverMode = 'activation' | 'turn' | 'untilBack';

export interface MatchOptions {
  /**
   * 'full': Fan Factor, Weather roll and Kick-off Events (p.44-48).
   * 'introductory': "your first few games" (p.44) — equal Fan Factor,
   * Perfect Conditions, no Kick-off Event.
   */
  rules: 'full' | 'introductory';
  /**
   * A team coached by the interface's computer opponent, and its play style.
   * Recorded here so a saved match reopens with the same opponent; the rules
   * engine itself never reads it (the computer acts through the same inputs
   * as a human coach).
   */
  computer?: { team: TeamId; style?: 'balanced' | 'offensive' | 'defensive' };
  /**
   * V5.5: the coach of each team now — absent = a human at this computer; present = the computer, with the AI file
   * chosen (its id, name and version, recorded so a saved match reopens with the same coaches). Both teams may be
   * computer-coached (a match to watch). Changed during a match only by the `coachChange` input (logged). `computer`
   * above keeps naming the first computer team at the start of the match — the side the dice difficulty house rule
   * treats as the computer's for the whole match. The rules themselves never depend on who coaches a team.
   */
  coaches?: Partial<Record<TeamId, CoachRef>>;
  /**
   * Optional HOUSE RULE for matches against the computer only (not standard Blood Bowl). V5.5: every consequential
   * roll — Block dice included — is weighed by whom its result helps: `player` 0-3 makes the human side's good results
   * a little less likely, `computer` 0-3 the computer side's good results a little more likely; every result stays
   * possible and 0 = standard dice (engine: context.ts difficultyFactors). Ignored when there is no computer opponent.
   */
  difficulty?: { player: number; computer: number; mode?: 'outcomes' };
  /**
   * V5.5, Blood Bowl Sevens only — where On the Ball may move at the kick-off. 'noMansLand' (default): into the
   * receiving team's side of No Man's Land (the GW Designer's Commentary ruling, May 2025 p.94, Death Zone Sevens);
   * 'ownArea': not into No Man's Land (the optional NAF recommendation for BB2025 Sevens, declared by an event).
   */
  sevensOnTheBall?: 'noMansLand' | 'ownArea';
  /**
   * V5 step 6: which kind of one-off match this is — Tournament (Matched Play: the teams' Skill Points and bought
   * skills apply) or Exhibition (no purchased skills). Informational for the interface; League matches have kind
   * 'league'.
   */
  play?: 'tournament' | 'exhibition';
}

export type KickoffPhase =
  | { type: 'solidDefence'; team: TeamId; max: number }
  /** Quick Snap (receiving team), or the Sevens Alert Defence (kicking team, `alert`): one square each. */
  | { type: 'quickSnap'; team: TeamId; max: number; alert?: boolean }
  | { type: 'charge'; team: TeamId; max: number; activated: string[]; blitz: boolean; ttm: boolean; ktm?: boolean }
  /** Swarming (p.155): after both teams set up, `team` may set up up to `max` (D3) more Linemen from its Reserves Box; `next`: the other team also swarms. */
  | { type: 'swarming'; team: TeamId; max: number; next?: TeamId }
  /** Josef Bugman's Dwarfen Wisdom (Inducement, p.147): once per game, after the set-ups and before the kick-off, `team` sets up `max` (D3) of its players again. */
  | { type: 'dwarfenWisdom'; team: TeamId; max: number };

export interface MatchState {
  /** V6: the match's identity (not its name). Absent in matches created before V6. */
  matchId?: string;
  kind: MatchKind;
  options: MatchOptions;
  /** Saved team (TeamDef) ids for both sides (a mirror copy has its own id, see `mirror`). */
  teamIds: Record<TeamId, string>;
  /**
   * V5.5: both coaches chose the same saved team. Player 2 (`team`) plays an independent match copy of saved team
   * `of` — its name marked "*", its colours inverted, its own team and player ids. Nothing from the copy is ever
   * written back to the saved team (League SPP and Masters of Undeath hires go to Player 1's side only).
   */
  mirror?: { team: TeamId; of: string };
  /** Team Re-rolls bought for the roster: replenished at half-time (p.33). */
  rosterRerolls: Record<TeamId, number>;
  dedicatedFans: Record<TeamId, number>;
  assistantCoaches: Record<TeamId, number>;
  cheerleaders: Record<TeamId, number>;
  fanFactor?: Record<TeamId, number>;
  half: 1 | 2;
  /** The team that received in the first half (kicks in the second, p.83). */
  receivedFirst?: TeamId;
  /** Kicking team of the current Drive. */
  kicking?: TeamId;
  drive: number;
  setupDone: Record<TeamId, boolean>;
  /** The kick of the current Drive. landing null = the ball left the pitch. */
  kick?: { kicker: string; target: Coord; landing: Coord | null; scatterInAir: boolean };
  kickoffEvent?: { roll: number; name: string };
  /** Interactive part of a Kick-off Event still to be played. */
  pendingPhase?: KickoffPhase;
  bribes: Record<TeamId, number>;
  coachEjected: Record<TeamId, boolean>;
  /** Cheering Fans (p.48): +1 Offensive Assist on the first Block of that team's next Turn. */
  cheering?: { team: TeamId; turn: number; used: boolean }[];
  /** Dodgy Snack (p.48): restore MA/AV at the end of the Drive. */
  driveMods: Array<{ playerId: string; ma: number; av: number }>;
  /** Swarming (p.155): extra Linemen each team set up for the current Drive (so later set-up checks allow them). */
  swarmed?: Partial<Record<TeamId, number>>;
  /** Inducements each team bought on its Team Draft List (pp.141-147): id → count. */
  inducements?: Record<TeamId, Record<string, number>>;
  /** V5 step 6: Tournament (Matched Play) teams — Tier, Skill Points and what they bought (shown on the match card). */
  matched?: Partial<Record<TeamId, { tier: 1 | 2 | 3 | 4; allowance: number; spent: number; skills: string[]; format: 'standard' | 'sevens' }>>;
  /** V5.5: League pre-match Inducements (p.94): each team's CTV, Petty Cash received and Treasury gold spent. */
  preMatch?: Partial<Record<TeamId, { ctv: number; pettyCash: number; treasurySpent: number }>>;
  /** V5.5: an All-Star Match (custom Exhibition variant) — each squad's limits (null = an ordinary team). */
  allStar?: Record<TeamId, { budget: number | null; maxStars: number } | null>;
  /** Josef Bugman's Dwarfen Wisdom was already offered to these teams this Drive. */
  wisdomAsked?: TeamId[];
  /** Prayers to Nuffle each team received in the pre-game (D16 results, p.143; Sevens D8 results mapped to them). */
  prayers?: Record<TeamId, number[]>;
  /** Blood Bowl Sevens Desperate Measures (Spike! 22 p.15): D8 results each team rolled, and those used. */
  desperate?: Record<TeamId, number[]>;
  desperateUsed?: Record<TeamId, number[]>;
  result?: { winner: TeamId | null; score: Record<TeamId, number> };
  /**
   * Star Player Points earned in this match (p.96), by player id: counts of
   * Completions, Throw Team-mate Superb Throws landed, safe landings,
   * Interceptions, Casualties, Touchdowns and MVP awards.
   */
  spp?: Record<string, SppTally>;
  /** Most Valuable Player of each team, once rolled after full time (p.97). */
  mvp?: Partial<Record<TeamId, string>>;
  /** Players who were set up for at least one Drive (p.96: MVP nominees must have played). */
  played?: string[];
  /** League matches: the Star Player Points of this match were added to that team's saved roster. */
  sppApplied?: Partial<Record<TeamId, boolean>>;
}

export interface SppTally {
  completion?: number;
  ttm?: number;
  landing?: number;
  interception?: number;
  casualty?: number;
  touchdown?: number;
  mvp?: number;
}

// ---------------------------------------------------------------------------
// Action input
// ---------------------------------------------------------------------------

export type MoveKind = 'step' | 'jump' | 'leap' | 'pogo';

export interface PathStep {
  to: Coord;
  kind: MoveKind;
}

/** A confirmed (or planned) player action segment. */
export interface PlayerActionInput {
  kind: 'playerAction';
  playerId: string;
  action: ActionType;
  /** Squares to move through, in order (may be empty). */
  path: PathStep[];
  /** Blitz: declared target (required on the first segment of a Blitz). */
  blitzTarget?: string;
  /** Block / Blitz: perform a Block against this player after moving. */
  blockTarget?: string;
  /** Pass: target square. */
  passTarget?: Coord;
  /** Pass: throw it as a Hail Mary Pass (p.129). */
  hailMary?: boolean;
  /** Hand-off: receiving team-mate. */
  handoffTarget?: string;
  /** Jump Up: stand up and Block from Prone with an Agility Test (p.130). */
  jumpUpBlock?: boolean;
  /** Throw Team-mate (p.76): the adjacent Right Stuff team-mate to throw. */
  thrownPlayerId?: string;
  /** Throw Team-mate: target square (Quick or Short Throw range). */
  throwTarget?: Coord;
  /**
   * Special Action to perform with action 'special'. On a Blitz, a targeted
   * Special Action (Projectile Vomit, Stab, Chainsaw Attack, Breathe Fire,
   * Chomp) may replace the Block against the Blitz target.
   */
  special?: SpecialId;
  /** Target player of a targeted Special Action (Stab, Chainsaw Attack, Breathe Fire, Hypnotic Gaze, Chomp, Projectile Vomit). */
  specialTarget?: string;
  /** Projectile Vomit target (p.133): same as specialTarget (kept for saved inputs). */
  vomitTarget?: string;
  /** Foul Action (p.69): the Prone or Stunned opposition player fouled after the move. */
  foulTarget?: string;
  /**
   * Blood Bowl Sevens Desperate Measure used with this input (Spike! 22 p.15): Razzle-Dazzle or Grudge Match when the
   * player is activated, Set Piece with the Pass.
   */
  desperate?: 'razzleDazzle' | 'grudgeMatch' | 'setPiece';
  /** Chainsaw (p.126): use the chainsaw for the Foul (+3 Armour, Kick-back on a 1). */
  useChainsaw?: boolean;
  /** Multiple Block (p.132): the second target of the Block Action. */
  blockTarget2?: string;
  /** Throw Bomb Special Action (Bombardier, p.125): target square. */
  bombTarget?: Coord;
  /** Punt (p.134) and Ball & Chain (p.124): which way the Throw-in Template faces. */
  facing?: Facing;
  /** Fumblerooski (p.128): leave the ball on the ground in the square this move starts from. */
  leaveBall?: boolean;
  /**
   * Star Players (V5): use the Star Player's special rule at the start of this activation, or the Action variant
   * it allows (Maple's Block 2 squares away, Nobbla's Chainsaw Attack on a Prone player, Bilerot's Projectile
   * Vomit, Cindy's two bombs) — see starActions.ts. Its choices are asked as decisions.
   */
  starRule?: boolean;
  /**
   * With `starRule`: the player the rule is used on (Thorsson's, Zzharg's, Swiftvine's, Kiroth's, Zolcath's,
   * Estelle's, Jeremiah's, Hakflem's, Ivar's, Grombrindal's target), chosen in advance instead of by a decision.
   * The computer uses it; the interface asks the question instead.
   */
  starTarget?: string;
}

export type ActionInput =
  | PlayerActionInput
  | { kind: 'endActivation' }
  | { kind: 'forgo'; playerId: string }
  | { kind: 'endTurn' }
  /** Sports-Wizard (p.149): at the end of a Turn, before the next begins — Fireball on a square, or Zap! on a player; 'none' = keep it (the computer's pass). */
  | { kind: 'wizard'; team: TeamId; spell: 'fireball' | 'zap' | 'none'; square?: Coord; target?: string }
  | MatchInput;

/** Match play inputs (only valid in a state with `match`). */
export type MatchInput =
  /** Fan Factor, Weather and the roll-off for the kicking team (p.44-46). */
  | { kind: 'pregame' }
  /** Set up one team for the Drive: player id → square, or null for the Reserves Box (p.47). */
  | { kind: 'setupTeam'; team: TeamId; positions: Record<string, Coord | null> }
  /** Nominate the kicker and the target square in the receiving half (p.47). `useKick`: Kick skill (p.130). */
  | { kind: 'kickoff'; kicker: string; target: Coord; useKick?: boolean }
  /** Kick-off Event 4 Solid Defence: new squares for up to D3+3 Open kicking players (p.48). */
  | { kind: 'solidDefence'; positions: Record<string, Coord | null> }
  /** Kick-off Event 9 Quick Snap: one-square moves for up to D3+3 Open receiving players (p.48). */
  | { kind: 'quickSnap'; moves: Record<string, Coord> }
  /** Kick-off Event 10 Charge!: stop activating players and let the ball land (p.48). */
  | { kind: 'endCharge' }
  /** Swarming (p.155): the extra Linemen set up from the Reserves Box (player id → square). */
  | { kind: 'swarming'; positions: Record<string, Coord> }
  /** Dwarfen Wisdom (Josef Bugman, p.147): new squares for up to D3 of the team's players (player id → square). */
  | { kind: 'dwarfenWisdom'; positions: Record<string, Coord> }
  /** Weather Mage (Inducement, p.144): at the start of one of the team's Turns, roll on the Weather Table with a modifier −2…+2. */
  | { kind: 'weatherMage'; team: TeamId; modifier: number }
  /** Throw a Rock (Prayer to Nuffle 14, p.143): at the start of one of the team's Turns, a random opposition player is Knocked Down on 4+. */
  | { kind: 'throwARock'; team: TeamId }
  /** End of Drive sequence and the next Drive / half / full time (p.82-83). */
  | { kind: 'nextDrive' }
  /**
   * V5.5 (interface, not a rule): change who coaches a team from now on — a computer coach (an AI file), or null for
   * the human at this computer; with `coach.takeover`, a temporary takeover of a human-coached team. Only between
   * actions (never while a decision is pending); no dice are rolled and nothing on the board changes. Logged.
   */
  | { kind: 'coachChange'; team: TeamId; coach: CoachRef | null }
  /**
   * League matches, after full time: the coach nominates up to six players of
   * their team who played and rolls a D6 for the Most Valuable Player (p.96).
   */
  | { kind: 'mvp'; team: TeamId; nominees: string[] };

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export type DecisionType =
  | 'reroll'
  | 'blockDie'
  | 'pushSquare'
  | 'followUp'
  | 'skill'
  | 'mightyBlow'
  | 'armBar'
  | 'interceptor'
  | 'sidestepSquare'
  | 'grabSquare'
  | 'safePairOfHands'
  | 'hitAndRun'
  | 'breakTackle'
  | 'divingTackle'
  | 'shadowing'
  | 'tentacles'
  | 'wrestle'
  | 'juggernaut'
  | 'standFirm'
  | 'stripBall'
  | 'fend'
  | 'taunt'
  | 'stalling'
  | 'kickOrReceive'
  | 'highKick'
  | 'touchback'
  | 'argueTheCall'
  | 'bribe'
  | 'apothecary'
  | 'dirtyPlayer'
  | 'foulAssist'
  | 'lethalFlight'
  | 'pileDriver'
  | 'dumpOff'
  | 'trickster'
  | 'saboteur'
  | 'onTheBall'
  | 'divingCatch'
  | 'animalSavagery'
  | 'bloodlust'
  | 'plagueRidden'
  | 'raiseDead'
  | 'briberyCorruption'
  | 'swarming'
  | 'regenReroll'
  | 'dwarfenWisdom'
  | 'starRule'
  | 'prayerPick'
  | 'swoop'
  | 'bombThrow'
  | 'punt'
  | 'desperate';

export interface DecisionOption {
  id: string;
  label: string;
  detail?: string;
  /** Squares to highlight on the pitch for this option. */
  square?: Coord;
}

export interface DecisionRequest {
  /** Deterministic id: `<sequence>:<type>`. */
  id: string;
  type: DecisionType;
  /** Coach who decides. */
  team: TeamId;
  prompt: string;
  options: DecisionOption[];
  /** Extra information for display, e.g. dice faces. */
  context?: Record<string, unknown>;
  rule?: RuleRef;
}

export interface DecisionChoice {
  requestId: string;
  optionId: string;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type ExecutionStatus = 'completed' | 'awaitingDecision' | 'turnover' | 'touchdown' | 'illegal';

export interface ExecutionResult {
  status: ExecutionStatus;
  state: GameState;
  /** Events produced by this call (for a pending action: all events so far). */
  events: GameEvent[];
  decision?: DecisionRequest;
  error?: string;
}
