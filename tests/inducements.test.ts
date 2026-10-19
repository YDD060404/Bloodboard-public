/**
 * V5 step 3: Inducements (pp.141-147) bought on a Tournament / Exhibition Team Draft List, and their
 * effects in a match.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import {
  createMatch,
  decide,
  defaultFormation,
  execute,
  INDUCEMENT_BY_ID,
  newTeamDef,
  playerFromRoster,
  ROSTER_BY_ID,
  ScriptedDice,
  teamCost,
  validateInput,
  validateState,
  validateTeamDef,
  type ActionInput,
  type ExecutionResult,
  type GameState,
  type MatchKind,
  type PlayerActionInput,
  type TeamDef,
  type TeamId,
} from '../src/engine/index';
import { bindEngine, nextMove, waitingFor } from '../src/ai/index';
import { c, p } from './helpers';

bindEngine(Engine);

const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const logText = (s: GameState) => s.log.flatMap((e) => e.events.map((v) => v.text)).join('\n');
const errs = (t: TeamDef) => validateTeamDef(t).filter((i) => i.level === 'error').map((i) => i.text);

function team(id: string, rosterId: string, comp: Array<[string, number]>, opts: { kind?: MatchKind; rerolls?: number; ind?: Record<string, number>; budget?: number; favoured?: string } = {}): TeamDef {
  const t = newTeamDef(opts.kind ?? 'tournament', rosterId, `${rosterId} ${id}`, id);
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  t.rerolls = opts.rerolls ?? 1;
  const r = ROSTER_BY_ID[rosterId];
  if (r.leagues.length > 1) t.league = r.leagues[0];
  if (r.favouredOf) t.favoured = opts.favoured ?? 'Undivided';
  if (opts.ind) t.inducements = opts.ind;
  if (opts.budget) t.budget = opts.budget;
  return t;
}
const HUM = (o: Parameters<typeof team>[3] = {}) => team('hum', 'human', [['lineman', 11]], o);
const ORC = (o: Parameters<typeof team>[3] = {}) => team('orc', 'orc', [['lineman', 11]], o);

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

/** Pre-game, both set-ups (default formations) and a kick-off, to the first Turn. */
function toPlay(a: TeamDef, b: TeamDef, seed: number, answer?: (req: NonNullable<ExecutionResult['decision']>) => string): GameState {
  const r = createMatch('tournament', a, b, { rules: 'full' }, seed);
  assert.ok(r.ok, r.errors.join('\n'));
  let s = r.state as GameState;
  for (let g = 0; !(s.phase === 'play' && !s.match!.pendingPhase); g++) {
    assert.ok(g < 40, `stuck in ${s.phase}`);
    const m = s.match!;
    let input: ActionInput;
    if (s.phase === 'pregame') input = { kind: 'pregame' };
    else if (s.phase === 'driveSetup') {
      const t = (m.setupDone[m.kicking as TeamId] ? (m.kicking === 'A' ? 'B' : 'A') : m.kicking) as TeamId;
      input = { kind: 'setupTeam', team: t, positions: defaultFormation(s, t) };
    } else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'solidDefence') input = { kind: 'solidDefence', positions: {} };
    else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'dwarfenWisdom') input = { kind: 'dwarfenWisdom', positions: {} };
    else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'quickSnap') input = { kind: 'quickSnap', moves: {} };
    else if (s.phase === 'kickoff') {
      const k = m.kicking as TeamId;
      const kicker = s.players.find((q) => q.team === k && q.location === 'pitch' && q.pos && q.pos.x !== (k === 'A' ? 12 : 13))!;
      input = { kind: 'kickoff', kicker: kicker.id, target: c(k === 'A' ? 20 : 5, 7) };
    } else if (s.phase === 'play' && m.pendingPhase?.type === 'charge') input = { kind: 'endCharge' };
    else input = { kind: 'nextDrive' };
    const res = run(s, input, answer);
    assert.notEqual(res.status, 'illegal', `${input.kind}: ${res.error}`);
    s = res.state;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Buying Inducements
// ---------------------------------------------------------------------------

