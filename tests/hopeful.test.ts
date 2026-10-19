/**
 * Hopeful 0.2 (ai-models/hopeful/hopeful-0-2.js) on the platform services: scenario checks. These test decisions and
 * the explanation trace in constructed positions; they do not claim strength (see docs/HOPEFUL_0_2.md for the match tests).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import * as Engine from '../src/engine/index';
import type { GameState } from '../src/engine/index';
import { bindEngine, type CoachEntry } from '../src/ai/index';
import { platformDecide, runModule, Session, observe, resolveDecision } from '../src/platform/index';
import { nodeSpawn } from '../src/platform/research/nodehost';
import { c, Pos } from './helpers';

bindEngine(Engine);
const CODE = readFileSync('ai-models/hopeful/hopeful-0-2.js', 'utf8');
const entry = (ms = 60000): CoachEntry => ({ id: 'hopeful-0-2', name: 'Hopeful 0.2', kind: 'strategy', implementation: 'strategy:hopeful-0-2', version: '0.2', description: '', code: CODE, timeLimitMs: ms, apiMinor: 2 } as CoachEntry);
let dumpN = 0;
const decide = async (s: GameState) => {
  const r = await platformDecide(s, 'A', entry(), { spawn: nodeSpawn });
  if (process.env.HOPEFUL_DUMP) writeFileSync(`${process.env.HOPEFUL_DUMP}/d${dumpN++}.json`, JSON.stringify({ why: (r.move as any)?.why, meta: r.meta }, null, 1));
  return r;
};
/** A pick-up: a move ending on the ball square, or a Secure the Ball action on it. */
const takesBall = (i: any, x: number, y: number) => i.kind === 'playerAction' && (i.action === 'secure' || (i.path?.length && i.path[i.path.length - 1].to.x === x && i.path[i.path.length - 1].to.y === y));
const inputOf = (r: Awaited<ReturnType<typeof decide>>) => (r.move as { input: any }).input;

test('module identity: Hopeful 0.2 is a separate module and declares the services it requires', () => {
  assert.match(CODE, /id: 'hopeful-0-2'/);
  assert.match(CODE, /apiMinor: 2/);
  assert.doesNotMatch(CODE, /hopeful-0-1/);
});

test('scoring deadline: on our last Turn it runs the ball in rather than ending the Turn', async () => {
  const b = new Pos({ turnA: 8, turnB: 7, rerollsA: 0 });
  const car = b.add('A', 'human', 'catcher', c(20, 7), { id: 'car' });
  b.add('A', 'human', 'lineman', c(19, 7), { id: 'm1' });
  b.add('B', 'orc', 'lineman', c(23, 7), { id: 'o1' });
  b.add('B', 'orc', 'lineman', c(3, 3), { id: 'o2' });
  b.give(car);
  const r = await decide(b.start());
  assert.equal(r.meta.fellBack, false, JSON.stringify(r.meta.reason));
  const i = inputOf(r);
  assert.equal(i.kind, 'playerAction');
  assert.equal(i.playerId, 'car');
  const last = i.path[i.path.length - 1].to;
  assert.equal(last.x, 25, 'the route ends in the End Zone');
});

test('ball first: a loose ball with a player in reach is recovered (pick-up route ends on the ball)', async () => {
  const b = new Pos({ turnA: 3, turnB: 3 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'a1' });
  b.add('A', 'human', 'lineman', c(6, 3), { id: 'a2' });
  b.add('B', 'orc', 'lineman', c(16, 9), { id: 'o1' });
  b.ball(c(12, 7));
  const r = await decide(b.start());
  assert.equal(r.meta.fellBack, false, JSON.stringify(r.meta.reason));
  assert.ok(takesBall(inputOf(r), 12, 7), `goes for the ball (${(r.move as any).why})`);
});

test('carrier protection: the trace checks the opponent\'s Blitz on our carrier against the 90% / 95% / 96.9% Turnover standards', async () => {
  const b = new Pos({ turnA: 3, turnB: 3, rerollsA: 1, rerollsB: 1 });
  const car = b.add('A', 'human', 'thrower', c(12, 7), { id: 'car' });
  b.add('A', 'human', 'lineman', c(11, 7), { id: 'g1' });
  b.add('B', 'orc', 'blitzer', c(13, 7), { id: 'b1' });
  b.add('B', 'orc', 'blitzer', c(15, 10), { id: 'b2' });
  b.add('B', 'orc', 'lineman', c(20, 2), { id: 'o3' });
  b.give(car);
  const r = await decide(b.start());
  assert.equal(r.meta.fellBack, false, JSON.stringify(r.meta.reason));
  const tr = r.meta.trace as any;
  assert.deepEqual(tr.thresholds, { 1: 0.9, 2: 0.95, 3: 0.969 });
  const blitzes = (tr.deep as any[]).flatMap((d) => d.rows).map((x) => x.blitz).filter((x) => x && typeof x === 'object');
  assert.ok(blitzes.length > 0, 'an exposed carrier is reported with the Blitz that exposes it');
  for (const z of blitzes) {
    assert.ok(z.pTurnover < z.need);
    assert.equal(z.need, z.dice >= 3 ? 0.969 : z.dice === 2 ? 0.95 : 0.9);
  }
});

