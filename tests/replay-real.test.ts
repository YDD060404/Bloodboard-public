/**
 * V6 Replay against the REAL user match files kept in tests/fixtures/real-matches (7 team-folder matches + 3 game-history files).
 * Each must be graded replayable(-after-migration) and reproduce every recorded input, decision, event and die.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assessReplay, parseSaveFile } from '../src/engine/index';

const root = 'tests/fixtures/real-matches';
for (const dir of ['teams', 'gamehistory']) {
  for (const f of readdirSync(`${root}/${dir}`).filter((x) => x.endsWith('.json'))) {
    test(`Replay of real file ${dir}/${f}: reproduced dice-for-dice`, () => {
      const p = parseSaveFile(readFileSync(`${root}/${dir}/${f}`, 'utf8'));
      assert.ok(p.ok, 'parses');
      if (!p.ok) return;
      const a = assessReplay(p.save.state, p.save.meta?.initial as never);
      assert.match(a.assessment.grade, /^replayable/, `${a.assessment.grade}: ${a.assessment.reason} ${a.assessment.firstMismatch ?? ''}`);
    });
  }
}
