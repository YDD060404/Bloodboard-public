/**
 * Teaching helpers for the Block School course and the Basic Tutorials.
 *
 * Everything here is pure and dice-free: positions are built from workbook
 * diagrams, block strength is explained with the same code that resolves real
 * Blocks (blockStrength / assistReason, p.60-61, Guard p.129), and "what if"
 * questions (move a player, block someone first, choose a push square) are
 * answered by applying the change to a copy of the state and re-counting.
 */
import { adjacent, eq, inBounds, neighbours, pushSquares } from './board';
import { assistReason, blockStrength } from './block';
import { Ctx, DEFAULT_POLICY } from './context';
import { TraceDice } from './dice';
import { ROSTER_BY_ID } from './rosters';
import { customPlayer, newGame, playerFromPosition, startPlay } from './setup';
import { cloneState, findPlayer, getPlayer, label as fullLabel, other, pitchPlayers, playerAt } from './state';

/** Workbook players are called by their diagram name (X1, Y2…); other players by number and position. */
function label(p: Player): string {
  return /^[XY]\d+$/.test(p.name) ? p.name : fullLabel(p);
}
import type { Coord, GameState, Player, TeamId } from './types';

// ---------------------------------------------------------------------------
// Workbook positions
// ---------------------------------------------------------------------------

export interface WorkbookCell {
  id: string;
  col: number;
  row: number;
}

export interface WorkbookPosition {
  cells: WorkbookCell[];
  cols: number;
  rows: number;
  defaultST: number;
  strength: Record<string, number>;
  guard: string[];
}

/** Where the workbook grid sits on the pitch: centre field, away from sidelines and End Zones. */
export const LESSON_ORIGIN: Coord = { x: 9, y: 5 };

export function lessonSquare(col: number, row: number): Coord {
  return { x: LESSON_ORIGIN.x + col, y: LESSON_ORIGIN.y + row };
}

/** Workbook label of a pitch square (column letter A.., row number 1..), as printed in the workbook. */
export function lessonLabel(c: Coord): string {
  return `${String.fromCharCode(65 + c.x - LESSON_ORIGIN.x)}${c.y - LESSON_ORIGIN.y + 1}`;
}

export function parseLessonLabel(text: string): Coord | null {
  const m = /^\s*([A-Za-z])\s*(\d{1,2})\s*$/.exec(text);
  if (!m) return null;
  return lessonSquare(m[1].toUpperCase().charCodeAt(0) - 65, Number(m[2]) - 1);
}

/**
 * Build a playable position from a workbook diagram. X players are Team A,
 * Y players Team B; everyone is a generic MA 6 / AG 3+ / AV 9+ player with
 * the diagram's Strength and Guard. Team A is to play (Turn 1).
 */
export function buildWorkbookState(pos: WorkbookPosition, seed = 1): GameState {
  const s = newGame({ a: { name: 'X team' }, b: { name: 'Y team' }, seed });
  s.teams.A.color = '#1f4e9c';
  s.teams.A.accent = '#f4f1e8';
  s.teams.B.color = '#9c2a1f';
  s.teams.B.accent = '#f4f1e8';
  s.teams.A.rerolls = 0;
  s.teams.B.rerolls = 0;
  s.teams.A.turn = 1;
  s.teams.B.turn = 0;
  s.turn.active = 'A';
  for (const c of pos.cells) {
    const team: TeamId = c.id.startsWith('X') ? 'A' : 'B';
    const p = customPlayer(s, team, { position: 'Lineman', ma: 6, st: pos.strength[c.id] ?? pos.defaultST, ag: 3, pa: 4, av: 9, skills: pos.guard.includes(c.id) ? [{ id: 'guard' }] : [] }, lessonSquare(c.col, c.row));
    p.id = c.id;
    p.number = Number(c.id.slice(1)) || p.number;
    p.name = c.id;
    s.players.push(p);
  }
  s.ball = { kind: 'none' };
  return startPlay(s);
}

// ---------------------------------------------------------------------------
// Block dice, explained
// ---------------------------------------------------------------------------

export type DiceCode = '1D' | '2D' | '3D' | '-2D' | '-3D';

export function diceCode(dice: number, chooser: 'attacker' | 'defender'): DiceCode {
  if (dice === 1) return '1D';
  return (chooser === 'attacker' ? `${dice}D` : `-${dice}D`) as DiceCode;
}

