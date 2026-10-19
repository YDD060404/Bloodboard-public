import { usePitch } from './variant';
import { adjacent, dist, eq, fmt } from './board';
import { blockBlockedReason, hitAndRun, performBlock } from './block';
import { bounce, checkTouchdown } from './ball';
import { ActionStop, Ctx, IllegalAction, type Mod } from './context';
import { maxRushes, moveStep, payMovement, standUp } from './move';
import { passBlockedReason, passInfo, performHandoff, performPass } from './pass';
import { chargeReason, endCharge, isMatchInput, resolveMatchInput } from './match';
import { performThrowTeamMate, ttmBlockedReason } from './special';
import { ballAndChainStep, bombTargets, performPunt, performTargetedSpecial, performThrowBomb, SPECIALS, specialsOf, specialTargets } from './specials';
import { performFoul } from './foul';
import { performMultipleBlock } from './block';
import { rollTest } from './roll';
import { R } from './rules';
import { BLOCKS_ACTIVATION, gated, SKILL_BY_ID } from './skills';
import { canUse, faq2026, findPlayer, getPlayer, hasBall, hasSkill, hasTackleZone, label, markersOf, other, pitchPlayers } from './state';
import { activationTraits, endActivation, endTurn, finishDrive, forgo, startActivation } from './turn';
import { foulTakenReason, spendStar, starReady } from './stars';
import { bilerotAfterBlock, chooseStarPlayer, startRuleReason, startRuleTargets, useStartRule } from './starActions';
import { castWizard } from './wizard';
import { bloodlustSettled } from './traits';
import { DESPERATE, DESPERATE_NUMBER, DESPERATE_RULE, desperateLeft, razzlePairReason, spendDesperate } from './desperate';
import { sendOff } from './foul';
import type { ActionInput, ActionType, Coord, GameState, Player, PlayerActionInput, SpecialId } from './types';

export interface ActionAvailability {
  action: ActionType;
  label: string;
  enabled: boolean;
  reason?: string;
  /** Not implemented in v1 (shown but always disabled). */
  unsupported?: boolean;
  /** For action 'special': which Special Action. */
  special?: string;
}

/**
 * Special Actions offered in the interface. The rules for the others are in
 * specials.ts but stay switched off until they are verified (they are shown
 * disabled with an explanation, as in V3).
 */
const OFFERED_SPECIALS: SpecialId[] = ['projectileVomit', 'punt', 'stab', 'breatheFire', 'monstrousMouth', 'hypnoticGaze', 'chainsaw', 'bombardier', 'kickTeamMate', 'ballAndChain'];

export function activationBlockReason(s: GameState, p: Player): string | null {
  if (s.phase !== 'play') return 'The game is not in play.';
  if (s.pending) return 'Finish the pending decision first.';
  if (p.team !== s.turn.active) return 'It is not this team\'s Turn.';
  if (p.location !== 'pitch') return 'The player is not on the pitch.';
  if (p.stance === 'stunned') return 'Stunned players cannot be activated (p.39).';
  const act = s.turn.activation;
  if (act && act.playerId === p.id && !act.over) return null;
  if (p.activated) return 'This player has already been activated this Turn.';
  // Estelle la Veneaux's Baleful Hex (p.198): cannot be activated during their team's next Turn.
  if (p.hexed && p.hexed.half === s.turn.half && p.hexed.turn === s.teams[p.team].turn) return "Baleful Hex (Estelle la Veneaux, p.198): this player cannot be activated this Turn.";
  const bad = p.skills.find((sk) => BLOCKS_ACTIVATION.includes(sk.id) && gated(sk.id));
  if (bad) return `Not available yet: ${SKILL_BY_ID[bad.id]?.name ?? bad.id} (p.${SKILL_BY_ID[bad.id]?.page}) — this player cannot be activated in this version.`;
  return null;
}

