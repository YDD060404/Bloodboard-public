/**
 * V4: League post-game — Star Player Points earned in the match (p.96), the
 * Most Valuable Player roll (p.96) and adding the SPP to the saved team.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyMatchSpp,
  createMatch,
  decide,
  defaultFormation,
  defaultMvpNominees,
  execute,
  mvpEligible,
  newTeamDef,
  playerFromRoster,
  postGameSpp,
  ROSTER_BY_ID,
  ScriptedDice,
  validateInput,
  type ActionInput,
  type ExecutionResult,
  type GameState,
  type MatchKind,
  type TeamDef,
  type TeamId,
} from '../src/engine/index';
import { c } from './helpers';

function team(id: string, kind: MatchKind, rosterId: string, comp: Array<[string, number]>): TeamDef {
  const t = newTeamDef(kind, rosterId, `${rosterId} ${id}`, id);
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  t.rerolls = 2;
  return t;
}
const humans = (kind: MatchKind) => team('hum', kind, 'human', [['lineman', 8], ['blitzer', 2], ['catcher', 2], ['thrower', 1]]);
const orcs = (kind: MatchKind) => team('orc', kind, 'orc', [['lineman', 7], ['blitzer', 2], ['bigUn', 2]]);

function run(s: GameState, input: ActionInput, faces?: number[]): ExecutionResult {
  const dice = faces ? () => new ScriptedDice(faces) : undefined;
  let res = execute(s, input, undefined, dice);
  let g = 0;
  while (res.status === 'awaitingDecision' && res.decision) {
    if (g++ > 80) throw new Error('too many decisions');
    res = decide(res.state, { requestId: res.decision.id, optionId: res.decision.options[0].id }, dice);
  }
  return res;
}

/** Plays a whole match with End Turn only (random dice) and returns the full-time state. */
function wholeMatch(kind: MatchKind, seed: number, until?: (s: GameState) => boolean): GameState {
  const r = createMatch(kind, humans(kind), orcs(kind), { rules: 'introductory' }, seed);
  assert.ok(r.ok, r.errors.join());
  let s = r.state as GameState;
  for (let steps = 0; s.phase !== 'fullTime'; steps++) {
    if (steps > 400) throw new Error('match did not finish');
    if (until?.(s)) return s;
    const m = s.match!;
    let input: ActionInput;
    if (s.phase === 'pregame') input = { kind: 'pregame' };
    else if (s.phase === 'driveSetup') {
      const t = (m.setupDone[m.kicking as TeamId] ? (m.kicking === 'A' ? 'B' : 'A') : m.kicking) as TeamId;
      input = { kind: 'setupTeam', team: t, positions: defaultFormation(s, t) };
    } else if (s.phase === 'kickoff') {
      const k = m.kicking as TeamId;
      const kicker = s.players.find((q) => q.team === k && q.location === 'pitch' && q.pos && q.pos.x !== (k === 'A' ? 12 : 13))!;
      input = { kind: 'kickoff', kicker: kicker.id, target: c(k === 'A' ? 20 : 5, 7) };
    } else if (s.phase === 'play') input = { kind: 'endTurn' };
    else input = { kind: 'nextDrive' };
    const res = run(s, input);
    assert.notEqual(res.status, 'illegal', `${input.kind}: ${res.error}`);
    s = res.state;
  }
  return s;
}

test('League match: the players who were set up are recorded; MVP nominees must have played', () => {
  const s = wholeMatch('league', 3);
  assert.equal(s.phase, 'fullTime');
  const playedA = mvpEligible(s, 'A');
  assert.ok(playedA.length >= 11 && playedA.length <= 13, String(playedA.length));
  assert.ok(playedA.every((p) => p.team === 'A'));
  const nominees = defaultMvpNominees(s, 'A');
  assert.equal(nominees.length, 6);
  assert.deepEqual(validateInput(s, { kind: 'mvp', team: 'A', nominees }), []);
  assert.match(validateInput(s, { kind: 'mvp', team: 'A', nominees: [...nominees, playedA[6].id] }).join(), /one to six/);
  assert.match(validateInput(s, { kind: 'mvp', team: 'A', nominees: [nominees[0], nominees[0]] }).join(), /once/);
  const orc = s.players.find((p) => p.team === 'B')!;
  assert.match(validateInput(s, { kind: 'mvp', team: 'A', nominees: [orc.id] }).join(), /only players of this team who played/);
});

