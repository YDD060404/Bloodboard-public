/**
 * Match play: a full game between two saved teams (printed pages in brackets).
 *
 *   createMatch → 'pregame' input: Fan Factor, Weather, roll-off (p.44-46)
 *   → 'setupTeam' (kicking team first, then receiving team; p.47)
 *   → 'kickoff': kicker + target, Deviate, Kick-off Event, landing / Touchback (p.47-49)
 *     (Solid Defence / Quick Snap / Charge! pause for the coach: 'solidDefence',
 *      'quickSnap', or normal activations followed by 'endCharge')
 *   → Turns ('play') until a Touchdown or the end of the half
 *   → 'nextDrive': End of Drive sequence (p.82-83) → next Drive, half-time or full time.
 */
import { adjacent, add, D8_DIRS, eq, fmt, inBounds, isWideZone, neighbours } from './board';
import { catchAttempt, kickDivingCatch, scatterPath } from './ball';
import { onTheBallKickoff } from './onTheBall';
import { ActionStop, Ctx, IllegalAction } from './context';
import { newGame, playerFromPosition, validatePosition } from './setup';
import { ROSTER_BY_ID } from './rosters';
import { SKILL_BY_ID } from './skills';
import { cloneState, findPlayer, getPlayer, hasSkill, isOpen, label, other, pitchPlayers, playerAt } from './state';
import { teamLeague, teamSkillPoints, teamSpecialRules, validateTeamDef, type TeamDef } from './teams';
import { INDUCE_RULE, induceLeft, induced, spendInduce } from './inducements';
import { PRAYER_RULE, rollPrayers, throwARockReason } from './prayers';
import { askHangover, askYouDope, rollDesperate, youDopeEndOfDrive } from './desperate';
import { dropTempSkills, spendStar, starReady } from './stars';
import { goDown } from './injury';
import { startNextTurn } from './turn';
import { restoreFrog, ZAP_RULE } from './wizard';
import { isTournamentTeam } from './matched';
import { awardSpp, mvpEligible } from './spp';
import type { CoachRef, Coord, GameState, MatchInput, MatchKind, MatchOptions, MatchState, Player, TeamId, Weather } from './types';
import { inPitchHalf, inTeamArea, pitch, rulesFor, usePitch } from './variant';

export const MATCH_RULES = {
  structure: { page: 44, title: 'A Game of Two Halves' },
  fans: { page: 45, title: 'The Fans' },
  weather: { page: 46, title: 'The Weather' },
  kicking: { page: 46, title: 'Determine Kicking Team' },
  setup: { page: 47, title: 'Start of a Drive: Set-up' },
  kickoff: { page: 47, title: 'The Kick-off' },
  events: { page: 48, title: 'Kick-off Event Table' },
  touchback: { page: 49, title: 'Touchbacks' },
  endOfDrive: { page: 82, title: 'The End of a Drive' },
  restart: { page: 83, title: 'Restarting / Ending the Game' },
  argue: { page: 69, title: 'Argue the Call' },
  bribe: { page: 144, title: 'Bribes' },
  apothecary: { page: 68, title: 'Apothecaries' },
};

// ---------------------------------------------------------------------------
// Pitch halves and set-up zones (p.47)
// ---------------------------------------------------------------------------

/**
 * The area a team sets up in (p.47 "own half"; Sevens p.10 "between their End Zone and their Line of
 * Scrimmage"): standard Team A x 0-12, Team B x 13-25; Sevens Team A x 0-6, Team B x 13-19 (No Man's Land 7-12).
 */
export function inOwnHalf(team: TeamId, c: Coord): boolean {
  return inTeamArea(team, c.x);
}

/** Column adjacent to this team's Line of Scrimmage, on its own side. */
export function losColumn(team: TeamId): number {
  return team === 'A' ? pitch().losA : pitch().losB;
}

export function onLineOfScrimmageCentre(team: TeamId, c: Coord): boolean {
  return c.x === losColumn(team) && !isWideZone(c);
}

export interface SetupIssue {
  level: 'error' | 'warning';
  text: string;
}

/** Players of a team who may be set up for the Drive. */
export function setupCandidates(s: GameState, team: TeamId): Player[] {
  return s.players.filter((p) => p.team === team && (p.location === 'pitch' || p.location === 'reserves') && !p.benched);
}

/** Check one team's set-up for the Drive (p.47; Blood Bowl Sevens: Spike! 22 p.10). */
export function validateDriveSetup(s: GameState, team: TeamId, opts: { swarming?: number } = {}): SetupIssue[] {
  usePitch(s);
  const out: SetupIssue[] = [];
  const R = rulesFor(s);
  const g = pitch();
  const pg = R.source ? `Sevens p.${R.refs.setup.page}` : 'p.47';
  const cands = setupCandidates(s, team);
  const on = s.players.filter((p) => p.team === team && p.location === 'pitch');
  const extra = opts.swarming ?? s.match?.swarmed?.[team] ?? 0;
  const need = Math.min(R.playersPerDrive, cands.length - extra);
  const name = s.teams[team].name;
  if (on.length !== need + extra) out.push({ level: 'error', text: `${name}: set up ${need} players (${on.length} on the pitch). Teams set up ${R.playersPerDrive} players, or all of them if fewer are available (${pg}).` });
  for (const p of on) {
    if (!p.pos || !inBounds(p.pos)) out.push({ level: 'error', text: `#${p.number} is off the pitch.` });
    else if (!inOwnHalf(team, p.pos)) out.push({ level: 'error', text: R.source ? `#${p.number} is outside your area: set up between your End Zone and your Line of Scrimmage — never in No Man's Land (${pg}).` : `#${p.number} is in the opponent's half: set up in your own half (p.47).` });
    if (p.benched) out.push({ level: 'error', text: `#${p.number} cannot play this Drive (${p.benchedWhy ?? 'Sweltering Heat'}).` });
  }
  // Team Captain (p.155): must be fielded if able.
  const cap = cands.find((p) => p.captain);
  if (cap && cap.location !== 'pitch' && s.teams[team].specialRules?.includes('Team Captain')) out.push({ level: 'error', text: `${name}: the Team Captain #${cap.number} ${cap.name} must be set up if able (p.155).` });
  const los = on.filter((p) => p.pos && onLineOfScrimmageCentre(team, p.pos)).length;
  const rows = `rows ${g.wide + 1}-${g.h - g.wide}`;
  if (need <= 3) {
    if (los < on.length) out.push({ level: 'error', text: `${name} can only field ${need} players: all must be on the Line of Scrimmage in the Centre Field (${R.source ? `${pg}; a coach may instead Concede Without Penalty, which Bloodboard does not offer` : 'p.47'}).` });
  } else if (los < 3) out.push({ level: 'error', text: `${name}: at least 3 players must be on the Line of Scrimmage in the Centre Field (column ${String.fromCharCode(65 + losColumn(team))}, ${rows}) — ${los} there now (${pg}).` });
  const top = on.filter((p) => p.pos && p.pos.y < g.wide).length;
  const bottom = on.filter((p) => p.pos && p.pos.y >= g.h - g.wide).length;
  const max = R.maxPerWideZone;
  if (top > max) out.push({ level: 'error', text: `${name}: ${top} players in the top Wide Zone (rows 1-${g.wide}); at most ${max} (${pg}).` });
  if (bottom > max) out.push({ level: 'error', text: `${name}: ${bottom} players in the bottom Wide Zone (rows ${g.h - g.wide + 1}-${g.h}); at most ${max} (${pg}).` });
  return out;
}

/** Default set-up slots for Team A (x, y); Team B mirrors them. The first three are on the Line of Scrimmage. */
const FORMATION_A: Coord[] = [
  { x: 12, y: 6 },
  { x: 12, y: 7 },
  { x: 12, y: 8 },
  { x: 10, y: 5 },
  { x: 10, y: 9 },
  { x: 9, y: 7 },
  { x: 8, y: 4 },
  { x: 8, y: 10 },
  { x: 7, y: 7 },
  { x: 5, y: 6 },
  { x: 5, y: 8 },
];

/** Sevens default slots for Team A on the 20 × 11 pitch (Line of Scrimmage x = 6, Centre Field rows 3-9). */
const SEVENS_FORMATION_A: Coord[] = [
  { x: 6, y: 4 },
  { x: 6, y: 5 },
  { x: 6, y: 6 },
  { x: 4, y: 3 },
  { x: 4, y: 7 },
  { x: 3, y: 5 },
  { x: 1, y: 5 },
];

/** The set-up slots of `team` for this ruleset (the default formation's squares, in fill order: the first three are the Line of Scrimmage). */
export function formationSlots(s: GameState, team: TeamId): Coord[] {
  usePitch(s);
  const slots = rulesFor(s).variant === 'sevens' ? SEVENS_FORMATION_A : FORMATION_A;
  const w = pitch().w;
  return slots.map((c) => (team === 'A' ? { ...c } : { x: w - 1 - c.x, y: c.y }));
}

/**
 * A legal default set-up (p.47; Sevens p.10) for the players who may set up:
 * 3 on the Line of Scrimmage, the rest behind them, none in the Wide Zones.
 * The coach can change it before confirming.
 */
export function defaultFormation(s: GameState, team: TeamId): Record<string, Coord | null> {
  usePitch(s);
  const slots = rulesFor(s).variant === 'sevens' ? SEVENS_FORMATION_A : FORMATION_A;
  const w = pitch().w;
  let cands = setupCandidates(s, team)
    .slice()
    .sort((a, b) => a.number - b.number);
  // Team Captain (p.155): the Captain must be fielded. Star Players (p.148) are hired for this game, so the default
  // formation fields them too. When there are more candidates than slots, these players take the places of the
  // highest-numbered others (who stay in the Reserves Box); the fielded players keep their number order.
  const capRule = !!s.teams[team].specialRules?.includes('Team Captain');
  if (cands.length > slots.length) {
    const keepers = cands.filter((p) => (capRule && p.captain) || !!p.star).slice(0, slots.length);
    if (keepers.length) {
      const others = cands.filter((p) => !keepers.includes(p));
      const fielded = new Set([...keepers, ...others.slice(0, slots.length - keepers.length)]);
      cands = [...cands.filter((p) => fielded.has(p)), ...cands.filter((p) => !fielded.has(p))];
    }
  }
  const out: Record<string, Coord | null> = {};
  cands.forEach((p, i) => {
    const slot = i < slots.length ? slots[i] : null;
    out[p.id] = slot ? (team === 'A' ? { ...slot } : { x: w - 1 - slot.x, y: slot.y }) : null;
  });
  return out;
}

/** Who may kick (p.47): on the pitch, not on the Line of Scrimmage or in a Wide Zone unless there is no other option. */
export function kickerCandidates(s: GameState, team: TeamId): Player[] {
  const on = pitchPlayers(s, team);
  const good = on.filter((p) => p.pos && p.pos.x !== losColumn(team) && !isWideZone(p.pos));
  return good.length ? good : on;
}

/**
 * Strict check used when a hand-built position is started as a formal match
 * position rather than a practice scenario: the ball must be in play (after
 * a kick-off it is always on the pitch, held or loose, p.49), no team may have
 * more than 11 players on the pitch (p.47 "Too many players"), plus every
 * error of the ordinary position check. Practice scenarios skip this.
 */
