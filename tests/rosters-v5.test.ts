/**
 * V5 step 2: the other 25 Team Rosters of the rulebook (printed pp.160-190), their cross-position
 * limits, "Favoured of (choose …)", and the team special rules they bring: Bribery and Corruption
 * (p.154), Swarming (p.155), Low Cost Linemen (p.155, recorded), Masters of Undeath with two Lineman
 * types (Shambling Undead).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import {
  createMatch,
  decide,
  defaultFormation,
  defaultSwarming,
  execute,
  newTeamDef,
  playerFromRoster,
  ROSTER_BY_ID,
  ROSTERS,
  ScriptedDice,
  SEVENS_DRAFT,
  DRAFT_TEMPLATE,
  teamCost,
  teamSpecialRules,
  validateDriveSetup,
  validateInput,
  validateState,
  validateTeamDef,
  type ActionInput,
  type ExecutionResult,
  type GameState,
  type MatchKind,
  type PlayerActionInput,
  type Roster,
  type TeamDef,
  type TeamId,
} from '../src/engine/index';
import { bindEngine, nextMove, waitingFor } from '../src/ai/index';
import { c, p, Pos, runScripted } from './helpers';

bindEngine(Engine);

const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const errs = (t: TeamDef) => validateTeamDef(t).filter((i) => i.level === 'error').map((i) => i.text);

function team(id: string, rosterId: string, comp: Array<[string, number]>, opts: { kind?: MatchKind; rerolls?: number; favoured?: string; league?: string; sevens?: boolean } = {}): TeamDef {
  const t = newTeamDef(opts.kind ?? 'tournament', rosterId, `${rosterId} ${id}`, id, opts.sevens ? 'sevens' : undefined);
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  t.rerolls = opts.rerolls ?? 2;
  const r = ROSTER_BY_ID[rosterId];
  if (r.leagues.length > 1) t.league = opts.league ?? r.leagues[0];
  if (r.favouredOf) t.favoured = opts.favoured ?? 'Undivided';
  if (opts.sevens) Engine.setVeteran(t, t.players.find((q) => q.keywords.includes('Lineman'))!.id);
  return t;
}

// ---------------------------------------------------------------------------
// The printed rosters
// ---------------------------------------------------------------------------

/** id → printed page, re-roll cost, Apothecary, Leagues, special rules (as printed), number of positions. */
const PRINTED: Record<string, [number, number, boolean, string[], string[], number]> = {
  amazon: [160, 60000, true, ['Lustrian Superleague'], [], 4],
  blackOrc: [161, 60000, true, ['Badlands Brawl'], ["Brawlin' Brutes", 'Bribery and Corruption'], 3],
  chaosChosen: [163, 50000, true, ['Chaos Clash'], [], 5],
  chaosDwarf: [164, 70000, true, ['Badlands Brawl', 'Chaos Clash'], ['Favoured of Hashut'], 6],
  chaosRenegade: [165, 70000, true, ['Chaos Clash'], [], 10],
  darkElf: [166, 50000, true, ['Elven Kingdoms League'], [], 5],
  dwarf: [167, 60000, true, ['Worlds Edge Superleague'], ["Brawlin' Brutes", 'Bribery and Corruption'], 5],
  elvenUnion: [168, 50000, true, ['Elven Kingdoms League'], [], 4],
  gnome: [169, 60000, true, ['Halfling Thimble Cup', 'Woodland League'], [], 5],
  goblin: [170, 60000, true, ['Badlands Brawl', 'Underworld Challenge'], ['Bribery and Corruption'], 8],
  halfling: [171, 60000, true, ['Halfling Thimble Cup', 'Woodland League'], [], 4],
  highElf: [172, 50000, true, ['Elven Kingdoms League'], [], 4],
  imperialNobility: [174, 60000, true, ['Old World Classic'], [], 5],
  khorne: [175, 60000, true, ['Chaos Clash'], ["Brawlin' Brutes", 'Favoured of Khorne'], 4],
  necromantic: [177, 70000, false, ['Sylvanian Spotlight'], ['Masters of Undeath'], 5],
  nurgle: [179, 60000, false, ['Chaos Clash'], ["Brawlin' Brutes", 'Favoured of Nurgle'], 4],
  ogre: [180, 70000, true, ['Badlands Brawl', 'Worlds Edge Superleague'], ["Brawlin' Brutes", 'Low Cost Linemen'], 3],
  oldWorldAlliance: [181, 70000, true, ['Old World Classic'], [], 11],
  shamblingUndead: [183, 70000, false, ['Sylvanian Spotlight'], ['Masters of Undeath'], 5],
  skaven: [184, 50000, true, ['Underworld Challenge'], [], 5],
  slann: [185, 50000, true, ['Lustrian Superleague'], [], 4],
  snotling: [186, 70000, true, ['Underworld Challenge'], ['Bribery and Corruption', 'Low Cost Linemen', 'Swarming'], 6],
  underworld: [188, 70000, true, ['Underworld Challenge'], ['Bribery and Corruption'], 8],
  vampire: [189, 60000, true, ['Sylvanian Spotlight'], ['Masters of Undeath'], 5],
  woodElf: [190, 50000, true, ['Elven Kingdoms League', 'Woodland League'], [], 5],
};

