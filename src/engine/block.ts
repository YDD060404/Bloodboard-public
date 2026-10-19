import { adjacent, eq, fmt, inBounds, neighbours, pushSquares } from './board';
import { ballDisplacedBy, bounce, checkTouchdown, throwIn } from './ball';
import { ActionStop, Ctx, IllegalAction } from './context';
import { BLOCK_FACE_LABEL, blockFace, type BlockFace } from './dice';
import { crowdInjury, goDown, moveOffPitch , trapdoorCheck } from './injury';
import { payMovement, pickUp } from './move';
import { cheeringBonus, useCheeringBonus } from './match';
import { lonerValue, mascotAvailable, mascotCaptainFree, mascotCheck, proAvailable, rollTest, teamRerollsAvailable, useTeamReroll, VETERAN_RULE } from './roll';
import { R } from './rules';
import { foulAppearance, pileDriver, targetReactions } from './reactions';
import { BLOCKS_BEING_BLOCKED, gated, SKILL_BY_ID } from './skills';
import { canUse, faq2026, hasBall, hasSkill, hasTackleZone, heldInPlace, isChomped, label, markersOf, pitchPlayers, playerAt, skillKeywords } from './state';
import type { Activation, Coord, DecisionOption, GameState, Player, TeamId } from './types';
import { askStar, grabForbidden, grantTempSkill, spendStar, STAR_BY_ID, starReady } from './stars';

export interface BlockContext {
  isBlitz: boolean;
  /** The attacker declared a Block Action (Grab, Brawler need a declared Block). */
  declaredBlock: boolean;
  /**
   * Ball & Chain (p.124): the Block made when the player moves into a Standing
   * player's square — team-mates too (their coach picks the result), Foul
   * Appearance and Trickster are ignored, Fend cannot be used.
   */
  ballAndChain?: boolean;
  /** Multiple Block (p.132): one of two simultaneous Blocks — no Follow-up. */
  multiple?: boolean;
  /** Multiple Block: the attacker is already down from the other Block — only the target is affected. */
  attackerDown?: boolean;
  /** Maple Highgrove's Vicious Vines (p.204): the target is 2 squares away — no Follow-up. */
  reach?: boolean;
}

export interface StrengthInfo {
  attST: number;
  defST: number;
  attBase: number;
  offAssists: Player[];
  defAssists: Player[];
  dice: number;
  chooser: 'attacker' | 'defender';
  notes: string[];
}

function assistEligible(ctx: Ctx, helper: Player, target: Player, other: Player, helperIsAttackerSide: boolean): boolean {
  void other;
  return assistReason(ctx.s, helper, target, helperIsAttackerSide) === null;
}

/**
 * Why `helper` cannot assist against `target` (p.61, Guard p.129), or null if
 * it assists. `target` is the player being helped against (the defender for
 * offensive assists, the attacker for defensive ones).
 */
export function assistReason(s: GameState, helper: Player, target: Player, helperIsAttackerSide: boolean): string | null {
  if (helper.location !== 'pitch' || !helper.pos) return 'not on the pitch';
  if (helper.stance !== 'standing') return helper.stance === 'prone' ? 'Prone (no Tackle Zone)' : 'Stunned (no Tackle Zone)';
  if (helper.distracted) return 'Distracted (no Tackle Zone)';
  if (!hasTackleZone(helper) || helper.eyeGouged) return 'has no Tackle Zone';
  if (!target.pos || !adjacent(helper.pos, target.pos)) return `not adjacent to ${label(target)} (does not Mark them)`;
  const markers = markersOf(s, helper.pos, helper.team).filter((m) => m.id !== target.id);
  if (!markers.length) return null;
  const who = markers.map((m) => label(m)).join(', ');
  if (!canUse(helper, 'guard')) return `Marked by ${who}`;
  // Defensive (p.127): during its opponent's Turn, players it Marks cannot use Guard.
  if (helperIsAttackerSide) {
    const defensive = markersOf(s, helper.pos, helper.team).some((m) => canUse(m, 'defensive') && m.team !== s.turn.active);
    if (defensive) return `Marked by ${who}; Guard is cancelled by Defensive`;
  }
  return null;
}

/** Strength comparison including assists (p.60-61). `attBase` may be raised by Dauntless. */
export function blockStrength(ctx: Ctx, att: Player, def: Player, bc: BlockContext, attBaseOverride?: number): StrengthInfo {
  const notes: string[] = [];
  const attBase = attBaseOverride ?? att.st;
  let attST = attBase;
  if (bc.isBlitz && canUse(att, 'horns')) {
    attST += 1;
    notes.push('Horns +1');
  }
  // A Ball & Chain Block against a team-mate: strength against strength, no assists (interpretation, docs/RULES_COVERAGE.md).
  const sameTeam = def.team === att.team;
  const offAssists = sameTeam ? [] : pitchPlayers(ctx.s, att.team).filter((q) => q.id !== att.id && assistEligible(ctx, q, def, att, true));
  const defAssists = sameTeam ? [] : pitchPlayers(ctx.s, def.team).filter((q) => q.id !== def.id && assistEligible(ctx, q, att, def, false));
  attST += offAssists.length;
  // Cheering Fans (p.48): +1 Offensive Assist on the first Block Action of the team's next Turn.
  if (bc.declaredBlock && !bc.isBlitz && cheeringBonus(ctx.s, att.team)) {
    attST += 1;
    notes.push('Cheering Fans +1 Offensive Assist');
  }
  const defST = def.st + defAssists.length;
  let dice = 1;
  let chooser: 'attacker' | 'defender' = 'attacker';
  if (attST > defST) {
    dice = attST > 2 * defST ? 3 : 2;
  } else if (defST > attST) {
    dice = defST > 2 * attST ? 3 : 2;
    chooser = 'defender';
  }
  return { attST, defST, attBase, offAssists, defAssists, dice, chooser, notes };
}

export function blockBlockedReason(ctx: Ctx, att: Player, def: Player, bc?: BlockContext): string | null {
  if (def.team === att.team && !bc?.ballAndChain) return 'You can only Block opposition players.';
  if (def.location !== 'pitch' || def.stance !== 'standing') return 'The target of a Block must be a Standing player (p.60).';
  if (!hasTackleZone(att)) return 'The blocker must be Standing and not Distracted to Mark the target (p.60).';
  if (bc?.reach) {
    if (!att.pos || !def.pos || Math.max(Math.abs(att.pos.x - def.pos.x), Math.abs(att.pos.y - def.pos.y)) !== 2) return 'Vicious Vines: the target must be exactly 2 squares away.';
  } else if (!att.pos || !def.pos || !adjacent(att.pos, def.pos)) return 'The target must be adjacent (Marked by the blocker).';
  for (const id of BLOCKS_BEING_BLOCKED) {
    if (hasSkill(def, id) && gated(id)) return `Not available yet: Blocks against a player with ${SKILL_BY_ID[id]?.name ?? id} are disabled in this version.`;
  }
  if (hasSkill(def, 'dumpOff') && hasBall(ctx.s, def) && gated('dumpOff')) return 'Not available yet: Blocks against a ball carrier with Dump-off are disabled in this version.';
  return null;
}

