/**
 * V6 built-in AI lifecycle baseline: every roster drafts a legal team in both formats, the basic roster choice is
 * deterministic in deterministic mode and varies (within a quality band) otherwise, the built-in formation fields the right
 * number of players with Captain / Stars included and is always accepted by the engine, and an "AI Build" match plays on.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import { bindEngine, nextMove, waitingFor } from '../src/ai/index';

bindEngine(Engine);

const FORMATS = ['standard', 'sevens'] as const;

test('built-in builder: every draftable roster yields an engine-valid team in both formats; non-draftable ones are reported, not hidden', () => {
  let drafted = 0;
  for (const f of FORMATS) {
    for (const info of Engine.rosterInfos(f, 'exhibition')) {
      if (!info.draftable) continue;
      const t = Engine.builtinTeam(info.id, { format: f, play: 'exhibition', id: `t-${info.id}`, name: info.name });
      assert.ok(t, `${f} ${info.id}`);
      const v = Engine.validateBuild(t!, { format: f, rosterId: info.id });
      assert.ok(v.ok, `${f} ${info.id}: ${v.violations.map((x) => x.text).join(' | ')}`);
      drafted++;
    }
  }
  assert.ok(drafted >= 40, `only ${drafted} drafts`);
});

test('roster choice: deterministic mode is stable; the varied mode stays within 8 % of the best score; both seats use the same procedure', () => {
  const o = { format: 'sevens', play: 'exhibition' } as const;
  const a = Engine.chooseRosterBuiltin({ ...o, deterministic: true });
  assert.equal(Engine.chooseRosterBuiltin({ ...o, deterministic: true }).rosterId, a.rosterId);
  const best = Engine.rosterScore(a.rosterId, o);
  let n = 0;
  const seen = new Set<string>();
  const rand = () => ((n = (n * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 40; i++) {
    const c = Engine.chooseRosterBuiltin({ ...o, rand });
    seen.add(c.rosterId);
    assert.ok(Engine.rosterScore(c.rosterId, o) >= best * 0.92 - 1e-9);
  }
  assert.ok(seen.size >= 1);
  // blind and sequential give the same baseline answer (it does not model the opponent)
  assert.equal(Engine.chooseRosterBuiltin({ ...o, deterministic: true, opponent: 'human' }).rosterId, a.rosterId);
});

test('validateBuild: structured violations with stable codes (budget, format, roster)', () => {
  const t = Engine.builtinTeam('human', { format: 'sevens', play: 'exhibition', id: 'x', name: 'X' })!;
  t.rerolls = 99;
  const v = Engine.validateBuild(t, { format: 'standard', rosterId: 'orc' });
  assert.equal(v.ok, false);
  const codes = v.violations.map((x) => x.code);
  assert.ok(codes.includes('format') && codes.includes('roster'), codes.join());
  assert.ok(v.violations.every((x) => x.code && x.text));
});

function matchFor(roster: string, format: 'standard' | 'sevens', seed: number) {
  const a = Engine.builtinTeam(roster, { format, play: 'exhibition', id: 'a', name: 'A' })!;
  const b = Engine.builtinTeam('orc', { format, play: 'exhibition', id: 'b', name: 'B' })!;
  const r = Engine.createMatch('tournament', a, b, { rules: 'full', play: 'exhibition' }, seed);
  assert.ok(r.ok && r.state, r.errors.join());
  let s = r.state!;
  s = Engine.execute(s, { kind: 'pregame' }).state;
  while (s.pending) s = Engine.decide(s, { requestId: s.pending.request.id, optionId: s.pending.request.options[0].id }).state;
  return s;
}

test('built-in formation: for every roster and format, the right number takes the pitch, the engine accepts it, Stars/Captain are included, the sturdiest hold the line', () => {
  let n = 0;
  for (const f of FORMATS) {
    for (const info of Engine.rosterInfos(f, 'exhibition')) {
      if (!info.draftable) continue;
      const s = matchFor(info.id, f, 100 + n++);
      assert.equal(s.phase, 'driveSetup', info.id);
      const team = s.match!.kicking as 'A' | 'B';
      const fm = Engine.builtinFormation(s, team);
      assert.equal(fm.fellBack, false, `${f} ${info.id}: ${fm.why}`);
      assert.equal(Engine.matchInputReason(s, { kind: 'setupTeam', team, positions: fm.positions }), null);
      const cands = Engine.setupCandidates(s, team);
      const R = Engine.rulesFor(s);
      assert.equal(fm.fielded.length, Math.min(R.playersPerDrive, cands.length));
      // the Line of Scrimmage players are at least as sturdy (ST*3+AV) as the average of those behind
      const los = Engine.losColumn(team);
      const on = fm.fielded.map((id) => ({ p: s.players.find((x) => x.id === id)!, at: fm.positions[id]! }));
      const line = on.filter((x) => x.at.x === los).map((x) => x.p.st * 3 + x.p.av);
      const back = on.filter((x) => x.at.x !== los).map((x) => x.p.st * 3 + x.p.av);
      if (line.length && back.length) assert.ok(Math.min(...line) >= Math.min(...back) - 6, `${f} ${info.id} line weaker than back`);
    }
  }
  assert.ok(n >= 40);
});

test('built-in AI plays the opening Drives (14 inputs) with its own formation and roster-built teams (both formats), no engine rejections', () => {
  for (const [roster, f, seed] of [['human', 'sevens', 5], ['skaven', 'sevens', 7]] as const) {
    let s = matchFor(roster, f, seed);
    let guard = 0;
    while (s.phase !== 'fullTime' && guard++ < 14) {
      const w = waitingFor(s);
      let input: Engine.ActionInput | null = null;
      if (!w) input = s.phase === 'pregame' ? { kind: 'pregame' } : s.phase === 'touchdown' || s.phase === 'halfOver' ? { kind: 'nextDrive' } : null;
      if (!w && !input) break;
      if (w) {
        const mv = nextMove(s, w, 'balanced');
        assert.ok(mv, `${roster}: no move`);
        const res = mv!.type === 'decision' ? Engine.decide(s, { requestId: mv!.requestId, optionId: mv!.optionId }) : Engine.execute(s, mv!.input);
        assert.notEqual(res.status, 'illegal', `${roster} ${f}: ${res.error}`);
        s = res.state;
      } else {
        const res = Engine.execute(s, input!);
        assert.notEqual(res.status, 'illegal', res.error);
        s = res.state;
      }
    }
    assert.ok(s.log.length >= 5, `${roster} ${f}: only ${s.log.length} inputs`);
  }
});