export const DICE_CODE_TEXT: Record<DiceCode, string> = {
  '3D': '3 dice, the attacker chooses',
  '2D': '2 dice, the attacker chooses',
  '1D': '1 die',
  '-2D': '2 dice, the defender chooses',
  '-3D': '3 dice, the defender chooses',
};

export interface AssistLine {
  id: string;
  label: string;
  assists: boolean;
  guard: boolean;
  reason: string;
}

export interface BlockBreakdown {
  attacker: string;
  defender: string;
  attBase: number;
  defBase: number;
  offensive: AssistLine[];
  defensive: AssistLine[];
  attST: number;
  defST: number;
  dice: number;
  chooser: 'attacker' | 'defender';
  code: DiceCode;
  /** Step-by-step explanation (p.60-61). */
  lines: string[];
}

function assistLines(s: GameState, helpers: Player[], target: Player, attackerSide: boolean): AssistLine[] {
  return helpers.map((q) => {
    const why = assistReason(s, q, target, attackerSide);
    const guard = q.skills.some((k) => k.id === 'guard');
    let reason: string;
    if (why === null) {
      const marked = pitchPlayers(s, other(q.team)).filter((m) => m.id !== target.id && m.pos && q.pos && adjacent(m.pos, q.pos) && m.stance === 'standing' && !m.distracted);
      reason = marked.length ? `assists: Marked by ${marked.map(label).join(', ')}, but Guard lets it assist anyway` : `assists: it Marks ${label(target)} and no other opponent Marks it`;
    } else reason = `no assist: ${why}`;
    return { id: q.id, label: label(q), assists: why === null, guard, reason };
  });
}

/** Explain a Block's Strength comparison exactly as the engine counts it. */
export function blockBreakdown(s: GameState, attackerId: string, defenderId: string): BlockBreakdown {
  const att = getPlayer(s, attackerId);
  const def = getPlayer(s, defenderId);
  const ctx = new Ctx(cloneState(s), new TraceDice(), 'plan', [], DEFAULT_POLICY, null);
  const a2 = getPlayer(ctx.s, attackerId);
  const d2 = getPlayer(ctx.s, defenderId);
  const st = blockStrength(ctx, a2, d2, { isBlitz: false, declaredBlock: true });
  // Everyone next to the defender could assist the attacker; everyone next to the attacker could assist the defender.
  const near = (t: Player, team: TeamId, skip: string) => pitchPlayers(s, team).filter((q) => q.id !== skip && q.pos && t.pos && adjacent(q.pos, t.pos));
  const offensive = assistLines(s, near(def, att.team, att.id), def, true);
  const defensive = assistLines(s, near(att, def.team, def.id), att, false);
  const code = diceCode(st.dice, st.chooser);
  const lines: string[] = [];
  const offN = offensive.filter((x) => x.assists).length;
  const defN = defensive.filter((x) => x.assists).length;
  lines.push(`${label(att)} has ST ${att.st}; ${label(def)} has ST ${def.st}.`);
  if (offensive.length) for (const x of offensive) lines.push(`Offensive: ${x.label} — ${x.reason}.`);
  else lines.push(`Offensive: no other ${s.teams[att.team].name} player is next to ${label(def)}.`);
  if (defensive.length) for (const x of defensive) lines.push(`Defensive: ${x.label} — ${x.reason}.`);
  else lines.push(`Defensive: no other ${s.teams[def.team].name} player is next to ${label(att)}.`);
  for (const n of st.notes) lines.push(`Also: ${n}.`);
  lines.push(`Strength: ${att.st} + ${offN} = ${st.attST} against ${def.st} + ${defN} = ${st.defST}.`);
  if (st.attST === st.defST) lines.push('Equal Strength: 1 Block die (p.60).');
  else if (st.chooser === 'attacker') lines.push(st.dice === 3 ? `${st.attST} is more than double ${st.defST}: 3 dice, the attacker chooses (p.60).` : `${st.attST} is stronger (but not more than double): 2 dice, the attacker chooses (p.60).`);
  else lines.push(st.dice === 3 ? `${st.defST} is more than double ${st.attST}: 3 dice, the defender chooses (p.60).` : `${st.defST} is stronger (but not more than double): 2 dice, the defender chooses (p.60).`);
  return { attacker: att.id, defender: def.id, attBase: att.st, defBase: def.st, offensive, defensive, attST: st.attST, defST: st.defST, dice: st.dice, chooser: st.chooser, code, lines };
}

