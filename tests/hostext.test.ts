/**
 * V5.8 host extensions: the shared setup hook, host-managed coach context, capability flags, Wizard resources and the
 * declared deadlines — checked against the real engine, the real host (`platformDecide`) and real worker threads.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Engine from '../src/engine/index';
import type { GameState, TeamId } from '../src/engine/index';
import { bindEngine, type CoachEntry } from '../src/ai/index';
import { platformDecide, type DecideMeta } from '../src/platform/host';
import { CoachContextStore, buildSetupRequest, checkSetupAnswer, cloneCoachContext, wizardAvailable, COACH_CONTEXT_MAX_BYTES } from '../src/platform/hostext';
import { nodeSpawn } from '../src/platform/research/nodehost';
import { buildTeam, ROSTERS } from '../src/platform/research/teams';
import { playMatch } from '../src/platform/research/match';
import { observe } from '../src/platform/observe';

bindEngine(Engine);

const N = Engine.defaultFormation; void N;

function match(format: 'standard' | 'sevens', opts: { wizardA?: boolean; wizardB?: boolean } = {}): GameState {
  const a = ROSTERS.human[format]();
  const b = ROSTERS.orc[format]();
  if (opts.wizardA) { a.inducements = { wizard: 1 } as never; a.rerolls = 0; }
  if (opts.wizardB) { b.inducements = { wizard: 1 } as never; b.rerolls = 0; }
  const cm = Engine.createMatch('tournament', a, b, { rules: 'introductory' }, 11);
  assert.ok(cm.ok, cm.ok ? '' : cm.errors.join('; '));
  return cm.state as GameState;
}
/** The state at the start of a Drive's set-up with `A` kicking (A sets up first). */
function setupState(format: 'standard' | 'sevens', keep?: number, opts: Parameters<typeof match>[1] = {}): GameState {
  const s = match(format, opts);
  s.phase = 'driveSetup';
  s.match!.kicking = 'A';
  s.match!.setupDone = { A: false, B: false };
  if (keep !== undefined) {
    // fewer players available this Drive (knocked out / casualties earlier in the match)
    const mine = s.players.filter((p) => p.team === 'A').sort((x, y) => x.number - y.number);
    mine.slice(keep).forEach((p) => { p.location = 'ko'; p.pos = null; });
  }
  return s;
}
const entry = (body: string, ms = 5000, extra = ''): CoachEntry => ({ id: 'fx', name: 'fx', kind: 'strategy', implementation: 'strategy:fx', version: '1', description: '', code: `bloodboard.register({id:'fx',name:'fx',apiVersion:1,apiMinor:2,timeLimitMs:${ms},${extra}${body}});`, timeLimitMs: ms, apiMinor: 2 } as unknown as CoachEntry);
const run = (s: GameState, team: TeamId, e: CoachEntry, o: Record<string, unknown> = {}) => platformDecide(s, team, e, { spawn: nodeSpawn, ...o });
const mirror = (req: any) => Object.fromEntries(Object.entries(req.defaultPositions as Record<string, { x: number; y: number } | null>).map(([id, c]) => [id, c ? { x: c.x, y: req.pitch.h - 1 - c.y } : null]));

test('set-up request: constraints come from the active ruleset (11-a-side, Sevens, reduced counts)', () => {
  const std = buildSetupRequest(setupState('standard'), 'A');
  assert.equal(std.fieldedIds.length, 11);
  assert.deepEqual(std.fixedPlayerIds, std.fieldedIds);
  assert.equal(std.lineOfScrimmage, 12);
  assert.deepEqual(std.centreRows, { min: 4, max: 10 });
  assert.equal(std.minLine, 3); assert.equal(std.maxWide, 2); assert.equal(std.format, 'standard');
  assert.ok(std.legalSquares.every((c) => c.x <= 12) && std.legalSquares.length === 13 * 15);
  const sev = buildSetupRequest(setupState('sevens'), 'A');
  assert.equal(sev.fieldedIds.length, 7);
  assert.equal(sev.lineOfScrimmage, 6);
  assert.deepEqual(sev.centreRows, { min: 2, max: 8 });
  assert.equal(sev.maxWide, 1); assert.equal(sev.format, 'sevens');
  assert.equal(buildSetupRequest(setupState('sevens'), 'B').lineOfScrimmage, 13);
  for (const [fmt, keep] of [['standard', 5], ['standard', 3], ['standard', 2], ['sevens', 4], ['sevens', 3]] as const) {
    const r = buildSetupRequest(setupState(fmt, keep), 'A');
    assert.equal(r.fieldedIds.length, keep, `${fmt}/${keep}`);
    assert.equal(r.allOnLine, keep <= 3);
    assert.equal(r.minLine, keep <= 3 ? keep : 3);
  }
});

