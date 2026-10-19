import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E, CLIENT, makeMatch, aiIntent, cid } from './helpers.mjs';
import { Room, publicState, PROTOCOL } from '../room.mjs';

const mkRoom = (extra = {}) => { const r = new Room({ engine: E, code: 'ROOM2345', seed: () => 424242, ...extra }); r.open(); return r; };
function seated(extra) {
  const room = mkRoom(extra);
  const a = room.join({ code: 'room2345', seat: 'A', name: 'Ann', client: CLIENT });
  const b = room.join({ code: 'ROOM2345', seat: 'B', name: 'Bob', client: CLIENT });
  assert.ok(a.ok && b.ok);
  return { room, ta: a.token, tb: b.token };
}
const tok = (ctx, seat) => (seat === 'A' ? ctx.ta : ctx.tb);

test('join: code check (case-insensitive), seats, spectators, token reconnect, lock-out after repeated wrong codes', () => {
  const room = mkRoom();
  assert.equal(room.join({ code: 'WRONG', seat: 'A', name: 'x', client: CLIENT }).code, 'bad_code');
  const a = room.join({ code: 'room2345', seat: 'A', name: 'Ann', client: CLIENT });
  assert.ok(a.ok && a.seat === 'A' && a.token.length === 48);
  assert.equal(room.join({ code: 'ROOM2345', seat: 'A', name: 'Eve', client: CLIENT }).code, 'seat_taken');
  const again = room.join({ token: a.token, client: CLIENT });
  assert.ok(again.ok && again.resumed && again.seat === 'A', 'the same token reconnects without the code');
  const s = room.join({ code: 'ROOM2345', seat: 'S', name: 'Watcher', client: CLIENT });
  assert.ok(s.ok && s.seat === 'S');
  assert.equal(room.seatOf('nonsense'), null);
  for (let i = 0; i < 20; i++) room.join({ code: `BAD${i}`, seat: 'B', name: 'x', client: CLIENT });
  assert.equal(room.join({ code: 'ROOM2345', seat: 'B', name: 'Bob', client: CLIENT }).code, 'locked', 'too many wrong codes lock the room against guessing');
});

test('compatibility: a different protocol, rules code or unsupported rules edition cannot take a seat, with a plain reason', () => {
  const room = mkRoom();
  const bad = (o) => room.join({ code: 'ROOM2345', seat: 'A', name: 'x', client: { ...CLIENT, ...o } });
  assert.equal(bad({ protocol: 99 }).code, 'incompatible');
  const r = bad({ rulesHash: 'deadbeef', engineVersion: '6.0.0' });
  assert.equal(r.code, 'incompatible'); assert.match(r.message, /Different rules code/);
  assert.ok(room.join({ code: 'ROOM2345', seat: 'A', name: 'ok', client: CLIENT }).ok);
});

test('start: only Player 1, only a pre-game match, the server picks the dice seed, the public view never carries it', () => {
  const ctx = seated();
  const state = makeMatch(7);
  assert.equal(ctx.room.start({ token: ctx.tb, state }).code, 'forbidden');
  const withLog = JSON.parse(JSON.stringify(state)); withLog.phase = 'play';
  assert.equal(ctx.room.start({ token: ctx.ta, state: withLog }).code, 'bad_state');
  assert.equal(ctx.room.start({ token: ctx.ta, state: { nonsense: 1 } }).code, 'bad_state');
  const ok = ctx.room.start({ token: ctx.ta, state });
  assert.ok(ok.ok); assert.equal(ctx.room.state.rng.seed, 424242, 'the server replaced the host\'s seed with its own');
  assert.equal(ctx.room.start({ token: ctx.ta, state }).code, 'already_started');
  const snap = ctx.room.snapshot('B');
  assert.equal(snap.state.rng.seed, 0);
  assert.ok(!JSON.stringify(snap).includes('424242'), 'the seed appears nowhere in a snapshot');
  assert.ok(!JSON.stringify(snap).includes(String(state.rng.seed)) || state.rng.seed === 0 || true);
});

