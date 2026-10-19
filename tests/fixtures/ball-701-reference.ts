// Verbatim copy of Bloodboard 7.0.1 src/engine/ball.ts (sha256 59c9490a97886ac3240ba1e38505377719011cc8e8817eacadc171bd784cd72f)
// with only its relative import paths rewritten. It is the reference implementation the cc1 engine candidate's exact
// ball-chain solver is compared against (tests/ballchain-exact-cc1.test.ts). Do not edit.
import { add, D8_DIRS, dist, eq, fmt, inBounds, inScoringEndZone, throwInDirections } from '../../src/engine/board';
import { ActionStop, Ctx, testWeights, tiltedChance, type Mod } from '../../src/engine/context';
import { d6AtLeastW, d6Success } from '../../src/engine/dice';
import { CAPTAIN_RULE, captainOnPitch, lonerValue, modSum, recordTestStep, rollTest, spendTeamReroll } from '../../src/engine/roll';
import { R } from '../../src/engine/rules';
import { gated } from '../../src/engine/skills';
import { awardSpp } from '../../src/engine/spp';
import { ballHolder, canUse, faq2026, findPlayer, hasSkill, hasTackleZone, label, leaderOnPitch, markersOf, other, pitchPlayers, playerAt } from '../../src/engine/state';
import { bloodlustMayScore } from '../../src/engine/traits';
import type { Coord, GameState, Player, TeamId } from '../../src/engine/types';
import { rulesFor } from '../../src/engine/variant';
import { askStar, spendStar, STAR_BY_ID, starReady, starRuleRef, starTestBonus, starTestReroll } from '../../src/engine/stars';

/**
 * How the ball reaches a square. 'kick': the kick-off coming down (no extra
 * Catch modifier, p.49, p.72). 'passTarget': a pass arriving in its target
 * square (Diving Catch +1 there, p.127); otherwise the same as 'pass'.
 */
export type ArrivalKind = 'pass' | 'passTarget' | 'bounce' | 'throwIn' | 'handoff' | 'kick' | 'punt' | 'barikA' | 'barikB' | 'setPiece';

/** The catch roll's target: the receiver's AG, or any 2+ for a Sevens Set Piece pass (Spike! 22 p.15). */
export const catchTarget = (p: Player, kind: ArrivalKind): number => (kind === 'setPiece' ? 2 : p.ag);

/** Arrivals from which Diving Catch may catch a ball landing next to the player (p.127). */
const DIVING_CATCH_KINDS: ArrivalKind[] = ['pass', 'passTarget', 'throwIn', 'kick', 'barikA', 'barikB'];

export type ScatterResult = { land: Coord } | { last: Coord; off: Coord };

export function scatterPath(from: Coord, dirs: number[]): ScatterResult {
  let cur = from;
  for (const d of dirs) {
    const next = add(cur, D8_DIRS[d]);
    if (!inBounds(next)) return { last: cur, off: next };
    cur = next;
  }
  return { land: cur };
}

/** Where a Throw-in lands for a given D6 direction and 2D6 distance (p.73). */
export function throwInResult(last: Coord, off: Coord, dirDie: number, distance: number): ScatterResult {
  const t = throwInDirections(last, off);
  const dir = t.dirs[Math.ceil(dirDie / 2) - 1];
  let cur = last;
  for (let i = 1; i < distance; i++) {
    const next = add(cur, dir);
    if (!inBounds(next)) return { last: cur, off: next };
    cur = next;
  }
  return { land: cur };
}

/** Disturbing Presence (p.127): -1 per opposing player with the skill within 3 squares. */
export function disturbingPresenceMods(ctx: Ctx | { s: GameState }, p: Player): Mod[] {
  if (!p.pos) return [];
  const n = pitchPlayers(ctx.s, other(p.team)).filter((q) => hasSkill(q, 'disturbingPresence') && dist(q.pos as Coord, p.pos as Coord) <= 3).length;
  return n ? [{ label: `Disturbing Presence x${n}`, value: -n }] : [];
}

export function catchMods(ctx: Ctx | { s: GameState }, p: Player, kind: ArrivalKind): Mod[] {
  const mods: Mod[] = [];
  // Set Piece (Sevens Desperate Measure): caught on any roll of 2+ — the receiver's AG and the modifiers are ignored.
  if (kind === 'setPiece') return mods;
  if (kind === 'bounce') mods.push({ label: 'bouncing ball', value: -1 });
  if (kind === 'throwIn') mods.push({ label: 'thrown-in ball', value: -1 });
  const m = markersOf(ctx.s, p.pos as Coord, p.team).length;
  if (m && !canUse(p, 'nervesOfSteel')) mods.push({ label: `Marked x${m}`, value: -m });
  if (ctx.s.weather === 'pouringRain') mods.push({ label: 'Pouring Rain', value: -1 });
  if (canUse(p, 'extraArms')) mods.push({ label: 'Extra Arms', value: 1 });
  if (kind === 'passTarget' && canUse(p, 'divingCatch')) mods.push({ label: 'Diving Catch (target square)', value: 1 });
  // Barik Farblast's Blast It! (p.195): a team-mate catching his Hail Mary Pass gets +1.
  if ((kind === 'barikA' && p.team === 'A') || (kind === 'barikB' && p.team === 'B')) mods.push({ label: 'Blast It! (Barik Farblast)', value: 1 });
  mods.push(...disturbingPresenceMods(ctx, p));
  return mods;
}

/**
 * Diving Catch (p.127): Standing players with the Skill whose Tackle Zone
 * covers an empty square where a pass, throw-in or kick-off lands may try to
 * Catch it (without moving). Interpretation (docs/RULES_COVERAGE.md): one
 * attempt, the active team's coach choosing first; a failed attempt bounces
 * the ball from the square it landed in.
 */
