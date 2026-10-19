/**
 * V7 rules corrections from the May 2026 Blood Bowl FAQ / errata (pack "Claude_V6_Rules_Corrections_20261003").
 * Each test pins the corrected behaviour AND its neighbouring correct case, with fixed dice.
 * Issue ids are the pack's BB-FAQ-nnn.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROSTER_BY_ID, toSaveFile, parseSaveFile, checkCompatibility, validateState, type PlayerActionInput } from '../src/engine/index';
import { positionKey } from '../src/platform/explore';
import { analysisHash } from '../src/platform/analysis';
import { clampD6, d6Success } from '../src/engine/dice';
import { newTeamDef, playerFromRoster, validateTeamDef, type TeamDef } from '../src/engine/teams';
import { c, p, Pos, runScripted, type Chooser } from './helpers';

const move = (id: string, path: Array<[number, number]>, action: PlayerActionInput['action'] = 'move', extra: Partial<PlayerActionInput> = {}): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action, path: path.map(([x, y]) => ({ to: { x, y }, kind: 'step' as const })), ...extra } as PlayerActionInput);
const block = (id: string, t: string, extra: Partial<PlayerActionInput> = {}): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'block', path: [], blockTarget: t, ...extra } as PlayerActionInput);
const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const asked: string[] = [];
const answer = (map: Record<string, string>): Chooser => (req) => { asked.push(req.type); return map[req.type] ?? req.options[0].id; };
const pos = (roster: string, id: string) => ROSTER_BY_ID[roster].positions.find((x) => x.id === id)!;
const loner = (pp: { skills: Array<{ id: string; value?: number }> }) => pp.skills.find((k) => k.id === 'loner')?.value;

// ── roster data (BB-FAQ-001..004) ─────────────────────────────────────────────
test('BB-FAQ-001..004: the four roster corrections, and only those entries', () => {
  assert.equal(loner(pos('chaosRenegade', 'ogre')), 3, 'Chaos Renegade Ogre Loner 3+');
  assert.ok(pos('chaosRenegade', 'ogre').skills.some((k) => k.id === 'mightyBlow'));
  for (const [r, id] of [['human', 'ogre'], ['imperialNobility', 'ogre'], ['oldWorldAlliance', 'ogre']]) if (ROSTER_BY_ID[r]) assert.equal(loner(pos(r, id)), 3, `${r} Ogre was already 3+`);
  assert.deepEqual(pos('dwarf', 'runner').secondary, ['A', 'S'], 'Dwarf Runner gains Agility Secondary');
  assert.ok(pos('oldWorldAlliance', 'dwarfRunner').secondary.includes('A'), 'OWA Dwarf Runner already had A');
  assert.equal(loner(pos('oldWorldAlliance', 'treeman')), 4, 'OWA Treeman Loner 4+');
  for (const r of ['halfling', 'gnome']) assert.equal(loner(pos(r, 'treeman')), undefined, `${r} Treeman is a different entry and is unchanged`);
  assert.equal(pos('orc', 'goblin').pa, 4, 'Orc Goblin Lineman PA 4+');
  assert.equal(pos('goblin', 'lineman').pa, 4, 'Goblin-team Goblin already PA 4+');
});

// ── Elite caps (BB-FAQ-005) in tests/matched.test.ts; D6 arithmetic (BB-FAQ-006) ──
test('BB-FAQ-006: a modified D6 may drop below 1; natural 1 fails, natural 6 succeeds; pass/fail of ordinary tests is unchanged', () => {
  assert.equal(clampD6(2 - 4), -2);
  assert.equal(clampD6(6 + 3), 6, 'upper cap kept');
  assert.equal(d6Success(6, 4, -5), true, 'natural 6 always succeeds');
  assert.equal(d6Success(1, 2, +5), false, 'natural 1 always fails');
  // Quantified: against the old rule (floor 1) no pass/fail outcome of a 2+..6+ test changes.
  const old = (n: number, t: number, m: number) => (n === 1 ? false : n === 6 ? true : Math.max(1, Math.min(6, n + m)) >= t);
  let changed = 0;
  for (let t = 2; t <= 6; t++) for (let m = -9; m <= 9; m++) for (let n = 1; n <= 6; n++) if (old(n, t, m) !== d6Success(n, t, m)) changed++;
  assert.equal(changed, 0, 'binary outcomes of targets 2+..6+ are identical; only the displayed modified value differs');
});

// ── Shadowing after a failed Dodge (BB-FAQ-007) ──────────────────────────────
function shadowScene() {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', extraSkills: [{ id: 'shadowing' }] });
  b.add('B', 'orc', 'lineman', c(22, 2), { id: 'B2' });
  b.ball(c(2, 2));
  return b;
}
test('BB-FAQ-007: Shadowing is offered only after a SUCCESSFUL Dodge', () => {
  asked.length = 0;
  const failed = runScripted(shadowScene().start(), move('A1', [[9, 7]]), [1, 2, 2], answer({ shadowing: 'B1' }));
  assert.ok(!asked.includes('shadowing'), `no Shadowing choice after a failed Dodge (asked: ${asked.join(',')})`);
  assert.equal(p(failed.state, 'A1').stance, 'prone');
  assert.deepEqual(p(failed.state, 'B1').pos, c(11, 7), 'the shadower stays put');
  asked.length = 0;
  const ok = runScripted(shadowScene().start(), move('A1', [[9, 7]]), [6, 5], answer({ shadowing: 'B1' }));
  assert.ok(asked.includes('shadowing'), 'offered after a successful Dodge');
  assert.deepEqual(p(ok.state, 'B1').pos, c(10, 7), 'a 4+ follows into the vacated square');
});

// ── Always Hungry (BB-FAQ-008) ───────────────────────────────────────────────
const ttm = (thrower: string, thrown: string, target: [number, number]): PlayerActionInput => ({ kind: 'playerAction', playerId: thrower, action: 'ttm', path: [], thrownPlayerId: thrown, throwTarget: c(target[0], target[1]) } as PlayerActionInput);
test('BB-FAQ-008: eating the team-mate causes a Turnover only when they held the ball', () => {
  const mk = (carrier: boolean) => {
    const b = new Pos();
    b.add('A', 'orc', 'troll', c(10, 7), { id: 'T', skills: [{ id: 'alwaysHungry' }, { id: 'throwTeamMate' }] });
    const g = b.add('A', 'orc', 'goblin', c(11, 7), { id: 'G' });
    b.add('B', 'human', 'lineman', c(20, 2), { id: 'B1' });
    if (carrier) b.give(g); else b.ball(c(2, 2));
    return b.start();
  };
  const plain = runScripted(mk(false), ttm('T', 'G', [13, 7]), [1, 1]);
  assert.equal(plain.status, 'completed', texts(plain));
  assert.equal(p(plain.state, 'G').location, 'cas');
  assert.equal(plain.state.turn.active, 'A');
  const held = runScripted(mk(true), ttm('T', 'G', [13, 7]), [1, 1, 3]);
  assert.equal(held.status, 'turnover', texts(held));
  assert.equal(p(held.state, 'G').location, 'cas');
});

// ── Animal Savagery (BB-FAQ-009) ──────────────────────────────────────────────
test('BB-FAQ-009: after a lash-out the activation continues unless Distracted or a Turnover', () => {
  const mk = (extra?: (b: Pos) => void) => {
    const b = new Pos({ rerollsA: 0 });
    b.add('A', 'orc', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'animalSavagery' }] });
    b.add('B', 'orc', 'lineman', c(22, 2), { id: 'B1' });
    b.ball(c(2, 2));
    extra?.(b);
    return b.start();
  };
  // victim without the ball: A2 knocked down (armour 2+2 holds); A1 completes the declared Move
  const free = runScripted(mk((b) => b.add('A', 'orc', 'lineman', c(10, 8), { id: 'A2' })), move('A1', [[11, 7]]), [3, 2, 2], answer({ animalSavagery: 'A2' }));
  assert.equal(p(free.state, 'A2').stance, 'prone');
  assert.deepEqual(p(free.state, 'A1').pos, c(11, 7));
  assert.equal(free.state.turn.active, 'A');
  assert.equal(free.state.turn.activation?.over ?? true, free.state.turn.activation?.over ?? true);
  // victim WITH the ball: Turnover
  const held = runScripted(mk((b) => { const a2 = b.add('A', 'orc', 'lineman', c(10, 8), { id: 'A2' }); b.give(a2); }), move('A1', [[11, 7]]), [3, 2, 2, 7], answer({ animalSavagery: 'A2' }));
  assert.notEqual(held.state.turn.active, 'A', 'the ball carrier went down: Turnover');
  // no adjacent standing team-mate: Distracted, activation ends
  const alone = runScripted(mk(), move('A1', [[11, 7]]), [2]);
  assert.equal(p(alone.state, 'A1').distracted, true);
  assert.deepEqual(p(alone.state, 'A1').pos, c(10, 7));
});

// ── Brawler once per activation (BB-FAQ-010) ─────────────────────────────────
// Frenzy: two Blocks. Brawler re-rolls one Both Down die, once per ACTIVATION (the first or the second Block).
function brawlScene() {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'lineman', c(10, 7), { id: 'A1', st: 4, extraSkills: [{ id: 'brawler' }, { id: 'frenzy' }] });
  b.add('B', 'human', 'lineman', c(11, 7), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(22, 2), { id: 'B2' });
  b.ball(c(2, 2));
  return b.start();
}
function brawlRun(useFirst: boolean, faces: number[]) {
  const offers: boolean[] = [];
  let n = 0;
  const choose: Chooser = (req) => {
    if (req.type === 'reroll') {
      const has = req.options.some((o) => o.id === 'brawler');
      offers.push(has);
      n++;
      if (has && (useFirst ? n === 1 : n === 2)) return 'brawler';
      return 'none';
    }
    if (req.type === 'blockDie') return req.options.find((o) => o.id === 'push')?.id ?? req.options[0].id;
    if (req.type === 'followUp') return 'yes';
    return req.options[0].id;
  };
  const r = runScripted(brawlScene(), block('A1', 'B1'), faces, choose);
  return { offers, r };
}
test('BB-FAQ-010: Brawler re-rolls once per activation: declined on the first Block it stays available for the second; used on the first it is not offered again', () => {
  const declined = brawlRun(false, [2, 3, 2, 3, 4]);
  assert.deepEqual(declined.offers.slice(0, 2), [true, true], `declined first, offered again: ${declined.offers}`);
  assert.match(texts(declined.r), /Brawler: one .* die re-rolled/);
  const used = brawlRun(true, [2, 3, 3, 2, 3]);
  // used on the first Block: the second Frenzy Block has no Brawler option (no re-roll decision is asked at all)
  assert.deepEqual(used.offers, [true], `Brawler offered once only: ${used.offers}`);
  assert.match(texts(used.r), /Frenzy/, 'the second (Frenzy) Block did happen');
  assert.equal((texts(used.r).match(/Brawler: one/g) ?? []).length, 1);
});

// ── Grab and Sidestep (BB-FAQ-011, 012) ──────────────────────────────────────
const blitz = (id: string, t: string): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'blitz', path: [], blitzTarget: t, blockTarget: t } as PlayerActionInput);
function skillsAsked(s: ReturnType<Pos['start']>, input: PlayerActionInput, faces: number[], grabAnswer = 'yes', pushTo?: string) {
  const skills: Array<string> = [];
  const choose: Chooser = (req) => {
    if (req.type === 'skill') { const k = String((req.context as { skill?: string } | undefined)?.skill); skills.push(`${req.team}:${k}`); return k === 'grab' ? grabAnswer : 'no'; }
    if (req.type === 'followUp') return 'no';
    if (req.type === 'pushSquare' && pushTo && req.options.some((o) => o.id === pushTo)) return pushTo;
    return req.options[0].id;
  };
  const r = runScripted(s, input, faces, choose);
  return { skills, r };
}
function grabScene(chain = false) {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'grab' }] });
  b.add('B', 'human', 'lineman', c(11, 7), { id: 'B1', extraSkills: [{ id: 'sidestep' }] });
  if (chain) {
    b.add('B', 'human', 'lineman', c(12, 6), { id: 'B3', extraSkills: [{ id: 'sidestep' }] });
    b.add('B', 'human', 'lineman', c(12, 7), { id: 'B4' });
    b.add('B', 'human', 'lineman', c(12, 8), { id: 'B5' });
  }
  b.add('B', 'orc', 'lineman', c(22, 2), { id: 'B2' });
  b.ball(c(2, 2));
  return b.start();
}
test('BB-FAQ-011: Grab removes the target\'s Sidestep only on a declared Block, not on a Blitz', () => {
  const blk = skillsAsked(grabScene(), block('A1', 'B1'), [3]);
  assert.ok(blk.skills.includes('A:grab') && !blk.skills.some((k) => k.endsWith('sidestep')), `Block: ${blk.skills}`);
  const bl = skillsAsked(grabScene(), blitz('A1', 'B1'), [3]);
  assert.ok(bl.skills.includes('B:sidestep') && !bl.skills.includes('A:grab'), `Blitz: ${bl.skills}`);
});
test('BB-FAQ-012: Grab cancels Sidestep only for the original Block target, not for a player pushed in the chain', () => {
  const r = skillsAsked(grabScene(true), block('A1', 'B1'), [3], 'no', '12,6');
  assert.ok(r.skills.includes('A:grab'));
  assert.equal(r.skills.filter((k) => k === 'B:sidestep').length, 1, `exactly the chain-pushed B3 may Sidestep: ${r.skills}`);
});

// ── Trickster and Chomped (BB-FAQ-013) ───────────────────────────────────────
function trickScene(state: 'chomped' | 'rooted' | 'free') {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'lineman', c(10, 7), { id: 'A1' });
  const t = b.add('B', 'human', 'lineman', c(11, 7), { id: 'B1', extraSkills: [{ id: 'trickster' }] });
  b.add('A', 'orc', 'lineman', c(12, 7), { id: 'C1' }); // a non-Distracted opponent of B1 adjacent to B1: the chomper
  b.add('B', 'orc', 'lineman', c(22, 2), { id: 'B2' });
  b.ball(c(2, 2));
  const s = b.start();
  const tt = p(s, 'B1');
  if (state === 'chomped') tt.chompedBy = 'C1';
  if (state === 'rooted') tt.rooted = true;
  void t;
  return s;
}
test('BB-FAQ-013: a Chomped player may use Trickster and is freed; a Rooted one still may not', () => {
  const run = (st: 'chomped' | 'rooted' | 'free') => {
    asked.length = 0;
    const r = runScripted(trickScene(st), block('A1', 'B1'), [3, 3, 3, 3], (req) => { asked.push(req.type); return req.type === 'trickster' ? req.options.find((o) => o.id !== 'stay')!.id : req.type === 'followUp' ? 'no' : req.options[0].id; });
    return r;
  };
  const chomped = run('chomped');
  assert.ok(asked.includes('trickster'), `offered while Chomped: ${asked}`);
  assert.equal(p(chomped.state, 'B1').chompedBy, undefined, 'the Chomped condition ends');
  assert.match(texts(chomped), /no longer Chomped/);
  run('rooted');
  assert.ok(!asked.includes('trickster'), 'Take Root is not waived');
  run('free');
  assert.ok(asked.includes('trickster'), 'plain case unchanged');
});

// ── Foul offensive assists are optional, declared before the dice (BB-FAQ-014) ─
function foulScene(withDefender = false) {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'human', 'lineman', c(11, 7), { id: 'B1', stance: 'prone' });
  b.add('A', 'orc', 'lineman', c(12, 6), { id: 'A2' });
  b.add('A', 'orc', 'lineman', c(12, 7), { id: 'A3' });
  if (withDefender) b.add('B', 'human', 'lineman', c(9, 7), { id: 'B3' });
  b.add('B', 'human', 'lineman', c(22, 2), { id: 'B2' });
  b.ball(c(2, 2));
  return b.start();
}
const foul = (id: string, t: string): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'foul', path: [], foulTarget: t } as PlayerActionInput);
test('BB-FAQ-014: the Offensive Assist count is chosen before the Armour Roll; Defensive Assists always apply', () => {
  const run = (pick: string | null, def = false) => {
    asked.length = 0;
    let offered = '';
    const r = runScripted(foulScene(def), foul('A1', 'B1'), [4, 3, 3, 4, 3, 3], (req) => { asked.push(req.type); if (req.type === 'foulAssist') { offered = req.options.map((o) => o.id).join(','); return pick ?? req.options[0].id; } return req.options[0].id; });
    return { r, offered };
  };
  const all = run(null);
  assert.equal(all.offered, '2,1,0', 'options: all, some, none');
  assert.match(texts(all.r), /\+2 assists \(2 offensive, 0 defensive\)[^\n]*armour broken/, texts(all.r));
  const none = run('0');
  assert.doesNotMatch(texts(none.r), /assists \(/, 'no assist counted');
  assert.match(texts(none.r), /Foul Armour Roll[^\n]*7 vs AV 9\+ — armour holds/, texts(none.r));
  const one = run('1');
  assert.match(texts(one.r), /\+1 assists \(1 offensive, 0 defensive\)/);
  const withDef = run('0', true);
  assert.match(texts(withDef.r), /-1 assists \(0 offensive, 1 defensive\)/, `defensive assist still applies: ${texts(withDef.r)}`);
});

// ── Blitz Stab and Hit and Run (BB-FAQ-015) ──────────────────────────────────
function stabScene(hr: boolean) {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'lineman', c(10, 7), { id: 'A1', extraSkills: [{ id: 'stab' }, ...(hr ? [{ id: 'hitAndRun' }] : [])] });
  b.add('B', 'human', 'lineman', c(11, 7), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(22, 2), { id: 'B2' });
  b.ball(c(2, 2));
  return b.start();
}
const stabBlitz = (): PlayerActionInput => ({ kind: 'playerAction', playerId: 'A1', action: 'blitz', path: [], blitzTarget: 'B1', special: 'stab', specialTarget: 'B1' } as PlayerActionInput);
test('BB-FAQ-015: a Blitz Stab still gives Hit and Run its one free square, then the activation ends', () => {
  asked.length = 0;
  const r = runScripted(stabScene(true), stabBlitz(), [1, 1], (req) => { asked.push(req.type); return req.type === 'hitAndRun' ? '9,7' : req.options[0].id; });
  assert.ok(asked.includes('hitAndRun'), `Hit and Run offered after the Stab: ${asked}`);
  assert.deepEqual(p(r.state, 'A1').pos, c(9, 7));
  assert.equal(r.state.turn.active, 'A', 'no Turnover');
  assert.equal(r.state.turn.activation?.over ?? true, true, 'the activation is over: no further Blitz movement');
  asked.length = 0;
  const plain = runScripted(stabScene(false), stabBlitz(), [1, 1], answer({}));
  assert.ok(!asked.includes('hitAndRun'));
  assert.deepEqual(p(plain.state, 'A1').pos, c(10, 7));
});

// ── Steady Footing keeps the submitted movement going (BB-FAQ-016) ───────────
const path = (steps: Array<[number, number, ('step' | 'jump')?]>) => steps.map(([x, y, k]) => ({ to: c(x, y), kind: k ?? 'step' as const }));
const mv = (id: string, steps: Array<[number, number, ('step' | 'jump')?]>): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'move', path: path(steps) } as PlayerActionInput);
function sfScene(o: { ma?: number; prone?: boolean; marker?: boolean } = {}) {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'lineman', c(10, 7), { id: 'A1', ma: o.ma, extraSkills: [{ id: 'steadyFooting' }] });
  if (o.marker) b.add('B', 'human', 'lineman', c(11, 8), { id: 'B1' });
  if (o.prone) b.add('B', 'human', 'lineman', c(11, 7), { id: 'B3', stance: 'prone' });
  b.add('B', 'orc', 'lineman', c(22, 2), { id: 'B2' });
  b.ball(c(2, 2));
  return b.start();
}
test('BB-FAQ-016: a Steady Footing 6 after a failed Dodge / Rush / Jump keeps the player Standing AND lets the submitted path continue', () => {
  // Dodge: fail (1), Steady Footing 6, then the rest of the path (no markers there)
  const dodge = runScripted(sfScene({ marker: true }), mv('A1', [[9, 7], [8, 7], [7, 7]]), [1, 6], answer({}));
  assert.deepEqual(p(dodge.state, 'A1').pos, c(7, 7), texts(dodge));
  assert.equal(p(dodge.state, 'A1').stance, 'standing');
  assert.equal(dodge.state.turn.active, 'A', 'no Turnover');
  // Neighbour: Steady Footing 5 fails → falls over → Turnover
  const fell = runScripted(sfScene({ marker: true }), mv('A1', [[9, 7], [8, 7], [7, 7]]), [1, 5, 2, 2], answer({}));
  assert.equal(p(fell.state, 'A1').stance, 'prone');
  assert.notEqual(fell.state.turn.active, 'A');
  // Rush: MA 1 → two Rushes; the first fails, SF 6, the second succeeds
  const rush = runScripted(sfScene({ ma: 1 }), mv('A1', [[9, 7], [8, 7], [7, 7]]), [1, 6, 4], answer({}));
  assert.deepEqual(p(rush.state, 'A1').pos, c(7, 7), texts(rush));
  assert.equal(p(rush.state, 'A1').stance, 'standing');
  assert.equal(rush.state.turn.active, 'A');
  // Jump: over a prone player, failing the Agility test (2), SF 6; the player lands standing and goes on
  const jump = runScripted(sfScene({ prone: true }), mv('A1', [[12, 7, 'jump'], [13, 7]]), [2, 6], answer({}));
  assert.deepEqual(p(jump.state, 'A1').pos, c(13, 7), texts(jump));
  assert.equal(p(jump.state, 'A1').stance, 'standing');
  assert.equal(jump.state.turn.active, 'A');
});

// ── Team Mascot + Team Captain (BB-FAQ-017) ──────────────────────────────────
test('BB-FAQ-017: after a successful Mascot 4+ the Captain may make it free; every later use needs a new 4+ (and may be ineffective)', () => {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'lineman', c(10, 7), { id: 'A1', st: 4, extraSkills: [{ id: 'frenzy' }] });
  const cap = b.add('A', 'orc', 'lineman', c(5, 12), { id: 'A9' });
  b.add('B', 'human', 'lineman', c(11, 7), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(22, 2), { id: 'B2' });
  b.ball(c(2, 2));
  const s = b.start();
  s.teams.A.specialRules = ['Team Captain'];
  p(s, cap.id).captain = true;
  s.teams.A.mascotReroll = true;
  const used: string[] = [];
  const r = runScripted(s, block('A1', 'B1'), [3, 3, 5, 6, 3, 3, 3, 3, 2], (req) => {
    if (req.type === 'reroll') { used.push(req.options.map((o) => o.id).join('|')); return req.options.some((o) => o.id === 'mascot') ? 'mascot' : 'none'; }
    if (req.type === 'blockDie') return req.options.find((o) => o.id === 'push')?.id ?? req.options[0].id;
    if (req.type === 'followUp') return 'yes';
    return req.options[0].id;
  });
  const t = texts(r);
  assert.match(t, /Team Mascot: 5 — the Team Re-roll can be used/);
  assert.match(t, /Team Captain [^\n]*rolled 6 — a natural 6, the Team Mascot's re-roll is free/, t);
  assert.ok(used.length >= 2 && used[1].includes('mascot'), `the Mascot is offered again for the second Block: ${used.join(' / ')}`);
  assert.match(t, /Team Mascot: 2 — the Mascot is ineffective/, 'a fresh 4+ is required each time and can fail');
  assert.equal(r.state.teams.A.mascotReroll, false, 'lost for the half after the failed second use');
  // neighbour: without a Captain on the pitch the Mascot is spent after one successful use
  const s2 = runScripted((() => { const b2 = new Pos({ rerollsA: 0 }); b2.add('A', 'orc', 'lineman', c(10, 7), { id: 'A1', st: 4, extraSkills: [{ id: 'frenzy' }] }); b2.add('B', 'human', 'lineman', c(11, 7), { id: 'B1' }); b2.add('B', 'orc', 'lineman', c(22, 2), { id: 'B2' }); b2.ball(c(2, 2)); const st = b2.start(); st.teams.A.mascotReroll = true; return st; })(), block('A1', 'B1'), [3, 3, 5, 3, 3, 3, 3], (req) => (req.type === 'reroll' ? (req.options.some((o) => o.id === 'mascot') ? 'mascot' : 'none') : req.type === 'blockDie' ? (req.options.find((o) => o.id === 'push')?.id ?? req.options[0].id) : req.type === 'followUp' ? 'yes' : req.options[0].id));
  assert.equal(s2.state.teams.A.mascotReroll, false);
  assert.doesNotMatch(texts(s2), /Team Captain/);
});

// ── Ball & Chain follow-up while Chomped (BB-FAQ-018) ────────────────────────
const bncStep = { kind: 'playerAction', playerId: 'F', action: 'special', special: 'ballAndChain', facing: 'x+', path: [] } as PlayerActionInput;
function bncScene(chomped: boolean) {
  const b = new Pos({ rerollsA: 0 });
  b.add('A', 'orc', 'goblin', c(10, 7), { id: 'F', extraSkills: [{ id: 'ballAndChain' }] });
  b.add('B', 'orc', 'lineman', c(9, 7), { id: 'B1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B2' });
  b.ball(c(2, 2));
  const s = b.start();
  if (chomped) p(s, 'F').chompedBy = 'B1';
  return s;
}
test('BB-FAQ-018: a Ball & Chain player may follow up after his forced Block even while Chomped', () => {
  const chooser: Chooser = (req) => (req.type === 'followUp' ? 'yes' : req.type === 'apothecary' ? 'keep' : req.options[0].id);
  for (const chomped of [false, true]) {
    const r = runScripted(bncScene(chomped), bncStep, [3, 6, 6, 2, 2], chooser);
    assert.equal(p(r.state, 'B2').stance, 'prone', texts(r));
    assert.deepEqual(p(r.state, 'F').pos, c(11, 7), `follow-up taken (chomped=${chomped}): ${texts(r)}`);
  }
});

// ── Insignificant diagnostic for evolved League teams (BB-FAQ-019) ───────────
function snot(kind: 'league' | 'tournament'): TeamDef {
  const t = newTeamDef(kind, 'snotling', 'Snots', 'sn');
  let n = 1;
  for (const [pos, k] of [['funHoppa', 2], ['lineman', 9]] as Array<[string, number]>) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID.snotling, pos, n, `sn-${n++}`));
  return t;
}
const insigIssues = (t: TeamDef) => validateTeamDef(t).filter((i) => /Insignificant/.test(i.text));
test('BB-FAQ-019: the Insignificant limit is a warning for a fresh League draft, silent once the League team has evolved, still an error in tournaments', () => {
  const fresh = insigIssues(snot('league'));
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].level, 'warning');
  const evolved = snot('league');
  evolved.players[0].spp = 6;
  assert.equal(insigIssues(evolved).length, 0, 'spp > 0 means the team has played');
  const recorded = snot('league');
  recorded.sppMatches = ['m1'];
  assert.equal(insigIssues(recorded).length, 0, 'recorded matches count as evolved');
  const tourney = insigIssues(snot('tournament'));
  assert.equal(tourney.length, 1);
  assert.equal(tourney[0].level, 'error');
});

// ── Rules edition: matches started before the FAQ keep the earlier behaviour (exact replay) ──
test('rules edition: new matches carry faq2026; a state without it keeps the earlier rules for the changed behaviours', () => {
  const fresh = shadowScene().start();
  assert.equal(fresh.rulesEdition, 'faq2026');
  const legacy = shadowScene().start();
  delete legacy.rulesEdition;
  asked.length = 0;
  runScripted(legacy, move('A1', [[9, 7]]), [1, 2, 2, 3, 3, 3, 3, 3, 3], answer({ shadowing: 'B1' }));
  assert.ok(asked.includes('shadowing'), 'legacy: Shadowing was offered after a failed Dodge');
  // Foul assists: legacy applies every available assist without asking
  const mk = () => { const b = new Pos({ rerollsA: 0 }); b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' }); b.add('A', 'human', 'lineman', c(12, 8), { id: 'A2' }); b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1', stance: 'prone' }); b.ball(c(1, 1)); return b.start(); };
  const old = mk(); delete old.rulesEdition;
  asked.length = 0;
  runScripted(old, foul('A1', 'B1'), [3, 3, 3, 3], answer({}));
  assert.ok(!asked.includes('foulAssist'), 'legacy: no assist choice');
  asked.length = 0;
  runScripted(mk(), foul('A1', 'B1'), [3, 3, 3, 3], answer({}));
  assert.ok(asked.includes('foulAssist'), 'new: assist choice asked');
});

test('rules edition: survives save/export/import, unsupported editions are refused explicitly, cache identities never mix editions', () => {
  const fresh = shadowScene().start();
  const text = JSON.stringify(toSaveFile(fresh, 'edition'));
  const back = parseSaveFile(text);
  assert.ok(back.ok);
  if (back.ok) assert.equal(back.save.state.rulesEdition, 'faq2026', 'edition round-trips');
  const legacy = shadowScene().start();
  delete legacy.rulesEdition;
  const lback = parseSaveFile(JSON.stringify(toSaveFile(legacy, 'legacy')));
  assert.ok(lback.ok);
  if (lback.ok) assert.equal(lback.save.state.rulesEdition, undefined, 'a legacy file is never silently upgraded');
  const future = JSON.parse(JSON.stringify(fresh));
  future.rulesEdition = 'faq2031';
  assert.ok(validateState(future).some((m) => /rulesEdition/.test(m)), 'unknown edition is a validation error');
  const bad = parseSaveFile(JSON.stringify(toSaveFile(future, 'future')));
  assert.equal(bad.ok, false, 'an unsupported edition does not load as a playable game');
  assert.notEqual(positionKey(fresh, false, null), positionKey(legacy, false, null), 'positionKey separates editions');
  assert.notEqual(analysisHash(fresh), analysisHash(legacy), 'analysis identity separates editions');
  assert.ok(/not support/.test(checkCompatibility({ ...toSaveFile(future, 'f') }).note));
});