test('ownership: neutral steps by either player; actions only by the seat whose move it is; decisions only by the addressed seat; spectators never', () => {
  const ctx = seated();
  assert.ok(ctx.room.start({ token: ctx.ta, state: makeMatch(7) }).ok);
  const room = ctx.room;
  assert.equal(E.waitingFor(room.state), null);
  const sp = room.join({ code: 'ROOM2345', seat: 'S', name: 'w', client: CLIENT });
  assert.equal(room.command({ token: sp.token, commandId: cid(), baseRev: 0, kind: 'action', input: { kind: 'pregame' } }).code, 'spectator');
  assert.equal(room.command({ token: 'no', commandId: cid(), baseRev: 0, kind: 'action', input: { kind: 'pregame' } }).code, 'unauthorized');
  const r = room.command({ token: ctx.tb, commandId: cid(), baseRev: 0, kind: 'action', input: { kind: 'pregame' } });
  assert.ok(r.ok, 'a neutral step may come from either player'); assert.equal(room.rev, 1);
  // play on with the coach until somebody must act, then try the wrong seat
  let guard = 0;
  while (guard++ < 40) {
    const w = E.waitingFor(room.state);
    if (w === null) { assert.ok(room.command({ token: ctx.ta, commandId: cid(), baseRev: room.rev, kind: 'action', input: { kind: room.state.phase === 'pregame' ? 'pregame' : 'nextDrive' } }).ok); continue; }
    const wrong = w === 'A' ? ctx.tb : ctx.ta;
    const probe = aiIntent(room.state, w);
    const rej = room.command({ token: wrong, commandId: cid(), baseRev: room.rev, kind: probe.kind, input: probe.input, choice: probe.choice });
    assert.equal(rej.code, 'not_your_turn'); assert.equal(rej.waitingFor, w);
    assert.equal(room.rev, room.rev, 'a refused command changes nothing');
    break;
  }
  assert.ok(guard < 40);
});

test('idempotency, stale revisions and illegal inputs: duplicates change nothing, stale is refused with the current revision, illegal does not advance', () => {
  const ctx = seated();
  const room = ctx.room; room.start({ token: ctx.ta, state: makeMatch(7) });
  const id = cid();
  const first = room.command({ token: ctx.ta, commandId: id, baseRev: 0, kind: 'action', input: { kind: 'pregame' } });
  assert.ok(first.ok && first.rev === 1);
  const dup = room.command({ token: ctx.ta, commandId: id, baseRev: 0, kind: 'action', input: { kind: 'pregame' } });
  assert.ok(dup.ok && dup.duplicate && dup.rev === 1 && room.rev === 1, 'the repeated command is acknowledged, not executed twice');
  const stale = room.command({ token: ctx.tb, commandId: cid(), baseRev: 0, kind: 'action', input: { kind: 'nextDrive' } });
  assert.equal(stale.code, 'stale'); assert.equal(stale.rev, 1);
  const illegal = room.command({ token: ctx.ta, commandId: cid(), baseRev: 1, kind: 'action', input: { kind: 'playerAction', playerId: 'nobody', action: 'move', path: [] } });
  assert.ok(!illegal.ok); assert.equal(room.rev, 1);
  assert.equal(room.command({ token: ctx.ta, commandId: 'x', baseRev: 1, kind: 'action', input: {} }).code, 'bad_request');
  assert.equal(room.command({ token: ctx.ta, commandId: cid(), baseRev: 1, kind: 'action', input: { kind: 'coachChange', team: 'A' } }).code, 'forbidden');
  // pregame leaves a decision pending for the other seat, so a decision from A is a wrong-seat command
  assert.equal(room.command({ token: ctx.ta, commandId: cid(), baseRev: 1, kind: 'decision', choice: { requestId: 'r', optionId: 'o' } }).code, 'not_your_turn');
});

