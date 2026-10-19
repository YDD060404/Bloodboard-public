/**
 * Generates bench/positions.json: fixed positions from deterministic built-in v built-in matches, used to measure
 * engine-service latency before / after the engine pool on identical inputs.
 * Usage: node build/bench-positions.mjs bench/positions.json
 */
import * as Engine from '../src/engine/index';
import { bindEngine, nextMove, waitingFor } from '../src/ai/index';
import { buildTeam } from '../src/platform/research/teams';
import { writeFileSync } from 'node:fs';
declare const process: any;
bindEngine(Engine);
const { createMatch, decide, execute } = Engine as any;

interface Pick { name: string; format: 'standard' | 'sevens'; a: string; b: string; seed: number; steps: number[] }
const PICKS: Pick[] = [
  { name: 'sevens-human-orc-s3', format: 'sevens', a: 'human', b: 'orc', seed: 3, steps: [60, 140, 260] },
  { name: 'sevens-draft-elf-dwarf-s5', format: 'sevens', a: 'draft:amazon', b: 'draft:norse', seed: 5, steps: [90, 200] },
  { name: 'standard-human-orc-s4', format: 'standard', a: 'human', b: 'orc', seed: 4, steps: [120, 320, 520] },
];
const out: any[] = [];
for (const p of PICKS) {
  const cm = createMatch('tournament', buildTeam(p.a, p.format), buildTeam(p.b, p.format), { rules: 'full' }, p.seed);
  if (!cm.ok) throw new Error(cm.errors.join('; '));
  let s = cm.state;
  let step = 0;
  const want = new Set(p.steps);
  let pending = [...p.steps];
  while (s.phase !== 'fullTime' && pending.length) {
    const who = waitingFor(s);
    let res;
    if (!who) res = execute(s, s.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' });
    else {
      const mv: any = nextMove(s, who, "balanced");
      res = mv.type === 'decision' ? decide(s, { requestId: mv.requestId, optionId: mv.optionId }) : execute(s, mv.input);
    }
    s = res.state;
    step++;
    // the first position at or after each wanted step where an action (not a rule decision) is awaited in play
    if (pending.length && step >= pending[0] && s.phase === 'play' && !s.pending && waitingFor(s) && !s.turn.activation) {
      const n = s.players.filter((q: any) => q.location === 'pitch').length;
      out.push({ id: `${p.name}@${step}`, format: p.format, step, half: s.match?.half, turn: { A: s.teams.A.turn, B: s.teams.B.turn }, onPitch: n, active: s.turn.active, state: JSON.parse(JSON.stringify(s)) });
      pending.shift();
    }
  }
}
writeFileSync(process.argv[2], JSON.stringify({ schema: 'bloodboard-bench-positions/1', positions: out }));
console.log(out.map((o) => `${o.id} active=${o.active} onPitch=${o.onPitch} log=${o.state.log.length}`).join('\n'));