/** True when the Block is at least `dice` dice with the attacker choosing. */
export function meetsGoal(b: BlockBreakdown, dice = 2): boolean {
  return b.chooser === 'attacker' && b.dice >= dice;
}

// ---------------------------------------------------------------------------
// What-if questions (no dice, the original state is never changed)
// ---------------------------------------------------------------------------

export interface WhatIf {
  label: string;
  state: GameState;
  breakdown: BlockBreakdown;
}

/** Squares a player could reach with a plain Move (empty squares, at most `ma` steps, no Rushing). */
export function moveReach(s: GameState, playerId: string, ma?: number): Coord[] {
  const p = getPlayer(s, playerId);
  if (!p.pos) return [];
  const budget = ma ?? p.ma;
  const seen = new Map<string, number>([[`${p.pos.x},${p.pos.y}`, 0]]);
  const q: Coord[] = [p.pos];
  const out: Coord[] = [];
  while (q.length) {
    const c = q.shift() as Coord;
    const d = seen.get(`${c.x},${c.y}`) as number;
    if (d >= budget) continue;
    for (const n of neighbours(c)) {
      const k = `${n.x},${n.y}`;
      if (seen.has(k) || playerAt(s, n)) continue;
      seen.set(k, d + 1);
      out.push(n);
      q.push(n);
    }
  }
  return out;
}

export function whatIfMove(s: GameState, moverId: string, to: Coord, attackerId: string, defenderId: string): WhatIf {
  const t = cloneState(s);
  const p = getPlayer(t, moverId);
  p.pos = { ...to };
  return { label: `${label(p)} to ${lessonLabel(to)}`, state: t, breakdown: blockBreakdown(t, attackerId, defenderId) };
}

/** Empty squares a Block's target can be pushed into (p.62). Empty list = all three occupied (chain push) or off the pitch. */
export function pushOptions(s: GameState, attackerId: string, targetId: string): Coord[] {
  const a = getPlayer(s, attackerId);
  const d = getPlayer(s, targetId);
  if (!a.pos || !d.pos) return [];
  return pushSquares(a.pos, d.pos).filter((c) => inBounds(c) && !playerAt(s, c));
}

/**
 * Every position a first Block (`blockerId` on `targetId`) can leave, before
 * the final Block `finalAtt` on `finalDef`: target pushed into each free
 * square (standing or knocked down, with or without a follow-up), Both Down,
 * and Attacker Down. Chain pushes are not enumerated (reported by pushOptions
 * returning fewer squares).
 */
export function blockFirstOutcomes(s: GameState, blockerId: string, targetId: string, finalAtt: string, finalDef: string): WhatIf[] {
  const out: WhatIf[] = [];
  const blocker = getPlayer(s, blockerId);
  const target = getPlayer(s, targetId);
  const from = { ...(blocker.pos as Coord) };
  const tFrom = { ...(target.pos as Coord) };
  for (const sq of pushOptions(s, blockerId, targetId)) {
    for (const down of [false, true]) {
      for (const follow of [false, true]) {
        const t = cloneState(s);
        const tg = getPlayer(t, targetId);
        tg.pos = { ...sq };
        if (down) tg.stance = 'prone';
        if (follow) getPlayer(t, blockerId).pos = { ...tFrom };
        const verb = down ? 'knocked down' : 'pushed';
        out.push({ label: `${label(target)} ${verb} into ${lessonLabel(sq)}${follow ? `, ${label(blocker)} follows up` : ''}`, state: t, breakdown: blockBreakdown(t, finalAtt, finalDef) });
      }
    }
  }
  {
    const t = cloneState(s);
    getPlayer(t, targetId).stance = 'prone';
    getPlayer(t, blockerId).stance = 'prone';
    out.push({ label: `Both Down: ${label(blocker)} and ${label(target)} are knocked down in place`, state: t, breakdown: blockBreakdown(t, finalAtt, finalDef) });
  }
  {
    const t = cloneState(s);
    getPlayer(t, blockerId).stance = 'prone';
    out.push({ label: `Attacker Down: ${label(blocker)} is knocked down in ${lessonLabel(from)}`, state: t, breakdown: blockBreakdown(t, finalAtt, finalDef) });
  }
  return out.filter((w) => findPlayer(w.state, finalAtt)?.stance === 'standing');
}