test('set-up answers: valid formations are accepted by the engine; every illegal one is refused', () => {
  for (const [fmt, keep] of [['standard', undefined], ['sevens', undefined], ['standard', 5], ['standard', 3], ['standard', 2], ['sevens', 4], ['sevens', 3]] as const) {
    const s = setupState(fmt, keep);
    const req = buildSetupRequest(s, 'A');
    const ok = checkSetupAnswer(s, 'A', req, { positions: mirror(req), why: 'mirrored' });
    assert.ok(ok.ok, `${fmt}/${keep}: ${ok.ok ? '' : ok.reason}`);
    assert.equal(Engine.matchInputReason(s, (ok as any).input), null);
    assert.ok(checkSetupAnswer(s, 'A', req, { positions: req.defaultPositions }).ok, 'the default is itself legal');
  }
  const s = setupState('standard');
  const req = buildSetupRequest(s, 'A');
  const ids = req.fieldedIds;
  const def = () => JSON.parse(JSON.stringify(req.defaultPositions)) as Record<string, any>;
  const bad = (positions: unknown, why: RegExp | string) => { const r = checkSetupAnswer(s, 'A', req, { positions }); assert.equal(r.ok, false, String(why)); assert.match((r as any).reason, why instanceof RegExp ? why : new RegExp(why)); };
  let p = def(); p[ids[0]] = { x: Number.NaN, y: 3 }; bad(p, /integer/);
  p = def(); p[ids[0]] = { x: 1.5, y: 3 }; bad(p, /integer/);
  p = def(); p[ids[0]] = { x: Infinity, y: 3 }; bad(p, /integer/);
  p = def(); p[ids[0]] = { x: '3', y: 3 }; bad(p, /integer/);
  p = def(); p[ids[0]] = p[ids[1]]; bad(p, /share square/);
  p = def(); p[ids[0]] = { x: 20, y: 3 }; bad(p, /outside/);
  p = def(); delete p[ids[0]]; bad(p, /no position/);
  p = def(); p['zz-unknown'] = { x: 1, y: 1 }; bad(p, /Unknown player/);
  const other = s.players.find((q) => q.team === 'B')!.id; p = def(); p[other] = { x: 2, y: 2 }; bad(p, /other team/);
  const benched = Object.keys(req.defaultPositions).find((id) => req.defaultPositions[id] === null);
  void benched;
  // a 4th/3rd player in a Wide Zone and too few on the Line of Scrimmage (full-formation rules, from the engine)
  p = def(); p[ids[3]] = { x: 9, y: 0 }; p[ids[4]] = { x: 9, y: 1 }; p[ids[5]] = { x: 9, y: 2 }; bad(p, /Wide Zone/);
  p = def(); p[ids[0]] = { x: 3, y: 7 }; bad(p, /Line of Scrimmage/);
  bad(null, /positions/); bad([], /positions/);
  assert.equal(checkSetupAnswer(s, 'A', req, 'nope').ok, false);
  // phase: the same answer in the play phase is not a set-up
  const play = Engine.cloneState(s); play.phase = 'play';
  assert.equal(checkSetupAnswer(play, 'A', req, { positions: req.defaultPositions }).ok, false);
  // reduced: with 3 fielded all three must stand on the Line of Scrimmage in the Centre Field
  const s3 = setupState('standard', 3); const r3 = buildSetupRequest(s3, 'A'); const p3 = JSON.parse(JSON.stringify(r3.defaultPositions)); p3[r3.fieldedIds[2]] = { x: 8, y: 7 };
  assert.equal(checkSetupAnswer(s3, 'A', r3, { positions: p3 }).ok, false);
});