test('MVP roll (p.96): the nominees are numbered 1-6; a number without a nominee is rolled again; the MVP earns 4 SPP', () => {
  const s = wholeMatch('league', 5);
  const nominees = mvpEligible(s, 'A').slice(0, 3).map((p) => p.id);
  const r = run(s, { kind: 'mvp', team: 'A', nominees }, [6, 5, 2]);
  assert.equal(r.status, 'completed', r.error);
  assert.equal(r.state.match!.mvp!.A, nominees[1]);
  assert.equal(r.state.match!.spp![nominees[1]].mvp, 1);
  const text = r.events.map((e) => e.text).join('\n');
  assert.match(text, /MVP roll: 6 — no player has that number; roll again/);
  assert.match(text, /MVP roll: 2 — .* Most Valuable Player/);
  assert.match(text, /earns 4 SPP \(Most Valuable Player\)/);
  const row = postGameSpp(r.state, 'A').find((x) => x.id === nominees[1])!;
  assert.ok(row.total >= 4);
  assert.match(validateInput(r.state, { kind: 'mvp', team: 'A', nominees }).join(), /already rolled/);
});

test('Adding the SPP to the saved League team: by player, once', () => {
  const s0 = wholeMatch('league', 7);
  const nominees = mvpEligible(s0, 'B').slice(0, 6).map((p) => p.id);
  const s = run(s0, { kind: 'mvp', team: 'B', nominees }, [1]).state;
  const def = orcs('league');
  const mvp = s.players.find((p) => p.id === nominees[0])!;
  const before = postGameSpp(s, 'B');
  const { team: after, added } = applyMatchSpp(def, s, 'B');
  const tp = after.players.find((p) => p.id === mvp.defId)!;
  assert.equal(tp.spp, before.find((x) => x.id === mvp.id)!.total);
  assert.ok((tp.spp ?? 0) >= 4);
  assert.equal(added.reduce((a, x) => a + x.spp, 0), before.reduce((a, x) => a + x.total, 0));
  assert.equal(def.players.find((p) => p.id === mvp.defId)!.spp, undefined, 'the input team is not changed');
  const marked: GameState = { ...s, match: { ...s.match!, sppApplied: { B: true } } };
  assert.throws(() => applyMatchSpp(def, marked, 'B'), /already been added/);
  // Also when the match flag was lost (e.g. Undo): the team remembers the match.
  assert.throws(() => applyMatchSpp(after, s, 'B'), /already been added/);
});

test('No SPP or MVP outside League matches', () => {
  const s = wholeMatch('tournament', 9);
  assert.equal(s.match!.spp, undefined);
  assert.match(validateInput(s, { kind: 'mvp', team: 'A', nominees: [s.players[0].id] }).join(), /Only League matches/);
  assert.throws(() => applyMatchSpp(humans('tournament'), s, 'A'), /Only League/);
});

test('A Touchdown in a League match earns 3 SPP (2 for Brawlin\' Brutes, p.154), recorded for the post-game', () => {
  const s0 = wholeMatch('league', 11, (x) => x.phase === 'play' && !x.match!.pendingPhase);
  const s = structuredClone(s0);
  const t = s.turn.active;
  const scorer = s.players.find((p) => p.team === t && p.location === 'pitch' && p.stance === 'standing')!;
  // Put the scorer next to the opposition End Zone with the ball, the squares around empty.
  const x = t === 'A' ? 24 : 1;
  const endX = t === 'A' ? 25 : 0;
  for (const q of s.players)
    if (q.id !== scorer.id && q.pos && Math.abs(q.pos.x - x) <= 2 && Math.abs(q.pos.y - 7) <= 2) {
      q.location = 'reserves';
      q.pos = null;
    }
  scorer.pos = { x, y: 7 };
  scorer.stance = 'standing';
  s.ball = { kind: 'held', playerId: scorer.id };
  const r = run(s, { kind: 'playerAction', playerId: scorer.id, action: 'move', path: [{ to: { x: endX, y: 7 }, kind: 'step' }] }, [6, 6, 6]);
  assert.equal(r.status, 'touchdown', r.error);
  assert.equal(r.state.match!.spp![scorer.id].touchdown, 1);
  // V5: the Orc team has Brawlin' Brutes (p.154) — 2 SPP for a Touchdown instead of 3.
  const brutes = !!r.state.teams[t].specialRules?.includes("Brawlin' Brutes");
  assert.equal(postGameSpp(r.state, t).find((x0) => x0.id === scorer.id)!.tally.touchdown, 1);
  assert.equal(postGameSpp(r.state, t).find((x0) => x0.id === scorer.id)!.total, brutes ? 2 : 3);
});

