/**
 * V5 increment 1: team special rules (pp.154-155) — Team Captain (Human, Orc),
 * Brawlin' Brutes (Orc, League SPP) and Masters of Undeath (Tomb Kings) — in
 * team building, match creation, set-up and actual play.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyMatchSpp,
  captainOnPitch,
  createMatch,
  decide,
  defaultFormation,
  execute,
  hasTeamCaptainRule,
  newTeamDef,
  playerFromRoster,
  postGameSpp,
  ROSTER_BY_ID,
  ScriptedDice,
  setCaptain,
  sppAward,
  sppTotal,
  teamCost,
  validateDriveSetup,
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
import { solveBallChain } from '../src/engine/ball';
import { c, p, Pos, runScripted } from './helpers';

const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');
const errs = (t: TeamDef) => validateTeamDef(t).filter((i) => i.level === 'error').map((i) => i.text);

function team(id: string, kind: MatchKind, rosterId: string, comp: Array<[string, number]>, rerolls = 2): TeamDef {
  const t = newTeamDef(kind, rosterId, `${rosterId} ${id}`, id);
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  t.rerolls = rerolls;
  return t;
}
const HUM = (kind: MatchKind = 'tournament') => team('hum', kind, 'human', [['lineman', 7], ['blitzer', 2], ['catcher', 2], ['thrower', 1]]);
const ORC = (kind: MatchKind = 'tournament') => team('orc', kind, 'orc', [['lineman', 7], ['blitzer', 2], ['bigUn', 2]]);
const TK = (kind: MatchKind = 'tournament') => team('tk', kind, 'tombKings', [['skeleton', 7], ['tkBlitzer', 2], ['tombGuardian', 2]]);
const LIZ = () => team('liz', 'tournament', 'lizardmen', [['skink', 6], ['saurus', 4], ['kroxigor', 1]]);

function run(s: GameState, input: ActionInput, answer: (req: NonNullable<ExecutionResult['decision']>) => string = (r) => r.options[0].id, faces?: number[]): ExecutionResult {
  const dice = faces ? () => new ScriptedDice(faces) : undefined;
  let res = execute(s, input, undefined, dice);
  let g = 0;
  while (res.status === 'awaitingDecision' && res.decision) {
    if (g++ > 80) throw new Error('too many decisions');
    res = decide(res.state, { requestId: res.decision.id, optionId: answer(res.decision) }, dice);
  }
  return res;
}

/** Play from the pre-game to the first Turn of the match (random dice, default inputs). */
function toPlay(kind: MatchKind, a: TeamDef, b: TeamDef, seed: number): GameState {
  const r = createMatch(kind, a, b, { rules: 'full' }, seed);
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
    else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'quickSnap') input = { kind: 'quickSnap', moves: {} };
    else if (s.phase === 'kickoff') {
      const k = m.kicking as TeamId;
      const kicker = s.players.find((q) => q.team === k && q.location === 'pitch' && q.pos && q.pos.x !== (k === 'A' ? 12 : 13))!;
      input = { kind: 'kickoff', kicker: kicker.id, target: c(k === 'A' ? 20 : 5, 7) };
    } else if (s.phase === 'play' && m.pendingPhase?.type === 'charge') input = { kind: 'endCharge' };
    else input = { kind: 'nextDrive' };
    const res = run(s, input);
    assert.notEqual(res.status, 'illegal', `${input.kind}: ${res.error}`);
    s = res.state;
  }
  return s;
}

/** Clear a 7 × 7 area around (6..8, 3) and put `att` (active team) next to `def` for a Block. */
function faceOff(s: GameState, attId: string, defId: string): void {
  for (const q of s.players) if (q.pos && q.id !== attId && q.id !== defId && Math.abs(q.pos.x - 7) <= 3 && Math.abs(q.pos.y - 3) <= 3) (q.location = 'reserves'), (q.pos = null);
  const att = p(s, attId);
  const def = p(s, defId);
  att.pos = c(6, 3);
  att.location = 'pitch';
  att.stance = 'standing';
  def.pos = c(7, 3);
  def.location = 'pitch';
  def.stance = 'standing';
  if (s.ball.kind === 'held' && (s.ball.playerId === attId || s.ball.playerId === defId)) s.ball = { kind: 'ground', pos: c(13, 13) };
}
const blk = (id: string, target: string): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'block', path: [], blockTarget: target });

