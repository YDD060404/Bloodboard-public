/**
 * V5 steps 5-6: Star Players in actual play. Twelve whole matches, computer against computer (normal random dice),
 * between Tournament / Exhibition teams that each hired two Star Players (32 Star Players in all); every input is
 * checked with `validateInput` before it is executed and the state with `validateState` after every step. The
 * report lists which Star Player special rules came up in the match log.
 * Usage (after `npm run build`):
 *   esbuild scripts/star-selfplay.ts --bundle --platform=node --format=esm --outfile=build/star-selfplay.mjs
 *   node build/star-selfplay.mjs [firstSeed=1] [--md]
 */
import * as Engine from '../src/engine/index';
import { addStar, createMatch, decide, execute, newTeamDef, playerFromRoster, ROSTER_BY_ID, STAR_BY_ID, starPlaysFor, teamCost, teamSpecialRules, validateInput, validateState, validateTeamDef, type ExecutionResult, type GameState, type TeamDef } from '../src/engine/index';
import { bindEngine, nextMove, waitingFor } from '../src/ai/index';

declare const process: { argv: string[]; exit(n: number): never };
bindEngine(Engine);
const args = process.argv.slice(2);
const firstSeed = Number(args.find((a) => /^\d+$/.test(a)) ?? 1);
const md = args.includes('--md');

const MATCHES: Array<[[string, string[]], [string, string[]]]> = [
  [['human', ['griff', 'mightyZug']], ['orc', ['varag', 'ripper']]],
  [['elvenUnion', ['lucien', 'roxanna']], ['lizardmen', ['dribl', 'anqiPanqi']]],
  [['dwarf', ['grombrindal', 'josefBugmanStar']], ['goblin', ['blackGobbo', 'scrappa']]],
  [['nurgle', ['bilerot', 'guffle']], ['khorne', ['scyla', 'maxSpleenripper']]],
  [['vampire', ['luthor', 'wilhelm']], ['woodElf', ['jordell', 'willow']]],
  [['halfling', ['deeproot', 'rodney']], ['underworld', ['skitter', 'glart']]],
  [['chaosDwarf', ['hthark', 'zzharg']], ['norse', ['lordBorak', 'grashnak']]],
  [['imperialNobility', ['helmut', 'karla']], ['skaven', ['hakflem', 'kreek']]],
  // V5 step 6: Star Players whose rules are used at the start of an activation (the computer now uses them).
  [['dwarf', ['thorsson', 'mightyZug']], ['chaosDwarf', ['zzharg', 'hthark']]],
  [['woodElf', ['swiftvine', 'maple']], ['lizardmen', ['boa', 'zolcath']]],
  [['highElf', ['kiroth', 'jeremiahKool']], ['goblin', ['nobbla', 'scrappa']]],
  [['shamblingUndead', ['gretchen', 'ivan']], ['woodElf', ['rodney', 'willow']]],
];

function team(id: string, rosterId: string, stars: string[]): TeamDef {
  const r = ROSTER_BY_ID[rosterId];
  const t = newTeamDef('tournament', rosterId, `${r.name} + ${stars.map((x) => STAR_BY_ID[x].name).join(' & ')}`, id);
  t.budget = 1_200_000;
  if (r.favouredOf) t.favoured = stars.some((x) => STAR_BY_ID[x].playsFor.includes('Favoured of Nurgle')) ? 'Nurgle' : 'Undivided';
  // The League every Star Player plays for.
  t.league = r.leagues.find((l) => stars.every((x) => starPlaysFor(STAR_BY_ID[x], l, teamSpecialRules({ ...t, league: l })))) ?? r.leagues[0];
  for (const x of stars) addStar(t, x, () => `${id}-s${t.players.length}`);
  const line = r.positions.find((x) => x.keywords.includes('Lineman') && x.qty.endsWith('16')) ?? r.positions[0];
  let n = 1;
  while (t.players.length < 11 || (t.players.length < 13 && teamCost(t).total + line.cost + r.rerollCost <= t.budget)) {
    const used = new Set(t.players.map((q) => q.number));
    while (used.has(n)) n++;
    t.players.push(playerFromRoster(r, line.id, n, `${id}-l${n}`));
  }
  while (t.rerolls < 3 && teamCost({ ...t, rerolls: t.rerolls + 1 }).total <= t.budget) t.rerolls++;
  return t;
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

const lines: string[] = [];
let bad = 0;
MATCHES.forEach(([[ra, sa], [rb, sb]], i) => {
  const a = team(`a${i}`, ra, sa);
  const b = team(`b${i}`, rb, sb);
  const errs = [...validateTeamDef(a), ...validateTeamDef(b)].filter((x) => x.level === 'error').map((x) => x.text);
  const seed = firstSeed + i;
  if (errs.length) {
    bad++;
    lines.push(`| ${a.name} | ${b.name} | ${seed} | - | team errors: ${errs.join('; ')} | | |`);
    console.error(`${ra} v ${rb}: team errors ${errs.join('; ')}`);
    return;
  }
  const t0 = Date.now();
  let res: ReturnType<typeof play>;
  try {
    res = play(a, b, seed);
  } catch (e) {
    bad++;
    lines.push(`| ${a.name} | ${b.name} | ${seed} | - | exception: ${(e as Error).message} | | |`);
    return;
  }
  const s = res.s;
  const used = new Map<string, number>();
  for (const e of s.log) for (const v of e.events) if (v.data?.star) used.set(String(v.data.star), (used.get(String(v.data.star)) ?? 0) + 1);
  const stars = [...sa, ...sb];
  // V5 step 6: rules the computer chose to use at the start of an activation (inputs with starRule).
  const started = new Map<string, number>();
  for (const e of s.log) {
    if (e.input?.kind !== 'playerAction' || !e.input.starRule) continue;
    const who = s.players.find((q) => q.id === (e.input as { playerId: string }).playerId)?.star ?? '?';
    started.set(who, (started.get(who) ?? 0) + 1);
  }
  const seen = stars.filter((x) => used.has(x)).map((x) => `${STAR_BY_ID[x].name}: ${STAR_BY_ID[x].rule.name} ×${used.get(x)}${started.has(x) ? ` (the computer started it ×${started.get(x)})` : ''}`);
  const notSeen = stars.filter((x) => !used.has(x)).map((x) => STAR_BY_ID[x].name);
  if (res.illegal.length) bad++;
  lines.push(`| ${a.name} | ${b.name} | ${seed} | ${s.teams.A.score}-${s.teams.B.score}${s.phase === 'fullTime' ? '' : ` (${s.phase})`} | ${res.illegal.length ? res.illegal.slice(0, 2).join('; ') : '0'} | ${seen.join('; ') || '—'} | ${notSeen.join(', ') || '—'} |`);
  console.error(`${ra} v ${rb}: ${s.teams.A.score}-${s.teams.B.score}, ${res.steps} steps, ${res.illegal.length} illegal, ${Math.round((Date.now() - t0) / 1000)} s`);
});
if (md) {
  console.log('| Home (balanced) | Away (offensive) | Seed | Score | Illegal inputs | Star Player rules used (log) | Not used in this match |');
  console.log('|---|---|---|---|---|---|---|');
}
for (const l of lines) console.log(l);
console.error(`\n${MATCHES.length} matches, ${bad} with illegal inputs or errors.`);
process.exit(bad ? 1 : 0);