export function divingCatchers(s: GameState, sq: Coord, team?: TeamId): Player[] {
  if (gated('divingCatch')) return [];
  return pitchPlayers(s, team).filter((q) => canUse(q, 'divingCatch') && !hasSkill(q, 'noBall') && dist(q.pos as Coord, sq) === 1);
}

function divingCatch(ctx: Ctx, sq: Coord, kind: ArrivalKind, first?: TeamId): 'caught' | 'failed' | 'none' {
  const s = ctx.s;
  const lead = first ?? s.turn.active;
  const order: TeamId[] = [lead, other(lead)];
  for (const t of order) {
    const cands = divingCatchers(s, sq, t);
    if (!cands.length) continue;
    const pick = ctx.ask({
      type: 'divingCatch',
      team: t,
      prompt: `The ball is landing in ${fmt(sq)}. Try a Diving Catch?`,
      options: [...cands.map((q) => ({ id: q.id, label: `Diving Catch with ${label(q)}`, square: q.pos as Coord })), { id: 'none', label: 'No Diving Catch' }],
      rule: { page: 127, title: 'Diving Catch' },
    });
    if (pick === 'none') continue;
    const q = cands.find((c) => c.id === pick) as Player;
    ctx.emit('ball', `${label(q)} dives for the ball landing in ${fmt(sq)}!`, { page: 127, title: 'Diving Catch' }, { playerId: q.id });
    return catchAttempt(ctx, q, kind === 'passTarget' ? 'pass' : kind) ? 'caught' : 'failed';
  }
  return 'none';
}

export function checkTouchdown(ctx: Ctx, stopNow: boolean): boolean {
  if (ctx.touchdown) {
    if (stopNow) throw new ActionStop('touchdown');
    return true;
  }
  const h = ballHolder(ctx.s);
  if (!h || !h.pos || h.stance !== 'standing') return false;
  if (!inScoringEndZone(h.team, h.pos)) return false;
  // Bloodlust (p.125): a player who failed the roll must bite a Thrall before scoring.
  if (!bloodlustMayScore(ctx, h)) return false;
  ctx.touchdown = { team: h.team, playerId: h.id };
  awardSpp(ctx, h, 'touchdown');
  ctx.s.teams[h.team].score += 1;
  const during = ctx.s.turn.active;
  ctx.emit('touchdown', `TOUCHDOWN! ${label(h)} scores for ${ctx.s.teams[h.team].name}.`, h.team === during ? R.touchdown : R.tdOpponentTurn, { team: h.team, playerId: h.id });
  // Count Luthor von Drakenborg's Star of the Show (p.197): once per game, his Touchdown gives a Team Re-roll for the next Drive.
  if (starReady(ctx.s, h, 'luthor')) {
    const t = ctx.s.teams[h.team];
    t.nextDriveRerolls = (t.nextDriveRerolls ?? 0) + 1;
    spendStar(ctx, h, `${t.name} gain a Team Re-roll until the end of the next Drive.`);
  }
  if (h.team === during) ctx.setTurnover('a Touchdown was scored', R.turnover);
  if (stopNow) throw new ActionStop('touchdown');
  return true;
}

// ---------------------------------------------------------------------------
// Public entry points. During execution the ball is resolved roll by roll.
// During planning, a whole chain of bounces, catches and throw-ins is resolved
// as ONE random event whose exact outcome distribution comes from the Markov
// chain solver below (same geometry, same catch modifiers, same re-roll
// policy), so previews stay exact without exploding into millions of paths.
// ---------------------------------------------------------------------------

export type ChainStart = { t: 'bounce'; from: Coord } | { t: 'arrive'; sq: Coord; kind: ArrivalKind } | { t: 'throwIn'; last: Coord; off: Coord };

/** The ball arrives in a square. Returns true when it was caught there at once (execution only; used for Completions, p.96). */
export function ballArrives(ctx: Ctx, sq: Coord, kind: ArrivalKind): boolean {
  if (ctx.mode === 'plan') {
    planChain(ctx, { t: 'arrive', sq, kind });
    return false;
  }
  return execArrive(ctx, sq, kind, 0);
}

export function bounce(ctx: Ctx, from: Coord): void {
  if (ctx.mode === 'plan') return planChain(ctx, { t: 'bounce', from });
  execBounce(ctx, from, 0);
}

export function throwIn(ctx: Ctx, last: Coord, off: Coord): void {
  if (ctx.mode === 'plan') return planChain(ctx, { t: 'throwIn', last, off });
  execThrowIn(ctx, last, off, 0);
}

function execArrive(ctx: Ctx, sq: Coord, kind: ArrivalKind, depth: number): boolean {
  if (depth > 400) throw new Error('Ball resolution did not terminate');
  const p = playerAt(ctx.s, sq);
  if (!p) {
    if (kind === 'bounce') {
      ctx.s.ball = { kind: 'ground', pos: sq };
      ctx.emit('ball', `The ball comes to rest in ${fmt(sq)}.`, R.scatter, { to: sq });
      return false;
    }
    if (DIVING_CATCH_KINDS.includes(kind)) {
      const dc = divingCatch(ctx, sq, kind);
      if (dc === 'caught') return false;
      if (dc === 'failed') {
        execBounce(ctx, sq, depth + 1);
        return false;
      }
    }
    ctx.emit('ball', `The ball lands in the empty square ${fmt(sq)} and bounces.`, kind === 'throwIn' ? R.throwIn : R.resolvePass);
    execBounce(ctx, sq, depth + 1);
    return false;
  }
  const ok = catchAttempt(ctx, p, kind);
  if (ok) return true;
  execBounce(ctx, sq, depth + 1);
  return false;
}

/** Kick-off landing in an empty square (p.49): Diving Catch first (p.127), the receiving team's coach choosing first. */
export function kickDivingCatch(ctx: Ctx, sq: Coord, receiving: TeamId): 'caught' | 'failed' | 'none' {
  return divingCatch(ctx, sq, 'kick', receiving);
}