test('the Inducements list (pp.144-147): prices, limits and who may buy them, as printed', () => {
  const none: string[] = [];
  const bcRules = ['Bribery and Corruption'];
  const I = INDUCEMENT_BY_ID;
  assert.deepEqual([I.partTimeCoach.cost(none), I.partTimeCoach.max(none)], [20000, 5]);
  assert.deepEqual([I.tempCheerleader.cost(none), I.tempCheerleader.max(none)], [5000, 5]);
  assert.deepEqual([I.teamMascot.cost(none), I.weatherMage.cost(none), I.blitzersBestKeg.cost(none), I.blitzersBestKeg.max(none)], [25000, 25000, 50000, 2]);
  assert.deepEqual([I.bribe.cost(none), I.bribe.max(none), I.bribe.cost(bcRules), I.bribe.max(bcRules)], [100000, 3, 50000, 6]);
  assert.deepEqual([I.extraTraining.cost(none), I.extraTraining.max(none)], [100000, 8]);
  assert.deepEqual([I.halflingMasterChef.cost(none, ROSTER_BY_ID.human), I.halflingMasterChef.cost(none, ROSTER_BY_ID.halfling)], [300000, 100000]);
  assert.deepEqual([I.biasedReferee.cost(none), I.biasedReferee.cost(bcRules)], [120000, 80000]);
  assert.deepEqual([I.wanderingApothecary.max(none), I.josefBugman.cost(none), I.riotousRookies.cost(none)], [2, 100000, 150000]);
  assert.equal(I.mortuaryAssistant.unavailable(none), 'only for teams with Masters of Undeath');
  assert.equal(I.mortuaryAssistant.unavailable(['Masters of Undeath']), null);
  assert.equal(I.plagueDoctor.unavailable(['Favoured of Nurgle']), null);
  assert.equal(I.riotousRookies.unavailable(['Low Cost Linemen']), null);
  assert.match(I.wanderingApothecary.unavailable(none, ROSTER_BY_ID.nurgle) ?? '', /cannot hire an Apothecary/);
});

test('Inducements are bought from the Team Draft Budget (Exhibition / Matched Play); budgets 1,000,000-1,200,000; League teams buy theirs in the pre-match step (p.94)', () => {
  const t = HUM({ ind: { bribe: 1, extraTraining: 1 } });
  assert.equal(teamCost(t).inducements, 200000);
  assert.equal(teamCost(t).total, 11 * 50000 + 50000 + 200000);
  assert.deepEqual(errs(t), []);
  const over = HUM({ ind: { extraTraining: 4 }, rerolls: 2 });
  assert.ok(errs(over).some((e) => /over the 1,000,000 gp Team Draft Budget/.test(e)), errs(over).join());
  over.budget = 1_200_000;
  assert.deepEqual(errs(over), [], 'a 1,200,000 gp Matched Play budget (p.110)');
  over.budget = 1_050_000;
  assert.ok(errs(over).some((e) => /Team Draft Budget 1,050,000 gp: choose/.test(e)));
  assert.ok(errs(HUM({ ind: { bribe: 4 } })).some((e) => /4 × Bribe: at most 3/.test(e)));
  assert.deepEqual(errs(team('gob', 'goblin', [['lineman', 11]], { ind: { bribe: 6 } })).filter((e) => !/costs/.test(e)), [], 'Bribery and Corruption: 0-6');
  assert.ok(errs(HUM({ ind: { mortuaryAssistant: 1 } })).some((e) => /Mortuary Assistant: only for teams with Masters of Undeath/.test(e)));
  assert.ok(errs(team('nu', 'nurgle', [['rotter', 11]], { ind: { wanderingApothecary: 1 } })).some((e) => /cannot hire an Apothecary/.test(e)));
  assert.deepEqual(errs(team('nu2', 'nurgle', [['rotter', 11]], { ind: { plagueDoctor: 1 } })), []);
  assert.deepEqual(errs(team('cc', 'chaosChosen', [['beastman', 11]], { ind: { plagueDoctor: 1 }, favoured: 'Nurgle' })), [], 'Chaos Chosen Favoured of Nurgle');
  assert.ok(errs(HUM({ kind: 'league', ind: { bribe: 1 } })).some((e) => /League teams buy Inducements and Star Players for one match in the pre-match step \(Petty Cash and Treasury, p\.94\)/.test(e)));
});