// ---------------------------------------------------------------------------
// Team Captain (p.155)
// ---------------------------------------------------------------------------

test('Team Captain (p.155): Human and Orc teams may nominate one Captain — never a Big Guy; no extra cost', () => {
  const h = HUM();
  assert.equal(hasTeamCaptainRule(h), true);
  assert.equal(hasTeamCaptainRule(ORC()), true);
  assert.equal(hasTeamCaptainRule(TK()), false);
  const cost = teamCost(h).total;
  setCaptain(h, h.players.find((x) => x.positionId === 'blitzer')!.id);
  assert.deepEqual(errs(h), []);
  assert.equal(teamCost(h).total, cost, 'the Captain gains Pro without increasing its cost');
  assert.equal(h.players.filter((x) => x.captain).length, 1);
  // Moving the nomination keeps one Captain.
  setCaptain(h, h.players[0].id);
  assert.deepEqual(h.players.filter((x) => x.captain).map((x) => x.id), [h.players[0].id]);
  // Two Captains, a Big Guy Captain, and a Captain on a team without the rule are refused.
  const two = HUM();
  two.players[0].captain = true;
  two.players[1].captain = true;
  assert.ok(errs(two).some((e) => /2 Team Captains/.test(e)));
  const og = team('og', 'tournament', 'human', [['lineman', 10], ['ogre', 1]]);
  setCaptain(og, og.players.find((x) => x.positionId === 'ogre')!.id);
  assert.ok(errs(og).some((e) => /a Big Guy can never be nominated \(p\.155\)/.test(e)));
  const tk = TK();
  tk.players[0].captain = true;
  assert.ok(errs(tk).some((e) => /Only teams with the Team Captain special rule/.test(e)));
});