test('31 Team Rosters: the 25 added in V5 with their printed page, re-roll price, Apothecary, Leagues and special rules', () => {
  assert.equal(ROSTERS.length, 31);
  for (const [id, [page, rr, apo, leagues, rules, npos]] of Object.entries(PRINTED)) {
    const r = ROSTER_BY_ID[id];
    assert.ok(r, id);
    assert.deepEqual([r.page, r.rerollCost, r.apothecary, r.leagues, r.specialRules, r.positions.length], [page, rr, apo, leagues, rules, npos], id);
  }
  assert.deepEqual(ROSTER_BY_ID.chaosChosen.favouredOf, ['Hashut', 'Khorne', 'Nurgle', 'Slaanesh', 'Tzeentch', 'Undivided']);
  assert.deepEqual(ROSTER_BY_ID.chaosRenegade.favouredOf, ['Khorne', 'Nurgle', 'Slaanesh', 'Tzeentch', 'Undivided']);
  // Every position: a known skill for every skill id, keywords, 0-N quantity, categories A/D/G/M/P/S.
  for (const r of ROSTERS) {
    const ids = new Set<string>();
    for (const pos of r.positions) {
      assert.ok(!ids.has(pos.id), `${r.id}.${pos.id} duplicated`);
      ids.add(pos.id);
      assert.match(pos.qty, /^0-\d+$/, `${r.id}.${pos.id}`);
      for (const s of pos.skills) assert.ok(Engine.SKILL_BY_ID[s.id], `${r.id}.${pos.id}: unknown skill ${s.id}`);
      for (const k of [...pos.primary, ...pos.secondary]) assert.ok('ADGMPS'.includes(k), `${r.id}.${pos.id} category ${k}`);
      assert.ok(pos.keywords.length >= 2 || pos.keywords.includes('Lineman'), `${r.id}.${pos.id} keywords`);
    }
    assert.ok(r.positions.some((x) => x.keywords.includes('Lineman')), `${r.id} has a Lineman position`);
  }
});