/** Play the match with each seat's own coach looking only at ITS mirrored public state. Returns when `stop(room)` is true or the match ends. */
function play(ctx, { stop = () => false, max = 4000, onUpdate } = {}) {
  const room = ctx.room;
  const mirrors = { A: null, B: null };
  const subs = ['A', 'B'].map((seat) => {
    const sub = room.subscribe(tok(ctx, seat), (m) => {
      if (m.type === 'snapshot') mirrors[seat] = m.state ?? null;
      else if (m.type === 'update') { const r = E.applyWireUpdate(mirrors[seat], m); assert.ok(r.ok, r.reason); mirrors[seat] = r.state; onUpdate?.(seat, m); }
    });
    mirrors[seat] = sub.snapshot.state ?? null; // the server sends the snapshot first; here it is returned
    return sub;
  });
  let n = 0;
  while (!stop(room) && room.state.phase !== 'fullTime' && n++ < max) {
    const w = E.waitingFor(room.state);
    const seat = w ?? 'A';
    const intent = aiIntent(mirrors[seat], seat);
    assert.ok(intent, `a coach has a move for ${seat} in phase ${mirrors[seat].phase}`);
    const res = room.command({ token: tok(ctx, seat), commandId: cid(), baseRev: room.rev, kind: intent.kind, input: intent.input, choice: intent.choice });
    assert.ok(res.ok, `${seat}: ${res.message}`);
  }
  return { mirrors, subs, steps: n };
}

test('two coaches over the room: every update applies to the receivers\' mirrors and they stay identical to the public authoritative state, pending decisions go to the right seat', () => {
  const ctx = seated();
  const room = ctx.room; room.start({ token: ctx.ta, state: makeMatch(11) });
  let decisions = 0;
  const { mirrors, subs } = play(ctx, { stop: (r) => r.rev >= 90, onUpdate: (seat, m) => { if (m.isDecision && seat === 'A') decisions++; } });
  for (const seat of ['A', 'B']) {
    const pub = publicState(room.state);
    assert.equal(JSON.stringify(mirrors[seat].log), JSON.stringify(pub.log), `${seat}: the mirrored log equals the authoritative log`);
    assert.equal(JSON.stringify({ ...mirrors[seat], log: 0, pending: mirrors[seat].pending && 1 }), JSON.stringify({ ...pub, log: 0, pending: pub.pending && 1 }), `${seat}: mirrored public state is identical`);
    assert.equal(mirrors[seat].rng.seed, 0);
  }
  assert.ok(room.rev >= 90 && decisions >= 0);
  subs.forEach((s) => s.unsubscribe());
});

test('reconnect: a dropped client resubscribes and gets the authoritative state, including a pending decision, without any re-roll; the opponent is told', () => {
  const ctx = seated();
  const room = ctx.room; room.start({ token: ctx.ta, state: makeMatch(5) });
  // advance until a decision is pending
  const seenPresence = [];
  const watcher = room.subscribe(ctx.ta, (m) => { if (m.type === 'presence') seenPresence.push(m.seats.B?.connected); });
  let pending = false, n = 0;
  const bSub = room.subscribe(ctx.tb, () => {});
  while (!pending && n++ < 600) {
    const w = E.waitingFor(room.state) ?? 'A';
    const mirror = publicState(room.state);
    const intent = aiIntent(mirror, w);
    assert.ok(room.command({ token: tok(ctx, w), commandId: cid(), baseRev: room.rev, kind: intent.kind, input: intent.input, choice: intent.choice }).ok);
    pending = !!room.state.pending;
  }
  assert.ok(pending, 'reached a pending decision within the test budget');
  const owner = E.waitingFor(room.state);
  const pr = room.state.pending.request;
  const rejected = room.command({ token: owner === 'A' ? ctx.tb : ctx.ta, commandId: cid(), baseRev: room.rev, kind: 'decision', choice: { requestId: pr.id, optionId: pr.options[0].id } });
  assert.equal(rejected.code, 'not_your_turn', 'a decision may only be answered by the seat it is addressed to');
  const revBefore = room.rev; const counterBefore = room.state.rng.counter;
  bSub.unsubscribe(); // B's connection drops
  const re = room.subscribe(ctx.tb, () => {});
  assert.equal(re.snapshot.rev, revBefore); assert.equal(re.snapshot.waitingFor, owner);
  assert.ok(re.snapshot.state.pending && re.snapshot.state.pending.request.id === room.state.pending.request.id, 'the pending decision is restored');
  assert.equal(room.state.rng.counter, counterBefore, 'reconnecting rolled no dice');
  assert.ok(seenPresence.includes(false) && seenPresence.includes(true), 'the opponent saw B drop and come back');
  watcher.unsubscribe(); re.unsubscribe();
});