export function validateFormalStart(s: GameState): SetupIssue[] {
  const out: SetupIssue[] = validatePosition(s).filter((i) => i.level === 'error' || !/no ball|normally at most 11/.test(i.text));
  if (s.ball.kind === 'none') out.push({ level: 'error', text: 'There is no ball on the pitch. In a match the ball is always in play once it has been kicked off (p.47-49): place the ball (on a player or loose), or start this position as a practice scenario.' });
  const most = rulesFor(s).playersPerDrive;
  for (const t of ['A', 'B'] as TeamId[]) {
    const n = pitchPlayers(s, t).length;
    if (n > most) out.push({ level: 'error', text: `${s.teams[t].name} has ${n} players on the pitch: a team may field at most ${most} (p.47).` });
    if (n === 0) out.push({ level: 'error', text: `${s.teams[t].name} has no players on the pitch.` });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Creating a match
// ---------------------------------------------------------------------------

export interface CreateMatchResult {
  ok: boolean;
  errors: string[];
  state?: GameState;
}

/** V5.5: the mark added to Player 2's team name when both sides use the same saved team (or the same ready-made roster). */
export const MIRROR_MARK = '*';

/**
 * V5.5: Player 2's independent match copy of a saved team that Player 1 also uses: a deep copy with its own team id
 * and player ids, "*" after the name and the team colours inverted (primary and accent swapped). The saved team
 * itself is not touched.
 */
export function mirrorTeamCopy(def: TeamDef): TeamDef {
  const c = JSON.parse(JSON.stringify(def)) as TeamDef;
  c.id = `${def.id}*p2`;
  c.name = def.name.endsWith(MIRROR_MARK) ? def.name : `${def.name}${MIRROR_MARK}`;
  c.color = def.accent;
  c.accent = def.color;
  c.players = c.players.map((p) => ({ ...p, id: `${p.id}*p2` }));
  return c;
}

export function createMatch(kind: MatchKind, a: TeamDef, b: TeamDef, options: MatchOptions, seed?: number): CreateMatchResult {
  const errors: string[] = [];
  // V5.5: the same saved team on both sides — Player 2 plays an independent copy (no "choose two different teams").
  const mirror = a.id === b.id;
  if (mirror) b = mirrorTeamCopy(b);
  // The same colours on both sides (e.g. the same ready-made roster twice): Player 2's colours are inverted.
  else if (a.color === b.color && a.accent === b.accent) b = { ...b, color: a.accent, accent: a.color };
  for (const [t, label] of [
    [a, 'Home team'],
    [b, 'Away team'],
  ] as const) {
    const errs = validateTeamDef(t).filter((i) => i.level === 'error');
    errs.forEach((e) => errors.push(`${label} (${t.name}): ${e.text}`));
    if (kind === 'tournament' && t.kind !== 'tournament') errors.push(`${label} (${t.name}) is a League team; a Tournament / Exhibition match needs two teams built with the tournament template.`);
    if (t.variant === 'sevens' && kind !== 'tournament') errors.push(`${label} (${t.name}) is a Sevens team: Sevens teams play Exhibition matches (Sevens League play is not implemented).`);
  }
  if ((a.variant ?? 'standard') !== (b.variant ?? 'standard')) errors.push('A Blood Bowl Sevens team can only play another Sevens team (and a standard team another standard team).');
  if (errors.length) return { ok: false, errors };
  const variant = a.variant === 'sevens' ? 'sevens' : 'standard';
  usePitch(variant);
  const s = newGame({ a: { name: a.name, roster: a.rosterId }, b: { name: b.name, roster: b.rosterId }, seed });
  if (variant === 'sevens') s.variant = 'sevens';
  s.phase = 'pregame';
  s.weather = 'perfect';
  s.turn.half = 1;
  s.title = `${a.name} v ${b.name}`;
  for (const [id, def] of [
    ['A', a],
    ['B', b],
  ] as const) {
    const t = s.teams[id];
    t.name = def.name;
    t.rosterId = def.rosterId;
    t.color = def.color;
    t.accent = def.accent;
    t.rerolls = def.rerolls;
    const league = teamLeague(def);
    if (league) t.league = league;
    const rules = teamSpecialRules(def);
    if (rules.length) t.specialRules = rules;
    t.score = 0;
    t.turn = 0;
    if (def.apothecary) t.apothecary = 'available';
    for (const pd of def.players) {
      if (pd.unavailable) continue;
      s.players.push({
        id: `${id}${pd.number}`,
        team: id,
        number: pd.number,
        name: pd.name,
        position: pd.position,
        keywords: pd.keywords.slice(),
        ma: pd.ma,
        st: pd.st,
        ag: pd.ag,
        pa: pd.pa,
        av: pd.av,
        skills: pd.skills.map((x) => ({ ...x })),
        location: 'reserves',
        pos: null,
        stance: 'standing',
        distracted: false,
        activated: false,
        usage: {},
        defId: pd.id,
        ...(variant === 'sevens' && pd.veteran ? { veteran: 'ready' as const } : {}),
        ...(pd.captain && rules.includes('Team Captain') ? { captain: true } : {}),
        ...(pd.mercenary ? { mercenary: true } : {}),
        ...(pd.star ? { star: pd.star } : {}),
        ...(pd.journeyman ? { journeyman: true } : {}),
      });
      // Team Captain (p.155): the Captain gains Pro without increasing its cost.
      const np = s.players[s.players.length - 1];
      if (np.captain && !np.skills.some((k) => k.id === 'pro')) np.skills.push({ id: 'pro' });
      // Mercenary Players (p.147): Loner (4+) and their one extra Primary skill.
      if (np.mercenary) {
        if (!np.skills.some((k) => k.id === 'loner')) np.skills.push({ id: 'loner', value: 4 });
        if (pd.mercSkill && !np.skills.some((k) => k.id === pd.mercSkill)) np.skills.push({ id: pd.mercSkill });
      }
      // Tournament (Matched Play) teams: the skill bought with Skill Points (p.112; Sevens Spike! 22 p.19).
      if (pd.boughtSkill && isTournamentTeam(def) && !np.skills.some((k) => k.id === pd.boughtSkill)) np.skills.push({ id: pd.boughtSkill });
    }
    // Leader (p.130): the Leader Re-roll is gained at the start of each half, if a Leader is on the pitch then.
    t.leaderReroll = false;
  }
  // The D6 difficulty house rule exists only in matches against the computer (levels 0-3).
  if (options.difficulty) {
    const lv = (n: unknown) => Math.max(0, Math.min(3, Math.round(Number(n) || 0)));
    const d = options.difficulty;
    options = { ...options };
    if (!options.computer) delete options.difficulty;
    else options.difficulty = { player: lv(d.player), computer: lv(d.computer) };
  }
  // Inducements bought on the Team Draft Lists (pp.141-147).
  const ind = { A: { ...(a.inducements ?? {}) }, B: { ...(b.inducements ?? {}) } };
  for (const t of ['A', 'B'] as TeamId[]) for (const k of Object.keys(ind[t])) if (!ind[t][k]) delete ind[t][k];
  const has = (t: TeamId, id: string) => ind[t][id] ?? 0;
  for (const t of ['A', 'B'] as TeamId[]) {
    // Extra Team Training (p.145): one more Team Re-roll for the game each.
    s.teams[t].rerolls += has(t, 'extraTraining');
  }
  s.match = {
    kind,
    options,
    teamIds: { A: a.id, B: b.id },
    ...(mirror ? { mirror: { team: 'B' as TeamId, of: a.id } } : {}),
    rosterRerolls: { A: a.rerolls + has('A', 'extraTraining'), B: b.rerolls + has('B', 'extraTraining') },
    dedicatedFans: { A: a.dedicatedFans, B: b.dedicatedFans },
    // Part-time Assistant Coaches and Temp Agency Cheerleaders (p.144): for the duration of the game.
    assistantCoaches: { A: a.assistantCoaches + has('A', 'partTimeCoach'), B: b.assistantCoaches + has('B', 'partTimeCoach') },
    cheerleaders: { A: a.cheerleaders + has('A', 'tempCheerleader'), B: b.cheerleaders + has('B', 'tempCheerleader') },
    half: 1,
    drive: 0,
    setupDone: { A: false, B: false },
    // Bribes bought as Inducements (p.144).
    bribes: { A: has('A', 'bribe'), B: has('B', 'bribe') },
    ...(Object.keys(ind.A).length || Object.keys(ind.B).length ? { inducements: ind } : {}),
    coachEjected: { A: false, B: false },
    driveMods: [],
  };
  // Tournament (Matched Play) teams: their Tier and Skill Points, for the record (p.112; Sevens Spike! 22 p.19).
  const matched: NonNullable<MatchState['matched']> = {};
  for (const [t, def] of [['A', a], ['B', b]] as Array<[TeamId, TeamDef]>) {
    if (!isTournamentTeam(def) || !def.tier) continue;
    const u = teamSkillPoints(def);
    matched[t] = { tier: def.tier, allowance: u.allowance, spent: u.spent, skills: def.players.filter((p) => p.boughtSkill).map((p) => `#${p.number} ${p.boughtSkill}`), format: def.variant === 'sevens' ? 'sevens' : 'standard' };
  }
  if (Object.keys(matched).length) s.match.matched = matched;
  // V5.5: League pre-match Inducements (p.94) and All-Star squads (custom Exhibition variant), for the record.
  const pre: NonNullable<MatchState['preMatch']> = {};
  for (const [t, def] of [['A', a], ['B', b]] as Array<[TeamId, TeamDef]>) if (def.preMatch) pre[t] = { ...def.preMatch };
  if (Object.keys(pre).length) s.match.preMatch = pre;
  if (a.allStar || b.allStar) s.match.allStar = { A: a.allStar ? { ...a.allStar } : null, B: b.allStar ? { ...b.allStar } : null };
  return { ok: true, errors: [], state: s };
}

// ---------------------------------------------------------------------------
// Input validation (no dice)
// ---------------------------------------------------------------------------

export function describeMatchInput(s: GameState, input: MatchInput): string {
  switch (input.kind) {
    case 'pregame':
      return 'Pre-game sequence';
    case 'setupTeam':
      return `${s.teams[input.team].name}: set-up for Drive ${s.match?.drive ?? ''}`.trim();
    case 'kickoff': {
      const k = findPlayer(s, input.kicker);
      return `${k ? label(k) : input.kicker} kicks off towards ${fmt(input.target)}`;
    }
    case 'solidDefence':
      return 'Solid Defence set-up';
    case 'quickSnap':
      return s.match?.pendingPhase?.type === 'quickSnap' && s.match.pendingPhase.alert ? 'Alert Defence moves' : 'Quick Snap moves';
    case 'endCharge':
      return 'End the Charge!';
    case 'swarming':
      return `Swarming: ${Object.keys(input.positions).length} more Linemen set up`;
    case 'dwarfenWisdom':
      return `Dwarfen Wisdom: ${Object.keys(input.positions).length} players set up again`;
    case 'weatherMage':
      return `${s.teams[input.team].name}: Weather Mage (${input.modifier >= 0 ? '+' : ''}${input.modifier})`;
    case 'throwARock':
      return `${s.teams[input.team].name}: Throw a Rock`;
    case 'nextDrive':
      return 'End of Drive';
    case 'mvp':
      return `${s.teams[input.team].name}: Most Valuable Player`;
    case 'coachChange': {
      const t = s.teams[input.team]?.name ?? input.team;
      const c = input.coach;
      if (!c) return `${t}: the human coach takes control`;
      const who = `${c.name ?? c.ai}${c.version ? ` ${c.version}` : ''}`;
      if (c.takeover) return `${t}: ${who} takes over (${TAKEOVER_TEXT[c.takeover.mode]})`;
      return `${t}: coached by ${who}`;
    }
  }
}

const TAKEOVER_TEXT = { activation: 'one player activation', turn: 'the rest of this Turn', untilBack: 'until the human coach takes control back' } as const;

/** V5.5: the computer coach of a team now (options.coaches; V5 step 6 saves: options.computer), or null for a human. */
export function coachOf(s: GameState, team: TeamId): CoachRef | null {
  const o = s.match?.options;
  if (!o) return null;
  if (o.coaches) return o.coaches[team] ?? null;
  if (o.computer?.team === team) return { ai: `bloodboard-${o.computer.style ?? 'balanced'}`, ...(o.computer.style ? { style: o.computer.style } : {}) };
  return null;
}

function coachText(c: CoachRef | null): string {
  if (!c) return 'the human coach';
  return `the computer (${c.name ?? c.ai}${c.version ? ` ${c.version}` : ''})`;
}

/** V5.5: change a team's coach (interface input; no dice, no change on the board). */
function coachChange(ctx: Ctx, team: TeamId, coach: CoachRef | null): void {
  const s = ctx.s;
  const o = s.match!.options;
  const before = coachOf(s, team);
  const coaches: Partial<Record<TeamId, CoachRef>> = { ...(o.coaches ?? (o.computer ? { [o.computer.team]: coachOf(s, o.computer.team) as CoachRef } : {})) };
  const id = (s.log[s.log.length - 1]?.id ?? 0) + 1;
  if (coach) {
    const c: CoachRef = { ai: coach.ai };
    if (coach.name) c.name = String(coach.name).slice(0, 100);
    if (coach.version) c.version = String(coach.version).slice(0, 30);
    if (coach.takeover) c.takeover = { mode: coach.takeover.mode, half: (s.match!.half === 2 ? 2 : 1), turn: s.teams[team].turn, since: id };
    coaches[team] = c;
  } else delete coaches[team];
  s.match!.options = { ...o, coaches };
  const t = s.teams[team].name;
  const now = coaches[team] ?? null;
  const text = now?.takeover
    ? `${t}: temporary coaching takeover — ${coachText(now)} coaches the team for ${TAKEOVER_TEXT[now.takeover.mode]}.`
    : before?.takeover && !now
      ? `${t}: the takeover ends — the human coach has control again.`
      : `${t}: coach changed from ${coachText(before)} to ${coachText(now)}. The board, score, Turns, players, re-rolls and rules are unchanged.`;
  ctx.emit('note', text, undefined, { coachChange: true, team, from: before?.ai ?? 'human', to: now?.ai ?? 'human', takeover: now?.takeover?.mode ?? null });
}

export function isMatchInput(input: { kind: string }): input is MatchInput {
  return ['pregame', 'setupTeam', 'kickoff', 'solidDefence', 'quickSnap', 'endCharge', 'nextDrive', 'mvp', 'swarming', 'dwarfenWisdom', 'weatherMage', 'throwARock', 'coachChange'].includes(input.kind);
}

/** Reasons a match input cannot be used now (static checks; dice are never involved). */
export function matchInputReason(s: GameState, input: MatchInput): string | null {
  usePitch(s);
  const m = s.match;
  if (!m) return 'This is not a match: match inputs need a game created from two saved teams.';
  if (s.pending) return 'Finish the pending decision first.';
  switch (input.kind) {
    case 'coachChange': {
      if (input.team !== 'A' && input.team !== 'B') return 'Unknown team.';
      const c = input.coach;
      if (c === null) return null;
      if (!c || typeof c.ai !== 'string' || !c.ai.trim() || c.ai.length > 80) return 'Name the AI file (its id) of the new coach.';
      if (c.takeover) {
        if (!['activation', 'turn', 'untilBack'].includes(c.takeover.mode)) return 'Unknown kind of takeover.';
        if (coachOf(s, input.team)) return 'A takeover is for a team the human coaches.';
        if (c.takeover.mode !== 'untilBack') {
          if (s.phase !== 'play' || m.pendingPhase) return 'A takeover for one activation or the rest of the Turn starts during the team’s own Turn.';
          if (s.turn.active !== input.team) return 'It is not this team’s Turn.';
        }
      }
      return null;
    }
    case 'pregame':
      return s.phase === 'pregame' ? null : 'The pre-game sequence has already been played.';
    case 'setupTeam': {
      if (s.phase !== 'driveSetup') return 'Teams can only set up at the start of a Drive.';
      const kicking = m.kicking as TeamId;
      if (input.team !== kicking && !m.setupDone[kicking]) return 'The kicking team sets up first (p.47).';
      if (m.setupDone[input.team]) return 'This team has already set up for this Drive.';
      const trial = cloneState(s);
      const err = applyPositions(trial, input.team, input.positions);
      if (err) return err;
      const issues = validateDriveSetup(trial, input.team).filter((i) => i.level === 'error');
      return issues.length ? issues.map((i) => i.text).join(' ') : null;
    }
    case 'swarming': {
      const ph = m.pendingPhase;
      if (s.phase !== 'kickoff' || ph?.type !== 'swarming') return 'Swarming is not being resolved.';
      const ids = Object.keys(input.positions);
      if (ids.length > ph.max) return `Swarming: at most ${ph.max} more Linemen may be set up (D3 rolled, p.155).`;
      for (const id of ids) {
        const p = findPlayer(s, id);
        if (!p || p.team !== ph.team) return `Only ${s.teams[ph.team].name} players can be set up now.`;
        if (p.location !== 'reserves' || p.benched) return `#${p.number} is not in the Reserves Box and available.`;
        if (!p.keywords.includes('Lineman')) return `#${p.number} ${p.position} is not a Lineman: Swarming sets up only Lineman players (p.155).`;
      }
      const trial = cloneState(s);
      const current: Record<string, Coord | null> = {};
      for (const p of pitchPlayers(trial, ph.team)) current[p.id] = p.pos;
      const err = applyPositions(trial, ph.team, { ...current, ...input.positions });
      if (err) return err;
      const issues = validateDriveSetup(trial, ph.team, { swarming: (m.swarmed?.[ph.team] ?? 0) + ids.length }).filter((i) => i.level === 'error');
      return issues.length ? issues.map((i) => i.text).join(' ') : null;
    }
    case 'dwarfenWisdom': {
      const ph = m.pendingPhase;
      if (s.phase !== 'kickoff' || ph?.type !== 'dwarfenWisdom') return 'Dwarfen Wisdom is not being used.';
      const moved = Object.keys(input.positions).filter((id) => !eq(findPlayer(s, id)?.pos, input.positions[id]));
      if (moved.length > ph.max) return `Dwarfen Wisdom: at most ${ph.max} players may be set up again (D3 rolled, p.147).`;
      for (const id of moved) {
        const p = findPlayer(s, id);
        if (!p || p.team !== ph.team || p.location !== 'pitch') return `Only ${s.teams[ph.team].name} players on the pitch can be set up again.`;
      }
      const trial = cloneState(s);
      const current: Record<string, Coord | null> = {};
      for (const p of pitchPlayers(trial, ph.team)) current[p.id] = p.pos;
      const err = applyPositions(trial, ph.team, { ...current, ...input.positions });
      if (err) return err;
      const issues = validateDriveSetup(trial, ph.team).filter((i) => i.level === 'error');
      return issues.length ? issues.map((i) => i.text).join(' ') : null;
    }
    case 'weatherMage': {
      if (s.phase !== 'play' || m.pendingPhase) return 'The Weather Mage is used at the start of one of your Turns (p.144).';
      if (s.turn.active !== input.team) return "It is not this team's Turn.";
      if (induceLeft(s, input.team, 'weatherMage') < 1) return `${s.teams[input.team].name} have no Weather Mage to use (once per game, p.144).`;
      if (s.turn.activation || s.players.some((p) => p.team === input.team && p.activated)) return 'The Weather Mage is used at the start of a Turn, before any player is activated (p.144).';
      if (!Number.isInteger(input.modifier) || input.modifier < -2 || input.modifier > 2) return 'The Weather Mage applies a modifier from −2 to +2 (p.144).';
      return null;
    }
    case 'throwARock':
      return throwARockReason(s, input.team);
    case 'kickoff': {
      if (s.phase === 'kickoff' && m.pendingPhase?.type === 'swarming') return 'Swarming first: the extra Linemen are set up before the kick (p.155).';
      if (s.phase === 'kickoff' && m.pendingPhase?.type === 'dwarfenWisdom') return 'Dwarfen Wisdom first: the players are set up again before the kick (p.147).';
      if (s.phase !== 'kickoff' || m.kick) return 'The ball can only be kicked once both teams have set up.';
      const kicking = m.kicking as TeamId;
      const kicker = findPlayer(s, input.kicker);
      if (!kicker || !kickerCandidates(s, kicking).some((p) => p.id === kicker.id)) return 'Nominate a kicking player who is on the pitch, not on the Line of Scrimmage and not in a Wide Zone (unless there is no other option, p.47).';
      if (!inBounds(input.target) || !inOwnHalf(other(kicking), input.target)) return rulesFor(s).source ? "The kick must target a square in the receiving team's area, between its End Zone and its Line of Scrimmage (p.47; see docs/SEVENS_RULES.md, interpretation 1)." : "The kick must target a square in the opponent's half (p.47).";
      if (input.useKick && !hasSkill(kicker, 'kick')) return 'Only a kicker with the Kick skill can Deviate D3 squares (p.130).';
      return null;
    }
    case 'solidDefence': {
      const ph = m.pendingPhase;
      if (s.phase !== 'kickoff' || ph?.type !== 'solidDefence') return 'Solid Defence is not being resolved.';
      const moved = Object.keys(input.positions).filter((id) => {
        const p = findPlayer(s, id);
        const to = input.positions[id];
        return !p || !eq(p.pos, to);
      });
      if (moved.length > ph.max) return `Solid Defence: at most ${ph.max} players may be set up again.`;
      for (const id of moved) {
        const p = findPlayer(s, id);
        if (!p || p.team !== ph.team || p.location !== 'pitch') return 'Only players of the kicking team on the pitch can be set up again.';
        if (!isOpen(s, p)) return `#${p.number} is not Open (an opposition player is Marking them), so they cannot be selected (p.48).`;
        if (input.positions[id] === null) return 'Players selected for Solid Defence must be set up again on the pitch.';
      }
      const trial = cloneState(s);
      const current: Record<string, Coord | null> = {};
      for (const p of pitchPlayers(trial, ph.team)) current[p.id] = p.pos;
      const err = applyPositions(trial, ph.team, { ...current, ...input.positions });
      if (err) return err;
      const issues = validateDriveSetup(trial, ph.team).filter((i) => i.level === 'error');
      return issues.length ? issues.map((i) => i.text).join(' ') : null;
    }
    case 'quickSnap': {
      const ph = m.pendingPhase;
      if (s.phase !== 'kickoff' || ph?.type !== 'quickSnap') return 'Quick Snap is not being resolved.';
      const what = ph.alert ? 'Alert Defence' : 'Quick Snap';
      const ids = Object.keys(input.moves);
      if (ids.length > ph.max) return `${what}: at most ${ph.max} players may move.`;
      const trial = cloneState(s);
      for (const id of ids) {
        const p = findPlayer(trial, id);
        const to = input.moves[id];
        if (!p || p.team !== ph.team || p.location !== 'pitch' || !p.pos) return `Only ${ph.alert ? 'kicking' : 'receiving'} players on the pitch can move.`;
        if (!isOpen(s, findPlayer(s, id) as Player)) return `#${p.number} is not Open, so they cannot be selected (p.48).`;
        if (!inBounds(to) || !adjacent(p.pos, to)) return `#${p.number} may only move one square.`;
        if (playerAt(trial, to)) return `${fmt(to)} is occupied.`;
        p.pos = { ...to };
      }
      return null;
    }
    case 'endCharge':
      return m.pendingPhase?.type === 'charge' ? null : 'No Charge! is in progress.';
    case 'nextDrive':
      return s.phase === 'touchdown' || s.phase === 'halfOver' ? null : 'The Drive has not ended yet.';
    case 'mvp': {
      if (m.kind !== 'league') return 'Only League matches award Star Player Points, so there is no MVP roll (p.96).';
      if (s.phase !== 'fullTime') return 'The Most Valuable Player is chosen after the final whistle (p.96).';
      if (input.team !== 'A' && input.team !== 'B') return 'Unknown team.';
      if (m.mvp?.[input.team]) return `${s.teams[input.team].name} have already rolled for their MVP.`;
      const ids = input.nominees ?? [];
      if (!ids.length || ids.length > 6) return 'Nominate one to six players (p.96).';
      if (new Set(ids).size !== ids.length) return 'Each player can be nominated once.';
      const played = mvpEligible(s, input.team).map((p) => p.id);
      const bad = ids.find((id) => !played.includes(id));
      if (bad) return `${findPlayer(s, bad) ? label(findPlayer(s, bad) as Player) : bad} cannot be nominated: only players of this team who played in the match can be the MVP (p.96).`;
      return null;
    }
  }
  return 'Unknown input.';
}

/** Place a team according to `positions` (players not listed go to the Reserves Box). Returns an error text or null. */
function applyPositions(s: GameState, team: TeamId, positions: Record<string, Coord | null>): string | null {
  const taken = new Set<string>();
  for (const p of s.players) if (p.team !== team && p.location === 'pitch' && p.pos) taken.add(`${p.pos.x},${p.pos.y}`);
  for (const id of Object.keys(positions)) {
    const p = findPlayer(s, id);
    if (!p || p.team !== team) return `Unknown player ${id} for ${s.teams[team].name}.`;
    if (positions[id] && !(p.location === 'pitch' || p.location === 'reserves')) return `#${p.number} is not available (${p.location}).`;
    if (positions[id] && p.benched) return `#${p.number} cannot be set up this Drive (${p.benchedWhy ?? 'Sweltering Heat'}).`;
  }
  for (const p of s.players) {
    if (p.team !== team || !(p.location === 'pitch' || p.location === 'reserves')) continue;
    const to = positions[p.id];
    if (!to) {
      p.location = 'reserves';
      p.pos = null;
      continue;
    }
    if (!inBounds(to)) return `${fmt(to)} is off the pitch.`;
    const k = `${to.x},${to.y}`;
    if (taken.has(k)) return `Two players cannot share ${fmt(to)}.`;
    taken.add(k);
    p.location = 'pitch';
    p.pos = { ...to };
    p.stance = 'standing';
    p.distracted = false;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function resolveMatchInput(ctx: Ctx, input: MatchInput): void {
  const s = ctx.s;
  const why = matchInputReason(s, input);
  if (why) throw new IllegalAction(why);
  switch (input.kind) {
    case 'pregame':
      return pregame(ctx);
    case 'setupTeam':
      return setupTeam(ctx, input.team, input.positions);
    case 'kickoff':
      return kickoff(ctx, input.kicker, input.target, !!input.useKick);
    case 'solidDefence':
      return solidDefence(ctx, input.positions);
    case 'quickSnap':
      return quickSnap(ctx, input.moves);
    case 'endCharge':
      return endCharge(ctx, 'the kicking coach ends the Charge');
    case 'swarming':
      return swarming(ctx, input.positions);
    case 'dwarfenWisdom':
      return dwarfenWisdom(ctx, input.positions);
    case 'weatherMage':
      return weatherMage(ctx, input.team, input.modifier);
    case 'throwARock':
      return throwARock(ctx, input.team);
    case 'nextDrive':
      return nextDrive(ctx);
    case 'mvp':
      return rollMvp(ctx, input.team, input.nominees);
    case 'coachChange':
      return coachChange(ctx, input.team, input.coach);
  }
}

/** MVP (p.96): the nominees are numbered 1-6 in order; a D6 picks one (a number without a nominee is rolled again). */
function rollMvp(ctx: Ctx, team: TeamId, nominees: string[]): void {
  const s = ctx.s;
  const m = s.match!;
  const rule = { page: 96, title: 'Most Valuable Player' };
  ctx.emit('declare', `${s.teams[team].name} nominate for MVP: ${nominees.map((id, i) => `${i + 1} ${label(getPlayer(s, id))}`).join(', ')}.`, rule, { team, nominees });
  for (let guard = 0; guard < 100; guard++) {
    const n = d(ctx, 6);
    if (n <= nominees.length) {
      const p = getPlayer(s, nominees[n - 1]);
      m.mvp = { ...(m.mvp ?? {}), [team]: p.id };
      ctx.emit('roll', `MVP roll: ${n} — ${label(p)} is ${s.teams[team].name}'s Most Valuable Player.`, rule, { team, playerId: p.id, roll: n });
      awardSpp(ctx, p, 'mvp');
      return;
    }
    ctx.emit('roll', `MVP roll: ${n} — no player has that number; roll again.`, rule, { team, roll: n });
  }
}

const WEATHER_NAME: Record<Weather, string> = { swelteringHeat: 'Sweltering Heat', verySunny: 'Very Sunny', perfect: 'Perfect Conditions', pouringRain: 'Pouring Rain', blizzard: 'Blizzard' };

function weatherFor(total: number): Weather {
  if (total <= 2) return 'swelteringHeat';
  if (total === 3) return 'verySunny';
  if (total <= 10) return 'perfect';
  if (total === 11) return 'pouringRain';
  return 'blizzard';
}

/**
 * One die. `by`: the coach who rolls it; unset = a neutral roll. Every D6 rolled here by a coach is one where a
 * higher result is better for that coach (roll-offs, Cheering Fans, Brilliant Coaching, Dodgy Snack and Pitch
 * Invasion — the lowest is affected —, Argue the Call, Bribes, recovering Knocked-out players), so the difficulty
 * house rule judges it that way; other dice (D3, D8, random picks) are neutral.
 */
function d(ctx: Ctx, sides: number, by?: TeamId): number {
  return ctx.roll({ dice: [sides], interpret: ([n]) => n, cacheKey: `die${sides}`, by: sides === 6 ? by : undefined, ...(sides === 6 && by ? { judge: (n: number) => (n - 3.5) / 2.5 } : {}) }).value;
}

function rollWeather(ctx: Ctx, why: string): Weather {
  const r = ctx.roll({ dice: [6, 6], interpret: ([a, b]) => a + b, cacheKey: 'weather2d6' });
  const w = weatherFor(r.value);
  ctx.s.weather = w;
  ctx.emit('roll', `${why}: 2D6 ${r.faces[0]}+${r.faces[1]}=${r.value} — ${WEATHER_NAME[w]}.`, MATCH_RULES.weather, { weather: w });
  return w;
}

function pregame(ctx: Ctx): void {
  const s = ctx.s;
  const m = s.match!;
  // The optional difficulty house rule (V5.5): recorded in the log at the start of the match.
  const dif = m.options.computer && m.options.difficulty;
  if (dif && (dif.player || dif.computer)) {
    const names = ['Off', 'Slight', 'Moderate', 'Strong'];
    ctx.emit('note', `House rule (not Blood Bowl rules): difficulty — human side ${names[dif.player] ?? dif.player}, computer side (${s.teams[m.options.computer!.team].name}) ${names[dif.computer] ?? dif.computer}. Every consequential roll is weighed by who its result helps; neutral rolls are unchanged; the previews use the same odds.`, undefined, { houseRule: 'difficulty', player: dif.player, computer: dif.computer });
  }
  // Prayers to Nuffle (p.143): a D16 each, rolled now; their effects last for the game.
  for (const t of ['A', 'B'] as TeamId[]) {
    const k = induced(s, t, 'prayer');
    if (k) rollPrayers(ctx, t, k);
  }
  // Riotous Rookies (p.145): 2D3+1 Journeymen (roster Linemen with Loner (4+)) join the team for this game.
  for (const t of ['A', 'B'] as TeamId[]) {
    if (!induced(s, t, 'riotousRookies')) continue;
    const r = ROSTER_BY_ID[s.teams[t].rosterId ?? ''];
    const pos = r?.positions.find((x) => x.keywords.includes('Lineman') && x.qty.endsWith('16')) ?? r?.positions.find((x) => x.keywords.includes('Lineman'));
    if (!pos) continue;
    const a = d(ctx, 3, t);
    const b = d(ctx, 3, t);
    const n = a + b + 1;
    const added: string[] = [];
    for (let i = 0; i < n; i++) {
      const used = new Set(s.players.filter((q) => q.team === t).map((q) => q.number));
      let num = 1;
      while (used.has(num)) num++;
      const np = playerFromPosition(s, t, pos, null, num);
      np.location = 'reserves';
      np.journeyman = true;
      if (!np.skills.some((k) => k.id === 'loner')) np.skills.push({ id: 'loner', value: 4 });
      s.players.push(np);
      added.push(`#${num}`);
    }
    ctx.emit('roll', `Riotous Rookies (${s.teams[t].name}): 2D3+1 = ${a}+${b}+1 = ${n} Journeymen ${pos.name}s (Loner (4+)) join for this game: ${added.join(', ')}.`, INDUCE_RULE('riotousRookies'), { team: t });
  }
  // Blood Bowl Sevens Desperate Measures (Spike! 22 p.15): a D8 each; Magic Scroll at once, Hangover now or never.
  for (const t of ['A', 'B'] as TeamId[]) {
    const k = induced(s, t, 'desperateMeasure');
    if (k) rollDesperate(ctx, t, k);
  }
  for (const t of ['A', 'B'] as TeamId[]) askHangover(ctx, t);
  if (m.options.rules === 'full') {
    const ff = { A: 0, B: 0 };
    for (const t of ['A', 'B'] as TeamId[]) {
      const d3 = d(ctx, 3);
      ff[t] = d3 + m.dedicatedFans[t];
      ctx.emit('roll', `${s.teams[t].name} Fan Factor: D3 ${d3} Fair-weather Fans + ${m.dedicatedFans[t]} Dedicated Fans = ${ff[t]}.`, MATCH_RULES.fans, { team: t });
    }
    m.fanFactor = ff;
    rollWeather(ctx, 'Weather');
  } else {
    m.fanFactor = undefined; // equal Fan Factor (p.44)
    s.weather = 'perfect';
    ctx.emit('note', 'Introductory rules (p.44): equal Fan Factor, Perfect Conditions and no Kick-off Events.', MATCH_RULES.structure);
  }
  // Roll-off (p.33, p.46): re-roll ties; the winner chooses to kick or receive.
  let winner: TeamId | null = null;
  for (let i = 0; i < 50 && !winner; i++) {
    const a = d(ctx, 6, 'A');
    const b = d(ctx, 6, 'B');
    ctx.emit('roll', `Roll-off for the kicking team: ${s.teams.A.name} ${a}, ${s.teams.B.name} ${b}${a === b ? ' — tie, roll again' : ''}.`, MATCH_RULES.kicking);
    if (a !== b) winner = a > b ? 'A' : 'B';
  }
  const w = winner ?? 'A';
  const choice = ctx.ask({
    type: 'kickOrReceive',
    team: w,
    prompt: `${s.teams[w].name} won the roll-off. Kick (defence) or receive (offence)?`,
    options: [
      { id: 'receive', label: 'Receive the ball' },
      { id: 'kick', label: 'Kick off' },
    ],
    rule: MATCH_RULES.kicking,
  });
  m.kicking = choice === 'kick' ? w : other(w);
  m.receivedFirst = other(m.kicking);
  m.half = 1;
  s.turn.half = 1;
  m.drive = 1;
  m.setupDone = { A: false, B: false };
  m.swarmed = undefined;
  m.wisdomAsked = undefined;
  s.turn.active = m.kicking;
  s.phase = 'driveSetup';
  ctx.emit('note', `${s.teams[m.kicking].name} kick off; ${s.teams[m.receivedFirst].name} receive. Set up, starting with the kicking team (p.47).`, MATCH_RULES.setup);
}

function setupTeam(ctx: Ctx, team: TeamId, positions: Record<string, Coord | null>): void {
  const s = ctx.s;
  const m = s.match!;
  const err = applyPositions(s, team, positions);
  if (err) throw new IllegalAction(err);
  m.setupDone[team] = true;
  const n = pitchPlayers(s, team).length;
  ctx.emit('note', `${s.teams[team].name} set up ${n} players for Drive ${m.drive}.`, rulesFor(s).source ? rulesFor(s).refs.setup : MATCH_RULES.setup, { team });
  if (m.setupDone.A && m.setupDone.B) {
    s.phase = 'kickoff';
    s.turn.active = m.kicking as TeamId;
    const kicking = m.kicking as TeamId;
    const swarmers = [kicking, other(kicking)].filter((t) => swarmingCandidates(s, t).length > 0);
    if (swarmers.length) return startSwarming(ctx, swarmers[0], swarmers[1]);
    afterSetups(ctx);
  }
}

/**
 * After the set-ups (and Swarming): Josef Bugman's Dwarfen Wisdom (p.147) for a team that still has it
 * (kicking team first), then the kick-off.
 */
function afterSetups(ctx: Ctx): void {
  const s = ctx.s;
  const m = s.match!;
  const kicking = m.kicking as TeamId;
  for (const t of [kicking, other(kicking)]) {
    if (induceLeft(s, t, 'josefBugman') < 1 || m.wisdomAsked?.includes(t)) continue;
    m.wisdomAsked = [...(m.wisdomAsked ?? []), t];
    const c = ctx.ask({
      type: 'dwarfenWisdom',
      team: t,
      prompt: `Josef Bugman's Dwarfen Wisdom (once per game): remove D3 of your players from the pitch and set them up again now?`,
      options: [
        { id: 'no', label: 'Not this Drive' },
        { id: 'use', label: 'Use Dwarfen Wisdom (D3 players)' },
      ],
      rule: INDUCE_RULE('josefBugman'),
    });
    if (c === 'use') {
      spendInduce(s, t, 'josefBugman');
      const n = d(ctx, 3, t);
      m.pendingPhase = { type: 'dwarfenWisdom', team: t, max: n };
      s.turn.active = t;
      ctx.emit('roll', `Dwarfen Wisdom: ${s.teams[t].name} roll a D3: ${n} — up to ${n} player${n === 1 ? '' : 's'} may be set up again.`, INDUCE_RULE('josefBugman'), { team: t });
      return;
    }
  }
  s.turn.active = kicking;
  ctx.emit('note', `${s.teams[kicking].name}: nominate a kicker and place the kick in the opponent's half (p.47).`, MATCH_RULES.kickoff);
}

function dwarfenWisdom(ctx: Ctx, positions: Record<string, Coord>): void {
  const s = ctx.s;
  const m = s.match!;
  const ph = m.pendingPhase as { type: 'dwarfenWisdom'; team: TeamId; max: number };
  const current: Record<string, Coord | null> = {};
  for (const p of pitchPlayers(s, ph.team)) current[p.id] = p.pos;
  const moved = Object.keys(positions).filter((id) => !eq(findPlayer(s, id)?.pos, positions[id]));
  const err = applyPositions(s, ph.team, { ...current, ...positions });
  if (err) throw new IllegalAction(err);
  ctx.emit('move', `Dwarfen Wisdom: ${s.teams[ph.team].name} set up ${moved.length} player${moved.length === 1 ? '' : 's'} again.`, INDUCE_RULE('josefBugman'), { team: ph.team });
  m.pendingPhase = undefined;
  afterSetups(ctx);
}

/** Throw a Rock (Prayer to Nuffle 14, p.143): a random opposition player on the pitch; D6 4+ Knocked Down. */
function throwARock(ctx: Ctx, team: TeamId): void {
  const s = ctx.s;
  spendInduce(s, team, 'throwARock');
  s.turn.betweenTurns = false;
  const opp = pitchPlayers(s, other(team)).sort((a, b) => a.number - b.number);
  const pick = opp.length === 1 ? 1 : ctx.roll({ dice: [opp.length], interpret: ([n]) => n, by: team }).value;
  const p = opp[pick - 1];
  const r = ctx.roll({ dice: [6], interpret: ([n]) => (n >= 4 ? 'S' : 'F'), cacheKey: 'rock4', by: team, judge: (v) => (v === 'S' ? 1 : -1) });
  ctx.emit('roll', `Throw a Rock (${s.teams[team].name}): D${opp.length} ${pick} — ${label(p)}; D6 ${r.faces[0]} — ${r.value === 'S' ? 'the rock hits: Knocked Down' : 'it misses'}.`, PRAYER_RULE, { playerId: p.id });
  if (r.value === 'S' && p.stance === 'standing') goDown(ctx, p, { kind: 'knockedDown', reason: 'Throw a Rock', noTurnover: true });
}

/** Weather Mage (p.144): 2D6 + modifier on the Weather Table; lasts until the next Changing Weather. */
function weatherMage(ctx: Ctx, team: TeamId, mod: number): void {
  const s = ctx.s;
  spendInduce(s, team, 'weatherMage');
  s.turn.betweenTurns = false;
  const r = ctx.roll({ dice: [6, 6], interpret: ([a, b]) => a + b, cacheKey: 'weather2d6' });
  const total = Math.max(2, Math.min(12, r.value + mod));
  const w = weatherFor(total);
  s.weather = w;
  ctx.emit('roll', `Weather Mage (${s.teams[team].name}): 2D6 ${r.faces[0]}+${r.faces[1]}${mod ? ` ${mod > 0 ? '+' : '−'}${Math.abs(mod)}` : ''} = ${total} — ${WEATHER_NAME[w]}.`, INDUCE_RULE('weatherMage'), { weather: w });
}

export const SWARMING_RULE = { page: 155, title: 'Swarming' };

/** Swarming (p.155): the Lineman players of `team` who could be set up as extra players now. */
export function swarmingCandidates(s: GameState, team: TeamId): Player[] {
  if (!s.match || !s.teams[team].specialRules?.includes('Swarming')) return [];
  return s.players.filter((p) => p.team === team && p.location === 'reserves' && !p.benched && p.keywords.includes('Lineman'));
}

function startSwarming(ctx: Ctx, team: TeamId, next?: TeamId): void {
  const s = ctx.s;
  const m = s.match!;
  const n = d(ctx, 3, team);
  const max = Math.min(n, swarmingCandidates(s, team).length);
  m.pendingPhase = { type: 'swarming', team, max, ...(next ? { next } : {}) };
  s.turn.active = team;
  ctx.emit('roll', `Swarming: ${s.teams[team].name} roll a D3: ${n} — up to ${max} more Lineman player${max === 1 ? '' : 's'} may be set up from the Reserves Box.`, SWARMING_RULE, { team });
}

function swarming(ctx: Ctx, positions: Record<string, Coord>): void {
  const s = ctx.s;
  const m = s.match!;
  const ph = m.pendingPhase as { type: 'swarming'; team: TeamId; max: number; next?: TeamId };
  const current: Record<string, Coord | null> = {};
  for (const p of pitchPlayers(s, ph.team)) current[p.id] = p.pos;
  const err = applyPositions(s, ph.team, { ...current, ...positions });
  if (err) throw new IllegalAction(err);
  const ids = Object.keys(positions);
  m.swarmed = { ...(m.swarmed ?? {}), [ph.team]: (m.swarmed?.[ph.team] ?? 0) + ids.length };
  ctx.emit('move', `Swarming: ${s.teams[ph.team].name} set up ${ids.length} more Lineman player${ids.length === 1 ? '' : 's'}${ids.length ? ` (${ids.map((id) => `${label(getPlayer(s, id))} in ${fmt(positions[id])}`).join(', ')})` : ''} — ${pitchPlayers(s, ph.team).length} on the pitch.`, SWARMING_RULE, { team: ph.team });
  m.pendingPhase = undefined;
  if (ph.next && swarmingCandidates(s, ph.next).length) return startSwarming(ctx, ph.next);
  afterSetups(ctx);
}

/**
 * A legal Swarming set-up for `team` (the computer's choice and the interface's default): up to the
 * allowed number of Linemen from the Reserves Box, one or two squares behind the Line of Scrimmage,
 * central rows first, never breaking the Wide Zone limit.
 */
export function defaultSwarming(s: GameState, team: TeamId): Record<string, Coord> {
  usePitch(s);
  const ph = s.match?.pendingPhase;
  if (ph?.type !== 'swarming' || ph.team !== team) return {};
  const g = pitch();
  const R = rulesFor(s);
  const los = losColumn(team);
  const dir = team === 'A' ? -1 : 1;
  const trial = cloneState(s);
  const out: Record<string, Coord> = {};
  const cands = swarmingCandidates(s, team).slice(0, ph.max);
  const midY = Math.floor(g.h / 2);
  const squares: Coord[] = [];
  for (let back = 1; back < g.w; back++) {
    const x = los + dir * back;
    if (x < 0 || x >= g.w) break;
    const ys = Array.from({ length: g.h }, (_, y) => y).sort((a, b) => Math.abs(a - midY) - Math.abs(b - midY));
    for (const y of ys) squares.push({ x, y });
  }
  for (const p of cands) {
    const sq = squares.find((c) => {
      if (!inOwnHalf(team, c) || playerAt(trial, c)) return false;
      const wide = c.y < g.wide ? 'top' : c.y >= g.h - g.wide ? 'bottom' : null;
      if (wide) {
        const n = pitchPlayers(trial, team).filter((q) => q.pos && (wide === 'top' ? q.pos.y < g.wide : q.pos.y >= g.h - g.wide)).length;
        if (n >= R.maxPerWideZone) return false;
      }
      return true;
    });
    if (!sq) break;
    out[p.id] = sq;
    const tp = getPlayer(trial, p.id);
    tp.location = 'pitch';
    tp.pos = { ...sq };
  }
  return out;
}

function deviate(from: Coord, dir: number, distance: number): Coord | null {
  let cur = from;
  for (let i = 0; i < distance; i++) {
    cur = add(cur, D8_DIRS[dir]);
    if (!inBounds(cur)) return null;
  }
  return cur;
}

function kickoff(ctx: Ctx, kickerId: string, target: Coord, useKick: boolean): void {
  const s = ctx.s;
  const m = s.match!;
  const kicking = m.kicking as TeamId;
  const kicker = getPlayer(s, kickerId);
  // Sevens Desperate Measure You Dope! (Spike! 22 p.15): after both teams have set up, before the kick-off happens.
  askYouDope(ctx);
  for (const p of s.players) if (p.location === 'pitch') p.inDrive = true;
  // Who played in the match (MVP nominees, p.96).
  m.played = [...new Set([...(m.played ?? []), ...s.players.filter((p) => p.location === 'pitch').map((p) => p.id)])];
  // Start of a half (its first Drive: no Turn played yet): Leader Re-rolls (p.130).
  if (s.teams.A.turn === 0 && s.teams.B.turn === 0) {
    for (const t of ['A', 'B'] as TeamId[]) {
      const leaders = pitchPlayers(s, t).filter((p) => hasSkill(p, 'leader'));
      s.teams[t].leaderReroll = leaders.length > 0;
      if (leaders.length) ctx.emit('note', `${s.teams[t].name} gain a Leader Re-roll for this half (${leaders.map((p) => label(p)).join(', ')} on the pitch).`, { page: 130, title: 'Leader' }, { team: t });
      // Team Mascot (p.144): an extra Team Re-roll each half (a D6 4+ is needed to use it).
      if (induced(s, t, 'teamMascot')) {
        s.teams[t].mascotReroll = true;
        ctx.emit('note', `${s.teams[t].name}: the Team Mascot's Team Re-roll is available this half (roll 4+ to use it).`, INDUCE_RULE('teamMascot'), { team: t });
      }
    }
    // Halfling Master Chef (p.146): 3D6 at the start of each half; each 4+ takes a Team Re-roll from the opponent for the half.
    for (const t of ['A', 'B'] as TeamId[]) {
      if (!induced(s, t, 'halflingMasterChef')) continue;
      const o = other(t);
      const r = ctx.roll({ dice: [6, 6, 6], interpret: (f) => f.filter((x) => x >= 4).length, cacheKey: 'chef3d6', by: t, judge: (k) => (k - 1.5) / 1.5 });
      const k = r.value;
      const lose = Math.min(k, Math.max(0, s.teams[o].rerolls - (s.teams[o].bonusRerolls ?? 0)));
      s.teams[t].rerolls += k;
      s.teams[o].rerolls -= lose;
      ctx.emit('roll', `Halfling Master Chef (${s.teams[t].name}): 3D6 ${r.faces.join(', ')} — ${k} × 4+: ${s.teams[t].name} gain ${k} Team Re-roll${k === 1 ? '' : 's'} for the half${lose ? `, ${s.teams[o].name} lose ${lose}` : ''} (${s.teams[t].rerolls} v ${s.teams[o].rerolls}).`, INDUCE_RULE('halflingMasterChef'), { team: t });
    }
  }
  s.turn.active = kicking;
  s.ball = { kind: 'none' };
  ctx.emit('declare', `${label(kicker)} kicks off towards ${fmt(target)}${useKick ? ' (Kick: the ball Deviates D3 squares)' : ''}.`, MATCH_RULES.kickoff, { target });
  // Blood Bowl Sevens (Spike! 22 p.10): the distance is the lower of two D6. Kick (p.130) replaces the distance roll with a D3.
  const lower2 = !useKick && rulesFor(s).kickDistance === 'lowerOf2d6';
  const r = lower2
    ? ctx.roll({ dice: [8, 6, 6], interpret: ([dir, a, b]) => ({ dir, n: Math.min(a, b) }), cacheKey: 'deviate2d6low' })
    : ctx.roll({ dice: [8, useKick ? 3 : 6], interpret: ([dir, n]) => ({ dir, n }), cacheKey: `deviate${useKick ? 3 : 6}` });
  const landing = deviate(target, r.value.dir, r.value.n);
  const dist = lower2 ? `2D6 ${r.faces[1]}, ${r.faces[2]} (the lower: ${r.value.n})` : `${useKick ? 'D3' : 'D6'} ${r.value.n}`;
  ctx.emit('ball', `The kick Deviates: D8 ${r.value.dir}, ${dist} → ${landing ? fmt(landing) : 'off the pitch'}.`, lower2 ? rulesFor(s).refs.kickoff : MATCH_RULES.kickoff, { landing });
  m.kick = { kicker: kicker.id, target, landing, scatterInAir: false };
  // On the Ball (p.132): after the Deviation, before the Kick-off Event; not when the kick causes a Touchback.
  const receiving = other(kicking);
  // V5.5: the receiving team's half of the pitch — in Sevens this includes its side of No Man's Land (see inPitchHalf),
  // unless the match uses the optional NAF recommendation (its own area only).
  const otbArea = s.variant === 'sevens' && m.options.sevensOnTheBall === 'ownArea' ? (c: { x: number }) => inTeamArea(receiving, c.x) : (c: { x: number }) => inPitchHalf(receiving, c.x);
  if (landing && kickLands(kicking, landing)) onTheBallKickoff(ctx, receiving, otbArea);
  if (m.options.rules === 'full') kickoffEvent(ctx);
  if (!m.pendingPhase) landKick(ctx);
}

/**
 * The kicked ball may come down here without a Touchback: on the pitch and not in the kicking team's own
 * area (p.49 "in the opposition half"; Sevens p.10: a ball in No Man's Land is not a Touchback — only
 * leaving the pitch or crossing the kicking team's Line of Scrimmage is).
 */
export function kickLands(kicking: TeamId, c: Coord | null): c is Coord {
  return !!c && inBounds(c) && !inOwnHalf(kicking, c);
}

const EVENT_NAMES: Record<number, string> = {
  2: 'Get the Ref',
  3: 'Time-out',
  4: 'Solid Defence',
  5: 'High Kick',
  6: 'Cheering Fans',
  7: 'Brilliant Coaching',
  8: 'Changing Weather',
  9: 'Quick Snap',
  10: 'Charge!',
  11: 'Dodgy Snack',
  12: 'Pitch Invasion',
};

function kickoffEvent(ctx: Ctx): void {
  const s = ctx.s;
  const m = s.match!;
  const kicking = m.kicking as TeamId;
  const receiving = other(kicking);
  const r = ctx.roll({ dice: [6, 6], interpret: ([a, b]) => a + b, cacheKey: 'kickoff2d6' });
  const n = r.value;
  const RS = rulesFor(s);
  const name = n === 4 && RS.event4 === 'alertDefence' ? 'Alert Defence' : EVENT_NAMES[n];
  m.kickoffEvent = { roll: n, name };
  const rule = RS.refs.events;
  ctx.emit('roll', `Kick-off Event: 2D6 ${r.faces[0]}+${r.faces[1]}=${n} — ${name}${RS.source ? ' (Sevens table)' : ''}.`, rule, { event: n });
  const both = (label2: string, bonus: (t: TeamId) => number): TeamId[] => {
    const a = d(ctx, 6, 'A') + bonus('A');
    const b = d(ctx, 6, 'B') + bonus('B');
    ctx.emit('roll', `${label2}: ${s.teams.A.name} ${a}, ${s.teams.B.name} ${b}.`, rule);
    return a === b ? ['A', 'B'] : [a > b ? 'A' : 'B'];
  };
  switch (n) {
    case 2:
      m.bribes.A += 1;
      m.bribes.B += 1;
      ctx.emit('note', 'Each team receives a free Bribe (usable when a player is Sent-off; in this version only Secret Weapons are Sent-off, at the end of a Drive).', rule);
      break;
    case 3: {
      // Standard: back on turn 6, 7 or 8 (p.48); Sevens: on turn 5 or 6 (Spike! 22 p.11).
      const back = s.teams[kicking].turn >= RS.timeOutBackFrom;
      for (const t of ['A', 'B'] as TeamId[]) s.teams[t].turn = Math.max(0, s.teams[t].turn + (back ? -1 : 1));
      ctx.emit('note', `Time-out: both Turn markers move ${back ? 'back' : 'forward'} one space (${s.teams.A.name} ${s.teams.A.turn}, ${s.teams.B.name} ${s.teams.B.turn}).`, rule);
      break;
    }
    case 4: {
      if (RS.event4 === 'alertDefence') {
        // Sevens (p.11): up to D3+1 Open players of the kicking team move one square, even into No Man's Land.
        const max = d(ctx, 3) + 1;
        m.pendingPhase = { type: 'quickSnap', team: kicking, max, alert: true };
        ctx.emit('note', `Alert Defence: ${s.teams[kicking].name} may move up to ${max} Open players one square each (even into No Man's Land).`, rule);
        break;
      }
      const max = d(ctx, 3) + 3;
      m.pendingPhase = { type: 'solidDefence', team: kicking, max };
      ctx.emit('note', `Solid Defence: ${s.teams[kicking].name} may set up again up to ${max} Open players.`, rule);
      break;
    }
    case 5: {
      const L = m.kick?.landing;
      const open = L && inOwnHalf(receiving, L) && !playerAt(s, L) ? pitchPlayers(s, receiving).filter((p) => isOpen(s, p) && p.stance === 'standing') : [];
      if (!open.length) {
        ctx.emit('note', 'High Kick: no Open player can be placed under the ball.', rule);
        break;
      }
      const pick = ctx.ask({
        type: 'highKick',
        team: receiving,
        prompt: `High Kick: place one Open player in ${fmt(L as Coord)}, where the ball will land?`,
        options: [...open.map((p) => ({ id: p.id, label: `${label(p)} (${fmt(p.pos)})`, square: p.pos as Coord })), { id: 'none', label: 'Do not move anyone' }],
        rule,
      });
      if (pick !== 'none') {
        const p = getPlayer(s, pick);
        p.pos = { ...(L as Coord) };
        ctx.emit('move', `${label(p)} is placed under the ball in ${fmt(L as Coord)} (High Kick).`, rule);
      }
      break;
    }
    case 6: {
      // Team Mascot (p.144): a natural 1 for Cheering Fans may be re-rolled.
      const cheer = (t: TeamId) => {
        let r = d(ctx, 6, t);
        if (r === 1 && induced(s, t, 'teamMascot')) {
          const again = d(ctx, 6, t);
          ctx.emit('reroll', `Team Mascot: ${s.teams[t].name} re-roll their natural 1 for Cheering Fans — ${again}.`, INDUCE_RULE('teamMascot'));
          r = again;
        }
        return r + m.cheerleaders[t];
      };
      const ca = cheer('A');
      const cb = cheer('B');
      ctx.emit('roll', `Cheering Fans (D6 + Cheerleaders): ${s.teams.A.name} ${ca}, ${s.teams.B.name} ${cb}.`, rule);
      const winners: TeamId[] = ca === cb ? ['A', 'B'] : [ca > cb ? 'A' : 'B'];
      m.cheering = winners.map((t) => ({ team: t, turn: s.teams[t].turn + 1, used: false }));
      ctx.emit('note', `${winners.map((t) => s.teams[t].name).join(' and ')}: the first Block Action in the next Turn receives an extra Offensive Assist.`, rule);
      break;
    }
    case 7: {
      const winners = both('Brilliant Coaching (D6 + Assistant Coaches)', (t) => m.assistantCoaches[t]);
      for (const t of winners) {
        s.teams[t].rerolls += 1;
        s.teams[t].bonusRerolls = (s.teams[t].bonusRerolls ?? 0) + 1;
      }
      ctx.emit('note', `${winners.map((t) => s.teams[t].name).join(' and ')} gain a free Team Re-roll for this Drive.`, rule);
      break;
    }
    case 8: {
      const w = rollWeather(ctx, 'Changing Weather');
      if (w === 'perfect' && m.kick) {
        m.kick.scatterInAir = true;
        ctx.emit('note', 'Perfect Conditions: the ball will Scatter (3) in the air before it lands.', rule);
      }
      break;
    }
    case 9: {
      const max = d(ctx, 3) + RS.kickoffPlayersBonus;
      m.pendingPhase = { type: 'quickSnap', team: receiving, max };
      ctx.emit('note', `Quick Snap: ${s.teams[receiving].name} may move up to ${max} Open players one square each${RS.source ? " (even into No Man's Land)" : ''}.`, rule);
      break;
    }
    case 10: {
      const max = d(ctx, 3) + RS.kickoffPlayersBonus;
      m.pendingPhase = { type: 'charge', team: kicking, max, activated: [], blitz: false, ttm: false };
      s.phase = 'play';
      s.turn.active = kicking;
      s.turn.activation = null;
      s.turn.used = { blitz: false, pass: false, handoff: false, foul: false, secure: false, ttm: false, bomb: false, punt: false, ktm: false };
      for (const p of s.players) p.activated = false;
      ctx.emit('note', `Charge!: ${s.teams[kicking].name} may activate up to ${max} Open players for a free Move Action (one may Blitz, one may Throw a Team-mate, one may Kick a Team-mate). A player who Falls Over or is Knocked Down ends the Charge.`, rule);
      break;
    }
    case 11: {
      // Both coaches roll a D6; the LOWEST roller (both on a tie) is affected.
      const a = d(ctx, 6, 'A');
      const b = d(ctx, 6, 'B');
      ctx.emit('roll', `Dodgy Snack: ${s.teams.A.name} ${a}, ${s.teams.B.name} ${b}.`, rule);
      const affected: TeamId[] = a === b ? ['A', 'B'] : [a < b ? 'A' : 'B'];
      for (const t of affected) {
        const on = pitchPlayers(s, t);
        if (!on.length) continue;
        const p = on[d(ctx, on.length) - 1];
        const roll = d(ctx, 6);
        if (roll >= 2) {
          m.driveMods.push({ playerId: p.id, ma: p.ma, av: p.av });
          p.ma = Math.max(1, p.ma - 1);
          p.av = Math.max(2, p.av - 1);
          ctx.emit('status', `Dodgy Snack: ${label(p)} (randomly selected) rolls ${roll}: −1 MA and −1 AV for this Drive.`, rule, { playerId: p.id });
        } else {
          p.location = 'reserves';
          p.pos = null;
          ctx.emit('status', `Dodgy Snack: ${label(p)} (randomly selected) rolls 1 and spends the Drive in the lavatory (Reserves Box).`, rule, { playerId: p.id });
        }
      }
      break;
    }
    case 12: {
      const ff = m.fanFactor ?? { A: 0, B: 0 };
      const a = d(ctx, 6, 'A') + ff.A;
      const b = d(ctx, 6, 'B') + ff.B;
      ctx.emit('roll', `Pitch Invasion (D6 + Fan Factor): ${s.teams.A.name} ${a}, ${s.teams.B.name} ${b}.`, rule);
      const affected: TeamId[] = a === b ? ['A', 'B'] : [a < b ? 'A' : 'B'];
      for (const t of affected) {
        // Standard: D3 players (p.48); Sevens: one player (Spike! 22 p.11).
        const count = RS.pitchInvasion === 'one' ? 1 : d(ctx, 3);
        const pool = pitchPlayers(s, t).slice();
        const hit: Player[] = [];
        for (let i = 0; i < count && pool.length; i++) hit.push(pool.splice(d(ctx, pool.length) - 1, 1)[0]);
        for (const p of hit) {
          p.stance = 'stunned';
          p.distracted = false;
          ctx.emit('status', `Pitch Invasion: ${label(p)} is Placed Prone and Stunned.`, rule, { playerId: p.id });
        }
      }
      break;
    }
  }
}

/** The ball comes down (p.49): catch or Bounce, or a Touchback. */
function landKick(ctx: Ctx): void {
  const s = ctx.s;
  const m = s.match!;
  const kick = m.kick!;
  const kicking = m.kicking as TeamId;
  const receiving = other(kicking);
  let L = kick.landing;
  if (L && kick.scatterInAir) {
    const r = ctx.roll({ dice: [8, 8, 8], interpret: (f) => scatterPath(L as Coord, f), cacheKey: `scatter3|${L.x},${L.y}` });
    const sc = r.value;
    L = 'land' in sc ? sc.land : null;
    ctx.emit('ball', `The ball Scatters (3) in the air: D8 ${r.faces.join(', ')} → ${L ? fmt(L) : 'off the pitch'}.`, MATCH_RULES.events);
  }
  if (!kickLands(kicking, L)) {
    const own = rulesFor(s).source ? "behind the kicking team's Line of Scrimmage" : "in the kicking team's half";
    ctx.emit('ball', `The ball ${L ? `comes down in ${fmt(L)}, ${own}` : 'leaves the pitch'}: Touchback (p.49).`, MATCH_RULES.touchback);
    touchback(ctx);
  } else {
    const p = playerAt(s, L);
    s.ball = { kind: 'ground', pos: { ...L } };
    if (p) {
      ctx.emit('ball', `The ball comes down on ${label(p)} in ${fmt(L)}.`, MATCH_RULES.touchback);
      if (!catchAttempt(ctx, p, 'kick')) kickBounce(ctx, L, 0);
    } else {
      // Diving Catch (p.127): a Standing player with the Skill next to the empty landing square may try to Catch it.
      const dc = kickDivingCatch(ctx, L, receiving);
      if (dc === 'failed') kickBounce(ctx, L, 0);
      else if (dc === 'none') {
        ctx.emit('ball', `The ball lands in ${fmt(L)} and bounces.`, MATCH_RULES.touchback);
        kickBounce(ctx, L, 0);
      }
    }
  }
  m.kick = undefined;
  m.pendingPhase = undefined;
  startReceivingTurn(ctx);
}

function kickBounce(ctx: Ctx, from: Coord, depth: number): void {
  const s = ctx.s;
  const kicking = s.match!.kicking as TeamId;
  if (depth > 200) throw new Error('Kick-off bounce did not terminate');
  const r = ctx.roll({ dice: [8], interpret: ([dd]) => scatterPath(from, [dd]), cacheKey: `bounce|${from.x},${from.y}` });
  const sc = r.value;
  if (!('land' in sc) || !kickLands(kicking, sc.land)) {
    const own = rulesFor(s).source ? "behind the kicking team's Line of Scrimmage" : "into the kicking team's half";
    ctx.emit('ball', `The ball bounces (D8: ${r.faces[0]}) ${'land' in sc ? `${own} (${fmt(sc.land)})` : 'off the pitch'}: Touchback (p.49).`, MATCH_RULES.touchback);
    touchback(ctx);
    return;
  }
  const to = sc.land;
  s.ball = { kind: 'ground', pos: { ...to } };
  ctx.emit('ball', `The ball bounces (D8: ${r.faces[0]}) from ${fmt(from)} to ${fmt(to)}.`, { page: 34, title: 'Bouncing Balls' }, { to });
  const p = playerAt(s, to);
  if (p) {
    if (!catchAttempt(ctx, p, 'bounce')) kickBounce(ctx, to, depth + 1);
    return;
  }
  ctx.emit('ball', `The ball comes to rest in ${fmt(to)}.`, { page: 34, title: 'Bouncing Balls' });
}

function touchback(ctx: Ctx): void {
  const s = ctx.s;
  const receiving = other(s.match!.kicking as TeamId);
  const standing = pitchPlayers(s, receiving).filter((p) => p.stance === 'standing' && !hasSkill(p, 'noBall'));
  if (standing.length) {
    const pick = ctx.ask({
      type: 'touchback',
      team: receiving,
      prompt: 'Touchback: give the ball to one of your Standing players.',
      options: standing.map((p) => ({ id: p.id, label: `${label(p)} (${fmt(p.pos)})`, square: p.pos as Coord })),
      rule: MATCH_RULES.touchback,
    });
    s.ball = { kind: 'held', playerId: pick };
    ctx.emit('ball', `Touchback: ${label(getPlayer(s, pick))} is given the ball.`, MATCH_RULES.touchback, { holder: pick });
    return;
  }
  const squares: Coord[] = [];
  for (let x = 0; x < pitch().w; x++) for (let y = 0; y < pitch().h; y++) if (inOwnHalf(receiving, { x, y }) && !playerAt(s, { x, y })) squares.push({ x, y });
  const pick = ctx.ask({
    type: 'touchback',
    team: receiving,
    prompt: 'Touchback: no Standing player can take the ball — place it on an unoccupied square in your half.',
    options: squares.map((c) => ({ id: `${c.x},${c.y}`, label: fmt(c), square: c })),
    rule: MATCH_RULES.touchback,
  });
  const [x, y] = pick.split(',').map(Number);
  s.ball = { kind: 'ground', pos: { x, y } };
  ctx.emit('ball', `Touchback: the ball is placed in ${fmt({ x, y })}.`, MATCH_RULES.touchback);
}

function startReceivingTurn(ctx: Ctx): void {
  const s = ctx.s;
  const kicking = s.match!.kicking as TeamId;
  s.phase = 'play';
  s.turn.active = kicking; // startNextTurn hands the Turn to the other (receiving) team
  s.turn.activation = null;
  ctx.turnEnded = true;
  startNextTurn(ctx);
}

function solidDefence(ctx: Ctx, positions: Record<string, Coord | null>): void {
  const s = ctx.s;
  const m = s.match!;
  const ph = m.pendingPhase as { type: 'solidDefence'; team: TeamId; max: number };
  const current: Record<string, Coord | null> = {};
  for (const p of pitchPlayers(s, ph.team)) current[p.id] = p.pos;
  const moved = Object.keys(positions).filter((id) => !eq(findPlayer(s, id)?.pos, positions[id]));
  const err = applyPositions(s, ph.team, { ...current, ...positions });
  if (err) throw new IllegalAction(err);
  ctx.emit('move', `Solid Defence: ${s.teams[ph.team].name} set up ${moved.length} player${moved.length === 1 ? '' : 's'} again.`, MATCH_RULES.events);
  m.pendingPhase = undefined;
  landKick(ctx);
}

function quickSnap(ctx: Ctx, moves: Record<string, Coord>): void {
  const s = ctx.s;
  const m = s.match!;
  const alert = m.pendingPhase?.type === 'quickSnap' && m.pendingPhase.alert;
  for (const id of Object.keys(moves)) {
    const p = getPlayer(s, id);
    const from = p.pos as Coord;
    p.pos = { ...moves[id] };
    ctx.emit('move', `${alert ? 'Alert Defence' : 'Quick Snap'}: ${label(p)} moves ${fmt(from)} → ${fmt(p.pos)}.`, rulesFor(s).refs.events, { playerId: p.id });
  }
  m.pendingPhase = undefined;
  landKick(ctx);
}

/** Charge! ends (all selected players activated, a fall/knock-down, or the coach stops): the ball lands. */
export function endCharge(ctx: Ctx, why: string): void {
  const s = ctx.s;
  const m = s.match!;
  if (m.pendingPhase?.type !== 'charge') return;
  s.turn.activation = null;
  ctx.emit('note', `The Charge ends (${why}).`, MATCH_RULES.events);
  m.pendingPhase = undefined;
  s.phase = 'kickoff';
  ctx.turnover = null;
  landKick(ctx);
}

/** Charge! restrictions (p.48), or null when not charging / allowed. */
export function chargeReason(s: GameState, p: Player, action: string, special?: string): string | null {
  const ph = s.match?.pendingPhase;
  if (!ph || ph.type !== 'charge') return null;
  if (p.team !== ph.team) return 'During Charge! only the kicking team acts.';
  if (ph.activated.length >= ph.max && !ph.activated.includes(p.id)) return `Charge!: all ${ph.max} selected players have been activated.`;
  if (!isOpen(s, p)) return 'Charge!: only Open players can be selected (p.48).';
  if (action === 'blitz' && ph.blitz) return 'Charge!: one player has already performed the free Blitz.';
  if (action === 'ttm' && ph.ttm) return 'Charge!: one player has already performed the free Throw Team-mate.';
  if (action === 'special' && special === 'kickTeamMate') return ph.ktm ? 'Charge!: one player has already performed the free Kick Team-mate.' : null;
  if (!['move', 'blitz', 'ttm'].includes(action)) return 'Charge!: selected players perform a free Move Action (one may Blitz, one may Throw a Team-mate, one may Kick a Team-mate).';
  return null;
}

// ---------------------------------------------------------------------------
// End of a Drive (p.82-83)
// ---------------------------------------------------------------------------

function nextDrive(ctx: Ctx): void {
  const s = ctx.s;
  const m = s.match!;
  const scored = s.phase === 'touchdown' ? s.touchdown?.team ?? null : null;
  endOfDrive(ctx);
  let halfDone = !scored;
  let kicking: TeamId = scored ?? (m.kicking as TeamId);
  if (scored && s.teams[other(kicking)].turn >= rulesFor(s).turnsPerHalf) halfDone = true;
  if (halfDone) {
    if (m.half === 1) {
      m.half = 2;
      s.turn.half = 2;
      for (const t of ['A', 'B'] as TeamId[]) {
        s.teams[t].turn = 0;
        s.teams[t].rerolls = m.rosterRerolls[t];
        // An unused Leader Re-roll does not carry over; it is gained again at the start of the half (kick-off).
        s.teams[t].leaderReroll = false;
      }
      kicking = m.receivedFirst ? m.receivedFirst : other(kicking);
      ctx.emit('turn', `Half-time. Team Re-rolls are replenished. ${s.teams[kicking].name} kick off the second half (p.83).`, MATCH_RULES.restart);
    } else {
      const score = { A: s.teams.A.score, B: s.teams.B.score };
      m.result = { winner: score.A === score.B ? null : score.A > score.B ? 'A' : 'B', score };
      s.phase = 'fullTime';
      ctx.emit('turn', `Full time: ${s.teams.A.name} ${score.A} – ${score.B} ${s.teams.B.name}${m.result.winner ? ` — ${s.teams[m.result.winner].name} win` : ' — a draw'}.`, MATCH_RULES.restart);
      return;
    }
  }
  m.kicking = kicking;
  m.drive += 1;
  // Count Luthor von Drakenborg's Star of the Show (p.197): a Team Re-roll for the Drive after his Touchdown.
  for (const t of ['A', 'B'] as TeamId[]) {
    const n = s.teams[t].nextDriveRerolls ?? 0;
    if (!n) continue;
    s.teams[t].rerolls += n;
    s.teams[t].bonusRerolls = (s.teams[t].bonusRerolls ?? 0) + n;
    s.teams[t].nextDriveRerolls = 0;
    ctx.emit('note', `${s.teams[t].name}: +${n} Team Re-roll for this Drive (Star of the Show), lost if unused at its end.`, { page: 197, title: 'Count Luthor von Drakenborg: Star of the Show' });
  }
  m.setupDone = { A: false, B: false };
  m.swarmed = undefined;
  m.wisdomAsked = undefined;
  s.turn.betweenTurns = false;
  s.turn.wizardDeclined = [];
  s.phase = 'driveSetup';
  s.turn.active = kicking;
  s.touchdown = undefined;
  ctx.emit('note', `Drive ${m.drive}: ${s.teams[kicking].name} kick off. Set up, starting with the kicking team (p.47).`, MATCH_RULES.setup);
}

function endOfDrive(ctx: Ctx): void {
  const s = ctx.s;
  const m = s.match!;
  const rule = MATCH_RULES.endOfDrive;
  ctx.emit('turn', 'End of the Drive.', rule);
  // 1. Secret Weapons
  for (const p of s.players) {
    if (!p.inDrive || !hasSkill(p, 'secretWeapon') || p.location === 'sentOff') continue;
    // Kreek Rustgouger's I'll Be Back (p.204): the first time he would be Sent-off for his Secret Weapon, he stays (no Argue the Call).
    if (starReady(s, p, 'kreek')) {
      spendStar(ctx, p, `${label(p)} would be Sent-off (Secret Weapon) but stays in the game this time.`);
      continue;
    }
    let sentOff = true;
    // Blood Bowl Sevens: Amateur Referees (Spike! 22 p.13) — 5-6 keeps the player, no coach ejection.
    const amateur = rulesFor(s).argueTable === 'amateur';
    const argueRule = amateur ? rulesFor(s).refs.argue : MATCH_RULES.argue;
    if (!m.coachEjected[p.team]) {
      const argue = ctx.ask({
        type: 'argueTheCall',
        team: p.team,
        prompt: `${label(p)} is Sent-off (Secret Weapon). Argue the Call?`,
        options: [
          { id: 'yes', label: amateur ? 'Argue the Call (D6: 5-6 keeps the player)' : 'Argue the Call (D6)' },
          { id: 'no', label: 'Accept it' },
        ],
        rule: argueRule,
      });
      if (argue === 'yes') {
        const n = d(ctx, 6, p.team);
        if (amateur) {
          sentOff = n < 5;
          ctx.emit('roll', `Argue the Call: ${n} — ${sentOff ? `"I don't care!" ${label(p)} is still Sent-off` : `"Well, when you put it like that…" ${label(p)} is not Sent-off`}.`, argueRule);
        } else if (n === 1) {
          m.coachEjected[p.team] = true;
          ctx.emit('roll', `Argue the Call: ${n} — "You're outta here!" The coach is ejected and the player is still Sent-off.`, MATCH_RULES.argue);
        } else if (n === 6) {
          sentOff = false;
          ctx.emit('roll', `Argue the Call: ${n} — the referee is swayed; ${label(p)} is not Sent-off.`, MATCH_RULES.argue);
        } else ctx.emit('roll', `Argue the Call: ${n} — the referee does not care; ${label(p)} is still Sent-off.`, MATCH_RULES.argue);
      }
    }
    if (sentOff && m.bribes[p.team] > 0) {
      const use = ctx.ask({
        type: 'bribe',
        team: p.team,
        prompt: `Use a Bribe for ${label(p)}? (${m.bribes[p.team]} left)`,
        options: [
          { id: 'yes', label: 'Use a Bribe (2+ keeps the player)' },
          { id: 'no', label: 'Keep the Bribe' },
        ],
        rule: MATCH_RULES.bribe,
      });
      if (use === 'yes') {
        m.bribes[p.team] -= 1;
        const n = d(ctx, 6, p.team);
        sentOff = n === 1;
        ctx.emit('roll', `Bribe: ${n} — ${sentOff ? 'the referee pockets it and sends the player off anyway' : `${label(p)} is not Sent-off`}.`, MATCH_RULES.bribe);
      }
    }
    if (sentOff) {
      p.location = 'sentOff';
      p.pos = null;
      ctx.emit('status', `${label(p)} is Sent-off (Secret Weapon, p.135).`, { page: 135, title: 'Secret Weapon' }, { playerId: p.id });
    }
  }
  // Players benched by the last Drive's Sweltering Heat (or a Sevens Hangover) may play again from the next Drive.
  for (const p of s.players) {
    p.benched = false;
    p.benchedWhy = undefined;
  }
  // 2. End of Drive effects (weather first)
  if (s.weather === 'swelteringHeat') {
    const n = d(ctx, 3);
    ctx.emit('roll', `Sweltering Heat: D3 ${n} — each team randomly selects ${n} player${n === 1 ? '' : 's'} from those on the pitch.`, MATCH_RULES.weather);
    for (const t of ['A', 'B'] as TeamId[]) {
      const pool = pitchPlayers(s, t).slice();
      for (let i = 0; i < n && pool.length; i++) {
        const p = pool.splice(d(ctx, pool.length) - 1, 1)[0];
        p.benched = true;
        ctx.emit('status', `${label(p)} faints in the heat and cannot be set up for the next Drive.`, MATCH_RULES.weather, { playerId: p.id });
      }
    }
  }
  // Sevens Desperate Measure You Dope! (Spike! 22 p.15): a D6 for each doped player who took part in the Drive.
  const ill = youDopeEndOfDrive(ctx);
  // 3. Recover Knocked-out players
  for (const p of s.players.filter((q) => q.location === 'ko' && !ill.has(q.id))) {
    const n = d(ctx, 6, p.team);
    // Blitzer's Best Kegs (+1 each) and Josef Bugman's Bugman's XXXXXX (+1) (pp.144, 147).
    const kegs = induced(s, p.team, 'blitzersBestKeg');
    const bug = induced(s, p.team, 'josefBugman') ? 1 : 0;
    const tot = n + kegs + bug;
    if (tot >= 4) p.location = 'reserves';
    ctx.emit('roll', `Recover ${label(p)}: ${n}${kegs ? ` +${kegs} Blitzer's Best Keg${kegs > 1 ? 's' : ''}` : ''}${bug ? " +1 Bugman's XXXXXX" : ''}${kegs || bug ? ` = ${tot}` : ''} — ${tot >= 4 ? 'recovers (Reserves Box)' : 'stays Knocked-out'}.`, rule, { playerId: p.id });
  }
  // 4. The Drive ends: expire Drive effects, clear the pitch.
  // Zap! (p.149): Frogs are the players again — before the Drive's other changes are undone.
  for (const p of s.players) if (restoreFrog(p)) ctx.emit('status', `${label(p)} is no longer a Frog (end of the Drive).`, ZAP_RULE, { playerId: p.id });
  for (const t of ['A', 'B'] as TeamId[]) {
    const left = s.teams[t].bonusRerolls ?? 0;
    if (left) {
      s.teams[t].rerolls = Math.max(0, s.teams[t].rerolls - left);
      ctx.emit('note', `${s.teams[t].name}: the unused Brilliant Coaching re-roll is lost (p.48).`, MATCH_RULES.events);
    }
    s.teams[t].bonusRerolls = 0;
  }
  for (const mod of m.driveMods) {
    const p = findPlayer(s, mod.playerId);
    if (p) {
      p.ma = mod.ma;
      p.av = mod.av;
    }
  }
  m.driveMods = [];
  m.cheering = undefined;
  m.kickoffEvent = undefined;
  for (const p of s.players) {
    if (p.location === 'pitch') {
      p.location = 'reserves';
      p.pos = null;
    }
    p.stance = 'standing';
    p.distracted = false;
    p.activated = false;
    p.eyeGouged = false;
    p.usage = {};
    p.inDrive = false;
    // Take Root (p.137) and Chomp (p.131) end with the Drive.
    p.rooted = false;
    p.chompedBy = undefined;
    // Grak's I'll Carry You: a Crumbleberry still carried when the Drive ends is back in the Reserves Box.
    p.carriedBy = undefined;
    p.carriedFrom = undefined;
  }
  // Skills gained until the end of the Drive (Star Player special rules).
  dropTempSkills(s, 'drive');
  s.ball = { kind: 'none' };
  s.turn.activation = null;
  s.turn.stunnedAtStart = [];
}

/** Cheering Fans: +1 Offensive Assist for the first Block of that team's next Turn (p.48). */
export function cheeringBonus(s: GameState, team: TeamId): boolean {
  const c = s.match?.cheering?.find((x) => x.team === team);
  return !!c && !c.used && s.turn.active === team && s.teams[team].turn === c.turn;
}

export function useCheeringBonus(s: GameState, team: TeamId): void {
  const c = s.match?.cheering?.find((x) => x.team === team);
  if (c) c.used = true;
}

export function neighboursOf(c: Coord): Coord[] {
  return neighbours(c);
}

export const SKILL_NAMES = (id: string) => SKILL_BY_ID[id]?.name ?? id;
void ActionStop;