test('Spot checks against the page images (rows where the OCR text disagreed or a rule is unusual)', () => {
  const pos = (r: string, id: string) => ROSTER_BY_ID[r].positions.find((x) => x.id === id)!;
  const prof = (r: string, id: string) => {
    const x = pos(r, id);
    return [x.cost, x.ma, x.st, x.ag, x.pa, x.av];
  };
  assert.deepEqual(prof('dwarf', 'deathroller'), [170000, 5, 7, 5, null, 11], 'Deathroller: PA –, AV 11+ (p.167)');
  assert.deepEqual(prof('woodElf', 'treeman'), [120000, 2, 6, 5, 5, 11]);
  assert.deepEqual(prof('amazon', 'piranhaWarrior'), [90000, 7, 3, 3, 4, 8]);
  assert.deepEqual(prof('gnome', 'woodlandFox'), [50000, 7, 2, 2, null, 6]);
  assert.deepEqual(pos('gnome', 'woodlandFox').primary, [], 'Woodland Fox: no Primary skills');
  assert.deepEqual(pos('vampire', 'blitzer').secondary, [], 'Vampire Blitzer: no Secondary skills');
  assert.ok(!pos('blackOrc', 'trainedTroll').skills.some((s) => s.id === 'loner'), 'Trained Troll: no Loner');
  assert.deepEqual(pos('dwarf', 'trollSlayer').skills.find((s) => s.id === 'hatred'), { id: 'hatred', keyword: 'Troll' });
  assert.deepEqual(pos('underworld', 'clanrat').skills, [{ id: 'animosity', keyword: 'Goblin' }]);
  assert.deepEqual(pos('chaosRenegade', 'human').skills, [{ id: 'animosity', keyword: 'all' }]);
  assert.deepEqual(pos('vampire', 'runner').skills[0], { id: 'bloodlust', value: 2 });
  assert.deepEqual(pos('vampire', 'blitzer').skills[0], { id: 'bloodlust', value: 3 });
  assert.equal(pos('oldWorldAlliance', 'halfling').qty, '0-3', 'FAQ Nov 2025 value printed in the book');
  assert.equal(pos('oldWorldAlliance', 'ogre').skills.find((s) => s.id === 'loner')!.value, 3);
  assert.deepEqual(pos('snotling', 'lineman').skills.map((s) => s.id), ['dodge', 'insignificant', 'rightStuff', 'sidestep', 'stunty', 'titchy']);
  assert.equal(pos('ogre', 'gnoblar').cost, 15000);
  assert.deepEqual(pos('ogre', 'ogreBlocker').keywords, ['Big Guy', 'Blocker', 'Ogre']);
});

// ---------------------------------------------------------------------------
// Drafting every roster
// ---------------------------------------------------------------------------

/** A simple legal draft: non-Linemen in roster order while 11 players and 2 re-rolls still fit, then Linemen. */
function autoDraft(r: Roster, sevens: boolean): TeamDef {
  const t = newTeamDef('tournament', r.id, r.name, `auto-${r.id}`, sevens ? 'sevens' : undefined);
  if (r.leagues.length > 1) t.league = r.leagues[0];
  if (r.favouredOf) t.favoured = r.favouredOf[0];
  const budget = sevens ? SEVENS_DRAFT.budget : DRAFT_TEMPLATE.budget;
  const need = sevens ? 7 : 11;
  const rr = sevens ? SEVENS_DRAFT.rerollCost : r.rerollCost;
  const line = r.positions.find((x) => x.keywords.includes('Lineman') && x.qty.endsWith('16'))!;
  let n = 1;
  const add = (id: string) => t.players.push(playerFromRoster(r, id, n, `auto-${n++}`));
  for (const pos of r.positions.filter((x) => !x.keywords.includes('Lineman'))) {
    const max = Number(pos.qty.split('-')[1]);
    for (let i = 0; i < Math.min(max, 2); i++) {
      if (sevens && t.players.length >= 3) break;
      if (Engine.groupRoom(t, pos.id) <= 0) break;
      const cost = teamCost(t).players + pos.cost + (need - t.players.length - 1) * line.cost + 2 * rr;
      if (cost > budget) break;
      add(pos.id);
    }
  }
  while (t.players.length < need) add(line.id);
  // Insignificant (p.129): never more than the players without it.
  t.rerolls = 0;
  while (t.rerolls < 2 && teamCost({ ...t, rerolls: t.rerolls + 1 }).total <= budget) t.rerolls++;
  if (sevens) Engine.setVeteran(t, t.players.find((q) => q.keywords.includes('Lineman'))!.id);
  return t;
}

