/**
 * V5.5 (request items 2-3): ready-made / computer teams for every roster, format and budget; Tournament Skill Points
 * spent legally; the official May 2026 Tiers and Mega-stars; League pre-match purchases (p.94) with temporary Star
 * Players and the Treasury.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addStar,
  buildTeam,
  computerPreMatch,
  createMatch,
  isEventTier,
  leagueMatchTeam,
  leagueStarOptions,
  MATCHED,
  MEGA_STAR_COST,
  newTeamDef,
  OFFICIAL_TIERS,
  playerFromRoster,
  preMatchFunds,
  ROSTER_BY_ID,
  ROSTERS,
  starAddReason,
  teamBudget,
  teamCost,
  teamSkillPoints,
  tierInfo,
  validateTeamDef,
  type TeamDef,
} from '../src/engine/index';

const errors = (t: TeamDef) => validateTeamDef(t).filter((i) => i.level === 'error').map((i) => i.text);
let nid = 0;
const newId = () => `x${++nid}`;

test('every roster: a legal ready-made team in both formats, Exhibition and Tournament, within the budget (ball handler / re-rolls where the roster allows)', () => {
  const failures: string[] = [];
  for (const r of ROSTERS) {
    for (const format of ['standard', 'sevens'] as const) {
      for (const play of ['exhibition', 'tournament'] as const) {
        const info = tierInfo(r.id, format);
        const t = buildTeam(r.id, { format, play, tier: play === 'tournament' ? info.tier ?? 2 : undefined, id: `${r.id}-${format}-${play}` });
        if (!t) {
          failures.push(`${r.id} ${format} ${play}: no team`);
          continue;
        }
        const e = errors(t);
        if (e.length) failures.push(`${r.id} ${format} ${play}: ${e.join(' | ')}`);
        const min = format === 'sevens' ? 7 : 11;
        if (t.players.length < min) failures.push(`${r.id} ${format} ${play}: ${t.players.length} players`);
        if (teamCost(t).total > teamBudget(t)) failures.push(`${r.id} ${format} ${play}: over budget`);
        if (t.rerolls < 1) failures.push(`${r.id} ${format} ${play}: no Team Re-roll`);
        if (play === 'tournament') {
          const sp = teamSkillPoints(t);
          if (sp.spent > sp.allowance) failures.push(`${r.id} ${format}: ${sp.spent}/${sp.allowance} Skill Points`);
          // A sensible allocation: Skill Points are not silently left unspent (at most 1 left over).
          if (sp.allowance - sp.spent > 1) failures.push(`${r.id} ${format}: only ${sp.spent} of ${sp.allowance} Skill Points spent`);
        } else if (t.players.some((p) => p.boughtSkill)) failures.push(`${r.id} ${format} exhibition: skills bought`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('the budget chosen is the allowance used: 11-a-side 1,000,000 / 1,100,000 / 1,200,000; Sevens 600,000; a custom budget is labelled', () => {
  for (const budget of [1_000_000, 1_100_000, 1_200_000]) {
    const t = buildTeam('human', { format: 'standard', play: 'exhibition', budget, id: `h${budget}` })!;
    assert.equal(teamBudget(t), budget);
    assert.ok(teamCost(t).total <= budget && teamCost(t).total > budget - 60_000, `${teamCost(t).total} of ${budget}: the money is used`);
  }
  const s = buildTeam('orc', { format: 'sevens', play: 'exhibition', id: 'o7' })!;
  assert.equal(teamBudget(s), 600_000);
  const custom = buildTeam('orc', { format: 'sevens', play: 'exhibition', budget: 750_000, budgetCustom: true, id: 'o7c' })!;
  assert.equal(teamBudget(custom), 750_000);
  assert.ok(validateTeamDef(custom).some((i) => /custom/i.test(i.text)), 'the custom budget is labelled');
  assert.deepEqual(errors(custom), []);
});

test('official May 2026 Tiers for the listed rosters; the legacy Slann has none (an event Tier must be chosen); Sevens uses Spike! 22 or a labelled suggestion', () => {
  const listed = Object.keys(OFFICIAL_TIERS.tiers);
  assert.equal(listed.length, 30);
  for (const id of listed) {
    assert.ok(ROSTER_BY_ID[id], `roster ${id} exists`);
    const i = tierInfo(id, 'standard');
    assert.equal(i.kind, 'official');
    assert.equal(i.tier, OFFICIAL_TIERS.tiers[id]);
  }
  const unlisted = ROSTERS.filter((r) => !listed.includes(r.id)).map((r) => r.id);
  for (const id of unlisted) {
    assert.equal(tierInfo(id, 'standard').tier, null, `${id}: no invented Tier`);
    assert.equal(isEventTier(id, 'standard', 2), true, `${id}: any Tier is event-specific`);
  }
  assert.equal(tierInfo('dwarf', 'standard').tier, 2, 'Dwarf moved to Tier 2 (May 2026)');
  assert.equal(tierInfo('norse', 'sevens').kind, 'source');
  assert.equal(tierInfo('orc', 'sevens').kind, 'suggested');
  assert.equal(isEventTier('orc', 'standard', 2), false);
  assert.equal(isEventTier('orc', 'standard', 3), true);
  assert.deepEqual(MATCHED.standard.skillPoints, { 1: 6, 2: 8, 3: 9, 4: 10 });
});

test('Mega-stars cost 4 Skill Points and a team may have only one (May 2026 list, p.113)', () => {
  const t = buildTeam('human', { format: 'standard', play: 'tournament', tier: 2, budget: 1_200_000, id: 'mega', skills: false })!;
  // Room for two Star Players: drop players down to the minimum first.
  while (t.players.length > 9) t.players.pop();
  addStar(t, 'griff', newId);
  assert.equal(teamSkillPoints(t).stars, MEGA_STAR_COST);
  const why = starAddReason(t, 'morgNThorg') ?? '';
  assert.match(why, /Mega-star|one Mega|budget|Costs/i, why);
});

function leagueTeam(id: string, rosterId: string, comp: Array<[string, number]>, treasury: number): TeamDef {
  const t = newTeamDef('league', rosterId, `${rosterId} ${id}`, id);
  let n = 1;
  for (const [pos, k] of comp) for (let i = 0; i < k; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, n, `${id}-${n++}`));
  t.rerolls = 2;
  t.treasury = treasury;
  return t;
}

test('League pre-match (p.94): Petty Cash for the lower CTV, the higher team spends Treasury first, temporary Star Players, the saved team unchanged', () => {
  const rich = leagueTeam('rich', 'human', [['blitzer', 4], ['catcher', 2], ['thrower', 2], ['lineman', 4]], 120_000);
  const poor = leagueTeam('poor', 'human', [['lineman', 11]], 60_000);
  const f = preMatchFunds(rich, poor, 0);
  assert.equal(f.higher, 'A');
  assert.equal(f.funds.A.pettyCash, 0);
  assert.equal(f.funds.A.treasuryMax, 120_000);
  assert.equal(f.funds.B.pettyCash, f.ctv.A - f.ctv.B);
  assert.equal(f.funds.B.treasuryMax, 50_000, 'the lower team may add up to 50,000 gp of Treasury');
  const f2 = preMatchFunds(rich, poor, 40_000);
  assert.equal(f2.funds.B.pettyCash, f.funds.B.pettyCash + 40_000, 'what the higher team spent is added to the Petty Cash');
  // A Star Player for the poorer team from its Petty Cash: temporary, with its printed profile.
  const opts = leagueStarOptions(poor, { inducements: {}, stars: [] }, f.funds.B.pettyCash + f.funds.B.treasuryMax);
  const affordable = opts.find((o) => !o.reason && !o.pair);
  assert.ok(affordable, 'a Star Player is affordable');
  const before = JSON.stringify(poor);
  const m = leagueMatchTeam(poor, { inducements: { bribe: 1 }, stars: [affordable!.id] }, f.funds.B, f.ctv.B);
  assert.ok(m.ok, m.ok ? '' : m.errors.join());
  if (!m.ok) return;
  assert.equal(JSON.stringify(poor), before, 'the saved team is not changed');
  const star = m.team.players.find((p) => p.star === affordable!.id)!;
  assert.equal(star.temporary, true, 'the Star Player is a temporary hire');
  assert.equal(m.team.inducements?.bribe, 1);
  // Too expensive: refused with the reason.
  const tooMuch = leagueMatchTeam(poor, { inducements: { bribe: 1, wanderingApothecary: 1, extraTraining: 3 }, stars: [affordable!.id] }, { pettyCash: 0, treasuryMax: 0 }, f.ctv.B);
  assert.equal(tooMuch.ok, false);
  // The computer's own choice fits its Petty Cash, and the match starts with the hire on the pitch roster.
  const cpu = computerPreMatch(poor, f.funds.B);
  const mc = leagueMatchTeam(poor, cpu, f.funds.B, f.ctv.B);
  assert.ok(mc.ok);
  const ma = leagueMatchTeam(rich, { inducements: {}, stars: [] }, f.funds.A, f.ctv.A);
  assert.ok(ma.ok && mc.ok);
  if (!ma.ok || !mc.ok) return;
  const r = createMatch('league', ma.team, mc.team, { rules: 'full' }, 4);
  assert.ok(r.ok, r.errors.join(' | '));
  assert.equal(r.state!.match!.preMatch?.B?.pettyCash, f.funds.B.pettyCash);
  if (cpu.stars.length) assert.ok(r.state!.players.some((p) => p.team === 'B' && p.star === cpu.stars[0]));
});
