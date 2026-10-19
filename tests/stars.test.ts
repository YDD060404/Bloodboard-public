/**
 * V5 step 5: Star Players (Inducement p.148, Plays For p.194, cards pp.195-211) — hiring on a Tournament /
 * Exhibition Team Draft List, and every implemented Star Player special rule in play.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addStar,
  createMatch,
  defaultFormation,
  newTeamDef,
  playerFromRoster,
  ROSTER_BY_ID,
  setCaptain,
  STAR_BY_ID,
  STAR_RULES_IMPLEMENTED,
  starAddReason,
  STARS,
  starsCost,
  teamCost,
  validateState,
  validateTeamDef,
  type ActionInput,
  type DecisionRequest,
  type ExecutionResult,
  type GameState,
  type Player,
  type PlayerActionInput,
  type TeamDef,
  type TeamId,
} from '../src/engine/index';
import { c, p, Pos, runScripted } from './helpers';

const errs = (t: TeamDef) => validateTeamDef(t).filter((i) => i.level === 'error').map((i) => i.text);
const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');

function team(id: string, rosterId: string, n = 11, pos = 'lineman'): TeamDef {
  const t = newTeamDef('tournament', rosterId, `${rosterId} ${id}`, id);
  for (let i = 1; i <= n; i++) t.players.push(playerFromRoster(ROSTER_BY_ID[rosterId], pos, i, `${id}-${i}`));
  const r = ROSTER_BY_ID[rosterId];
  if (r.leagues.length > 1) t.league = r.leagues[0];
  if (r.favouredOf) t.favoured = 'Undivided';
  return t;
}
let uid = 0;
const nid = () => `sp-${++uid}`;

/** Put Star Player `id` on the pitch of a practice position (its printed profile, skills and keywords). */
function star(P: Pos, t: TeamId, id: string, at: { x: number; y: number }, pid: string): Player {
  const st = STAR_BY_ID[id];
  const pl = P.add(t, t === 'A' ? 'human' : 'orc', 'lineman', at, { id: pid, ma: st.ma, st: st.st, ag: st.ag, pa: st.pa, av: st.av, skills: st.skills.map((k) => ({ ...k })) });
  pl.star = id;
  pl.position = st.name;
  pl.keywords = st.keywords.slice();
  return pl;
}

/** Answers: `pick` first, then sensible defaults. Records every decision asked. */
function play(s: GameState, input: ActionInput, faces: number[], pick: Record<string, string | ((r: DecisionRequest) => string)> = {}): { r: ExecutionResult; asked: DecisionRequest[] } {
  const asked: DecisionRequest[] = [];
  const r = runScripted(s, input, faces, (req) => {
    if (!asked.some((a) => a.id === req.id)) asked.push(req);
    const ids = req.options.map((o) => o.id);
    const want = pick[req.type];
    if (want !== undefined) return typeof want === 'function' ? want(req) : want;
    if (req.type === 'reroll') return ids.includes('none') ? 'none' : ids[ids.length - 1];
    if (req.type === 'followUp') return 'no';
    if (req.type === 'mightyBlow' || req.type === 'dirtyPlayer') return ids.includes('save') ? 'save' : 'no';
    if (['taunt', 'fend', 'standFirm', 'wrestle', 'stripBall', 'juggernaut', 'argueTheCall', 'bribe', 'skill'].includes(req.type)) return ids.includes('no') ? 'no' : ids.includes('both') ? 'both' : ids[ids.length - 1];
    if (req.type === 'starRule') return ids.includes('armour') ? 'armour' : 'use';
    return ids[0];
  });
  return { r, asked };
}
const blockIn = (id: string, t: string): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'block', path: [], blockTarget: t });
const blitzIn = (id: string, t: string): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'blitz', path: [], blitzTarget: t, blockTarget: t });
const optIds = (asked: DecisionRequest[], type: string) => asked.filter((a) => a.type === type).flatMap((a) => a.options.map((o) => o.id));

// ---------------------------------------------------------------------------
// The list and hiring them
// ---------------------------------------------------------------------------

test('the Star Players list (pp.195-211): 66 cards, three pairs paid once, "Plays For" as printed', () => {
  assert.equal(STARS.length, 66);
  assert.deepEqual(STARS.filter((s) => s.pair).map((s) => s.id).sort(), ['crumbleberry', 'dribl', 'drull', 'grak', 'lucien', 'valen']);
  assert.equal(starsCost([{ star: 'grak' }, { star: 'crumbleberry' }]), 250000, 'Grak & Crumbleberry: 250,000 gp for both');
  assert.equal(starsCost([{ star: 'lucien' }, { star: 'valen' }, { star: 'morgNThorg' }]), 640000);
  const m = STAR_BY_ID.morgNThorg;
  assert.deepEqual([m.cost, m.ma, m.st, m.ag, m.pa, m.av, m.except], [340000, 6, 6, 3, 4, 11, ['Sylvanian Spotlight']]);
  assert.deepEqual(STAR_BY_ID.hthark.playsFor, ['Badlands Brawl', 'Favoured of Hashut']);
  for (const id of STAR_RULES_IMPLEMENTED) assert.ok(STAR_BY_ID[id], id);
  for (const s of STARS) assert.ok(s.skills.some((k) => k.id === 'loner'), `${s.name} has Loner`);
});

