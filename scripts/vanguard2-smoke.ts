// Smoke: Vanguard 2.0 through the real host on several positions (not a benchmark).
import { readFileSync } from 'node:fs';
import * as Engine from '../src/engine/index';
import type { GameState } from '../src/engine/index';
import { bindEngine, nextMove, waitingFor, type CoachEntry } from '../src/ai/index';
import { platformDecide, moduleMeta } from '../src/platform/host';
import { CoachContextStore } from '../src/platform/hostext';
import { nodeSpawn } from '../src/platform/research/nodehost';
import { ROSTERS } from '../src/platform/research/teams';
bindEngine(Engine);
declare const process: any;
const file = process.argv[2]; const nPos = Number(process.argv[3] || 6); const seed0 = Number(process.argv[4] || 9);
const code = readFileSync(file, 'utf8');
const m = await moduleMeta(nodeSpawn, code);
if (!m.meta) throw new Error(String(m.error));
const entry = { id: m.meta.id, name: m.meta.name, kind: 'strategy', implementation: 'strategy:' + m.meta.id, version: m.meta.version, description: '', code, timeLimitMs: m.meta.timeLimitMs, apiMinor: m.meta.apiMinor } as unknown as CoachEntry;
console.log('meta', m.meta.id, m.meta.version, m.meta.timeLimitMs);
const cm = Engine.createMatch('tournament', ROSTERS.human.sevens(), ROSTERS.orc.sevens(), { rules: 'introductory' }, seed0);
if (!cm.ok) throw new Error('match');
let cur = cm.state as GameState; let asked = 0; let steps = 0;
while (cur.phase !== 'fullTime' && asked < nPos && steps++ < 4000) {
  const who = waitingFor(cur);
  let out: Engine.ExecutionResult;
  if (!who) out = Engine.execute(cur, cur.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' });
  else {
    const isAction = cur.phase === 'play' && !cur.pending && cur.turn.activation === null && !cur.match?.pendingPhase;
    if (isAction && cur.teams[who].turn >= 1 && steps % 5 === 0) {
      const t0 = Date.now(); const st = new CoachContextStore();
      const r = await platformDecide(cur, who, entry, { spawn: nodeSpawn, context: st.ticket(who, entry.id) });
      asked++;
      const tr = (r.move as any)?.trace ?? (r.meta as any).trace;
      console.log(`\n#${asked} step ${steps} team ${who} turn ${cur.teams[who].turn} via=${r.meta.via} fellBack=${r.meta.fellBack} ${r.meta.reason ?? ''} ${Date.now() - t0}ms`);
      console.log('  why:', String((r.move as any)?.why ?? r.meta.why ?? ''));
      const t = (r.meta as any).trace ?? tr; if (t) console.log("  trace bytes:", JSON.stringify(t).length);
      if (t) console.log('  trace:', JSON.stringify({ ctx: t.ctx, rounds: t.rounds, decision: t.decision, search: t.search }), '\n  top rows:', JSON.stringify((t.rows || []).slice(0, 3)));
      else console.log('  (no trace in meta)', Object.keys(r.meta));
    }
    const mv = nextMove(cur, who, 'balanced', {})!;
    out = mv.type === 'decision' ? Engine.decide(cur, { requestId: mv.requestId, optionId: mv.optionId }) : Engine.execute(cur, mv.input as never);
  }
  if (out.status === 'illegal') throw new Error('illegal');
  cur = out.state as GameState;
}
console.log('SMOKE DONE');