type Pool = BlockFace[];

/** Block dice judged for the difficulty house rule: the value of the face the choosing coach would take, for `team`. */
type PoolJudge = { team: TeamId; value: (fresh: Pool) => number };

function rollPool(ctx: Ctx, n: number, judge?: PoolJudge): Pool {
  const r = ctx.roll({
    dice: Array.from({ length: n }, () => 6),
    interpret: (faces) => faces.map(blockFace).sort(),
    key: (v) => v.join(','),
    cacheKey: `block${n}`,
    display: 'block',
    ...(judge ? { judge: judge.value, judgeFor: judge.team } : {}),
  });
  return r.value;
}

/** How good a Block result is for the attacker, −1…+1 (the same scale the plan previews rank faces by). */
export function blockFaceValue(face: BlockFace, att: Player, def: Player, isBlitz: boolean): number {
  let f = face;
  if (f === 'stumble') f = canUse(def, 'dodge') && !canUse(att, 'tackle') ? 'push' : 'pow';
  switch (f) {
    case 'pow':
      return 1;
    case 'push':
      return 0.33;
    case 'playerDown':
      return -1;
    case 'bothDown': {
      const attUp = canUse(att, 'block');
      const defUp = canUse(def, 'block');
      let sc: number;
      if (attUp && !defUp) sc = 1;
      else if (attUp && defUp) sc = 0;
      else if (!attUp && !defUp) sc = canUse(att, 'wrestle') ? 0.17 : -0.5;
      else sc = canUse(att, 'wrestle') ? 0 : -1;
      if (isBlitz && canUse(att, 'juggernaut')) sc = Math.max(sc, 0.33);
      return sc;
    }
    default:
      return 0;
  }
}

function poolText(pool: Pool): string {
  return pool.map((f) => BLOCK_FACE_LABEL[f]).join(' / ');
}

function effectiveFace(f: BlockFace, att: Player, def: Player): BlockFace {
  if (f !== 'stumble') return f;
  const dodge = canUse(def, 'dodge') && !canUse(att, 'tackle');
  return dodge ? 'push' : 'pow';
}

/** Perform a full Block (p.60-63). Throws ActionStop if the attacker's activation ends. */
export function performBlock(ctx: Ctx, att: Player, def: Player, bc: BlockContext, act: Activation, second = false): void {
  const why = blockBlockedReason(ctx, att, def, bc);
  if (why) throw new IllegalAction(why);
  const attFrom = att.pos as Coord;

  ctx.emit('block', `${label(att)} ${second ? 'blocks again (Frenzy)' : 'blocks'} ${label(def)} in ${fmt(def.pos)}.`, bc.isBlitz ? R.blitz : R.block, { attacker: att.id, defender: def.id });

  // Foul Appearance (p.128, before any other dice), then the target's Trickster (p.138) and Dump-off (p.128).
  // (A Frenzy second Block is a new Block Action: they apply again.)
  if (!bc.ballAndChain) foulAppearance(ctx, att, def, act, 'Block');
  targetReactions(ctx, att, def, { trickster: !bc.ballAndChain });

  // Withergrasp Doubledrool's Watch Out! (p.210): the first time each Drive he is Blocked by an opponent, he counts as having Dodge.
  const watchOut = def.team !== att.team && starReady(ctx.s, def, 'withergrasp') && grantTempSkill(def, 'dodge', 'activation');
  if (watchOut) spendStar(ctx, def, `the first Block against ${label(def)} this Drive — he counts as having Dodge for it.`);
  try {
    const attBase = dauntless(ctx, att, def);
    const st = blockStrength(ctx, att, def, bc, attBase);
    if (bc.declaredBlock && !bc.isBlitz) useCheeringBonus(ctx.s, att.team);
    const eff = blockDiceAndChoice(ctx, att, def, bc, act, st);
    resolveBlockResult(ctx, att, def, eff, bc, act, attFrom);
  } finally {
    if (watchOut) def.skills = def.skills.filter((k) => !(k.id === 'dodge' && k.until));
  }
}

/** Dauntless (p.127): the attacker's unmodified ST for this Block (raised to the target's on a success). */
function dauntless(ctx: Ctx, att: Player, def: Player): number {
  let attBase = att.st;
  if (canUse(att, 'dauntless') && def.st > att.st) {
    const need = def.st - att.st + 1;
    const d = rollTest(ctx, {
      kind: 'dauntless',
      player: att,
      label: `Dauntless (D6 + ST ${att.st} must beat ST ${def.st})`,
      target: need,
      mods: [],
      outcome: (n) => (n + att.st > def.st ? 'S' : 'F'),
      outcomeKey: `daunt${att.st}v${def.st}`,
      rule: { page: 127, title: 'Dauntless' },
      // Akhorne the Squirrel's Blind Rage (p.195): he may re-roll the D6 for Dauntless.
      skillReroll: starReady(ctx.s, att, 'akhorne') ? { id: 'dauntless', name: "Blind Rage (Akhorne the Squirrel)", available: true } : undefined,
      teamReroll: true,
      proAllowed: true,
      onFail: `Strength stays ${att.st}`,
    });
    if (d.success) {
      attBase = def.st;
      ctx.emit('block', `Dauntless: ${label(att)} counts as ST ${def.st} for this Block.`, { page: 127, title: 'Dauntless' });
      // Karla von Kill's Indomitable (p.203): once per game, double the target's ST instead.
      if (starReady(ctx.s, att, 'karla') && askStar(ctx, att, `Dauntless worked. Raise her ST to double the target's (${2 * def.st}) for this Block?`, `Use Indomitable: ST ${2 * def.st}`, true)) {
        attBase = 2 * def.st;
        spendStar(ctx, att, `${label(att)} counts as ST ${attBase} for this Block.`);
      }
    }
  }
  return attBase;
}

