/**
 * V7-06: canonical history format. Uses the REAL match files in tests/fixtures/real-matches: every real match converts to a history,
 * verifies by re-execution, round-trips through text, and tampering is detected.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assessReplay, ReplaySession, importHistories, parseHistory, parseSaveFile, serializeHistory, toBatch, toHistory, verifyHistory, type HistoryFile } from '../src/engine/index';

const root = 'tests/fixtures/real-matches';
const files: Array<[string, string]> = [];
for (const dir of ['teams', 'gamehistory']) for (const f of readdirSync(`${root}/${dir}`).filter((x) => x.endsWith('.json'))) files.push([dir, f]);
const load = (dir: string, f: string) => { const p = parseSaveFile(readFileSync(`${root}/${dir}/${f}`, 'utf8')); assert.ok(p.ok); return p.ok ? p.save : (null as never); };
const histories: HistoryFile[] = [];

for (const [dir, f] of files) {
  test(`history from real file ${dir}/${f}: written, serialized, parsed and re-verified`, () => {
    const save = load(dir, f);
    const r = toHistory(save.state, { source: 'game', initial: save.meta?.initial as never, createdAt: '2026-10-04T00:00:00.000Z' });
    if (!r.ok) { assert.match(r.error, /practice|no recorded/, r.error); return; }
    assert.equal(r.history.rulesEdition, save.state.rulesEdition ?? 'legacy');
    const parsed = parseHistory(serializeHistory(r.history));
    assert.ok(parsed.ok);
    if (!parsed.ok) return;
    const v = verifyHistory(parsed.history);
    assert.match(v.grade, /^verified/, v.reason);
    histories.push(parsed.history);
  });
}

test('the real files are legacy matches (no rules edition) and stay legacy in the history', () => {
  assert.ok(histories.length > 0);
  assert.ok(histories.every((h) => h.rulesEdition === 'legacy'), 'old matches are never silently upgraded');
});

test('tampering is detected: a changed die, a changed result, a changed edition, a changed id', () => {
  const h = histories[0];
  const dice = JSON.parse(JSON.stringify(h)) as HistoryFile;
  const ev = dice.log.flatMap((e) => e.events).find((e) => /\d/.test(e.text));
  assert.ok(ev);
  ev!.text = ev!.text.replace(/\d/, (d) => String((Number(d) % 6) + 1));
  assert.equal(verifyHistory(dice).grade, 'refused');
  const res = JSON.parse(JSON.stringify(h)) as HistoryFile; res.result.score.A += 1;
  assert.match(verifyHistory(res).reason, /result/);
  const ed = JSON.parse(JSON.stringify(h)) as HistoryFile; ed.rulesEdition = 'faq2026';
  assert.equal(verifyHistory(ed).grade, 'refused');
  const unk = JSON.parse(JSON.stringify(h)) as HistoryFile; unk.rulesEdition = 'faq2031';
  assert.match(verifyHistory(unk).reason, /Unsupported rules edition/);
  const id = JSON.parse(JSON.stringify(h)) as HistoryFile; id.id = 'h-x';
  assert.match(verifyHistory(id).reason, /id does not match/);
});

test('a newer format version and a wrong format are refused explicitly', () => {
  const h = JSON.parse(JSON.stringify(histories[0]));
  h.version = 2;
  const p = parseHistory(JSON.stringify(h));
  assert.equal(p.ok, false);
  if (!p.ok) assert.match(p.errors.join(), /newer than this build/);
  assert.equal(parseHistory('{"format":"other"}').ok, false);
  assert.equal(parseHistory('nope').ok, false);
});

test('batch: every game verified independently; one bad game does not hide the good ones', () => {
  const bad = JSON.parse(JSON.stringify(histories[0])) as HistoryFile; bad.result.score.B += 3;
  const batch = toBatch([histories[0], bad, ...histories.slice(1, 3)], 'test batch');
  const r = importHistories(JSON.stringify(batch));
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.reports.length, batch.games.length);
  assert.equal(r.reports[1].grade, 'refused');
  assert.ok(r.reports.filter((x) => x.grade !== 'refused').length === batch.games.length - 1);
  assert.equal(r.verified.length, batch.games.length - 1);
  const single = importHistories(JSON.stringify(histories[0]));
  assert.ok(single.ok && single.reports.length === 1);
});

test('a practice position or an empty match cannot be exported', () => {
  const save = load(...files[0]);
  const practice = JSON.parse(JSON.stringify(save.state)); delete practice.match;
  const r = toHistory(practice, { source: 'game' });
  assert.equal(r.ok, false);
});

test('V7-08: ReplaySession.eventsFor returns the engine events WITH board snapshots, never changes the cursor or the recorded state', () => {
  const save = load(...files[0]);
  const m = assessReplay(save.state, save.meta?.initial as never);
  const session = new ReplaySession(m);
  const logBefore = JSON.stringify(m.log);
  const at = session.stateAt(20);
  const cur = session.index;
  let withSnaps = 0, total = 0;
  for (let i = 15; i < 40; i++) { const ev = session.eventsFor(i); total++; if (ev && ev.some((e) => e.snap)) withSnaps++; assert.equal(session.index, cur, 'cursor untouched'); }
  assert.ok(withSnaps > 10, `${withSnaps}/${total} entries produced snapshot events`);
  assert.equal(JSON.stringify(session.stateAt(20)), JSON.stringify(at), 'state at 20 unchanged');
  assert.equal(JSON.stringify(m.log), logBefore, 'recorded log untouched');
  assert.equal(session.eventsFor(-1), null);
  assert.equal(session.eventsFor(session.count), null);
});