test('Team Captain: the Captain gains Pro in the match and must be set up (the default formation fields it)', () => {
  const h = HUM();
  // The Captain has the highest number, so the first 11 by number would leave it out.
  h.players.push(playerFromRoster(ROSTER_BY_ID.human, 'lineman', 13, 'hum-13'));
  setCaptain(h, 'hum-13');
  const r = createMatch('tournament', h, ORC(), { rules: 'full' }, 5);
  assert.ok(r.ok, r.errors.join('\n'));
  const s = r.state as GameState;
  const cap = s.players.find((x) => x.defId === 'hum-13')!;
  assert.equal(cap.captain, true);
  assert.ok(cap.skills.some((k) => k.id === 'pro'), 'Pro added');
  // Set-up: the default formation includes the Captain; leaving it in the Reserves Box is an error.
  s.phase = 'driveSetup';
  const f = defaultFormation(s, 'A');
  assert.ok(f[cap.id], 'Captain placed');
  assert.equal(Object.values(f).filter(Boolean).length, 11);
  for (const [id, at] of Object.entries(f)) {
    const q = p(s, id);
    q.location = at ? 'pitch' : 'reserves';
    q.pos = at;
  }
  assert.deepEqual(validateDriveSetup(s, 'A').filter((i) => i.level === 'error'), []);
  // Swap the Captain for a Reserve: refused.
  const reserve = s.players.find((x) => x.team === 'A' && x.location === 'reserves')!;
  reserve.location = 'pitch';
  reserve.pos = cap.pos;
  cap.location = 'reserves';
  cap.pos = null;
  assert.ok(validateDriveSetup(s, 'A').some((i) => /Team Captain #13 .* must be set up if able \(p\.155\)/.test(i.text)));
});

test('Team Captain: a natural 6 after using a Team Re-roll makes it free (Dodge); 1-5 spends it; not while the Captain is off the pitch', () => {
  const mk = (capOn: boolean) => {
    const b = new Pos({ a: 'human', b: 'orc', rerollsA: 2 });
    b.s.teams.A.specialRules = ['Team Captain'];
    const cap = b.add('A', 'human', 'blitzer', capOn ? c(3, 3) : null, { id: 'CAP' });
    cap.captain = true;
    if (!capOn) cap.location = 'reserves';
    b.add('A', 'human', 'lineman', c(10, 7), { id: 'L1' });
    b.add('B', 'orc', 'lineman', c(11, 7), { id: 'O1' });
    b.ball(c(20, 3));
    return b.start();
  };
  const dodge: PlayerActionInput = { kind: 'playerAction', playerId: 'L1', action: 'move', path: [{ to: c(9, 6), kind: 'step' }] };
  const team = (req: NonNullable<ExecutionResult['decision']>) => (req.type === 'reroll' ? 'team' : req.options[0].id);
  // Dodge 1 (fails) → Team Re-roll → Captain D6 6 (free) → re-rolled Dodge 5.
  const r1 = runScripted(mk(true), dodge, [1, 6, 5], team);
  assert.match(texts(r1), /Team Captain .*rolled 6 — a natural 6, the Team Re-roll is free/);
  assert.equal(r1.state.teams.A.rerolls, 2, texts(r1));
  assert.equal(p(r1.state, 'L1').pos!.x, 9);
  // Captain D6 5: the Team Re-roll is spent.
  const r2 = runScripted(mk(true), dodge, [1, 5, 5], team);
  assert.match(texts(r2), /Team Captain .*rolled 5 — the Team Re-roll is spent/);
  assert.equal(r2.state.teams.A.rerolls, 1);
  // Captain in the Reserves Box: no Captain roll (the next die is the re-roll itself).
  const r3 = runScripted(mk(false), dodge, [1, 6], team);
  assert.doesNotMatch(texts(r3), /Team Captain/);
  assert.equal(r3.state.teams.A.rerolls, 1);
  // A Prone Captain is still on the pitch.
  const s4 = mk(true);
  p(s4, 'CAP').stance = 'prone';
  assert.ok(captainOnPitch(s4, 'A'));
  // The flag alone does nothing on a team without the special rule.
  const s5 = mk(true);
  s5.teams.A.specialRules = [];
  assert.equal(captainOnPitch(s5, 'A'), undefined);
});

test('Team Captain: a Team Re-roll of block dice rolls for the Captain too; a Brilliant Coaching re-roll made free stays a Drive re-roll', () => {
  const b = new Pos({ a: 'human', b: 'orc', rerollsA: 1 });
  b.s.teams.A.specialRules = ['Team Captain'];
  b.add('A', 'human', 'blitzer', c(10, 7), { id: 'CAP' }).captain = true;
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'O1' });
  b.ball(c(20, 3));
  const s = b.start();
  s.teams.A.bonusRerolls = 1;
  // One die: Attacker Down (1) → Team Re-roll → Captain 6 → re-rolled die Push (3).
  const r = runScripted(s, blk('CAP', 'O1'), [1, 6, 3], (req) => (req.type === 'reroll' ? 'team' : req.type === 'followUp' ? 'no' : req.options[0].id));
  assert.match(texts(r), /Team Re-roll used on the block dice \(0 Team Re-rolls left\)/);
  assert.match(texts(r), /natural 6, the Team Re-roll is free/);
  assert.equal(r.state.teams.A.rerolls, 1);
  assert.equal(r.state.teams.A.bonusRerolls, 1, 'the free re-roll was the Brilliant Coaching one, still lost at the end of the Drive');
});

test('Team Captain in the exact ball-chain solver: the free re-roll is a separate branch with probability 1/6', () => {
  const b = new Pos({ a: 'human', b: 'orc', rerollsA: 1 });
  const cat = b.add('A', 'human', 'lineman', c(10, 7), { id: 'C1' });
  b.add('B', 'orc', 'lineman', c(20, 12), { id: 'O1' });
  b.ball(c(20, 3));
  const s = b.start();
  const policy = { useSkillRerolls: true, usePro: true, useTeamRerolls: true };
  const plain = solveBallChain(s, { t: 'arrive', sq: cat.pos!, kind: 'pass' }, policy);
  const s2 = structuredClone(s);
  s2.teams.A.specialRules = ['Team Captain'];
  const cap = structuredClone(cat);
  cap.id = 'CAP';
  cap.number = 99;
  cap.pos = c(3, 3);
  cap.captain = true;
  s2.players.push(cap);
  const withCap = solveBallChain(s2, { t: 'arrive', sq: cat.pos!, kind: 'pass' }, policy);
  const held = (res: typeof plain, free: number, team: number) => res.outcomes.filter((o) => o.holder === 'C1' && (o.rr.free ?? 0) === free && o.rr.team === team).reduce((a, o) => a + o.p, 0);
  // AG 3+: catch 4/6; fail 2/6 → Team Re-roll → catch 4/6.
  assert.ok(Math.abs(held(plain, 0, 1) - 4 / 6) < 1e-12);
  assert.ok(Math.abs(held(plain, 0, 0) - (2 / 6) * (4 / 6)) < 1e-12);
  assert.ok(Math.abs(held(withCap, 1, 1) - (2 / 6) * (1 / 6) * (4 / 6)) < 1e-12, JSON.stringify(withCap.outcomes.slice(0, 4)));
  assert.ok(Math.abs(held(withCap, 0, 0) - (2 / 6) * (5 / 6) * (4 / 6)) < 1e-12);
  const total = (res: typeof plain) => res.outcomes.reduce((a, o) => a + o.p, 0) + res.unresolved;
  assert.ok(Math.abs(total(withCap) - 1) < 1e-9);
  // The probability of the ball ending held by C1 is unchanged by the Captain (only the re-roll count differs).
  const heldAll = (res: typeof plain) => res.outcomes.filter((o) => o.holder === 'C1').reduce((a, o) => a + o.p, 0);
  assert.ok(Math.abs(heldAll(plain) - heldAll(withCap)) < 1e-12);
});