test('hiring Star Players (p.148): Plays For, at most two (a pair counts once), 16 players, cost from the Team Draft Budget', () => {
  const t = team('h', 'human');
  assert.equal(starAddReason(t, 'lordBorak'), 'Plays for Chaos Clash (p.194).');
  assert.equal(starAddReason(t, 'morgNThorg'), null, 'Morg plays for any team except the Sylvanian Spotlight');
  assert.match(starAddReason(team('v', 'vampire', 11, 'thrall'), 'morgNThorg') ?? '', /except Sylvanian Spotlight/);
  addStar(t, 'morgNThorg', nid);
  assert.equal(teamCost(t).inducements, 340000);
  assert.equal(teamCost(t).total, 11 * 50000 + 340000);
  assert.deepEqual(errs(t), []);
  addStar(t, 'griff', nid);
  assert.ok(errs(t).some((e) => /over the 1,000,000 gp Team Draft Budget/.test(e)));
  t.budget = 1_200_000;
  assert.deepEqual(errs(t), [], '1,190,000 gp within a 1,200,000 gp budget');
  assert.match(starAddReason(t, 'mightyZug') ?? '', /At most 2 Star Players/);
  // A pair is added together and counts as ONE Star Player choice (p.148), paid once.
  const lz = team('lz', 'lizardmen', 9, 'skink');
  lz.budget = 1_200_000;
  addStar(lz, 'dribl', nid);
  assert.deepEqual(lz.players.filter((q) => q.star).map((q) => q.star), ['dribl', 'drull']);
  assert.equal(teamCost(lz).inducements, 230000);
  assert.equal(starAddReason(lz, 'karla'), null, 'the pair is one choice: a second Star Player may still be hired');
  addStar(lz, 'karla', nid);
  assert.match(starAddReason(lz, 'anqiPanqi') ?? '', /At most 2 Star Players/);
  assert.deepEqual(errs(lz).filter((e) => !/costs/.test(e)), []);
  lz.players = lz.players.filter((q) => q.star !== 'drull');
  assert.ok(errs(lz).some((e) => /Dribl must be hired together with Drull/.test(e)));
  // League and Sevens teams cannot hire them yet.
  const liz = team('l', 'lizardmen', 11, 'skink');
  assert.equal(starAddReason(liz, 'boa'), null, 'every Star Player can be hired now (all 66 special rules are implemented)');
  const league = team('lg', 'human');
  league.kind = 'league';
  assert.match(starAddReason(league, 'griff') ?? '', /League teams hire Star Players for one match in the pre-match Inducements step \(Petty Cash and Treasury, p\.94\)/);
  // No room past 16 players; a Star Player counts towards the 11 (p.110).
  const full = team('f', 'lizardmen', 15, 'skink');
  assert.match(starAddReason(full, 'dribl') ?? '', /never have more than 16 players/, 'a pair takes two places');
  // V5.5: a Star Player the budget cannot pay for is not offered (the reason says what is left).
  assert.equal(starAddReason(full, 'karla'), 'Costs 210,000 gp — 100,000 gp left of the 1,000,000 gp budget.');
  full.budget = 1_200_000;
  assert.equal(starAddReason(full, 'karla'), null);
  const ten = team('t', 'human', 10);
  addStar(ten, 'griff', nid);
  assert.ok(!errs(ten).some((e) => /at least 11/.test(e)), 'ten roster players + Griff = 11');
  // Josef Bugman as Infamous Coaching Staff excludes Josef Bugman the Star Player (p.147).
  const jb = team('jb', 'human');
  jb.inducements = { josefBugman: 1 };
  addStar(jb, 'josefBugmanStar', nid);
  jb.budget = 1_200_000;
  assert.ok(errs(jb).some((e) => /cannot also hire him as a Star Player/.test(e)));
  // The printed profile is used unchanged.
  const g = team('g', 'human', 10);
  addStar(g, 'griff', nid);
  g.players[10].st = 5;
  assert.ok(errs(g).some((e) => /printed profile/.test(e)));
});

test('in the match a Star Player keeps the card profile, is never picked by a Prayer to Nuffle, and earns no SPP', () => {
  const a = team('a', 'human', 10);
  addStar(a, 'griff', nid);
  a.inducements = { prayer: 3 };
  const r = createMatch('tournament', a, team('b', 'orc'), { rules: 'full' }, 3);
  assert.ok(r.ok, r.errors.join());
  const griff = r.state!.players.find((q) => q.star === 'griff')!;
  assert.deepEqual([griff.ma, griff.st, griff.ag, griff.pa, griff.av, griff.position], [7, 4, 2, 3, 9, 'Griff Oberwald']);
  assert.deepEqual(validateState(r.state!), []);
});

test('the default formation (also the computer\'s set-up) fields hired Star Players and the Captain when a team has more than 11 players', () => {
  // 11 Orc Linemen + Varag: the Star Player (numbered last) is fielded, the highest-numbered Lineman stays in Reserve.
  const o = team('o', 'orc', 11);
  addStar(o, 'varag', nid);
  const r = createMatch('tournament', team('h', 'human'), o, { rules: 'full' }, 5);
  assert.ok(r.ok, r.errors.join());
  const s = r.state!;
  const f = defaultFormation(s, 'B');
  const on = Object.entries(f).filter(([, c]) => c).map(([id]) => id);
  const varag = s.players.find((q) => q.star === 'varag')!;
  assert.equal(on.length, 11);
  assert.ok(on.includes(varag.id), 'Varag is set up');
  assert.equal(f.B11, null, 'the highest-numbered Lineman (#11) waits in the Reserves Box');
  assert.ok(['B1', 'B2', 'B3', 'B10'].every((id) => f[id]), 'the lower numbers keep their slots');
  // With the Captain numbered 11 as well: Captain and Star Player are both fielded, Lineman 10 gives way.
  const oc = team('oc', 'orc', 11);
  setCaptain(oc, 'oc-11');
  addStar(oc, 'varag', nid);
  const r2 = createMatch('tournament', team('h2', 'human'), oc, { rules: 'full' }, 5);
  assert.ok(r2.ok, r2.errors.join());
  const f2 = defaultFormation(r2.state!, 'B');
  const on2 = Object.entries(f2).filter(([, c]) => c).map(([id]) => id);
  assert.equal(on2.length, 11);
  assert.ok(on2.includes('B11') && r2.state!.players.find((q) => q.id === 'B11')!.captain && on2.includes(r2.state!.players.find((q) => q.star === 'varag')!.id), 'Captain and Star Player both set up');
  assert.equal(f2.B10, null, 'Lineman #10 waits in the Reserves Box');
  // Eleven or fewer players: unchanged (every player is fielded).
  const small = team('sm', 'human', 10);
  addStar(small, 'griff', nid);
  const r3 = createMatch('tournament', small, team('o3', 'orc'), { rules: 'full' }, 5);
  assert.ok(r3.ok, r3.errors.join());
  const f3 = defaultFormation(r3.state!, 'A');
  assert.deepEqual(Object.keys(f3).filter((id) => f3[id]), r3.state!.players.filter((q) => q.team === 'A').sort((a, b) => a.number - b.number).map((q) => q.id));
});