/** Which Actions can this player declare right now? */
export function actionOptions(s: GameState, p: Player): ActionAvailability[] {
  usePitch(s);
  const base = activationBlockReason(s, p);
  const act = s.turn.activation;
  const continuing = !!act && act.playerId === p.id && !act.over;
  const res: ActionAvailability[] = [];
  // Ball & Chain (p.124): the only Action such a player can declare is the Ball & Chain Special Action.
  const bnc = hasSkill(p, 'ballAndChain') && !gated('ballAndChain');
  const add = (action: ActionType, lbl: string, reason: string | null, unsupported = false, special?: SpecialId) => {
    // Kick-off Event Charge! (p.48) limits which Actions the selected players may take.
    const charge = continuing ? null : chargeReason(s, p, action, special);
    const chain = bnc && !continuing && lbl !== SPECIALS.ballAndChain.name ? 'A Ball & Chain player can only declare the Ball & Chain Special Action (p.124).' : null;
    res.push({ action, label: lbl, enabled: !base && !charge && !reason && !chain && !unsupported, reason: base ?? charge ?? chain ?? reason ?? undefined, unsupported });
  };
  if (continuing) {
    const a = act as NonNullable<typeof act>;
    const names: Record<ActionType, string> = { move: 'Move', blitz: 'Blitz', block: 'Block', pass: 'Pass', handoff: 'Hand-off', secure: 'Secure the Ball', foul: 'Foul', ttm: 'Throw Team-mate', special: 'Special' };
    add(a.action, `Continue ${a.special ? SPECIALS[a.special].name : names[a.action]}`, null);
    if (a.special) res[res.length - 1].special = a.special;
    // Sevens Desperate Measure Razzle-Dazzle (Spike! 22 p.15): a second, different Action this activation.
    if (a.razzle && !a.razzle.second) {
      for (const x of ['block', 'move', 'blitz', 'pass', 'handoff', 'secure', 'foul'] as ActionType[]) {
        if (x === a.action) continue;
        add(x, `${names[x]} (second Action, Razzle-Dazzle)`, razzleSecondReason(s, p, a, x));
      }
    }
    return res;
  }
  const opp = pitchPlayers(s, other(p.team));
  const standing = p.stance === 'standing';
  const adjTargets = opp.filter((q) => q.stance === 'standing' && p.pos && adjacent(q.pos as Coord, p.pos));
  add('move', 'Move', null);
  let blockReason: string | null = null;
  if (!standing && !canUse(p, 'jumpUp')) blockReason = 'Only Standing players (or Prone players with Jump Up) can declare a Block.';
  else if (!adjTargets.length && startRuleReason(s, p, 'block') !== null) blockReason = 'No adjacent Standing opposition player to Block.';
  add('block', 'Block', blockReason);
  add('blitz', 'Blitz', s.turn.used.blitz ? 'The Blitz Action has already been declared this Turn.' : null);
  add('pass', 'Pass', s.turn.used.pass ? 'The Pass Action has already been declared this Turn.' : passBlockedReasonState(s, p));
  add('handoff', 'Hand-off', s.turn.used.handoff ? 'The Hand-off Action has already been declared this Turn.' : hasSkill(p, 'myBall') ? 'My Ball: cannot Hand-off (p.132).' : null);
  add('secure', 'Secure the Ball', s.turn.used.secure ? 'The Secure the Ball Action has already been declared this Turn.' : secureReason(s, p));
  add('foul', 'Foul', foulTakenReason(s, p) ?? foulReason(s, p));
  if (hasSkill(p, 'throwTeamMate')) add('ttm', 'Throw Team-mate', ttmBlockedReason(s, p));
  for (const id of specialsOf(p)) {
    const info = SPECIALS[id];
    if (!OFFERED_SPECIALS.includes(id)) {
      add('special', info.name, null, true);
      res[res.length - 1].reason = `Not available yet: the ${info.name} Special Action (p.${info.page}) is disabled in this version.`;
      res[res.length - 1].special = id;
      continue;
    }
    let why: string | null = null;
    if (info.once && s.turn.used[info.once]) why = `Only one ${info.name} Special Action per Turn (p.${info.page}).`;
    else if (!standing && !info.move) why = `Only a Standing player can use ${info.name}.`;
    else if (info.targeted && !info.move && !(p.pos && specialTargets(s, p, id).length) && startRuleReason(s, p, 'special', id) !== null) why = `No Standing opposition player is adjacent (p.${info.page}).`;
    // Bilerot Vomitflesh has Projectile Vomit only through his special rule (once per half).
    if (!why && !hasSkill(p, info.skill) && p.star === 'bilerot') why = startRuleReason(s, p, 'special', id);
    add('special', info.name, why, false, id);
    res[res.length - 1].special = id;
  }
  return res;
}

/** Why no Foul can be declared (null = it can; the move comes first, p.69). */
function foulReason(s: GameState, p: Player): string | null {
  const targets = pitchPlayers(s, other(p.team)).filter((q) => q.stance !== 'standing');
  if (!targets.length) return 'No Prone or Stunned opposition player is on the pitch to foul (p.69).';
  return null;
}

function passBlockedReasonState(s: GameState, p: Player): string | null {
  const ctxLike = { s } as unknown as Ctx;
  return passBlockedReason(ctxLike, p);
}