test('Violent Innovator (p.138): a Casualty caused by the player\'s Special Action (Projectile Vomit) earns 2 SPP; without it none', () => {
  const s0 = wholeMatch('league', 13, (x) => x.phase === 'play' && !x.match!.pendingPhase);
  for (const vi of [true, false]) {
    const s = structuredClone(s0);
    const t = s.turn.active;
    const v = s.players.find((p) => p.team === t && p.location === 'pitch' && p.stance === 'standing')!;
    const target = s.players.find((p) => p.team !== t && p.location === 'pitch' && p.stance === 'standing')!;
    for (const q of s.players) if (q.pos && q.id !== v.id && q.id !== target.id && Math.abs(q.pos.x - 6) <= 2 && Math.abs(q.pos.y - 3) <= 2) (q.location = 'reserves'), (q.pos = null);
    v.pos = { x: 6, y: 3 };
    target.pos = { x: 7, y: 3 };
    v.skills = [{ id: 'projectileVomit' }, ...(vi ? [{ id: 'violentInnovator' }] : [])];
    target.skills = [];
    if (s.ball.kind === 'held' && (s.ball.playerId === v.id || s.ball.playerId === target.id)) s.ball = { kind: 'ground', pos: { x: 13, y: 13 } };
    // PV 6; armour 6+6 broken; injury 6+6 Casualty; Casualty roll D16 → 1 (Badly Hurt); keep the apothecary.
    const r = run(s, { kind: 'playerAction', playerId: v.id, action: 'special', special: 'projectileVomit', vomitTarget: target.id, path: [] }, [6, 6, 6, 6, 6, 1, 1, 1]);
    assert.notEqual(r.status, 'illegal', r.error);
    const tgt = r.state.players.find((p) => p.id === target.id)!;
    assert.equal(tgt.location, 'cas', r.events.map((e) => e.text).join('\n'));
    assert.equal(r.state.match!.spp?.[v.id]?.casualty ?? 0, vi ? 1 : 0);
  }
});

test('Plague Ridden (p.133): a Dead result from this player\'s Block (not saved) adds a new Lineman to the Reserves Box, once per game; never against a Stunty player', () => {
  const s0 = wholeMatch('league', 17, (x) => x.phase === 'play' && !x.match!.pendingPhase);
  const mk = (stunty: boolean) => {
    const s = structuredClone(s0);
    const t = s.turn.active;
    const att = s.players.find((q) => q.team === t && q.location === 'pitch' && q.stance === 'standing')!;
    const def = s.players.find((q) => q.team !== t && q.location === 'pitch' && q.stance === 'standing')!;
    for (const q of s.players) if (q.pos && q.id !== att.id && q.id !== def.id && Math.abs(q.pos.x - 6) <= 3 && Math.abs(q.pos.y - 3) <= 3) (q.location = 'reserves'), (q.pos = null);
    att.pos = { x: 6, y: 3 };
    def.pos = { x: 7, y: 3 };
    att.skills = [{ id: 'plagueRidden' }];
    def.skills = stunty ? [{ id: 'stunty' }] : [];
    def.keywords = ['Lineman'];
    if (s.ball.kind === 'held' && (s.ball.playerId === att.id || s.ball.playerId === def.id)) s.ball = { kind: 'ground', pos: { x: 13, y: 13 } };
    return { s, att, def, t };
  };
  const { s, att, t } = mk(false);
  const before = s.players.filter((q) => q.team === t).length;
  const asked: string[] = [];
  // 1 block die (ST 3 v 3 assumed; extra dice are harmless): POW 6; no follow-up; armour 6+6; injury 6+6 Casualty; Casualty D16 16 Dead.
  const answer = (req: { type: string; options: Array<{ id: string }> }) => {
    asked.push(req.type);
    if (req.type === 'plagueRidden') return 'yes';
    if (req.type === 'apothecary') return req.options.some((o) => o.id === 'keep') ? 'keep' : req.options[req.options.length - 1].id;
    if (req.type === 'followUp') return 'no';
    return req.options[0].id;
  };
  const dice = [6, 6, 6, 6, 6, 6, 16, 16];
  let res = execute(s, { kind: 'playerAction', playerId: att.id, action: 'block', path: [], blockTarget: s.players.find((q) => q.pos && q.pos.x === 7 && q.pos.y === 3)!.id }, undefined, () => new ScriptedDice(dice));
  let g = 0;
  while (res.status === 'awaitingDecision' && g++ < 20) res = decide(res.state, { requestId: res.decision!.id, optionId: answer(res.decision!) }, () => new ScriptedDice(dice));
  assert.notEqual(res.status, 'illegal', res.error);
  const text = res.events.map((e) => e.text).join('\n');
  assert.match(text, /Dead/, text);
  assert.ok(asked.includes('plagueRidden'), asked.join());
  assert.equal(res.state.players.filter((q) => q.team === t).length, before + 1);
  assert.ok(res.state.players.some((q) => q.team === t && q.location === 'reserves' && /Plague Ridden/.test(text)));
  assert.equal(res.state.players.find((q) => q.id === att.id)!.plagueUsed, true);
  // Against a Stunty player: not offered.
  const m2 = mk(true);
  asked.length = 0;
  let r2 = execute(m2.s, { kind: 'playerAction', playerId: m2.att.id, action: 'block', path: [], blockTarget: m2.s.players.find((q) => q.pos && q.pos.x === 7 && q.pos.y === 3)!.id }, undefined, () => new ScriptedDice(dice));
  g = 0;
  while (r2.status === 'awaitingDecision' && g++ < 20) r2 = decide(r2.state, { requestId: r2.decision!.id, optionId: answer(r2.decision!) }, () => new ScriptedDice(dice));
  assert.ok(!asked.includes('plagueRidden'));
});
