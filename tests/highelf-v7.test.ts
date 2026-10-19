/**
 * V7.0.2 — the 2026 High Elf table (Spike! Journal 21 p.172), with the two disputed values adjudicated per field
 * (docs/HIGH_ELF_ADJUDICATION.md), exercised through the real load chain
 * ROSTER_BY_ID → playerFromRoster → playerCategories → validateTeamDef / buildTeam / teamValue.
 * Saved teams under the earlier table must still load (retired positions), keep their value and be explained, never silently remapped.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as E from '../src/engine/index';
import { buildTeam, newTeamDef, playerCategories, playerFromRoster, ROSTER_BY_ID, teamCost, validateTeamDef, findPosition, isRetiredPosition, SKILL_BY_ID, type TeamDef } from '../src/engine/index';

const he = ROSTER_BY_ID.highElf;
const errs = (t: TeamDef) => validateTeamDef(t).filter((i) => i.level === 'error').map((i) => i.text);
const row = (p: (typeof he.positions)[number]) => [p.id, p.name, p.qty, p.keywords.join('/'), p.ma, p.st, p.ag, p.pa, p.av, p.skills.map((s) => s.id).join('+') || '-', p.cost, p.primary.join(''), p.secondary.join('')].join('|');

test('the four current positions, quantities, profiles, skills, access and costs (Spike! 21 p.172 + adjudicated fields)', () => {
  assert.deepEqual(he.positions.map(row), [
    'lineman|High Elf Lineman|0-16|Elf/Lineman|6|3|2|3|9|-|65000|AG|S',
    'phoenixWarrior|Phoenix Warrior|0-2|Elf/Thrower|6|3|2|2|9|cloudBurster+pass+safePass|90000|AGP|S',
    'dragonPrince|Dragon Prince|0-2|Elf/Blitzer/Runner|8|3|2|4|9|block+myBall+steadyFooting|110000|AG|S',
    'whiteLion|White Lion|0-2|Elf/Blitzer|7|3|2|3|9|claws+wrestle|110000|AG|PS',
  ]);
  assert.equal(he.rerollCost, 50000); assert.equal(he.apothecary, true);
  assert.deepEqual(he.leagues, ['Elven Kingdoms League']); assert.deepEqual(he.specialRules, []);
  assert.equal(E.OFFICIAL_TIERS.tiers.highElf, 1);
});

test('My Ball is a mandatory passive Trait that comes with the Dragon Prince and is not a buyable skill', () => {
  const dp = playerFromRoster(he, 'dragonPrince', 1, 'p1');
  assert.ok(dp.skills.some((s) => s.id === 'myBall'));
  assert.equal(SKILL_BY_ID.myBall.category, 'Trait'); assert.equal(SKILL_BY_ID.myBall.mandatory, true); assert.equal(SKILL_BY_ID.myBall.active, false);
  const cats = playerCategories({ rosterId: 'highElf' }, dp);
  assert.deepEqual(cats.primary, ['A', 'G']); assert.ok(!cats.primary.concat(cats.secondary).includes('Trait' as never));
});

test('the recruitable list is only the four current positions; the earlier ones are retired, resolvable, never recruitable', () => {
  assert.deepEqual(he.positions.map((p) => p.id), ['lineman', 'phoenixWarrior', 'dragonPrince', 'whiteLion']);
  for (const id of ['thrower', 'catcher', 'blitzer']) {
    assert.equal(isRetiredPosition(he, id), true, id);
    assert.ok(findPosition(he, id), id);
    assert.throws(() => playerFromRoster(he, id, 1, 'x'), /Unknown position/);
  }
  assert.equal(isRetiredPosition(he, 'lineman'), false);
  // no other roster gained retired positions
  assert.deepEqual(Object.values(ROSTER_BY_ID).filter((r) => r.retiredPositions?.length).map((r) => r.id), ['highElf']);
});

test('drafted High Elf teams (Elite and Sevens) use only current positions and validate', () => {
  for (const format of ['standard', 'sevens'] as const) {
    const t = buildTeam('highElf', { format, play: 'tournament', tier: 1, id: `he-${format}` });
    assert.ok(t, format);
    assert.deepEqual(errs(t as TeamDef), [], format);
    for (const p of (t as TeamDef).players) assert.ok(he.positions.some((x) => x.id === p.positionId), `${format}: ${p.positionId}`);
  }
});

test('limits and profiles are enforced through the real validator', () => {
  const t = newTeamDef('tournament', 'highElf', 'HE', 'he-limits');
  for (let i = 0; i < 3; i++) t.players.push(playerFromRoster(he, 'dragonPrince', i + 1, `dp${i}`));
  for (let i = 0; i < 8; i++) t.players.push(playerFromRoster(he, 'lineman', i + 4, `l${i}`));
  assert.ok(errs(t).some((e) => /3 × Dragon Prince.*0-2/.test(e)));
  const bad = newTeamDef('tournament', 'highElf', 'HE', 'he-profile');
  for (let i = 0; i < 11; i++) bad.players.push(playerFromRoster(he, 'lineman', i + 1, `l${i}`));
  bad.players[0] = { ...bad.players[0], ma: 8 };
  assert.ok(errs(bad).some((e) => /roster profile unchanged/.test(e)));
});

test('a team saved under the earlier table still loads, keeps its value and access, and is explained in tournament play', () => {
  const old = he.retiredPositions!;
  const mk = (id: string, n: number) => {
    const o = old.find((x) => x.id === id)!;
    return { id: `old-${id}`, number: n, name: o.name, positionId: o.id, position: o.name, keywords: o.keywords.slice(), ma: o.ma, st: o.st, ag: o.ag, pa: o.pa, av: o.av, skills: o.skills.map((s) => ({ ...s })), spp: 0 } as unknown as TeamDef['players'][number];
  };
  const t = newTeamDef('league', 'highElf', 'Old Elves', 'he-old');
  for (let i = 0; i < 9; i++) t.players.push(playerFromRoster(he, 'lineman', i + 1, `l${i}`));
  t.players.push(mk('thrower', 10), mk('catcher', 11));
  assert.equal(teamCost(t).players, 9 * 65000 + 100000 + 90000, 'retired players keep the price they were hired at');
  const cats = playerCategories(t, t.players[9]);
  assert.equal(cats.fromRoster, true); assert.deepEqual(cats.primary, ['A', 'G', 'P']);
  const tour = { ...t, kind: 'tournament' as const };
  assert.ok(errs(tour).some((e) => /retired High Elf position.*can no longer be hired/.test(e)));
  assert.ok(!errs(t).some((e) => /is not a High Elf roster player/.test(e)), 'never reported as an unknown position');
});