test('set-up hook through the host: legal answer used; missing hook, null, invalid, throwing and slow hooks keep the legal default with diagnostics', async () => {
  const s = setupState('standard');
  const good = await run(s, 'A', entry(`chooseSetup(o,r){const m={};for(const [id,c] of Object.entries(r.defaultPositions)) m[id]=c?{x:c.x,y:r.pitch.h-1-c.y}:null;return {positions:m,why:'mirrored'};}`));
  assert.equal(good.meta.via, 'setup'); assert.equal(good.meta.kind, 'setup'); assert.equal(good.meta.setup?.accepted, true); assert.equal(good.meta.fellBack, false);
  assert.equal(Engine.matchInputReason(s, (good.move as any).input), null);
  const old = await run(s, 'A', entry(`chooseAction(o,c){return {endTurn:true};}`)); // an old module: no hooks at all
  assert.equal(old.move?.type, 'step'); assert.equal(old.meta.setup?.hook, true); assert.equal(old.meta.setup?.accepted, false); assert.equal(old.meta.fellBack, false);
  assert.equal(Engine.matchInputReason(s, (old.move as any).input), null, 'the built-in formation is legal');
  const nul = await run(s, 'A', entry(`chooseSetup(o,r){return null;}`)); assert.equal(nul.meta.setup?.fallback, true); assert.equal(nul.meta.fellBack, false);
  const inv = await run(s, 'A', entry(`chooseSetup(o,r){const p=r.defaultPositions;p[r.fieldedIds[0]]={x:-1,y:0};return {positions:p};}`));
  assert.equal(inv.meta.fellBack, true); assert.equal(inv.meta.setup?.accepted, false); assert.ok(inv.meta.diagnostics.some((d) => d.code === 'illegal'));
  assert.equal(Engine.matchInputReason(s, (inv.move as any).input), null);
  const thr = await run(s, 'A', entry(`chooseSetup(o,r){throw new Error('boom');}`)); assert.equal(thr.meta.fellBack, true); assert.match(thr.meta.reason ?? '', /boom/);
  const t0 = Date.now();
  const slow = await run(s, 'A', entry(`async chooseSetup(o,r){await new Promise(r=>setTimeout(r,2500));return {positions:r.defaultPositions};}`, 800));
  assert.equal(slow.meta.fellBack, true); assert.ok(slow.meta.diagnostics.some((d) => d.code === 'timeout')); assert.ok(Date.now() - t0 < 2300, 'stopped at the declared limit, not at the module');
  assert.equal(Engine.matchInputReason(s, (slow.move as any).input), null);
});

test('coach context: clone, byte limit, commit only for legal answers of current requests; absent never erases', () => {
  assert.equal(cloneCoachContext(undefined).ok, false);
  assert.equal(cloneCoachContext({ a: 1 }).ok, true);
  const cyc: any = {}; cyc.self = cyc; assert.equal(cloneCoachContext(cyc).ok, false);
  assert.equal(cloneCoachContext({ s: 'x'.repeat(COACH_CONTEXT_MAX_BYTES) }).ok, false, 'JSON bytes over the limit');
  assert.equal(cloneCoachContext('é'.repeat(4000)).ok, true, '8002 UTF-8 bytes fit');
  assert.equal(cloneCoachContext('é'.repeat(5000)).ok, false, '5000 characters but 10002 UTF-8 bytes: the limit is in bytes');
});

test('coach context store: round trip, isolation by team/coach/match, invalidation, supersession', () => {
  const st = new CoachContextStore();
  const t1 = st.ticket('A', 'c1');
  assert.equal(t1.value, undefined);
  assert.equal(t1.commit({ n: 1 }).committed, true);
  const t2 = st.ticket('A', 'c1'); assert.deepEqual(t2.value, { n: 1 });
  (t2.value as any).n = 99; assert.deepEqual(st.peek('A', 'c1'), { n: 1 }, 'the module gets a clone');
  assert.equal(t2.commit(undefined).committed, false); assert.deepEqual(st.peek('A', 'c1'), { n: 1 }, 'missing context does not erase');
  assert.equal(t2.commit({ s: 'x'.repeat(9000) }).committed, false); assert.deepEqual(st.peek('A', 'c1'), { n: 1 }, 'oversized ignored');
  assert.equal(st.ticket('A', 'c1').commit(() => 1).committed, false, 'non-JSON ignored');
  // same coach on both sides, other team, other coach
  const b = st.ticket('B', 'c1'); assert.equal(b.value, undefined);
  b.commit({ side: 'B' }); assert.deepEqual(st.peek('A', 'c1'), { n: 1 }); assert.deepEqual(st.peek('B', 'c1'), { side: 'B' });
  // switching coaches of a team never exposes the other coach's context — not even after switching back
  assert.equal(st.ticket('A', 'c2').value, undefined);
  assert.equal(st.ticket('A', 'c1').value, undefined, 'switching back starts clean');
  // supersession: the older ticket can no longer commit
  const old = st.ticket('A', 'c1'); const fresh = st.ticket('A', 'c1');
  assert.equal(old.current(), false); assert.equal(old.commit({ late: true }).committed, false); assert.equal(fresh.commit({ ok: true }).committed, true);
  // new match / loading / undo: invalidate drops values and stales every ticket
  const inflight = st.ticket('A', 'c1'); st.invalidate();
  assert.equal(inflight.commit({ stale: true }).committed, false); assert.equal(st.size, 0); assert.equal(st.ticket('A', 'c1').value, undefined);
  // another match instance is a separate store
  const other = new CoachContextStore(); assert.notEqual(other.instance, st.instance); other.ticket('A', 'c1').commit({ x: 1 }); assert.equal(st.peek('A', 'c1'), undefined);
});