/** Roll the Block dice, offer re-rolls and let the chooser pick the result (p.60-62). Returns the effective result. */
function blockDiceAndChoice(ctx: Ctx, att: Player, def: Player, bc: BlockContext, act: Activation, st: StrengthInfo): BlockFace {
  const s = ctx.s;
  goredByTheBull(ctx, att, bc, act, st);
  const assistTxt = `${st.offAssists.length} offensive / ${st.defAssists.length} defensive assist${st.defAssists.length === 1 ? '' : 's'}`;
  ctx.emit('block', `Strength ${st.attST} vs ${st.defST} (${assistTxt}${st.notes.length ? ', ' + st.notes.join(', ') : ''}) → ${st.dice} block ${st.dice === 1 ? 'die' : 'dice'}${st.dice > 1 ? `, ${st.chooser === 'attacker' ? 'attacker' : 'defender'} chooses` : ''}.`, R.assists, {
    attST: st.attST,
    defST: st.defST,
    dice: st.dice,
    chooser: st.chooser,
    offAssists: st.offAssists.map((p) => p.id),
    defAssists: st.defAssists.map((p) => p.id),
  });

  if (ctx.mode === 'plan') {
    ctx.step({
      kind: 'block',
      label: `Block ${label(def)}: ST ${st.attST} vs ${st.defST}`,
      playerId: att.id,
      dice: `${st.dice} block ${st.dice === 1 ? 'die' : 'dice'}`,
      mods: [],
      pSingle: null,
      rerolls: [],
      onFail: '',
      rule: R.blockDice,
      extra: { dice: st.dice, chooser: st.chooser, attST: st.attST, defST: st.defST, offAssists: st.offAssists.length, defAssists: st.defAssists.length, defenderId: def.id },
    });
  }

  // Difficulty house rule: the dice are judged by the face the choosing coach would take (from the attacker's side).
  const poolValue = (p: Pool) => {
    const v = p.map((f) => blockFaceValue(f, att, def, !!bc.isBlitz));
    return st.chooser === 'attacker' ? Math.max(...v) : Math.min(...v);
  };
  const whole: PoolJudge | undefined = def.team !== att.team ? { team: att.team, value: poolValue } : undefined;
  let pool = rollPool(ctx, st.dice, whole);
  ctx.emit('roll', `Block dice: ${poolText(pool)}.`, R.blockDice, { pool });

  // Re-rolls for block dice (p.33): Team Re-roll re-rolls the pool; Pro,
  // Brawler (declared Block only) and Hatred re-roll a single die.
  const opts: DecisionOption[] = [];
  const tr = teamRerollsAvailable(ctx, att);
  const lonerX = lonerValue(att);
  if (tr.team) opts.push({ id: 'team', label: `Team Re-roll: re-roll all dice (${s.teams[att.team].rerolls} left)${lonerX ? ` — Loner ${lonerX}+` : ''}` });
  if (tr.leader) opts.push({ id: 'leader', label: `Leader Re-roll: re-roll all dice${lonerX ? ` — Loner ${lonerX}+` : ''}` });
  if (mascotAvailable(ctx, att.team)) opts.push({ id: 'mascot', label: `Team Mascot's Team Re-roll (D6 4+ first): re-roll all dice${lonerX ? ` — Loner ${lonerX}+` : ''}` });
  // Sevens Veteran (Spike! 22 p.13): once per game, re-roll the dice when its own Block would Knock it Down.
  if (att.veteran === 'ready' && veteranWouldGoDown(pool, st.chooser === 'attacker' || def.team === att.team, att)) opts.push({ id: 'veteran', label: 'Veteran re-roll: re-roll all dice (once per game)' });
  const uniq = [...new Set(pool)];
  if (proAvailable(ctx, att)) for (const f of uniq) opts.push({ id: `pro:${f}`, label: `Pro (3+): re-roll one ${BLOCK_FACE_LABEL[f]} die` });
  if (bc.declaredBlock && canUse(att, 'brawler') && !(faq2026(s) && act.brawlerUsed) && pool.includes('bothDown')) opts.push({ id: 'brawler', label: 'Brawler: re-roll one Both Down die' });
  const hk = skillKeywords(att, 'hatred');
  if (canUse(att, 'hatred') && pool.includes('playerDown') && hk.some((k) => def.keywords.includes(k))) opts.push({ id: 'hatred', label: `Hatred (${hk.join(', ')}): re-roll one Player Down die` });
  // Star Player special rules (pp.195-211): re-roll one Block die, or any number of them (Anqi Panqi).
  const one = starOneDie(ctx, att, def, bc, pool, st);
  if (one) for (const f of uniq) opts.push({ id: `star1:${f}`, label: `${one}: re-roll one ${BLOCK_FACE_LABEL[f]} die` });
  if (!bc.ballAndChain && starReady(s, att, 'anqiPanqi')) for (const sub of faceSubsets(pool)) opts.push({ id: `anqi:${sub.join('+')}`, label: `Savage Blow (Anqi Panqi, once per game): re-roll ${sub.map((f) => BLOCK_FACE_LABEL[f]).join(' + ')}` });
  if (opts.length) {
    opts.push({ id: 'none', label: 'Keep these dice' });
    const ask = (options: DecisionOption[]) =>
      ctx.ask({
        type: 'reroll',
        team: att.team,
        prompt: `Block dice: ${poolText(pool)} (${st.chooser === 'attacker' ? 'you choose' : 'the defender chooses'}). Re-roll?`,
        options,
        rule: R.rerolls,
        context: { pool, chooser: st.chooser, kind: 'blockDice', attacker: att.id, defender: def.id },
      });
    let choice = ask(opts);
    // Team Mascot (p.144): 1-3 and its re-roll is lost for the half — another re-roll may be used instead.
    if (choice === 'mascot' && !mascotCheck(ctx, att.team)) {
      const rest = opts.filter((o) => o.id !== 'mascot');
      choice = rest.length > 1 ? ask(rest) : 'none';
    }
    if (choice === 'veteran') {
      att.veteran = 'used';
      ctx.emit('reroll', `${label(att)} uses the Veteran's once-per-game re-roll on the block dice.`, VETERAN_RULE, { playerId: att.id });
      pool = rollPool(ctx, st.dice, whole);
      ctx.emit('roll', `Block dice re-rolled: ${poolText(pool)}.`, R.blockDice, { pool });
    } else if (choice === 'team' || choice === 'leader' || choice === 'mascot') {
      const t = s.teams[att.team];
      if (choice === 'team') useTeamReroll(ctx, att.team, ' on the block dice');
      else if (choice === 'mascot') {
        ctx.emit('reroll', "Team Mascot's Team Re-roll used on the block dice.", { page: 144, title: 'Team Mascot' });
        if (faq2026(s)) mascotCaptainFree(ctx, att.team);
      }
      else {
        t.leaderReroll = false;
        ctx.emit('reroll', `Leader Re-roll used on the block dice (${t.rerolls} left).`, R.rerolls);
      }
      let ok = true;
      if (lonerX) {
        const lr = ctx.roll({ dice: [6], interpret: ([n]) => (n >= lonerX ? 'S' : 'F'), cacheKey: `loner${lonerX}`, by: att.team, judge: (v) => (v === 'S' ? 1 : -1) });
        ok = lr.value === 'S';
        ctx.emit('roll', `Loner (${lonerX}+): rolled ${lr.faces[0]} — ${ok ? 're-roll allowed' : 'the Team Re-roll is lost'}.`, { page: 131, title: 'Loner' });
      }
      if (ok) {
        pool = rollPool(ctx, st.dice, whole);
        ctx.emit('roll', `Block dice re-rolled: ${poolText(pool)}.`, R.blockDice, { pool });
      }
    } else if (choice.startsWith('anqi:')) {
      const faces = choice.slice(5).split('+') as BlockFace[];
      spendStar(ctx, att, `re-rolls ${faces.length === 1 ? 'one Block die' : `${faces.length} Block dice`} (${faces.map((f) => BLOCK_FACE_LABEL[f]).join(', ')}).`);
      const rest = pool.slice();
      for (const f of faces) rest.splice(rest.indexOf(f), 1);
      const fresh = rollPool(ctx, faces.length, whole ? { team: att.team, value: (f) => poolValue([...rest, ...f]) } : undefined);
      pool = [...rest, ...fresh].sort();
      ctx.emit('roll', `Savage Blow: ${faces.length} ${faces.length === 1 ? 'die' : 'dice'} re-rolled → ${poolText(fresh)}. Dice now: ${poolText(pool)}.`, R.blockDice, { pool });
    } else if (choice !== 'none') {
      let face: BlockFace;
      let allowed = true;
      if (choice.startsWith('star1:')) {
        face = choice.slice(6) as BlockFace;
        spendStar(ctx, att, `re-rolls one ${BLOCK_FACE_LABEL[face]} Block die.`);
      } else if (choice.startsWith('pro:')) {
        face = choice.slice(4) as BlockFace;
        act.proUsed = true;
        const pr = ctx.roll({ dice: [6], interpret: ([n]) => (n >= 3 ? 'S' : 'F'), cacheKey: 'pro3', by: att.team, judge: (v) => (v === 'S' ? 1 : -1) });
        allowed = pr.value === 'S';
        ctx.emit('roll', `Pro: rolled ${pr.faces[0]}; needs 3+ — ${allowed ? 're-roll' : 'no re-roll'}.`, { page: 133, title: 'Pro' });
      } else {
        face = choice === 'brawler' ? 'bothDown' : 'playerDown';
        if (choice === 'brawler') act.brawlerUsed = true;
      }
      if (allowed) {
        const idx0 = pool.indexOf(face);
        const others = [...pool.slice(0, idx0), ...pool.slice(idx0 + 1)];
        const one = ctx.roll({ dice: [6], interpret: ([n]) => blockFace(n), cacheKey: 'blockface1', display: 'block', ...(whole ? { judge: (f: BlockFace) => poolValue([...others, f]), judgeFor: att.team } : {}) });
        const idx = pool.indexOf(face);
        pool = [...pool.slice(0, idx), ...pool.slice(idx + 1), one.value].sort();
        ctx.emit('roll', `${choice.startsWith('star1') ? 'Star Player re-roll' : choice.startsWith('pro') ? 'Pro' : choice === 'brawler' ? 'Brawler' : 'Hatred'}: one ${BLOCK_FACE_LABEL[face]} die re-rolled → ${BLOCK_FACE_LABEL[one.value]}. Dice now: ${poolText(pool)}.`, R.blockDice, { pool });
      }
    }
  }

  // Choose the result (a Ball & Chain player's coach always chooses against a team-mate, p.124)
  const chooserTeam = st.chooser === 'attacker' || def.team === att.team ? att.team : def.team;
  const faces = [...new Set(pool)];
  const choice = ctx.ask({
    type: 'blockDie',
    team: chooserTeam,
    prompt: `${st.chooser === 'attacker' ? 'Attacker' : 'Defender'} chooses the block result: ${poolText(pool)}.`,
    options: faces.map((f) => ({ id: f, label: BLOCK_FACE_LABEL[f], detail: faceDetail(f, att, def, bc) })),
    rule: R.blockDice,
    context: { pool, attacker: att.id, defender: def.id },
  });
  const chosen = choice as BlockFace;
  const eff = effectiveFace(chosen, att, def);
  ctx.emit('block', `Result: ${BLOCK_FACE_LABEL[chosen]}${chosen === 'stumble' ? (eff === 'push' ? ' (target has Dodge → Push Back)' : canUse(def, 'dodge') ? ' (Tackle cancels Dodge → POW!)' : ' (no Dodge → POW!)') : ''}.`, R.blockDice, { result: chosen, effective: eff });
  if (chosen === 'stumble' && canUse(def, 'dodge') && !canUse(att, 'tackle')) ctx.emit('note', `${label(def)} uses Dodge against the Stumble (always beneficial, applied automatically).`, { page: 127, title: 'Dodge' });
  return eff;
}

