/**
 * Writes docs/EXAMPLES.md: every example position with a map, its dice seed,
 * and one reproducible walkthrough (the preview the app shows, then the dice
 * the saved seed produces when the same plan is confirmed).
 *
 * The walkthrough action is only there to check reproducibility; it is not a
 * suggestion about what to play.
 */
import { DEFAULT_POLICY } from '../src/engine/context';
import { makeDecider } from '../src/engine/planner';
import { board, decide, describeInput, execute, findPlayer, parseSaveFile, planAction, skillName, type ActionInput, type GameState, type PlayerActionInput } from '../src/engine/index';

declare const process: { argv: string[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function require(m: string): any;
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2] ?? '.';
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function load(file: string): { name: string; notes: string; state: GameState } {
  const r = parseSaveFile(fs.readFileSync(path.join(root, 'examples', file), 'utf8'));
  if (!r.ok) throw new Error(r.errors.join());
  return { name: r.save.name, notes: r.save.notes ?? '', state: r.save.state };
}

const pid = (s: GameState, team: 'A' | 'B', n: number) => {
  const p = s.players.find((q) => q.team === team && q.number === n);
  if (!p) throw new Error(`no ${team}#${n}`);
  return p.id;
};
const steps = (pts: Array<[number, number]>) => pts.map(([x, y]) => ({ to: { x, y }, kind: 'step' as const }));

const WALKS: Array<{ file: string; input: (s: GameState) => ActionInput; why: string }> = [
  { file: '01-two-dodges-to-glory.json', why: 'one of several possible routes', input: (s) => ({ kind: 'playerAction', playerId: pid(s, 'A', 7), action: 'move', path: steps([[18, 7], [19, 7], [20, 7], [21, 7], [22, 7], [23, 7], [24, 7], [25, 6]]) }) },
  { file: '02-blitz-the-carrier.json', why: 'a Blitz on the carrier', input: (s) => ({ kind: 'playerAction', playerId: pid(s, 'A', 6), action: 'blitz', blitzTarget: pid(s, 'B', 8), blockTarget: pid(s, 'B', 8), path: steps([[11, 7], [10, 7], [9, 7]]) }) },
  { file: '03-short-pass-to-the-end-zone.json', why: 'the pass to the End Zone', input: (s) => ({ kind: 'playerAction', playerId: pid(s, 'A', 10), action: 'pass', path: [], passTarget: { x: 25, y: 5 } }) },
  { file: '04-hand-off-and-run.json', why: 'the hand-off only', input: (s) => ({ kind: 'playerAction', playerId: pid(s, 'A', 9), action: 'handoff', path: [], handoffTarget: pid(s, 'A', 7) }) },
  { file: '05-loose-ball-in-traffic.json', why: 'a dodge onto the ball (pick-up)', input: (s) => ({ kind: 'playerAction', playerId: pid(s, 'A', 10), action: 'move', path: steps([[12, 7], [13, 7]]) }) },
  { file: '06-sideline-crowd-surf.json', why: 'a Block against the sideline', input: (s) => ({ kind: 'playerAction', playerId: pid(s, 'A', 8), action: 'block', path: [], blockTarget: pid(s, 'B', 7) }) },
  { file: '07-stalling-check.json', why: 'ending the Turn without scoring', input: () => ({ kind: 'endTurn' }) },
];

function asciiMap(s: GameState): string {
  const cols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lines: string[] = [];
  lines.push('     ' + cols.split('').map((ch) => ch.padEnd(4)).join('').trimEnd());
  for (let y = 0; y < 15; y++) {
    let row = String(y + 1).padStart(3) + '  ';
    for (let x = 0; x < 26; x++) {
      const p = s.players.find((q) => q.location === 'pitch' && q.pos && q.pos.x === x && q.pos.y === y);
      const ball = s.ball.kind === 'ground' && s.ball.pos.x === x && s.ball.pos.y === y;
      let cell = x === 0 || x === 25 ? ': ' : '. ';
      if (p) {
        const holds = s.ball.kind === 'held' && s.ball.playerId === p.id;
        const tag = `${p.team === 'A' ? 'a' : 'b'}${p.number}`;
        cell = p.stance !== 'standing' ? `${tag}`.toUpperCase() : tag;
        if (holds) cell += '*';
      } else if (ball) cell = '* ';
      row += cell.padEnd(4).slice(0, 4);
    }
    lines.push(row.trimEnd());
  }
  return lines.join('\n');
}

function playersTable(s: GameState): string {
  const rows = s.players
    .filter((p) => p.location === 'pitch')
    .sort((a, b) => (a.team === b.team ? a.number - b.number : a.team.localeCompare(b.team)))
    .map((p) => {
      const holds = s.ball.kind === 'held' && s.ball.playerId === p.id;
      return `| ${p.team === 'A' ? 'a' : 'b'}${p.number} | ${s.teams[p.team].name} | ${p.position} | ${board.fmt(p.pos)} | ${p.ma}/${p.st}/${p.ag}+/${p.pa === null ? '-' : `${p.pa}+`}/${p.av}+ | ${p.skills.map((k) => skillName(k)).join(', ') || '—'} | ${p.stance}${holds ? ', has the ball' : ''} |`;
    });
  return ['| Map | Team | Position | Square | MA/ST/AG/PA/AV | Skills | Status |', '|---|---|---|---|---|---|---|', ...rows].join('\n');
}

const decider = makeDecider({ ...DEFAULT_POLICY });
let md = `# Example positions

Seven positions ship with the app (**Examples** button, or the \`examples/\` folder, which also holds them as ordinary save files you can import). Each stores a fixed dice seed, so confirming the same plan with the same decisions always rolls the same dice.

For each example below: the map, the players, and one walkthrough used to check that the app is reproducible. The walkthrough action is **not a suggestion** — it is just a fixed input whose preview and dice you can compare with the app.

*Map legend:* \`a7\` = Team A player #7, \`b4\` = Team B player #4, capitals (\`B4\`) = Prone/Stunned, \`*\` after a number = holds the ball, \`*\` alone = ball on the ground, \`:\` = End Zone column. Team A scores in column Z, Team B in column A. Squares are written column letter + row number (e.g. R8).

*Walkthrough decisions:* whenever the action pauses for a decision, the walkthrough answers it the way the preview assumes (re-roll a failure with a skill, then Pro, then a Team Re-roll; choose the best block die for the chooser; follow up). If you choose differently in the app, later dice differ from those listed.

_This file is generated by \`scripts/make-example-docs.ts\` from the engine itself._

`;

WALKS.forEach((w, i) => {
  const ex = load(w.file);
  const s = ex.state;
  const input = w.input(s);
  const plan = planAction(s, input);
  if (!plan.ok) throw new Error(`${w.file}: ${plan.errors.join()}`);
  md += `## ${i + 1}. ${ex.name}\n\n`;
  md += `File \`examples/${w.file}\` · dice seed **${s.rng.seed}** · weather: ${s.weather}\n\n`;
  md += `${ex.notes}\n\n`;
  md += `- ${s.teams.A.name} (Team A): Turn ${s.teams.A.turn}, ${s.teams.A.rerolls} Team Re-roll${s.teams.A.rerolls === 1 ? '' : 's'}, score ${s.teams.A.score}\n`;
  md += `- ${s.teams.B.name} (Team B): Turn ${s.teams.B.turn}, ${s.teams.B.rerolls} Team Re-roll${s.teams.B.rerolls === 1 ? '' : 's'}, score ${s.teams.B.score}\n`;
  md += `- Team to act: **${s.teams[s.turn.active].name}**\n\n`;
  md += '```text\n' + asciiMap(s) + '\n```\n\n';
  md += playersTable(s) + '\n\n';

  md += `### Walkthrough (${w.why})\n\n`;
  md += `**Plan:** ${describeInput(s, input)}${input.kind === 'playerAction' && input.path.length ? ` — route ${input.path.map((st) => board.fmt(st.to)).join(' → ')}` : ''}\n\n`;
  if (plan.steps.length) {
    md += '| # | Step | Dice | Need | Modifiers | Chance | With a re-roll |\n|---|---|---|---|---|---|---|\n';
    plan.steps.forEach((st, k) => {
      const mods = st.mods.length ? st.mods.map((m) => `${m.value >= 0 ? '+' : ''}${m.value} ${m.label}`).join(', ') : '—';
      const who = st.by === 'opponent' ? ' *(opponent\'s roll)*' : '';
      const chance = st.pSingle === null ? 'see block dice' : pct(st.pSingle);
      md += `| ${k + 1} | ${st.label}${who} (p.${st.rule.page}) | ${st.dice} | ${st.target !== undefined ? `${st.target}+` : '—'} | ${mods} | ${chance} | ${st.pWithReroll !== undefined ? `${pct(st.pWithReroll)} (${st.rerolls.join(' / ')})` : '—'} |\n`;
    });
    md += '\n';
  } else md += '_No dice are needed for the planned part; see the events below._\n\n';
  const wo = plan.withoutTeamRerolls!;
  const wt = plan.withTeamRerolls!;
  const trr = s.teams[s.turn.active].rerolls > 0 || s.teams[s.turn.active].leaderReroll;
  md += `**Preview (exact):** completes as planned ${pct(wo.pCompleted)} without Team Re-rolls${trr ? `, ${pct(wt.pCompleted)} using them` : ''}; Turnover ${pct(wo.pTurnover)}${trr ? ` / ${pct(wt.pTurnover)}` : ''}`;
  if (wo.pTouchdownActive > 0) md += `; Touchdown ${pct(wo.pTouchdownActive)}${trr ? ` / ${pct(wt.pTouchdownActive)}` : ''}`;
  if (plan.block) {
    const b = plan.block;
    md += `. Block: ${b.dice} ${b.dice === 1 ? 'die' : 'dice'}, ${b.chooser} chooses; result after the choice: ${Object.entries(b.chosen)
      .sort((x, y) => y[1] - x[1])
      .map(([k, v]) => `${k} ${pct(v)}`)
      .join(', ')}`;
  }
  if (plan.pass) md += `. Pass: accurate ${pct(plan.pass.pAccurate)}, inaccurate ${pct(plan.pass.pInaccurate)}, fumble ${pct(plan.pass.pFumble)}; interceptors: ${plan.pass.interceptorsIfAccurate.map((q) => `${q.label} ${pct(q.p)}`).join(', ') || 'none'}`;
  md += `. Unresolved probability mass: ${wo.unresolved < 1e-12 ? '0' : wo.unresolved.toExponential(1)}.\n\n`;

  // Execute with the stored seed, answering decisions with the preview policy.
  let res = execute(s, input);
  const decisions: string[] = [];
  let guard = 0;
  while (res.status === 'awaitingDecision' && res.decision && guard++ < 40) {
    const opt = decider(res.decision, { s: res.state, steps: [] } as unknown as Parameters<typeof decider>[1]);
    const o = res.decision.options.find((q) => q.id === opt);
    decisions.push(`${res.decision.prompt} → **${o?.label ?? opt}**`);
    res = decide(res.state, { requestId: res.decision.id, optionId: opt });
  }
  const last = res.state.log[res.state.log.length - 1];
  md += `**Confirm with seed ${s.rng.seed}** → outcome: **${last.outcome}**${decisions.length ? ` (decisions: ${decisions.length})` : ''}\n\n`;
  if (decisions.length) md += decisions.map((d) => `- Decision: ${d}`).join('\n') + '\n\n';
  md += last.events.map((e) => `1. ${e.text}${e.rule ? ` *(p.${e.rule.page})*` : ''}`).join('\n') + '\n\n';
  const actor = input.kind === 'playerAction' ? findPlayer(res.state, input.playerId) : undefined;
  void actor;
});

fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'EXAMPLES.md'), md);
console.log(`wrote docs/EXAMPLES.md (${WALKS.length} examples)`);
