/**
 * V5.5: the computer coach compared with the V5 step 6 coach (item 9 of the V5.5 request). Whole matches with the
 * engine's normal seeded dice, paired: each seed and pair of rosters is played twice with the coaches on swapped
 * sides, in both formats. Reports win / draw / loss, Touchdown difference and behaviour metrics per coach.
 *
 *   esbuild scripts/ai-compare.ts --bundle --platform=node --format=esm --outfile=build/ai-compare.mjs
 *   node build/ai-compare.mjs [--sevens] [--pairs=4] [--seed=1] [--new=<AI file id>] [--md]
 *
 * "old" = the V5 step 6 AI (scripts/baseline/v5-step6-ai, balanced), "new" = V5.5's built-in algorithm with an AI file.
 */
import * as Engine from '../src/engine/index';
import { buildTeam, createMatch, decide, execute, validateInput, type ActionInput, type GameState, type TeamDef, type TeamId } from '../src/engine/index';
import * as NewAI from '../src/ai/index';
import * as OldAI from './baseline/v5-step6-ai/index';

declare const process: { argv: string[]; exit(n: number): never; stdout: { write(s: string): void } };
NewAI.bindEngine(Engine);
OldAI.bindEngine(Engine as never);

const arg = (k: string, d: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const SEVENS = process.argv.includes('--sevens');
const PAIRS = Number(arg('pairs', '4'));
const SEED0 = Number(arg('seed', '1'));
const NEW_ID = arg('new', 'bloodboard-balanced');
const newFile = NewAI.BUNDLED_FILES.find((f) => f.id === NEW_ID);

type Move = { type: 'decision'; requestId: string; optionId: string } | { type: 'step'; input: ActionInput } | { type: 'action'; input: ActionInput; decision: { candidates: Array<{ kind: string; gain?: number; pTurnover?: number; error?: string }>; chosen: unknown } };
interface Coach {
  name: string;
  move: (s: GameState, t: TeamId) => Move | null;
}
const NEW: Coach = { name: `new (${NEW_ID})`, move: (s, t) => NewAI.nextMove(s, t, 'balanced', {}, { profile: newFile }) as Move | null };
const OLD: Coach = { name: 'old (V5 step 6)', move: (s, t) => OldAI.nextMove(s as never, t, 'balanced') as unknown as Move | null };

interface Stats {
  games: number;
  win: number;
  draw: number;
  loss: number;
  tdFor: number;
  tdAgainst: number;
  turnovers: number;
  actions: number;
  blocks: number;
  endTurns: number;
  /** Ended the Turn although a Block / Blitz with a positive value and < 10% Turnover risk was on offer. */
  passiveEnds: number;
  casCaused: number;
  koCaused: number;
  casSuffered: number;
  koSuffered: number;
  crowdSurfed: number;
  /** The team held the ball and lost it (not by scoring or the end of a half). */
  ballLost: number;
  illegal: number;
  thinkMs: number;
  decisions: number;
}
const blank = (): Stats => ({ games: 0, win: 0, draw: 0, loss: 0, tdFor: 0, tdAgainst: 0, turnovers: 0, actions: 0, blocks: 0, endTurns: 0, passiveEnds: 0, casCaused: 0, koCaused: 0, casSuffered: 0, koSuffered: 0, crowdSurfed: 0, ballLost: 0, illegal: 0, thinkMs: 0, decisions: 0 });
const stats: Record<string, Stats> = { new: blank(), old: blank() };

const ROSTERS = SEVENS ? [['human', 'orc'], ['norse', 'lizardmen'], ['skaven', 'dwarf'], ['woodElf', 'chaosChosen']] : [['human', 'orc'], ['dwarf', 'skaven'], ['tombKings', 'bretonnian'], ['woodElf', 'blackOrc']];

function team(roster: string, id: string): TeamDef {
  const t = buildTeam(roster, { format: SEVENS ? 'sevens' : 'standard', play: 'exhibition', id, name: `${roster} ${id}` });
  if (!t) throw new Error(`no roster ${roster}`);
  return t;
}

function play(ra: string, rb: string, coachA: 'new' | 'old', seed: number): { a: number; b: number; ms: number } {
  const r = createMatch('tournament', team(ra, 'ta'), team(rb, 'tb'), { rules: 'full' }, seed);
  if (!r.ok || !r.state) throw new Error(r.errors.join(' | '));
  let s = r.state as GameState;
  const who: Record<TeamId, 'new' | 'old'> = { A: coachA, B: coachA === 'new' ? 'old' : 'new' };
  const coach = (t: TeamId) => (who[t] === 'new' ? NEW : OLD);
  const t0 = Date.now();
  /** Injuries caused / suffered and crowd pushes, credited to the coach of the other team; possession lost. */
  const account = (events: Array<{ type: string; text: string; data?: Record<string, unknown> }>, before: GameState, after: GameState) => {
    for (const e of events) {
      const pid = e.data?.playerId as string | undefined;
      const p = pid ? before.players.find((q) => q.id === pid) : undefined;
      if (!p) continue;
      const victim = stats[who[p.team]];
      const hitter = stats[who[p.team === 'A' ? 'B' : 'A']];
      if (e.type === 'roll' && /Injury Roll/.test(e.text)) {
        if (/Knocked-out/.test(e.text)) (hitter.koCaused++, victim.koSuffered++);
        if (/Casualty|Badly Hurt|Seriously|Dead/.test(e.text)) (hitter.casCaused++, victim.casSuffered++);
      }
      if (/into the crowd/i.test(e.text)) victim.crowdSurfed++;
    }
    // Possession lost during the holder's own team's activity or the opponent's Turn.
    const h0 = before.ball.kind === 'held' ? before.players.find((q) => q.id === (before.ball as { playerId: string }).playerId) : undefined;
    const h1 = after.ball.kind === 'held' ? after.players.find((q) => q.id === (after.ball as { playerId: string }).playerId) : undefined;
    if (h0 && (!h1 || h1.team !== h0.team) && after.phase !== 'touchdown' && !(after.phase === 'halfOver' || after.phase === 'fullTime' || after.phase === 'driveSetup')) stats[who[h0.team]].ballLost++;
  };
  for (let i = 0; i < 6000 && s.phase !== 'fullTime'; i++) {
    const w = NewAI.waitingFor(s);
    let input: ActionInput | null = null;
    if (!w) input = s.phase === 'pregame' ? { kind: 'pregame' } : s.phase === 'touchdown' || s.phase === 'halfOver' ? { kind: 'nextDrive' } : null;
    if (!w && !input) break;
    if (w) {
      const st = stats[who[w]];
      const m0 = Date.now();
      const mv = coach(w).move(s, w);
      st.thinkMs += Date.now() - m0;
      st.decisions++;
      if (!mv) {
        input = s.phase === 'play' ? { kind: 'endTurn' } : null;
        if (!input) break;
      } else if (mv.type === 'decision') {
        const res = decide(s, { requestId: mv.requestId, optionId: mv.optionId });
        if (res.status === 'illegal') {
          st.illegal++;
          break;
        }
        if (res.status === 'turnover') st.turnovers++;
        account(res.events, s, res.state);
        s = res.state;
        continue;
      } else {
        input = mv.input;
        if (mv.type === 'action') {
          if (input.kind === 'endTurn') {
            st.endTurns++;
            if (mv.decision.candidates.some((c) => (c.kind === 'block' || c.kind === 'blitz') && !c.error && (c.gain ?? 0) > 0 && (c.pTurnover ?? 1) < 0.1)) st.passiveEnds++;
          } else {
            st.actions++;
            if (input.kind === 'playerAction' && (input.action === 'block' || input.action === 'blitz')) st.blocks++;
          }
        }
      }
      if (validateInput(s, input).length) {
        st.illegal++;
        input = s.phase === 'play' ? { kind: 'endTurn' } : input;
      }
    }
    const res = execute(s, input as ActionInput);
    if (res.status === 'illegal') throw new Error(`illegal ${JSON.stringify(input).slice(0, 200)}: ${res.error}`);
    if (res.status === 'turnover' && w) stats[who[w]].turnovers++;
    account(res.events, s, res.state);
    s = res.state;
  }
  if (s.phase !== 'fullTime') throw new Error(`match did not finish (seed ${seed})`);
  const a = s.teams.A.score;
  const b = s.teams.B.score;
  for (const t of ['A', 'B'] as TeamId[]) {
    const st = stats[who[t]];
    const f = t === 'A' ? a : b;
    const g = t === 'A' ? b : a;
    st.games++;
    st.tdFor += f;
    st.tdAgainst += g;
    if (f > g) st.win++;
    else if (f === g) st.draw++;
    else st.loss++;
  }
  return { a, b, ms: Date.now() - t0 };
}

const lines: string[] = [];
for (let i = 0; i < PAIRS; i++) {
  const [ra, rb] = ROSTERS[i % ROSTERS.length];
  const seed = SEED0 + i;
  for (const side of ['new', 'old'] as const) {
    const r = play(ra, rb, side, seed);
    const line = `${SEVENS ? 'Sevens' : '11-a-side'} seed ${seed} ${ra} (${side}) v ${rb} (${side === 'new' ? 'old' : 'new'}): ${r.a}-${r.b} (${(r.ms / 1000).toFixed(0)} s)`;
    lines.push(line);
    process.stdout.write(`${line}\n`);
  }
}
const row = (k: 'new' | 'old') => {
  const s = stats[k];
  return `| ${k === 'new' ? NEW.name : OLD.name} | ${s.games} | ${s.win}-${s.draw}-${s.loss} | ${s.tdFor}-${s.tdAgainst} (${s.tdFor - s.tdAgainst >= 0 ? '+' : ''}${s.tdFor - s.tdAgainst}) | ${s.turnovers} | ${s.ballLost} | ${s.actions} | ${s.blocks} | ${s.endTurns} | ${s.passiveEnds} | ${s.koCaused} / ${s.casCaused} | ${s.koSuffered} / ${s.casSuffered} | ${s.crowdSurfed} | ${s.illegal} | ${(s.thinkMs / Math.max(1, s.decisions)).toFixed(0)} ms |`;
};
process.stdout.write(`\n${SEVENS ? 'Blood Bowl Sevens' : '11-a-side'}, ${PAIRS} pairs (seeds ${SEED0}-${SEED0 + PAIRS - 1}, sides swapped):\n`);
process.stdout.write('| Coach | Games | W-D-L | TD for-against | Turnovers | Ball lost | Actions | Blocks/Blitzes | Turns ended | Passive ends | KO / CAS caused | KO / CAS suffered | Crowd pushes suffered | Illegal | Think / decision |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n');
process.stdout.write(`${row('new')}\n${row('old')}\n`);
// One machine-readable line (for combining runs made in parallel).
process.stdout.write(`JSON:${JSON.stringify({ format: SEVENS ? 'sevens' : 'standard', pairs: PAIRS, seed: SEED0, newId: NEW_ID, stats, lines })}\n`);
