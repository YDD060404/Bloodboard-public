/**
 * Generates the reproducible example positions in examples/*.json.
 * Run: node scripts/build.mjs --examples   (bundled with esbuild)
 */
import { newGame, playerFromPosition, ROSTER_BY_ID, startPlay, toSaveFile, type Coord, type GameState, type Player, type TeamId } from '../src/engine/index';

declare const process: { argv: string[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function require(m: string): any;

interface Ex {
  file: string;
  name: string;
  summary: string;
  build: () => GameState;
}

function place(s: GameState, team: TeamId, roster: string, position: string, x: number, y: number, number: number, patch: Partial<Player> = {}): Player {
  const r = ROSTER_BY_ID[roster];
  const pos = r.positions.find((p) => p.id === position);
  if (!pos) throw new Error(`${roster}/${position}`);
  const p = playerFromPosition(s, team, pos, { x, y } as Coord, number);
  Object.assign(p, patch);
  s.players.push(p);
  return p;
}

const EXAMPLES: Ex[] = [
  {
    file: '01-two-dodges-to-glory.json',
    name: 'Turn 8: two dodges to glory',
    summary: 'Last Turn: a Marked Human Catcher (Dodge, MA 8) holding the ball must get away and past a Goblin guarding the End Zone. Try different routes and compare the previewed odds.',
    build: () => {
      const s = newGame({ a: { name: 'Reikland Rookies', roster: 'human' }, b: { name: 'Badland Bashers', roster: 'orc' }, seed: 20260925 });
      s.teams.A.turn = 8;
      s.teams.B.turn = 7;
      s.teams.A.rerolls = 1;
      s.teams.B.rerolls = 1;
      s.teams.A.score = 1;
      s.teams.B.score = 1;
      const cat = place(s, 'A', 'human', 'catcher', 17, 7, 7);
      place(s, 'A', 'human', 'blitzer', 14, 5, 5);
      place(s, 'A', 'human', 'lineman', 13, 9, 2);
      place(s, 'A', 'human', 'lineman', 12, 6, 3);
      place(s, 'A', 'human', 'thrower', 11, 7, 10);
      place(s, 'B', 'orc', 'lineman', 16, 8, 4);
      place(s, 'B', 'orc', 'lineman', 23, 5, 5);
      place(s, 'B', 'orc', 'blitzer', 23, 9, 6);
      place(s, 'B', 'orc', 'goblin', 25, 7, 11);
      place(s, 'B', 'orc', 'bigUn', 15, 11, 8);
      place(s, 'B', 'orc', 'lineman', 12, 3, 3);
      s.ball = { kind: 'held', playerId: cat.id };
      s.title = 'Turn 8: two dodges to glory';
      return startPlay(s);
    },
  },
  {
    file: '02-blitz-the-carrier.json',
    name: 'Blitz the ball carrier',
    summary: 'Tomb Kings must stop a Bretonnian Knight Catcher: a Blitz with an assist gives 2 dice; a POW makes the ball bounce.',
    build: () => {
      const s = newGame({ a: { name: 'Nehekhara Nightmares', roster: 'tombKings' }, b: { name: 'Brionne Barons', roster: 'bretonnian' }, seed: 777 });
      s.teams.A.turn = 7;
      s.teams.B.turn = 6;
      s.teams.A.rerolls = 2;
      s.teams.B.rerolls = 1;
      s.teams.B.score = 1;
      place(s, 'A', 'tombKings', 'tkBlitzer', 12, 7, 6);
      place(s, 'A', 'tombKings', 'skeleton', 9, 8, 3);
      place(s, 'A', 'tombKings', 'tombGuardian', 9, 5, 12);
      place(s, 'A', 'tombKings', 'skeleton', 13, 10, 4);
      place(s, 'A', 'tombKings', 'tkThrower', 16, 7, 10);
      const kc = place(s, 'B', 'bretonnian', 'knightCatcher', 8, 7, 8);
      place(s, 'B', 'bretonnian', 'squire', 7, 6, 3);
      place(s, 'B', 'bretonnian', 'squire', 6, 9, 4);
      place(s, 'B', 'bretonnian', 'grailKnight', 9, 10, 1);
      place(s, 'B', 'bretonnian', 'squire', 8, 4, 5);
      s.ball = { kind: 'held', playerId: kc.id };
      s.title = 'Blitz the ball carrier';
      return startPlay(s);
    },
  },
  {
    file: '03-short-pass-to-the-end-zone.json',
    name: 'Short pass into the End Zone',
    summary: 'Human Thrower passes to a Catcher standing in the End Zone. Two Orcs sit under the Range Ruler; one also Marks the catcher.',
    build: () => {
      const s = newGame({ a: { name: 'Reikland Rookies', roster: 'human' }, b: { name: 'Badland Bashers', roster: 'orc' }, seed: 31415 });
      s.teams.A.turn = 8;
      s.teams.B.turn = 7;
      s.teams.A.rerolls = 1;
      s.teams.B.rerolls = 0;
      const thr = place(s, 'A', 'human', 'thrower', 20, 7, 10);
      place(s, 'A', 'human', 'catcher', 25, 5, 7);
      place(s, 'A', 'human', 'blitzer', 18, 9, 5);
      place(s, 'B', 'orc', 'lineman', 23, 6, 4);
      place(s, 'B', 'orc', 'lineman', 24, 6, 5);
      place(s, 'B', 'orc', 'blitzer', 17, 10, 6);
      place(s, 'B', 'orc', 'goblin', 22, 3, 11);
      s.ball = { kind: 'held', playerId: thr.id };
      s.title = 'Short pass into the End Zone';
      return startPlay(s);
    },
  },
  {
    file: '04-hand-off-and-run.json',
    name: 'Hand-off, then run it in',
    summary: 'Bretonnian Knight Thrower hands off to a Marked Knight Catcher, who must dodge away and Rush twice to score.',
    build: () => {
      const s = newGame({ a: { name: 'Brionne Barons', roster: 'bretonnian' }, b: { name: 'Nehekhara Nightmares', roster: 'tombKings' }, seed: 4242 });
      s.teams.A.turn = 6;
      s.teams.B.turn = 5;
      s.teams.A.rerolls = 2;
      s.teams.B.rerolls = 2;
      const thr = place(s, 'A', 'bretonnian', 'knightThrower', 15, 7, 9);
      place(s, 'A', 'bretonnian', 'knightCatcher', 16, 8, 7);
      place(s, 'A', 'bretonnian', 'grailKnight', 14, 10, 1);
      place(s, 'A', 'bretonnian', 'squire', 13, 6, 3);
      place(s, 'B', 'tombKings', 'skeleton', 17, 9, 3);
      place(s, 'B', 'tombKings', 'skeleton', 19, 6, 4);
      place(s, 'B', 'tombKings', 'tkBlitzer', 21, 8, 6);
      place(s, 'B', 'tombKings', 'tombGuardian', 18, 11, 12);
      s.ball = { kind: 'held', playerId: thr.id };
      s.title = 'Hand-off, then run it in';
      return startPlay(s);
    },
  },
  {
    file: '05-loose-ball-in-traffic.json',
    name: 'Loose ball in traffic',
    summary: 'Orcs need a loose ball surrounded by Humans: Sure Hands Thrower vs a Stunty Goblin. Secure the Ball is not allowed (opponents within 2 squares).',
    build: () => {
      const s = newGame({ a: { name: 'Badland Bashers', roster: 'orc' }, b: { name: 'Reikland Rookies', roster: 'human' }, seed: 55555 });
      s.teams.A.turn = 5;
      s.teams.B.turn = 4;
      s.teams.A.rerolls = 3;
      s.teams.B.rerolls = 2;
      place(s, 'A', 'orc', 'thrower', 11, 7, 10);
      place(s, 'A', 'orc', 'goblin', 11, 9, 11);
      place(s, 'A', 'orc', 'blitzer', 10, 5, 6);
      place(s, 'A', 'orc', 'bigUn', 12, 10, 8);
      place(s, 'B', 'human', 'lineman', 12, 6, 2);
      place(s, 'B', 'human', 'blitzer', 13, 8, 5);
      place(s, 'B', 'human', 'catcher', 15, 6, 7);
      place(s, 'B', 'human', 'lineman', 14, 10, 3);
      s.ball = { kind: 'ground', pos: { x: 13, y: 7 } };
      s.title = 'Loose ball in traffic';
      return startPlay(s);
    },
  },
  {
    file: '06-sideline-crowd-surf.json',
    name: 'Sideline crowd surf',
    summary: 'A Human Catcher holds the ball on the sideline. Any push sends them into the crowd (Injury by the Crowd + Throw-in).',
    build: () => {
      const s = newGame({ a: { name: 'Badland Bashers', roster: 'orc' }, b: { name: 'Reikland Rookies', roster: 'human' }, seed: 9001 });
      s.teams.A.turn = 4;
      s.teams.B.turn = 3;
      s.teams.A.rerolls = 2;
      s.teams.B.rerolls = 2;
      place(s, 'A', 'orc', 'bigUn', 10, 1, 8);
      place(s, 'A', 'orc', 'blitzer', 13, 3, 6);
      place(s, 'A', 'orc', 'lineman', 9, 3, 4);
      const cat = place(s, 'B', 'human', 'catcher', 10, 0, 7);
      place(s, 'B', 'human', 'lineman', 11, 2, 2);
      place(s, 'B', 'human', 'blitzer', 7, 2, 5);
      s.ball = { kind: 'held', playerId: cat.id };
      s.title = 'Sideline crowd surf';
      return startPlay(s);
    },
  },
  {
    file: '07-stalling-check.json',
    name: 'Stalling on Turn 3',
    summary: 'An open Human Catcher could score without rolling any dice. Ending the activation (or the Turn) without scoring triggers the Crowd Takes Action: a D6 of 3+ (the Turn number) knocks them down.',
    build: () => {
      const s = newGame({ a: { name: 'Reikland Rookies', roster: 'human' }, b: { name: 'Badland Bashers', roster: 'orc' }, seed: 1234 });
      s.teams.A.turn = 3;
      s.teams.B.turn = 2;
      s.teams.A.rerolls = 2;
      s.teams.B.rerolls = 2;
      const cat = place(s, 'A', 'human', 'catcher', 20, 7, 7);
      place(s, 'A', 'human', 'lineman', 16, 6, 2);
      place(s, 'B', 'orc', 'lineman', 15, 7, 4);
      place(s, 'B', 'orc', 'blitzer', 12, 9, 6);
      s.ball = { kind: 'held', playerId: cat.id };
      s.title = 'Stalling on Turn 3';
      return startPlay(s);
    },
  },
];

const fs = require('node:fs');
const path = require('node:path');
const outDir = process.argv[2] ?? 'examples';
fs.mkdirSync(outDir, { recursive: true });
const index: Array<{ file: string; name: string; summary: string }> = [];
for (const ex of EXAMPLES) {
  const st = ex.build();
  st.notes = ex.summary;
  const save = toSaveFile(st, ex.name, ex.summary);
  save.savedAt = '2026-09-25T00:00:00.000Z';
  fs.writeFileSync(path.join(outDir, ex.file), JSON.stringify(save, null, 1) + '\n');
  index.push({ file: ex.file, name: ex.name, summary: ex.summary });
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(`wrote ${EXAMPLES.length} examples to ${outDir}`);