/** Opponents a player could Block right now (adjacent, Standing). */
export function blockTargets(s: GameState, playerId: string): Player[] {
  const p = getPlayer(s, playerId);
  return pitchPlayers(s, other(p.team)).filter((q) => q.stance === 'standing' && q.pos && p.pos && adjacent(q.pos, p.pos));
}

export function sameSquare(a: Coord | null | undefined, b: Coord | null | undefined): boolean {
  return eq(a, b);
}

// ---------------------------------------------------------------------------
// Exercise checking (Block School)
// ---------------------------------------------------------------------------

export type ExerciseKindSpec = 'count' | 'moveOne' | 'normalMove' | 'blockFirst' | 'whoBlocks' | 'pushSquare';

export interface ExerciseSpec extends WorkbookPosition {
  kind: ExerciseKindSpec;
  attacker: string;
  defender: string;
  movers?: string[];
  blockers?: string[];
  firstTargets?: string[];
}

export type ExerciseAnswer =
  | { kind: 'count'; code: DiceCode }
  | { kind: 'move'; mover: string; to: Coord }
  | { kind: 'first'; blocker?: string; target: string }
  | { kind: 'push'; to: Coord };

export interface OutcomeLine {
  label: string;
  code: DiceCode;
  ok: boolean;
}

export interface ExerciseResult {
  correct: boolean;
  /** The answer in workbook notation (e.g. "2D", "B3", "X4 -> B4", "Y2"). */
  answerText: string;
  summary: string;
  breakdown?: BlockBreakdown;
  outcomes?: OutcomeLine[];
  /** For a move answer: the resulting position (for the board). */
  state?: GameState;
}

export interface ExerciseSolution {
  initial: BlockBreakdown;
  /** Every correct answer in workbook notation. */
  answers: string[];
  /** Explanation lines for the solution. */
  lines: string[];
  /** For count exercises: the correct code. */
  code?: DiceCode;
}

function inGrid(spec: ExerciseSpec, c: Coord): boolean {
  const col = c.x - LESSON_ORIGIN.x;
  const row = c.y - LESSON_ORIGIN.y;
  return col >= 0 && row >= 0 && col < spec.cols && row < spec.rows;
}

function allowedBlockers(s: GameState, spec: ExerciseSpec): string[] {
  if (spec.blockers && spec.blockers.length) return spec.blockers;
  return s.players.filter((p) => p.team === 'A' && p.id !== spec.attacker && p.location === 'pitch').map((p) => p.id);
}

function firstTargetsFor(s: GameState, spec: ExerciseSpec, blocker: string): string[] {
  return blockTargets(s, blocker)
    .map((q) => q.id)
    .filter((id) => id !== spec.defender && (!spec.firstTargets || spec.firstTargets.includes(id)));
}

/** Candidate moves for a move exercise (inside the printed grid). */
export function exerciseMoves(s: GameState, spec: ExerciseSpec): Array<{ mover: string; to: Coord }> {
  const out: Array<{ mover: string; to: Coord }> = [];
  for (const m of spec.movers ?? []) {
    const p = getPlayer(s, m);
    const squares = spec.kind === 'moveOne' ? neighbours(p.pos as Coord).filter((c) => !playerAt(s, c)) : moveReach(s, m, p.ma);
    for (const c of squares) if (inGrid(spec, c)) out.push({ mover: m, to: c });
  }
  return out;
}

function firstBlockOutcomes(s: GameState, spec: ExerciseSpec, blocker: string, target: string): OutcomeLine[] {
  return blockFirstOutcomes(s, blocker, target, spec.attacker, spec.defender).map((w) => ({ label: w.label, code: w.breakdown.code, ok: meetsGoal(w.breakdown) }));
}

function pushOutcomes(s: GameState, spec: ExerciseSpec, to: Coord): OutcomeLine[] {
  const blocker = (spec.blockers ?? [])[0];
  const target = (spec.firstTargets ?? [])[0];
  const out: OutcomeLine[] = [];
  for (const follow of [false, true]) {
    const t = cloneState(s);
    const tg = getPlayer(t, target);
    const from = { ...(tg.pos as Coord) };
    tg.pos = { ...to };
    if (follow) getPlayer(t, blocker).pos = from;
    const b = blockBreakdown(t, spec.attacker, spec.defender);
    out.push({ label: `${target} pushed into ${lessonLabel(to)}${follow ? `, ${blocker} follows up` : ', no follow-up'}`, code: b.code, ok: meetsGoal(b) });
  }
  return out;
}