/** "<Star>'s <rule> (once per game)" for option labels. */
function starRuleLabel(id: string): string {
  const d = STAR_BY_ID[id];
  return `${d.rule.name} (${d.name}${d.rule.per === 'game' ? ', once per game' : d.rule.per === 'half' ? ', once per half' : ''})`;
}

/**
 * The Star Player special rule that lets the attacker re-roll ONE Block die now, or null: Lord Borak's Lord of
 * Chaos (p.204), H'Thark's Unstoppable Momentum (Blitz, p.202), Willow Rosebark's Woodland Fury (a Block that would
 * Knock her Down, p.210), Lucien Swift's Working in Tandem (target also Marked by Valen, p.209), Puggy
 * Baconbreath's Halfling Luck and Ripper Bolgrot's Thinking Man's Troll (any single die, pp.206).
 */
function starOneDie(ctx: Ctx, att: Player, def: Player, bc: BlockContext, pool: Pool, st: StrengthInfo): string | null {
  const s = ctx.s;
  if (bc.ballAndChain) return null;
  if (starReady(s, att, 'lordBorak')) return starRuleLabel('lordBorak');
  if (bc.isBlitz && starReady(s, att, 'hthark')) return starRuleLabel('hthark');
  if (starReady(s, att, 'willow') && veteranWouldGoDown(pool, st.chooser === 'attacker' || def.team === att.team, att)) return starRuleLabel('willow');
  if (starReady(s, att, 'lucien') && s.players.some((v) => v.star === 'valen' && v.team === att.team && hasTackleZone(v) && !!v.pos && !!def.pos && adjacent(v.pos, def.pos))) return starRuleLabel('lucien');
  if (starReady(s, att, 'puggy')) return starRuleLabel('puggy');
  if (starReady(s, att, 'ripper')) return starRuleLabel('ripper');
  return null;
}

/** Every different non-empty selection of dice from a pool (as sorted face lists), e.g. for Anqi Panqi's Savage Blow. */
export function faceSubsets(pool: Pool): BlockFace[][] {
  const counts = new Map<BlockFace, number>();
  for (const f of pool) counts.set(f, (counts.get(f) ?? 0) + 1);
  let out: BlockFace[][] = [[]];
  for (const [f, c] of counts) {
    const next: BlockFace[][] = [];
    for (const base of out) for (let k = 0; k <= c; k++) next.push([...base, ...Array.from({ length: k }, () => f)]);
    out = next;
  }
  return out.filter((x) => x.length).map((x) => x.sort()).sort((a, b) => a.length - b.length || a.join().localeCompare(b.join()));
}

/**
 * Grashnak Blackhoof's Gored by the Bull (p.200): once per game, blocking during a Blitz, one more Block die
 * (at most three) whatever the target's ST; a Frenzy second Block of that activation benefits too.
 */
function goredByTheBull(ctx: Ctx, att: Player, bc: BlockContext, act: Activation, st: StrengthInfo): void {
  if (!bc.isBlitz || att.star !== 'grashnak' || st.dice >= 3) return;
  let use = !!act.starFlags?.includes('gored');
  if (!use && starReady(ctx.s, att, 'grashnak')) {
    use = askStar(ctx, att, `Roll one more Block die (${st.dice} → ${st.dice + 1})${st.chooser === 'defender' ? ' — the defender still chooses the result' : ''}?`, `Use Gored by the Bull: ${st.dice + 1} dice`, st.chooser === 'attacker');
    if (use) {
      spendStar(ctx, att, `one more Block die for this Blitz (also for a Frenzy second Block).`);
      act.starFlags = [...(act.starFlags ?? []), 'gored'];
    }
  }
  if (!use) return;
  st.dice += 1;
  st.notes.push('Gored by the Bull +1 die');
}

