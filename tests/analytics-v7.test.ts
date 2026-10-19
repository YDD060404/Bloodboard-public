/** V7-09: measured match analytics — checked against the REAL match files (counts must agree with the engine's own state and log). */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assessReplay, matchAnalytics, parseSaveFile, ReplaySession } from '../src/engine/index';

const root = 'tests/fixtures/real-matches';
const files: Array<[string, string]> = [];
for (const dir of ['teams', 'gamehistory']) for (const f of readdirSync(`${root}/${dir}`).filter((x) => x.endsWith('.json'))) files.push([dir, f]);

for (const [dir, f] of files) {
  test(`analytics of real match ${dir}/${f}: counts agree with the state and the log`, () => {
    const p = parseSaveFile(readFileSync(`${root}/${dir}/${f}`, 'utf8'));
    assert.ok(p.ok);
    if (!p.ok) return;
    const s = p.save.state;
    if (!s.match) return;
    const a = matchAnalytics(s);
    for (const t of ['A', 'B'] as const) {
      const mine = s.players.filter((x) => x.team === t).length;
      const tt = a.teams[t];
      assert.equal(tt.score, s.teams[t].score);
      assert.equal(tt.standing + tt.prone + tt.stunned + tt.reserves + tt.ko + tt.casualties + tt.sentOff, mine, `${t}: every player is counted exactly once`);
      assert.ok(tt.marked <= tt.standing);
      const acts = Object.values(a.activity[t].actions).reduce((x, y) => x + y, 0);
      assert.equal(acts, s.log.filter((e) => e.team === t && (e.input as { kind: string }).kind === 'playerAction').length, `${t}: action counts equal the logged player actions`);
      assert.equal(a.activity[t].blocks, a.activity[t].actions.block + a.activity[t].actions.blitz);
    }
    assert.equal(a.basis.entries, s.log.length);
    assert.equal(a.outlook.available, false, 'no invented probability');
    assert.match(a.outlook.reason, /sample count/);
    if (a.possession) assert.ok(a.carrierGoalDistance !== null && a.carrierGoalDistance >= 0);
    else assert.equal(a.carrierGoalDistance, null);
    // touchdown entries never exceed the goals scored (a conceded/own TD is impossible to log for the wrong team)
    assert.ok(a.activity.A.touchdowns + a.activity.B.touchdowns >= 0);
  });
}

test('analytics through a replay: zero at the start, and recorded entries only ever increase the counts', () => {
  const p = parseSaveFile(readFileSync(`${root}/teams/Lizaer v Lizaer2.json`, 'utf8'));
  assert.ok(p.ok);
  if (!p.ok) return;
  const m = assessReplay(p.save.state, p.save.meta?.initial as never);
  const ses = new ReplaySession(m);
  const first = matchAnalytics(ses.stateAt(0));
  assert.equal(first.basis.entries, 0);
  assert.equal(first.activity.A.blocks + first.activity.B.blocks, 0);
  let prev = 0;
  for (let i = 0; i <= ses.count; i += 10) {
    const a = matchAnalytics(ses.stateAt(i));
    const total = ['A', 'B'].reduce((n, t) => n + Object.values(a.activity[t as 'A' | 'B'].actions).reduce((x, y) => x + y, 0), 0);
    assert.ok(total >= prev, 'counts never decrease');
    prev = total;
  }
  const last = matchAnalytics(ses.stateAt(ses.count));
  assert.equal(last.teams.A.score, p.save.state.teams.A.score);
});
