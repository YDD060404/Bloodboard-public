# Block School

The **Block School** course turns the exercises of *BB School of Block – English* into playable lessons.

- Source: BB School of Block – English (unofficial fan-made workbook by Ferns / Richard F. J., bbsob.net). Positions and questions are used for non-commercial training; explanations are generated from the Blood Bowl rulebook rules.
- The workbook is an unofficial training aid. **The rulebook is authoritative**: every answer and explanation shown in the app is computed by the rules engine (Block Strength and assists p.60-61, Guard p.129, push-backs p.62), never copied from the workbook. Instructions printed inside the workbook were treated as workbook content only.
- Positions: `src/courses/blockSchoolData.json` (imported by `scripts/workbook/import_block_school.py` from the workbook text), course metadata `src/courses/blockSchool.ts`, engine checks `src/engine/teaching.ts`, tests `tests/teaching.test.ts`.

## How an exercise is played

1. **Learn ▸ Block School**, pick a level and an exercise. The board shows only the workbook grid, with the workbook's column letters and row numbers, in the middle of the pitch (no sidelines or End Zones nearby). X players are Team A (blue), Y players Team B (red); Guard players carry a **G** badge.
2. Answer on the board (see the table below). The engine checks the answer, explains it helper by helper (“X3 — no assist: Marked by Y2”), and rings each player green (assists) or red (cannot assist).
3. **Hints** can be opened one at a time; the **solution** becomes available after the first attempt and lists every correct answer found by trying every legal choice, the workbook's answer with its page, and any difference between the two.
4. **Retry** clears the answer; **Play it out with dice** plays the same position with Plan → Review → Confirm and real, seeded dice (Reset returns to the exercise with the same dice; New seed changes them).
5. Progress (solved / attempted) is saved on this computer (the `Progress` folder in the Mac app, browser storage otherwise).

## Coverage

All **80** exercises of Levels 1-7 are playable; none had to be left out.

| Level | Title | Exercises | Question type | Workbook pages |
|---|---|---|---|---|
| 1 | One against one | 5 | Count the dice | 2-3 (answers 29-29) |
| 2 | Offensive assists | 10 | Count the dice | 3-6 (answers 30-32) |
| 3 | Defensive assists | 10 | Count the dice | 7-10 (answers 33-35) |
| 4 | Different Strengths | 10 | Count the dice | 10-13 (answers 36-37) |
| 5 | Guard | 15 | Count the dice | 13-18 (answers 38-41) |
| 6 | Putting it together | 15 | Count the dice | 18-23 (answers 42-46) |
| 7 | Preparing the block | 15 | Make one normal Move (empty squares, no Rushing; staying put counts); Choose which opponent to Block first; Move a player exactly one square; Choose which X player makes the first Block; Choose the push square | 23-28 (answers 47-49) |

Answer types:

- Count the dice: choose 3D / 2D / 1D / −2D / −3D
- Move a player exactly one square: click the player, then the square
- Make one normal Move (empty squares, no Rushing; staying put counts): click the square
- Choose which opponent to Block first: click it
- Choose which X player makes the first Block: click it
- Choose the push square: click one of the highlighted squares

Level 7 “Block first” answers are judged by enumerating every result of that first Block (each free push square, standing or knocked down, with and without a follow-up, Both Down, Attacker Down) and asking whether *some* result gives X1 at least a 2-dice Block that X1 chooses. Chain pushes are not enumerated (no Level 7 exercise needs one).

## Engine versus workbook, exercise by exercise