/**
 * Would these block dice Knock the (Sevens Veteran) attacker Down? Player Down always does; Both Down unless
 * the attacker has Block. When the attacker chooses, only if every die does; when the defender chooses, if
 * any die does (docs/SEVENS_RULES.md, interpretation 3).
 */
export function veteranWouldGoDown(pool: BlockFace[], attackerChooses: boolean, att: Player): boolean {
  const down = (f: BlockFace) => f === 'playerDown' || (f === 'bothDown' && !canUse(att, 'block'));
  return attackerChooses ? pool.every(down) : pool.some(down);
}

/**
 * Multiple Block (p.132): two Block Actions against two different opposition
 * players the blocker Marks, each at ST −2, resolved in full even if one of
 * them causes a Turnover, without Follow-up. Interpretation
 * (docs/RULES_COVERAGE.md): both strengths are fixed before any Block dice
 * are rolled; the dice are rolled one Block after the other; results that
 * would knock down an attacker already down in the first Block only affect
 * the target.
 */
export function performMultipleBlock(ctx: Ctx, att: Player, d1: Player, d2: Player, act: Activation): void {
  if (d1.id === d2.id) throw new IllegalAction('Multiple Block needs two different targets (p.132).');
  for (const d of [d1, d2]) {
    const why = blockBlockedReason(ctx, att, d);
    if (why) throw new IllegalAction(why);
  }
  const attFrom = att.pos as Coord;
  const rule = { page: 132, title: 'Multiple Block' };
  const bc: BlockContext = { isBlitz: false, declaredBlock: true, multiple: true };
  ctx.emit('block', `${label(att)} uses Multiple Block on ${label(d1)} and ${label(d2)} (ST −2 for both Blocks).`, rule, { attacker: att.id, defender: d1.id, defender2: d2.id });
  for (const d of [d1, d2]) foulAppearance(ctx, att, d, act, 'Block');
  for (const d of [d1, d2]) targetReactions(ctx, att, d, { trickster: true });
  const pairs: Array<{ d: Player; st: StrengthInfo }> = [];
  for (const d of [d1, d2]) {
    const base = dauntless(ctx, att, d);
    pairs.push({ d, st: blockStrength(ctx, att, d, bc, Math.max(1, base - 2)) });
  }
  useCheeringBonus(ctx.s, att.team);
  let stop: ActionStop | null = null;
  for (const { d, st } of pairs) {
    const attDown = att.location !== 'pitch' || att.stance !== 'standing';
    if (d.location !== 'pitch' || d.stance !== 'standing' || !d.pos || !adjacent(attFrom, d.pos)) {
      ctx.emit('note', `${label(d)} is no longer a Standing player next to the blocker: that Block has no effect.`, rule);
      continue;
    }
    ctx.emit('block', `${label(att)} blocks ${label(d)} in ${fmt(d.pos)} (Multiple Block).`, rule, { attacker: att.id, defender: d.id });
    try {
      const eff = blockDiceAndChoice(ctx, att, d, bc, act, st);
      resolveBlockResult(ctx, att, d, eff, { ...bc, attackerDown: attDown }, act, attFrom);
    } catch (e) {
      if (!(e instanceof ActionStop)) throw e;
      stop = stop ?? e;
    }
  }
  act.blocksDone = 2;
  act.over = true;
  checkTouchdown(ctx, true);
  if (stop || ctx.turnover) throw stop ?? new ActionStop('turnover');
  hitAndRun(ctx, att, act);
}

function faceDetail(f: BlockFace, att: Player, def: Player, bc: BlockContext): string {
  switch (effectiveFace(f, att, def)) {
    case 'playerDown':
      return 'Attacker is Knocked Down (Turnover).';
    case 'bothDown': {
      const a = canUse(att, 'block') ? 'attacker stays up (Block)' : 'attacker down (Turnover)';
      const d = canUse(def, 'block') ? 'defender stays up (Block)' : 'defender down';
      return `${a}; ${d}${bc.isBlitz && canUse(att, 'juggernaut') ? '; Juggernaut may treat as Push' : ''}.`;
    }
    case 'push':
      return f === 'stumble' ? 'Defender Dodges: Push Back.' : 'Defender is Pushed Back.';
    default:
      return 'Defender is Pushed Back and Knocked Down.';
  }
}

function resolveBlockResult(ctx: Ctx, att: Player, def: Player, eff: BlockFace, bc: BlockContext, act: Activation, attFrom: Coord): void {
  const jugg = bc.isBlitz && canUse(att, 'juggernaut');
  if (bc.attackerDown && (eff === 'playerDown' || eff === 'bothDown')) {
    // Multiple Block: the attacker already went down in the other Block.
    ctx.emit('note', `${label(att)} is already down: the ${eff === 'playerDown' ? 'Player Down' : 'Both Down'} result only affects ${label(def)}.`, { page: 132, title: 'Multiple Block' });
    if (eff === 'bothDown' && !canUse(def, 'block')) goDown(ctx, def, { kind: 'knockedDown', by: att, inBlock: true, reason: 'Both Down' });
    checkTouchdown(ctx, false);
    return;
  }
  if (eff === 'playerDown') {
    goDown(ctx, att, { kind: 'knockedDown', by: def, inBlock: true, reason: 'Player Down' });
    act.over = true;
    checkTouchdown(ctx, false);
    throw new ActionStop('attacker down');
  }
  if (eff === 'bothDown') {
    let asPush = false;
    if (jugg) {
      const c = ctx.ask({
        type: 'juggernaut',
        team: att.team,
        prompt: 'Both Down: use Juggernaut to treat it as a Push Back?',
        options: [
          { id: 'push', label: 'Treat as Push Back (Juggernaut)' },
          { id: 'both', label: 'Keep Both Down' },
        ],
        rule: { page: 129, title: 'Juggernaut' },
      });
      asPush = c === 'push';
    }
    if (asPush) {
      ctx.emit('block', 'Juggernaut: Both Down is treated as Push Back.', { page: 129, title: 'Juggernaut' });
      resolvePush(ctx, att, def, bc, act, attFrom, false);
      return;
    }
    // Wrestle (p.138): either player may use it; both are Placed Prone.
    let wrestle = false;
    if (canUse(att, 'wrestle')) {
      const c = ctx.ask({
        type: 'wrestle',
        team: att.team,
        prompt: 'Both Down: use Wrestle? Both players are Placed Prone (no Armour Rolls).',
        options: [
          { id: 'yes', label: 'Use Wrestle (both Placed Prone)' },
          { id: 'no', label: 'Do not use Wrestle' },
        ],
        rule: { page: 138, title: 'Wrestle' },
      });
      wrestle = c === 'yes';
    }
    if (!wrestle && canUse(def, 'wrestle') && !jugg) {
      const c = ctx.ask({
        type: 'wrestle',
        team: def.team,
        prompt: `Both Down: ${label(def)} may use Wrestle — both players are Placed Prone (no Armour Rolls).`,
        options: [
          { id: 'yes', label: 'Use Wrestle (both Placed Prone)' },
          { id: 'no', label: 'Do not use Wrestle' },
        ],
        rule: { page: 138, title: 'Wrestle' },
      });
      wrestle = c === 'yes';
    }
    if (wrestle) {
      ctx.emit('block', 'Wrestle: both players are Placed Prone.', { page: 138, title: 'Wrestle' });
      goDown(ctx, att, { kind: 'placedProne', reason: 'Wrestle' });
      goDown(ctx, def, { kind: 'placedProne', reason: 'Wrestle' });
      act.over = true;
      checkTouchdown(ctx, false);
      throw new ActionStop('wrestle');
    }
    const attBlock = canUse(att, 'block');
    const defBlock = canUse(def, 'block');
    if (attBlock) ctx.emit('note', `${label(att)} uses Block and is not Knocked Down (always beneficial, applied automatically).`, { page: 124, title: 'Block' });
    if (defBlock) ctx.emit('note', `${label(def)} uses Block and is not Knocked Down (always beneficial, applied automatically).`, { page: 124, title: 'Block' });
    let attackerDown = false;
    if (!attBlock) {
      const r = goDown(ctx, att, { kind: 'knockedDown', by: def, inBlock: true, reason: 'Both Down' });
      attackerDown = !r.avoided;
    }
    let defDown = false;
    if (!defBlock) defDown = !goDown(ctx, def, { kind: 'knockedDown', by: att, inBlock: true, reason: 'Both Down' }).avoided;
    checkTouchdown(ctx, false);
    if (attackerDown) {
      act.over = true;
      throw new ActionStop('attacker down');
    }
    // Pile Driver is not used with Multiple Block (interpretation: the two Blocks are simultaneous and without Follow-up).
    if (defDown && !bc.multiple) pileDriver(ctx, att, def, act);
    afterBlock(ctx, att, def, bc, act, false, false);
    return;
  }
  resolvePush(ctx, att, def, bc, act, attFrom, eff === 'pow');
}

