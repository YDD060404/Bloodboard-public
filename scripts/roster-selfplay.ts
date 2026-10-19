/**
 * V5: the new Team Rosters in actual play. Every roster added in V5 plays a whole match, computer
 * against computer (normal random dice), against another roster; every input is checked with
 * `validateInput` before it is executed and the state with `validateState` after every step.
 * The report lists, per roster, the result and which of its players' Skills and Traits (and its team
 * special rules) came up in the match log.
 * Usage (after `npm run build`):
 *   esbuild scripts/roster-selfplay.ts --bundle --platform=node --format=esm --outfile=build/roster-selfplay.mjs
 *   node build/roster-selfplay.mjs [firstSeed=1] [--md] [--only=snotling,vampire] [--sevens]
 */
import * as Engine from '../src/engine/index';
import { createMatch, decide, execute, newTeamDef, playerFromRoster, ROSTER_BY_ID, ROSTERS, SKILL_BY_ID, teamCost, validateInput, validateState, validateTeamDef, DRAFT_TEMPLATE, SEVENS_DRAFT, type ExecutionResult, type GameState, type Roster, type TeamDef, type TeamId } from '../src/engine/index';
import { bindEngine, nextMove, waitingFor } from '../src/ai/index';

declare const process: { argv: string[]; exit(n: number): never };
bindEngine(Engine);

const OLD = new Set(['bretonnian', 'tombKings', 'human', 'orc', 'lizardmen', 'norse']);
const args = process.argv.slice(2);
const firstSeed = Number(args.find((a) => /^\d+$/.test(a)) ?? 1);
const md = args.includes('--md');
const sevens = args.includes('--sevens');
const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');

/** A playable team for any roster: non-Linemen in roster order (at most two of each, one Big Guy) while the team still fits, then Linemen. */
function draft(r: Roster, id: string): TeamDef {
  const t = newTeamDef('tournament', r.id, `${r.name}`, id, sevens ? 'sevens' : undefined);
  if (r.leagues.length > 1) t.league = r.leagues[0];
  if (r.favouredOf) t.favoured = 'Undivided';
  const budget = sevens ? SEVENS_DRAFT.budget : DRAFT_TEMPLATE.budget;
  const need = sevens ? 7 : 11;
  const rr = sevens ? SEVENS_DRAFT.rerollCost : r.rerollCost;
  const line = r.positions.find((x) => x.keywords.includes('Lineman') && x.qty.endsWith('16'))!;
  const insignificant = line.skills.some((k) => k.id === 'insignificant');
  let n = 1;
  let bigGuys = 0;
  const others = r.positions.filter((x) => !x.keywords.includes('Lineman'));
  for (const pos of others) {
    const max = Math.min(Number(pos.qty.split('-')[1]), 2);
    for (let i = 0; i < max; i++) {
      if (sevens && t.players.length >= (insignificant ? 4 : 3)) break;
      if (pos.keywords.includes('Big Guy') && bigGuys >= (r.id === 'ogre' ? 4 : 1)) break;
      if (Engine.groupRoom(t, pos.id) <= 0) break;
      if (teamCost(t).players + pos.cost + Math.max(0, need - t.players.length - 1) * line.cost + 2 * rr > budget) break;
      t.players.push(playerFromRoster(r, pos.id, n, `${id}-${n++}`));
      if (pos.keywords.includes('Big Guy')) bigGuys++;
    }
  }
  while (t.players.length < need || (!sevens && t.players.length < 12 && teamCost(t).players + line.cost + 2 * rr <= budget)) t.players.push(playerFromRoster(r, line.id, n, `${id}-${n++}`));
  t.rerolls = 0;
  while (t.rerolls < 3 && teamCost({ ...t, rerolls: t.rerolls + 1 }).total <= budget) t.rerolls++;
  if (r.apothecary && teamCost({ ...t, apothecary: true }).total <= budget) t.apothecary = true;
  if (sevens) Engine.setVeteran(t, t.players.find((q) => q.keywords.includes('Lineman'))!.id);
  return t;
}

interface Row {
  roster: string;
  opponent: string;
  seed: number;
  score: string;
  steps: number;
  illegal: string[];
  seen: string[];
  notSeen: string[];
  rules: string[];
  ms: number;
}

