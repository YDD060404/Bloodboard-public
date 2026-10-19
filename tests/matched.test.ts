/**
 * V5 step 6, item 4: Tournament play = Matched Play, format by format (rulebook pp.110-113; Spike! Journal 22
 * pp.18-19). Skill Points by Tier, what they buy, their limits — and that the 11-a-side rules are never applied to
 * Sevens teams, League teams or Exhibition teams.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addStar,
  createMatch,
  MATCHED,
  newTeamDef,
  playerFromRoster,
  ROSTER_BY_ID,
  setVeteran,
  skillPointAllowance,
  SOURCE_TIERS,
  sourceTier,
  starAddReason,
  teamBudget,
  teamCost,
  teamSkillPoints,
  validateTeamDef,
  type TeamDef,
} from '../src/engine/index';

const errs = (t: TeamDef) => validateTeamDef(t).filter((i) => i.level === 'error').map((i) => i.text);
let k = 0;
const nid = () => `x${++k}`;

function eleven(rosterId: string, pos: string, n = 11, play?: 'tournament' | 'exhibition'): TeamDef {
  const t = newTeamDef('tournament', rosterId, `${rosterId} t`, nid());
  for (let i = 1; i <= n; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, i, `${t.id}-${i}`));
  const r = ROSTER_BY_ID[rosterId];
  if (r.leagues.length > 1) t.league = r.leagues[0];
  if (play) t.play = play;
  return t;
}

function sevens(rosterId: string, pos: string, n = 7): TeamDef {
  const t = newTeamDef('tournament', rosterId, `${rosterId} 7s`, nid(), 'sevens');
  for (let i = 1; i <= n; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, i, `${t.id}-${i}`));
  setVeteran(t, t.players[0].id);
  t.play = 'tournament';
  return t;
}

test('the tables as printed: 11-a-side Tier 1-4 = 6/8/9/10 Skill Points (p.112); Sevens 1/2/3/4 (Spike! 22 p.19)', () => {
  assert.deepEqual(MATCHED.standard.skillPoints, { 1: 6, 2: 8, 3: 9, 4: 10 });
  assert.deepEqual(MATCHED.standard.secondaryMax, { 1: 1, 2: 2, 3: 3, 4: 4 });
  assert.equal(MATCHED.standard.eliteMax, 4);
  assert.equal(MATCHED.standard.starCost, 2);
  assert.deepEqual(MATCHED.standard.starsMax, { 1: 1, 2: 2, 3: 2, 4: 2 });
  assert.deepEqual(MATCHED.standard.budgets, [1_100_000, 1_150_000, 1_200_000]);
  assert.deepEqual(MATCHED.sevens.skillPoints, { 1: 1, 2: 2, 3: 3, 4: 4 });
  assert.equal(MATCHED.sevens.eliteMax, 2);
  assert.deepEqual(MATCHED.sevens.secondaryMax, { 1: 1, 2: 1, 3: 1, 4: 1 });
  // Tiers the sources state (the full lists are in the Designers' Commentary).
  assert.equal(sourceTier('norse', 'sevens')?.tier, 1);
  assert.equal(sourceTier('goblin', 'sevens')?.tier, 4);
  assert.equal(sourceTier('chaosChosen', 'sevens')?.tier, 2);
  assert.equal(sourceTier('woodElf', 'standard')?.tier, 1);
  // V5.5: the 11-a-side Tiers come from the May 2026 list; a Sevens Tier is only taken from Spike! 22, never from it.
  assert.match(sourceTier('norse', 'standard')?.ref ?? '', /May 2026/);
  assert.match(sourceTier('norse', 'sevens')?.ref ?? '', /Spike! 22/);
  assert.ok(Object.keys(SOURCE_TIERS.sevens).length === 3);
});

test('a Tournament team needs a Tier; its Skill Points buy Primary (1) and Secondary (2) skills, one per player', () => {
  const t = eleven('human', 'lineman', 11, 'tournament');
  assert.ok(errs(t).some((e) => /Choose the team's Tier/.test(e)));
  t.tier = 1;
  assert.deepEqual(errs(t), []);
  assert.equal(skillPointAllowance(t), 6);
  // Human Lineman: Primary G, Secondary A / S (roster p.?). Block (G) = 1, Dodge (A) = 2 (Secondary).
  t.players[0].boughtSkill = 'block';
  t.players[1].boughtSkill = 'dodge';
  let u = teamSkillPoints(t);
  assert.deepEqual([u.primary, u.secondary, u.spent, u.elite], [1, 1, 3, 2]);
  assert.deepEqual(errs(t), []);
  // Tier 1: at most one Secondary skill.
  t.players[2].boughtSkill = 'catch';
  u = teamSkillPoints(t);
  assert.equal(u.secondary, 2);
  assert.ok(errs(t).some((e) => /2 Secondary skills: a Tier 1 team may buy at most 1/.test(e)), errs(t).join(' | '));
  t.tier = 2;
  assert.ok(!errs(t).some((e) => /Secondary skills/.test(e)));
  // Over the allowance.
  t.tier = 1;
  t.players[2].boughtSkill = 'tackle';
  for (let i = 3; i < 7; i++) t.players[i].boughtSkill = 'wrestle';
  assert.equal(teamSkillPoints(t).spent, 8);
  assert.ok(errs(t).some((e) => /Skill Points: 8 spent, but a Tier 1 team has 6/.test(e)));
  // Not a skill of the player's categories; a skill the player already has.
  const t2 = eleven('human', 'lineman', 11, 'tournament');
  t2.tier = 4;
  t2.players[0].boughtSkill = 'mightyBlow';
  assert.ok(!errs(t2).some((e) => /neither a Primary nor a Secondary/.test(e)), 'Mighty Blow (S) is a Human Lineman Secondary');
  t2.players[0].boughtSkill = 'claws';
  assert.ok(errs(t2).some((e) => /Claws is neither a Primary nor a Secondary skill/.test(e)), errs(t2).join(' | '));
  // Skills bought do not add to the team's cost (p.112).
  const c0 = teamCost(t2).total;
  t2.players[0].boughtSkill = 'block';
  assert.equal(teamCost(t2).total, c0);
});

test('Elite skills at most four times (p.112); Star Players cost 2 Skill Points and Tier 1 teams hire at most one (p.113)', () => {
  const t = eleven('human', 'lineman', 11, 'tournament');
  t.tier = 4;
  for (let i = 0; i < 5; i++) t.players[i].boughtSkill = 'block';
  assert.ok(errs(t).some((e) => /5 × Block bought.*at most 4 times/.test(e)), errs(t).join(' | '));
  // FAQ May 2026 p.112: each INDIVIDUAL Elite skill may be taken four times; there is no combined cap. Four Block + four Dodge is not rejected by the cap.
  const mixed = eleven('human', 'lineman', 11, 'tournament');
  mixed.tier = 4;
  for (let i = 0; i < 4; i++) mixed.players[i].boughtSkill = 'block';
  for (let i = 4; i < 8; i++) mixed.players[i].boughtSkill = 'dodge';
  assert.deepEqual([teamSkillPoints(mixed).elite, teamSkillPoints(mixed).eliteMostSame], [8, 4]);
  assert.ok(!errs(mixed).some((e) => /individual Elite skill/.test(e)), errs(mixed).join(' | '));
  mixed.players[8].boughtSkill = 'dodge';
  assert.ok(errs(mixed).some((e) => /5 × Dodge bought/.test(e)), errs(mixed).join(' | '));
  const s = eleven('human', 'lineman', 10, 'tournament');
  s.budget = 1_200_000;
  assert.match(addStarReason(s, 'griff'), /Choose the team's Tier first/);
  s.tier = 1;
  addStar(s, 'helmut', nid);
  assert.equal(teamSkillPoints(s).stars, 2);
  assert.equal(teamSkillPoints(s).spent, 2);
  assert.match(addStarReason(s, 'griff'), /Tier 1 team may have at most 1 Star Player/);
  s.tier = 2;
  assert.equal(addStarReason(s, 'griff'), '');
  // V5.5: Griff Oberwald is a Mega-star on the May 2026 list — 4 Skill Points.
  addStar(s, 'griff', nid);
  assert.equal(teamSkillPoints(s).stars, 2 + 4);
  assert.equal(teamSkillPoints(s).megaStars, 1);
  // Star Players cannot be given skills.
  s.players.find((p) => p.star === 'griff')!.boughtSkill = 'tackle';
  assert.ok(errs(s).some((e) => /Star Players cannot be given additional skills/.test(e)));
});

function addStarReason(t: TeamDef, id: string): string {
  return starAddReason(t, id) ?? '';
}

test('Matched Play team building: budget 1,100,000 by default (1,150,000 / 1,200,000), Dedicated Fans from 0 (p.110)', () => {
  const t = eleven('human', 'lineman', 11, 'tournament');
  t.tier = 3;
  assert.equal(teamBudget(t), 1_100_000);
  t.dedicatedFans = 0;
  assert.deepEqual(errs(t), []);
  assert.equal(teamCost(t).fans, 0);
  t.dedicatedFans = 2;
  assert.equal(teamCost(t).fans, 10_000, 'each Dedicated Fan bought at 5,000 gp');
  const ex = eleven('human', 'lineman', 11);
  ex.dedicatedFans = 2;
  assert.equal(teamCost(ex).fans, 5_000, 'Exhibition keeps the draft template (Dedicated Fans from 1)');
  assert.ok(errs({ ...ex, dedicatedFans: 0 }).some((e) => /Dedicated Fans: 1-3/.test(e)));
});

test('Sevens Tournament: 1/2/3/4 Skill Points, ONE Secondary for the team, two Elite skills — never the 11-a-side table', () => {
  const t = sevens('norse', 'raider');
  t.league = 'Old World Classic';
  assert.ok(errs(t).some((e) => /Choose the team's Tier/.test(e)));
  t.tier = 1;
  assert.equal(skillPointAllowance(t), 1, 'Norse Sevens (Tier 1): 1 Skill Point — not 6');
  assert.deepEqual(errs(t), []);
  // Norse Raider: Primary G, Secondary A / P / S.
  t.players[1].boughtSkill = 'tackle';
  assert.deepEqual(errs(t), []);
  t.players[2].boughtSkill = 'dodge';
  assert.ok(errs(t).some((e) => /Skill Points: 3 spent, but a Tier 1 team has 1/.test(e)), errs(t).join(' | '));
  t.tier = 4;
  assert.deepEqual(errs(t), []);
  t.players[3].boughtSkill = 'mightyBlow';
  assert.ok(errs(t).some((e) => /a Sevens team may buy only one/.test(e)), errs(t).join(' | '));
  t.players[3].boughtSkill = 'guard';
  assert.ok(!errs(t).some((e) => /Elite/.test(e)), 'Dodge + Guard = 2 Elite skills');
  t.players[4].boughtSkill = 'guard';
  assert.ok(errs(t).some((e) => /3 Elite skills bought.*at most 2/.test(e)), errs(t).join(' | '));
  // Budget 600,000 and Dedicated Fans from 0 (Spike! 22 p.18).
  assert.equal(teamBudget(t), 600_000);
  t.dedicatedFans = 0;
  assert.ok(!errs(t).some((e) => /Dedicated Fans/.test(e)));
});

test('League and Exhibition teams never use Skill Points; a Tournament match adds the bought skills, an Exhibition match does not', () => {
  const lg = eleven('human', 'lineman', 11);
  lg.kind = 'league';
  lg.players[0].boughtSkill = 'block';
  assert.ok(errs(lg).some((e) => /League teams do not buy skills with Skill Points/.test(e)));
  assert.equal(skillPointAllowance(lg), 0);
  const ex = eleven('human', 'lineman', 11, 'exhibition');
  ex.tier = 4;
  assert.equal(skillPointAllowance(ex), 0, 'Exhibition: no Skill Points even with a Tier');
  ex.players[0].boughtSkill = 'block';
  assert.ok(validateTeamDef(ex).some((i) => i.level === 'warning' && /not used/.test(i.text)));
  const tn = eleven('human', 'lineman', 11, 'tournament');
  tn.tier = 2;
  tn.players[0].boughtSkill = 'block';
  const orc = eleven('orc', 'lineman', 11, 'tournament');
  orc.tier = 2;
  const r = createMatch('tournament', tn, orc, { rules: 'full' }, 3);
  assert.ok(r.ok, r.errors.join());
  const p1 = r.state!.players.find((p) => p.team === 'A' && p.number === 1)!;
  assert.ok(p1.skills.some((s) => s.id === 'block'), 'the bought Block is on the player in the match');
  const r2 = createMatch('tournament', ex, eleven('orc', 'lineman', 11), { rules: 'full' }, 3);
  assert.ok(r2.ok, r2.errors.join());
  assert.ok(!r2.state!.players.find((p) => p.team === 'A' && p.number === 1)!.skills.some((s) => s.id === 'block'), 'Exhibition: no purchased skills');
});