/** Check one answer to an exercise. The state is never changed. */
export function checkExercise(spec: ExerciseSpec, answer: ExerciseAnswer): ExerciseResult {
  const s = buildWorkbookState(spec);
  if (answer.kind === 'count') {
    const b = blockBreakdown(s, spec.attacker, spec.defender);
    const ok = b.code === answer.code;
    return { correct: ok, answerText: answer.code, summary: ok ? `Correct: ${DICE_CODE_TEXT[b.code]}.` : `Not quite: it is ${b.code} (${DICE_CODE_TEXT[b.code]}), not ${answer.code}.`, breakdown: b };
  }
  if (answer.kind === 'move') {
    const here = eq(findPlayer(s, answer.mover)?.pos, answer.to);
    // A "normal Move" is optional: leaving the player where they are is an answer too.
    const legal = (here && spec.kind === 'normalMove') || exerciseMoves(s, spec).some((m) => m.mover === answer.mover && eq(m.to, answer.to));
    const text = (spec.movers ?? []).length > 1 ? `${answer.mover} -> ${lessonLabel(answer.to)}` : lessonLabel(answer.to);
    if (!legal) return { correct: false, answerText: text, summary: spec.kind === 'moveOne' ? `${answer.mover} can only move one square, into an empty square.` : `${answer.mover} cannot reach ${lessonLabel(answer.to)} with a normal Move (empty squares only, no Rushing).` };
    const w = whatIfMove(s, answer.mover, answer.to, spec.attacker, spec.defender);
    if (here) w.label = `${answer.mover} staying on ${lessonLabel(answer.to)}`;
    const ok = meetsGoal(w.breakdown);
    return { correct: ok, answerText: text, summary: ok ? `Yes: after ${w.label} X1's Block is ${w.breakdown.code}.` : `After ${w.label} X1's Block is ${w.breakdown.code} (${DICE_CODE_TEXT[w.breakdown.code]}) — the goal is 2D.`, breakdown: w.breakdown, state: w.state };
  }
  if (answer.kind === 'first') {
    const blockers = answer.blocker ? [answer.blocker] : allowedBlockers(s, spec).filter((b) => firstTargetsFor(s, spec, b).includes(answer.target));
    if (!blockers.length) return { correct: false, answerText: answer.blocker ?? answer.target, summary: `No allowed X player can Block ${answer.target} first.` };
    const lines: OutcomeLine[] = [];
    for (const b of blockers) {
      const targets = answer.blocker ? firstTargetsFor(s, spec, b) : [answer.target];
      for (const t of targets) for (const o of firstBlockOutcomes(s, spec, b, t)) lines.push({ ...o, label: `${b} blocks ${t}: ${o.label}` });
    }
    const ok = lines.some((l) => l.ok);
    const who = answer.blocker ?? answer.target;
    return {
      correct: ok,
      answerText: who,
      summary: ok ? `Yes: ${answer.blocker ? `a Block by ${who}` : `blocking ${who}`} can give X1 a 2D Block — with the right result (see the list).` : `No result of ${answer.blocker ? `a Block by ${who}` : `blocking ${who}`} gives X1 a 2D Block.`,
      outcomes: lines,
    };
  }
  const opts = pushOptions(s, (spec.blockers ?? [])[0], (spec.firstTargets ?? [])[0]);
  if (!opts.some((c) => eq(c, answer.to))) return { correct: false, answerText: lessonLabel(answer.to), summary: `${(spec.firstTargets ?? [])[0]} cannot be pushed into ${lessonLabel(answer.to)}: the push squares are ${opts.map(lessonLabel).join(', ')} (p.62).` };
  const lines = pushOutcomes(s, spec, answer.to);
  const ok = lines.some((l) => l.ok);
  return { correct: ok, answerText: lessonLabel(answer.to), summary: ok ? `Yes: with Y2 in ${lessonLabel(answer.to)} X1's Block can be 2D.` : `With Y2 in ${lessonLabel(answer.to)} X1's Block is still not 2D.`, outcomes: lines };
}