export interface PushOutcome {
  moved: boolean;
  crowd: boolean;
  to: Coord | null;
}

/** Push the target back, handle follow-up, ball, knock-down (for POW), Frenzy. */
function resolvePush(ctx: Ctx, att: Player, def: Player, bc: BlockContext, act: Activation, attFrom: Coord, pow: boolean): void {
  const s = ctx.s;
  const jugg = bc.isBlitz && canUse(att, 'juggernaut');
  const defFrom = def.pos as Coord;
  let standFirm = false;
  if (def.rooted) {
    standFirm = true;
    ctx.emit('push', `${label(def)} is Rooted and cannot be Pushed Back.`, { page: 137, title: 'Take Root' });
  } else if (canUse(def, 'standFirm') && !jugg) {
    const c = ctx.ask({
      type: 'standFirm',
      team: def.team,
      prompt: `${label(def)} may use Stand Firm and not be Pushed Back.`,
      options: [
        { id: 'yes', label: 'Use Stand Firm (stay put)' },
        { id: 'no', label: 'Allow the push' },
      ],
      rule: { page: 136, title: 'Stand Firm' },
    });
    standFirm = c === 'yes';
  }
  let out: PushOutcome = { moved: false, crowd: false, to: null };
  const pushedAround: Player[] = [];
  if (standFirm) {
    if (!def.rooted) ctx.emit('push', `${label(def)} uses Stand Firm and is not pushed.`, { page: 136, title: 'Stand Firm' });
  } else {
    out = pushPlayer(ctx, att, attFrom, def, true, bc, jugg, pushedAround);
    if (out.moved && canUse(att, 'eyeGouge')) {
      def.eyeGouged = true;
      ctx.emit('note', `Eye Gouge: ${label(def)} cannot provide assists until next activated.`, { page: 128, title: 'Eye Gouge' });
    }
  }

  // Follow-up (p.63)
  let followed = false;
  // A Ball & Chain player's movement is compulsory, so Chomped does not stop the move into the target's square (FAQ May 2026 p.124; empty squares already ignore it).
  const cannotFollow = bc.multiple || bc.reach || att.rooted || (isChomped(s, att) && !(bc.ballAndChain && faq2026(s)));
  if (out.moved && !playerAt(s, defFrom) && att.stance === 'standing' && att.pos && eq(att.pos, attFrom) && cannotFollow) {
    ctx.emit('note', bc.multiple ? 'Multiple Block: no Follow-up (p.132).' : bc.reach ? 'Vicious Vines: no Follow-up (p.204).' : `${label(att)} cannot leave their square: no Follow-up.`, bc.multiple ? { page: 132, title: 'Multiple Block' } : bc.reach ? { page: 204, title: 'Maple Highgrove: Vicious Vines' } : att.rooted ? { page: 137, title: 'Take Root' } : { page: 131, title: 'Monstrous Mouth' });
  } else if (out.moved && !playerAt(s, defFrom) && att.stance === 'standing' && att.pos && eq(att.pos, attFrom)) {
    const frenzy = hasSkill(att, 'frenzy') && canUse(att, 'frenzy');
    const fendBlocks = canUse(def, 'fend') && !jugg && !out.crowd && !bc.ballAndChain ? true : false;
    let fend = false;
    if (fendBlocks && !frenzy) {
      const c = ctx.ask({
        type: 'fend',
        team: def.team,
        prompt: `${label(def)} may use Fend to stop ${label(att)} following up.`,
        options: [
          { id: 'yes', label: 'Use Fend (no Follow-up)' },
          { id: 'no', label: 'Allow Follow-up' },
        ],
        rule: { page: 128, title: 'Fend' },
      });
      fend = c === 'yes';
    } else if (fendBlocks && frenzy) {
      const c = ctx.ask({
        type: 'fend',
        team: def.team,
        prompt: `${label(def)} may use Fend to stop the Frenzied ${label(att)} following up.`,
        options: [
          { id: 'yes', label: 'Use Fend (no Follow-up)' },
          { id: 'no', label: 'Allow Follow-up' },
        ],
        rule: { page: 128, title: 'Fend' },
      });
      fend = c === 'yes';
    }
    if (fend) {
      ctx.emit('push', `${label(def)} uses Fend: no Follow-up.`, { page: 128, title: 'Fend' });
    } else if (frenzy) {
      followed = true;
      ctx.emit('note', 'Frenzy: the blocker must Follow-up.', { page: 128, title: 'Frenzy' });
    } else {
      let forced = false;
      if (canUse(def, 'taunt') && !att.rooted) {
        const c = ctx.ask({
          type: 'taunt',
          team: def.team,
          prompt: `${label(def)} may use Taunt to force ${label(att)} to Follow-up.`,
          options: [
            { id: 'yes', label: 'Force the Follow-up (Taunt)' },
            { id: 'no', label: 'Do not use Taunt' },
          ],
          rule: { page: 137, title: 'Taunt' },
        });
        forced = c === 'yes';
      }
      if (forced) {
        followed = true;
        ctx.emit('note', 'Taunt: the blocker must Follow-up.', { page: 137, title: 'Taunt' });
      } else {
        const c = ctx.ask({
          type: 'followUp',
          team: att.team,
          prompt: `Follow-up into ${fmt(defFrom)}?`,
          options: [
            { id: 'yes', label: `Follow-up into ${fmt(defFrom)}`, square: defFrom },
            { id: 'no', label: 'Stay put' },
          ],
          rule: R.followUp,
        });
        followed = c === 'yes';
      }
    }
    if (followed) {
      att.pos = { ...defFrom };
      ctx.emit('move', `${label(att)} follows up into ${fmt(defFrom)} (free move).`, R.followUp, { playerId: att.id, from: attFrom, to: defFrom });
    }
  }

  // Strip Ball (p.136): after the Follow-up, before becoming Prone.
  if (out.moved && !out.crowd && hasBall(s, def) && canUse(att, 'stripBall') && !canUse(def, 'sureHands') && !canUse(def, 'monstrousMouth')) {
    const c = ctx.ask({
      type: 'stripBall',
      team: att.team,
      prompt: `Use Strip Ball to make ${label(def)} drop the ball in ${fmt(def.pos)}?`,
      options: [
        { id: 'yes', label: 'Strip the ball' },
        { id: 'no', label: 'Do not use Strip Ball' },
      ],
      rule: { page: 136, title: 'Strip Ball' },
    });
    if (c === 'yes') {
      ctx.emit('ball', `${label(def)} drops the ball (Strip Ball).`, { page: 136, title: 'Strip Ball' });
      s.ball = { kind: 'ground', pos: { ...(def.pos as Coord) } };
      bounce(ctx, def.pos as Coord);
    }
  }

  // Players pushed onto a loose ball make it bounce (no Turnover).
  for (const q of pushedAround) if (q.location === 'pitch') ballDisplacedBy(ctx, q);

  // POW: knocked down in the new square (unless in the crowd).
  if (pow && def.location === 'pitch' && def.stance === 'standing') {
    const down = !goDown(ctx, def, { kind: 'knockedDown', by: att, inBlock: true, reason: 'POW!' }).avoided;
    if (down && !bc.multiple) pileDriver(ctx, att, def, act);
  }
  // Treacherous Trapdoor (Prayer to Nuffle, p.143): pushed players and a Follow-up onto a Trapdoor, once the Block is resolved.
  for (const q of [...pushedAround, ...(att.pos && !eq(att.pos, attFrom) ? [att] : [])]) trapdoorCheck(ctx, q);
  afterBlock(ctx, att, def, bc, act, true, out.moved || standFirm);
}

