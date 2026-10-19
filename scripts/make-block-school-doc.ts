/**
 * docs/BLOCK_SCHOOL.md — generated from the course data and the rules engine.
 * Run by scripts/build.mjs.
 */
import { EXERCISES, LEVELS, BLOCK_SCHOOL_SOURCE } from '../src/courses/blockSchool';
import { TUTORIALS } from '../src/courses/basics';
import { checkExercise, parseWorkbookAnswer, solveExercise } from '../src/engine/index';

declare const process: { argv: string[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function require(m: string): any;
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2] ?? '.';

const KIND: Record<string, string> = {
  count: 'Count the dice: choose 3D / 2D / 1D / −2D / −3D',
  moveOne: 'Move a player exactly one square: click the player, then the square',
  normalMove: 'Make one normal Move (empty squares, no Rushing; staying put counts): click the square',
  blockFirst: 'Choose which opponent to Block first: click it',
  whoBlocks: 'Choose which X player makes the first Block: click it',
  pushSquare: 'Choose the push square: click one of the highlighted squares',
};

let md = `# Block School

The **Block School** course turns the exercises of *BB School of Block – English* into playable lessons.

- Source: ${BLOCK_SCHOOL_SOURCE}
- The workbook is an unofficial training aid. **The rulebook is authoritative**: every answer and explanation shown in the app is computed by the rules engine (Block Strength and assists p.60-61, Guard p.129, push-backs p.62), never copied from the workbook. Instructions printed inside the workbook were treated as workbook content only.
- Positions: \`src/courses/blockSchoolData.json\` (imported by \`scripts/workbook/import_block_school.py\` from the workbook text), course metadata \`src/courses/blockSchool.ts\`, engine checks \`src/engine/teaching.ts\`, tests \`tests/teaching.test.ts\`.

## How an exercise is played

1. **Learn ▸ Block School**, pick a level and an exercise. The board shows only the workbook grid, with the workbook's column letters and row numbers, in the middle of the pitch (no sidelines or End Zones nearby). X players are Team A (blue), Y players Team B (red); Guard players carry a **G** badge.
2. Answer on the board (see the table below). The engine checks the answer, explains it helper by helper (“X3 — no assist: Marked by Y2”), and rings each player green (assists) or red (cannot assist).
3. **Hints** can be opened one at a time; the **solution** becomes available after the first attempt and lists every correct answer found by trying every legal choice, the workbook's answer with its page, and any difference between the two.
4. **Retry** clears the answer; **Play it out with dice** plays the same position with Plan → Review → Confirm and real, seeded dice (Reset returns to the exercise with the same dice; New seed changes them).
5. Progress (solved / attempted) is saved on this computer (the \`Progress\` folder in the Mac app, browser storage otherwise).

## Coverage

All **${EXERCISES.length}** exercises of Levels 1-7 are playable; none had to be left out.

| Level | Title | Exercises | Question type | Workbook pages |
|---|---|---|---|---|
`;
for (const l of LEVELS) {
  const ex = EXERCISES.filter((e) => e.level === l.level);
  const kinds = [...new Set(ex.map((e) => e.kind))];
  md += `| ${l.level} | ${l.title} | ${ex.length} | ${kinds.map((k) => KIND[k].split(':')[0]).join('; ')} | ${Math.min(...ex.map((e) => e.page))}-${Math.max(...ex.map((e) => e.page))} (answers ${Math.min(...ex.map((e) => e.answerPage))}-${Math.max(...ex.map((e) => e.answerPage))}) |\n`;
}
md += `\nAnswer types:\n\n${Object.values(KIND)
  .map((k) => `- ${k}`)
  .join('\n')}\n\nLevel 7 “Block first” answers are judged by enumerating every result of that first Block (each free push square, standing or knocked down, with and without a follow-up, Both Down, Attacker Down) and asking whether *some* result gives X1 at least a 2-dice Block that X1 chooses. Chain pushes are not enumerated (no Level 7 exercise needs one).\n\n`;

md += `## Engine versus workbook, exercise by exercise\n\n| Exercise | Page | Workbook answer | Engine answer(s) | Agreement |\n|---|---|---|---|---|\n`;
let agree = 0;
for (const e of EXERCISES) {
  const sol = solveExercise(e);
  const parsed = parseWorkbookAnswer(e, e.workbookAnswer);
  const ok = !!parsed && checkExercise(e, parsed).correct;
  if (ok) agree++;
  const answers = e.kind === 'count' ? sol.code : sol.answers.length > 6 ? `${sol.answers.slice(0, 6).join(', ')} … (${sol.answers.length})` : sol.answers.join(', ');
  const note = !ok ? '**differs**' : e.discrepancy ? 'accepted — see note' : 'same';
  md += `| ${e.id} | ${e.page} / ${e.answerPage} | ${e.workbookAnswer} | ${answers} | ${note} |\n`;
}
md += `\n**${agree} of ${EXERCISES.length}** workbook answers are accepted by the engine. All 65 counting answers of Levels 1-6 agree exactly.\n\n`;

md += `## Differences and notes (with workbook pages)\n\nThese notes are also shown inside the exercise, next to the solution.\n\n`;
for (const e of EXERCISES.filter((x) => x.discrepancy)) {
  md += `- **${e.id}** (workbook p.${e.page}, answer p.${e.answerPage}): ${e.discrepancy}\n`;
}
md += `
In short: the printed diagrams of Level 7 exercises 1, 4, 5, 6, 8 and 9 already give X1 a 2-dice Block before any preparation (the questions assume otherwise; exercise 9's text even calls it −2D); exercises 3, 7, 8, 13, 14 and 15 have more correct answers than the one in the key; the key's explanations for exercises 1, 10 and 11 do not match the printed positions; and two pairs of exercises (Level 2 #2/#3, Level 7 #13/#14) show the same position. The app always keeps the printed position and explains it with the rules.

## Basic Tutorials

The *Basic Tutorials* course (\`src/courses/basics.ts\`) was written for this app from the rulebook (there were no earlier tutorials to build on). Each tutorial is a normal position played with Plan → Review → Confirm; its objective is checked by the engine after every confirmed action (\`checkGoal\`), and the numbers quoted in hints and solutions are asserted by \`tests/tutorials.test.ts\`.

| # | Tutorial | Rules | Objective |
|---|---|---|---|
${TUTORIALS.map((t, i) => `| ${i + 1} | ${t.title} | ${t.rules.map((r) => `p.${r.page}`).join(', ')} | ${t.objective} |`).join('\n')}
`;

fs.writeFileSync(path.join(root, 'docs/BLOCK_SCHOOL.md'), md);
console.log(`wrote docs/BLOCK_SCHOOL.md (${EXERCISES.length} exercises, ${agree} workbook answers accepted)`);
