/** V7 shared spatial contract: destinations, masks vs authoritative legality, frames, advice validation, profiles. Seven- and eleven-a-side boards. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import { bindEngine, nextMove, waitingFor } from '../src/ai/index';
import { Session, callService } from '../src/platform/index';
import { type AdviceRequest, ADVICE_RESPONSE_SCHEMA, PROFILES, actorFrame, adviceRequest, attackRightTransform, frameOf, fromActorFrame, maskHash, playerDestinations, remapGrid, resolveProfile, resolveSpatialAdvice, spatialMask, toActorFrame } from '../src/platform/spatial';
import { revisionOf } from '../src/platform/observe';

bindEngine(Engine);
type Any = Record<string, any>;

function playPosition(format: 'sevens' | 'standard', seed: number) {
  const a = Engine.builtinTeam('human', { format, play: 'exhibition', id: 'a', name: 'A' })!;
  const b = Engine.builtinTeam('orc', { format, play: 'exhibition', id: 'b', name: 'B' })!;
  let s = Engine.createMatch('tournament', a, b, { rules: 'full', play: 'exhibition' }, seed).state!;
  s = Engine.execute(s, { kind: 'pregame' }).state;
  for (let i = 0; i < 60 && s.phase !== 'play'; i++) {
    const w = waitingFor(s);
    if (!w) { s = Engine.execute(s, { kind: 'nextDrive' }).state; continue; }
    const mv = nextMove(s, w, 'balanced')!;
    s = (mv.type === 'decision' ? Engine.decide(s, { requestId: mv.requestId, optionId: mv.optionId }) : Engine.execute(s, mv.input)).state;
  }
  assert.equal(s.phase, 'play');
  return s;
}

for (const format of ['sevens', 'standard'] as const) {
  test(`${format}: destinations equal the engine's own legality; stay is legal; masks agree; coverage reported`, () => {
    const s = playPosition(format, 31337);
    const team = s.turn.active;
    const frame = frameOf(s);
    assert.deepEqual([frame.w, frame.h], format === 'sevens' ? [20, 11] : [26, 15]);
    const mover = s.players.find((p) => p.team === team && p.location === 'pitch' && p.stance === 'standing' && Engine.actionOptions(s, p).some((o) => o.action === 'move' && o.enabled))!;
    const d = playerDestinations(s, team, { playerId: mover.id, limit: 600 }) as Any;
    assert.equal(d.ok, true);
    assert.equal(d.canMove, true);
    assert.equal(d.stay.legal, true);
    assert.equal(d.complete, true);
    assert.equal(d.revision, revisionOf(s));
    assert.ok(d.destinations.length > 0);
    // every listed destination validates with the engine, using ITS route; probabilities are real
    for (const x of d.destinations.slice(0, 80)) {
      assert.ok(x.pRoute > 0 && x.pRoute <= 1);
      const errs = Engine.validateInput(s, { kind: 'player', playerId: mover.id, action: 'move', path: x.route.map((c: any) => ({ to: c })) } as never);
      assert.deepEqual(errs, [], `route to ${x.x},${x.y}`);
    }
    // the mask is exactly the destinations plus the stay square, and nothing else
    const m = spatialMask(s, team, mover.id) as Any;
    assert.equal(m.ok, true);
    const want = new Set<number>(d.destinations.map((x: any) => x.y * frame.w + x.x));
    want.add(mover.pos!.y * frame.w + mover.pos!.x);
    const got = new Set<number>();
    m.legal.forEach((v: number, i: number) => { if (v) got.add(i); });
    assert.deepEqual([...got].sort((a, b) => a - b), [...want].sort((a, b) => a - b));
    // illegal squares really are illegal: occupied squares are masked
    for (const p of s.players) if (p.pos && p.id !== mover.id) assert.equal(m.legal[p.pos.y * frame.w + p.pos.x], 0);
    assert.equal(m.provenance.complete, true);
    assert.equal(m.provenance.source, 'engine-current-rules');
  });

  test(`${format}: paging continues without gaps; another team's player and idle players answer cleanly`, () => {
    const s = playPosition(format, 99);
    const team = s.turn.active;
    const mover = s.players.find((p) => p.team === team && p.location === 'pitch' && Engine.actionOptions(s, p).some((o) => o.action === 'move' && o.enabled))!;
    const all = (playerDestinations(s, team, { playerId: mover.id, limit: 600, routes: false }) as Any).destinations.length;
    let n = 0; let off = 0; let pages = 0;
    for (;;) {
      const r = playerDestinations(s, team, { playerId: mover.id, offset: off, limit: 7, routes: false }) as Any;
      n += r.destinations.length; pages++;
      if (r.complete) { assert.equal(r.next, null); break; }
      assert.equal(r.complete, false); off = r.next;
    }
    assert.equal(n, all); assert.ok(pages > 1);
    const other = s.players.find((p) => p.team !== team)!;
    assert.equal((playerDestinations(s, team, { playerId: other.id }) as Any).ok, false);
    const idle = playerDestinations(s, team === 'A' ? 'B' : 'A', { playerId: other.id }) as Any;
    assert.equal(idle.ok, true); assert.equal(idle.canMove, false); assert.equal(idle.complete, true);
  });
}

test('actor frames: involution for both sides, both transforms, both boards; canonical coordinates untouched', () => {
  for (const [w, h] of [[26, 15], [20, 11]]) for (const side of ['A', 'B'] as const) for (const tf of ['native', 'mirrorX', 'rotate180'] as const) {
    const f = actorFrame(side, { w, h }, tf);
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) assert.deepEqual(fromActorFrame(f, toActorFrame(f, { x, y })), { x, y });
    const grid = Array.from({ length: w * h }, (_, i) => i);
    assert.deepEqual(remapGrid(remapGrid(grid, f), f), grid);
  }
  // the default makes the acting side attack toward increasing x; B's scoring column (x=0) maps to w-1
  const fb = actorFrame('B', { w: 26, h: 15 });
  assert.equal(toActorFrame(fb, { x: 0, y: 4 }).x, 25);
  assert.equal(attackRightTransform('A'), 'native');
  assert.equal(fb.verifiedAgainst, null, 'unverified against any encoder until its source is available');
});

test('advice: argmax honours the mask; stale, wrong player/frame/board, non-finite and all-masked are rejected; proposed/selected/executed separate', () => {
  const s = playPosition('sevens', 5);
  const team = s.turn.active;
  const mover = s.players.find((p) => p.team === team && p.location === 'pitch' && Engine.actionOptions(s, p).some((o) => o.action === 'move' && o.enabled))!;
  const req = adviceRequest(s, team, mover.id, 7) as AdviceRequest;
  assert.equal(req.schema, 'bloodboard-spatial-advice-request/1');
  const mask = (spatialMask(s, team, mover.id) as Any).legal as number[];
  const n = req.frame.w * req.frame.h;
  const cur = { revision: revisionOf(s), mask, requestId: 7 };
  const af = req.actorFrame;
  // a model that loves ONE illegal square (the first occupied one) but has a legal runner-up
  const canon = new Array<number>(n).fill(0);
  const illegal = mask.findIndex((v) => v === 0);
  const legalIdx = mask.findIndex((v) => v === 1);
  canon[illegal] = 50; canon[legalIdx] = 10;
  const resp = (over: Any = {}) => ({ schema: ADVICE_RESPONSE_SCHEMA, requestId: 7, revision: req.revision, player: mover.id, side: team, frame: { id: af.id, w: req.frame.w, h: req.frame.h }, scores: remapGrid(canon, af), kind: 'logit', ...over });
  const ok = resolveSpatialAdvice(req, cur, resp()) as Any;
  assert.equal(ok.ok, true);
  assert.equal(mask[ok.selected.y * req.frame.w + ok.selected.x], 1, 'selected square is legal');
  assert.deepEqual([ok.proposed.x, ok.proposed.y], [illegal % req.frame.w, Math.floor(illegal / req.frame.w)], 'proposed = the model\'s own best, even though illegal');
  assert.notDeepEqual([ok.proposed.x, ok.proposed.y], [ok.selected.x, ok.selected.y]);
  assert.equal(ok.executed, null);
  assert.ok(ok.maskedMass > 0.9);
  const code = (r: unknown) => (r as Any).code;
  assert.equal(code(resolveSpatialAdvice(req, { ...cur, revision: 'other' }, resp())), 'stale-revision');
  assert.equal(code(resolveSpatialAdvice(req, cur, resp({ revision: 'old' }))), 'stale-revision');
  assert.equal(code(resolveSpatialAdvice(req, cur, resp({ player: 'zzz' }))), 'wrong-player');
  assert.equal(code(resolveSpatialAdvice(req, cur, resp({ side: team === 'A' ? 'B' : 'A' }))), 'wrong-player');
  assert.equal(code(resolveSpatialAdvice(req, cur, resp({ frame: { id: 'actor-frame/native-x', w: req.frame.w, h: req.frame.h } }))), 'wrong-frame');
  assert.equal(code(resolveSpatialAdvice(req, cur, resp({ frame: { id: af.id, w: 26, h: 15 } }))), 'wrong-board');
  assert.equal(code(resolveSpatialAdvice(req, cur, resp({ scores: [1, 2, 3] }))), 'bad-shape');
  const nan = remapGrid(canon, af).slice(); nan[3] = NaN;
  assert.equal(code(resolveSpatialAdvice(req, cur, resp({ scores: nan }))), 'non-finite');
  assert.equal(code(resolveSpatialAdvice(req, { ...cur, mask: new Array(n).fill(0) }, resp())), 'stale-revision', 'mask hash differs');
  const emptyReq = { ...req, maskHash: maskHash(new Array(n).fill(0)) };
  assert.equal(code(resolveSpatialAdvice(emptyReq, { ...cur, mask: new Array(n).fill(0) }, resp())), 'all-masked');
  assert.equal(code(resolveSpatialAdvice(req, cur, { ...resp(), schema: 'x' })), 'wrong-schema');
  // sample script needs a host rng and never reveals it
  assert.equal(code(resolveSpatialAdvice(req, cur, resp(), { kind: 'sample', temperature: 1 })), 'bad-script');
  const sm = resolveSpatialAdvice(req, cur, resp(), { kind: 'sample', temperature: 1, topK: 3 }, () => 0.0) as Any;
  assert.equal(sm.ok, true);
});

test('services answer through the real worker-facing service path', () => {
  const s = playPosition('sevens', 77);
  const team = s.turn.active;
  const ses = new Session(s, team, 1, 30000);
  const mover = s.players.find((p) => p.team === team && p.location === 'pitch' && Engine.actionOptions(s, p).some((o) => o.action === 'move' && o.enabled))!;
  const d = callService(ses, 'playerDestinations', [{ playerId: mover.id, limit: 20 }]) as Any;
  assert.equal(d.ok, true); assert.equal(d.schema, 'bloodboard-player-destinations/1');
  const m = callService(ses, 'spatialMask', [{ playerId: mover.id, frame: 'actor' }]) as Any;
  assert.equal(m.ok, true); assert.equal(m.inFrame, m.actorFrame.id);
  assert.equal((callService(ses, "playerDestinations", [{}]) as Any).ok, false);
});

test('compute profiles are separate; a maximum is not a duration; local profiles do not inherit the online cap', () => {
  assert.equal(PROFILES.interactive.maxDecisionMs, 120000);
  assert.equal(PROFILES.interactive.onlineConcurrencyCap, true);
  for (const k of ['localBatch', 'trainingSampling']) { assert.equal(PROFILES[k].onlineConcurrencyCap, false); assert.equal(PROFILES[k].concurrency, 'hardware'); }
  assert.ok(PROFILES.trainingSampling.maxDecisionMs < PROFILES.interactive.maxDecisionMs);
  assert.equal(PROFILES.interactive.forceFullBudget, false);
  assert.equal(resolveProfile('interactive', { maxDecisionMs: 90000 }).ok, true, 'the interactive ceiling is now 120 s');
  assert.equal(resolveProfile('interactive', { maxDecisionMs: 120000 }).ok, true);
  assert.equal(resolveProfile('interactive', { maxDecisionMs: 120001 }).ok, false);
  assert.equal(resolveProfile('localBatch', { maxDecisionMs: 120000 }).ok, true, 'a user may explicitly choose a slower local profile');
  assert.equal(resolveProfile('trainingSampling', { targetDecisionMs: 9999 }).ok, false);
  assert.equal(resolveProfile('nope').ok, false);
});