test('every roster can draft a legal team: 11 players (standard, 1,000,000 gp) and 7 players (Sevens, 600,000 gp)', () => {
  for (const r of ROSTERS) {
    for (const sevens of [false, true]) {
      const t = autoDraft(r, sevens);
      const e = errs(t).filter((x) => !/Insignificant/.test(x));
      assert.deepEqual(e, [], `${r.id}${sevens ? ' (Sevens)' : ''}: ${e.join(' | ')}`);
    }
  }
});

test('cross-position limits printed on the roster: a single Big Guy (Chaos Chosen, Old World Alliance, Underworld), up to three (Chaos Renegade)', () => {
  const cc = team('cc', 'chaosChosen', [['beastman', 9], ['troll', 1], ['ogre', 1]]);
  assert.ok(errs(cc).some((e) => /2 players from Troll, Ogre, Minotaur: A Chaos Chosen team may have a single Big Guy.* at most 1 \(Chaos Chosen Team Roster, p\.163\)/.test(e)), errs(cc).join(' | '));
  assert.deepEqual(errs(team('cc1', 'chaosChosen', [['beastman', 10], ['minotaur', 1]])), []);
  assert.ok(errs(team('owa', 'oldWorldAlliance', [['humanLineman', 9], ['ogre', 1], ['treeman', 1]])).some((e) => /single Big Guy/.test(e)));
  assert.ok(errs(team('uw', 'underworld', [['goblin', 9], ['troll', 1], ['ratOgre', 1]])).some((e) => /single Big Guy/.test(e)));
  const cr3 = team('cr3', 'chaosRenegade', [['human', 8], ['troll', 1], ['ogre', 1], ['minotaur', 1]]);
  cr3.rerolls = 0;
  assert.deepEqual(errs(cr3).filter((e) => !/costs/.test(e)), []);
  const cr4 = team('cr4', 'chaosRenegade', [['human', 7], ['troll', 1], ['ogre', 1], ['minotaur', 1], ['ratOgre', 1]]);
  assert.ok(errs(cr4).some((e) => /4 players from .*up to three Big Guy players.*at most 3/.test(e)), errs(cr4).join(' | '));
  assert.equal(Engine.groupRoom(cc, 'minotaur'), -1);
  assert.equal(Engine.groupRoom(team('cc2', 'chaosChosen', [['beastman', 11]]), 'troll'), 1);
});

test('Favoured of (choose …) (p.154): Chaos Chosen and Chaos Renegade choose an alignment when drafted; it becomes a team special rule', () => {
  const none = team('f0', 'chaosChosen', [['beastman', 11]]);
  none.favoured = undefined;
  assert.ok(errs(none).some((e) => /Choose the team's alignment — Favoured of Hashut, Khorne, Nurgle, Slaanesh, Tzeentch, Undivided/.test(e)));
  const nurgle = team('f1', 'chaosChosen', [['beastman', 11]], { favoured: 'Nurgle' });
  assert.deepEqual(errs(nurgle), []);
  assert.deepEqual(teamSpecialRules(nurgle), ['Favoured of Nurgle']);
  const bad = team('f2', 'chaosRenegade', [['human', 11]], { favoured: 'Hashut' });
  assert.ok(errs(bad).some((e) => /may be Favoured of Khorne, Nurgle, Slaanesh, Tzeentch, Undivided, not Hashut/.test(e)));
  const r = createMatch('tournament', nurgle, team('f3', 'chaosDwarf', [['hobgoblin', 11]]), { rules: 'full' }, 3);
  assert.ok(r.ok, r.errors.join());
  assert.deepEqual(r.state!.teams.A.specialRules, ['Favoured of Nurgle']);
  assert.deepEqual(r.state!.teams.B.specialRules, ['Favoured of Hashut']);
  assert.equal(r.state!.teams.B.league, 'Badlands Brawl');
});

// ---------------------------------------------------------------------------
// Bribery and Corruption (p.154)
// ---------------------------------------------------------------------------

const foul = (id: string, target: string): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'foul', path: [], foulTarget: target });

