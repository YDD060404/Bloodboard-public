/**
 * V4 build 3: the Lizardmen (printed p.176) and Norse (printed p.178) Team Rosters — the printed
 * profiles, their Leagues and team special rules (pp.152-155), drafting, and their players' skills
 * and Traits in actual play (the roster players themselves, not generic players with the skill added).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import {
  createMatch,
  decide,
  defaultFormation,
  execute,
  kickerCandidates,
  newTeamDef,
  planAction,
  playerFromRoster,
  ROSTER_BY_ID,
  teamSpecialRules,
  validateInput,
  validateState,
  validateTeamDef,
  type ActionInput,
  type ExecutionResult,
  type GameState,
  type PlayerActionInput,
  type TeamDef,
  type TeamId,
} from '../src/engine/index';
import { bindEngine, nextMove, waitingFor, type AIStyle } from '../src/ai/index';
import { c, p, Pos, runScripted, type Chooser } from './helpers';

bindEngine(Engine);

const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const mv = (id: string, path: Array<[number, number]>, extra: Partial<PlayerActionInput> = {}): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'move', path: path.map(([x, y]) => ({ to: c(x, y), kind: 'step' as const })), ...extra });
const blk = (id: string, target: string): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'block', path: [], blockTarget: target });
const skills = (r: string, pos: string) => ROSTER_BY_ID[r].positions.find((x) => x.id === pos)!.skills.map((s) => (s.value ? `${s.id}(${s.value}+)` : s.id)).join(', ');

// ---------------------------------------------------------------------------
// The printed rosters
// ---------------------------------------------------------------------------

test('Lizardmen roster (p.176): profiles, costs, skills, keywords and skill categories as printed', () => {
  const r = ROSTER_BY_ID.lizardmen;
  assert.equal(r.page, 176);
  assert.equal(r.rerollCost, 70000);
  assert.equal(r.apothecary, true);
  assert.deepEqual(r.leagues, ['Lustrian Superleague']);
  assert.deepEqual(r.specialRules, []);
  const row = (id: string) => {
    const x = r.positions.find((q) => q.id === id)!;
    return [x.qty, x.name, x.cost, x.ma, x.st, x.ag, x.pa, x.av, x.keywords.join('/'), x.primary.join(''), x.secondary.join('')];
  };
  assert.deepEqual(row('skink'), ['0-16', 'Skink Lineman', 60000, 8, 2, 3, 4, 8, 'Lineman/Lizardman', 'A', 'GDPS']);
  assert.deepEqual(row('chameleon'), ['0-2', 'Chameleon Skink', 70000, 7, 2, 3, 3, 8, 'Lizardman/Thrower', 'AP', 'GDS']);
  assert.deepEqual(row('saurus'), ['0-6', 'Saurus Blocker', 90000, 6, 4, 5, 6, 10, 'Blocker/Lizardman', 'GS', 'A']);
  assert.deepEqual(row('kroxigor'), ['0-1', 'Kroxigor', 140000, 6, 5, 5, 6, 10, 'Big Guy/Lizardman', 'S', 'AG']);
  assert.equal(skills('lizardmen', 'skink'), 'dodge, stunty');
  assert.equal(skills('lizardmen', 'chameleon'), 'dodge, onTheBall, shadowing, stunty');
  assert.equal(skills('lizardmen', 'saurus'), 'juggernaut, unsteady');
  assert.equal(skills('lizardmen', 'kroxigor'), 'boneHead, loner(4+), mightyBlow, prehensileTail, thickSkull');
});

test('Norse roster (p.178): profiles, costs, skills, keywords and skill categories as printed', () => {
  const r = ROSTER_BY_ID.norse;
  assert.equal(r.page, 178);
  assert.equal(r.rerollCost, 60000);
  assert.equal(r.apothecary, true);
  assert.deepEqual(r.leagues, ['Chaos Clash', 'Old World Classic']);
  const row = (id: string) => {
    const x = r.positions.find((q) => q.id === id)!;
    return [x.qty, x.name, x.cost, x.ma, x.st, x.ag, x.pa, x.av, x.keywords.join('/'), x.primary.join(''), x.secondary.join('')];
  };
  assert.deepEqual(row('raider'), ['0-16', 'Norse Raider', 50000, 6, 3, 3, 4, 8, 'Human/Lineman', 'G', 'APS']);
  assert.deepEqual(row('beerBoar'), ['0-2', 'Beer Boar', 20000, 5, 1, 3, null, 6, 'Animal/Special', '', 'A']);
  assert.deepEqual(row('berserker'), ['0-2', 'Norse Berserker', 90000, 6, 3, 3, 5, 8, 'Blitzer/Human', 'GS', 'AP']);
  assert.deepEqual(row('valkyrie'), ['0-2', 'Valkyrie', 95000, 7, 3, 3, 3, 8, 'Catcher/Human/Thrower', 'AGP', 'S']);
  assert.deepEqual(row('ulfwerener'), ['0-2', 'Ulfwerener', 105000, 6, 4, 4, 6, 9, 'Blocker/Human', 'GS', 'A']);
  assert.deepEqual(row('yhetee'), ['0-1', 'Yhetee', 140000, 5, 5, 4, 6, 9, 'Big Guy/Yhetee', 'S', 'AG']);
  assert.equal(skills('norse', 'raider'), 'block, drunkard, thickSkull, unsteady');
  assert.equal(skills('norse', 'beerBoar'), 'dodge, noBall, pickMeUp, stunty, titchy');
  assert.equal(skills('norse', 'berserker'), 'block, frenzy, jumpUp');
  assert.equal(skills('norse', 'valkyrie'), 'catch, dauntless, pass, stripBall');
  assert.equal(skills('norse', 'ulfwerener'), 'frenzy, unsteady');
  assert.equal(skills('norse', 'yhetee'), 'claws, disturbingPresence, frenzy, loner(4+), unchannelledFury');
  // every skill of both rosters is implemented in the engine
  for (const rid of ['lizardmen', 'norse']) for (const pos of ROSTER_BY_ID[rid].positions) for (const s of pos.skills) assert.equal(Engine.SKILL_BY_ID[s.id]?.support, 'implemented', `${pos.name}: ${s.id}`);
});

// ---------------------------------------------------------------------------
// Drafting, Leagues and team special rules
// ---------------------------------------------------------------------------

function draft(rosterId: string, comp: Array<[string, number]>, rerolls: number, extra: Partial<TeamDef> = {}): TeamDef {
  const t = newTeamDef('tournament', rosterId, `${rosterId} test`, `${rosterId}-t`);
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${rosterId}-${n++}`));
  t.rerolls = rerolls;
  Object.assign(t, extra);
  return t;
}
const errs = (t: TeamDef) => validateTeamDef(t).filter((i) => i.level === 'error').map((i) => i.text);
const LIZ = (): TeamDef => draft('lizardmen', [['skink', 5], ['chameleon', 1], ['saurus', 4], ['kroxigor', 1]], 1, { apothecary: true });
const NORSE = (league = 'Chaos Clash'): TeamDef => draft('norse', [['raider', 6], ['beerBoar', 1], ['berserker', 2], ['valkyrie', 2], ['yhetee', 1]], 2, { apothecary: true, league });

test('drafting: Lizardmen and Norse teams within the template; roster limits apply', () => {
  assert.deepEqual(errs(LIZ()), []);
  assert.equal(Engine.teamCost(LIZ()).total, 990000);
  assert.deepEqual(errs(NORSE()), []);
  assert.equal(Engine.teamCost(NORSE()).total, 1000000);
  assert.ok(errs(draft('lizardmen', [['skink', 4], ['saurus', 7]], 0)).some((e) => /0-6/.test(e)));
  assert.ok(errs(draft('norse', [['raider', 8], ['yhetee', 2], ['beerBoar', 1]], 0)).some((e) => /0-1/.test(e)));
});

test('Leagues (p.152): Norse must choose Chaos Clash or Old World Classic; Chaos Clash gives Favoured of Khorne (p.178)', () => {
  const none = NORSE();
  none.league = undefined;
  assert.ok(errs(none).some((e) => /Choose the team's League: Chaos Clash or Old World Classic/.test(e)));
  assert.ok(errs(NORSE('Lustrian Superleague')).some((e) => /play in Chaos Clash or Old World Classic/.test(e)));
  assert.deepEqual(teamSpecialRules(NORSE('Chaos Clash')), ['Favoured of Khorne']);
  assert.deepEqual(teamSpecialRules(NORSE('Old World Classic')), []);
  assert.deepEqual(teamSpecialRules(LIZ()), [], 'Lizardmen: special rules none');
  assert.equal(Engine.teamLeague(LIZ()), 'Lustrian Superleague', 'a single League needs no choice');
  const r = createMatch('tournament', LIZ(), NORSE(), { rules: 'full' }, 3);
  assert.ok(r.ok, r.errors.join('\n'));
  assert.equal(r.state!.teams.A.league, 'Lustrian Superleague');
  assert.equal(r.state!.teams.B.league, 'Chaos Clash');
  assert.deepEqual(r.state!.teams.B.specialRules, ['Favoured of Khorne']);
});

test('Blood Bowl Sevens: Lizardmen and Norse Sevens teams (the Beer Boar is not a Lineman)', () => {
  const sev = (rid: string, comp: Array<[string, number]>, league?: string) => {
    const t = newTeamDef('tournament', rid, `${rid} 7`, `${rid}-7`, 'sevens');
    let n = 1;
    for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rid], pos, n, `${rid}7-${n++}`));
    if (league) t.league = league;
    Engine.setVeteran(t, t.players.find((q) => q.keywords.includes('Lineman'))!.id);
    t.rerolls = 1;
    return t;
  };
  assert.deepEqual(errs(sev('lizardmen', [['saurus', 2], ['chameleon', 1], ['skink', 4]])), []);
  assert.deepEqual(errs(sev('norse', [['berserker', 1], ['valkyrie', 1], ['ulfwerener', 1], ['raider', 4]], 'Old World Classic')), []);
  assert.ok(errs(sev('norse', [['berserker', 1], ['valkyrie', 1], ['ulfwerener', 1], ['yhetee', 1], ['beerBoar', 1], ['raider', 2]], 'Old World Classic')).some((e) => /5 players without the Lineman keyword/.test(e)));
});

// ---------------------------------------------------------------------------
// Skills in actual play — Lizardmen
// ---------------------------------------------------------------------------

test('Skink Lineman: MA 8; Stunty ignores being Marked when Dodging, Dodge re-rolls a failed Dodge', () => {
  const b = new Pos({ a: 'lizardmen', b: 'norse' });
  b.add('A', 'lizardmen', 'skink', c(10, 7), { id: 'SK' });
  b.add('B', 'norse', 'raider', c(11, 7), { id: 'R1' });
  b.add('B', 'norse', 'raider', c(10, 9), { id: 'R2' });
  b.ball(c(1, 1));
  const s = b.start();
  const plan = planAction(s, mv('SK', [[10, 8]]));
  assert.equal(plan.steps[0].kind, 'dodge');
  assert.equal(plan.steps[0].target, 3);
  assert.equal(plan.steps[0].mods.length, 0, 'no −1 for R2 marking the destination (Stunty)');
  assert.ok(plan.steps[0].rerolls.includes('Dodge'));
  // Dodge 1 → Dodge re-roll 4 → safe.
  const r = runScripted(s, mv('SK', [[10, 8]]), [1, 4], (req) => req.options[0].id);
  assert.equal(r.status, 'completed', texts(r));
  assert.deepEqual(p(r.state, 'SK').pos, c(10, 8));
  assert.equal(p(s, 'SK').ma, 8);
  assert.ok(Engine.reachableSquares(s, 'SK').some((q) => q.c.x === 2 && q.rushes === 0), 'eight squares without a Rush');
});

test('Saurus Blocker: Juggernaut turns Both Down into a Push on a Blitz; Unsteady forbids Secure the Ball', () => {
  const b = new Pos({ a: 'lizardmen', b: 'norse' });
  b.add('A', 'lizardmen', 'saurus', c(9, 7), { id: 'SA' });
  b.add('B', 'norse', 'raider', c(11, 7), { id: 'R1' });
  b.ball(c(3, 3));
  const s = b.start();
  // ST 4 v 3 → 2 dice, attacker chooses: 2, 2 (Both Down, Both Down) → Juggernaut: Push.
  const input: PlayerActionInput = { kind: 'playerAction', playerId: 'SA', action: 'blitz', blitzTarget: 'R1', blockTarget: 'R1', path: [{ to: c(10, 7), kind: 'step' }] };
  const r = runScripted(s, input, [2, 2], (req) => (req.type === 'juggernaut' ? 'push' : req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.equal(r.status, 'completed', texts(r));
  assert.equal(p(r.state, 'SA').stance, 'standing');
  assert.equal(p(r.state, 'R1').stance, 'standing');
  assert.deepEqual(p(r.state, 'R1').pos, c(12, 7));
  const opts = Engine.actionOptions(s, p(s, 'SA'));
  assert.equal(opts.find((o) => o.action === 'secure')?.enabled, false);
});

test('Kroxigor: Bone Head (1 → Distracted, activation over), Prehensile Tail (−1 to Dodge away), Mighty Blow, Loner on a Team Re-roll', () => {
  const b = new Pos({ a: 'lizardmen', b: 'norse', rerollsA: 1 });
  b.add('A', 'lizardmen', 'kroxigor', c(10, 7), { id: 'KX' });
  b.add('B', 'norse', 'raider', c(11, 7), { id: 'R1' });
  b.ball(c(3, 3));
  const s = b.start();
  // Bone Head 1: no Block; Team Re-roll offered with the Loner (4+) check.
  const offered: string[] = [];
  const r = runScripted(s, blk('KX', 'R1'), [1, 3, 1], (req) => {
    if (req.type === 'reroll') offered.push(req.options.map((o) => o.label).join(' | '));
    return req.type === 'reroll' ? 'team' : req.options[0].id;
  });
  assert.match(offered.join(), /Loner 4\+/);
  assert.match(texts(r), /Loner \(4\+\): rolled 3/);
  assert.equal(p(r.state, 'KX').distracted, true);
  assert.equal(p(r.state, 'R1').stance, 'standing');
  // Prehensile Tail on the Norse Raider's Dodge away (in Norse's Turn).
  const sb = structuredClone(s);
  sb.turn.active = 'B';
  const plan = planAction(sb, mv('R1', [[12, 7]]));
  assert.ok(plan.steps[0].mods.some((m) => /Prehensile Tail/.test(m.label)), JSON.stringify(plan.steps[0].mods));
  // Mighty Blow: Bone Head 3 (fine); ST 5 v 3 → 2 dice 6, 6 POW; armour 4+4 = 8 vs AV 8 broken; injury 4+4 = 8 is Stunned
  // for the Raider (Thick Skull) — Mighty Blow +1 makes it 9: Knocked-out.
  const r2 = runScripted(s, blk('KX', 'R1'), [3, 6, 6, 4, 4, 4, 4], (req) => (req.type === 'followUp' ? 'no' : req.type === 'reroll' ? 'none' : req.type === 'mightyBlow' ? 'use' : req.options[0].id));
  assert.match(texts(r2), /Mighty Blow \+1 applied to the Injury Roll/);
  assert.equal(p(r2.state, 'R1').location, 'ko', texts(r2));
});

test('Chameleon Skink: Shadowing follows a player Dodging away; On the Ball is offered at the kick-off', () => {
  const b = new Pos({ a: 'norse', b: 'lizardmen' });
  b.add('A', 'norse', 'raider', c(10, 7), { id: 'R1' });
  b.add('B', 'lizardmen', 'chameleon', c(11, 7), { id: 'CH' });
  b.ball(c(1, 1));
  const s = b.start();
  // R1 Dodges to (9,7): 3 succeeds; Shadowing: MA 7 v 6 → D6 + 7 − 6 ≥ 6: roll 5 → follows into (10,7).
  const r = runScripted(s, mv('R1', [[9, 7]]), [3, 5], (req) => (req.type === 'shadowing' ? 'CH' : req.options[0].id));
  assert.match(texts(r), /Shadowing/);
  assert.deepEqual(p(r.state, 'CH').pos, c(10, 7), texts(r));
  assert.equal(Engine.SKILL_BY_ID.onTheBall.support, 'implemented');
});

// ---------------------------------------------------------------------------
// Skills in actual play — Norse
// ---------------------------------------------------------------------------

test('Norse Raider: Drunkard (−1 to Rush), Block; Unsteady', () => {
  const b = new Pos({ a: 'norse', b: 'lizardmen' });
  b.add('A', 'norse', 'raider', c(5, 7), { id: 'R1' });
  b.add('B', 'lizardmen', 'skink', c(20, 1), { id: 'SK' });
  b.ball(c(1, 1));
  const s = b.start();
  const path: Array<[number, number]> = [[6, 7], [7, 7], [8, 7], [9, 7], [10, 7], [11, 7], [12, 7]];
  const plan = planAction(s, mv('R1', path));
  const rush = plan.steps.find((st) => st.kind === 'rush')!;
  assert.ok(rush.mods.some((m) => /Drunkard/.test(m.label) && m.value === -1), JSON.stringify(rush.mods));
  // A Rush roll of 2 fails for a Drunkard (2 − 1 = 1).
  const r = runScripted(s, mv('R1', path), [2, 2, 2], (req) => req.options[0].id);
  assert.equal(r.status, 'turnover', texts(r));
});

test('Beer Boar: No Ball, Titchy (+1 to Dodge), Pick-me-up stands a Prone team-mate up on 5+ at the end of the opposition Turn', () => {
  const b = new Pos({ a: 'lizardmen', b: 'norse' });
  b.add('A', 'lizardmen', 'skink', c(3, 3), { id: 'SK' });
  b.add('B', 'norse', 'beerBoar', c(20, 7), { id: 'BB' });
  b.add('B', 'norse', 'raider', c(21, 9), { id: 'R1', stance: 'prone' });
  b.ball(c(1, 1));
  const s = b.start();
  const r = runScripted(s, { kind: 'endTurn' }, [5]);
  assert.match(texts(r), /Pick-me-up/);
  assert.equal(p(r.state, 'R1').stance, 'standing');
  const r2 = runScripted(s, { kind: 'endTurn' }, [4]);
  assert.equal(p(r2.state, 'R1').stance, 'prone', '4 is not enough');
  // No Ball: the Boar cannot take a Hand-off or pick the ball up.
  const b2 = new Pos({ a: 'norse', b: 'lizardmen' });
  b2.add('A', 'norse', 'beerBoar', c(10, 7), { id: 'BB' });
  b2.add('A', 'norse', 'raider', c(15, 3), { id: 'R1' });
  b2.add('B', 'lizardmen', 'skink', c(12, 7), { id: 'SK' });
  b2.ball(c(11, 7));
  const s2 = b2.start();
  const pick = runScripted(s2, mv('BB', [[11, 7]]), [6], (req) => req.options[0].id);
  assert.match(texts(pick), /No Ball/);
  assert.equal(pick.status, 'turnover');
  // Titchy: +1 when the Boar Dodges out of the Skink's Tackle Zone (and Stunty ignores Marking).
  const b3 = new Pos({ a: 'norse', b: 'lizardmen' });
  b3.add('A', 'norse', 'beerBoar', c(10, 7), { id: 'BB' });
  b3.add('B', 'lizardmen', 'skink', c(11, 7), { id: 'SK' });
  b3.ball(c(1, 1));
  const plan = planAction(b3.start(), mv('BB', [[9, 7]]));
  assert.ok(plan.steps[0].mods.some((m) => /Titchy/.test(m.label) && m.value === 1), JSON.stringify(plan.steps[0].mods));
});

test('Norse Berserker: Frenzy blocks again after a Push; Jump Up stands up for free', () => {
  const b = new Pos({ a: 'norse', b: 'lizardmen' });
  b.add('A', 'norse', 'berserker', c(10, 7), { id: 'BZ' });
  b.add('B', 'lizardmen', 'skink', c(11, 7), { id: 'SK' });
  b.ball(c(1, 1));
  const s = b.start();
  // ST 3 v 2: two dice, attacker chooses. 3, 3 Push → follow-up forced → second Block 6, 6 POW; armour 5+4 = 9 vs AV 8 → injury 2+2 (Stunty 2-6 Stunned).
  const r = runScripted(s, blk('BZ', 'SK'), [3, 3, 6, 6, 5, 4, 2, 2], (req) => req.options[0].id);
  assert.match(texts(r), /Frenzy/);
  assert.equal(p(r.state, 'SK').stance, 'stunned', texts(r));
  // Jump Up: a Prone Berserker stands without spending 3 MA.
  const s2 = structuredClone(s);
  p(s2, 'BZ').stance = 'prone';
  const plan = planAction(s2, mv('BZ', [[9, 7], [8, 7], [7, 7], [6, 7], [5, 7], [4, 7]]));
  assert.ok(plan.ok, plan.errors.join());
  assert.ok(!plan.steps.some((st) => st.kind === 'rush'), 'all 6 squares without a Rush: standing up was free');
});

test('Valkyrie: Strip Ball knocks the ball loose from a pushed carrier; Pass re-rolls a failed pass; Catch', () => {
  const b = new Pos({ a: 'norse', b: 'lizardmen' });
  b.add('A', 'norse', 'valkyrie', c(10, 7), { id: 'VK' });
  const t = b.add('B', 'lizardmen', 'skink', c(11, 7), { id: 'SK' });
  b.give(t);
  const s = b.start();
  // ST 3 v 2: two dice 3, 4 (Push, Push); Strip Ball → the ball bounces D8 5 → (13,7).
  const r = runScripted(s, blk('VK', 'SK'), [3, 4, 5], (req) => (req.type === 'stripBall' ? 'yes' : req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.deepEqual(r.state.ball, { kind: 'ground', pos: c(13, 7) }, texts(r));
  const b2 = new Pos({ a: 'norse', b: 'lizardmen' });
  const v = b2.add('A', 'norse', 'valkyrie', c(5, 7), { id: 'VK' });
  b2.add('A', 'norse', 'valkyrie', c(9, 7), { id: 'V2' });
  b2.add('B', 'lizardmen', 'skink', c(20, 1), { id: 'SK' });
  b2.give(v);
  const plan = planAction(b2.start(), { kind: 'playerAction', playerId: 'VK', action: 'pass', path: [], passTarget: c(9, 7) });
  assert.ok(plan.steps.find((st) => st.kind === 'pass')?.rerolls.includes('Pass'));
  assert.ok(plan.steps.find((st) => st.kind === 'catch')?.rerolls.includes('Catch'));
});

test('Ulfwerener: Frenzy with ST 4; Yhetee: Unchannelled Fury, Claws break armour on 8+, Disturbing Presence', () => {
  const b = new Pos({ a: 'norse', b: 'lizardmen' });
  b.add('A', 'norse', 'yhetee', c(10, 7), { id: 'YH' });
  b.add('B', 'lizardmen', 'saurus', c(11, 7), { id: 'SA' });
  b.ball(c(1, 1));
  const s = b.start();
  // Unchannelled Fury: D6 + 2 for a Block, 1-3 fails.
  const plan = planAction(s, blk('YH', 'SA'));
  assert.ok(Math.abs((plan.steps[0].pSingle ?? NaN) - 5 / 6) < 1e-12);
  const fail = runScripted(s, blk('YH', 'SA'), [1], (req) => req.options[0].id);
  assert.match(texts(fail), /Unchannelled Fury/);
  assert.equal(p(fail.state, 'SA').stance, 'standing');
  // Fury 6 → ST 5 v 4: two dice 6, 6 POW; armour 4+4 = 8 < AV 10, but Claws: 8+ breaks → injury 2+2 Stunned.
  const hit = runScripted(s, blk('YH', 'SA'), [6, 6, 6, 4, 4, 2, 2], (req) => (req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.equal(p(hit.state, 'SA').stance, 'stunned', texts(hit));
  assert.match(texts(hit), /Claws/);
  // Disturbing Presence: the Lizardmen's pass within 3 squares of the Yhetee is at −1.
  const b3 = new Pos({ a: 'lizardmen', b: 'norse' });
  const ch = b3.add('A', 'lizardmen', 'chameleon', c(10, 7), { id: 'CH' });
  b3.add('A', 'lizardmen', 'skink', c(14, 7), { id: 'SK' });
  b3.add('B', 'norse', 'yhetee', c(10, 10), { id: 'YH' });
  b3.give(ch);
  const pp = planAction(b3.start(), { kind: 'playerAction', playerId: 'CH', action: 'pass', path: [], passTarget: c(14, 7) });
  assert.ok(pp.pass!.mods.some((m) => /Disturbing Presence/.test(m.label)));
  // Ulfwerener: Frenzy, ST 4.
  const b4 = new Pos({ a: 'norse', b: 'lizardmen' });
  b4.add('A', 'norse', 'ulfwerener', c(10, 7), { id: 'UW' });
  b4.add('B', 'lizardmen', 'skink', c(11, 7), { id: 'SK' });
  b4.ball(c(1, 1));
  const r4 = runScripted(b4.start(), blk('UW', 'SK'), [3, 3, 6, 6, 5, 4, 2, 2], (req) => req.options[0].id);
  assert.match(texts(r4), /Frenzy/);
});

// ---------------------------------------------------------------------------
// Whole matches
// ---------------------------------------------------------------------------

test('whole Lizardmen v Norse matches (end-turn only, standard and Sevens) run from pre-game to full time', () => {
  for (const [seed, sevens] of [[1, false], [2, false], [3, true], [4, true]] as Array<[number, boolean]>) {
    const a = sevens ? (() => { const t = newTeamDef('tournament', 'lizardmen', 'Liz 7', 'l7', 'sevens'); let n = 1; for (const [pos, k] of [['saurus', 2], ['chameleon', 1], ['skink', 4]] as Array<[string, number]>) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID.lizardmen, pos, n, `l7-${n++}`)); Engine.setVeteran(t, t.players.find((q) => q.positionId === 'skink')!.id); t.rerolls = 1; return t; })() : LIZ();
    const bb = sevens ? (() => { const t = newTeamDef('tournament', 'norse', 'Norse 7', 'n7', 'sevens'); t.league = 'Old World Classic'; let n = 1; for (const [pos, k] of [['berserker', 1], ['valkyrie', 1], ['ulfwerener', 1], ['raider', 4]] as Array<[string, number]>) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID.norse, pos, n, `n7-${n++}`)); Engine.setVeteran(t, t.players.find((q) => q.positionId === 'raider')!.id); t.rerolls = 1; return t; })() : NORSE();
    const r = createMatch('tournament', a, bb, { rules: 'full' }, seed);
    assert.ok(r.ok, r.errors.join('\n'));
    let s = r.state as GameState;
    let guard = 0;
    while (s.phase !== 'fullTime') {
      assert.ok(guard++ < 400, `stuck in ${s.phase}`);
      const m = s.match!;
      let input: ActionInput;
      if (s.phase === 'pregame') input = { kind: 'pregame' };
      else if (s.phase === 'driveSetup') {
        const t = (m.setupDone[m.kicking as TeamId] ? (m.kicking === 'A' ? 'B' : 'A') : m.kicking) as TeamId;
        input = { kind: 'setupTeam', team: t, positions: defaultFormation(s, t) };
      } else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'solidDefence') input = { kind: 'solidDefence', positions: {} };
      else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'quickSnap') input = { kind: 'quickSnap', moves: {} };
      else if (s.phase === 'kickoff') {
        const k = m.kicking as TeamId;
        input = { kind: 'kickoff', kicker: kickerCandidates(s, k)[0].id, target: sevens ? c(k === 'A' ? 16 : 3, 5) : c(k === 'A' ? 20 : 5, 7) };
      } else if (s.phase === 'play' && m.pendingPhase?.type === 'charge') input = { kind: 'endCharge' };
      else if (s.phase === 'play') input = { kind: 'endTurn' };
      else input = { kind: 'nextDrive' };
      let res = execute(s, input);
      let g2 = 0;
      while (res.status === 'awaitingDecision' && res.decision) {
        assert.ok(g2++ < 60);
        res = decide(res.state, { requestId: res.decision.id, optionId: res.decision.options[0].id });
      }
      assert.notEqual(res.status, 'illegal', `${input.kind}: ${res.error}`);
      s = res.state;
      assert.deepEqual(validateState(s), []);
    }
  }
});

test('the computer coaches Lizardmen v Norse (AI v AI): legal inputs only, and the rosters\' skills come up in play', () => {
  const r = createMatch('tournament', LIZ(), NORSE(), { rules: 'full' }, 21);
  let s = r.state as GameState;
  const styles: Record<TeamId, AIStyle> = { A: 'balanced', B: 'offensive' };
  let guard = 0;
  let actions = 0;
  while (s.phase !== 'fullTime' && s.match!.half === 1) {
    assert.ok(guard++ < 3000, `stuck in ${s.phase}`);
    const who = waitingFor(s);
    let res: ExecutionResult;
    if (!who) res = execute(s, s.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' });
    else {
      const mv2 = nextMove(s, who, styles[who], { maxExplored: 6 });
      if (!mv2) throw new Error(`the AI must act in ${s.phase}`);
      if (mv2.type === 'decision') res = decide(s, { requestId: mv2.requestId, optionId: mv2.optionId });
      else {
        assert.deepEqual(validateInput(s, mv2.input), [], `${mv2.type}: ${mv2.why}`);
        if (mv2.type === 'action') actions++;
        res = execute(s, mv2.input);
      }
    }
    assert.notEqual(res.status, 'illegal', res.error);
    s = res.state;
  }
  assert.ok(actions > 30, `AI actions ${actions}`);
  const log = s.log.flatMap((e) => e.events.map((v) => v.text)).join('\n');
  // Traits that fire on their own in any half of Blood Bowl with these teams.
  const seen = ['Unchannelled Fury', 'Bone Head', 'Dodge'].filter((k) => log.includes(k));
  assert.ok(seen.length >= 2, `skills seen in the log: ${seen.join(', ')}`);
});