/** A player must try to Catch the ball (p.72). Returns true if caught. */
export function catchAttempt(ctx: Ctx, p: Player, kind: ArrivalKind): boolean {
  const how = kind === 'bounce' ? 'bouncing ball' : kind === 'throwIn' ? 'thrown-in ball' : kind === 'handoff' ? 'hand-off' : kind === 'kick' ? 'kick-off' : kind === 'punt' ? 'punt' : 'pass';
  if (!hasTackleZone(p)) {
    const why = p.stance !== 'standing' ? (p.stance === 'prone' ? 'Prone' : 'Stunned') : 'Distracted';
    ctx.emit('roll', `${label(p)} is ${why} and automatically fails to catch the ${how}.`, R.catch, { playerId: p.id, auto: true });
    return false;
  }
  const mods = catchMods(ctx, p, kind);
  const res = rollTest(ctx, {
    kind: 'catch',
    player: p,
    label: `${label(p)} catches the ${how} in ${fmt(p.pos)}${kind === 'setPiece' ? ' (Set Piece: any 2+)' : ''}`,
    target: catchTarget(p, kind),
    mods,
    rule: R.catch,
    skillReroll: { id: 'catch', name: 'Catch', available: canUse(p, 'catch') },
    teamReroll: true,
    proAllowed: true,
    onFail: 'the ball bounces',
    autoFail: hasSkill(p, 'noBall') ? 'No Ball' : undefined,
  });
  if (res.success) {
    ctx.s.ball = { kind: 'held', playerId: p.id };
    ctx.emit('ball', `${label(p)} catches the ball.`, R.catch, { holder: p.id });
    quickBite(ctx, p);
    checkTouchdown(ctx, false);
    return true;
  }
  return false;
}

/**
 * Guffle Pusmaw's Quick Bite (p.201): once per game, when an opposition player he Marks catches the ball, an Armour
 * Roll against them — broken armour and Guffle has the ball (no Turnover is caused by it). The previews' exact
 * ball-chain solver applies the same rule (solveBallChain → caught).
 */
function quickBite(ctx: Ctx, p: Player): void {
  const s = ctx.s;
  if (!p.pos) return;
  const g = markersOf(s, p.pos, p.team).find((q) => starReady(s, q, 'guffle'));
  if (!g) return;
  if (!askStar(ctx, g, `${label(p)} caught the ball next to Guffle. Make an Armour Roll against them (broken: Guffle takes the ball)?`, 'Use Quick Bite', true)) return;
  const r = ctx.roll({ dice: [6, 6], interpret: ([a, b]) => (a + b >= p.av ? 'broken' : 'holds'), cacheKey: `armourfixed|${p.av}|0`, by: g.team, judge: (v) => (v === 'broken' ? 1 : -1) });
  spendStar(ctx, g, `Armour Roll against ${label(p)}: ${r.faces[0]}+${r.faces[1]}=${r.faces[0] + r.faces[1]} vs AV ${p.av}+ — ${r.value === 'broken' ? 'armour broken: Guffle takes the ball (no Turnover)' : 'armour holds'}.`);
  if (r.value === 'broken') {
    s.ball = { kind: 'held', playerId: g.id };
    ctx.quickBite = true;
    ctx.emit('ball', `${label(g)} has the ball.`, starRuleRef(STAR_BY_ID.guffle), { holder: g.id });
  }
}

function execBounce(ctx: Ctx, from: Coord, depth: number): void {
  if (depth > 400) throw new Error('Ball resolution did not terminate');
  const r = ctx.roll({ dice: [8], interpret: ([d]) => scatterPath(from, [d]), cacheKey: `bounce|${from.x},${from.y}` });
  const d = r.faces[0];
  if ('off' in r.value) {
    ctx.emit('ball', `The ball bounces (D8: ${d}) out of the pitch from ${fmt(from)}.`, R.scatter, { d8: d });
    execThrowIn(ctx, r.value.last, r.value.off, depth + 1);
    return;
  }
  const to = r.value.land;
  ctx.s.ball = { kind: 'ground', pos: to };
  ctx.emit('ball', `The ball bounces (D8: ${d}) from ${fmt(from)} to ${fmt(to)}.`, R.scatter, { d8: d, from, to });
  execArrive(ctx, to, 'bounce', depth + 1);
}

/** Scatter (n) from a square (p.34). Stops when the ball leaves the pitch. */
export function scatter(ctx: Ctx, from: Coord, n: number, why: string): ScatterResult {
  const r = ctx.roll({
    dice: Array.from({ length: n }, () => 8),
    interpret: (faces) => scatterPath(from, faces),
    cacheKey: `scatter${n}|${from.x},${from.y}`,
  });
  ctx.emit('ball', `${why}: Scatter (${n}) from ${fmt(from)} — D8 ${r.faces.join(', ')} → ${'land' in r.value ? fmt(r.value.land) : `out of the pitch after ${fmt(r.value.last)}`}.`, R.scatter, { d8: r.faces, result: r.value });
  return r.value;
}

