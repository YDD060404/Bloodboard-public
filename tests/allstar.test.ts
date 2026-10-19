/**
 * V5.5 (request item 4): All-Star squads — a custom Exhibition variant made of Star Players only. Each Star once per
 * squad, pairs join together, configurable squad limit and budget (or none); both squads may field the same Star
 * Player as independent instances (p.148: "one of them is simply just a very talented imposter"); complete matches
 * with the computer coaching both squads (11-a-side and Sevens).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import { addStar, createMatch, decide, execute, newAllStarSquad, starAddReason, starReady, validateInput, validateTeamDef, type ActionInput, type GameState, type TeamDef } from '../src/engine/index';
import { bindEngine, nextMove, waitingFor } from '../src/ai/index';

bindEngine(Engine);
let nid = 0;
const newId = () => `as${++nid}`;
const errors = (t: TeamDef) => validateTeamDef(t).filter((i) => i.level === 'error').map((i) => i.text);

function squad(id: string, stars: string[], variant: 'standard' | 'sevens' = 'standard', opts: { budget?: number | null; maxStars?: number } = {}): TeamDef {
  const t = newAllStarSquad(id, `All-Stars ${id}`, variant, opts);
  for (const s of stars) if (!t.players.some((p) => p.star === s)) addStar(t, s, newId);
  return t;
}

test('All-Star squads: Star Players only, each once, pairs together, squad limit and budget — labelled a custom Exhibition variant', () => {
  const t = squad('a', ['griff', 'morgNThorg', 'varag']);
  assert.deepEqual(errors(t), []);
  assert.ok(validateTeamDef(t).some((i) => /custom Exhibition variant/.test(i.text)));
  assert.match(starAddReason(t, 'griff') ?? '', /Already in this squad/);
  addStar(t, 'dribl', newId);
  assert.ok(t.players.some((p) => p.star === 'drull'), 'a pair joins together');
  const small = squad('b', ['griff', 'varag'], 'standard', { maxStars: 3 });
  assert.match(starAddReason(small, 'dribl') ?? '', /Squad limit: at most 3/);
  const poor = squad('c', [], 'standard', { budget: 250_000 });
  addStar(poor, 'varag', newId);
  assert.match(starAddReason(poor, 'griff') ?? '', /squad budget/);
  const two = squad('d', ['griff', 'varag']);
  assert.ok(errors(two).some((e) => /at least 3/.test(e)));
});

test('both squads may field the same Star Player: independent instances — a once-per-game rule used by one is still ready for the other', () => {
  const a = squad('p1', ['griff', 'morgNThorg', 'varag', 'karla']);
  const b = squad('p2', ['griff', 'morgNThorg', 'varag', 'karla']);
  const r = createMatch('tournament', a, b, { rules: 'full', play: 'exhibition' }, 5);
  assert.ok(r.ok, r.errors.join(' | '));
  const s = r.state as GameState;
  assert.ok(s.match!.allStar?.A && s.match!.allStar?.B);
  const gA = s.players.find((p) => p.team === 'A' && p.star === 'griff')!;
  const gB = s.players.find((p) => p.team === 'B' && p.star === 'griff')!;
  assert.notEqual(gA.id, gB.id);
  assert.ok(starReady(s, gA, 'griff') && starReady(s, gB, 'griff'));
  gA.starUsed = [...(gA.starUsed ?? []), 'game'];
  assert.equal(starReady(s, gA, 'griff'), false);
  assert.equal(starReady(s, gB, 'griff'), true, "Player 2's Griff keeps his own rule");
});

function playToEnd(s: GameState): GameState {
  for (let i = 0; i < 8000 && s.phase !== 'fullTime'; i++) {
    const w = waitingFor(s);
    let input: ActionInput | null = null;
    if (!w) input = s.phase === 'pregame' ? { kind: 'pregame' } : s.phase === 'touchdown' || s.phase === 'halfOver' ? { kind: 'nextDrive' } : null;
    if (!w && !input) break;
    if (w) {
      const mv = nextMove(s, w, 'balanced');
      if (!mv) throw new Error('no move');
      if (mv.type === 'decision') {
        const res = decide(s, { requestId: mv.requestId, optionId: mv.optionId });
        assert.notEqual(res.status, 'illegal', res.error);
        s = res.state;
        continue;
      }
      input = mv.input;
      assert.deepEqual(validateInput(s, input), [], JSON.stringify(input).slice(0, 160));
    }
    const res = execute(s, input as ActionInput);
    assert.notEqual(res.status, 'illegal', res.error);
    s = res.state;
  }
  return s;
}

test('a complete 11-a-side All-Star match, the computer coaching both squads (unusual Star powers included), legal inputs only', () => {
  const a = squad('A', ['griff', 'morgNThorg', 'varag', 'karla', 'hakflem', 'rumbelow', 'lordBorak', 'glart', 'grashnak', 'willow', 'zolcath']);
  const b = squad('B', ['hthark', 'ivan', 'akhorne', 'deeproot', 'gloriel', 'helmut', 'kreek', 'mightyZug', 'roxanna', 'scyla', 'skrull']);
  assert.deepEqual(errors(a), [], errors(a).join());
  assert.deepEqual(errors(b), [], errors(b).join());
  const r = createMatch('tournament', a, b, { rules: 'full', play: 'exhibition' }, 7);
  assert.ok(r.ok, r.errors.join(' | '));
  const end = playToEnd(r.state as GameState);
  assert.equal(end.phase, 'fullTime');
  const used = end.players.filter((p) => (p.starUsed ?? []).length).map((p) => p.star);
  assert.ok(end.log.length > 60, `${end.log.length} log entries`);
  void used;
});

test('a complete Sevens All-Star match, the computer coaching both squads', () => {
  const a = squad('A7', ['griff', 'varag', 'karla', 'rumbelow', 'glart', 'willow', 'zolcath'], 'sevens');
  const b = squad('B7', ['hthark', 'akhorne', 'gloriel', 'helmut', 'kreek', 'roxanna', 'skrull'], 'sevens');
  assert.deepEqual(errors(a), [], errors(a).join());
  const r = createMatch('tournament', a, b, { rules: 'full', play: 'exhibition' }, 8);
  assert.ok(r.ok, r.errors.join(' | '));
  const end = playToEnd(r.state as GameState);
  assert.equal(end.phase, 'fullTime');
});