test('Mercenary Players (p.147): +30,000 gp, Loner (4+) in the match, one Primary skill for +50,000 gp, at most three, within the position limits', () => {
  const t = HUM();
  t.players[0].mercenary = true;
  assert.equal(teamCost(t).inducements, 30000);
  t.players[0].mercSkill = 'block';
  assert.equal(teamCost(t).inducements, 80000);
  assert.deepEqual(errs(t), []);
  t.players[1].mercenary = true;
  t.players[1].mercSkill = 'dodge';
  assert.ok(errs(t).some((e) => /Primary skills/.test(e)), 'Dodge is Agility: not a Human Lineman Primary (G)');
  t.players[1].mercSkill = undefined;
  t.players[2].mercenary = true;
  t.players[3].mercenary = true;
  assert.ok(errs(t).some((e) => /4 Mercenary Players: at most 3/.test(e)));
  t.players[3].mercenary = false;
  const r = createMatch('tournament', t, ORC(), { rules: 'full' }, 3);
  assert.ok(r.ok, r.errors.join());
  const m1 = r.state!.players.find((q) => q.defId === t.players[0].id)!;
  assert.equal(m1.mercenary, true);
  assert.deepEqual(m1.skills.map((k) => (k.value ? `${k.id}(${k.value}+)` : k.id)).sort(), ['block', 'loner(4+)']);
});

// ---------------------------------------------------------------------------
// In the match
// ---------------------------------------------------------------------------

test('Extra Team Training, Part-time Assistant Coaches, Temp Agency Cheerleaders and Bribes change the match from the start', () => {
  const a = HUM({ ind: { extraTraining: 2, partTimeCoach: 2, tempCheerleader: 3, bribe: 1 } });
  const r = createMatch('tournament', a, ORC(), { rules: 'full' }, 5);
  assert.ok(r.ok, r.errors.join());
  const s = r.state!;
  assert.equal(s.teams.A.rerolls, 3);
  assert.equal(s.match!.rosterRerolls.A, 3, 'replenished at half-time with the Extra Team Training');
  assert.equal(s.match!.assistantCoaches.A, 2);
  assert.equal(s.match!.cheerleaders.A, 3);
  assert.equal(s.match!.bribes.A, 1);
  assert.deepEqual(s.match!.inducements!.A, { extraTraining: 2, partTimeCoach: 2, tempCheerleader: 3, bribe: 1 });
  assert.deepEqual(validateState(s), []);
});

test("Blitzer's Best Kegs and Josef Bugman: +1 each to recover a Knocked-out player at the end of the Drive", () => {
  const s0 = toPlay(HUM({ ind: { blitzersBestKeg: 1, josefBugman: 1 } }), ORC(), 7);
  const s = structuredClone(s0);
  const ko = s.players.find((q) => q.team === 'A' && q.location === 'pitch')!;
  ko.location = 'ko';
  ko.pos = null;
  s.phase = 'halfOver';
  // End of the Drive: the KO roll is 2 (+1 Keg +1 Bugman = 4): recovers.
  const r = run(s, { kind: 'nextDrive' }, undefined, [2, 2, 2, 2, 2, 2]);
  assert.notEqual(r.status, 'illegal', r.error);
  assert.match(texts(r), /Recover .*: 2 \+1 Blitzer's Best Keg \+1 Bugman's XXXXXX = 4 — recovers/);
  assert.equal(p(r.state, ko.id).location, 'reserves');
});

