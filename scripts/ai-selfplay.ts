/**
 * Computer-opponent calibration: whole matches computer vs computer with the
 * engine's normal random dice (several seeds, every style pairing, both
 * rosters on both sides) and a report of how the decisions were made, per
 * style: objectives, action types, Turnovers and how likely the AI thought
 * they were, declined scoring chances, avoidable risks, ball security, think
 * time. Usage (after `npm run build`):
 *   node build/ai-selfplay.mjs [matches=6] [firstSeed=1] [--verbose] [--md] [--sevens]
 * `--sevens` plays Blood Bowl Sevens matches (Human and Orc Sevens teams, Spike! Journal 22).
 * `--md` prints the Markdown table used in docs/AI_OPPONENT.md.
 */
import * as Engine from '../src/engine/index';
import { createMatch, decide, execute, newTeamDef, playerFromRoster, ROSTER_BY_ID, validateState, type ExecutionResult, type GameState, type TeamDef, type TeamId } from '../src/engine/index';
import { BASE_WEIGHTS, bindEngine, nextMove, waitingFor, type AIDecision, type AIStyle } from '../src/ai/index';

declare const process: { argv: string[]; exit(n: number): never };
bindEngine(Engine);

function team(id: string, rosterId: string, comp: Array<[string, number]>, rerolls: number): TeamDef {
  const t = newTeamDef('tournament', rosterId, `${rosterId} ${id}`, id);
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  t.rerolls = rerolls;
  t.apothecary = true;
  return t;
}
export const HUMANS = () => team('hum', 'human', [['lineman', 7], ['blitzer', 2], ['catcher', 2], ['thrower', 1]], 3);
export const ORCS = () => team('orc', 'orc', [['lineman', 7], ['blitzer', 2], ['bigUn', 2]], 3);
/** Blood Bowl Sevens teams (600k: 2 Blitzers, a Catcher / Big Un, Linemen, one re-roll, a Veteran Lineman). */
function sevensTeam(id: string, rosterId: string, comp: Array<[string, number]>): TeamDef {
  const t = newTeamDef('tournament', rosterId, `${rosterId} sevens`, id, 'sevens');
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  t.rerolls = 1;
  t.apothecary = false;
  const vet = t.players.find((p) => p.keywords.includes('Lineman'));
  if (vet) Engine.setVeteran(t, vet.id);
  return t;
}
export const HUMANS7 = () => sevensTeam('hum7', 'human', [['blitzer', 2], ['catcher', 1], ['lineman', 5]]);
export const ORCS7 = () => sevensTeam('orc7', 'orc', [['blitzer', 2], ['bigUn', 1], ['lineman', 4]]);
let SEVENS = false;

/** Decision statistics of one computer coach. */
export interface CoachStats {
  style: AIStyle;
  roster: string;
  tds: number;
  actions: number;
  objectives: Record<string, number>;
  kinds: Record<string, number>;
  turnovers: number;
  /** Turnovers whose action the AI had given < 10% Turnover risk (bad luck, not bad play). */
  unlikelyTurnovers: number;
  /** Sum of the AI's own Turnover estimates for its chosen actions (expected Turnovers). */
  expectedTurnovers: number;
  /** A clearly safer, useful alternative (≥ 20 points less Turnover risk, value > 0.5) was within 1.5 value points of the chosen, risky action. */
  avoidableRisks: string[];
  /** Turns in which an action with ≥ 60% to score was available but the Turn ended without a Touchdown attempt. */
  declinedScores: string[];
  /** Touchdown attempts (chosen actions with a scoring chance) and their average chance. */
  tdAttempts: number;
  tdAttemptChance: number;
  /** Ball lost during its own action (the AI's estimate for that action in brackets). */
  ballLostOwnAction: string[];
  /** Held the ball at the end of its Turn and no longer at the start of its next one. */
  ballLostOppTurn: number;
  turnsWithBall: number;
  thinkMs: number[];
  /** V4 crowd metrics — own Standing players on an edge square (sideline / end line) when the Turn passes. */
  edgeEnds: number;
  /** … of which an opposing Standing player already stands on a square that would push them into the crowd. */
  exposedAdjacent: number;
  /** … of which such a square is empty but an opposing player could reach it (Blitz range, MA + 2). */
  exposedReach: number;
  /** Own players actually pushed into the crowd, and what the crowd did to them. */
  crowdPushed: number;
  crowdResults: Record<string, number>;
  /** Opposing players this coach pushed into the crowd. */
  crowdCaused: number;
  /** V4 Fouls: declared, own players Sent-off, fouled players removed (KO / Casualty). */
  fouls: number;
  sentOff: number;
  foulRemoved: number;
}