function execThrowIn(ctx: Ctx, last: Coord, off: Coord, depth: number): void {
  if (depth > 400) throw new Error('Ball resolution did not terminate');
  const t = throwInDirections(last, off);
  // Distance 2D6 (p.73); Blood Bowl Sevens: D6+2 (Spike! 22 p.13).
  const sevens = rulesFor(ctx.s).throwInDistance === 'd6plus2';
  const r = sevens
    ? ctx.roll({ dice: [6, 6], interpret: ([dd, a]) => throwInResult(last, off, dd, a + 2), cacheKey: `throwin7|${last.x},${last.y}|${off.x},${off.y}` })
    : ctx.roll({
        dice: [6, 6, 6],
        interpret: ([dd, a, b]) => throwInResult(last, off, dd, a + b),
        cacheKey: `throwin|${last.x},${last.y}|${off.x},${off.y}`,
      });
  const [dd, a, b] = r.faces;
  const dirTxt = t.corner ? `D3 ${Math.ceil(dd / 2)}` : `D6 ${dd}`;
  const distTxt = sevens ? `distance D6+2: ${a}+2=${a + 2}` : `distance ${a}+${b}=${a + b}`;
  const rule = sevens && !t.corner ? rulesFor(ctx.s).refs.throwIn : t.corner ? R.cornerThrowIn : R.throwIn;
  if ('off' in r.value) {
    ctx.emit('ball', `Throw-in from ${fmt(last)} (${t.corner ? 'corner, ' : ''}${dirTxt}, ${distTxt}) — the ball leaves the pitch again after ${fmt(r.value.last)}.`, rule);
    execThrowIn(ctx, r.value.last, r.value.off, depth + 1);
    return;
  }
  const to = r.value.land;
  ctx.s.ball = { kind: 'ground', pos: to };
  ctx.emit('ball', `Throw-in from ${fmt(last)} (${t.corner ? 'corner, ' : ''}${dirTxt}, ${distTxt}, counting ${fmt(last)} as the first square) lands in ${fmt(to)}.`, rule, { to });
  execArrive(ctx, to, 'throwIn', depth + 1);
}

/** The ball leaves a player (knocked down, fell, placed prone, crowd). */
export function dropBallFrom(ctx: Ctx, from: Coord): void {
  ctx.emit('ball', `The ball is dropped in ${fmt(from)}.`, R.scatter);
  bounce(ctx, from);
}

/** A player is involuntarily moved into the ball's square: it Bounces (p.57, p.62). */
export function ballDisplacedBy(ctx: Ctx, p: Player): void {
  if (ctx.s.ball.kind === 'ground' && p.pos && eq(ctx.s.ball.pos, p.pos)) {
    ctx.emit('ball', `${label(p)} is moved onto the ball, which bounces (no Turnover).`, R.push);
    bounce(ctx, p.pos);
  }
}

export function teamHasBall(ctx: Ctx, team: TeamId): boolean {
  const h = ballHolder(ctx.s);
  return !!h && h.team === team;
}

export function holderId(ctx: Ctx): string | undefined {
  return ctx.s.ball.kind === 'held' ? ctx.s.ball.playerId : undefined;
}

export function playerById(ctx: Ctx, id: string): Player | undefined {
  return findPlayer(ctx.s, id);
}

// ---------------------------------------------------------------------------
// Exact ball-chain solver (planning only)
// ---------------------------------------------------------------------------

interface RR {
  team: number;
  leader: boolean;
  pro: boolean;
  /** Team Captain (p.155): Team Re-rolls made free by a natural 6 during the chain. */
  free?: number;
  /**
   * Once-per-game / half resources spent during the chain, sorted: `s:<id>` a Star Player's special rule (Griff's +1,
   * Puggy's / Ripper's re-roll, Guffle's Quick Bite), `v:<id>` a Sevens Veteran's re-roll.
   */
  used?: string[];
  /** Team Mascot (p.144): its Team Re-roll is still available to the active team this half. */
  mascot?: boolean;
}

type ChainState = { t: 'arrive'; x: number; y: number; kind: ArrivalKind; rr: RR } | { t: 'bounce'; x: number; y: number; rr: RR } | { t: 'throwIn'; lx: number; ly: number; ox: number; oy: number; rr: RR };

export interface ChainOutcome {
  key: string;
  p: number;
  holder?: string;
  rest?: Coord;
  rr: RR;
  /** Guffle Pusmaw's Quick Bite took the ball from the catcher (no Turnover is caused by it). */
  bite?: boolean;
}

export interface ChainResult {
  outcomes: ChainOutcome[];
  unresolved: number;
}

const rrKey = (r: RR) => `${r.team}|${r.leader ? 1 : 0}|${r.pro ? 1 : 0}|${r.free ?? 0}|${r.mascot ? 1 : 0}|${(r.used ?? []).join('.')}`;
const rrUsed = (r: RR, tag: string) => !!r.used?.includes(tag);
const rrWith = (r: RR, tag: string): RR => ({ ...r, used: [...(r.used ?? []), tag].sort() });

function stateKey(st: ChainState): string {
  if (st.t === 'arrive') return `a${st.x},${st.y},${st.kind},${rrKey(st.rr)}`;
  if (st.t === 'bounce') return `b${st.x},${st.y},${rrKey(st.rr)}`;
  return `t${st.lx},${st.ly},${st.ox},${st.oy},${rrKey(st.rr)}`;
}

const chainCache = new Map<string, ChainResult>();

export function clearChainCache(): void {
  chainCache.clear();
}

function boardKey(s: GameState): string {
  const act = s.turn.activation;
  return JSON.stringify([
    s.players.filter((p) => p.location === 'pitch').map((p) => [p.id, p.team, p.pos?.x, p.pos?.y, p.stance, p.distracted ? 1 : 0, p.ag, p.av, p.skills.map((k) => k.id + (k.value ?? '')).join('.'), p.captain && s.teams[p.team].specialRules?.includes('Team Captain') ? 1 : 0, p.star ?? '', (p.starUsed ?? []).join('.'), p.veteran ?? '']),
    s.weather,
    s.turn.active,
    act?.playerId ?? '',
    s.variant ?? '',
    s.rulesEdition ?? 'legacy',
    s.match?.half ?? s.turn.half,
    s.match?.drive ?? 0,
    s.teams.A.turn,
    s.teams.B.turn,
  ]);
}

/**
 * Exact distribution of where a chain of bounces / catches / throw-ins ends,
 * found by propagating probability mass through the chain's states until the
 * remaining mass is below 1e-15 (reported as unresolved).
 */