test('Team Mascot (p.144): an extra Team Re-roll each half — 4+ to use it, 1-3 lost for the half and another Team Re-roll may be used', () => {
  const s0 = toPlay(HUM({ ind: { teamMascot: 1 }, rerolls: 1 }), ORC(), 9);
  assert.equal(s0.teams.A.mascotReroll, true);
  assert.match(logText(s0), /Team Mascot's Team Re-roll is available this half/);
  const s = structuredClone(s0);
  s.turn.active = 'A';
  const mover = s.players.find((q) => q.team === 'A' && q.location === 'pitch' && q.pos!.x < 11)!;
  // Put an Orc next to him so he must Dodge away.
  const orc = s.players.find((q) => q.team === 'B' && q.location === 'pitch')!;
  for (const q of s.players) if (q.pos && q.id !== mover.id && Math.abs(q.pos.x - mover.pos!.x) <= 2 && Math.abs(q.pos.y - mover.pos!.y) <= 2) (q.location = 'reserves'), (q.pos = null);
  orc.location = 'pitch';
  orc.pos = { x: mover.pos!.x + 1, y: mover.pos!.y };
  orc.stance = 'standing';
  if (s.ball.kind === 'held' && (s.ball.playerId === mover.id || s.ball.playerId === orc.id)) s.ball = { kind: 'ground', pos: c(20, 1) };
  const dodge: PlayerActionInput = { kind: 'playerAction', playerId: mover.id, action: 'move', path: [{ to: { x: mover.pos!.x - 1, y: mover.pos!.y }, kind: 'step' }] };
  const offered: string[][] = [];
  const pick = (want: string[]) => (req: NonNullable<ExecutionResult['decision']>) => {
    if (req.type === 'reroll') {
      offered.push(req.options.map((o) => o.id));
      return want.shift() ?? 'none';
    }
    return req.options[0].id;
  };
  // Dodge 1 → Mascot → D6 5 (used) → Dodge 4 (success).
  const r1 = run(s, dodge, pick(['mascot']), [1, 5, 4]);
  assert.ok(offered[0].includes('mascot') && offered[0].includes('team'), JSON.stringify(offered));
  assert.match(texts(r1), /Team Mascot: 5 — the Team Re-roll can be used/);
  assert.equal(r1.state.teams.A.mascotReroll, false);
  assert.equal(r1.state.teams.A.rerolls, 1, 'the Team Re-roll is kept');
  // Dodge 1 → Mascot → D6 2 (lost for the half) → re-offered without the Mascot → Team Re-roll → Dodge 4.
  offered.length = 0;
  const r2 = run(s, dodge, pick(['mascot', 'team']), [1, 2, 4]);
  assert.match(texts(r2), /Team Mascot: 2 — the Mascot is ineffective/);
  assert.ok(offered.length >= 2 && !offered[1].includes('mascot'), JSON.stringify(offered));
  assert.equal(r2.state.teams.A.rerolls, 0);
  assert.equal(p(r2.state, mover.id).pos!.x, mover.pos!.x - 1);
});

test('Weather Mage (p.144): once per game at the start of your Turn, 2D6 ± up to 2 on the Weather Table', () => {
  const s0 = toPlay(HUM({ ind: { weatherMage: 1 } }), ORC(), 11);
  const s = structuredClone(s0);
  s.turn.active = 'A';
  for (const q of s.players) q.activated = false;
  s.turn.activation = null;
  assert.deepEqual(validateInput(s, { kind: 'weatherMage', team: 'B', modifier: 0 }).length, 1, 'Orc have none / not their Turn');
  assert.match(validateInput(s, { kind: 'weatherMage', team: 'A', modifier: 3 }).join(), /−2 to \+2/);
  const r = run(s, { kind: 'weatherMage', team: 'A', modifier: -2 }, undefined, [6, 6]);
  assert.notEqual(r.status, 'illegal', r.error);
  assert.match(texts(r), /Weather Mage \(.*\): 2D6 6\+6 −2 = 10 — Perfect Conditions/);
  assert.equal(r.state.weather, 'perfect');
  assert.match(validateInput(r.state, { kind: 'weatherMage', team: 'A', modifier: 0 }).join(), /no Weather Mage to use/);
  // Not after a player has been activated.
  const s2 = structuredClone(s);
  s2.players.find((q) => q.team === 'A' && q.location === 'pitch')!.activated = true;
  assert.match(validateInput(s2, { kind: 'weatherMage', team: 'A', modifier: 0 }).join(), /before any player is activated/);
});

test('Wandering Apothecaries and the Plague Doctor are used like an Apothecary; the Mortuary Assistant re-rolls a failed Regeneration', () => {
  // Nurgle (no Apothecary) with a Plague Doctor: a Knocked-out Rotter can be patched up.
  const nu = team('nu', 'nurgle', [['rotter', 11]], { ind: { plagueDoctor: 1 } });
  const s0 = toPlay(nu, HUM(), 13);
  const s = structuredClone(s0);
  s.turn.active = 'B';
  const rot = s.players.find((q) => q.team === 'A' && q.location === 'pitch')!;
  const hum = s.players.find((q) => q.team === 'B' && q.location === 'pitch')!;
  for (const q of s.players) if (q.pos && q.id !== rot.id && q.id !== hum.id && Math.abs(q.pos.x - 7) <= 3 && Math.abs(q.pos.y - 3) <= 3) (q.location = 'reserves'), (q.pos = null);
  hum.pos = c(6, 3);
  rot.pos = c(7, 3);
  hum.stance = rot.stance = 'standing';
  rot.skills = rot.skills.filter((k) => k.id !== 'decay' && k.id !== 'plagueRidden');
  if (s.ball.kind === 'held') s.ball = { kind: 'ground', pos: c(20, 12) };
  s.match!.cheering = undefined;
  const asked: string[] = [];
  // POW (6); armour 6+6 vs AV 9; injury 4+5 = 9 KO → Plague Doctor offered → Stunned instead.
  let r: ExecutionResult;
  try {
    r = run(s, { kind: 'playerAction', playerId: hum.id, action: 'block', path: [], blockTarget: rot.id }, (q) => (asked.push(q.type), q.type === 'followUp' ? 'no' : q.type === 'reroll' ? 'none' : q.type === 'apothecary' ? 'use' : q.options[0].id), [6, 6, 6, 4, 5]);
  } catch (e) {
    const probe = run(s, { kind: 'playerAction', playerId: hum.id, action: 'block', path: [], blockTarget: rot.id }, (q) => (q.type === 'followUp' ? 'no' : q.type === 'reroll' ? 'none' : q.type === 'apothecary' ? 'use' : q.options[0].id), [6, 6, 6, 4, 5, 1, 1, 1, 1, 1, 1]);
    throw new Error(`${(e as Error).message}\n${texts(probe)}`);
  }
  assert.notEqual(r.status, 'illegal', r.error);
  assert.ok(asked.includes('apothecary'), asked.join());
  assert.match(texts(r), /use the Plague Doctor on/);
  assert.equal(p(r.state, rot.id).stance, 'stunned');
  assert.equal(Engine.induceLeft(r.state, 'A', 'plagueDoctor'), 0);
  // Tomb Kings with a Mortuary Assistant: a failed Regeneration (2) is re-rolled (5).
  const tk = team('tk', 'tombKings', [['skeleton', 11]], { ind: { mortuaryAssistant: 1 } });
  const t0 = toPlay(tk, HUM(), 17);
  const t = structuredClone(t0);
  t.turn.active = 'B';
  const sk = t.players.find((q) => q.team === 'A' && q.location === 'pitch')!;
  const h2 = t.players.find((q) => q.team === 'B' && q.location === 'pitch')!;
  for (const q of t.players) if (q.pos && q.id !== sk.id && q.id !== h2.id && Math.abs(q.pos.x - 7) <= 3 && Math.abs(q.pos.y - 3) <= 3) (q.location = 'reserves'), (q.pos = null);
  h2.pos = c(6, 3);
  sk.pos = c(7, 3);
  h2.stance = sk.stance = 'standing';
  sk.skills = [{ id: 'regeneration' }];
  if (t.ball.kind === 'held') t.ball = { kind: 'ground', pos: c(20, 12) };
  t.match!.cheering = undefined;
  // POW; armour 6+6; injury 6+6 Casualty; Regeneration 2 → Mortuary Assistant → 5: regenerates.
  const r2 = run(t, { kind: 'playerAction', playerId: h2.id, action: 'block', path: [], blockTarget: sk.id }, (q) => (q.type === 'followUp' ? 'no' : q.type === 'reroll' ? 'none' : q.options[0].id), [6, 6, 6, 6, 6, 2, 5]);
  assert.notEqual(r2.status, 'illegal', r2.error);
  assert.match(texts(r2), /Mortuary Assistant: Regeneration re-rolled — 5; regenerates/);
  assert.equal(p(r2.state, sk.id).location, 'reserves');
});

test('Halfling Master Chef (p.146): at the start of each half, each 4+ on 3D6 moves a Team Re-roll from the opponent', () => {
  const hal = team('hal', 'halfling', [['hopeful', 11]], { ind: { halflingMasterChef: 1 }, rerolls: 1 });
  assert.equal(teamCost(hal).inducements, 100000);
  const s = toPlay(hal, ORC({ rerolls: 3 }), 19);
  const line = logText(s).split('\n').find((x) => /Halfling Master Chef/.test(x))!;
  assert.ok(line, logText(s).slice(0, 400));
  const k = Number(/— (\d) × 4\+/.exec(line)![1]);
  assert.equal(s.teams.A.rerolls, 1 + k);
  assert.equal(s.teams.B.rerolls, 3 - Math.min(3, k));
});

test('Biased Referee — Dodgy League Rep (p.146): Close Scrutiny sends an opposition fouler off on 5+; "I didn\'t see a thing": +1 to Argue the Call', () => {
  const s0 = toPlay(HUM({ ind: { biasedReferee: 1 } }), ORC(), 23);
  const s = structuredClone(s0);
  s.turn.active = 'B';
  const f = s.players.find((q) => q.team === 'B' && q.location === 'pitch')!;
  const v = s.players.find((q) => q.team === 'A' && q.location === 'pitch')!;
  for (const q of s.players) if (q.pos && q.id !== f.id && q.id !== v.id && Math.abs(q.pos.x - 7) <= 3 && Math.abs(q.pos.y - 3) <= 3) (q.location = 'reserves'), (q.pos = null);
  f.pos = c(6, 3);
  v.pos = c(7, 3);
  f.stance = 'standing';
  v.stance = 'prone';
  if (s.ball.kind === 'held') s.ball = { kind: 'ground', pos: c(20, 12) };
  const foul: PlayerActionInput = { kind: 'playerAction', playerId: f.id, action: 'foul', path: [], foulTarget: v.id };
  // Armour 2+3 (no double, holds), Close Scrutiny 5 → Sent-off (no Argue), Turnover.
  const r = run(s, foul, (q) => (q.type === 'argueTheCall' ? 'no' : q.options[0].id), [2, 3, 5]);
  assert.match(texts(r), /Close Scrutiny \(.*Dodgy League Rep\): 5 — .* is Sent-off/);
  assert.equal(p(r.state, f.id).location, 'sentOff');
  assert.equal(r.status, 'turnover');
  const r2 = run(s, foul, (q) => q.options[0].id, [2, 3, 4]);
  assert.match(texts(r2), /Close Scrutiny .*: 4 — nothing happens/);
  assert.equal(p(r2.state, f.id).location, 'pitch');
  // The Rep's own team argues with +1: a 5 counts as 6.
  const s3 = structuredClone(s0);
  s3.turn.active = 'A';
  const f3 = s3.players.find((q) => q.team === 'A' && q.location === 'pitch')!;
  const v3 = s3.players.find((q) => q.team === 'B' && q.location === 'pitch')!;
  for (const q of s3.players) if (q.pos && q.id !== f3.id && q.id !== v3.id && Math.abs(q.pos.x - 7) <= 3 && Math.abs(q.pos.y - 3) <= 3) (q.location = 'reserves'), (q.pos = null);
  f3.pos = c(6, 3);
  v3.pos = c(7, 3);
  f3.stance = 'standing';
  v3.stance = 'prone';
  if (s3.ball.kind === 'held') s3.ball = { kind: 'ground', pos: c(20, 12) };
  // Armour 4+4 (double: Sent-off after the Foul; 8 vs AV 10 holds), Argue 5 (+1 = 6): stays.
  const r3 = run(s3, { kind: 'playerAction', playerId: f3.id, action: 'foul', path: [], foulTarget: v3.id }, (q) => (q.type === 'argueTheCall' ? 'yes' : q.options[0].id), [4, 4, 5]);
  assert.match(texts(r3), /Dodgy League Rep: \+1 to Argue the Call/);
  assert.equal(p(r3.state, f3.id).location, 'pitch', texts(r3));
});

test('Riotous Rookies (p.145): 2D3+1 Journeymen (roster Linemen with Loner (4+)) join a Low Cost Linemen team for the game', () => {
  const og = team('og', 'ogre', [['gnoblar', 9], ['ogreBlocker', 2]], { ind: { riotousRookies: 1 } });
  assert.deepEqual(errs(og), []);
  const r = createMatch('tournament', og, HUM(), { rules: 'full' }, 29);
  const res = run(r.state!, { kind: 'pregame' }, (q) => q.options[0].id, [2, 3, 1, 1, 3, 3, 6, 1]);
  const j = res.state.players.filter((q) => q.journeyman);
  assert.match(texts(res), /Riotous Rookies .*: 2D3\+1 = 2\+3\+1 = 6 Journeymen Gnoblar Linemans \(Loner \(4\+\)\)/);
  assert.equal(j.length, 6);
  assert.ok(j.every((q) => q.team === 'A' && q.location === 'reserves' && q.skills.some((k) => k.id === 'loner' && k.value === 4) && q.position === 'Gnoblar Lineman'));
  assert.deepEqual(validateState(res.state), []);
});

test("Josef Bugman's Dwarfen Wisdom (p.147): offered once per game after the set-ups; D3 players set up again before the kick", () => {
  let asked = 0;
  const answer = (q: NonNullable<ExecutionResult['decision']>) => (q.type === 'dwarfenWisdom' ? (asked++, 'use') : q.options[0].id);
  const r = createMatch('tournament', HUM({ ind: { josefBugman: 1 } }), ORC(), { rules: 'full' }, 31);
  let s = r.state!;
  for (let g = 0; s.phase !== 'kickoff' || s.match!.pendingPhase?.type !== 'dwarfenWisdom'; g++) {
    assert.ok(g < 10, s.phase);
    const m = s.match!;
    const input: ActionInput = s.phase === 'pregame' ? { kind: 'pregame' } : (() => {
      const t = (m.setupDone[m.kicking as TeamId] ? (m.kicking === 'A' ? 'B' : 'A') : m.kicking) as TeamId;
      return { kind: 'setupTeam', team: t, positions: defaultFormation(s, t) } as ActionInput;
    })();
    const res = run(s, input, answer);
    assert.notEqual(res.status, 'illegal', res.error);
    s = res.state;
  }
  assert.equal(asked, 1);
  const ph = s.match!.pendingPhase as { team: TeamId; max: number };
  assert.equal(ph.team, 'A');
  const kicker = s.players.find((q) => q.team === s.match!.kicking && q.location === 'pitch')!;
  assert.match(validateInput(s, { kind: 'kickoff', kicker: kicker.id, target: c(20, 7) }).join(), /Dwarfen Wisdom first/);
  const back = s.players.find((q) => q.team === 'A' && q.location === 'pitch' && q.pos!.x < 11)!;
  const to = { x: back.pos!.x - 1, y: back.pos!.y };
  const res = run(s, { kind: 'dwarfenWisdom', positions: { [back.id]: to } });
  assert.notEqual(res.status, 'illegal', res.error);
  assert.deepEqual(p(res.state, back.id).pos, to);
  assert.equal(res.state.match!.pendingPhase, undefined);
  assert.equal(Engine.induceLeft(res.state, 'A', 'josefBugman'), 0, 'used');
  assert.match(texts(res), /Dwarfen Wisdom: .* set up 1 player again/);
});

test('whole matches with Inducements, the computer coaching both teams: legal inputs only', () => {
  const a = HUM({ ind: { teamMascot: 1, bribe: 1, blitzersBestKeg: 1, biasedReferee: 1, weatherMage: 1 }, budget: 1_200_000 });
  a.players[10].mercenary = true;
  const b = team('nu', 'nurgle', [['rotter', 7], ['pestigor', 2], ['bloater', 2]], { ind: { plagueDoctor: 1, halflingMasterChef: 1, josefBugman: 1 }, budget: 1_200_000 });
  assert.deepEqual(errs(a), []);
  assert.deepEqual(errs(b), []);
  const cr = createMatch('tournament', a, b, { rules: 'full' }, 37);
  let s = cr.state as GameState;
  let steps = 0;
  while (s.match!.half === 1 && s.phase !== 'fullTime' && steps < 3000) {
    steps++;
    const who = waitingFor(s);
    let res: ExecutionResult;
    if (!who) res = execute(s, s.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' });
    else {
      const mv = nextMove(s, who, 'balanced', { maxExplored: 6 });
      assert.ok(mv, `no move in ${s.phase}`);
      if (mv!.type === 'decision') res = decide(s, { requestId: mv!.requestId, optionId: mv!.optionId });
      else {
        assert.deepEqual(validateInput(s, mv!.input), [], JSON.stringify(mv!.input).slice(0, 200));
        res = execute(s, mv!.input);
      }
    }
    assert.notEqual(res.status, 'illegal', res.error);
    s = res.state;
  }
  assert.deepEqual(validateState(s), []);
  assert.equal(s.match!.half, 2);
  assert.match(logText(s), /Halfling Master Chef/);
});