function coach(style: AIStyle, roster: string): CoachStats {
  return { style, roster, tds: 0, actions: 0, objectives: {}, kinds: {}, turnovers: 0, unlikelyTurnovers: 0, expectedTurnovers: 0, avoidableRisks: [], declinedScores: [], tdAttempts: 0, tdAttemptChance: 0, ballLostOwnAction: [], ballLostOppTurn: 0, turnsWithBall: 0, thinkMs: [], edgeEnds: 0, exposedAdjacent: 0, exposedReach: 0, crowdPushed: 0, crowdResults: {}, crowdCaused: 0, fouls: 0, sentOff: 0, foulRemoved: 0 };
}

export interface MatchStats {
  seed: number;
  score: Record<TeamId, number>;
  coaches: Record<TeamId, CoachStats>;
  illegal: string[];
  seconds: number;
}

const onEdge = (c: { x: number; y: number }) => c.x === 0 || c.x === Engine.pitch().w - 1 || c.y === 0 || c.y === Engine.pitch().h - 1;
const cheb = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Crowd exposure of `team` when its Turn has passed (uses the engine's own push rule). */
function exposure(s: GameState, team: TeamId, c: CoachStats) {
  const opp = s.players.filter((q) => q.team !== team && q.location === 'pitch' && q.pos && q.stance === 'standing');
  for (const p of s.players) {
    if (p.team !== team || p.location !== 'pitch' || !p.pos || p.stance !== 'standing' || !onEdge(p.pos)) continue;
    c.edgeEnds++;
    const sq = Engine.crowdPushSquares(s, p);
    if (!sq.length) continue;
    if (sq.some((a) => opp.some((q) => !q.distracted && q.pos!.x === a.x && q.pos!.y === a.y))) c.exposedAdjacent++;
    else if (sq.some((a) => !Engine.playerAt(s, a) && opp.some((q) => cheb(q.pos!, a) <= q.ma + 2))) c.exposedReach++;
  }
}

/** Crowd pushes in the whole match log: victims per team and the crowd's injury result. */
function crowdLog(s: GameState, coaches: Record<TeamId, CoachStats>) {
  for (const entry of s.log) {
    const ev = entry.events;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      const d = e.data as { crowd?: boolean; playerId?: string } | undefined;
      if (e.type !== 'push' || !d?.crowd || !d.playerId) continue;
      const victim = Engine.findPlayer(s, d.playerId);
      if (!victim) continue;
      const c = coaches[victim.team];
      c.crowdPushed++;
      coaches[victim.team === 'A' ? 'B' : 'A'].crowdCaused++;
      const inj = ev.slice(i + 1).find((x) => x.type === 'injury' && (x.data as { playerId?: string } | undefined)?.playerId === d.playerId);
      const r = String((inj?.data as { result?: string } | undefined)?.result ?? 'unknown');
      c.crowdResults[r] = (c.crowdResults[r] ?? 0) + 1;
    }
  }
}

const holds = (s: GameState, t: TeamId) => s.ball.kind === 'held' && Engine.findPlayer(s, s.ball.playerId)?.team === t;