export function solveBallChain(s: GameState, start: ChainStart, policy: { useSkillRerolls: boolean; usePro: boolean; useTeamRerolls: boolean }): ChainResult {
  const act = s.turn.activation;
  const rr0: RR = { team: s.teams[s.turn.active].rerolls, leader: s.teams[s.turn.active].leaderReroll, pro: !!act?.proUsed, mascot: !!s.teams[s.turn.active].mascotReroll };
  const startState: ChainState =
    start.t === 'arrive' ? { t: 'arrive', x: start.sq.x, y: start.sq.y, kind: start.kind, rr: rr0 } : start.t === 'bounce' ? { t: 'bounce', x: start.from.x, y: start.from.y, rr: rr0 } : { t: 'throwIn', lx: start.last.x, ly: start.last.y, ox: start.off.x, oy: start.off.y, rr: rr0 };
  const wk = s.match?.options.difficulty && s.match.options.computer ? `|d${s.match.options.difficulty.player},${s.match.options.difficulty.computer},${s.match.options.computer.team}` : '';
  const ck = `${boardKey(s)}|${stateKey(startState)}|${policy.useSkillRerolls ? 1 : 0}${policy.usePro ? 1 : 0}${policy.useTeamRerolls ? 1 : 0}${wk}`;
  const cached = chainCache.get(ck);
  if (cached) return cached;

  const leaderOk = leaderOnPitch(s, s.turn.active);
  // Team Captain (p.155): a natural 6 after using a Team Re-roll makes it free — the chain tracks both branches exactly.
  const captainP = captainOnPitch(s, s.turn.active) ? testWeights(s, s.turn.active, (f) => f === 6)?.[5] ?? 1 / 6 : 0;
  const pseudoCtx = { s };
  const trans = new Map<string, Array<{ p: number; next?: ChainState; absorb?: { holder?: string; rest?: Coord; rr: RR; bite?: boolean } }>>();

  type Tr = { p: number; next?: ChainState; absorb?: { holder?: string; rest?: Coord; rr: RR; bite?: boolean } };

  /**
   * A catch that succeeded: Guffle Pusmaw's Quick Bite (p.201) may follow — an opposition Star Player who Marks the
   * catcher makes an Armour Roll against them (the previews use it, as in the match), broken: Guffle has the ball.
   */
  const caught = (p: Player, rr: RR, m: number, out: Tr[]) => {
    const g = p.pos ? markersOf(s, p.pos, p.team).find((q) => starReady(s, q, 'guffle') && !rrUsed(rr, `s:${q.id}`)) : undefined;
    if (!g) {
      out.push({ p: m, absorb: { holder: p.id, rr } });
      return;
    }
    const rg = rrWith(rr, `s:${g.id}`);
    const broke = (f: number[]) => f[0] + f[1] >= p.av;
    const qb = tiltedChance(s, g.team, [6, 6], broke, (f) => (broke(f) ? 1 : -1));
    out.push({ p: m * qb, absorb: { holder: g.id, rr: rg, bite: true } });
    out.push({ p: m * (1 - qb), absorb: { holder: p.id, rr: rg } });
  };

  /**
   * The Catch test exactly as rollTest resolves it with the previews' decision policy (planner.ts makeDecider):
   * the roll, a Star Player's +1 after the roll (Griff Oberwald, used when it turns a failure into a success), then
   * ONE re-roll in the decider's order — Catch skill, a Star Player's re-roll (Puggy Baconbreath, Ripper Bolgrot),
   * Pro, the Sevens Veteran, a Team Re-roll (Team Captain's free natural 6), the Leader Re-roll, the Team Mascot
   * (4+ first) — Loner checks included, the +1 offered again after the re-roll.
   */
  const catchTransitions = (p: Player, kind: ArrivalKind, st: ChainState & { rr: RR }, x: number, y: number): Tr[] => {
    const out: Tr[] = [];
    const bounceFrom = (rr: RR): ChainState => ({ t: 'bounce', x, y, rr });
    if (!hasTackleZone(p) || hasSkill(p, 'noBall')) {
      out.push({ p: 1, next: bounceFrom(st.rr) });
      return out;
    }
    const mod = modSum(catchMods(pseudoCtx, p, kind));
    const starTag = `s:${p.id}`;
    const sb = starTestBonus(s, p, 'catch');
    // The catcher's coach rolls: standard D6, or the optional difficulty house rule judging the catch — as in the match.
    const tgt0 = catchTarget(p, kind);
    const w = testWeights(s, p.team, (f) => d6Success(f, tgt0, mod) || (!!sb && d6Success(f, tgt0, mod + sb.value)));
    const pf = (f: number) => (w ? w[f - 1] : 1 / 6);
    const starRr = starTestReroll(s, p, 'catch');
    /** One roll: [P(success), P(success thanks to the +1 — spends it), P(fail)]. */
    const once = (rr: RR): [number, number, number] => {
      let ok = 0;
      let bonus = 0;
      let fail = 0;
      const bonusReady = !!sb && !rrUsed(rr, starTag);
      const tgt = catchTarget(p, kind);
      for (let f = 1; f <= 6; f++) {
        if (d6Success(f, tgt, mod)) ok += pf(f);
        else if (bonusReady && d6Success(f, tgt, mod + (sb as { value: number }).value)) bonus += pf(f);
        else fail += pf(f);
      }
      return [ok, bonus, fail];
    };
    const settle = (m: number, rr: RR, onFail: (m: number, rr: RR) => void) => {
      const [ok, bonus, fail] = once(rr);
      if (ok > 0) caught(p, rr, m * ok, out);
      if (bonus > 0) caught(p, rrWith(rr, starTag), m * bonus, out);
      if (fail > 0) onFail(m * fail, rr);
    };
    const toBounce = (m: number, rr: RR) => {
      if (m > 0) out.push({ p: m, next: bounceFrom(rr) });
    };
    const isActive = p.team === s.turn.active;
    const lonerX = lonerValue(p);
    const lonerP = lonerX ? d6AtLeastW(lonerX, testWeights(s, p.team, (f) => f >= lonerX)) : 1;
    const reroll = (m: number, rr: RR) => {
      if (policy.useSkillRerolls && canUse(p, 'catch')) return settle(m, rr, toBounce);
      if (policy.useSkillRerolls && starRr && !rrUsed(rr, starTag)) return settle(m, rrWith(rr, starTag), toBounce);
      if (policy.usePro && !!act && act.playerId === p.id && !rr.pro && canUse(p, 'pro')) {
        const r2 = { ...rr, pro: true };
        const proP = d6AtLeastW(3, testWeights(s, p.team, (f) => f >= 3));
        settle(m * proP, r2, toBounce);
        return toBounce(m * (1 - proP), r2);
      }
      if (policy.useSkillRerolls && p.veteran === 'ready' && !rrUsed(rr, `v:${p.id}`)) return settle(m, rrWith(rr, `v:${p.id}`), toBounce);
      if (!isActive || !policy.useTeamRerolls) return toBounce(m, rr);
      if (rr.team > 0) {
        const branches: Array<{ q: number; rr: RR }> =
          captainP > 0
            ? [
                { q: 1 - captainP, rr: { ...rr, team: rr.team - 1 } },
                { q: captainP, rr: { ...rr, free: (rr.free ?? 0) + 1 } },
              ]
            : [{ q: 1, rr: { ...rr, team: rr.team - 1 } }];
        for (const b of branches) {
          settle(m * b.q * lonerP, b.rr, toBounce);
          toBounce(m * b.q * (1 - lonerP), b.rr);
        }
        return;
      }
      if (rr.leader && leaderOk) {
        const r2 = { ...rr, leader: false };
        settle(m * lonerP, r2, toBounce);
        return toBounce(m * (1 - lonerP), r2);
      }
      if (rr.mascot) {
        // Team Mascot (p.144): 4+ first — otherwise it is lost for the half (no other re-roll is left here).
        const r2 = { ...rr, mascot: false };
        const mascotP = d6AtLeastW(4, testWeights(s, p.team, (f) => f >= 4));
        // Team Captain (FAQ May 2026 p.144): after a successful Mascot 4+ a natural 6 gives the Mascot's re-roll back (a later use needs a new 4+).
        const free = faq2026(s) ? captainP : 0;
        const rFree = { ...rr, mascot: true };
        if (free > 0) {
          settle(m * mascotP * free * lonerP, rFree, toBounce);
          toBounce(m * mascotP * free * (1 - lonerP), rFree);
        }
        settle(m * mascotP * (1 - free) * lonerP, r2, toBounce);
        toBounce(m * mascotP * (1 - free) * (1 - lonerP), r2);
        return toBounce(m * (1 - mascotP), r2);
      }
      toBounce(m, rr);
    };
    settle(1, st.rr, reroll);
    return out;
  };

  const transitions = (st: ChainState) => {
    const k = stateKey(st);
    const c = trans.get(k);
    if (c) return c;
    let out: Tr[] = [];
    if (st.t === 'arrive') {
      const sq = { x: st.x, y: st.y };
      const pl = playerAt(s, sq);
      if (!pl) {
        // Previews assume Diving Catch is always tried when possible, the active team's player first (p.127).
        const dc = DIVING_CATCH_KINDS.includes(st.kind) ? divingCatchers(s, sq, s.turn.active)[0] ?? divingCatchers(s, sq, other(s.turn.active))[0] : undefined;
        if (st.kind === 'bounce') out.push({ p: 1, absorb: { rest: sq, rr: st.rr } });
        else if (dc) out = catchTransitions(dc, st.kind === 'passTarget' ? 'pass' : st.kind, st, st.x, st.y);
        else out.push({ p: 1, next: { t: 'bounce', x: st.x, y: st.y, rr: st.rr } });
      } else out = catchTransitions(pl, st.kind, st, st.x, st.y);
    } else if (st.t === 'bounce') {
      for (let d = 1; d <= 8; d++) {
        const r = scatterPath({ x: st.x, y: st.y }, [d]);
        if ('off' in r) out.push({ p: 1 / 8, next: { t: 'throwIn', lx: r.last.x, ly: r.last.y, ox: r.off.x, oy: r.off.y, rr: st.rr } });
        else out.push({ p: 1 / 8, next: { t: 'arrive', x: r.land.x, y: r.land.y, kind: 'bounce', rr: st.rr } });
      }
    } else {
      const agg = new Map<string, { p: number; next: ChainState }>();
      const sevens = rulesFor(s).throwInDistance === 'd6plus2';
      for (let dd = 1; dd <= 6; dd++)
        for (let a = 1; a <= 6; a++)
          for (let b = 1; b <= 6; b++) {
            // Sevens: distance D6+2 — the second die is ignored, each (dd, a) pair still weighs 6/216 = 1/36.
            const r = throwInResult({ x: st.lx, y: st.ly }, { x: st.ox, y: st.oy }, dd, sevens ? a + 2 : a + b);
            const next: ChainState = 'off' in r ? { t: 'throwIn', lx: r.last.x, ly: r.last.y, ox: r.off.x, oy: r.off.y, rr: st.rr } : { t: 'arrive', x: r.land.x, y: r.land.y, kind: 'throwIn', rr: st.rr };
            const nk = stateKey(next);
            const e = agg.get(nk);
            if (e) e.p += 1 / 216;
            else agg.set(nk, { p: 1 / 216, next });
          }
      out = [...agg.values()];
    }
    trans.set(k, out);
    return out;
  };

  const absorbed = new Map<string, ChainOutcome>();
  let frontier = new Map<string, { st: ChainState; m: number }>([[stateKey(startState), { st: startState, m: 1 }]]);
  let iter = 0;
  let remaining = 1;
  while (frontier.size && iter < 5000) {
    iter++;
    const next = new Map<string, { st: ChainState; m: number }>();
    for (const { st, m } of frontier.values()) {
      for (const tr of transitions(st)) {
        const pm = m * tr.p;
        if (pm <= 0) continue;
        if (tr.absorb) {
          const a = tr.absorb;
          const key = a.holder ? `held:${a.holder}${a.bite ? ':bite' : ''}|${rrKey(a.rr)}` : `rest:${a.rest?.x},${a.rest?.y}|${rrKey(a.rr)}`;
          const e = absorbed.get(key);
          if (e) e.p += pm;
          else absorbed.set(key, { key, p: pm, holder: a.holder, rest: a.rest, rr: a.rr, bite: a.bite });
        } else if (tr.next) {
          const nk = stateKey(tr.next);
          const e = next.get(nk);
          if (e) e.m += pm;
          else next.set(nk, { st: tr.next, m: pm });
        }
      }
    }
    frontier = next;
    remaining = 0;
    for (const v of frontier.values()) remaining += v.m;
    if (remaining < 1e-15) break;
  }
  const outcomes = [...absorbed.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const res: ChainResult = { outcomes, unresolved: frontier.size ? remaining : 0 };
  if (chainCache.size > 2000) chainCache.clear();
  chainCache.set(ck, res);
  return res;
}

function planChain(ctx: Ctx, start: ChainStart): void {
  const s = ctx.s;
  // Show the first catch of a pass / throw-in as a step in the plan.
  if (start.t === 'arrive' && start.kind !== 'bounce') {
    const p = playerAt(s, start.sq);
    if (p && hasTackleZone(p)) {
      recordTestStep(ctx, {
        kind: 'catch',
        player: p,
        label: `${label(p)} catches the ${start.kind === 'throwIn' ? 'thrown-in ball' : start.kind === 'handoff' ? 'hand-off' : start.kind === 'kick' ? 'kick-off' : 'pass'} in ${fmt(p.pos)}`,
        target: catchTarget(p, start.kind),
        mods: catchMods(ctx, p, start.kind),
        rule: R.catch,
        skillReroll: { id: 'catch', name: 'Catch', available: canUse(p, 'catch') },
        teamReroll: true,
        proAllowed: true,
        onFail: 'the ball bounces (the whole bounce chain is resolved exactly)',
        autoFail: hasSkill(p, 'noBall') ? 'No Ball' : undefined,
        at: p.pos ?? undefined,
      });
    }
  }
  const res = solveBallChain(s, start, ctx.policy);
  if (res.unresolved > 0) ctx.unresolvedExtra += res.unresolved;
  const active = s.turn.active;
  const pick = ctx.dice.choose(
    res.outcomes.map((o) => ({ key: o.key, p: o.p, value: o })),
    (o) => {
      if (!o.holder) return false;
      const h = findPlayer(s, o.holder);
      return !!h && h.team === active;
    },
  );
  const t = s.teams[active];
  spendTeamReroll(t, t.rerolls - pick.rr.team);
  const cap = pick.rr.free ? captainOnPitch(s, active) : undefined;
  if (cap) ctx.emit('note', `Team Captain ${label(cap)}: a natural 6 made ${pick.rr.free === 1 ? 'a Team Re-roll' : `${pick.rr.free} Team Re-rolls`} used in this ball chain free.`, CAPTAIN_RULE, { playerId: cap.id, captainFree: true });
  t.leaderReroll = pick.rr.leader;
  if (s.turn.activation) s.turn.activation.proUsed = pick.rr.pro;
  if (pick.rr.mascot === false && t.mascotReroll) t.mascotReroll = false;
  // Once-per-game / half resources the chain used (Star Player rules, Veterans), as in the match.
  for (const tag of pick.rr.used ?? []) {
    const who = findPlayer(s, tag.slice(2));
    if (!who) continue;
    if (tag.startsWith('v:')) who.veteran = 'used';
    else if (!(who.star === 'guffle' && pick.bite)) spendStar(ctx, who, 'used during this ball chain (included in the exact chain preview).');
  }
  const origin = start.t === 'arrive' ? start.sq : start.t === 'bounce' ? start.from : start.last;
  if (pick.holder) {
    s.ball = { kind: 'held', playerId: pick.holder };
    const h = findPlayer(s, pick.holder) as Player;
    if (pick.bite) {
      spendStar(ctx, h, 'Quick Bite: armour broken — Guffle takes the ball (no Turnover).');
      ctx.quickBite = true;
    }
    ctx.emit('ball', `Ball from ${fmt(origin)} ends ${pick.bite ? 'with Guffle after his Quick Bite' : 'caught'} by ${label(h)} (exact chain probability ${(pick.p * 100).toFixed(2)}%).`, R.catch, { holder: h.id, chain: true });
    checkTouchdown(ctx, false);
  } else if (pick.rest) {
    s.ball = { kind: 'ground', pos: { ...pick.rest } };
    ctx.emit('ball', `Ball from ${fmt(origin)} comes to rest in ${fmt(pick.rest)} (exact chain probability ${(pick.p * 100).toFixed(2)}%).`, R.scatter, { to: pick.rest, chain: true });
  }
}

// ---------------------------------------------------------------------------
// Barik Farblast's Blast It! (p.195): after his Hail Mary Pass scatters, any of the three D8 may be re-rolled.
// The previews and the computer choose the re-roll that gives his team the best chance of ending the ball chain
// holding the ball (exact chain probabilities); the previews then branch over the resulting landing distribution.
// ---------------------------------------------------------------------------

type ChainPolicy = { useSkillRerolls: boolean; usePro: boolean; useTeamRerolls: boolean };
const BLAST_SUBSETS: number[][] = [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]];
const scatterKey = (r: ScatterResult) => ('land' in r ? `land:${r.land.x},${r.land.y}` : `out:${r.last.x},${r.last.y},${r.off.x},${r.off.y}`);