| Exercise | Page | Workbook answer | Engine answer(s) | Agreement |
|---|---|---|---|---|
| L1E1 | 2 / 29 | 1D | 1D | same |
| L1E2 | 2 / 29 | 2D | 2D | same |
| L1E3 | 2 / 29 | 2D | 2D | same |
| L1E4 | 3 / 29 | 2D | 2D | same |
| L1E5 | 3 / 29 | 3D | 3D | same |
| L2E1 | 3 / 30 | 1D | 1D | same |
| L2E2 | 4 / 30 | 2D | 2D | accepted — see note |
| L2E3 | 4 / 30 | 2D | 2D | accepted — see note |
| L2E4 | 4 / 30 | 2D | 2D | same |
| L2E5 | 5 / 31 | 1D | 1D | same |
| L2E6 | 5 / 31 | 2D | 2D | same |
| L2E7 | 5 / 31 | 2D | 2D | same |
| L2E8 | 6 / 31 | 1D | 1D | same |
| L2E9 | 6 / 32 | 2D | 2D | same |
| L2E10 | 6 / 32 | 2D | 2D | same |
| L3E1 | 7 / 33 | 1D | 1D | same |
| L3E2 | 7 / 33 | 1D | 1D | same |
| L3E3 | 7 / 33 | 2D | 2D | same |
| L3E4 | 8 / 33 | 2D | 2D | same |
| L3E5 | 8 / 34 | 2D | 2D | same |
| L3E6 | 8 / 34 | 2D | 2D | same |
| L3E7 | 9 / 34 | 2D | 2D | same |
| L3E8 | 9 / 34 | 2D | 2D | same |
| L3E9 | 9 / 35 | 2D | 2D | same |
| L3E10 | 10 / 35 | 2D | 2D | same |
| L4E1 | 10 / 36 | 2D | 2D | same |
| L4E2 | 10 / 36 | 1D | 1D | same |
| L4E3 | 11 / 36 | -2D | -2D | same |
| L4E4 | 11 / 36 | 1D | 1D | same |
| L4E5 | 11 / 36 | 2D | 2D | same |
| L4E6 | 12 / 37 | 2D | 2D | same |
| L4E7 | 12 / 37 | 3D | 3D | same |
| L4E8 | 12 / 37 | -2D | -2D | same |
| L4E9 | 13 / 37 | 3D | 3D | same |
| L4E10 | 13 / 37 | -2D | -2D | same |
| L5E1 | 13 / 38 | 2D | 2D | same |
| L5E2 | 14 / 38 | -2D | -2D | same |
| L5E3 | 14 / 38 | 1D | 1D | same |
| L5E4 | 14 / 38 | 2D | 2D | same |
| L5E5 | 15 / 38 | 2D | 2D | same |
| L5E6 | 15 / 39 | 2D | 2D | same |
| L5E7 | 15 / 39 | 2D | 2D | same |
| L5E8 | 16 / 39 | -2D | -2D | same |
| L5E9 | 16 / 39 | 2D | 2D | same |
| L5E10 | 16 / 40 | 1D | 1D | same |
| L5E11 | 17 / 40 | 2D | 2D | same |
| L5E12 | 17 / 40 | 2D | 2D | same |
| L5E13 | 17 / 40 | 2D | 2D | same |
| L5E14 | 18 / 41 | 1D | 1D | same |
| L5E15 | 18 / 41 | 1D | 1D | same |
| L6E1 | 18 / 42 | 1D | 1D | same |
| L6E2 | 19 / 42 | 2D | 2D | same |
| L6E3 | 19 / 42 | -2D | -2D | same |
| L6E4 | 19 / 43 | 2D | 2D | same |
| L6E5 | 20 / 43 | -2D | -2D | same |
| L6E6 | 20 / 43 | 2D | 2D | same |
| L6E7 | 20 / 44 | 2D | 2D | same |
| L6E8 | 21 / 44 | 2D | 2D | same |
| L6E9 | 21 / 44 | 2D | 2D | same |
| L6E10 | 21 / 45 | 3D | 3D | same |
| L6E11 | 22 / 45 | -2D | -2D | same |
| L6E12 | 22 / 45 | 2D | 2D | same |
| L6E13 | 22 / 45 | 2D | 2D | same |
| L6E14 | 23 / 46 | 1D | 1D | same |
| L6E15 | 23 / 46 | 1D | 1D | same |
| L7E1 | 23 / 47 | B3 | B3, A2, B2, A3, A4, B4 … (31) | accepted — see note |
| L7E2 | 24 / 47 | Y2 | Y2 | same |
| L7E3 | 24 / 47 | Y2 | Y2, Y3 | accepted — see note |
| L7E4 | 24 / 47 | X4 -> B4 | X2 -> B1, X2 -> C1, X2 -> D1, X4 -> A2, X4 -> A3, X4 -> A4 … (7) | accepted — see note |
| L7E5 | 25 / 47 | B3 | B3 | accepted — see note |
| L7E6 | 25 / 47 | B3 | B4, A3, B3, A4, A5, B5 … (30) | accepted — see note |
| L7E7 | 25 / 48 | D4 | D4, E4 | accepted — see note |
| L7E8 | 26 / 48 | E3 | D2, E3 | accepted — see note |
| L7E9 | 26 / 48 | C2 | C2 | accepted — see note |
| L7E10 | 26 / 48 | Y2 | Y2 | accepted — see note |
| L7E11 | 27 / 48 | X2 | X2 | accepted — see note |
| L7E12 | 27 / 48 | X2 | X2 | same |
| L7E13 | 27 / 48 | Y2 | Y2, Y3 | accepted — see note |
| L7E14 | 28 / 49 | Y2 | Y2, Y3 | accepted — see note |
| L7E15 | 28 / 49 | D1 | D2, D1 | accepted — see note |

**80 of 80** workbook answers are accepted by the engine. All 65 counting answers of Levels 1-6 agree exactly.

## Differences and notes (with workbook pages)

These notes are also shown inside the exercise, next to the solution.