// ---------------------------------------------------------------------------
// Block dice
// ---------------------------------------------------------------------------

test("Lord Borak's Lord of Chaos (p.204): once per game, re-roll one Block die", () => {
  const P = new Pos();
  star(P, 'A', 'lordBorak', c(10, 7), 'LB');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  const s = P.start();
  // ST 5 v 3: two dice, both Player Down → re-roll one → POW; armour 6+6 broken, injury 1+1 Stunned.
  const { r, asked } = play(s, blockIn('LB', 'O'), [1, 1, 6, 6, 6, 1, 1], { reroll: 'star1:playerDown', blockDie: 'pow' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.ok(optIds(asked, 'reroll').includes('star1:playerDown'));
  assert.match(texts(r), /Lord Borak the Despoiler — Lord of Chaos: re-rolls one Player Down Block die/);
  assert.equal(p(r.state, 'O').stance, 'stunned');
  assert.deepEqual(p(r.state, 'LB').starUsed, ['game']);
});

test("Anqi Panqi's Savage Blow (p.195): once per game, re-roll any number of the Block dice", () => {
  const P = new Pos();
  star(P, 'A', 'anqiPanqi', c(10, 7), 'AP');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  const { r, asked } = play(P.start(), blockIn('AP', 'O'), [1, 2, 6, 3, 1, 1], { reroll: 'anqi:bothDown+playerDown', blockDie: 'pow' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.deepEqual(optIds(asked, 'reroll').filter((o) => o.startsWith('anqi')).sort(), ['anqi:bothDown', 'anqi:bothDown+playerDown', 'anqi:playerDown']);
  assert.match(texts(r), /Savage Blow: 2 dice re-rolled → POW! \/ Push Back|Savage Blow: 2 dice re-rolled → Push Back \/ POW!/);
  assert.equal(p(r.state, 'O').stance, 'prone');
});

test("H'Thark's Unstoppable Momentum (p.202) re-rolls a Block die only on a Blitz; Willow Rosebark's Woodland Fury only when the Block would Knock her Down", () => {
  const P = new Pos();
  star(P, 'A', 'hthark', c(10, 7), 'HT');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  const s = P.start();
  const b = play(s, blockIn('HT', 'O'), [3, 4]);
  assert.ok(['completed', 'turnover', 'touchdown'].includes(b.r.status), b.r.error ?? b.r.status);
  assert.equal(optIds(b.asked, 'reroll').length, 0, 'no re-roll on a Block Action');
  const z = play(s, blitzIn('HT', 'O'), [3, 4, 6, 1, 1], { reroll: 'star1:push', blockDie: 'pow' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(z.r.status), z.r.error ?? z.r.status);
  assert.match(texts(z.r), /Unstoppable Momentum: re-rolls one Push Back Block die/);
  assert.equal(p(z.r.state, 'HT').starUsed, undefined, 'always available (no once-per-game marker)');

  const W = new Pos();
  star(W, 'A', 'willow', c(10, 7), 'WR');
  W.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  const w = W.start();
  const safe = play(w, blockIn('WR', 'O'), [1, 6, 1, 1], { blockDie: 'pow' });
  assert.equal(optIds(safe.asked, 'reroll').length, 0, 'POW available: the Block would not Knock her Down');
  const down = play(w, blockIn('WR', 'O'), [1, 1, 6, 1, 1], { reroll: 'star1:playerDown', blockDie: 'pow' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(down.r.status), down.r.error ?? down.r.status);
  assert.match(texts(down.r), /Woodland Fury/);
});

test("Lucien Swift's Working in Tandem (p.209): re-roll a Block die against a player Valen also Marks", () => {
  const P = new Pos();
  star(P, 'A', 'lucien', c(10, 7), 'LS');
  const valen = star(P, 'A', 'valen', c(10, 9), 'VS');
  P.add('B', 'orc', 'lineman', c(11, 8), { id: 'O' });
  P.add('B', 'orc', 'lineman', c(12, 12), { id: 'O2' });
  const s = P.start();
  // Valen at (10,9) is adjacent to the Orc at (11,8): an assist too (ST 4 v 3, two dice).
  const r1 = play(s, blockIn('LS', 'O'), [1, 1, 6, 1, 1], { reroll: 'star1:playerDown', blockDie: 'pow' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r1.r.status), r1.r.error ?? r1.r.status);
  assert.match(texts(r1.r), /Working in Tandem/);
  const s2 = structuredClone(s);
  p(s2, valen.id).pos = c(8, 12);
  const r2 = play(s2, blockIn('LS', 'O'), [3]);
  assert.equal(optIds(r2.asked, 'reroll').length, 0, 'Valen does not Mark the target');
});

test("Grashnak Blackhoof's Gored by the Bull (p.200): once per game on a Blitz, one more Block die (max 3)", () => {
  const P = new Pos();
  star(P, 'A', 'grashnak', c(10, 7), 'GB');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O', st: 4 });
  // Unchannelled Fury 2 (+2 Blitz) = 4 passes; Horns: ST 7 v 4 = two dice, +1 = three: 1, 1, 6 → POW.
  const { r, asked } = play(P.start(), blitzIn('GB', 'O'), [2, 1, 1, 6, 1, 1, 1, 1], { blockDie: 'pow' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.ok(asked.some((a) => a.type === 'starRule' && /one more Block die \(2 → 3\)/.test(a.prompt)));
  assert.match(texts(r), /3 block dice/);
  assert.match(texts(r), /Gored by the Bull: one more Block die/);
});

test("Karla von Kill's Indomitable (p.203): after a successful Dauntless, double the target's ST; Akhorne's Blind Rage re-rolls Dauntless", () => {
  const P = new Pos();
  star(P, 'A', 'karla', c(10, 7), 'KV');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O', st: 5 });
  const { r } = play(P.start(), blockIn('KV', 'O'), [3, 6, 6, 1, 1], { blockDie: 'pow' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.match(texts(r), /Karla von Kill — Indomitable: #\d+ Karla von Kill counts as ST 10 for this Block/);
  assert.match(texts(r), /Strength 10 vs 5/);

  const A = new Pos();
  star(A, 'A', 'akhorne', c(10, 7), 'AK');
  A.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  // Dauntless (needs 3+ for ST 1 v 3): 1, re-rolled with Blind Rage: 3 → ST 3 v 3, one die: POW; armour 1+1.
  const a = play(A.start(), blockIn('AK', 'O'), [1, 3, 6, 1, 1], { reroll: 'skill', blockDie: 'pow' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(a.r.status), a.r.error ?? a.r.status);
  assert.ok(a.asked.some((q) => q.type === 'reroll' && q.options.some((o) => /Blind Rage/.test(o.label))));
  assert.match(texts(a.r), /Dauntless: .* counts as ST 3/);
});

test("Withergrasp Doubledrool's Watch Out! (p.210): the first Block against him each Drive, he counts as having Dodge", () => {
  const P = new Pos({ active: 'A' });
  P.add('A', 'human', 'lineman', c(10, 7), { id: 'H' });
  P.add('A', 'human', 'lineman', c(15, 2), { id: 'H2' });
  star(P, 'B', 'withergrasp', c(11, 7), 'WD');
  const s = P.start();
  // Foul Appearance 2 (passes); one die: Stumble → Push Back thanks to Watch Out!
  const { r } = play(s, blockIn('H', 'WD'), [2, 5]);
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.match(texts(r), /Watch Out!: the first Block against .* he counts as having Dodge/);
  assert.match(texts(r), /target has Dodge → Push Back/);
  assert.ok(!p(r.state, 'WD').skills.some((k) => k.id === 'dodge'), 'only for that Block');
  // The second Block that Drive: Stumble is a POW.
  const s2 = structuredClone(r.state);
  const wd = p(s2, 'WD').pos!;
  p(s2, 'H2').pos = c(wd.x + 1, wd.y);
  const r2 = play(s2, blockIn('H2', 'WD'), [2, 5, 1, 1]);
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r2.r.status), r2.r.error ?? r2.r.status);
  assert.match(texts(r2.r), /no Dodge → POW!/);
});

// ---------------------------------------------------------------------------
// Armour and Injury Rolls
// ---------------------------------------------------------------------------

test("The Mighty Zug's Crushing Blow (p.205): once per game +1 to the Armour Roll after the roll (and Mighty Blow is kept for the Injury Roll)", () => {
  const P = new Pos();
  star(P, 'A', 'mightyZug', c(10, 7), 'MZ');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  const { r, asked } = play(P.start(), blockIn('MZ', 'O'), [6, 6, 4, 5, 1, 1], { blockDie: 'pow', mightyBlow: 'save' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.ok(asked.some((a) => a.type === 'starRule' && a.options.some((o) => o.id === 'armour')));
  assert.match(texts(r), /Crushing Blow \(The Mighty Zug\) \+1 applied to the Armour Roll → 10 — armour broken/);
  assert.equal(p(r.state, 'O').stance, 'stunned');
});

test("Ivan 'the Animal' Deathshroud's Dwarven Scourge (p.202): +2 against a Dwarf; Grim Ironjaw's Slayer only against a Big Guy", () => {
  const P = new Pos({ b: 'dwarf' });
  star(P, 'A', 'ivan', c(10, 7), 'IV');
  P.add('B', 'dwarf', 'lineman', c(11, 7), { id: 'D' });
  const { r } = play(P.start(), blockIn('IV', 'D'), [6, 6, 4, 4, 1, 1], { blockDie: 'pow' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.match(texts(r), /Dwarven Scourge \(Ivan 'the Animal' Deathshroud\) \+2 applied to the Armour Roll → 10 — armour broken/);

  const G = new Pos();
  star(G, 'A', 'grim', c(10, 7), 'GI');
  G.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  const g = play(G.start(), blockIn('GI', 'O'), [6, 6, 4, 5], { blockDie: 'pow' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(g.r.status), g.r.error ?? g.r.status);
  assert.ok(!g.asked.some((a) => a.type === 'starRule'), 'an Orc Lineman is not a Big Guy');
});

test("Varag Ghoul-Chewer's Krump and Smash (p.210) re-rolls the Armour Roll; Josef Bugman's Dwarfen Grit (p.203) re-rolls it when his armour breaks", () => {
  const P = new Pos();
  star(P, 'A', 'varag', c(10, 7), 'VG');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  const { r } = play(P.start(), blockIn('VG', 'O'), [6, 6, 1, 1, 6, 6, 1, 1], { blockDie: 'pow' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.match(texts(r), /Krump and Smash: the Armour Roll against .* is re-rolled/);
  assert.match(texts(r), /Re-roll — Armour Roll/);
  assert.equal(p(r.state, 'O').stance, 'stunned');

  const J = new Pos();
  J.add('A', 'human', 'lineman', c(10, 7), { id: 'H' });
  star(J, 'B', 'josefBugmanStar', c(11, 7), 'JB');
  const j = play(J.start(), blockIn('H', 'JB'), [6, 5, 5, 1, 1]);
  assert.ok(['completed', 'turnover', 'touchdown'].includes(j.r.status), j.r.error ?? j.r.status);
  assert.match(texts(j.r), /Dwarfen Grit: the Armour Roll against .* is re-rolled/);
  assert.equal(p(j.r.state, 'JB').stance, 'prone', 'the re-rolled Armour Roll (2) holds');
});

test("Wilhelm Chaney's Savage Mauling (p.210): once per game, re-roll an Injury Roll", () => {
  const P = new Pos();
  star(P, 'A', 'wilhelm', c(10, 7), 'WC');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  // ST 4 v 3: POW; Claws: 4+4 = 8 breaks AV 10+; injury 1+1 Stunned → re-rolled 5+4 = 9 Knocked-out.
  const { r } = play(P.start(), blockIn('WC', 'O'), [6, 6, 4, 4, 1, 1, 5, 4], { blockDie: 'pow' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.match(texts(r), /Savage Mauling: the Injury Roll against .* is re-rolled/);
  assert.equal(p(r.state, 'O').location, 'ko');
});

test("Stab: Skitter Stab-Stab's Master Assassin re-rolls the Armour Roll, Rashnak Backstabber's Toxin Connoisseur +1 Injury (pp.206-208)", () => {
  const P = new Pos();
  star(P, 'A', 'skitter', c(10, 7), 'SK');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  const stab = (id: string): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action: 'special', special: 'stab', specialTarget: 'O', path: [] });
  const { r } = play(P.start(), stab('SK'), [1, 1, 6, 6, 1, 1]);
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.match(texts(r), /Master Assassin: the Stab's Armour Roll is re-rolled/);

  const R = new Pos();
  star(R, 'A', 'rashnak', c(10, 7), 'RB');
  R.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  const x = play(R.start(), stab('RB'), [6, 6, 3, 4]);
  assert.ok(['completed', 'turnover', 'touchdown'].includes(x.r.status), x.r.error ?? x.r.status);
  assert.match(texts(x.r), /Toxin Connoisseur \(Rashnak Backstabber\) \+1 applied to the Injury Roll → 8: Knocked-out/);
  assert.equal(p(x.r.state, 'O').location, 'ko');
});

test("Dribl & Drull's A Sneaky Pair (p.198): +1 to a Foul against a player Marked by both", () => {
  const P = new Pos();
  star(P, 'A', 'dribl', c(10, 7), 'DB');
  star(P, 'A', 'drull', c(12, 7), 'DR');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O', stance: 'prone' });
  const foul: PlayerActionInput = { kind: 'playerAction', playerId: 'DB', action: 'foul', path: [], foulTarget: 'O' };
  // 3+5 = 8, +1 offensive assist (Drull) +1 A Sneaky Pair = 10: armour broken; injury 1+2 Stunned.
  const { r } = play(P.start(), foul, [3, 5, 1, 2]);
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.match(texts(r), /\+1 A Sneaky Pair \(Dribl & Drull\) → 10 vs AV 10\+ — armour broken/);
});

// ---------------------------------------------------------------------------
// Tests and re-rolls
// ---------------------------------------------------------------------------

test("Griff Oberwald's Consummate Professional (p.200): once per game +1 to an Agility Test after the roll; Jordell Freshbreeze passes a Rush on a 2+", () => {
  const P = new Pos();
  star(P, 'A', 'griff', c(10, 7), 'GO');
  P.add('B', 'orc', 'lineman', c(11, 8), { id: 'O' });
  const s = P.start();
  // Dodge away from (10,7) to (9,6): AG 2+, rolled 1 would fail (natural 1 always fails) — use a Marked target square instead.
  P.add('B', 'orc', 'lineman', c(8, 5), { id: 'O2' });
  const s2 = P.start();
  const mv: PlayerActionInput = { kind: 'playerAction', playerId: 'GO', action: 'move', path: [{ to: c(9, 6), kind: 'step' }] };
  // Marked once in (9,6): AG 2+ −1 = needs 3; rolled 2 → +1 = 3 passes.
  const { r, asked } = play(s2, mv, [2], { starRule: 'use' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.ok(asked.some((a) => a.type === 'starRule' && /Apply \+1/.test(a.prompt)));
  assert.match(texts(r), /Consummate Professional: \+1 to Dodge/);
  assert.equal(p(r.state, 'GO').stance, 'standing');
  void s;

  const J = new Pos();
  star(J, 'A', 'jordell', c(10, 7), 'JF');
  const js = J.start();
  js.players.find((q) => q.id === 'JF')!.ma = 1;
  js.weather = 'blizzard';
  // Rush in a Blizzard needs 3+ (−1); rolled 2 → Swift as the Breeze: passes on a 2+.
  const run2: PlayerActionInput = { kind: 'playerAction', playerId: 'JF', action: 'move', path: [{ to: c(11, 7), kind: 'step' }, { to: c(12, 7), kind: 'step' }] };
  const j = play(js, run2, [2], { starRule: 'use' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(j.r.status), j.r.error ?? j.r.status);
  assert.match(texts(j.r), /Swift as the Breeze: Rush 1 .* passes on a 2\+ regardless of modifiers/);
  assert.deepEqual(p(j.r.state, 'JF').pos, c(12, 7));
});

test("Puggy Baconbreath's Halfling Luck re-rolls any test once per game; Ripper Bolgrot's Thinking Man's Troll once per half (p.206)", () => {
  const P = new Pos();
  const pug = star(P, 'A', 'puggy', c(10, 7), 'PB');
  P.add('B', 'orc', 'lineman', c(11, 8), { id: 'O' });
  const s = P.start();
  const mv: PlayerActionInput = { kind: 'playerAction', playerId: 'PB', action: 'move', path: [{ to: c(9, 6), kind: 'step' }] };
  // Dodge AG 3+ (Stunty: no Marked modifier): 1 → Dodge skill re-roll first? Puggy has Dodge: skill re-roll 1, then no more.
  const { asked } = play(s, mv, [1, 1, 1, 1], { reroll: (q) => (q.options.some((o) => o.id === 'skill') ? 'skill' : 'none') });
  assert.ok(asked[0].options.some((o) => o.id === 'star' && /Halfling Luck/.test(o.label)), 'Halfling Luck is offered with the skill re-roll');
  const r = play(s, mv, [1, 4], { reroll: 'star' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.r.status), r.r.error ?? r.r.status);
  assert.match(texts(r.r), /Halfling Luck: re-roll of Dodge/);
  assert.deepEqual(p(r.r.state, 'PB').starUsed, ['game']);
  void pug;

  const R = new Pos();
  star(R, 'A', 'ripper', c(10, 7), 'RB');
  const rs = R.start();
  const t2 = structuredClone(rs);
  t2.turn.half = 1;
  p(t2, 'RB').starUsed = ['h1'];
  const mvr: PlayerActionInput = { kind: 'playerAction', playerId: 'RB', action: 'move', path: [{ to: c(11, 7), kind: 'step' }, { to: c(12, 7), kind: 'step' }, { to: c(13, 7), kind: 'step' }, { to: c(14, 7), kind: 'step' }, { to: c(15, 7), kind: 'step' }, { to: c(16, 7), kind: 'step' }] };
  const used = play(t2, mvr, [1, 1, 1]);
  assert.ok(!used.asked.some((q) => q.options.some((o) => o.id === 'star')), 'already used this half');
  t2.turn.half = 2;
  const again = play(t2, mvr, [1, 6], { reroll: 'star' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(again.r.status), again.r.error ?? again.r.status);
  assert.match(texts(again.r), /Thinking Man's Troll: re-roll of Rush 1/);
});

test("Rowana Forestfoot's Bounding Leap (p.207): no negative modifiers and a re-roll; Skrull Halfheight adds his ST to a Pass", () => {
  const P = new Pos();
  star(P, 'A', 'rowana', c(10, 7), 'RF');
  P.add('B', 'orc', 'lineman', c(11, 8), { id: 'O' });
  P.add('B', 'orc', 'lineman', c(11, 6), { id: 'O2' });
  const leap: PlayerActionInput = { kind: 'playerAction', playerId: 'RF', action: 'move', path: [{ to: c(12, 7), kind: 'leap' }] };
  // Leap AG 3+ with no modifiers: 2 fails, re-rolled (Bounding Leap) 3 → lands.
  const { r } = play(P.start(), leap, [2, 3], { starRule: 'use', reroll: 'skill' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.match(texts(r), /Bounding Leap: no negative modifiers for this Leap/);
  assert.match(texts(r), /Bounding Leap \(Rowana Forestfoot\) to re-roll/);
  assert.deepEqual(p(r.state, 'RF').pos, c(12, 7));

  const S = new Pos();
  const sk = star(S, 'A', 'skrull', c(10, 7), 'SH');
  S.add('A', 'human', 'lineman', c(16, 7), { id: 'H' });
  S.give(sk);
  const pass: PlayerActionInput = { kind: 'playerAction', playerId: 'SH', action: 'pass', path: [], passTarget: c(16, 7) };
  // Short Pass (−1): PA 3+ needs 4; rolled 2 → +3 (ST) → 4: Accurate; the catch 6.
  const x = play(S.start(), pass, [2, 6], { starRule: 'use' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(x.r.status), x.r.error ?? x.r.status);
  assert.match(texts(x.r), /Strong Passing Game: \+3 to Passing Ability Test/);
  assert.match(texts(x.r), /Accurate Pass/);
});

test("Morg 'n' Thorg's The Ballista re-rolls a Throw Team-mate; Eldril Sidewinder re-rolls Hypnotic Gaze (pp.199, 205)", () => {
  const P = new Pos();
  star(P, 'A', 'morgNThorg', c(10, 7), 'MT');
  P.add('A', 'halfling', 'hopeful', c(10, 8), { id: 'HF' });
  const ttm: PlayerActionInput = { kind: 'playerAction', playerId: 'MT', action: 'ttm', path: [], thrownPlayerId: 'HF', throwTarget: c(14, 7) };
  const { asked } = play(P.start(), ttm, [1, 6, 1, 1, 1, 6], { reroll: 'star' });
  assert.ok(asked.some((a) => a.type === 'reroll' && a.options.some((o) => o.id === 'star' && /The Ballista/.test(o.label))));

  const E = new Pos();
  star(E, 'A', 'eldril', c(10, 7), 'EL');
  E.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  const gaze: PlayerActionInput = { kind: 'playerAction', playerId: 'EL', action: 'special', special: 'hypnoticGaze', specialTarget: 'O', path: [] };
  const g = play(E.start(), gaze, [1, 5], { reroll: 'star' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(g.r.status), g.r.error ?? g.r.status);
  assert.match(texts(g.r), /Mesmerizing Dance: re-roll of .*Hypnotic Gaze/);
  assert.equal(p(g.r.state, 'O').distracted, true);
});

// ---------------------------------------------------------------------------
// Other special rules
// ---------------------------------------------------------------------------

test("Glart Smashrip's Frenzied Rush and Roxanna Darknail's Slashing Nails (once per half on a Blitz: Frenzy / Claws for the activation)", () => {
  const P = new Pos();
  star(P, 'A', 'roxanna', c(10, 7), 'RX');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  // Blitz: ST 3 v 3, one die POW; Claws: 4+4 = 8 breaks AV 10+; injury 1+1.
  const { r } = play(P.start(), blitzIn('RX', 'O'), [6, 4, 4, 1, 1], { starRule: 'use' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.match(texts(r), /Slashing Nails: .* gains Claws/);
  assert.match(texts(r), /Claws: natural 8\+ breaks/);
  assert.ok(p(r.state, 'RX').skills.some((k) => k.id === 'claws' && k.until === 'activation'));
  const end = play(r.state, { kind: 'endActivation' }, []);
  assert.ok(!p(end.r.state, 'RX').skills.some((k) => k.id === 'claws'), 'Claws only until the end of her activation');

  const G = new Pos();
  star(G, 'A', 'glart', c(10, 7), 'GS');
  G.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  // ST 4 v 3: two dice Push/Push → Frenzy second Block (Grab not used): one Push, the Orc is pushed on.
  const g = play(G.start(), blitzIn('GS', 'O'), [3, 4, 3, 4], { starRule: 'use' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(g.r.status), g.r.error ?? g.r.status);
  assert.match(texts(g.r), /Frenzied Rush: .* gains Frenzy/);
  assert.match(texts(g.r), /blocks again \(Frenzy\)/);
  assert.ok(!g.asked.some((a) => a.type === 'skill' && a.context?.skill === 'grab'), 'no Grab in the Turn Frenzied Rush is used');
});

test("The Black Gobbo's Sneakiest of the Lot (p.196): two Foul Actions per Turn, one of them his", async () => {
  const { actionOptions } = await import('../src/engine/actions');
  const P = new Pos({ a: 'goblin' });
  const gob = star(P, 'A', 'blackGobbo', c(10, 7), 'BG');
  const l1 = P.add('A', 'goblin', 'lineman', c(10, 9), { id: 'G1' });
  const l2 = P.add('A', 'goblin', 'lineman', c(10, 11), { id: 'G2' });
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O', stance: 'prone' });
  const s = P.start();
  s.turn.used.foul = true;
  s.turn.used.foulBy = ['G1'];
  p(s, 'G1').activated = true;
  const foulOf = (pl: Player) => actionOptions(s, p(s, pl.id)).find((o) => o.action === 'foul')!;
  assert.equal(foulOf(gob).enabled, true, 'the Black Gobbo may make the second Foul');
  assert.equal(foulOf(l2).enabled, false);
  assert.match(foulOf(l2).reason ?? '', /second Foul Action this Turn must be declared by the Black Gobbo/);
  s.turn.used.foulBy = ['BG'];
  assert.equal(foulOf(l2).enabled, true, 'after his Foul, one more by anybody');
  s.turn.used.foulBy = ['BG', 'G1'];
  assert.equal(foulOf(l2).enabled, false);
  void l1;
});

test("Scrappa Sorehead's Yoink! (p.207): once per game an Interception on a D6 2+; Valen Swift passes to Lucien with no range modifier", () => {
  const P = new Pos();
  const th = P.add('A', 'human', 'lineman', c(10, 7), { id: 'T' });
  P.add('A', 'human', 'lineman', c(16, 7), { id: 'R' });
  star(P, 'B', 'scrappa', c(13, 7), 'SC');
  P.give(th);
  const pass: PlayerActionInput = { kind: 'playerAction', playerId: 'T', action: 'pass', path: [], passTarget: c(16, 7) };
  // Short Pass: PA 4+ −1 = 5: rolled 6 Accurate; Scrappa: Yoink! 2 → intercepts.
  const { r } = play(P.start(), pass, [6, 2], { interceptor: 'SC', starRule: 'use' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.match(texts(r), /Yoink!: D6 2 — he intercepts automatically/);
  assert.equal(r.state.ball.kind === 'held' && r.state.ball.playerId, 'SC');

  const V = new Pos();
  const va = star(V, 'A', 'valen', c(10, 7), 'VS');
  star(V, 'A', 'lucien', c(16, 7), 'LS');
  V.give(va);
  const vp: PlayerActionInput = { kind: 'playerAction', playerId: 'VS', action: 'pass', path: [], passTarget: c(16, 7) };
  // PA 2+, no range modifier: rolled 2 is Accurate (with the Short −1 it would not be).
  const v = play(V.start(), vp, [2, 6]);
  assert.ok(['completed', 'turnover', 'touchdown'].includes(v.r.status), v.r.error ?? v.r.status);
  assert.match(texts(v.r), /Accurate Pass/);
});

test("Kreek Rustgouger's I'll Be Back (p.204): the first Secret Weapon Sent-off is ignored; Count Luthor's Touchdown and Skrorg's Casualty give Team Re-rolls", () => {
  const a = team('ku', 'underworld', 11, 'goblin');
  addStar(a, 'kreek', nid);
  const res = createMatch('tournament', a, team('ob', 'orc'), { rules: 'full' }, 11);
  assert.ok(res.ok, res.errors.join());
  const s = res.state!;
  const kreek = s.players.find((q) => q.star === 'kreek')!;
  kreek.inDrive = true;
  s.phase = 'halfOver';
  s.match!.drive = 1;
  const r = runScripted(s, { kind: 'nextDrive' }, Array(40).fill(4), (q) => q.options[q.options.length - 1].id);
  assert.notEqual(r.status, 'illegal', r.error);
  assert.match(texts(r), /I'll Be Back: .* would be Sent-off \(Secret Weapon\) but stays in the game this time/);
  assert.equal(p(r.state, kreek.id).location, 'reserves');

  // Count Luthor scores: a Team Re-roll for the next Drive only.
  const P = new Pos({ a: 'vampire' });
  const lu = star(P, 'A', 'luthor', c(24, 7), 'CL');
  P.give(lu);
  const td = play(P.start(), { kind: 'playerAction', playerId: 'CL', action: 'move', path: [{ to: c(25, 7), kind: 'step' }] }, []);
  assert.ok(['completed', 'turnover', 'touchdown'].includes(td.r.status), td.r.error ?? td.r.status);
  assert.match(texts(td.r), /Star of the Show: .* gain a Team Re-roll until the end of the next Drive/);
  assert.equal(td.r.state.teams.A.nextDriveRerolls, 1);

  // Skrorg Snowpelt's Block causes a Casualty: +1 Team Re-roll for this Drive.
  const K = new Pos();
  star(K, 'A', 'skrorg', c(10, 7), 'SS');
  K.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  const ks = K.start();
  const before = ks.teams.A.rerolls;
  // ST 5 v 3: POW; armour 5+5 = 10 broken; injury 6+6 = 12 Casualty; D16 1 Badly Hurt.
  const k = play(ks, blockIn('SS', 'O'), [6, 6, 5, 5, 6, 6, 1], { blockDie: 'pow' });
  assert.ok(['completed', 'turnover', 'touchdown'].includes(k.r.status), k.r.error ?? k.r.status);
  assert.match(texts(k.r), /Pump Up the Crowd: .* gain a Team Re-roll until the end of this Drive/);
  assert.equal(k.r.state.teams.A.rerolls, before + 1);
  assert.equal(k.r.state.teams.A.bonusRerolls, 1);
});

test("Deeproot Strongbranch's Reliable (p.198): after a Fumbled Throw the thrown player bounces but lands safely", () => {
  const P = new Pos({ a: 'halfling' });
  star(P, 'A', 'deeproot', c(10, 7), 'DS');
  P.add('A', 'halfling', 'hopeful', c(10, 8), { id: 'HF' });
  const ttm: PlayerActionInput = { kind: 'playerAction', playerId: 'DS', action: 'ttm', path: [], thrownPlayerId: 'HF', throwTarget: c(13, 7) };
  // Timmm-ber! aside, the PA roll is a natural 1: Fumbled Throw; the bounce D8 = 5 (east? any empty square).
  const { r } = play(P.start(), ttm, [1, 5]);
  assert.ok(['completed', 'turnover', 'touchdown'].includes(r.status), r.error ?? r.status);
  assert.match(texts(r), /Reliable \(Deeproot Strongbranch\): .* bounces but will land safely/);
  assert.match(texts(r), /lands safely on their feet .* \(Reliable, no landing roll\)/);
  assert.equal(p(r.state, 'HF').stance, 'standing');
});

// ---------------------------------------------------------------------------
// Star Players in play (computer v computer)
// ---------------------------------------------------------------------------

/** A legal Tournament team of `rosterId` Linemen with the given Star Players, within a 1,200,000 gp budget. */
function starTeam(id: string, rosterId: string, lineman: string, stars: string[]): TeamDef {
  const t = team(id, rosterId, 0);
  t.budget = 1_200_000;
  for (const sid of stars) addStar(t, sid, nid);
  let n = 1;
  const r = ROSTER_BY_ID[rosterId];
  while (t.players.length < 11 || (t.players.length < 13 && teamCost(t).total + (r.positions.find((x) => x.id === lineman)?.cost ?? 0) + r.rerollCost <= t.budget)) {
    const used = new Set(t.players.map((q) => q.number));
    while (used.has(n)) n++;
    t.players.push(playerFromRoster(r, lineman, n, `${id}-l${n}`));
  }
  while (t.rerolls < 3 && teamCost({ ...t, rerolls: t.rerolls + 1 }).total <= t.budget) t.rerolls++;
  return t;
}

test('computer v computer: teams with Star Players play a half with legal inputs only, and the special rules come up', async () => {
  const { bindEngine, nextMove, waitingFor } = await import('../src/ai/index');
  const Engine = await import('../src/engine/index');
  bindEngine(Engine);
  const pairs: Array<[TeamDef, TeamDef, number]> = [
    [starTeam('hu', 'human', 'lineman', ['griff', 'mightyZug']), starTeam('or', 'orc', 'lineman', ['varag', 'ripper']), 21],
    [starTeam('eu', 'elvenUnion', 'lineman', ['lucien', 'roxanna']), starTeam('lz', 'lizardmen', 'skink', ['dribl', 'anqiPanqi']), 22],
  ];
  const seen: string[] = [];
  for (const [a, b, seed] of pairs) {
    assert.deepEqual(errs(a), [], `${a.name}: ${errs(a).join('; ')}`);
    assert.deepEqual(errs(b), [], `${b.name}: ${errs(b).join('; ')}`);
    const cr = createMatch('tournament', a, b, { rules: 'full', computer: { team: 'B', style: 'balanced' } }, seed);
    assert.ok(cr.ok, cr.errors.join('\n'));
    let s = cr.state as GameState;
    let steps = 0;
    while (!(s.match!.half === 2 || s.phase === 'fullTime') && steps < 3000) {
      steps++;
      const t = waitingFor(s);
      let res: ExecutionResult;
      if (!t) res = Engine.execute(s, s.phase === 'pregame' ? { kind: 'pregame' } : { kind: 'nextDrive' });
      else {
        const mv = nextMove(s, t, 'balanced', { maxExplored: 6 });
        assert.ok(mv, `no move for ${t} in ${s.phase}`);
        if (mv!.type === 'decision') res = Engine.decide(s, { requestId: mv!.requestId, optionId: mv!.optionId });
        else {
          assert.deepEqual(Engine.validateInput(s, mv!.input), [], JSON.stringify(mv!.input).slice(0, 200));
          res = Engine.execute(s, mv!.input);
        }
      }
      assert.notEqual(res.status, 'illegal', res.error);
      s = res.state;
    }
    assert.deepEqual(validateState(s), []);
    assert.ok(s.match!.half === 2 || s.phase === 'fullTime', `stuck in ${s.phase} after ${steps} steps`);
    for (const e of s.log) for (const v of e.events) if (v.data?.star) seen.push(String(v.data.star));
  }
  assert.ok(seen.length > 0, 'at least one Star Player special rule was used');
});