/** All correct answers, found by trying every legal choice. */
export function solveExercise(spec: ExerciseSpec): ExerciseSolution {
  const s = buildWorkbookState(spec);
  const initial = blockBreakdown(s, spec.attacker, spec.defender);
  const answers: string[] = [];
  const lines: string[] = [];
  if (spec.kind === 'count') {
    return { initial, answers: [initial.code], lines: initial.lines, code: initial.code };
  }
  lines.push(`As printed, X1's Block on Y1 is ${initial.code} (ST ${initial.attST} v ${initial.defST}).`);
  if (spec.kind === 'moveOne' || spec.kind === 'normalMove') {
    const stay = spec.kind === 'normalMove' ? (spec.movers ?? []).map((m) => ({ mover: m, to: { ...(getPlayer(s, m).pos as Coord) } })) : [];
    for (const m of [...stay, ...exerciseMoves(s, spec)]) {
      const r = checkExercise(spec, { kind: 'move', mover: m.mover, to: m.to });
      if (r.correct) {
        answers.push(r.answerText);
        lines.push(`${m.mover} to ${lessonLabel(m.to)}: ${r.breakdown?.code} (ST ${r.breakdown?.attST} v ${r.breakdown?.defST}).`);
      }
    }
  } else if (spec.kind === 'blockFirst') {
    const targets = new Set<string>();
    for (const b of allowedBlockers(s, spec)) for (const t of firstTargetsFor(s, spec, b)) targets.add(t);
    for (const t of [...targets].sort()) {
      const r = checkExercise(spec, { kind: 'first', target: t });
      if (r.correct) {
        answers.push(t);
        for (const o of r.outcomes ?? []) if (o.ok) lines.push(`${o.label} → ${o.code}.`);
      }
    }
  } else if (spec.kind === 'whoBlocks') {
    for (const b of allowedBlockers(s, spec)) {
      const r = checkExercise(spec, { kind: 'first', blocker: b, target: '' });
      if (r.correct) {
        answers.push(b);
        for (const o of r.outcomes ?? []) if (o.ok) lines.push(`${o.label} → ${o.code}.`);
      }
    }
  } else if (spec.kind === 'pushSquare') {
    for (const c of pushOptions(s, (spec.blockers ?? [])[0], (spec.firstTargets ?? [])[0])) {
      const r = checkExercise(spec, { kind: 'push', to: c });
      if (r.correct) {
        answers.push(lessonLabel(c));
        for (const o of r.outcomes ?? []) if (o.ok) lines.push(`${o.label} → ${o.code}.`);
      }
    }
  }
  if (!answers.length) lines.push('No choice reaches a 2D Block for X1.');
  return { initial, answers, lines };
}

/** Parse a workbook answer ("2D", "B3", "X4 -> B4", "Y2", "D1") into an ExerciseAnswer for this exercise. */
export function parseWorkbookAnswer(spec: ExerciseSpec, text: string): ExerciseAnswer | null {
  const t = text.trim();
  if (spec.kind === 'count') return ['1D', '2D', '3D', '-2D', '-3D'].includes(t) ? { kind: 'count', code: t as DiceCode } : null;
  if (spec.kind === 'moveOne' || spec.kind === 'normalMove') {
    const m = /^(X\d+)\s*->\s*([A-Z]\d+)$/.exec(t);
    const mover = m ? m[1] : (spec.movers ?? [])[0];
    const sq = parseLessonLabel(m ? m[2] : t);
    return mover && sq ? { kind: 'move', mover, to: sq } : null;
  }
  if (spec.kind === 'whoBlocks') return { kind: 'first', blocker: t, target: '' };
  if (spec.kind === 'blockFirst') return { kind: 'first', target: t };
  const sq = parseLessonLabel(t);
  return sq ? { kind: 'push', to: sq } : null;
}

// ---------------------------------------------------------------------------
// Tutorial scenarios and objectives (Basic Tutorials)
// ---------------------------------------------------------------------------

export interface ScenarioPlayer {
  id: string;
  team: TeamId;
  roster: string;
  position: string;
  at: [number, number];
  number?: number;
  stance?: Player['stance'];
  /** Extra Skills/Traits (e.g. a trait from a roster that is not included). */
  extraSkills?: Array<{ id: string; value?: number }>;
}