test('Bribery and Corruption (p.154): once per game, a 1 rolled to Argue the Call may be re-rolled', () => {
  const mk = (rule: boolean) => {
    const b = new Pos({ a: 'goblin', b: 'human' });
    if (rule) b.s.teams.A.specialRules = ['Bribery and Corruption'];
    b.add('A', 'goblin', 'lineman', c(10, 7), { id: 'G1' });
    b.add('B', 'human', 'lineman', c(11, 7), { id: 'H1', stance: 'prone' });
    b.ball(c(1, 1));
    return b.start();
  };
  const asked: string[] = [];
  const ans = (req: NonNullable<ExecutionResult['decision']>) => (asked.push(req.type), req.type === 'argueTheCall' ? 'yes' : req.type === 'briberyCorruption' ? 'yes' : req.options[0].id);
  // Armour 5+5 (double: Sent-off after the Foul; AV 9 broken), injury 2+3 Stunned; Argue 1 → re-roll 6 → stays.
  const r = runScripted(mk(true), foul('G1', 'H1'), [5, 5, 2, 3, 1, 6], ans);
  assert.ok(asked.includes('briberyCorruption'), asked.join());
  assert.match(texts(r), /Bribery and Corruption: .* re-roll the D6 \(once per game\)/);
  assert.equal(p(r.state, 'G1').location, 'pitch', texts(r));
  assert.notEqual(r.state.teams.A.coachEjected, true);
  assert.equal(r.state.teams.A.briberyUsed, true);
  // Once per game: already used → the 1 stands (coach ejected).
  const used = mk(true);
  used.teams.A.briberyUsed = true;
  asked.length = 0;
  const r2 = runScripted(used, foul('G1', 'H1'), [5, 5, 2, 3, 1], ans);
  assert.ok(!asked.includes('briberyCorruption'));
  assert.equal(p(r2.state, 'G1').location, 'sentOff');
  // Without the rule: not offered.
  asked.length = 0;
  runScripted(mk(false), foul('G1', 'H1'), [5, 5, 2, 3, 1], ans);
  assert.ok(!asked.includes('briberyCorruption'));
  // Only a 1 can be re-rolled (a 3 stands, no question).
  asked.length = 0;
  const r4 = runScripted(mk(true), foul('G1', 'H1'), [5, 5, 2, 3, 3], ans);
  assert.ok(!asked.includes('briberyCorruption'));
  assert.equal(p(r4.state, 'G1').location, 'sentOff');
});

// ---------------------------------------------------------------------------
// Swarming (p.155)
// ---------------------------------------------------------------------------

function run(s: GameState, input: ActionInput, answer: (req: NonNullable<ExecutionResult['decision']>) => string = (q) => q.options[0].id, faces?: number[]): ExecutionResult {
  const dice = faces ? () => new ScriptedDice(faces) : undefined;
  let res = execute(s, input, undefined, dice);
  let g = 0;
  while (res.status === 'awaitingDecision' && res.decision) {
    if (g++ > 80) throw new Error('too many decisions');
    res = decide(res.state, { requestId: res.decision.id, optionId: answer(res.decision) }, dice);
  }
  return res;
}

