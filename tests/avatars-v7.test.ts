/** V7-04: avatar contracts — deterministic looks, safe customization, moods derived only from real engine facts, bubbles/enable switches. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { execute } from '../src/engine/engine';
import type { ActionInput, GameEvent, GameState } from '../src/engine/types';
import {
  ACCENTS, FACES, HEADGEARS, SKINS, _resetAvatarCache, avatarSettings, bubbleText, clearReactions, defaultSpec, moodFor, noteExecution, reactionOf, reactionTo, reactionToLog, sanitizeSpec, spriteGrid, spriteSvg,
  type Mood,
} from '../src/ui/avatars';

const MOODS: Mood[] = ['idle', 'thinking', 'acting', 'cheer', 'dismay', 'hurt'];
const ex1 = (): GameState => JSON.parse(readFileSync('examples/01-two-dodges-to-glory.json', 'utf8')).state as GameState;
const step = (pts: number[][]) => pts.map(([x, y]) => ({ to: { x, y }, kind: 'step' as const }));
const MID = { kind: 'playerAction', playerId: 'A1', action: 'move', path: step([[18, 7], [19, 7], [20, 7], [21, 7], [22, 7], [23, 7], [24, 7], [25, 6]]) } as ActionInput;

test('default looks are deterministic per AI id and differ between ids', () => {
  assert.deepEqual(defaultSpec('bloodboard-balanced'), defaultSpec('bloodboard-balanced'));
  const looks = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => JSON.stringify(defaultSpec(id))));
  assert.ok(looks.size >= 5, 'different AI files do not all look alike');
});

test('customization is sanitized: bad indexes, unknown parts and markup in the name tag fall back safely', () => {
  const d = defaultSpec('x');
  const s = sanitizeSpec({ skin: 99, accent: -1, headgear: 'laser', face: 3, label: '<img src=x onerror=alert(1)>Bob"\n' }, 'x');
  assert.equal(s.skin, d.skin); assert.equal(s.accent, d.accent); assert.equal(s.headgear, d.headgear); assert.equal(s.face, d.face);
  assert.ok(!/[<>\n]/.test(s.label) && s.label.length <= 24);
  assert.deepEqual(sanitizeSpec('nonsense', 'x'), d);
  const svg = spriteSvg({ ...d, label: 'He said "hi" <b>' }, 'idle');
  const label = /aria-label="([^"]*)"/.exec(svg)?.[1] ?? '';
  assert.ok(!/[<>]/.test(label) && !svg.includes('<b>'), 'markup cannot reach the SVG');
  assert.ok(!svg.includes('<script'));
});

test('every look x mood is a valid 16x16 grid and each mood is visibly different', () => {
  for (const headgear of HEADGEARS) for (const face of FACES) {
    const spec = { ...defaultSpec('t'), headgear, face, skin: SKINS.length - 1, accent: ACCENTS.length - 1 };
    const seen = new Set<string>();
    for (const m of MOODS) {
      const g = spriteGrid(spec, m);
      assert.equal(g.length, 16); for (const r of g) assert.match(r, /^[.sakwr]{16}$/);
      seen.add(g.join('|'));
    }
    assert.ok(seen.size >= 5, `${headgear}/${face}: moods are distinguishable (${seen.size})`);
  }
});

test('moods come from real engine events: a Touchdown cheers the scorer and sinks the opponent; no event, no reaction', () => {
  let found: { ev: GameEvent; after: GameState } | null = null;
  for (let seed = 1; seed < 400 && !found; seed++) {
    const s = ex1(); s.rng = { seed, counter: 0 };
    const r = execute(s, MID);
    const ev = r.events.find((e) => e.type === 'touchdown');
    if (ev) found = { ev, after: r.state };
  }
  assert.ok(found, 'the shipped example scores on some seeds');
  const scorer = (found!.ev.data as { team: 'A' | 'B' }).team, other = scorer === 'A' ? 'B' : 'A';
  assert.equal(reactionTo(scorer, found!.ev, found!.after)?.mood, 'cheer');
  assert.equal(reactionTo(other, found!.ev, found!.after)?.mood, 'dismay');
  assert.equal(reactionTo('A', { type: 'move', text: 'x' }, found!.after), null);
  assert.equal(reactionToLog('A', 'A', 'turnover')?.mood, 'dismay'); assert.equal(reactionToLog('B', 'A', 'turnover')?.mood, 'cheer'); assert.equal(reactionToLog('A', 'A', 'completed'), null);
  const inj: GameEvent = { type: 'injury', text: 'x', data: { playerId: found!.after.players.find((p) => p.team === 'A')!.id, result: 'casualty' } };
  assert.equal(reactionTo('A', inj, found!.after)?.mood, 'hurt'); assert.equal(reactionTo('B', inj, found!.after)?.mood, 'cheer');
  assert.equal(reactionTo('A', { ...inj, data: { ...inj.data, result: 'stunned' } }, found!.after), null, 'a mere Stun is not a reaction');
});

test('reactions expire; thinking and acting only apply to the coach that is to act; precedence reaction > thinking > acting > idle', () => {
  clearReactions();
  const g = ex1(); const t0 = 1_000_000;
  const touchdown: GameEvent = { type: 'touchdown', text: 'TD', data: { team: 'A', playerId: g.players[0].id } };
  assert.deepEqual(noteExecution(g, [touchdown], 'A', 'touchdown', t0).sort(), ['A', 'B']);
  assert.equal(reactionOf('A')?.mood, 'cheer');
  assert.equal(moodFor({ thinking: true, coachToAct: true, acting: true, reaction: reactionOf('A'), now: t0 + 100 }), 'cheer');
  assert.equal(moodFor({ thinking: true, coachToAct: true, acting: true, reaction: reactionOf('A'), now: t0 + 10_000 }), 'thinking');
  assert.equal(moodFor({ thinking: true, coachToAct: false, acting: false, reaction: null, now: t0 }), 'idle', 'the waiting coach does not think');
  assert.equal(moodFor({ thinking: false, coachToAct: true, acting: true, reaction: null, now: t0 }), 'acting');
  clearReactions();
});

test('bubbles: off switch, short reactions by default, the move reason only when the person turned it on, long text trimmed', () => {
  _resetAvatarCache(); clearReactions();
  const s = avatarSettings(); assert.equal(s.enabled, true); assert.equal(s.bubbles, true); assert.equal(s.reasons, false);
  const g = ex1(); const t0 = 5_000_000;
  assert.equal(bubbleText('A', 'because the odds are good', t0), null, 'no reason text unless enabled');
  noteExecution(g, [{ type: 'touchdown', text: 'TD', data: { team: 'A', playerId: g.players[0].id } }], 'A', 'touchdown', t0);
  assert.equal(bubbleText('A', null, t0 + 10), 'Touchdown!');
  s.reasons = true; assert.equal(bubbleText('B', 'x'.repeat(200), t0 + 99_999)?.length, 88);
  s.bubbles = false; assert.equal(bubbleText('A', 'reason', t0 + 10), null);
  s.enabled = false; s.bubbles = true; assert.equal(bubbleText('A', 'reason', t0 + 10), null);
  _resetAvatarCache(); clearReactions();
});