/** P(Barik's team ends the ball chain holding the ball) for each place the Hail Mary can come down (memoised per call). */
function blastValue(s: GameState, barik: Player, policy: ChainPolicy): (r: ScatterResult) => number {
  const memo = new Map<string, number>();
  const kind: ArrivalKind = barik.team === 'A' ? 'barikA' : 'barikB';
  return (r) => {
    const k = scatterKey(r);
    const m = memo.get(k);
    if (m !== undefined) return m;
    const res = solveBallChain(s, 'land' in r ? { t: 'arrive', sq: r.land, kind } : { t: 'throwIn', last: r.last, off: r.off }, policy);
    let v = 0;
    for (const o of res.outcomes) if (o.holder && findPlayer(s, o.holder)?.team === barik.team) v += o.p;
    memo.set(k, v);
    return v;
  };
}

/**
 * The 512 possible (D8, D8, D8) results as a table: T[a*64+b*8+c] = value of the landing for faces a+1, b+1, c+1;
 * with the averages over any re-rolled dice precomputed, every choice is a few table look-ups.
 */
function blastTables(target: Coord, value: (r: ScatterResult) => number) {
  const R: ScatterResult[] = [];
  const T = new Float64Array(512);
  for (let n = 0; n < 512; n++) {
    const r = scatterPath(target, [Math.floor(n / 64) + 1, (Math.floor(n / 8) % 8) + 1, (n % 8) + 1]);
    R.push(r);
    T[n] = value(r);
  }
  const idx = (a: number, b: number, c: number) => a * 64 + b * 8 + c;
  // Averages over the re-rolled dice (the kept dice fixed).
  const avg = (keepA: number | null, keepB: number | null, keepC: number | null) => {
    let sum = 0;
    let n = 0;
    for (let a = 0; a < 8; a++) {
      if (keepA !== null && a !== keepA) continue;
      for (let b = 0; b < 8; b++) {
        if (keepB !== null && b !== keepB) continue;
        for (let c = 0; c < 8; c++) {
          if (keepC !== null && c !== keepC) continue;
          sum += T[idx(a, b, c)];
          n++;
        }
      }
    }
    return sum / n;
  };
  const memo = new Map<string, number>();
  const ev = (a: number, b: number, c: number, sub: number[]) => {
    const k = `${sub.includes(0) ? '*' : a}${sub.includes(1) ? '*' : b}${sub.includes(2) ? '*' : c}`;
    let v = memo.get(k);
    if (v === undefined) {
      v = avg(sub.includes(0) ? null : a, sub.includes(1) ? null : b, sub.includes(2) ? null : c);
      memo.set(k, v);
    }
    return v;
  };
  const best = (a: number, b: number, c: number) => {
    let out = { choice: 'none', sub: [] as number[], ev: T[idx(a, b, c)] };
    for (const sub of BLAST_SUBSETS) {
      const v = ev(a, b, c, sub);
      if (v > out.ev + 1e-12) out = { choice: sub.join(''), sub, ev: v };
    }
    return out;
  };
  return { R, T, idx, best };
}

