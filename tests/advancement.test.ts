/**
 * V4: League player advancement (pp.96-97, Skill Table p.121, limits p.37).
 * The functions take the dice results as input, so every case here uses
 * fixed faces.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADVANCEMENT_COSTS,
  advancementBlocked,
  advancementCost,
  advancementValue,
  applyAdvancement,
  charOptions,
  charRestriction,
  eligibleSkills,
  mustAdvance,
  rollRandomSkill,
  SKILL_TABLE,
  skillFromTable,
  skillRestriction,
  type AdvancingPlayer,
} from '../src/engine/advancement';
import { SKILL_BY_ID } from '../src/engine/skills';

const lineman = (o: Partial<AdvancingPlayer> = {}): AdvancingPlayer => ({ ma: 6, st: 3, ag: 3, pa: 4, av: 9, skills: [], primary: ['G'], secondary: ['A', 'S'], spp: 0, advancements: [], ...o });
const dice = (faces: number[]) => {
  let i = 0;
  return () => {
    if (i >= faces.length) throw new Error('out of dice');
    return faces[i++];
  };
};

test('Skill Table (p.121): every entry is a known Skill (not a Trait); the rulebook\'s Halfling example', () => {
  for (const [cat, ids] of Object.entries(SKILL_TABLE)) {
    assert.equal(ids.length, 12, cat);
    for (const id of ids) {
      assert.ok(SKILL_BY_ID[id], id);
      assert.notEqual(SKILL_BY_ID[id].category, 'Trait', id);
    }
  }
  // "His first roll is a 4 and his second roll is a 2 … he first rolls a 3 and then rolls a 5": Leap or Defensive.
  assert.equal(skillFromTable('A', 4, 2), 'leap');
  assert.equal(skillFromTable('A', 3, 5), 'defensive');
  assert.equal(skillFromTable('G', 1, 1), 'block');
  assert.equal(skillFromTable('S', 6, 6), 'thickSkull');
  assert.equal(skillFromTable('P', 4, 3), 'onTheBall');
  assert.equal(skillFromTable('D', 2, 6), 'pileDriver');
});

test('Advancement Table (p.97): cost by type and by advancements already taken; a Legend cannot advance', () => {
  assert.deepEqual(ADVANCEMENT_COSTS.randomPrimary, [3, 4, 6, 8, 10, 15]);
  assert.deepEqual(ADVANCEMENT_COSTS.primary, [6, 8, 12, 16, 20, 30]);
  assert.deepEqual(ADVANCEMENT_COSTS.secondary, [10, 12, 16, 20, 24, 34]);
  assert.deepEqual(ADVANCEMENT_COSTS.characteristic, [14, 16, 20, 24, 28, 38]);
  const p = lineman({ spp: 100, advancements: [{ kind: 'primary', skill: 'block', spp: 6, value: 30000 }, { kind: 'primary', skill: 'tackle', spp: 8, value: 20000 }] });
  assert.equal(advancementCost(p, 'secondary'), 16, 'third advancement');
  const legend = lineman({ spp: 100, advancements: Array.from({ length: 6 }, () => ({ kind: 'primary' as const, spp: 1, value: 0 })) });
  assert.equal(advancementCost(legend, 'primary'), null);
  assert.match(advancementBlocked(legend, 'primary') ?? '', /Legend/);
  assert.match(advancementBlocked(lineman({ spp: 5 }), 'primary') ?? '', /Needs 6 SPP/);
  assert.equal(advancementBlocked(lineman({ spp: 3 }), 'randomPrimary'), null);
});

test('A player must advance once they have enough SPP for a Characteristic Improvement (p.96)', () => {
  assert.equal(mustAdvance(lineman({ spp: 13 })), false);
  assert.equal(mustAdvance(lineman({ spp: 14 })), true);
});

test('Skills a player may not take: one they have, and those their Skills and Traits exclude', () => {
  const p = lineman({ skills: [{ id: 'block' }, { id: 'frenzy' }] });
  assert.match(skillRestriction(p, 'block') ?? '', /Already/);
  assert.match(skillRestriction(p, 'multipleBlock') ?? '', /Frenzy/);
  assert.match(skillRestriction(lineman({ skills: [{ id: 'multipleBlock' }] }), 'frenzy') ?? '', /Multiple Block/);
  assert.match(skillRestriction(lineman(), 'saboteur') ?? '', /Secret Weapon/);
  assert.match(skillRestriction(lineman(), 'lethalFlight') ?? '', /Right Stuff/);
  assert.match(skillRestriction(lineman(), 'strongArm') ?? '', /Throw Team-mate/);
  assert.equal(skillRestriction(lineman({ skills: [{ id: 'throwTeamMate' }] }), 'strongArm'), null);
  assert.ok(!eligibleSkills(p, 'G').includes('block'));
  assert.ok(!eligibleSkills(p, 'G').includes('frenzy'));
});

test('Random Primary Skill: two rolls, the coach chooses one; a skill the player has (or cannot use) is rolled again', () => {
  const p = lineman({ skills: [{ id: 'block' }], spp: 3 });
  // G: 1,1 = Block (has it) → rolled again: 2,4 = Frenzy; second: 5,4 = Tackle.
  const r = rollRandomSkill(p, 'G', dice([1, 1, 2, 4, 5, 4]));
  assert.deepEqual(r.rolls, [[1, 1], [2, 4], [5, 4]]);
  assert.deepEqual(r.choices, ['frenzy', 'tackle']);
  const same = rollRandomSkill(lineman(), 'G', dice([6, 4, 6, 4]));
  assert.deepEqual(same.choices, ['tackle'], 'the same Skill twice: that one');
  const out = applyAdvancement(p, { kind: 'randomPrimary', cat: 'G', skill: 'tackle', rolls: r.rolls });
  assert.ok(out.skills.some((s) => s.id === 'tackle'));
  assert.equal(out.spp, 0);
  assert.equal(out.advancements!.length, 1);
  assert.equal(out.advancements![0].value, 20000);
  assert.deepEqual(out.advancements![0].rolls, r.rolls);
  assert.throws(() => applyAdvancement(p, { kind: 'randomPrimary', cat: 'G', skill: 'wrestle', rolls: r.rolls }), /randomly rolled/);
  assert.equal(p.skills.length, 1, 'the input player is not changed');
  // A re-roll in the second pick: G 6,4 Tackle; then 1,1 Block (has it) → 3,5 Kick. The choices are Tackle or Kick.
  const r2 = rollRandomSkill(p, 'G', dice([6, 4, 1, 1, 3, 5]));
  assert.deepEqual(r2.choices, ['tackle', 'kick']);
  for (const skill of r2.choices) assert.ok(applyAdvancement(p, { kind: 'randomPrimary', cat: 'G', skill, rolls: r2.rolls }).skills.some((s) => s.id === skill), skill);
  assert.throws(() => applyAdvancement(p, { kind: 'randomPrimary', cat: 'G', skill: 'block', rolls: r2.rolls }), /Already|randomly rolled/);
});

test('Chosen Primary / Secondary Skill: category checks, Elite value (+10,000), SPP spent', () => {
  const p = lineman({ spp: 30 });
  const a = applyAdvancement(p, { kind: 'primary', cat: 'G', skill: 'block' });
  assert.equal(a.spp, 24);
  assert.equal(a.advancements![0].value, 30000, 'Primary 20,000 + Elite 10,000');
  const b = applyAdvancement(a, { kind: 'secondary', cat: 'S', skill: 'guard' });
  assert.equal(b.spp, 24 - 12, 'second advancement: Secondary 12 SPP');
  assert.equal(b.advancements![1].value, 50000);
  assert.equal(advancementValue(b), 80000);
  assert.throws(() => applyAdvancement(p, { kind: 'primary', cat: 'S', skill: 'guard' }), /not one of this player's Primary/);
  assert.throws(() => applyAdvancement(p, { kind: 'secondary', cat: 'A', skill: 'guard' }), /not an Agility skill/);
});

test('Characteristic Improvement (p.97): the D8 table, the limits (p.37), at most twice, or a skill instead', () => {
  const p = lineman({ spp: 100 });
  assert.deepEqual(charOptions(p, 1), ['av']);
  assert.deepEqual(charOptions(p, 7), ['ag', 'st']);
  assert.deepEqual(charOptions(p, 8), ['ma', 'st', 'ag', 'pa', 'av']);
  const st = applyAdvancement(p, { kind: 'characteristic', d8: 7, char: 'st' });
  assert.equal(st.st, 4);
  assert.equal(st.advancements![0].value, 60000);
  const ag = applyAdvancement(p, { kind: 'characteristic', d8: 6, char: 'ag' });
  assert.equal(ag.ag, 2, 'AG 3+ → 2+');
  const av = applyAdvancement(p, { kind: 'characteristic', d8: 1, char: 'av' });
  assert.equal(av.av, 10);
  assert.throws(() => applyAdvancement(p, { kind: 'characteristic', d8: 1, char: 'st' }), /does not allow/);
  const twice = applyAdvancement(applyAdvancement(p, { kind: 'characteristic', d8: 1, char: 'av' }), { kind: 'characteristic', d8: 1, char: 'av' });
  assert.equal(twice.av, 11);
  assert.match(charRestriction(twice, 'av') ?? '', /twice|maximum/);
  assert.deepEqual(charOptions(twice, 1), []);
  assert.match(charRestriction(lineman({ ma: 9 }), 'ma') ?? '', /maximum/);
  assert.match(charRestriction(lineman({ ag: 1 }), 'ag') ?? '', /best/);
  assert.match(charRestriction(lineman({ pa: null }), 'pa') ?? '', /cannot be improved/);
  // Instead of the rolled characteristic, a chosen Primary or Secondary Skill (the Characteristic SPP are still spent).
  const inst = applyAdvancement(p, { kind: 'characteristic', d8: 1, skill: 'dodge', cat: 'A', as: 'secondary' });
  assert.equal(inst.spp, 100 - 14);
  assert.ok(inst.skills.some((s) => s.id === 'dodge'));
  assert.equal(inst.advancements![0].value, 50000, 'Secondary 40,000 + Elite 10,000');
});