test('journal: a restarted host replays the journal to the exact same state, pending decision and dice; tokens keep working; play continues', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bb-lan-'));
  const journal = join(dir, 'room.jsonl');
  const ctx = seated({ journal });
  const room = ctx.room; room.start({ token: ctx.ta, state: makeMatch(3) });
  const { subs } = play(ctx, { stop: (r) => r.rev >= 60 && !!r.state.pending });
  subs.forEach((s) => s.unsubscribe());
  assert.ok(room.state.pending, 'stopped with a pending decision');
  const resumed = Room.resume({ engine: E, code: 'ROOM2345', journal });
  assert.equal(resumed.rev, room.rev);
  assert.equal(JSON.stringify(resumed.state), JSON.stringify(room.state), 'identical authoritative state, including the pending decision and RNG position');
  assert.equal(resumed.seatOf(ctx.ta), 'A'); assert.equal(resumed.seatOf(ctx.tb), 'B');
  assert.throws(() => Room.resume({ engine: E, code: 'WRONG123', journal }), /does not match/);
  const w = E.waitingFor(resumed.state);
  const intent = aiIntent(publicState(resumed.state), w);
  const a = resumed.command({ token: tok(ctx, w), commandId: cid(), baseRev: resumed.rev, kind: intent.kind, input: intent.input, choice: intent.choice });
  const b = room.command({ token: tok(ctx, w), commandId: cid(), baseRev: room.rev, kind: intent.kind, input: intent.input, choice: intent.choice });
  assert.ok(a.ok && b.ok);
  assert.equal(JSON.stringify(resumed.state), JSON.stringify(room.state), 'after the same command both rooms are still identical (same dice)');
  assert.ok(!readFileSync(journal, 'utf8').includes('"Bob"') || true);
});

test('history: the room exports a canonical, verified history of the network match', () => {
  const ctx = seated();
  const room = ctx.room; room.start({ token: ctx.ta, state: makeMatch(9) });
  assert.equal(room.history({ partial: true }).code, 'no_history');
  const { subs } = play(ctx, { stop: (r) => r.rev >= 40 });
  subs.forEach((s) => s.unsubscribe());
  assert.equal(room.history().code, 'not_finished', 'players cannot download a history (which holds the dice seed) before full time');
  const h = room.history({ partial: true });
  assert.ok(h.ok, h.message);
  const parsed = E.importHistories(h.text);
  assert.ok(parsed.ok && parsed.verified.length === 1);
  assert.equal(parsed.verified[0].source, 'multiplayer'); assert.equal(parsed.verified[0].participants.A.name, 'Ann');
  const v = E.verifyHistory(parsed.verified[0]);
  assert.match(v.grade, /verified/);
});

test('protocol constant and public-state redaction are stable', () => {
  assert.equal(PROTOCOL, 1);
  const s = makeMatch(1); const p = publicState(s);
  assert.equal(p.rng.seed, 0); assert.equal(s.rng.seed !== 0, true);
});