/**
 * Plain push squares (p.62) leave no choice but the crowd: none of them is an
 * empty square on the pitch and at least one is off the pitch (p.63). This is
 * the exact condition `pushPlayer` uses; skills that change the push (Stand
 * Firm, Sidestep, Grab) are not considered here — see `crowdPushRisk`.
 */
export function pushesIntoCrowd(s: GameState, fromSq: Coord, victimPos: Coord): boolean {
  const sq = pushSquares(fromSq, victimPos);
  if (sq.some((c) => inBounds(c) && !playerAt(s, c))) return false;
  return sq.some((c) => !inBounds(c));
}

/**
 * Read-only query for coaches and the computer (no dice, no state change):
 * the squares next to `victim` from which a Block would push them into the
 * crowd, taking their own Stand Firm / Sidestep into account (an attacker
 * with Juggernaut or Grab is not assumed). Empty when a push cannot send them
 * off the pitch.
 */
export function crowdPushSquares(s: GameState, victim: Player): Coord[] {
  const v = victim.pos;
  if (!v || victim.location !== 'pitch' || victim.rooted) return [];
  if (canUse(victim, 'standFirm')) return [];
  if (canUse(victim, 'sidestep') && neighbours(v).some((c) => inBounds(c) && !playerAt(s, c))) return [];
  return neighbours(v).filter((a) => inBounds(a) && pushesIntoCrowd(s, a, v));
}

/**
 * Push a player away from `fromSq` outside a Block (Ball & Chain moving into
 * a Prone or Stunned player, p.124): chain pushes and the crowd as normal;
 * players moved onto a loose ball make it bounce.
 */
export function pushAway(ctx: Ctx, att: Player, fromSq: Coord, victim: Player): PushOutcome {
  const moved: Player[] = [];
  if (victim.rooted) {
    ctx.emit('push', `${label(victim)} is Rooted and cannot be Pushed Back.`, { page: 137, title: 'Take Root' });
    return { moved: false, crowd: false, to: null };
  }
  const out = pushPlayer(ctx, att, fromSq, victim, false, { isBlitz: false, declaredBlock: false, ballAndChain: true }, false, moved);
  for (const q of moved) if (q.location === 'pitch') ballDisplacedBy(ctx, q);
  for (const q of moved) trapdoorCheck(ctx, q);
  return out;
}

/**
 * Push `victim` away from `fromSq` (p.62-63). Recursively resolves chain
 * pushes. Returns where the victim went.
 */
