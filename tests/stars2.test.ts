/**
 * V5 step 5 (second part): the Star Player rules used at the start of an activation, the Action variants and the
 * remaining hooks (starActions.ts and friends).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute, STAR_BY_ID, STAR_RULES_IMPLEMENTED, STARS, type ActionInput, type DecisionRequest, type ExecutionResult, type GameState, type Player, type PlayerActionInput, type TeamId } from '../src/engine/index';
import { actionOptions } from '../src/engine/actions';
import { startRuleReason } from '../src/engine/starActions';
import { catchMods } from '../src/engine/ball';
import { c, p, Pos, runScripted } from './helpers';

const texts = (r: { events: { text: string }[] }) => r.events.map((e) => e.text).join('\n');

function star(P: Pos, t: TeamId, id: string, at: { x: number; y: number }, pid: string): Player {
  const st = STAR_BY_ID[id];
  const pl = P.add(t, t === 'A' ? 'human' : 'orc', 'lineman', at, { id: pid, ma: st.ma, st: st.st, ag: st.ag, pa: st.pa, av: st.av, skills: st.skills.map((k) => ({ ...k })) });
  pl.star = id;
  pl.position = st.name;
  pl.keywords = st.keywords.slice();
  return pl;
}

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
    if (['taunt', 'fend', 'standFirm', 'wrestle', 'stripBall', 'juggernaut', 'argueTheCall', 'bribe', 'skill'].includes(req.type)) return ids.includes('no') ? 'no' : ids[ids.length - 1];
    if (req.type === 'interceptor') return 'none';
    if (req.type === 'starRule') return ids.includes('use') ? 'use' : ids[0];
    return ids[0];
  });
  return { r, asked };
}
const done = (r: ExecutionResult) => ['completed', 'turnover', 'touchdown'].includes(r.status);
const act = (id: string, action: PlayerActionInput['action'], extra: Partial<PlayerActionInput> = {}): PlayerActionInput => ({ kind: 'playerAction', playerId: id, action, path: [], starRule: true, ...extra });

test('every one of the 66 Star Players can now be hired (all special rules implemented)', () => {
  assert.equal(STAR_RULES_IMPLEMENTED.size, 66);
  for (const s of STARS) assert.ok(STAR_RULES_IMPLEMENTED.has(s.id), s.id);
});

test("Kiroth's Black Ink and Zolcath's \"Excuse me, are you a Zoat?\": an opponent becomes Distracted; the activation goes on (a Block follows)", () => {
  const P = new Pos();
  star(P, 'A', 'kiroth', c(10, 7), 'KK');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  const s = P.start();
  const { r } = play(s, act('KK', 'block', { blockTarget: 'O' }), [6, 1, 1], { starRule: 'O', blockDie: 'pow' });
  assert.ok(done(r), r.error);
  assert.match(texts(r), /Black Ink: #\d+ Orc Lineman becomes Distracted/);
  assert.match(texts(r), /Kiroth Krakeneye blocks #\d+ Orc Lineman/);
  assert.equal(startRuleReason(r.state, p(r.state, 'KK')), 'Black Ink has already been used (once per game).');

  const Z = new Pos();
  star(Z, 'A', 'zolcath', c(10, 7), 'ZZ');
  Z.add('B', 'orc', 'lineman', c(13, 9), { id: 'O' });
  const z = play(Z.start(), act('ZZ', 'move', { path: [{ to: c(9, 7), kind: 'step' }] }), [], { starRule: 'O' });
  assert.ok(done(z.r), z.r.error);
  assert.equal(p(z.r.state, 'O').distracted, true);
  assert.deepEqual(p(z.r.state, 'ZZ').pos, c(9, 7), 'then the Move Action');
});

test("Estelle la Veneaux's Baleful Hex (p.196): D6 2+ Distracted and the player cannot be activated in their team's next Turn", () => {
  const P = new Pos({ turnA: 3, turnB: 2 });
  star(P, 'A', 'estelle', c(10, 7), 'EV');
  P.add('B', 'orc', 'lineman', c(14, 7), { id: 'O' });
  P.add('B', 'orc', 'lineman', c(20, 3), { id: 'O2' });
  const { r } = play(P.start(), act('EV', 'move'), [2], { starRule: 'O' });
  assert.ok(done(r), r.error);
  assert.match(texts(r), /Baleful Hex: D6 2 — #\d+ Orc Lineman becomes Distracted and cannot be activated/);
  const g = structuredClone(r.state);
  g.turn.activation = null;
  g.turn.active = 'B';
  g.teams.B.turn = 3;
  for (const q of g.players) q.activated = false;
  assert.ok(actionOptions(g, p(g, 'O')).every((o) => !o.enabled && /Baleful Hex/.test(o.reason ?? '')));
  assert.ok(actionOptions(g, p(g, 'O2')).some((o) => o.enabled));
  g.teams.B.turn = 4;
  assert.ok(actionOptions(g, p(g, 'O')).some((o) => o.enabled), 'only that Turn');
});

test("Boa Kon'ssstriktr's Look Into My Eyes (p.196): D6 2+ takes the ball from the carrier he Marks and ends his activation; a 1 changes nothing", () => {
  const P = new Pos();
  star(P, 'A', 'boa', c(10, 7), 'BK');
  const o = P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  P.give(o);
  const s = P.start();
  const miss = play(s, act('BK', 'move'), [1]);
  assert.ok(done(miss.r), miss.r.error);
  assert.equal(miss.r.state.turn.activation?.playerId, 'BK', 'a 1: the activation goes on');
  const hit = play(s, act('BK', 'move'), [2]);
  assert.ok(done(hit.r), hit.r.error);
  assert.deepEqual(hit.r.state.ball, { kind: 'held', playerId: 'BK' });
  assert.equal(hit.r.state.turn.activation, null, 'his activation ends');
  assert.equal(hit.r.state.turn.active, 'A');
});

test("Hakflem's Treacherous (p.201): takes the ball from an adjacent team-mate, who is Knocked Down without a Turnover", () => {
  const P = new Pos();
  star(P, 'A', 'hakflem', c(10, 7), 'HS');
  const mate = P.add('A', 'human', 'lineman', c(10, 8), { id: 'M' });
  P.give(mate);
  const { r } = play(P.start(), act('HS', 'move', { path: [{ to: c(9, 6), kind: 'step' }] }), [1, 1]);
  assert.ok(done(r), r.error);
  assert.equal(r.status, 'completed');
  assert.deepEqual(r.state.ball, { kind: 'held', playerId: 'HS' });
  assert.equal(p(r.state, 'M').stance, 'prone');
  assert.deepEqual(p(r.state, 'HS').pos, c(9, 6));
});

test("Ivar Eriksson's Raiding Party (once per Drive) and Grombrindal's Wisdom of the White Dwarf (a team-mate gains a skill until the end of the Turn)", () => {
  const P = new Pos();
  star(P, 'A', 'ivar', c(10, 7), 'IE');
  P.add('A', 'human', 'lineman', c(8, 3), { id: 'M' });
  P.add('B', 'orc', 'lineman', c(8, 1), { id: 'O' });
  const { r, asked } = play(P.start(), act('IE', 'move'), [], { starRule: (q) => (q.options.some((o) => o.id === 'M') ? 'M' : '8,2') });
  assert.ok(done(r), r.error);
  assert.ok(asked.some((a) => a.options.some((o) => o.id === '8,2')));
  assert.deepEqual(p(r.state, 'M').pos, c(8, 2));
  assert.match(texts(r), /Raiding Party: #\d+ Human Lineman moves/);

  const G = new Pos();
  star(G, 'A', 'grombrindal', c(10, 7), 'GR');
  G.add('A', 'human', 'lineman', c(11, 9), { id: 'M' });
  const g = play(G.start(), act('GR', 'move'), [], { starRule: (q) => (q.options.some((o) => o.id === 'M') ? 'M' : 'mightyBlow') });
  assert.ok(done(g.r), g.r.error);
  assert.deepEqual(p(g.r.state, 'M').skills.find((k) => k.id === 'mightyBlow'), { id: 'mightyBlow', until: 'turn' });
  const next = execute(g.r.state, { kind: 'endTurn' });
  assert.ok(!p(next.state, 'M').skills.some((k) => k.id === 'mightyBlow'), 'gone at the end of the Turn');
});

test("Rodney Roachbait's Catch of the Day (once per half): D6 3+ and he has the ball on the ground within 3 squares", () => {
  const P = new Pos();
  star(P, 'A', 'rodney', c(10, 7), 'RR');
  P.ball(c(12, 9));
  const s = P.start();
  const got = play(s, act('RR', 'move'), [3]);
  assert.ok(done(got.r), got.r.error);
  assert.deepEqual(got.r.state.ball, { kind: 'held', playerId: 'RR' });
  const far = structuredClone(s);
  far.ball = { kind: 'ground', pos: c(14, 7) };
  assert.match(startRuleReason(far, p(far, 'RR')) ?? '', /within 3 squares/);
});

test("Jeremiah Kool's The Flashing Blade (p.203): a Stab at the start of his activation, then his Move", () => {
  const P = new Pos();
  star(P, 'A', 'jeremiahKool', c(10, 7), 'JK');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  // Stab 6+6 = 12: armour broken, injury 1+1 Stunned; then he moves away (Dodge 2+: 3).
  const { r } = play(P.start(), act('JK', 'move', { path: [{ to: c(9, 6), kind: 'step' }] }), [6, 6, 1, 1, 3]);
  assert.ok(done(r), r.error);
  assert.equal(p(r.state, 'O').stance, 'stunned');
  assert.deepEqual(p(r.state, 'JK').pos, c(9, 6));
  assert.match(startRuleReason(P.start(), p(P.start(), 'JK'), 'block') ?? '', /used with a move Action/);
});

test("Thorsson Stoutmead's Beer Barrel Bash (once per Drive): 3+ Knocked Down, 1 he Falls Over (Turnover); his activation ends", () => {
  const P = new Pos();
  star(P, 'A', 'thorsson', c(10, 7), 'TS');
  P.add('B', 'orc', 'lineman', c(12, 9), { id: 'O' });
  const s = P.start();
  const hit = play(s, act('TS', 'move'), [4, 1, 1]);
  assert.ok(done(hit.r), hit.r.error);
  assert.equal(p(hit.r.state, 'O').stance, 'prone');
  assert.equal(hit.r.state.turn.activation, null);
  assert.equal(hit.r.state.turn.active, 'A');
  const oops = play(s, act('TS', 'move'), [1, 1, 1]);
  assert.equal(oops.r.status, 'turnover');
  assert.equal(p(oops.r.state, 'TS').stance, 'prone');
});

test("Zzharg Madeye's \"Blastin' Solves Everything\" (once per half): 3+ the target, 2 the opposing coach picks, 1 Zzharg — an Armour Roll", () => {
  const P = new Pos();
  star(P, 'A', 'zzharg', c(10, 7), 'ZM');
  P.add('B', 'orc', 'lineman', c(12, 7), { id: 'O' });
  P.add('B', 'orc', 'lineman', c(13, 8), { id: 'O2' });
  const s = P.start();
  const three = play(s, act('ZM', 'move'), [3, 6, 6, 1, 1], { starRule: 'O' });
  assert.ok(done(three.r), three.r.error);
  assert.equal(p(three.r.state, 'O').stance, 'stunned');
  const two = play(s, act('ZM', 'move'), [2, 6, 6, 1, 1], { starRule: (q) => (q.team === 'B' ? 'O2' : 'O') });
  assert.ok(done(two.r), two.r.error);
  assert.equal(p(two.r.state, 'O2').stance, 'stunned', 'the opposing coach chose the other Orc');
  const one = play(s, act('ZM', 'move'), [1, 1, 1], { starRule: 'O' });
  assert.ok(done(one.r), one.r.error);
  assert.match(texts(one.r), /D6 1 — #\d+ Zzharg Madeye is hit/);
});

test("Swiftvine Glimmershard's Furious Outburst (once per half): springs next to an opponent, Stabs, may move again — the team's Blitz", () => {
  const P = new Pos();
  star(P, 'A', 'swiftvine', c(10, 7), 'SG');
  P.add('B', 'orc', 'lineman', c(13, 7), { id: 'O' });
  const answers = ['12,7', '9,5']; // the only opponent in range is chosen automatically
  let i = 0;
  const { r } = play(P.start(), act('SG', 'move'), [6, 6, 1, 1], { starRule: () => answers[i++] });
  assert.ok(done(r), r.error);
  assert.equal(p(r.state, 'O').stance, 'stunned');
  assert.deepEqual(p(r.state, 'SG').pos, c(9, 5));
  assert.equal(r.state.turn.used.blitz, true);
  assert.equal(r.state.turn.activation, null);
});

test("Grak & Crumbleberry's I'll Carry You (once per half): Grak carries Crumbleberry (Break Tackle and Dodge meanwhile) and sets him down next to him", () => {
  const P = new Pos();
  star(P, 'A', 'grak', c(10, 7), 'GK');
  star(P, 'A', 'crumbleberry', c(10, 8), 'CB');
  const { r, asked } = play(P.start(), act('GK', 'move', { path: [{ to: c(11, 7), kind: 'step' }, { to: c(12, 7), kind: 'step' }] }), [3], { starRule: '13,7' });
  assert.ok(done(r), r.error);
  // Bone Head first (3: passes).
  assert.match(texts(r), /picks up Crumbleberry/);
  const a = r.state.turn.activation;
  if (a) {
    assert.ok(p(r.state, 'GK').skills.some((k) => k.id === 'dodge' && k.until === 'activation'));
    const end = play(r.state, { kind: 'endActivation' }, [], { starRule: '13,7' });
    assert.deepEqual(p(end.r.state, 'CB').pos, c(13, 7));
    assert.ok(!p(end.r.state, 'GK').skills.some((k) => k.id === 'dodge'));
  } else {
    assert.ok(asked.some((q) => q.type === 'starRule'));
    assert.deepEqual(p(r.state, 'CB').pos, c(13, 7));
  }
});

test("Maple Highgrove's Vicious Vines (once per half): a Block against an opponent 2 squares away, no Follow-up", () => {
  const P = new Pos();
  star(P, 'A', 'maple', c(10, 7), 'MH');
  P.add('B', 'orc', 'lineman', c(12, 7), { id: 'O' });
  const s = P.start();
  const opt = actionOptions(s, p(s, 'MH')).find((o) => o.action === 'block');
  assert.ok(opt?.enabled, 'the Block Action is available through Vicious Vines');
  const { r } = play(s, act('MH', 'block', { blockTarget: 'O' }), [6, 6, 1, 1], { blockDie: 'pow' });
  assert.ok(done(r), r.error);
  assert.match(texts(r), /Vicious Vines: no Follow-up/);
  assert.deepEqual(p(r.state, 'MH').pos, c(10, 7));
  assert.deepEqual(p(r.state, 'O').pos, c(13, 7));
  assert.equal(p(r.state, 'O').stance, 'prone');
});

test("Nobbla Blackwart's Kick 'em While They're Down! (Chainsaw on a Prone player) and Max Spleenripper's Maximum Carnage (a second Chainsaw Attack)", () => {
  const P = new Pos();
  star(P, 'A', 'nobbla', c(10, 7), 'NB');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O', stance: 'prone' });
  const { r } = play(P.start(), act('NB', 'special', { special: 'chainsaw' }), [3, 4, 4, 1, 1], { starRule: 'O' });
  assert.ok(done(r), r.error);
  assert.match(texts(r), /\+3 = 11 vs AV 10\+|4\+4 \+3=11/);
  assert.equal(p(r.state, 'O').stance, 'stunned');
  assert.ok(!r.events.some((e) => /Sent-off/.test(e.text)));

  const M = new Pos();
  star(M, 'A', 'maxSpleenripper', c(10, 7), 'MS');
  M.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  M.add('B', 'orc', 'lineman', c(11, 8), { id: 'O2' });
  const saw: PlayerActionInput = { kind: 'playerAction', playerId: 'MS', action: 'special', special: 'chainsaw', specialTarget: 'O', path: [] };
  const m = play(M.start(), saw, [2, 1, 1, 2, 6, 6, 1, 1], { starRule: 'O2' });
  assert.ok(done(m.r), m.r.error);
  assert.match(texts(m.r), /Maximum Carnage: a second Chainsaw Attack, on #\d+ Orc Lineman/);
  assert.equal(p(m.r.state, 'O2').stance, 'stunned');
});

test("Helmut Wulf's Old Pro: once per game Pro (3+) re-rolls one die of his chainsaw's Armour Roll", () => {
  const P = new Pos();
  star(P, 'A', 'helmut', c(10, 7), 'HW');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  const saw: PlayerActionInput = { kind: 'playerAction', playerId: 'HW', action: 'special', special: 'chainsaw', specialTarget: 'O', path: [] };
  // Kick-back 2 (fine); armour 1+1 +3 = 5 holds; Old Pro on the first die: Pro 3, re-rolled 6 → 6+1+3 = 10 broken; injury 1+1.
  const { r } = play(P.start(), saw, [2, 1, 1, 3, 6, 1, 1], { starRule: 'd0' });
  assert.ok(done(r), r.error);
  assert.match(texts(r), /Old Pro: the 1 is re-rolled → 6/);
  assert.equal(p(r.state, 'O').stance, 'stunned');
});

test("Bilerot Vomitflesh's Putrid Regurgitation (once per half): Projectile Vomit without the Trait — also right after his Block", () => {
  const P = new Pos();
  star(P, 'A', 'bilerot', c(10, 7), 'BV');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  P.add('B', 'orc', 'lineman', c(10, 8), { id: 'O2' });
  const s = P.start();
  const pv: PlayerActionInput = { kind: 'playerAction', playerId: 'BV', action: 'special', special: 'projectileVomit', specialTarget: 'O', path: [] };
  const v = play(s, pv, [2, 6, 6, 1, 1]);
  assert.ok(done(v.r), v.r.error);
  assert.match(texts(v.r), /Putrid Regurgitation: Projectile Vomit/);
  assert.equal(p(v.r.state, 'O').stance, 'stunned');
  // A Block first (Foul Appearance is his, not the Orc's): ST 5 v 3, POW; armour 1+1; then Vomit on the other Orc.
  const b = play(s, { kind: 'playerAction', playerId: 'BV', action: 'block', path: [], blockTarget: 'O' }, [6, 6, 1, 1, 2, 6, 6, 1, 1], { blockDie: 'pow', starRule: 'O2' });
  assert.ok(done(b.r), b.r.error);
  assert.equal(p(b.r.state, 'O2').stance, 'stunned', 'the Vomit after the Block');
});

test("Cindy Piewhistle's All You Can Eat (two bombs, then D6 1-3 Sent-off) and Bomber Dribblesnot's Kaboom! (a caught bomb explodes)", () => {
  const P = new Pos();
  star(P, 'A', 'cindy', c(5, 7), 'CP');
  P.add('B', 'orc', 'lineman', c(8, 11), { id: 'O' });
  const bomb: PlayerActionInput = { kind: 'playerAction', playerId: 'CP', action: 'special', special: 'bombardier', bombTarget: c(8, 3), path: [], starRule: true };
  // Bomb 1: PA 6 (Accurate) → (8,3), nobody near. Bomb 2 at (8,10): PA 6, blast on the Orc 1 (miss). Then D6 5: she stays.
  const { r, asked } = play(P.start(), bomb, [6, 6, 1, 5], { starRule: '8,10' });
  assert.ok(done(r), r.error);
  assert.ok(asked.some((a) => a.type === 'starRule' && a.options.some((o) => o.id === '8,10')));
  assert.match(texts(r), /All You Can Eat: D6 5 — she stays in the game/);
  const out = play(P.start(), bomb, [6, 6, 1, 2], { starRule: '8,10' });
  assert.match(texts(out.r), /All You Can Eat: D6 2 — Cindy is Sent-off/);
  assert.equal(p(out.r.state, 'CP').location, 'sentOff');

  const B = new Pos();
  star(B, 'A', 'bomber', c(5, 7), 'BD');
  B.add('B', 'orc', 'lineman', c(8, 7), { id: 'O' });
  const throwIt: PlayerActionInput = { kind: 'playerAction', playerId: 'BD', action: 'special', special: 'bombardier', bombTarget: c(8, 7), path: [] };
  // PA 6 Accurate onto the Orc, who catches it (6) — Kaboom!: it explodes: the Orc is Knocked Down (armour 1+1).
  const k = play(B.start(), throwIt, [6, 6, 1, 1]);
  assert.ok(done(k.r), k.r.error);
  assert.match(texts(k.r), /Kaboom!: the bomb explodes/);
  assert.equal(p(k.r.state, 'O').stance, 'prone');
});

test("Fungus the Loon's Whirling Dervish re-rolls the Ball & Chain direction; Gretchen Wächter's Incorporeal skips Dodge rolls", () => {
  const P = new Pos();
  star(P, 'A', 'fungus', c(10, 0), 'FL');
  const bnc: PlayerActionInput = { kind: 'playerAction', playerId: 'FL', action: 'special', special: 'ballAndChain', facing: 'y-', path: [] };
  // Facing the near sideline from y=0: any direction leaves the pitch — re-rolled once, still off: into the crowd.
  const { r, asked } = play(P.start(), bnc, [3, 4, 1, 1]);
  assert.ok(asked.some((a) => a.type === 'starRule' && /Re-roll it/.test(a.prompt)));
  assert.match(texts(r), /Whirling Dervish: the direction D6 3 is re-rolled/);

  const G = new Pos();
  star(G, 'A', 'gretchen', c(10, 7), 'GW');
  G.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  G.add('B', 'orc', 'lineman', c(9, 9), { id: 'O2' });
  const mv = act('GW', 'move', { path: [{ to: c(9, 8), kind: 'step' }, { to: c(8, 8), kind: 'step' }] });
  const g = play(G.start(), mv, []);
  assert.ok(done(g.r), g.r.error);
  assert.deepEqual(p(g.r.state, 'GW').pos, c(8, 8));
  assert.match(texts(g.r), /without a Dodge roll \(Incorporeal\)/);
});

test("Glotl Stop's Primal Savagery lashes out at an opponent; Captain Karina von Riesz's Tasty Morsel bites one", () => {
  const P = new Pos();
  star(P, 'A', 'glotl', c(10, 7), 'GL');
  P.add('A', 'human', 'lineman', c(9, 7), { id: 'M' });
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  // Animal Savagery 1 (+2) fails: Glotl lashes out at the Orc (Knocked Down, Mighty Blow must be used: 1+1+1).
  const { r } = play(P.start(), { kind: 'playerAction', playerId: 'GL', action: 'move', path: [] }, [1, 1, 1], { animalSavagery: 'O' });
  assert.ok(done(r), r.error);
  assert.equal(p(r.state, 'O').stance, 'prone');
  assert.equal(p(r.state, 'M').stance, 'standing');
  assert.equal(r.state.turn.active, 'A', 'no Turnover');

  const K = new Pos({ a: 'vampire' });
  star(K, 'A', 'karina', c(10, 7), 'KR');
  K.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  const k1 = play(K.start(), { kind: 'playerAction', playerId: 'KR', action: 'move', path: [] }, [1]);
  assert.ok(done(k1.r), k1.r.error);
  const k2 = play(k1.r.state, { kind: 'endActivation' }, [1, 1], { bloodlust: 'O' });
  assert.ok(done(k2.r), k2.r.error);
  assert.match(texts(k2.r), /Tasty Morsel: .* bites the opposition player/);
  assert.equal(k2.r.state.turn.active, 'A', 'fed: no Turnover');
  assert.equal(p(k2.r.state, 'O').stance, 'stunned');
});

test("Guffle Pusmaw's Quick Bite: an opponent he Marks catches the ball — an Armour Roll, broken: Guffle has it (no Turnover)", () => {
  const P = new Pos();
  const th = P.add('A', 'human', 'lineman', c(10, 7), { id: 'T' });
  P.add('A', 'human', 'lineman', c(13, 7), { id: 'R' });
  star(P, 'B', 'guffle', c(14, 8), 'GP');
  P.give(th);
  const pass: PlayerActionInput = { kind: 'playerAction', playerId: 'T', action: 'pass', path: [], passTarget: c(13, 7) };
  // Short Pass PA 4+ (−1): 6 Accurate; catch 6; Quick Bite armour 6+6 ≥ 9: Guffle has the ball.
  const { r } = play(P.start(), pass, [6, 6, 6, 6]);
  assert.ok(done(r), r.error);
  assert.deepEqual(r.state.ball, { kind: 'held', playerId: 'GP' });
  assert.match(texts(r), /Quick Bite: Armour Roll against .* Guffle takes the ball/);
});

test("Scyla Anfingrimm's Fury of the Blood God: a 1 for Unchannelled Fury on a Block → two Block Actions; Barik's Blast It! +1 to catch for his team-mates", () => {
  const P = new Pos();
  star(P, 'A', 'scyla', c(10, 7), 'SA');
  P.add('B', 'orc', 'lineman', c(11, 7), { id: 'O' });
  P.add('B', 'orc', 'lineman', c(10, 8), { id: 'O2' });
  // UF 1 (+2) fails → Fury of the Blood God; Block 1: POW (Claws: 1+1 holds); Block 2 on O2: POW (1+1 holds).
  const { r } = play(P.start(), { kind: 'playerAction', playerId: 'SA', action: 'block', path: [], blockTarget: 'O' }, [1, 6, 6, 1, 1, 6, 6, 1, 1], { blockDie: 'pow', starRule: (q) => (q.options.some((o) => o.id === 'use') ? 'use' : 'O2') });
  assert.ok(done(r), r.error);
  assert.match(texts(r), /Fury of the Blood God: .* performs two Block Actions/);
  assert.equal(p(r.state, 'O').stance, 'prone');
  assert.equal(p(r.state, 'O2').stance, 'prone');

  const B = new Pos();
  const bk = star(B, 'A', 'barik', c(10, 7), 'BF');
  const mate = B.add('A', 'human', 'lineman', c(20, 7), { id: 'M' });
  const foe = B.add('B', 'orc', 'lineman', c(21, 7), { id: 'O' });
  const s = B.start();
  const mm = (pl: Player) => catchMods({ s }, pl, 'barikA').map((m) => m.label);
  assert.ok(mm(p(s, 'M')).includes('Blast It! (Barik Farblast)'));
  assert.ok(!mm(p(s, 'O')).includes('Blast It! (Barik Farblast)'));
  void bk;
  void mate;
  void foe;
  B.give(bk);
  const hmp: PlayerActionInput = { kind: 'playerAction', playerId: 'BF', action: 'pass', path: [], passTarget: c(20, 7), hailMary: true };
  const h = play(B.start(), hmp, [4, 1, 1, 1, 5, 5, 5, 6], { starRule: '012' });
  assert.match(texts(h.r), /Blast It!: re-rolled → D8 5, 5, 5/);
});