/** Pre-game and both set-ups (default formations), stopping in the kick-off phase. */
function toKickoff(a: TeamDef, b: TeamDef, seed: number): GameState {
  const r = createMatch('tournament', a, b, { rules: 'full' }, seed);
  assert.ok(r.ok, r.errors.join('\n'));
  let s = r.state as GameState;
  for (let g = 0; s.phase !== 'kickoff'; g++) {
    assert.ok(g < 10);
    const m = s.match!;
    const input: ActionInput = s.phase === 'pregame' ? { kind: 'pregame' } : (() => {
      const t = (m.setupDone[m.kicking as TeamId] ? (m.kicking === 'A' ? 'B' : 'A') : m.kicking) as TeamId;
      return { kind: 'setupTeam', team: t, positions: defaultFormation(s, t) } as ActionInput;
    })();
    const res = run(s, input);
    assert.notEqual(res.status, 'illegal', res.error);
    s = res.state;
  }
  return s;
}

// Insignificant (p.129): no more Snotling Linemen than other players. Linemen numbered last, so the default formation leaves some in the Reserves Box.
const SNOT = () => team('sn', 'snotling', [['funHoppa', 2], ['stiltyRunna', 2], ['pumpWagon', 2], ['fungusFlinga', 2], ['lineman', 7]]);