function pushPlayer(ctx: Ctx, att: Player, fromSq: Coord, victim: Player, first: boolean, bc: BlockContext, jugg: boolean, moved: Player[]): PushOutcome {
  const s = ctx.s;
  const vFrom = victim.pos as Coord;
  const grab = canUse(att, 'grab') && !grabForbidden(s, att);
  const grabUse = first && bc.declaredBlock && grab;
  // Grab: the TARGET of a declared Block cannot Sidestep (p.128). FAQ May 2026 p.128: not on a Blitz, and not the other players of a Chain Push.
  const sidestepBlocked = faq2026(s) ? grabUse : grab;
  const empty = (c: Coord) => inBounds(c) && !playerAt(s, c);
  let candidates: Coord[] = [];
  let decider = att.team;
  let decType: 'pushSquare' | 'sidestepSquare' | 'grabSquare' = 'pushSquare';

  const adjEmpty = neighbours(vFrom).filter(empty);
  if (canUse(victim, 'sidestep') && !(sidestepBlocked && victim.team !== att.team) && adjEmpty.length) {
    const c = ctx.ask({
      type: 'skill',
      team: victim.team,
      prompt: `${label(victim)} may use Sidestep and choose the push square.`,
      context: { skill: 'sidestep' },
      options: [
        { id: 'yes', label: 'Use Sidestep' },
        { id: 'no', label: 'Let the opponent choose' },
      ],
      rule: { page: 135, title: 'Sidestep' },
    });
    if (c === 'yes') {
      candidates = adjEmpty;
      decider = victim.team;
      decType = 'sidestepSquare';
    }
  }
  if (!candidates.length && grabUse && adjEmpty.length) {
    const c = ctx.ask({
      type: 'skill',
      team: att.team,
      prompt: `${label(att)} may use Grab to push ${label(victim)} into any unoccupied adjacent square.`,
      context: { skill: 'grab' },
      options: [
        { id: 'yes', label: 'Use Grab' },
        { id: 'no', label: 'Normal push' },
      ],
      rule: { page: 128, title: 'Grab' },
    });
    if (c === 'yes') {
      candidates = adjEmpty;
      decType = 'grabSquare';
    }
  }
  let crowd = false;
  if (!candidates.length) {
    const sq = pushSquares(fromSq, vFrom);
    const free = sq.filter(empty);
    if (free.length) candidates = free;
    else if (pushesIntoCrowd(s, fromSq, vFrom)) crowd = true;
    else candidates = sq.filter((c) => inBounds(c));
  }

  if (crowd) {
    const offSq = pushSquares(fromSq, vFrom).find((c) => !inBounds(c)) as Coord;
    ctx.emit('push', `${label(victim)} is pushed out of ${fmt(vFrom)} into the crowd!`, R.crowdPush, { playerId: victim.id, from: vFrom, crowd: true });
    const hadBall = hasBall(s, victim);
    moveOffPitch(victim, 'reserves');
    victim.location = 'reserves';
    if (victim.team === s.turn.active) ctx.setTurnover(`${label(victim)} was pushed into the crowd`, R.crowdPush);
    crowdInjury(ctx, victim);
    if (hadBall) {
      ctx.emit('ball', `The ball goes into the crowd with ${label(victim)} and is thrown in.`, R.crowdPush);
      throwIn(ctx, vFrom, offSq);
    }
    return { moved: true, crowd: true, to: null };
  }

  // Choose among candidates; Stand Firm on chain-pushed players may block a square.
  let options = candidates.slice();
  for (;;) {
    if (!options.length) {
      ctx.emit('push', `${label(victim)} cannot be pushed anywhere and stays in ${fmt(vFrom)}.`, R.chainPush);
      return { moved: false, crowd: false, to: null };
    }
    const pick = ctx.ask({
      type: decType,
      team: decider,
      prompt: `Choose where ${label(victim)} is pushed${options.some((c) => playerAt(s, c)) ? ' (occupied squares cause a Chain Push)' : ''}.`,
      options: options.map((c) => ({ id: `${c.x},${c.y}`, label: `${fmt(c)}${playerAt(s, c) ? ` (chain push ${label(playerAt(s, c) as Player)})` : ''}`, square: c })),
      context: { victim: victim.id, from: vFrom, attacker: att.id },
      rule: decType === 'pushSquare' ? R.push : decType === 'sidestepSquare' ? { page: 135, title: 'Sidestep' } : { page: 128, title: 'Grab' },
    });
    const [x, y] = pick.split(',').map(Number);
    const to = { x, y };
    const occ = playerAt(s, to);
    if (occ) {
      // Chain push (p.63). A Rooted player cannot be pushed (p.137).
      if (occ.rooted) {
        ctx.emit('push', `${label(occ)} is Rooted; ${label(victim)} cannot be pushed into ${fmt(to)}.`, { page: 137, title: 'Take Root' });
        options = options.filter((c2) => !eq(c2, to));
        continue;
      }
      if (canUse(occ, 'standFirm') && !(jugg && occ.team !== att.team)) {
        const c = ctx.ask({
          type: 'standFirm',
          team: occ.team,
          prompt: `${label(occ)} is about to be chain-pushed. Use Stand Firm?`,
          options: [
            { id: 'yes', label: 'Use Stand Firm' },
            { id: 'no', label: 'Allow the chain push' },
          ],
          rule: { page: 136, title: 'Stand Firm' },
        });
        if (c === 'yes') {
          ctx.emit('push', `${label(occ)} uses Stand Firm; ${label(victim)} cannot be pushed into ${fmt(to)}.`, { page: 136, title: 'Stand Firm' });
          options = options.filter((c2) => !eq(c2, to));
          continue;
        }
      }
      ctx.emit('push', `Chain push: ${label(occ)} in ${fmt(to)} will be pushed too.`, R.chainPush);
      const sub = pushPlayer(ctx, att, vFrom, occ, false, bc, jugg, moved);
      if (!sub.moved) {
        options = options.filter((c2) => !eq(c2, to));
        continue;
      }
    }
    victim.pos = { ...to };
    moved.push(victim);
    ctx.emit('push', `${label(victim)} is pushed ${fmt(vFrom)} → ${fmt(to)}.`, first ? R.push : R.chainPush, { playerId: victim.id, from: vFrom, to });
    return { moved: true, crowd: false, to };
  }
}

/** After the block result: TD check, Frenzy second block, Hit and Run. */
function afterBlock(ctx: Ctx, att: Player, def: Player, bc: BlockContext, act: Activation, wasPush: boolean, pushResolved: boolean): void {
  checkTouchdown(ctx, true);
  if (ctx.turnover) throw new ActionStop('turnover');
  if (bc.multiple) return;
  act.blocksDone += 1;
  // Frenzy (p.128): second Block if the target was Pushed Back and is still Standing.
  if (wasPush && pushResolved && hasSkill(att, 'frenzy') && canUse(att, 'frenzy') && act.blocksDone === 1 && def.location === 'pitch' && def.stance === 'standing' && att.pos && def.pos && adjacent(att.pos, def.pos)) {
    if (bc.isBlitz) {
      const maLeft = att.ma - act.maUsed;
      const rushLeft = 2 + (canUse(att, 'sprint') ? 1 : 0) - act.rushesUsed;
      if (maLeft <= 0 && rushLeft <= 0) {
        ctx.emit('note', 'Frenzy: no movement left, so no second Block.', { page: 128, title: 'Frenzy' });
        hitAndRun(ctx, att, act);
        return;
      }
      payMovement(ctx, att, act, 1, null, 'make the second Frenzy Block');
    }
    ctx.emit('note', 'Frenzy: the target is still Standing — the blocker must Block again.', { page: 128, title: 'Frenzy' });
    performBlock(ctx, att, def, bc, act, true);
    return;
  }
  hitAndRun(ctx, att, act);
}

export function hitAndRun(ctx: Ctx, att: Player, act: Activation): void {
  if (!canUse(att, 'hitAndRun') || !att.pos || heldInPlace(ctx.s, att)) return;
  const s = ctx.s;
  const opp = pitchPlayers(s, att.team === 'A' ? 'B' : 'A');
  const squares = neighbours(att.pos).filter((c) => !playerAt(s, c) && !opp.some((q) => adjacent(q.pos as Coord, c)));
  if (!squares.length) return;
  const c = ctx.ask({
    type: 'hitAndRun',
    team: att.team,
    prompt: 'Hit and Run: move one free square ending away from all opposition players?',
    options: [{ id: 'stay', label: 'Stay' }, ...squares.map((q) => ({ id: `${q.x},${q.y}`, label: `Move to ${fmt(q)}`, square: q }))],
    rule: { page: 129, title: 'Hit and Run' },
  });
  if (c === 'stay') return;
  const [x, y] = c.split(',').map(Number);
  const from = att.pos;
  att.pos = { x, y };
  ctx.emit('move', `${label(att)} uses Hit and Run: ${fmt(from)} → ${fmt(att.pos)}.`, { page: 129, title: 'Hit and Run' });
  if (s.ball.kind === 'ground' && eq(s.ball.pos, att.pos)) pickUp(ctx, att);
  checkTouchdown(ctx, true);
  void act;
}