test('coach context through the host: round trip over setup, actions and decisions; invalid/oversized/stale never reject a legal answer', async () => {
  const st = new CoachContextStore();
  const body = `chooseSetup(o,r){return {positions:r.defaultPositions,coachContext:{n:((o.coachContext&&o.coachContext.n)||0)+1,seen:o.coachContext===undefined?'none':'some'}};},
    chooseAction(o,c){return {endTurn:true,coachContext:{n:((o.coachContext&&o.coachContext.n)||0)+1}};}`;
  const e = entry(body);
  const s = setupState('standard');
  const r1 = await run(s, 'A', e, { context: st.ticket('A', 'fx') });
  assert.equal(r1.meta.context?.committed, true); assert.deepEqual(st.peek('A', 'fx'), { n: 1, seen: 'none' });
  const r2 = await run(s, 'A', e, { context: st.ticket('A', 'fx') });
  assert.deepEqual(st.peek('A', 'fx'), { n: 2, seen: 'some' }); assert.equal(r2.meta.setup?.accepted, true);
  // the context survives a normal action (a play-phase request of the same coach)
  const play = match('standard'); play.phase = 'play';
  const act = await run(play, 'A', e, { context: st.ticket('A', 'fx') });
  assert.equal(act.meta.fellBack, false); assert.deepEqual(st.peek('A', 'fx'), { n: 3 });
  // a module that returns nothing keeps the old context; an oversized or invalid one is ignored but the legal answer stands
  const keep = await run(play, 'A', entry(`chooseAction(o,c){return {endTurn:true};}`), { context: st.ticket('A', 'fx') });
  assert.equal(keep.meta.fellBack, false); assert.deepEqual(st.peek('A', 'fx'), { n: 3 }); assert.equal(keep.meta.context?.committed, false);
  const big = await run(play, 'A', entry(`chooseAction(o,c){return {endTurn:true,coachContext:{s:'x'.repeat(9000)}};}`), { context: st.ticket('A', 'fx') });
  assert.equal(big.meta.fellBack, false); assert.equal(big.move?.type, 'action'); assert.deepEqual(st.peek('A', 'fx'), { n: 3 }); assert.match(big.meta.context?.ignored ?? '', /over/);
  // an illegal answer is not committed
  const illegal = await run(play, 'A', entry(`chooseAction(o,c){return {candidateId:99999,coachContext:{poison:1}};}`), { context: st.ticket('A', 'fx') });
  assert.equal(illegal.meta.fellBack, true); assert.deepEqual(st.peek('A', 'fx'), { n: 3 });
  // cancelled / replaced mid-request: no move, nothing committed
  const tk = st.ticket('A', 'fx'); let cancel = false;
  const t0 = Date.now();
  const p = run(play, 'A', entry(`async chooseAction(o,c){await new Promise(r=>setTimeout(r,3000));return {endTurn:true,coachContext:{late:1}};}`, 10000), { context: tk, stale: () => cancel });
  setTimeout(() => { cancel = true; }, 400);
  const late = await p;
  assert.equal(late.move, null); assert.ok(Date.now() - t0 < 2500, 'cancellation is prompt'); assert.deepEqual(st.peek('A', 'fx'), { n: 3 });
  const tk2 = st.ticket('A', 'fx'); const p2 = run(play, 'A', entry(`async chooseAction(o,c){await new Promise(r=>setTimeout(r,1200));return {endTurn:true,coachContext:{late:2}};}`, 10000), { context: tk2 });
  setTimeout(() => st.invalidate(), 300);
  assert.equal((await p2).move, null); assert.equal(st.peek('A', 'fx'), undefined, 'state replacement / undo invalidated the context');
});

