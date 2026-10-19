/**
 * Regression (V5 step 5, reported from play): after a Both Down where Wrestle is used, both players are Placed
 * Prone, the blocker's activation ends, the team Turn goes on (no Turnover unless the blocker had the ball) and
 * another unused player of that team can be activated.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute, type GameState, type PlayerActionInput } from '../src/engine/index';
import { actionOptions } from '../src/engine/actions';
import { c, p, Pos, runScripted } from './helpers';

const block = (id: string, t: string, blitz = false): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: blitz ? 'blitz' : 'block', path: [], blockTarget: t, ...(blitz ? { blitzTarget: t } : {}) });
const move = (id: string, to: [number, number]): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'move', path: [{ to: c(to[0], to[1]), kind: 'step' }] });

function position(wrestler: 'attacker' | 'defender', ball = false): GameState {
  const P = new Pos({ rerollsA: 0 });
  const att = P.add('A', 'human', 'lineman', c(10, 7), { id: 'ATT', extraSkills: wrestler === 'attacker' ? [{ id: 'wrestle' }] : [] });
  P.add('A', 'human', 'lineman', c(5, 3), { id: 'MATE' });
  P.add('A', 'human', 'lineman', c(6, 12), { id: 'MATE2', stance: 'prone' });
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'DEF', extraSkills: wrestler === 'defender' ? [{ id: 'wrestle' }] : [] });
  P.add('B', 'orc', 'lineman', c(20, 3), { id: 'FAR' });
  if (ball) P.give(att);
  else P.ball(c(3, 12));
  return P.start();
}

for (const who of ['attacker', 'defender'] as const) {
  for (const blitz of [false, true]) {
    test(`Wrestle used by the ${who} on Both Down (${blitz ? 'Blitz' : 'Block'}): both Placed Prone, the activation ends, the Turn goes on and another player can act`, () => {
      const s = position(who);
      // One Block die (ST 3 v 3): Both Down; Wrestle: yes.
      const r = runScripted(s, block('ATT', 'DEF', blitz), [2], (req) => (req.type === 'wrestle' ? 'yes' : req.options[0].id));
      assert.equal(r.status, 'completed', r.error);
      const g = r.state;
      assert.match(r.events.map((e) => e.text).join('\n'), /Wrestle: both players are Placed Prone/);
      assert.equal(p(g, 'ATT').stance, 'prone');
      assert.equal(p(g, 'DEF').stance, 'prone');
      assert.equal(p(g, 'ATT').activated, true);
      assert.equal(g.turn.activation, null, "the blocker's activation has ended");
      assert.equal(g.turn.active, 'A', 'still the same team Turn');
      assert.equal(g.teams.A.turn, s.teams.A.turn, 'no Turnover: the Turn marker did not move');
      assert.ok(!r.events.some((e) => e.type === 'turnover'), 'no Turnover');
      if (blitz) assert.equal(g.turn.used.blitz, true);
      // Another unused player: every Action is on offer, and a Move executes.
      const opts = actionOptions(g, p(g, 'MATE'));
      assert.ok(opts.find((o) => o.action === 'move')?.enabled, JSON.stringify(opts.find((o) => o.action === 'move')));
      const m = execute(g, move('MATE', [6, 3]));
      assert.equal(m.status, 'completed', m.error);
      assert.deepEqual(p(m.state, 'MATE').pos, c(6, 3));
      // A Prone team-mate who was not activated can still stand up.
      const prone = actionOptions(m.state, p(m.state, 'MATE2')).find((o) => o.action === 'move');
      assert.ok(prone?.enabled, JSON.stringify(prone));
      // The wrestled blocker cannot act again this Turn.
      assert.ok(!actionOptions(m.state, p(m.state, 'ATT')).some((o) => o.enabled));
    });
  }
}

test('Wrestle by a blocker holding the ball: Placed Prone with the ball is a Turnover (p.138)', () => {
  const s = position('attacker', true);
  const r = runScripted(s, block('ATT', 'DEF'), [2, 4], (req) => (req.type === 'wrestle' ? 'yes' : req.options[0].id));
  assert.equal(r.status, 'turnover', r.error);
  assert.equal(r.state.turn.active, 'B');
});