- **L2E2** (workbook p.4, answer p.30): Exercises 2 and 3 of Level 2 show the same position.
- **L2E3** (workbook p.4, answer p.30): Exercises 2 and 3 of Level 2 show the same position.
- **L7E1** (workbook p.23, answer p.47): The answer key describes moving X2 from A3 to B3, but the printed diagram already shows X2 on B3, so X1's Block is already 2D (ST 5 v 3). The app keeps the printed position: leaving X2 where it is (or any square where the count stays 2D) is accepted.
- **L7E3** (workbook p.24, answer p.47): The engine also accepts Y3: if X2's Block knocks Y3 down (knocked down into A4, or Both Down), X4 is free to assist. Blocking Y2 (the workbook answer) works with any push.
- **L7E4** (workbook p.24, answer p.47): In the printed diagram X1's Block is already 2D before any move (X3 assists with Guard: ST 4 v 3), so several one-square moves keep it 2D; the workbook answer (X4 to B4) is one of them.
- **L7E5** (workbook p.25, answer p.47): In the printed diagram X2 on B4 is already diagonally next to Y1 and unmarked, so X1's Block is already 2D; the workbook answer (B3) keeps it 2D.
- **L7E6** (workbook p.25, answer p.47): As the answer key itself notes, X3 already assists with Guard, so the Block is 2D before X2 moves; most squares keep it 2D.
- **L7E7** (workbook p.25, answer p.48): The engine finds a second correct square: E4 also Marks Y2 and gives 2D, as well as the workbook's D4.
- **L7E8** (workbook p.26, answer p.48): In the printed diagram X2 on E2 already Marks Y2, so Y2 cannot assist and X1's Block is already 2D. The workbook answer E3 keeps it 2D; D2 does too.
- **L7E9** (workbook p.26, answer p.48): The question says the Block is −2D because Y2 assists Y1, but in the printed diagram X2 (Guard) on D2 already Marks Y2 and assists X1, so the Block is already 2D; the workbook answer C2 keeps it 2D.
- **L7E10** (workbook p.26, answer p.48): The answer (Y2) is right, but the key's count (Y3 cannot assist, ST 4 v 3) only holds if X2 follows up into C2 and Marks Y3. Without the follow-up X2 assists too and Y3 still helps Y1: ST 5 v 4, which is also 2D.
- **L7E11** (workbook p.27, answer p.48): The key's explanation says X4 Marks Y3, but in the printed diagram X4 (B4) is not next to Y3 (D3). X2 blocking Y2 is still right: without a follow-up it is ST 5 v 4, with a follow-up into C2 it is ST 4 v 3 — 2D either way.
- **L7E13** (workbook p.27, answer p.48): Exercises 13 and 14 show the same position. The engine also accepts Y3: X4 pushing Y3 into D2 or E2 without following up frees X4 to assist (ST 4 v 3).
- **L7E14** (workbook p.28, answer p.49): Exercises 13 and 14 show the same position. The engine also accepts Y3: X4 pushing Y3 into D2 or E2 without following up frees X4 to assist (ST 4 v 3). Blocking Y2 frees two helpers (X2 and X3), so it is the more robust choice.
- **L7E15** (workbook p.28, answer p.49): The engine finds a second push square: D2 also gives 2D, as well as the workbook's D1.

In short: the printed diagrams of Level 7 exercises 1, 4, 5, 6, 8 and 9 already give X1 a 2-dice Block before any preparation (the questions assume otherwise; exercise 9's text even calls it −2D); exercises 3, 7, 8, 13, 14 and 15 have more correct answers than the one in the key; the key's explanations for exercises 1, 10 and 11 do not match the printed positions; and two pairs of exercises (Level 2 #2/#3, Level 7 #13/#14) show the same position. The app always keeps the printed position and explains it with the rules.

## Basic Tutorials

The *Basic Tutorials* course (`src/courses/basics.ts`) was written for this app from the rulebook (there were no earlier tutorials to build on). Each tutorial is a normal position played with Plan → Review → Confirm; its objective is checked by the engine after every confirmed action (`checkGoal`), and the numbers quoted in hints and solutions are asserted by `tests/tutorials.test.ts`.

| # | Tutorial | Rules | Objective |
|---|---|---|---|
| 1 | Moving and Rushing | p.54, p.58, p.80 | Score a Touchdown with the Catcher (#1) carrying the ball into the Orc End Zone (column Z). |
| 2 | Tackle Zones and Dodging | p.38, p.55 | Get the Human Lineman (#3) past the two Orcs to column S or beyond, Standing. |
| 3 | Picking up the ball | p.57, p.59 | Get the ball into the hands of the Human Catcher (#1). |
| 4 | Passing | p.70, p.71, p.72 | Complete a pass to the Human Catcher (#1). |
| 5 | Hand-off and score | p.74, p.72 | Score a Touchdown this Turn. |
| 6 | Blocking and assists | p.60, p.61, p.62 | Knock the Orc Lineman (#4) down. |
| 7 | Blitz the ball carrier | p.64 | Knock down the Orc ball carrier (#4). |
| 8 | Throw Team-mate | p.76 | Throw the Halfling (with the ball) into the End Zone and land it for a Touchdown. |
| 9 | Projectile Vomit | p.133 | Use Projectile Vomit on the Human Blitzer. |
| 10 | A whole match: set-up and kick-off | p.44, p.47, p.48, p.49 | Start a practice match and play through set-up and the kick-off. |