test('Swarming (p.155): after both set-ups the Snotlings roll a D3 and may set up that many more Linemen from the Reserves Box', () => {
  const s = toKickoff(SNOT(), team('hu', 'human', [['lineman', 11]]), 7);
  const ph = s.match!.pendingPhase;
  assert.equal(ph?.type, 'swarming');
  assert.equal(ph!.team, 'A');
  const max = (ph as { max: number }).max;
  assert.ok(max >= 1 && max <= 3);
  assert.match(s.log.flatMap((e) => e.events.map((v) => v.text)).join('\n'), /Swarming: .* roll a D3: \d — up to \d more Lineman/);
  // The kick waits for Swarming.
  const kicker = s.players.find((q) => q.team === s.match!.kicking && q.location === 'pitch')!;
  assert.match(validateInput(s, { kind: 'kickoff', kicker: kicker.id, target: c(20, 7) }).join(), /Swarming first/);
  const onBefore = s.players.filter((q) => q.team === 'A' && q.location === 'pitch').length;
  assert.equal(onBefore, 11);
  const reserves = s.players.filter((q) => q.team === 'A' && q.location === 'reserves');
  const lines = reserves.filter((q) => q.keywords.includes('Lineman'));
  const nonLine = reserves.find((q) => !q.keywords.includes('Lineman'));
  // Refused: a non-Lineman; more than the D3; a square in the opponent's half; too many in a Wide Zone.
  if (nonLine) assert.match(validateInput(s, { kind: 'swarming', positions: { [nonLine.id]: c(8, 7) } }).join(), /not a Lineman/);
  const four: Record<string, { x: number; y: number }> = {};
  lines.slice(0, max + 1).forEach((q, i) => (four[q.id] = c(8, 5 + i)));
  if (lines.length > max) assert.match(validateInput(s, { kind: 'swarming', positions: four }).join(), /at most \d more Linemen/);
  const kickingIsA = s.match!.kicking === 'A';
  const own = (x: number) => (kickingIsA ? x : x);
  assert.match(validateInput(s, { kind: 'swarming', positions: { [lines[0].id]: c(20, 7) } }).join(), /opponent's half|own half/);
  // Wide Zone: the default formation has none there; three more in the top Wide Zone break the limit of 2.
  if (max >= 3 && lines.length >= 3) {
    const wz: Record<string, { x: number; y: number }> = {};
    lines.slice(0, 3).forEach((q, i) => (wz[q.id] = c(own(5 + i), 1)));
    assert.match(validateInput(s, { kind: 'swarming', positions: wz }).join(), /top Wide Zone/);
  }
  // The default placement is legal; confirming it puts 11 + k on the pitch, then the kick-off follows.
  const pos = defaultSwarming(s, 'A');
  assert.equal(Object.keys(pos).length, Math.min(max, lines.length));
  assert.deepEqual(validateInput(s, { kind: 'swarming', positions: pos }), []);
  const r = run(s, { kind: 'swarming', positions: pos });
  assert.notEqual(r.status, 'illegal', r.error);
  assert.equal(r.state.players.filter((q) => q.team === 'A' && q.location === 'pitch').length, 11 + Object.keys(pos).length);
  assert.equal(r.state.match!.pendingPhase, undefined);
  assert.equal(r.state.match!.swarmed!.A, Object.keys(pos).length);
  assert.deepEqual(validateDriveSetup(r.state, 'A').filter((i) => i.level === 'error'), [], 'later set-up checks (Solid Defence) allow the swarmed players');
  assert.deepEqual(validateState(r.state), []);
  // Confirming none is allowed too.
  assert.deepEqual(validateInput(s, { kind: 'swarming', positions: {} }), []);
});

test('Swarming: both teams swarm in turn (kicking team first); teams without the rule never do; the computer places its Linemen', () => {
  const s = toKickoff(SNOT(), team('sn2', 'snotling', [['stiltyRunna', 2], ['funHoppa', 2], ['pumpWagon', 2], ['trainedTroll', 1], ['lineman', 7]]), 11);
  const first = s.match!.pendingPhase as { type: string; team: TeamId; next?: TeamId };
  assert.equal(first.type, 'swarming');
  assert.equal(first.team, s.match!.kicking);
  assert.equal(first.next, first.team === 'A' ? 'B' : 'A');
  assert.equal(waitingFor(s), first.team);
  const mv = nextMove(s, first.team, 'balanced');
  assert.equal(mv?.type, 'step');
  const r1 = run(s, (mv as { input: ActionInput }).input);
  assert.notEqual(r1.status, 'illegal', r1.error);
  const second = r1.state.match!.pendingPhase as { type: string; team: TeamId };
  assert.equal(second?.type, 'swarming');
  assert.equal(second.team, first.next);
  const mv2 = nextMove(r1.state, second.team, 'balanced');
  const r2 = run(r1.state, (mv2 as { input: ActionInput }).input);
  assert.notEqual(r2.status, 'illegal', r2.error);
  assert.equal(r2.state.match!.pendingPhase, undefined);
  for (const t of ['A', 'B'] as TeamId[]) assert.ok(r2.state.players.filter((q) => q.team === t && q.location === 'pitch').length > 11);
  // Human v Human: no Swarming.
  const h = toKickoff(team('h1', 'human', [['lineman', 12]]), team('h2', 'human', [['lineman', 12]]), 3);
  assert.equal(h.match!.pendingPhase, undefined);
});

// ---------------------------------------------------------------------------
// Masters of Undeath with two Lineman types (Shambling Undead)
// ---------------------------------------------------------------------------

test('Masters of Undeath: Shambling Undead choose a Skeleton or a Zombie Lineman to raise', () => {
  const b = new Pos({ a: 'shamblingUndead', b: 'human' });
  b.s.teams.A.specialRules = ['Masters of Undeath'];
  b.s.teams.A.rosterId = 'shamblingUndead';
  b.add('A', 'shamblingUndead', 'wight', c(6, 3), { id: 'W1' });
  b.add('B', 'human', 'lineman', c(7, 3), { id: 'H1' });
  b.ball(c(20, 12));
  const s = b.start();
  // Minimal match record for the rule's "once per game" (the Pos helper builds practice positions).
  s.match = createMatch('tournament', team('su', 'shamblingUndead', [['skeleton', 11]]), team('hu', 'human', [['lineman', 11]]), { rules: 'full' }, 1).state!.match;
  let offered: string[] = [];
  const r = runScripted(s, { kind: 'playerAction', playerId: 'W1', action: 'block', path: [], blockTarget: 'H1' }, [6, 6, 6, 6, 6, 16], (req) => {
    if (req.type === 'raiseDead') {
      offered = req.options.map((o) => o.label);
      return 'pos:zombie';
    }
    return req.type === 'followUp' ? 'no' : req.type === 'reroll' ? 'none' : req.type === 'apothecary' ? req.options[req.options.length - 1].id : req.options[0].id;
  });
  assert.deepEqual(offered, ['Raise the Dead: add a Skeleton Lineman', 'Raise the Dead: add a Zombie Lineman', 'Not now'], texts(r));
  const raised = r.state.players.find((q) => q.raised);
  assert.equal(raised?.position, 'Zombie Lineman');
  assert.equal(raised?.raised, 'zombie');
});

test('Low Cost Linemen (p.155) is recorded for Ogre and Snotling teams (it only changes the League Current Team Value)', () => {
  assert.ok(ROSTER_BY_ID.ogre.specialRules.includes('Low Cost Linemen'));
  assert.ok(ROSTER_BY_ID.snotling.specialRules.includes('Low Cost Linemen'));
  assert.equal(Engine.specialRulePage('Low Cost Linemen'), 155);
});

// ---------------------------------------------------------------------------
// The new rosters in play (computer v computer)
// ---------------------------------------------------------------------------

test('computer v computer: new rosters play a half with legal inputs only (Snotling v Vampire, Nurgle v Dwarf, Chaos Renegade v Amazon)', () => {
  const pairs: Array<[TeamDef, TeamDef, number]> = [
    [SNOT(), team('va', 'vampire', [['thrall', 6], ['runner', 1], ['thrower', 1], ['blitzer', 2], ['vargheist', 1]]), 5],
    [team('nu', 'nurgle', [['rotter', 6], ['pestigor', 2], ['bloater', 2], ['rotspawn', 1]]), team('dw', 'dwarf', [['lineman', 7], ['runner', 1], ['blitzer', 2], ['trollSlayer', 1]]), 6],
    [team('cr', 'chaosRenegade', [['human', 6], ['goblin', 1], ['darkElf', 1], ['thrower', 1], ['ogre', 1], ['ratOgre', 1]], { rerolls: 1 }), team('am', 'amazon', [['eagleWarrior', 5], ['pythonWarrior', 2], ['piranhaWarrior', 2], ['jaguarWarrior', 2]]), 8],
  ];
  for (const [a, b, seed] of pairs) {
    const cr = createMatch('tournament', a, b, { rules: 'full', computer: { team: 'B', style: 'balanced' } }, seed);
    assert.ok(cr.ok, cr.errors.join('\n'));
    let s = cr.state as GameState;
    let steps = 0;
    const log: string[] = [];
    while (!(s.match!.half === 2 || s.phase === 'fullTime') && steps < 3000) {
      steps++;
      const t = waitingFor(s);
      let res: ExecutionResult;
      if (!t) res = execute(s, s.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' });
      else {
        const mv = nextMove(s, t, 'balanced', { maxExplored: 6 });
        assert.ok(mv, `no move for ${t} in ${s.phase}`);
        if (mv!.type === 'decision') res = decide(s, { requestId: mv!.requestId, optionId: mv!.optionId });
        else {
          assert.deepEqual(validateInput(s, mv!.input), [], `${a.rosterId} v ${b.rosterId}: ${JSON.stringify(mv!.input).slice(0, 200)}`);
          res = execute(s, mv!.input);
        }
      }
      assert.notEqual(res.status, 'illegal', res.error);
      s = res.state;
    }
    for (const e of s.log) for (const v of e.events) log.push(v.text);
    if (a.rosterId === 'snotling') assert.match(log.join('\n'), /Swarming: .* set up \d more Lineman/);
    assert.deepEqual(validateState(s), []);
    assert.ok(s.match!.half === 2 || s.phase === 'fullTime', `${a.rosterId} v ${b.rosterId}: stuck in ${s.phase} after ${steps} steps`);
  }
});