// ---------------------------------------------------------------------------
// Brawlin' Brutes (p.154)
// ---------------------------------------------------------------------------

test("Brawlin' Brutes (p.154): Orc players earn 3 SPP for a Casualty and 2 for a Touchdown in League play", () => {
  assert.equal(sppAward('casualty', ["Brawlin' Brutes", 'Team Captain']), 3);
  assert.equal(sppAward('touchdown', ["Brawlin' Brutes"]), 2);
  assert.equal(sppAward('completion', ["Brawlin' Brutes"]), 1);
  assert.equal(sppAward('casualty', ['Team Captain']), 2);
  assert.equal(sppAward('touchdown', []), 3);
  assert.equal(sppTotal({ casualty: 2, touchdown: 1, mvp: 1 }, ["Brawlin' Brutes"]), 3 * 2 + 2 + 4);
  assert.equal(sppTotal({ casualty: 2, touchdown: 1, mvp: 1 }), 2 * 2 + 3 + 4);
  // In a League match: an Orc Blitzer who causes a Casualty earns 3 SPP (the log says why); the post-game table counts 3.
  const s = toPlay('league', HUM('league'), ORC('league'), 21);
  assert.deepEqual(s.teams.B.specialRules, ["Brawlin' Brutes", 'Team Captain']);
  s.turn.active = 'B';
  const att = s.players.find((q) => q.team === 'B' && q.position === 'Orc Blitzer')!;
  const def = s.players.find((q) => q.team === 'A' && q.position === 'Human Lineman' && q.location === 'pitch')!;
  faceOff(s, att.id, def.id);
  // 1 die: POW (6); armour 6+6; injury 6+6 = Casualty; D16 1 = Badly Hurt.
  const r = run(s, blk(att.id, def.id), (req) => (req.type === 'followUp' ? 'no' : req.type === 'apothecary' ? (req.options.some((o) => o.id === 'keep') ? 'keep' : req.options[0].id) : req.type === 'reroll' ? 'none' : req.options[0].id), [6, 6, 6, 6, 6, 1, 1]);
  assert.notEqual(r.status, 'illegal', r.error);
  assert.match(texts(r), /earns 3 SPP \(Casualty, Brawlin' Brutes\)/, texts(r));
  const row = postGameSpp(r.state, 'B').find((x) => x.id === att.id)!;
  assert.equal(row.total, 3);
  // A Human (no Brawlin' Brutes) casualty would be 2.
  assert.equal(sppTotal(row.tally, r.state.teams.A.specialRules), 2);
});

// ---------------------------------------------------------------------------
// Masters of Undeath (p.155)
// ---------------------------------------------------------------------------

function tkKills(victimPos: string, seed = 31, opts: { answer?: 'yes' | 'no'; kind?: MatchKind } = {}) {
  const kind = opts.kind ?? 'tournament';
  const hum = team('hum', kind, 'human', [['lineman', 7], ['blitzer', 2], ['halfling', 1], ['ogre', 1]]);
  const s = toPlay(kind, TK(kind), hum, seed);
  s.turn.active = 'A';
  const att = s.players.find((q) => q.team === 'A' && q.position === 'Tomb Kings Blitzer')!;
  const def = s.players.find((q) => q.team === 'B' && q.position === victimPos)!;
  faceOff(s, att.id, def.id);
  def.skills = def.skills.filter((k) => k.id !== 'thickSkull');
  const asked: string[] = [];
  const answer = (req: NonNullable<ExecutionResult['decision']>) => {
    asked.push(req.type);
    if (req.type === 'raiseDead') return opts.answer ?? 'yes';
    if (req.type === 'apothecary') return req.options.some((o) => o.id === 'keep') ? 'keep' : req.options[0].id;
    if (req.type === 'followUp') return 'no';
    if (req.type === 'reroll') return 'none';
    return req.options[0].id;
  };
  // ST 3 v 3 (and v 2): POW; armour 6+6; injury 6+6 = Casualty; Casualty D16 16 = Dead. (ST 3 v ST 5 Ogre: 2 dice, the defender chooses — both POW.)
  const faces = def.st > 3 ? [6, 6, 6, 6, 6, 6, 16, 16] : [6, 6, 6, 6, 6, 16, 16];
  const r = run(s, blk(att.id, def.id), answer, faces);
  return { s, r, asked, att, def, before: s.players.filter((q) => q.team === 'A').length };
}

test('Masters of Undeath (p.155): an opposition player (ST 4 or less, not Stunty) killed → once per game a Skeleton Lineman joins the Reserves Box', () => {
  const { r, asked, before, def } = tkKills('Human Lineman');
  assert.notEqual(r.status, 'illegal', r.error);
  assert.match(texts(r), /Dead/);
  assert.equal(p(r.state, def.id).casualtyResult, 'Dead');
  assert.ok(asked.includes('raiseDead'), asked.join());
  const raised = r.state.players.filter((q) => q.team === 'A' && q.raised);
  assert.equal(raised.length, 1);
  assert.equal(raised[0].position, 'Skeleton Lineman');
  assert.equal(raised[0].location, 'reserves');
  assert.ok(raised[0].skills.some((k) => k.id === 'regeneration'), 'a full roster Skeleton');
  assert.equal(r.state.players.filter((q) => q.team === 'A').length, before + 1);
  assert.equal(r.state.teams.A.raiseDeadUsed, true);
  assert.match(texts(r), /Masters of Undeath: .* Raise the Dead — .*Skeleton Lineman.* joins the Reserves Box/);
  assert.deepEqual(validateState(r.state), []);
  // Once per game: a second death is not raised.
  const s2 = structuredClone(r.state);
  s2.turn.active = 'A';
  s2.turn.activation = null;
  for (const q of s2.players) q.activated = false;
  const att2 = s2.players.find((q) => q.team === 'A' && q.position === 'Tomb Kings Blitzer' && q.location === 'pitch' && q.stance === 'standing')!;
  const def2 = s2.players.find((q) => q.team === 'B' && q.position === 'Human Lineman' && q.location === 'pitch')!;
  faceOff(s2, att2.id, def2.id);
  def2.skills = [];
  const asked2: string[] = [];
  const r2 = run(s2, blk(att2.id, def2.id), (req) => (asked2.push(req.type), req.type === 'followUp' ? 'no' : req.type === 'apothecary' ? (req.options.some((o) => o.id === 'keep') ? 'keep' : req.options[0].id) : req.type === 'reroll' ? 'none' : req.options[0].id), [6, 6, 6, 6, 6, 16, 16]);
  assert.notEqual(r2.status, 'illegal', r2.error);
  assert.ok(!asked2.includes('raiseDead'));
  assert.equal(r2.state.players.filter((q) => q.team === 'A' && q.raised).length, 1);
});

test('Masters of Undeath: not a Stunty player, not ST 5+, and the coach may decline', () => {
  const st = tkKills('Halfling Hopeful');
  assert.notEqual(st.r.status, 'illegal', st.r.error);
  assert.ok(!st.asked.includes('raiseDead'));
  assert.match(texts(st.r), /cannot be raised \(Stunty\)/);
  const ogre = tkKills('Ogre');
  assert.notEqual(ogre.r.status, 'illegal', ogre.r.error);
  if (/Dead/.test(texts(ogre.r))) {
    assert.ok(!ogre.asked.includes('raiseDead'));
    assert.match(texts(ogre.r), /cannot be raised \(ST 5, more than 4\)/);
  }
  const no = tkKills('Human Lineman', 31, { answer: 'no' });
  assert.ok(no.asked.includes('raiseDead'));
  assert.equal(no.r.state.players.filter((q) => q.raised).length, 0);
  assert.notEqual(no.r.state.teams.A.raiseDeadUsed, true, 'declining keeps it for later');
});

test('Masters of Undeath in a League: the raised Lineman is hired for free after the game (not past 16 players)', () => {
  const { r } = tkKills('Human Lineman', 33, { kind: 'league' });
  assert.equal(r.state.players.filter((q) => q.raised).length, 1);
  const s = structuredClone(r.state);
  s.phase = 'fullTime';
  const def = TK('league');
  const { team: out, hired } = applyMatchSpp(def, s, 'A');
  assert.equal(hired.length, 1, hired.join());
  assert.equal(out.players.length, def.players.length + 1);
  const np = out.players[out.players.length - 1];
  assert.equal(np.positionId, 'skeleton');
  assert.deepEqual(errs(out), []);
  // Already 16 players: the raised player is lost.
  const full = team('tk', 'league', 'tombKings', [['skeleton', 12], ['tkBlitzer', 2], ['tombGuardian', 2]]);
  const r16 = applyMatchSpp(full, s, 'A');
  assert.equal(r16.hired.length, 0);
  assert.equal(r16.team.players.length, 16);
  // The opposing (Human) team gets nothing.
  assert.equal(applyMatchSpp(HUM('league'), s, 'B').hired.length, 0);
});

test('whole matches with the special rules (Human Captain v Orc Captain, Tomb Kings v Human) run to full time', () => {
  for (const [seed, a, b] of [
    [41, HUM(), ORC()],
    [42, TK(), HUM()],
  ] as Array<[number, TeamDef, TeamDef]>) {
    if (hasTeamCaptainRule(a)) setCaptain(a, a.players.find((x) => x.positionId === 'blitzer')!.id);
    if (hasTeamCaptainRule(b)) setCaptain(b, b.players.find((x) => x.positionId === 'blitzer')!.id);
    let s = toPlay('tournament', a, b, seed);
    for (let g = 0; s.phase !== 'fullTime'; g++) {
      assert.ok(g < 400, `stuck in ${s.phase}`);
      const m = s.match!;
      let input: ActionInput;
      if (s.phase === 'driveSetup') {
        const t = (m.setupDone[m.kicking as TeamId] ? (m.kicking === 'A' ? 'B' : 'A') : m.kicking) as TeamId;
        input = { kind: 'setupTeam', team: t, positions: defaultFormation(s, t) };
        // The Captain is always fielded.
        const cap = s.players.find((q) => q.team === t && q.captain && (q.location === 'reserves' || q.location === 'pitch'));
        if (cap) assert.ok(input.positions[cap.id], 'Captain fielded');
      } else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'solidDefence') input = { kind: 'solidDefence', positions: {} };
      else if (s.phase === 'kickoff' && m.pendingPhase?.type === 'quickSnap') input = { kind: 'quickSnap', moves: {} };
      else if (s.phase === 'kickoff') {
        const k = m.kicking as TeamId;
        const kicker = s.players.find((q) => q.team === k && q.location === 'pitch' && q.pos && q.pos.x !== (k === 'A' ? 12 : 13))!;
        input = { kind: 'kickoff', kicker: kicker.id, target: c(k === 'A' ? 20 : 5, 7) };
      } else if (s.phase === 'play' && m.pendingPhase?.type === 'charge') input = { kind: 'endCharge' };
      else if (s.phase === 'play') input = { kind: 'endTurn' };
      else input = { kind: 'nextDrive' };
      const res = run(s, input);
      assert.notEqual(res.status, 'illegal', `${input.kind}: ${res.error}`);
      s = res.state;
      assert.deepEqual(validateState(s), []);
    }
  }
});

test('Lizardmen have no Team Captain: the rule stays off even if a player is flagged in a saved file', () => {
  const l = LIZ();
  l.players[0].captain = true;
  assert.ok(errs(l).some((e) => /Only teams with the Team Captain special rule/.test(e)));
});