test('capabilities and public resources: hostExtensions only where supported; wizardAvailable from real resources; no dice internals', async () => {
  const none = setupState('standard');
  assert.equal(wizardAvailable(none), undefined, 'no inducement bookkeeping: unknown (missing)');
  const w = setupState('standard', undefined, { wizardA: true });
  assert.deepEqual(wizardAvailable(w), { A: true, B: false });
  const both = setupState('standard', undefined, { wizardA: true, wizardB: true });
  assert.deepEqual(wizardAvailable(both), { A: true, B: true });
  // not false merely because casting is outside its legal timing window (mid-Turn, an activation open)
  const mid = Engine.cloneState(w); mid.phase = 'play'; mid.turn.active = 'B';
  assert.deepEqual(wizardAvailable(mid), { A: true, B: false });
  // spent: only then false
  const spent = Engine.cloneState(w); spent.teams.A.induceUsed = { wizard: 1 };
  assert.deepEqual(wizardAvailable(spent), { A: false, B: false });
  // what a module receives (set-up and action requests) — captured through a module that returns what it saw as its context
  const seen = await run(w, 'A', entry(`chooseSetup(o,r){return {positions:r.defaultPositions,coachContext:{hx:o.hostExtensions,sp:o.strategicPublic,keys:Object.keys(o)}};}`), { context: new CoachContextStore().ticket('A', 'fx') });
  assert.equal(seen.meta.setup?.accepted, true);
  const st = new CoachContextStore(); await run(w, 'A', entry(`chooseSetup(o,r){return {positions:r.defaultPositions,coachContext:{hx:o.hostExtensions,sp:o.strategicPublic,keys:Object.keys(o)}};}`), { context: st.ticket('A', 'fx') });
  const got = st.peek('A', 'fx') as any;
  assert.deepEqual(got.hx, { setup: true, coachContext: true }); assert.deepEqual(got.sp, { wizardAvailable: { A: true, B: false } });
  assert.ok(!JSON.stringify(got).match(/rng|seed|counter/i));
  // advice-only requests do not claim the extensions
  const adv = setupState('standard'); void adv;
  const play = match('standard', { wizardB: true }); play.phase = 'play';
  const st2 = new CoachContextStore();
  await run(play, 'A', entry(`chooseAction(o,c){return {endTurn:true,coachContext:{hx:o.hostExtensions||null,sp:o.strategicPublic||null}};}`), { context: st2.ticket('A', 'fx') });
  assert.deepEqual((st2.peek('A', 'fx') as any).sp, { wizardAvailable: { A: false, B: true } });
  // without a store (e.g. advice) the context capability is not advertised; setup: advisory requests carry no host block
  const st3 = new CoachContextStore();
  await run(play, 'A', entry(`chooseAction(o,c){return {endTurn:true,coachContext:{hx:o.hostExtensions||null}};}`), { context: st3.ticket('A', 'fx'), advisory: true });
  assert.equal(st3.peek('A', 'fx'), undefined, 'advisory requests never commit context');
  assert.equal(JSON.stringify(observe(play, 'A', 1)).includes('wizardAvailable'), false, 'the plain observation stays as it was');
});

test('declared deadline: a 7.5 s calculation under a 60 s declaration is not cut off by any shorter timer; cancellation is prompt', async () => {
  const play = match('standard'); play.phase = 'play';
  const t0 = Date.now();
  const r = await run(play, 'A', entry(`async chooseAction(o,c){await new Promise(r=>setTimeout(r,7500));return {endTurn:true,why:'slow but legal'};}`, 60000));
  const took = Date.now() - t0;
  assert.equal(r.meta.fellBack, false, r.meta.reason ?? ''); assert.equal(r.move?.type, 'action'); assert.ok(took >= 7400 && took < 12000, String(took));
  assert.equal(r.meta.allowanceMs, 60000);
  // with only a 2 s declaration the same module IS stopped (and falls back) — the limit is the coach's own
  const t1 = Date.now();
  const r2 = await run(play, 'A', entry(`async chooseAction(o,c){await new Promise(r=>setTimeout(r,6000));return {endTurn:true};}`, 2000));
  assert.equal(r2.meta.fellBack, true); assert.ok(Date.now() - t1 < 4500); assert.ok(r2.meta.diagnostics.some((d) => d.code === 'timeout'));
});