export interface ScenarioSpec {
  teams: { A: { name: string; roster: string }; B: { name: string; roster: string } };
  players: ScenarioPlayer[];
  ball?: { at: [number, number] } | { holder: string } | null;
  rerolls?: { A: number; B: number };
  turn?: { A: number; B: number };
  weather?: GameState['weather'];
}

/** Build a ready-to-play position (Team A to play) from a scenario description. */
export function buildScenario(spec: ScenarioSpec, seed: number): GameState {
  const s = newGame({ a: spec.teams.A, b: spec.teams.B, seed, weather: spec.weather });
  s.teams.A.rerolls = spec.rerolls?.A ?? 1;
  s.teams.B.rerolls = spec.rerolls?.B ?? 1;
  s.teams.A.turn = spec.turn?.A ?? 3;
  s.teams.B.turn = spec.turn?.B ?? 2;
  s.turn.active = 'A';
  for (const sp of spec.players) {
    const r = ROSTER_BY_ID[sp.roster];
    const pos = r?.positions.find((x) => x.id === sp.position);
    if (!pos) throw new Error(`Unknown roster position ${sp.roster}/${sp.position}`);
    const p = playerFromPosition(s, sp.team, pos, { x: sp.at[0], y: sp.at[1] }, sp.number);
    p.id = sp.id;
    if (sp.stance) p.stance = sp.stance;
    if (sp.extraSkills) p.skills = [...p.skills, ...sp.extraSkills.map((k) => ({ ...k }))];
    s.players.push(p);
  }
  for (const t of ['A', 'B'] as TeamId[]) s.teams[t].leaderReroll = s.players.some((p) => p.team === t && p.skills.some((k) => k.id === 'leader'));
  const b = spec.ball;
  if (b && 'holder' in b) s.ball = { kind: 'held', playerId: b.holder };
  else if (b && 'at' in b) s.ball = { kind: 'ground', pos: { x: b.at[0], y: b.at[1] } };
  else s.ball = { kind: 'none' };
  return startPlay(s);
}

export type TutorialGoal =
  | { kind: 'touchdown' }
  | { kind: 'reach'; player: string; area: [number, number, number, number] }
  | { kind: 'holds'; player: string }
  | { kind: 'down'; player: string }
  | { kind: 'action'; action: string }
  | { kind: 'info' };

export interface GoalCheck {
  done: boolean;
  failed: boolean;
  text: string;
}

/** Has the tutorial's objective been reached (or has the attempt failed)? */
export function checkGoal(s: GameState, goal: TutorialGoal, startLogLength = 0): GoalCheck {
  const entries = s.log.slice(startLogLength);
  const turnover = entries.some((e) => e.outcome === 'turnover');
  let done = false;
  let text = '';
  switch (goal.kind) {
    case 'touchdown':
      done = s.teams.A.score > 0 || entries.some((e) => e.outcome === 'touchdown');
      text = done ? 'Touchdown!' : '';
      break;
    case 'reach': {
      const p = findPlayer(s, goal.player);
      const [x0, y0, x1, y1] = goal.area;
      done = !!p && p.location === 'pitch' && p.stance === 'standing' && !!p.pos && p.pos.x >= x0 && p.pos.x <= x1 && p.pos.y >= y0 && p.pos.y <= y1;
      text = done ? `${p ? label(p) : goal.player} made it.` : '';
      break;
    }
    case 'holds': {
      done = s.ball.kind === 'held' && s.ball.playerId === goal.player;
      text = done ? 'The ball is safely held.' : '';
      break;
    }
    case 'down': {
      const p = findPlayer(s, goal.player);
      done = !!p && (p.location !== 'pitch' || p.stance !== 'standing');
      text = done ? `${p ? label(p) : goal.player} is down.` : '';
      break;
    }
    case 'action':
      done = entries.some((e) => e.input.kind === 'playerAction' && e.input.action === goal.action && e.outcome !== 'turnover');
      text = done ? 'Action completed.' : '';
      break;
    case 'info':
      return { done: false, failed: false, text: '' };
  }
  const failed = !done && (turnover || s.phase !== 'play');
  if (failed) text = turnover ? 'Turnover — the attempt failed. Reset to try again with the same dice, or pick a new seed.' : 'The Drive is over.';
  return { done, failed, text };
}