test('sideline danger: a carrier on the touchline with a Blitzer two squares away does not stay on the line', async () => {
  const b = new Pos({ turnA: 3, turnB: 3, rerollsA: 1, rerollsB: 1 });
  const car = b.add('A', 'human', 'lineman', c(12, 0), { id: 'car' });
  b.add('B', 'orc', 'blitzer', c(12, 2), { id: 'b1' });
  b.add('B', 'orc', 'lineman', c(22, 9), { id: 'o2' });
  b.add('A', 'human', 'lineman', c(8, 7), { id: 'a2' });
  b.give(car);
  const r = await decide(b.start());
  assert.equal(r.meta.fellBack, false, JSON.stringify(r.meta.reason));
  const i = inputOf(r);
  const leaves = i.kind === 'playerAction' && i.playerId === 'car' && i.path?.length ? i.path[i.path.length - 1].to : null;
  assert.ok(leaves ? leaves.y >= 1 : i.kind === 'playerAction' && i.action === 'block', `the carrier leaves the touchline or the Blitzer is dealt with (${(r.move as any).why})`);
});

test('replanning after a state change: with the carrier down and the ball loose, it goes for the ball', async () => {
  const b = new Pos({ turnA: 4, turnB: 3 });
  b.add('A', 'human', 'lineman', c(9, 7), { id: 'a1' });
  b.add('A', 'human', 'thrower', c(12, 8), { id: 'car', stance: 'prone' });
  b.add('B', 'orc', 'lineman', c(18, 3), { id: 'o1' });
  b.ball(c(11, 7));
  const r = await decide(b.start());
  assert.equal(r.meta.fellBack, false, JSON.stringify(r.meta.reason));
  assert.ok(takesBall(inputOf(r), 11, 7), `goes for the ball (${(r.move as any).why})`);
});

test('reliable receiving: a touchback goes to the strongest reliable player; the object answer is accepted for apiMinor 2', async () => {
  const b = new Pos({ turnA: 3, turnB: 3 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'lin' });
  b.add('A', 'human', 'catcher', c(9, 5), { id: 'cat', extraSkills: [{ id: 'boneHead' } as never] });
  b.add('A', 'human', 'blitzer', c(8, 9), { id: 'bli', skills: [] });
  b.add('B', 'orc', 'lineman', c(17, 7), { id: 'o1' });
  const s = b.start();
  const ses = new Session(s, 'A', 3, 5000);
  const options = ['lin', 'cat', 'bli'].map((id) => ({ id, label: id }));
  const out = await runModule(nodeSpawn, CODE, { type: 'decision', requestId: 3, observation: observe(s, 'A', 3), request: { type: 'touchback', options } }, ses);
  assert.ok(out.result && typeof out.result === 'object');
  const d = resolveDecision(options, out.result, 2);
  assert.ok(d.ok);
  assert.equal((d as any).optionId, 'bli', 'the Bone-head Catcher is passed over for the reliable Blitzer');
  const old = resolveDecision(options, out.result, 0);
  assert.equal(old.ok, false, 'older modules\' object answers stay ignored');
});

test('the three-die Blitz threshold (96.9%) is derived from the engine\'s own block outcomes', () => {
  // Measured: a Block by an unskilled attacker on an unskilled carrier, no re-rolls — 1 die (ST 3 v 3), 2 dice (4 v 3), 3 dice (7 v 3).
  const measure = (st: number) => {
    const b = new Pos({ active: 'B', rerollsA: 0, rerollsB: 0 });
    const car = b.add('A', 'human', 'lineman', c(10, 7), { id: 'car', skills: [] });
    b.add('B', 'orc', 'lineman', c(11, 7), { id: 'att', skills: [], st });
    b.give(car);
    const plan = Engine.planAction(b.start(), { kind: 'playerAction', playerId: 'att', action: 'block', path: [], blockTarget: 'car' } as never, { followUp: true });
    return { dice: plan.block!.dice, knockdown: plan.withTeamRerolls!.pTargetDown, blockTurnover: plan.withTeamRerolls!.pTurnover };
  };
  const m = [measure(3), measure(4), measure(7)];
  assert.deepEqual(m.map((x) => x.dice), [1, 2, 3]);
  // Supplied standards: the opponent's total Turnover chance must be at least 90% (1 die) and 95% (2 dice). With
  // total = 1 − s·(1 − blockTurnover), s is the most the movement before the Block may succeed.
  const s = (th: number, bt: number) => (1 - th) / (1 - bt);
  const s1 = s(0.9, m[0].blockTurnover);
  const s2 = s(0.95, m[1].blockTurnover);
  // s falls as the chance that the Block knocks the carrier down rises: a power law through the two supplied points.
  const k = Math.log(s1 / s2) / Math.log(m[1].knockdown / m[0].knockdown);
  const s3 = s2 * Math.pow(m[1].knockdown / m[2].knockdown, k);
  const th3 = 1 - s3 * (1 - m[2].blockTurnover);
  assert.ok(Math.abs(k - 4) < 0.01, `exponent ${k}`);
  assert.ok(Math.abs(th3 - 0.969) < 0.0005, `three-die threshold ${th3}`);
  assert.ok(0.9 < 0.95 && 0.95 < th3, 'monotone in the number of dice');
});