function play(a: TeamDef, b: TeamDef, seed: number): { s: GameState; steps: number; illegal: string[] } {
  const cr = createMatch('tournament', a, b, { rules: 'full' }, seed);
  if (!cr.ok) throw new Error(cr.errors.join(' | '));
  let s = cr.state as GameState;
  const illegal: string[] = [];
  let steps = 0;
  while (s.phase !== 'fullTime' && steps < 6000) {
    steps++;
    const who = waitingFor(s);
    let res: ExecutionResult;
    if (!who) res = execute(s, s.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' });
    else {
      const mv = nextMove(s, who, who === 'A' ? 'balanced' : 'offensive', { maxExplored: 6 });
      if (!mv) throw new Error(`no move for ${who} in ${s.phase}`);
      if (mv.type === 'decision') res = decide(s, { requestId: mv.requestId, optionId: mv.optionId });
      else {
        const why = validateInput(s, mv.input);
        if (why.length) illegal.push(`${mv.input.kind}: ${why.join(' ')}`);
        res = execute(s, mv.input);
      }
    }
    if (res.status === 'illegal') {
      illegal.push(res.error ?? 'illegal');
      break;
    }
    s = res.state;
    const v = validateState(s);
    if (v.length) {
      illegal.push(`state: ${v.join(' ')}`);
      break;
    }
  }
  return { s, steps, illegal };
}

const rows: Row[] = [];
const list = ROSTERS.filter((r) => !OLD.has(r.id) && (!only || only.includes(r.id)));
list.forEach((r, i) => {
  const opp = ROSTERS[(ROSTERS.indexOf(r) + 7) % ROSTERS.length];
  const a = draft(r, `a-${r.id}`);
  const b = draft(opp.id === r.id ? ROSTER_BY_ID.human : opp, `b-${opp.id}`);
  const errs = [...validateTeamDef(a), ...validateTeamDef(b)].filter((x) => x.level === 'error');
  if (errs.length) {
    rows.push({ roster: r.id, opponent: opp.id, seed: 0, score: '-', steps: 0, illegal: errs.map((e) => `team: ${e.text}`), seen: [], notSeen: [], rules: [], ms: 0 });
    return;
  }
  const seed = firstSeed + i;
  const t0 = Date.now();
  let res: { s: GameState; steps: number; illegal: string[] };
  try {
    res = play(a, b, seed);
  } catch (e) {
    rows.push({ roster: r.id, opponent: opp.id, seed, score: '-', steps: 0, illegal: [`exception: ${(e as Error).message}`], seen: [], notSeen: [], rules: [], ms: Date.now() - t0 });
    return;
  }
  const s = res.s;
  // What came up: rule titles of logged events (skills, traits, team rules) and the event texts.
  const titles = new Set<string>();
  let text = '';
  for (const e of s.log) for (const v of e.events) {
    if (v.rule?.title) titles.add(v.rule.title);
    text += `${v.text}\n`;
  }
  const skillNames = [...new Set(a.players.flatMap((p) => p.skills.map((k) => SKILL_BY_ID[k.id]?.name ?? k.id)))].sort();
  const seen = skillNames.filter((n) => titles.has(n) || text.includes(n));
  const notSeen = skillNames.filter((n) => !seen.includes(n));
  const rules = (s.teams.A.specialRules ?? []).map((x) => `${x}${titles.has(x) || text.includes(x) ? ' ✓' : ''}`);
  rows.push({ roster: r.id, opponent: opp.id, seed, score: `${s.teams.A.score}-${s.teams.B.score}${s.phase === 'fullTime' ? '' : ` (${s.phase}, stopped)`}`, steps: res.steps, illegal: res.illegal, seen, notSeen, rules, ms: Date.now() - t0 });
  console.error(`${r.id} v ${opp.id}: ${rows[rows.length - 1].score}, ${res.steps} steps, ${res.illegal.length} illegal, ${Math.round((Date.now() - t0) / 1000)} s`);
});

if (md) {
  console.log(`| Roster (you, balanced) | Opponent (offensive) | Seed | Score | Illegal inputs | Skills & Traits seen in the log | Not seen | Team rules |`);
  console.log(`|---|---|---|---|---|---|---|---|`);
  for (const r of rows) console.log(`| ${ROSTER_BY_ID[r.roster].name} | ${ROSTER_BY_ID[r.opponent].name} | ${r.seed} | ${r.score} | ${r.illegal.length ? r.illegal.join('; ') : '0'} | ${r.seen.join(', ')} | ${r.notSeen.join(', ') || '—'} | ${r.rules.join(', ') || '—'} |`);
} else console.log(JSON.stringify(rows, null, 1));
const bad = rows.filter((r) => r.illegal.length);
console.error(`\n${rows.length} matches${sevens ? ' (Sevens)' : ''}, ${bad.length} with illegal inputs or errors.`);
process.exit(bad.length ? 1 : 0);