test('decision-time ceiling is 120 s: a coach may declare up to it, anything above is clamped, and the allowance is reported (a limit, never a delay)', async () => {
  const play = match('standard'); play.phase = 'play';
  const quick = `async chooseAction(o,c){return {endTurn:true,why:'immediate'};}`;
  const at120 = await run(play, 'A', entry(quick, 120000));
  assert.equal(at120.meta.fellBack, false, at120.meta.reason ?? ''); assert.equal(at120.meta.allowanceMs, 120000);
  const over = await run(play, 'A', entry(quick, 300000));
  assert.equal(over.meta.allowanceMs, 120000, 'a declaration above the ceiling is clamped to 120 s');
  const old = await run(play, 'A', entry(quick, 60000));
  assert.equal(old.meta.allowanceMs, 60000, 'coaches that declare 60 s keep exactly 60 s');
});

test('batch runner: full matches with a module on both sides — setup used, context isolated per match/team, no fallback, completion', async () => {
  const code = `bloodboard.register({id:'fx',name:'fx',apiVersion:1,apiMinor:2,timeLimitMs:60000,
    chooseSetup(o,r){const m={};for(const [id,c] of Object.entries(r.defaultPositions)) m[id]=c?{x:c.x,y:r.pitch.h-1-c.y}:null;return {positions:m,why:'mirrored',coachContext:{n:((o.coachContext&&o.coachContext.n)||0)+1,team:o.team,fmt:o.format}};},
    chooseAction(o,c){const cc=o.coachContext||{};if(cc.team&&cc.team!==o.team)throw new Error('LEAK '+cc.team+' vs '+o.team);return {endTurn:true,why:'fixture',coachContext:{n:(cc.n||0)+1,team:o.team,fmt:o.format}};},
    chooseDecision(o,req){const cc=o.coachContext||{};if(cc.team&&cc.team!==o.team)throw new Error('LEAK');return {optionId:req.options[0].id,coachContext:{n:(cc.n||0)+1,team:o.team,fmt:o.format}};}});`;
  const spec = { label: 'Fixture', kind: 'module' as const, id: 'fx', version: '1', code, timeLimitMs: 60000, apiMinor: 2 };
  const out = await Promise.all([1, 2].map(async (seed) => {
    const lines: any[] = [];
    const res = await playMatch({ game: `g${seed}`, seed, format: 'sevens', mode: 'tournament', rosters: { A: 'human', B: 'orc' }, coaches: { A: spec, B: spec }, observations: 'none', rules: 'introductory', maxSteps: 3000 } as never, { trajectory: (l) => lines.push(l), internal: () => undefined, result: () => undefined });
    return { res, lines };
  }));
  for (const { res, lines } of out) {
    assert.ok(['A', 'B', 'draw'].includes(res.winner));
    for (const t of ['A', 'B'] as const) {
      assert.ok(res.hostUse![t].setupAsked >= 2, 'set-up offered at least once per Drive');
      assert.equal(res.hostUse![t].setupAccepted, res.hostUse![t].setupAsked, 'every mirrored formation was accepted');
      assert.equal(res.hostUse![t].setupFallback, 0);
      assert.ok(res.hostUse![t].contextCommitted > res.hostUse![t].setupAsked);
      assert.equal(res.fallbacks[t], 0, JSON.stringify(res.incidents));
    }
    const setups = lines.filter((l) => l.kind === 'setup');
    assert.ok(setups.length >= 4 && setups.every((l) => l.source.via === 'setup' && l.host.setup.accepted && l.host.hostExtensions.setup));
    // counters per team run 1,2,3,… independently: the side that sets up second never inherited the other's counter
    for (const t of ['A', 'B']) { const ns = lines.filter((l) => l.team === t && l.host?.context?.committed).map((l) => l.host.context.supplied); assert.ok(ns[0] === null); }
  }
});
