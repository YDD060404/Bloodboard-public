/**
 * V5.5: both sides may use the same saved team (Sevens and 11-a-side, any Human / Computer combination). Player 2
 * plays an independent match copy: "*" after the name, inverted colours, its own team and player ids; the saved team
 * is unchanged; resources, player states and special-rule usage stay separate; saving (JSON) and reloading mid-match
 * changes nothing.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import { buildTeam, createMatch, decide, execute, newTeamDef, playerFromRoster, ROSTER_BY_ID, validateInput, type ActionInput, type GameState, type TeamDef, type TeamId } from '../src/engine/index';
import { bindEngine, nextMove, waitingFor } from '../src/ai/index';

bindEngine(Engine);

function saved(format: 'standard' | 'sevens', roster = 'human'): TeamDef {
  const t = buildTeam(roster, { format, play: 'exhibition', id: `saved-${format}-${roster}`, name: `My ${roster} ${format}` });
  if (!t) throw new Error('no team');
  if (format === 'standard') {
    t.budget = 1_100_000;
    t.inducements = { ...(t.inducements ?? {}), bribe: 1 };
  }
  return t;
}

/** Plays on (computer coaches for both sides) until full time or `stopAt` inputs. */
function playOn(s: GameState, stopAt = Infinity): { s: GameState; n: number } {
  let n = 0;
  for (let i = 0; i < 6000 && s.phase !== 'fullTime' && n < stopAt; i++) {
    const w = waitingFor(s);
    let input: ActionInput | null = null;
    if (!w) input = s.phase === 'pregame' ? { kind: 'pregame' } : s.phase === 'touchdown' || s.phase === 'halfOver' ? { kind: 'nextDrive' } : null;
    if (!w && !input) break;
    n++;
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
  return { s, n };
}

for (const format of ['standard', 'sevens'] as const) {
  test(`${format === 'sevens' ? 'Sevens' : '11-a-side'}: the same saved team on both sides — an independent copy for Player 2 ("*", inverted colours, own ids), the saved team unchanged`, () => {
    const t = saved(format);
    const before = JSON.stringify(t);
    const r = createMatch('tournament', t, t, { rules: 'full', play: 'exhibition' }, 11);
    assert.ok(r.ok, r.errors.join(' | '));
    const s = r.state as GameState;
    assert.equal(JSON.stringify(t), before, 'the saved team is not changed');
    assert.equal(s.teams.A.name, t.name);
    assert.equal(s.teams.B.name, `${t.name}*`);
    assert.equal(s.teams.A.color, t.color);
    assert.equal(s.teams.B.color, t.accent, 'P2 colours inverted (primary and accent swapped)');
    assert.equal(s.teams.B.accent, t.color);
    assert.notEqual(s.match!.teamIds.A, s.match!.teamIds.B, 'unique team ids');
    assert.deepEqual(s.match!.mirror, { team: 'B', of: t.id });
    const ids = s.players.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, 'unique player ids');
    const defA = s.players.filter((p) => p.team === 'A').map((p) => p.defId);
    const defB = s.players.filter((p) => p.team === 'B').map((p) => p.defId);
    assert.ok(defB.every((d) => !defA.includes(d)), 'P2 players have their own ids');
    assert.equal(defA.length, defB.length);
    // Independent objects: changing one side's player never touches the other side.
    const a1 = s.players.find((p) => p.team === 'A')!;
    const b1 = s.players.find((p) => p.team === 'B' && p.number === a1.number)!;
    assert.notEqual(a1.skills, b1.skills);
    a1.usage.dodgeReroll = true;
    a1.skills.push({ id: 'block' });
    assert.equal(b1.usage.dodgeReroll, undefined);
    assert.ok(!b1.skills.some((k) => k.id === 'block') || t.players.find((p) => `${p.id}*p2` === b1.defId)!.skills.some((k) => k.id === 'block'));
    // Team resources are per side.
    assert.equal(s.teams.A.rerolls, s.teams.B.rerolls);
    s.teams.A.rerolls -= 1;
    assert.equal(s.teams.B.rerolls, s.teams.A.rerolls + 1);
    if (format === 'standard') {
      assert.equal(s.match!.bribes.A, 1);
      assert.equal(s.match!.bribes.B, 1);
    }
  });

  test(`${format === 'sevens' ? 'Sevens' : '11-a-side'}: a computer v computer mirror match plays to full time; saving and reloading mid-match changes nothing`, () => {
    const t = saved(format, format === 'sevens' ? 'orc' : 'human');
    const before = JSON.stringify(t);
    const r = createMatch('tournament', t, t, { rules: 'full', play: 'exhibition' }, 3);
    assert.ok(r.ok, r.errors.join(' | '));
    const half = playOn(r.state as GameState, 250);
    // Save (the game is stored as JSON) and reload, then play on; the same moves continue from the reloaded game.
    const reloaded = JSON.parse(JSON.stringify(half.s)) as GameState;
    const direct = playOn(half.s);
    const viaSave = playOn(reloaded);
    assert.equal(direct.s.phase, 'fullTime');
    assert.equal(JSON.stringify(viaSave.s), JSON.stringify(direct.s), 'identical after a save / reload');
    assert.equal(direct.s.teams.B.name, `${t.name}*`);
    // Each side's state stayed its own: no player of one side ever ended up on the other.
    assert.ok(direct.s.players.every((p) => p.id.startsWith(p.team)));
    assert.equal(JSON.stringify(t), before, 'the saved team is still unchanged');
  });
}

test('League: the same saved League team on both sides starts; only Player 1’s side belongs to the saved team', () => {
  const t = newTeamDef('league', 'human', 'My League Humans', 'lg-humans');
  let n = 1;
  for (const [pos, k] of [['blitzer', 2], ['catcher', 2], ['thrower', 1], ['lineman', 6]] as Array<[string, number]>) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID.human, pos, n, `lg-${n++}`));
  t.rerolls = 2;
  const r = createMatch('league', t, t, { rules: 'full' }, 9);
  assert.ok(r.ok, r.errors.join(' | '));
  const s = r.state as GameState;
  assert.equal(s.match!.teamIds.A, t.id);
  assert.notEqual(s.match!.teamIds.B, t.id);
  assert.equal(s.match!.mirror?.team, 'B' as TeamId);
});

test('different saved teams with the same colours (e.g. the same ready-made roster twice): Player 2’s colours are inverted', () => {
  const a = saved('standard');
  const b = { ...saved('standard'), id: 'other', name: 'Other humans' };
  const r = createMatch('tournament', a, b, { rules: 'full', play: 'exhibition' }, 1);
  assert.ok(r.ok);
  assert.equal(r.state!.teams.B.color, a.accent);
  assert.equal(r.state!.teams.B.name, 'Other humans');
  assert.equal(r.state!.match!.mirror, undefined);
});