export function secureReason(s: GameState, p: Player): string | null {
  if (s.ball.kind !== 'ground') return 'The ball must be loose on the ground (p.59).';
  if (p.keywords.some((k) => k.toLowerCase() === 'big guy')) return 'Big Guy players cannot declare Secure the Ball (p.51).';
  if (hasSkill(p, 'unsteady')) return 'Unsteady: cannot declare Secure the Ball (p.138).';
  const ball = s.ball.pos;
  const near = pitchPlayers(s, other(p.team)).find((q) => hasTackleZone(q) && dist(q.pos as Coord, ball) <= 2);
  if (near) return `${label(near)} (Standing, not Distracted) is within 2 squares of the ball (p.59).`;
  return null;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface RunOptions {
  /** Plan previews stop at a Turnover without running the end-of-turn sequence. */
  preview: boolean;
}

export function runInput(ctx: Ctx, input: ActionInput, opts: RunOptions): void {
  try {
    resolveInput(ctx, input);
    ctx.completed = !ctx.turnover && !ctx.touchdown;
  } catch (e) {
    if (!(e instanceof ActionStop)) throw e;
  }
  if (opts.preview) return;
  const s = ctx.s;
  if (s.match?.pendingPhase?.type === 'charge' && s.phase === 'play') {
    // Charge! (p.48): a selected player going down ends the Charge (no Turn ends).
    if (ctx.turnover) {
      endCharge(ctx, 'a selected player went down');
      return;
    }
    const act0 = s.turn.activation;
    if (act0 && input.kind === 'playerAction') {
      const p = findPlayer(s, act0.playerId);
      const done = act0.over || !p || p.location !== 'pitch' || p.stance !== 'standing' || (act0.action === 'move' && p && act0.maUsed >= p.ma && act0.rushesUsed >= maxRushes(p)) || (!!p && bloodlustSettled(s, p, act0));
      if (done) endActivation(ctx);
    }
    const ph = s.match.pendingPhase;
    if (ph.type === 'charge' && !s.turn.activation && ph.activated.length >= ph.max) endCharge(ctx, `all ${ph.max} selected players have been activated`);
    return;
  }
  if (ctx.touchdown) {
    if (s.turn.activation) s.turn.activation = null;
    finishDrive(ctx);
    return;
  }
  if (ctx.turnover) {
    endTurn(ctx, 'turnover');
    return;
  }
  // Auto-end activations that cannot continue (a Razzle-Dazzle player may still declare the second Action).
  const act = s.turn.activation;
  if (act && input.kind === 'playerAction') {
    const p = findPlayer(s, act.playerId);
    const razzleOpen = !!act.razzle && !act.razzle.second;
    const done =
      act.over ||
      !p ||
      p.location !== 'pitch' ||
      p.stance !== 'standing' ||
      (!razzleOpen && act.action === 'block' && act.blocksDone > 0) ||
      (!razzleOpen && act.action === 'secure' && act.ballActionDone) ||
      (!razzleOpen && act.action === 'move' && p && act.maUsed >= p.ma && act.rushesUsed >= maxRushes(p)) ||
      // Bloodlust (p.125): a hungry player who can no longer reach a Thrall — the Turnover is resolved now.
      bloodlustSettled(s, p, act);
    if (done) {
      try {
        endActivation(ctx);
      } catch (e) {
        if (!(e instanceof ActionStop)) throw e;
      }
      if (ctx.touchdown) finishDrive(ctx);
      else if (ctx.turnover) endTurn(ctx, 'turnover');
    }
  }
}

function resolveInput(ctx: Ctx, input: ActionInput): void {
  const s = ctx.s;
  if (isMatchInput(input)) {
    resolveMatchInput(ctx, input);
    return;
  }
  // A Sports-Wizard's spell (p.149): between two Turns, also after the last Turn of a Drive.
  if (input.kind === 'wizard') {
    castWizard(ctx, input);
    return;
  }
  if (s.phase !== 'play') throw new IllegalAction('The game is not in play (touchdown, end of half or setup).');
  switch (input.kind) {
    case 'endActivation':
      endActivation(ctx);
      return;
    case 'forgo': {
      const p = getPlayer(s, input.playerId);
      if (p.team !== s.turn.active || p.activated) throw new IllegalAction('This player cannot forego an activation now.');
      forgo(ctx, p);
      return;
    }
    case 'endTurn':
      if (s.match?.pendingPhase?.type === 'charge') {
        if (s.turn.activation) endActivation(ctx);
        endCharge(ctx, 'the kicking coach ends the Charge');
        return;
      }
      endTurn(ctx, 'voluntary');
      return;
    case 'playerAction':
      resolvePlayerAction(ctx, input);
      return;
  }
}

function resolvePlayerAction(ctx: Ctx, input: PlayerActionInput): void {
  const s = ctx.s;
  const p = getPlayer(s, input.playerId);
  let act = s.turn.activation;
  // Block targets may become unavailable while resolving activation traits.
  // A Blitz retains its declared target; a normal Block may select another legal opponent.
  const initialTarget = input.blockTarget ? findPlayer(s, input.blockTarget) : undefined;
  const targetWasStanding = !!initialTarget && initialTarget.team !== p.team && initialTarget.location === 'pitch' && initialTarget.stance === 'standing';
  let activationChangedTarget = false;
  if (act && act.playerId !== p.id) {
    endActivation(ctx);
    if (ctx.turnover || ctx.touchdown) throw new ActionStop('turnover');
    act = null;
  }
  const why = activationBlockReason(s, p);
  if (why) throw new IllegalAction(why);
  // Sevens Desperate Measures used with this input (Spike! 22 p.15).
  const dm = input.desperate;
  if (dm) {
    const reason = desperateInputReason(s, p, input);
    if (reason) throw new IllegalAction(reason);
  }
  // Razzle-Dazzle: the second Action of the activation.
  if (act && act.action !== input.action && act.razzle && !act.razzle.second) {
    const r2 = razzleSecondReason(s, p, act, input.action);
    if (r2) throw new IllegalAction(r2);
    beginRazzleSecond(ctx, p, act, input);
  }
  if (act && act.action !== input.action) throw new IllegalAction(`This player already declared a ${act.action} Action.`);
  if (!act) {
    const declWhy = declarationReason(s, p, input);
    if (declWhy) throw new IllegalAction(declWhy);
    if (input.action === 'blitz') {
      if (!input.blitzTarget) throw new IllegalAction('A Blitz must declare its target (p.64).');
      const t = findPlayer(s, input.blitzTarget);
      if (!t || t.team === p.team || t.location !== 'pitch' || t.stance !== 'standing') throw new IllegalAction('The Blitz target must be a Standing opposition player.');
    }
    if (input.starRule) {
      const sr = startRuleReason(s, p, input.action, input.special);
      if (sr) throw new IllegalAction(sr);
      if (input.starTarget && !startRuleTargets(s, p).some((q) => q.id === input.starTarget)) throw new IllegalAction('The chosen player cannot be the target of this Star Player rule now.');
    } else if (input.starTarget) throw new IllegalAction('A Star Player rule target needs starRule.');
    act = startActivation(ctx, p, input.action, input.blitzTarget, input.special ?? (input.vomitTarget ? 'projectileVomit' : undefined));
    if (dm === 'razzleDazzle') {
      act.razzle = { first: input.action };
      spendDesperate(ctx, p.team, 'razzleDazzle', `${label(p)} may declare a second, different Action this activation (not two that both contain a Move).`);
    }
    if (dm === 'grudgeMatch') {
      act.grudge = true;
      spendDesperate(ctx, p.team, 'grudgeMatch', `${label(p)} may Foul even though the team already declared a Foul this Turn, and cannot be Sent-off for it.`);
    }
    if (!activationTraits(ctx, p, act)) throw new ActionStop('activation roll failed');
    activationChangedTarget = targetWasStanding && !!initialTarget && (initialTarget.stance !== 'standing' || initialTarget.location !== 'pitch');
    // Star Player rules used at the start of the activation (starActions.ts); the Action variants are resolved below.
    if (input.starRule && !['maple', 'nobbla', 'bilerot', 'cindy'].includes(p.star ?? '')) useStartRule(ctx, p, act, { target: input.starTarget });
    // Take Root (p.137): rooted by the activation roll, the player cannot move — the planned path is not walked
    // and the activation continues without it (e.g. a Blitz can still Block an adjacent target).
    if (p.rooted && input.path.length) {
      ctx.emit('status', `${label(p)} is Rooted and cannot move: the planned move is not made (the activation continues).`, { page: 137, title: 'Take Root' }, { playerId: p.id });
      throw new ActionStop('rooted');
    }
  } else if (input.starRule) {
    throw new IllegalAction('A Star Player rule used at the start of an activation must be chosen when the Action is declared.');
  }
  const a = act;
  if (dm === 'setPiece' && !a.setPiece) {
    a.setPiece = true;
    spendDesperate(ctx, p.team, 'setPiece', `${label(p)}'s Pass is Accurate on any 2+ and is caught on any 2+.`);
  }

  // Standing up (p.54) or Jump Up Block (p.130)
  if (p.stance === 'prone') {
    if (input.action === 'block') {
      if (!canUse(p, 'jumpUp')) throw new IllegalAction('A Prone player can only Block with Jump Up.');
      const res = rollTest(ctx, {
        kind: 'jumpUp',
        player: p,
        label: `${label(p)} Jump Up to Block`,
        target: p.ag,
        mods: [{ label: 'Jump Up', value: 1 }],
        rule: { page: 130, title: 'Jump Up' },
        teamReroll: true,
        proAllowed: true,
        onFail: 'stays Prone; activation ends',
      });
      if (!res.success) {
        a.over = true;
        ctx.emit('status', `${label(p)} fails to Jump Up and stays Prone; the activation ends.`, { page: 130, title: 'Jump Up' });
        throw new ActionStop('jump up failed');
      }
      p.stance = 'standing';
      ctx.emit('move', `${label(p)} jumps up to Block.`, { page: 130, title: 'Jump Up' });
    } else if (!standUp(ctx, p, a)) {
      throw new ActionStop('failed to stand');
    }
  }
  if (p.stance !== 'standing') throw new IllegalAction('The player must be Standing.');

  const spId: SpecialId | undefined = input.special ?? (a.action === 'special' ? a.special : undefined) ?? (input.vomitTarget ? 'projectileVomit' : undefined);
  if (a.action === 'special' && a.special && input.special && input.special !== a.special) throw new IllegalAction(`This player declared ${SPECIALS[a.special].name}: it cannot become ${SPECIALS[input.special].name}.`);
  if (input.path.length && a.action === 'block') throw new IllegalAction('A Block Action does not include movement.');
  if (input.path.length && a.action === 'special' && !(spId && SPECIALS[spId].move)) throw new IllegalAction(`${spId ? SPECIALS[spId].name : 'This Special Action'} does not include movement.`);
  if (input.path.length && a.ballActionDone && !canUse(p, 'giveAndGo')) throw new IllegalAction('This player cannot move after passing or handing off.');
  if (input.path.length && a.foulDone && !canUse(p, 'quickFoul')) throw new IllegalAction('The Foul has been made: the player cannot move any further (p.69).');
  if (input.path.length && a.specialDone && a.action === 'special') throw new IllegalAction('The Special Action has been made: no more movement.');

  // Fumblerooski (p.128): leave the ball in the square this move starts from.
  if (input.leaveBall) {
    if (gated('fumblerooski') || !canUse(p, 'fumblerooski')) throw new IllegalAction('Only a player with Fumblerooski can leave the ball behind (p.128).');
    if (a.action !== 'move') throw new IllegalAction('Fumblerooski is used during a Move Action (p.128).');
    if (!hasBall(s, p) || !input.path.length) throw new IllegalAction('Fumblerooski: the player must hold the ball and move out of the square (p.128).');
    s.ball = { kind: 'ground', pos: { ...(p.pos as Coord) } };
    ctx.emit('ball', `${label(p)} leaves the ball in ${fmt(p.pos)} (Fumblerooski, no Turnover).`, { page: 128, title: 'Fumblerooski' }, { to: p.pos });
  }

  input.path.forEach((step, i) => {
    const last = i === input.path.length - 1;
    moveStep(ctx, p, a, step, { noPickup: a.action === 'secure' && last });
  });

  switch (a.action) {
    case 'blitz': {
      if (input.blockTarget2) throw new IllegalAction('Multiple Block is used with a Block Action, not a Blitz (p.132).');
      const spTarget = input.specialTarget ?? input.vomitTarget;
      if (spId && spTarget) {
        // A targeted Special Action replaces the Block of the Blitz (PV p.133, Stab p.136, Chainsaw p.126, Breathe Fire p.126, Chomp p.131).
        const info = SPECIALS[spId];
        if (!info.blitz || !OFFERED_SPECIALS.includes(spId) || !hasSkill(p, info.skill)) throw new IllegalAction(`${info.name} cannot replace the Block of a Blitz.`);
        if (input.blockTarget) throw new IllegalAction(`Choose either a Block or ${info.name} for the Blitz, not both.`);
        if (spTarget !== a.blitzTarget) throw new IllegalAction('A Blitz can only target its declared target.');
        if (a.blocksDone > 0) throw new IllegalAction('The Blitz has already made its Block.');
        payMovement(ctx, p, a, 1, null, `${info.name} during the Blitz`);
        a.blocksDone = 1;
        performTargetedSpecial(ctx, p, getPlayer(s, spTarget), a, spId, true);
        // FAQ May 2026 p.136: a Stab made as part of a Blitz ends the activation, but a player with Hit and Run still gets its one free square.
        if (faq2026(s) && spId === 'stab' && !ctx.turnover && !ctx.touchdown && p.location === 'pitch' && p.stance === 'standing') hitAndRun(ctx, p, a);
        break;
      }
      if (input.blockTarget) {
        if (input.blockTarget !== a.blitzTarget) throw new IllegalAction('A Blitz can only Block its declared target.');
        if (a.blocksDone > 0) throw new IllegalAction('The Blitz has already made its Block.');
        const def = getPlayer(s, input.blockTarget);
        if (activationChangedTarget) {
          ctx.emit('note', `${label(def)} is no longer a Standing target after the activation effect: the declared Blitz cannot Block them, but movement may continue.`, R.blitz);
          break;
        }
        const why2 = blockBlockedReason(ctx, p, def);
        if (why2) throw new IllegalAction(why2);
        payMovement(ctx, p, a, 1, null, 'Block during the Blitz');
        performBlock(ctx, p, def, { isBlitz: true, declaredBlock: false }, a);
      }
      break;
    }
    case 'block': {
      if (input.starRule && p.star === 'maple') {
        // Maple Highgrove's Vicious Vines (p.204): a Block against a Standing opponent 2 squares away, no Follow-up.
        const targets = startRuleTargets(s, p);
        const given = input.blockTarget ? targets.find((q) => q.id === input.blockTarget) : undefined;
        if (input.blockTarget && !given) throw new IllegalAction('Vicious Vines: the target must be a Standing opposition player exactly 2 squares away.');
        const def = given ?? chooseStarTarget(ctx, p, 'choose the Standing opposition player 2 squares away to Block (no Follow-up).', targets);
        spendStar(ctx, p, `${label(p)} Blocks ${label(def)} from 2 squares away (no Follow-up).`);
        performBlock(ctx, p, def, { isBlitz: false, declaredBlock: true, reach: true }, a);
        a.over = true;
        break;
      }
      if (!input.blockTarget) throw new IllegalAction('Choose a target for the Block.');
      let def = getPlayer(s, input.blockTarget);
      if (activationChangedTarget && !input.blockTarget2) {
        const targets = pitchPlayers(s, other(p.team)).filter(q => !blockBlockedReason(ctx, p, q));
        if (!targets.length) {
          a.over = true;
          ctx.emit('note', `${label(p)} has no Standing opponent to Block after the activation effect; the activation ends without another Block.`, R.block);
          break;
        }
        def = chooseStarTarget(ctx, p, 'the activation effect removed the planned target. Choose a Standing opponent to Block.', targets);
      }
      if (input.blockTarget2) {
        if (gated('multipleBlock') || !canUse(p, 'multipleBlock')) throw new IllegalAction('Only a player with Multiple Block can Block two players (p.132).');
        performMultipleBlock(ctx, p, def, getPlayer(s, input.blockTarget2), a);
        a.over = true;
        break;
      }
      performBlock(ctx, p, def, { isBlitz: false, declaredBlock: true }, a);
      // Scyla Anfingrimm's Fury of the Blood God (p.208): a second Block Action after the first is resolved.
      if (a.starFlags?.includes('twoBlocks') && p.location === 'pitch' && p.stance === 'standing' && !ctx.turnover) {
        const next = pitchPlayers(s, other(p.team)).filter((q) => q.stance === 'standing' && !!q.pos && !!p.pos && adjacent(q.pos, p.pos));
        if (next.length) {
          const d2 = chooseStarTarget(ctx, p, 'the second Block Action: choose its target.', next);
          a.blocksDone = 0;
          a.starFlags = a.starFlags.filter((f) => f !== 'twoBlocks');
          performBlock(ctx, p, d2, { isBlitz: false, declaredBlock: true }, a);
        }
      }
      bilerotAfterBlock(ctx, p, a, (q) => performTargetedSpecial(ctx, p, q, a, 'projectileVomit', false));
      // Sevens Razzle-Dazzle: the second Action may still follow the Block.
      a.over = !(a.razzle && !a.razzle.second);
      break;
    }
    case 'foul': {
      if (!input.foulTarget) break;
      if (a.foulDone) throw new IllegalAction('This player has already made their Foul (p.69).');
      if (input.useChainsaw && gated('chainsaw')) throw new IllegalAction('The chainsaw cannot be used for a Foul in this version.');
      performFoul(ctx, p, getPlayer(s, input.foulTarget), a, { chainsaw: !!input.useChainsaw });
      break;
    }
    case 'pass':
      if (input.passTarget) performPass(ctx, p, input.passTarget, !!input.hailMary, a);
      break;
    case 'handoff':
      if (input.handoffTarget) performHandoff(ctx, p, getPlayer(s, input.handoffTarget), a);
      break;
    case 'secure':
      secureTheBall(ctx, p, a);
      break;
    case 'ttm':
      if (input.throwTarget && input.thrownPlayerId) performThrowTeamMate(ctx, p, input.thrownPlayerId, input.throwTarget, a);
      else if (input.throwTarget || input.thrownPlayerId) throw new IllegalAction('Choose both the team-mate to throw and the target square.');
      break;
    case 'special': {
      if (!spId) throw new IllegalAction('Choose which Special Action to perform.');
      const info = SPECIALS[spId];
      const bilerot = spId === 'projectileVomit' && p.star === 'bilerot';
      if (!hasSkill(p, info.skill) && !bilerot) throw new IllegalAction(`This player cannot perform ${info.name}.`);
      // Bilerot's rule from the tray (no target yet): the target is asked.
      const target = input.specialTarget ?? input.vomitTarget ?? (bilerot && input.starRule ? chooseStarTarget(ctx, p, 'choose the Standing opponent next to Bilerot to vomit on.', startRuleTargets(s, p)).id : undefined);
      if (input.starRule && p.star === 'nobbla' && spId === 'chainsaw') {
        // Nobbla Blackwart's Kick 'em While They're Down! (p.205): a Chainsaw Attack on a Prone or Stunned opponent.
        const targets = startRuleTargets(s, p);
        const given = target ? targets.find((q) => q.id === target) : undefined;
        if (target && !given) throw new IllegalAction("Kick 'em While They're Down!: the target must be a Prone or Stunned opposition player next to Nobbla.");
        const q = given ?? chooseStarTarget(ctx, p, 'choose the Prone or Stunned opposition player for the Chainsaw Attack.', targets);
        spendStar(ctx, p, `${label(p)} uses the Chainsaw Attack on the fallen ${label(q)} (not a Foul).`);
        performTargetedSpecial(ctx, p, q, a, 'chainsaw', false, true);
        break;
      }
      if (bilerot && info.targeted && target) {
        if (!starReady(s, p, 'bilerot')) throw new IllegalAction('Putrid Regurgitation has been used this half.');
        spendStar(ctx, p, 'Projectile Vomit (once per half).');
      }
      if (info.targeted) {
        if (target) performTargetedSpecial(ctx, p, getPlayer(s, target), a, spId, false);
        else if (!info.move) throw new IllegalAction(`Choose the player to use ${info.name} on.`);
      } else if (spId === 'bombardier') {
        if (!input.bombTarget) throw new IllegalAction('Choose the target square for the bomb.');
        const cindy = !!input.starRule && p.star === 'cindy';
        if (cindy) spendStar(ctx, p, `${label(p)} will throw two bombs this activation (then D6 1-3: Sent-off).`);
        performThrowBomb(ctx, p, input.bombTarget, !!input.hailMary, a);
        if (cindy) cindySecondBomb(ctx, p, a);
      } else if (spId === 'punt') {
        if (input.facing) performPunt(ctx, p, input.facing, a);
      } else if (spId === 'kickTeamMate') {
        if (input.throwTarget && input.thrownPlayerId) performThrowTeamMate(ctx, p, input.thrownPlayerId, input.throwTarget, a, true);
        else if (input.throwTarget || input.thrownPlayerId) throw new IllegalAction('Choose both the team-mate to kick and the target square.');
      } else if (spId === 'ballAndChain') {
        if (input.path.length) throw new IllegalAction('A Ball & Chain player moves only with the Throw-in Template (p.124).');
        if (!input.facing) throw new IllegalAction('Choose which way the Throw-in Template faces.');
        ballAndChainStep(ctx, p, input.facing, a);
      }
      break;
    }
    default:
      break;
  }
  if (hasBall(s, p)) checkTouchdown(ctx, true);
}

const chooseStarTarget = chooseStarPlayer;

/**
 * Cindy Piewhistle's All You Can Eat (p.197): the second Throw Bomb of the activation, then D6 1-3 she is Sent-off
 * (Argue the Call and a Bribe as for any Sent-off; a Turnover unless Bribed).
 */
function cindySecondBomb(ctx: Ctx, p: Player, a: NonNullable<GameState['turn']['activation']>): void {
  const s = ctx.s;
  if (ctx.turnover || p.location !== 'pitch' || p.stance !== 'standing' || !p.pos) {
    ctx.emit('note', 'All You Can Eat: Cindy cannot throw the second bomb.', { page: 197, title: 'Cindy Piewhistle: All You Can Eat' });
    return;
  }
  const targets = bombTargets(s, p).filter((c) => passRangeOk(s, p, c));
  if (targets.length) {
    const id = ctx.ask({ type: 'starRule', team: p.team, prompt: 'All You Can Eat (Cindy Piewhistle): choose the target square of the second bomb.', options: targets.map((c) => ({ id: `${c.x},${c.y}`, label: fmt(c), square: c })), rule: { page: 197, title: 'Cindy Piewhistle: All You Can Eat' }, context: { star: 'cindy', pick: true } });
    const [x, y] = id.split(',').map(Number);
    performThrowBomb(ctx, p, { x, y }, false, a);
  }
  if (p.location !== 'pitch') return;
  const r = ctx.roll({ dice: [6], interpret: ([n]) => n, cacheKey: 'cindy', by: p.team, prefer: (n) => n >= 4 });
  ctx.emit('roll', `All You Can Eat: D6 ${r.value} — ${r.value <= 3 ? 'Cindy is Sent-off' : 'she stays in the game'}.`, { page: 197, title: 'Cindy Piewhistle: All You Can Eat' });
  if (r.value <= 3) {
    const res = sendOff(ctx, p, 'All You Can Eat');
    if (res !== 'bribed' && p.team === s.turn.active) {
      a.over = true;
      ctx.setTurnover(`${label(p)} was Sent-off (All You Can Eat)`, { page: 197, title: 'Cindy Piewhistle: All You Can Eat' });
      throw new ActionStop('sent off');
    }
  }
}

function passRangeOk(s: GameState, p: Player, c: Coord): boolean {
  return !!p.pos && passInfo({ s } as unknown as Ctx, p, p.pos, c, false) !== null && typeof passInfo({ s } as unknown as Ctx, p, p.pos, c, false) !== 'string';
}

/** Secure the Ball (p.59): D6 2+ instead of an Agility Test; the activation ends. */
function secureTheBall(ctx: Ctx, p: Player, a: NonNullable<GameState['turn']['activation']>): void {
  const s = ctx.s;
  if (s.ball.kind !== 'ground' || !eq(s.ball.pos, p.pos)) {
    ctx.setTurnover('the Secure the Ball move did not finish on the ball', R.secure);
    a.over = true;
    throw new ActionStop('secure failed');
  }
  const mods: Mod[] = [];
  if (s.weather === 'pouringRain') mods.push({ label: 'Pouring Rain', value: -1 });
  const res = rollTest(ctx, {
    kind: 'secure',
    player: p,
    label: `${label(p)} secures the ball in ${fmt(p.pos)}`,
    target: 2,
    mods,
    rule: R.secure,
    teamReroll: true,
    proAllowed: true,
    onFail: 'the ball bounces — Turnover',
    autoFail: hasSkill(p, 'noBall') ? 'No Ball' : undefined,
  });
  a.ballActionDone = true;
  a.over = !res.success || !(a.razzle && !a.razzle.second);
  if (res.success) {
    s.ball = { kind: 'held', playerId: p.id };
    ctx.emit('ball', `${label(p)} secures the ball; the activation ends.`, R.secure, { holder: p.id });
    checkTouchdown(ctx, true);
    return;
  }
  ctx.setTurnover(`${label(p)} failed to secure the ball`, R.secure);
  bounce(ctx, p.pos as Coord);
  throw new ActionStop('secure failed');
}

export function markedBy(s: GameState, p: Player): Player[] {
  return p.pos ? markersOf(s, p.pos, p.team) : [];
}

/** The availability entry matching an input (Special Actions are told apart by `special`). */
// ---------------------------------------------------------------------------
// Blood Bowl Sevens Desperate Measures chosen with an input (Spike! 22 p.15)
// ---------------------------------------------------------------------------

/** Why this input cannot use its Desperate Measure (null: it can). */
export function desperateInputReason(s: GameState, p: Player, input: PlayerActionInput): string | null {
  const id = input.desperate;
  if (!id) return null;
  const name = DESPERATE[DESPERATE_NUMBER[id]].name;
  if (!s.match || s.variant !== 'sevens') return `${name}: Desperate Measures are a Blood Bowl Sevens Inducement (Spike! 22 p.15).`;
  if (!desperateLeft(s, p.team, id)) return `${name}: the team has not rolled this Desperate Measure, or has used it (once per game).`;
  const act = s.turn.activation;
  const continuing = !!act && act.playerId === p.id && !act.over;
  if (id === 'razzleDazzle') {
    if (continuing) return 'Razzle-Dazzle is used when the player is activated.';
    if (input.action === 'special') return 'Razzle-Dazzle: Special Actions are not combined with a second Action in this version.';
  }
  if (id === 'grudgeMatch') {
    if (input.action !== 'foul') return 'Grudge Match is used with a Foul Action.';
    if (continuing) return 'Grudge Match is used when the player is activated.';
  }
  if (id === 'setPiece') {
    if (input.action !== 'pass' || !input.passTarget) return 'Set Piece is used with a Pass Action, when the ball is thrown.';
    if (input.hailMary) return 'Set Piece: not with a Hail Mary Pass (it can never be Accurate).';
    if (continuing && act?.ballActionDone) return 'The Pass has been made.';
  }
  return null;
}

/** Why `p` cannot take `action` as the second Action of a Razzle-Dazzle activation (null: it can). */
export function razzleSecondReason(s: GameState, p: Player, act: NonNullable<GameState['turn']['activation']>, action: ActionType): string | null {
  if (!act.razzle) return 'No Razzle-Dazzle on this activation.';
  if (act.razzle.second) return 'The second Action has been declared.';
  const pair = razzlePairReason(act.razzle.first, action);
  if (pair) return pair;
  if (p.stance !== 'standing') return 'The player must be Standing.';
  const used = s.turn.used;
  if (action === 'blitz' && used.blitz) return 'The Blitz Action has already been declared this Turn.';
  if (action === 'pass') return used.pass ? 'The Pass Action has already been declared this Turn.' : passBlockedReasonState(s, p);
  if (action === 'handoff' && used.handoff) return 'The Hand-off Action has already been declared this Turn.';
  if (action === 'secure') return used.secure ? 'The Secure the Ball Action has already been declared this Turn.' : secureReason(s, p);
  if (action === 'foul') return foulTakenReason(s, p) ?? foulReason(s, p);
  if (action === 'block' && !pitchPlayers(s, other(p.team)).some((q) => q.stance === 'standing' && q.pos && p.pos && adjacent(q.pos, p.pos))) return 'No adjacent Standing opposition player to Block.';
  return null;
}

/** Razzle-Dazzle: the player declares the second Action of the activation. */
function beginRazzleSecond(ctx: Ctx, p: Player, act: NonNullable<GameState['turn']['activation']>, input: PlayerActionInput): void {
  const s = ctx.s;
  const action = input.action;
  if (action === 'blitz') {
    const t = input.blitzTarget ? findPlayer(s, input.blitzTarget) : undefined;
    if (!t || t.team === p.team || t.location !== 'pitch' || t.stance !== 'standing') throw new IllegalAction('A Blitz must declare a Standing opposition player as its target (p.64).');
    act.blitzTarget = t.id;
    s.turn.used.blitz = true;
  }
  if (action === 'pass') s.turn.used.pass = true;
  if (action === 'handoff') s.turn.used.handoff = true;
  if (action === 'secure') s.turn.used.secure = true;
  if (action === 'foul') {
    s.turn.used.foul = true;
    s.turn.used.foulBy = [...(s.turn.used.foulBy ?? []), p.id];
  }
  (act.razzle as { first: ActionType; second?: ActionType }).second = action;
  act.action = action;
  // The second Action starts afresh: its own Block (a Blitz's) and ball actions.
  act.blocksDone = 0;
  const names: Record<ActionType, string> = { move: 'Move', blitz: 'Blitz', block: 'Block', pass: 'Pass', handoff: 'Hand-off', secure: 'Secure the Ball', foul: 'Foul', ttm: 'Throw Team-mate', special: 'Special' };
  ctx.emit('declare', `${label(p)} declares a second Action (Razzle-Dazzle): ${names[action]}.`, DESPERATE_RULE, { playerId: p.id, action, razzle: true });
}

/**
 * Why `p` cannot declare this input's Action now (null: it can). The Action must be offered and enabled — or, with the
 * Sevens Desperate Measure Grudge Match, a Foul refused only because the team already declared one this Turn.
 */
export function declarationReason(s: GameState, p: Player, input: PlayerActionInput): string | null {
  const opt = findOption(actionOptions(s, p), input);
  if (opt?.enabled) return null;
  const grudge = input.desperate === 'grudgeMatch' && input.action === 'foul' && !!opt && !activationBlockReason(s, p) && foulTakenReason(s, p) !== null && !foulReason(s, p);
  return grudge ? null : opt?.reason ?? 'This Action cannot be declared.';
}

export function findOption(opts: ActionAvailability[], input: PlayerActionInput): ActionAvailability | undefined {
  return opts.find((o) => o.action === input.action && (input.action !== 'special' || o.special === input.special));
}
