// Perspective probe: who is "worst" in decisions {own, opponent} when the request's team is A or B?
import * as Engine from '../src/engine/index';
import type { GameState } from '../src/engine/index';
import { bindEngine, nextMove, waitingFor, type CoachEntry } from '../src/ai/index';
import { platformDecide } from '../src/platform/host';
import { nodeSpawn } from '../src/platform/research/nodehost';
import { ROSTERS } from '../src/platform/research/teams';
bindEngine(Engine);
const code = `bloodboard.register({ id:'probe', name:'probe', apiVersion:1, apiMinor:2, timeLimitMs:30000, requires:['candidates','explore','evaluate'],
 async chooseAction(o, cands, sv) {
  const me = o.team, en = me==='A'?'B':'A', out = { me, checks: [] };
  const e = await sv.explore({kind:'endTurn'}, {team: me, maxOutcomes:1, perspective: me});
  const k = e.outcomes[0].key; out.activeAfterEnd = e.outcomes[0].active;
  const vm = await sv.evaluate({from:k, perspective: me}), vo = await sv.evaluate({from:k, perspective: en}), vs = await sv.evaluate({from:k, perspective:'self'});
  out.eval = { me: vm.value, enemy: vo.value, self: vs.value, sumAbs: Math.abs(vm.value+vo.value) };
  const c = await sv.candidates({from:k, team: en, families:['block','blitz'], precision:'none', maxPerPlayer:1, limit:6, builtIn:false});
  const rows = [];
  for (const r of c.candidates.slice(0,4)) {
    const f = (d) => sv.explore(r.input, {from:k, team: en, perspective: me, decisions: d, maxLeaves:3000, maxMs:2000, observations:false});
    const w = await f({own:'best', opponent:'worst'}), b = await f({own:'best', opponent:'best'}), bw = await f({own:'worst', opponent:'worst'});
    const selfp = await sv.explore(r.input, {from:k, team: en, perspective:'self', decisions:{own:'best',opponent:'worst'}, maxLeaves:3000, maxMs:2000, observations:false});
    rows.push({ label:r.label, oppWorstForMe: w.value, oppBestForMe: b.value, ownWorst: bw.value, selfSame: Math.abs(selfp.value - w.value) < 1e-9 });
  }
  out.rows = rows;
  return { endTurn:true, why:'probe', trace: out };
 }, chooseDecision(){ return null; } });`;
for (const seed of [9, 5]) {
  const cm = Engine.createMatch('tournament', ROSTERS.human.sevens(), ROSTERS.orc.sevens(), { rules: 'introductory' }, seed);
  let cur = cm.state as GameState; let done = 0;
  for (let i = 0; i < 3000 && done < 2; i++) {
    const who = waitingFor(cur); let out: Engine.ExecutionResult;
    if (!who) out = Engine.execute(cur, cur.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' });
    else {
      if (cur.phase === 'play' && !cur.pending && cur.turn.activation === null && cur.teams[who].turn >= 3 && i % 7 === 0) {
        const entry = { id: 'probe', name: 'probe', kind: 'strategy', implementation: 'strategy:probe', version: '1', description: '', code, timeLimitMs: 30000, apiMinor: 2 } as unknown as CoachEntry;
        const r = await platformDecide(cur, who, entry, { spawn: nodeSpawn });
        console.log(JSON.stringify({ team: who, fellBack: r.meta.fellBack, reason: r.meta.reason, trace: (r.meta as any).trace }, null, 0)); done++;
      }
      const mv = nextMove(cur, who, 'balanced', {})!;
      out = mv.type === 'decision' ? Engine.decide(cur, { requestId: mv.requestId, optionId: mv.optionId }) : Engine.execute(cur, mv.input as never);
    }
    cur = out.state as GameState;
  }
}