export function playMatch(seed: number, styles: Record<TeamId, AIStyle>, swap = false, verbose = false): MatchStats {
  const t0 = Date.now();
  const [a, b] = SEVENS ? (swap ? [ORCS7(), HUMANS7()] : [HUMANS7(), ORCS7()]) : swap ? [ORCS(), HUMANS()] : [HUMANS(), ORCS()];
  const r = createMatch('tournament', a, b, { rules: 'full' }, seed);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  let s = r.state as GameState;
  const st: MatchStats = { seed, score: { A: 0, B: 0 }, coaches: { A: coach(styles.A, a.rosterId ?? '?'), B: coach(styles.B, b.rosterId ?? '?') }, illegal: [], seconds: 0 };
  // Per Turn: best scoring chance seen, whether a scoring attempt was made.
  let turnKey = '';
  let bestTD = 0;
  let bestTDLabel = '';
  let attempted = false;
  let lastChoice = '';
  const heldAtEnd: Record<TeamId, boolean> = { A: false, B: false };
  const closeTurn = (team: TeamId, key: string) => {
    const c = st.coaches[team];
    if (bestTD >= 0.6 && !attempted) c.declinedScores.push(`${key}: ${bestTDLabel} (${Math.round(bestTD * 100)}% to score) was available; the Turn ended after ${lastChoice}`);
  };
  let guard = 0;
  while (s.phase !== 'fullTime') {
    if (guard++ > 4000) throw new Error(`match ${seed} did not finish (phase ${s.phase})`);
    const who = waitingFor(s);
    let res: ExecutionResult;
    if (!who) {
      res = execute(s, s.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' });
    } else {
      const mv = nextMove(s, who, styles[who]);
      if (!mv) throw new Error(`no move for ${who} in phase ${s.phase}`);
      if (mv.type === 'decision') res = decide(s, { requestId: mv.requestId, optionId: mv.optionId });
      else if (mv.type === 'step') res = execute(s, mv.input);
      else {
        const c = st.coaches[who];
        const key = `${who} half ${s.match?.half} Turn ${s.teams[who].turn}`;
        if (key !== turnKey) {
          // A new Turn of `who` starts.
          if (s.phase === 'play' && !s.match?.pendingPhase) {
            if (heldAtEnd[who] && !holds(s, who)) c.ballLostOppTurn++;
            if (holds(s, who)) c.turnsWithBall++;
          }
          turnKey = key;
          bestTD = 0;
          attempted = false;
        }
        const d: AIDecision = mv.decision;
        c.thinkMs.push(d.millis);
        c.actions++;
        c.objectives[d.objective.id] = (c.objectives[d.objective.id] ?? 0) + 1;
        const kind = d.chosen ? d.chosen.kind : 'endTurn';
        c.kinds[kind] = (c.kinds[kind] ?? 0) + 1;
        for (const k of d.candidates)
          if (!k.error && (k.pTouchdown ?? 0) > bestTD) {
            bestTD = k.pTouchdown as number;
            bestTDLabel = k.label;
          }
        const ch = d.chosen;
        lastChoice = ch ? ch.label : 'End Turn';
        if (ch) {
          c.expectedTurnovers += ch.pTurnover ?? 0;
          if ((ch.pTouchdown ?? 0) > 0.05) {
            attempted = true;
            c.tdAttempts++;
            c.tdAttemptChance += ch.pTouchdown as number;
          }
          // A useful action (worth more than the AI's threshold) that is much safer and nearly as good.
          const safer = d.candidates.find((k) => k !== ch && !k.error && k.gain !== undefined && (k.gain as number) > 0.5 && (k.pTurnover ?? 1) <= (ch.pTurnover ?? 0) - 0.2 && (k.gain as number) >= (ch.gain as number) - 1.5);
          if (safer) c.avoidableRisks.push(`${key}: ${ch.label} (Turnover ${Math.round((ch.pTurnover ?? 0) * 100)}%, value ${ch.gain?.toFixed(1)}) over ${safer.label} (Turnover ${Math.round((safer.pTurnover ?? 0) * 100)}%, value ${safer.gain?.toFixed(1)})`);
        } else closeTurn(who, key);
        if (verbose) console.log(`[${key}] ${d.reason} (${d.millis} ms)`);
        const hadBall = holds(s, who);
        res = execute(s, mv.input);
        if (res.status === 'illegal') {
          st.illegal.push(`${key}: ${ch?.label ?? 'end turn'}: ${res.error}`);
          res = execute(s, { kind: 'endTurn' });
        }
        while (res.status === 'awaitingDecision' && res.state.pending) {
          const t2 = res.state.pending.request.team;
          const a2 = nextMove(res.state, t2, styles[t2]);
          if (!a2 || a2.type !== 'decision') throw new Error('expected a decision');
          res = decide(res.state, { requestId: a2.requestId, optionId: a2.optionId });
        }
        if (ch?.kind === 'foul') {
          c.fouls++;
          const fin = res.state;
          const tgt = ch.input.kind === 'playerAction' ? ch.input.foulTarget : undefined;
          const tq = tgt ? fin.players.find((q) => q.id === tgt) : undefined;
          if (tq && (tq.location === 'ko' || tq.location === 'cas')) c.foulRemoved++;
          const fq = fin.players.find((q) => q.id === ch.playerId);
          if (fq && fq.location === 'sentOff') c.sentOff++;
        }
        if (res.status === 'turnover') {
          c.turnovers++;
          if (ch && (ch.pTurnover ?? 0) < 0.1) c.unlikelyTurnovers++;
        }
        if (hadBall && !holds(res.state, who) && res.status !== 'touchdown' && res.state.phase !== 'touchdown') c.ballLostOwnAction.push(`${key}: ${ch?.label ?? 'end of Turn'} (estimated ${Math.round((ch?.pBallLost ?? 0) * 100)}%)`);
        // The Turn passed to the opponent: remember whether we still had the ball.
        if (res.state.phase !== 'play' || res.state.turn.active !== who) {
          if (res.state.phase === 'play') exposure(res.state, who, c);
          heldAtEnd[who] = holds(res.state, who);
          if (ch) closeTurn(who, key);
          turnKey = '';
        }
      }
    }
    if (res.status === 'illegal') throw new Error(`illegal ${who ?? 'neutral'} input in ${s.phase}: ${res.error}`);
    s = res.state;
    const errs = validateState(s);
    if (errs.length) throw new Error(`invalid state: ${JSON.stringify(errs).slice(0, 300)}`);
  }
  crowdLog(s, st.coaches);
  st.score = { A: s.teams.A.score, B: s.teams.B.score };
  st.coaches.A.tds = s.teams.A.score;
  st.coaches.B.tds = s.teams.B.score;
  st.seconds = (Date.now() - t0) / 1000;
  return st;
}

const PAIRS: Array<Record<TeamId, AIStyle>> = [
  { A: 'balanced', B: 'balanced' },
  { A: 'offensive', B: 'defensive' },
  { A: 'defensive', B: 'offensive' },
  { A: 'offensive', B: 'balanced' },
  { A: 'balanced', B: 'defensive' },
  { A: 'defensive', B: 'defensive' },
];

function pctOf(n: number, d: number) {
  return d ? `${Math.round((100 * n) / d)}%` : '–';
}

function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  SEVENS = args.includes('--sevens');
  const md = args.includes('--md');
  // --crowd=0 switches V4's sideline term off: the V3 opponent's behaviour, for before/after comparisons.
  const crowdArg = args.find((a) => a.startsWith('--crowd='));
  if (crowdArg) BASE_WEIGHTS.crowd = Number(crowdArg.slice(8));
  const nums = args.filter((a) => !a.startsWith('--')).map(Number);
  const n = nums[0] || 6;
  const first = nums[1] || 1;
  const all: MatchStats[] = [];
  for (let i = 0; i < n; i++) {
    const seed = first + i;
    const styles = PAIRS[i % PAIRS.length];
    const swap = Math.floor(i / PAIRS.length) % 2 === 1;
    const m = playMatch(seed, styles, swap, verbose);
    all.push(m);
    const ms = [...m.coaches.A.thinkMs, ...m.coaches.B.thinkMs].sort((x, y) => x - y);
    console.log(`seed ${seed}: ${m.coaches.A.style} ${m.coaches.A.roster} ${m.score.A}-${m.score.B} ${m.coaches.B.roster} ${m.coaches.B.style} | ${m.coaches.A.actions + m.coaches.B.actions} actions | think median ${ms[ms.length >> 1]} ms, 95% ${ms[Math.floor(ms.length * 0.95)]} ms, max ${ms[ms.length - 1]} ms | ${m.seconds.toFixed(0)} s${m.illegal.length ? ` | ILLEGAL ${m.illegal.join('; ')}` : ''}`);
  }
  // Aggregate per style.
  const by = new Map<AIStyle, CoachStats[]>();
  for (const m of all) for (const t of ['A', 'B'] as TeamId[]) by.set(m.coaches[t].style, [...(by.get(m.coaches[t].style) ?? []), m.coaches[t]]);
  const rows: string[] = [];
  const kindsAll = ['move', 'carry', 'block', 'blitz', 'standUp', 'pickup', 'secure', 'handoff', 'pass', 'score', 'continue', 'foul', 'endTurn'];
  for (const [style, cs] of by) {
    const sum = (f: (c: CoachStats) => number) => cs.reduce((a, c) => a + f(c), 0);
    const actions = sum((c) => c.actions);
    const kinds: Record<string, number> = {};
    for (const c of cs) for (const [k, v] of Object.entries(c.kinds)) kinds[k] = (kinds[k] ?? 0) + v;
    const objs: Record<string, number> = {};
    for (const c of cs) for (const [k, v] of Object.entries(c.objectives)) objs[k] = (objs[k] ?? 0) + v;
    const top = Object.entries(kinds).sort((x, y) => y[1] - x[1])[0];
    const nonEnd = actions - (kinds.endTurn ?? 0);
    const think = cs.flatMap((c) => c.thinkMs).sort((x, y) => x - y);
    rows.push(
      [
        style,
        cs.length,
        (sum((c) => c.tds) / cs.length).toFixed(2),
        sum((c) => c.tdAttempts) ? `${sum((c) => c.tdAttempts)} (avg ${Math.round((100 * sum((c) => c.tdAttemptChance)) / sum((c) => c.tdAttempts))}%)` : '0',
        sum((c) => c.declinedScores.length),
        `${sum((c) => c.turnovers)} (exp. ${sum((c) => c.expectedTurnovers).toFixed(1)}, unlikely ${sum((c) => c.unlikelyTurnovers)})`,
        sum((c) => c.avoidableRisks.length),
        `${sum((c) => c.ballLostOwnAction.length)} / ${sum((c) => c.ballLostOppTurn)} of ${sum((c) => c.turnsWithBall)}`,
        kindsAll.filter((k) => kinds[k]).map((k) => `${k} ${pctOf(kinds[k], actions)}`).join(', '),
        `${top[0]} ${pctOf(top[1], nonEnd + (top[0] === 'endTurn' ? kinds.endTurn : 0))}`,
        Object.entries(objs).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${pctOf(v, actions)}`).join(', '),
        `${think[think.length >> 1]} / ${think[Math.floor(think.length * 0.95)]} ms`,
        `${sum((c) => c.edgeEnds)} / ${sum((c) => c.exposedAdjacent)} / ${sum((c) => c.exposedReach)}`,
        `${sum((c) => c.crowdPushed)} (${Object.entries(cs.reduce((acc, c) => { for (const [k, v] of Object.entries(c.crowdResults)) acc[k] = (acc[k] ?? 0) + v; return acc; }, {} as Record<string, number>)).map(([k, v]) => `${k} ${v}`).join(', ') || '–'}) / caused ${sum((c) => c.crowdCaused)}`,
      ].join(' | '),
    );
  }
  const head = '| Style | Coach-matches | TDs per match | TD attempts (avg chance) | Declined ≥60% chances | Turnovers (expected, unlikely) | Avoidable risks | Ball lost: own action / opp. Turn (of Turns with ball) | Action mix | Most common | Objectives | Think median / 95% | Edge at Turn end / pushable now / in Blitz reach | Pushed into the crowd (result) / caused |';
  const sep = '|' + '---|'.repeat(14);
  console.log(`\n${md ? '' : 'Per style:\n'}${head}\n${sep}\n${rows.map((r) => `| ${r} |`).join('\n')}`);
  const details = (f: (c: CoachStats) => string[], title: string) => {
    const list = all.flatMap((m) => (['A', 'B'] as TeamId[]).flatMap((t) => f(m.coaches[t]).map((x) => `seed ${m.seed} ${m.coaches[t].style}: ${x}`)));
    if (list.length) console.log(`\n${title} (${list.length}):\n${list.slice(0, 12).map((x) => `  - ${x}`).join('\n')}`);
  };
  details((c) => c.declinedScores, 'Declined scoring chances');
  details((c) => c.avoidableRisks, 'Avoidable risks');
  details((c) => c.ballLostOwnAction, 'Ball lost during its own action');
  const illegal = all.reduce((a, m) => a + m.illegal.length, 0);
  const tot = (f: (c: CoachStats) => number) => all.reduce((a, m) => a + f(m.coaches.A) + f(m.coaches.B), 0);
  console.log(`\nCrowd: ${tot((c) => c.edgeEnds)} player-Turn-ends on an edge square, ${tot((c) => c.exposedAdjacent)} with an opponent already on a crowd-push square, ${tot((c) => c.exposedReach)} with one in Blitz reach; ${tot((c) => c.crowdPushed)} players pushed into the crowd.`);
  const turnovers = tot((c) => c.turnovers);
  const expected = tot((c) => c.expectedTurnovers);
  const lostOwn = tot((c) => c.ballLostOwnAction.length);
  const lostOpp = tot((c) => c.ballLostOppTurn);
  const declined = tot((c) => c.declinedScores.length);
  const avoid = tot((c) => c.avoidableRisks.length);
  const thinkAll = all.flatMap((m) => [...m.coaches.A.thinkMs, ...m.coaches.B.thinkMs]).sort((x, y) => x - y);
  console.log(`SUMMARY matches=${all.length} tds=${all.reduce((a, m) => a + m.score.A + m.score.B, 0)} turnovers=${turnovers} expectedTurnovers=${expected.toFixed(1)} ballLostOwn=${lostOwn} ballLostOppTurn=${lostOpp} declined=${declined} avoidable=${avoid} edgeEnds=${tot((c) => c.edgeEnds)} exposedAdjacent=${tot((c) => c.exposedAdjacent)} exposedReach=${tot((c) => c.exposedReach)} crowdPushed=${tot((c) => c.crowdPushed)} fouls=${tot((c) => c.fouls)} sentOff=${tot((c) => c.sentOff)} foulRemoved=${tot((c) => c.foulRemoved)} thinkMedian=${thinkAll[thinkAll.length >> 1]} think95=${thinkAll[Math.floor(thinkAll.length * 0.95)]} thinkMax=${thinkAll[thinkAll.length - 1]} illegal=${illegal}`);
  console.log(`\n${all.length} matches, ${all.reduce((a, m) => a + m.score.A + m.score.B, 0)} Touchdowns, illegal inputs: ${illegal}.`);
  if (illegal) process.exit(1);
}

if (process.argv[1] && /ai-selfplay/.test(process.argv[1])) main();