/** The best Blast It! choice for these three D8: 'none' or the re-rolled dice indices ('0', '12', '012'…). */
export function blastItBest(s: GameState, barik: Player, target: Coord, faces: number[], policy: ChainPolicy): { choice: string; ev: number; keep: number } {
  const t = blastTables(target, blastValue(s, barik, policy));
  const [a, b, c] = faces.map((f) => f - 1);
  const b0 = t.best(a, b, c);
  return { choice: b0.choice, ev: b0.ev, keep: t.T[t.idx(a, b, c)] };
}

const blastCache = new Map<string, Array<{ key: string; p: number; value: ScatterResult }>>();

/** Exact distribution of where Barik's Hail Mary comes down when Blast It! is used as blastItBest chooses. */
export function blastItOutcomes(s: GameState, barik: Player, target: Coord, policy: ChainPolicy): Array<{ key: string; p: number; value: ScatterResult }> {
  const tm = s.teams[s.turn.active];
  const ck = `${boardKey(s)}|${barik.id}|${target.x},${target.y}|${tm.rerolls},${tm.leaderReroll ? 1 : 0},${tm.mascotReroll ? 1 : 0},${s.turn.activation?.proUsed ? 1 : 0}|${policy.useSkillRerolls ? 1 : 0}${policy.usePro ? 1 : 0}${policy.useTeamRerolls ? 1 : 0}`;
  const cached = blastCache.get(ck);
  if (cached) return cached;
  const t = blastTables(target, blastValue(s, barik, policy));
  const W = new Float64Array(512);
  for (let a = 0; a < 8; a++)
    for (let b = 0; b < 8; b++)
      for (let c = 0; c < 8; c++) {
        const { sub } = t.best(a, b, c);
        const n = 8 ** sub.length;
        for (let x = 0; x < (sub.includes(0) ? 8 : 1); x++)
          for (let y = 0; y < (sub.includes(1) ? 8 : 1); y++)
            for (let z = 0; z < (sub.includes(2) ? 8 : 1); z++) W[t.idx(sub.includes(0) ? x : a, sub.includes(1) ? y : b, sub.includes(2) ? z : c)] += 1 / 512 / n;
      }
  const agg = new Map<string, { key: string; p: number; value: ScatterResult }>();
  for (let n = 0; n < 512; n++) {
    if (W[n] <= 0) continue;
    const r = t.R[n];
    const k = scatterKey(r);
    const e = agg.get(k);
    if (e) e.p += W[n];
    else agg.set(k, { key: k, p: W[n], value: r });
  }
  const out = [...agg.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  if (blastCache.size > 200) blastCache.clear();
  blastCache.set(ck, out);
  return out;
}

export { d6Success, inScoringEndZone };
