/**
 * Foul Actions (printed p.69) and being Sent-off (Argue the Call p.69,
 * Bribes p.144), with the fouling skills: Dirty Player (p.127), Sneaky Git
 * (p.136), Lone Fouler (p.130), Put the Boot In (p.134), Quick Foul (p.134),
 * Pile Driver (p.133) and the chainsaw used for a Foul (Chainsaw, p.126).
 */
import { DESPERATE_RULE } from './desperate';
import { rulesFor } from './variant';
import { adjacent, fmt } from './board';
import { bounce } from './ball';
import { ActionStop, Ctx, IllegalAction } from './context';
import { checkLeaderLoss, goDown, injuryRoll, moveOffPitch, type ModSource } from './injury';
import { rollTest } from './roll';
import { R } from './rules';
import { canUse, faq2026, hasBall, hasSkill, hasTackleZone, label, markersOf, pitchPlayers } from './state';
import type { Activation, Coord, GameState, Player, TeamId } from './types';

export const FOUL_RULE = { page: 69, title: 'Foul Actions' };
import { INDUCE_RULE, induced } from './inducements';
import { hasPrayer, PRAYER_RULE } from './prayers';
import { sneakyPair } from './stars';
export const ARGUE_RULE = { page: 69, title: 'Argue the Call' };
export const BRIBERY_CORRUPTION_RULE = { page: 154, title: 'Bribery and Corruption' };
export const BRIBE_RULE = { page: 144, title: 'Bribes' };

/** Prone or Stunned opposition players next to `from` (Foul targets, p.69). */
export function foulTargets(s: GameState, p: Player, from: Coord | null = p.pos): Player[] {
  if (!from) return [];
  return pitchPlayers(s).filter((q) => q.team !== p.team && q.stance !== 'standing' && !!q.pos && adjacent(q.pos, from));
}

/**
 * Why `helper` gives no assist to a Foul (null = it assists). Assists work as
 * for a Block (p.61, p.69): the helper Marks the player fouled (offensive) or
 * the fouler (defensive) and is not Marked by any other opposition player.
 * Guard only concerns Block Actions (p.129); Put the Boot In (p.134) lets a
 * team-mate of the fouler assist however many opponents Mark them, unless one
 * of those has Defensive (p.127: during its opponent's Turn).
 */
export function foulAssistReason(s: GameState, helper: Player, against: Player, offensive: boolean): string | null {
  if (!hasTackleZone(helper) || helper.eyeGouged) return 'no Tackle Zone';
  if (!helper.pos || !against.pos || !adjacent(helper.pos, against.pos)) return 'not adjacent';
  if (!offensive && against.stance !== 'standing') return 'not Marking';
  const markers = markersOf(s, helper.pos, helper.team).filter((m) => m.id !== against.id);
  if (!markers.length) return null;
  if (offensive && canUse(helper, 'putTheBootIn')) {
    const cancelled = markers.some((m) => canUse(m, 'defensive') && m.team !== s.turn.active);
    return cancelled ? 'Put the Boot In cancelled by Defensive' : null;
  }
  return 'Marked by another opposition player';
}

export function foulAssists(s: GameState, fouler: Player, target: Player): { off: Player[]; def: Player[] } {
  const off = pitchPlayers(s, fouler.team).filter((q) => q.id !== fouler.id && !foulAssistReason(s, q, target, true));
  const def = pitchPlayers(s, target.team).filter((q) => q.id !== target.id && !foulAssistReason(s, q, fouler, false));
  return { off, def };
}

function coachEjected(s: GameState, team: TeamId): boolean {
  return s.match ? !!s.match.coachEjected[team] : !!s.teams[team].coachEjected;
}

function ejectCoach(s: GameState, team: TeamId): void {
  if (s.match) s.match.coachEjected[team] = true;
  else s.teams[team].coachEjected = true;
}

/**
 * A player is Sent-off (p.69): Argue the Call, then a Bribe if the team has
 * one (p.144). Returns the outcome; the caller applies Turnovers:
 *  - 'sentOff'  : removed from the game;
 *  - 'argued'   : Argue the Call succeeded — not Sent-off, but a Foul still causes a Turnover;
 *  - 'bribed'   : a Bribe worked — not Sent-off and no Turnover.
 */
export function sendOff(ctx: Ctx, p: Player, why: string): 'sentOff' | 'argued' | 'bribed' {
  const s = ctx.s;
  let result: 'sentOff' | 'argued' | 'bribed' = 'sentOff';
  // Blood Bowl Sevens: the Amateur Referees table (Spike! 22 p.13) — 5-6 keeps the player, and no coach is ever ejected.
  const amateur = rulesFor(s).argueTable === 'amateur';
  const rule = amateur ? rulesFor(s).refs.argue : ARGUE_RULE;
  if (!coachEjected(s, p.team)) {
    const argue = ctx.ask({
      type: 'argueTheCall',
      team: p.team,
      prompt: `${label(p)} is Sent-off (${why}). Argue the Call?`,
      options: [
        { id: 'yes', label: amateur ? 'Argue the Call (D6: 5-6 keeps the player — Amateur Referees)' : 'Argue the Call (D6: 6 keeps the player, 1 ejects the coach)' },
        { id: 'no', label: 'Accept it' },
      ],
      rule,
    });
    if (argue === 'yes') {
      // Dodgy League Rep, "I didn't see a thing" (p.146): +1 to Argue the Call; a natural 1 still ejects the coach.
      const rep = induced(s, p.team, 'biasedReferee') ? 1 : 0;
      // Friends with the Ref (Prayer to Nuffle 2, p.143): a 5 or 6 keeps the player.
      const friends = hasPrayer(s, p.team, 2) ? 5 : 6;
      const rollArgue = () =>
        amateur
          ? ctx.roll({ dice: [6], interpret: ([n]) => (n + rep >= 5 ? 'ok' : 'no'), cacheKey: `argue7|${rep}`, by: p.team, judge: (v) => (v === 'ok' ? 1 : -1) })
          : ctx.roll({ dice: [6], interpret: ([n]) => (n === 1 ? 'out' : n + rep >= friends ? 'ok' : 'no'), cacheKey: `argue|${rep}|${friends}`, by: p.team, judge: (v) => (v === 'ok' ? 1 : v === 'out' ? -1 : -0.6) });
      let r = rollArgue();
      // Bribery and Corruption (p.154): once per game, a 1 rolled to Argue the Call may be re-rolled.
      const t = s.teams[p.team];
      if (r.faces[0] === 1 && t.specialRules?.includes('Bribery and Corruption') && !t.briberyUsed) {
        const again = ctx.ask({
          type: 'briberyCorruption',
          team: p.team,
          prompt: `Argue the Call: rolled a 1. Bribery and Corruption (once per game): re-roll the D6?`,
          options: [
            { id: 'yes', label: 'Re-roll the D6 (Bribery and Corruption)' },
            { id: 'no', label: 'Keep the 1' },
          ],
          rule: BRIBERY_CORRUPTION_RULE,
        });
        if (again === 'yes') {
          t.briberyUsed = true;
          ctx.emit('reroll', `Argue the Call: 1 — Bribery and Corruption: ${t.name} re-roll the D6 (once per game).`, BRIBERY_CORRUPTION_RULE);
          r = rollArgue();
        }
      }
      const n = r.faces[0];
      if (rep) ctx.emit('note', `Dodgy League Rep: +1 to Argue the Call ("I didn't see a thing").`, INDUCE_RULE('biasedReferee'));
      if (r.value === 'out') {
        ejectCoach(s, p.team);
        ctx.emit('roll', `Argue the Call: ${n} — "You're outta here!" The coach is ejected and ${label(p)} is still Sent-off.`, rule);
      } else if (r.value === 'ok') {
        result = 'argued';
        ctx.emit('roll', `Argue the Call: ${n} — ${amateur ? '"Well, when you put it like that…"' : 'the referee is swayed;'} ${label(p)} is not Sent-off.`, rule);
      } else ctx.emit('roll', `Argue the Call: ${n} — ${amateur ? '"I don\'t care!"' : 'the referee does not care;'} ${label(p)} is still Sent-off.`, rule);
    }
  }
  const m = s.match;
  if (result === 'sentOff' && m && m.bribes[p.team] > 0) {
    const use = ctx.ask({
      type: 'bribe',
      team: p.team,
      prompt: `Use a Bribe for ${label(p)}? (${m.bribes[p.team]} left)`,
      options: [
        { id: 'yes', label: 'Use a Bribe (2+: not Sent-off, no Turnover)' },
        { id: 'no', label: 'Keep the Bribe' },
      ],
      rule: BRIBE_RULE,
    });
    if (use === 'yes') {
      m.bribes[p.team] -= 1;
      const r = ctx.roll({ dice: [6], interpret: ([n]) => (n >= 2 ? 'ok' : 'no'), cacheKey: 'bribe', by: p.team, judge: (v) => (v === 'ok' ? 1 : -1) });
      if (r.value === 'ok') result = 'bribed';
      ctx.emit('roll', `Bribe: ${r.faces[0]} — ${result === 'bribed' ? `${label(p)} is not Sent-off` : 'the referee pockets it and sends the player off anyway'}.`, BRIBE_RULE);
    }
  }
  if (result === 'sentOff') {
    const from = p.pos ? { ...p.pos } : null;
    const hadBall = hasBall(s, p);
    moveOffPitch(p, 'sentOff');
    ctx.emit('status', `${label(p)} is Sent-off and takes no further part in the game.`, FOUL_RULE, { playerId: p.id, sentOff: true });
    checkLeaderLoss(ctx, p.team);
    if (hadBall && from) {
      s.ball = { kind: 'ground', pos: from };
      ctx.emit('ball', `The ball bounces from ${fmt(from)}.`, R.scatter);
      bounce(ctx, from);
    }
  }
  return result;
}

export interface FoulOpts {
  /** Use the chainsaw (+3 to the Armour Roll, Kick-back on a 1 first). */
  chainsaw?: boolean;
  /** Pile Driver's free Foul (not the team's Foul Action of the Turn). */
  free?: boolean;
}

/** Resolve a Foul by `p` against the Prone or Stunned `target` (p.69). */
export function performFoul(ctx: Ctx, p: Player, target: Player, act: Activation, opts: FoulOpts = {}): void {
  const s = ctx.s;
  if (target.team === p.team || target.location !== 'pitch' || target.stance === 'standing' || !target.pos || !p.pos || !adjacent(p.pos, target.pos)) {
    throw new IllegalAction('A Foul needs a Prone or Stunned opposition player adjacent to the fouler (p.69).');
  }
  if (p.stance !== 'standing') throw new IllegalAction('The fouler must be Standing.');
  if (opts.chainsaw && !hasSkill(p, 'chainsaw')) throw new IllegalAction('Only a player with Chainsaw can use a chainsaw for the Foul.');
  const rule = FOUL_RULE;
  act.foulDone = true;
  ctx.emit('declare', `${label(p)} ${opts.free ? 'makes a free Foul (Pile Driver) on' : 'fouls'} ${label(target)} in ${fmt(target.pos)}${opts.chainsaw ? ' with the chainsaw' : ''}.`, rule, { playerId: p.id, target: target.id, foul: true });

  // Chainsaw Kick-back (p.126): roll before the Armour Roll.
  if (opts.chainsaw) {
    const kb = rollTest(ctx, { kind: 'chainsaw', player: p, label: `${label(p)} Chainsaw (Kick-back on a 1)`, target: 2, mods: [], rule: { page: 126, title: 'Chainsaw' }, teamReroll: true, proAllowed: true, onFail: 'Kick-back: the player is Knocked Down' });
    if (!kb.success) {
      ctx.emit('status', 'Kick-back! The chainsaw bucks and the fouler is Knocked Down.', { page: 126, title: 'Chainsaw' });
      act.over = true;
      goDown(ctx, p, { kind: 'knockedDown', reason: 'chainsaw Kick-back' });
      throw new ActionStop('kick-back');
    }
  }

  const ihs = hasSkill(target, 'ironHardSkin');
  const { off: offAvail, def } = foulAssists(s, p, target);
  // FAQ May 2026 p.136: Offensive Assists are "may apply": the fouler's coach declares how many count BEFORE the dice (so before the
  // result is known). Defensive Assists always apply. Iron Hard Skin ignores all modifiers, so there is nothing to choose then.
  let off = offAvail;
  if (faq2026(s) && offAvail.length && !ihs) {
    const pick = ctx.ask({
      type: 'foulAssist',
      team: p.team,
      prompt: `Foul on ${label(target)}: ${offAvail.length} Offensive Assist${offAvail.length === 1 ? '' : 's'} available (+1 each). Choose how many to apply before the Armour Roll${def.length ? ` (the ${def.length} Defensive Assist${def.length === 1 ? '' : 's'} always apply)` : ''}.`,
      options: Array.from({ length: offAvail.length + 1 }, (_, i) => offAvail.length - i).map((k) => ({ id: String(k), label: k === offAvail.length ? `Apply all ${k} (+${k})` : k === 0 ? 'Apply none' : `Apply ${k} (+${k})` })),
      rule: FOUL_RULE,
      context: { kind: 'foulAssist', fouler: p.id, target: target.id, offensive: offAvail.map((q) => q.id), defensive: def.length },
    });
    off = offAvail.slice(0, Math.max(0, Math.min(offAvail.length, Number(pick) || 0)));
  }
  const assistMod = off.length - def.length;
  const chainsawMod = opts.chainsaw ? 3 : 0;
  // Dribl & Drull's A Sneaky Pair (p.198): +1 when the player fouled is Marked by both.
  const pairMod = sneakyPair(s, p, target) ? 1 : 0;
  // Iron Hard Skin (p.129): the Armour Roll against this player cannot be modified.
  const fixed = ihs ? 0 : assistMod + chainsawMod + pairMod;
  const dirty = canUse(p, 'dirtyPlayer');
  const dpSource: ModSource | null = dirty ? { who: p, skill: 'dirtyPlayer', used: false } : null;
  const lone = canUse(p, 'loneFouler') && off.length === 0 && def.length === 0;
  const sneaky = canUse(p, 'sneakyGit');
  const modTxt = ihs ? ' (Iron Hard Skin: no modifiers)' : `${off.length || def.length ? ` ${assistMod >= 0 ? '+' : ''}${assistMod} assists (${off.length} offensive, ${def.length} defensive)` : ''}${chainsawMod ? ' +3 chainsaw' : ''}${pairMod ? ' +1 A Sneaky Pair (Dribl & Drull)' : ''}`;

  const armourRoll = () =>
    ctx.roll({
      dice: [6, 6],
      by: p.team,
      interpret: ([a, b]) => ({ sum: a + b, dbl: a === b }),
      key: (v) => `${v.sum}|${v.dbl ? 1 : 0}`,
      // Difficulty house rule: broken armour is good for the fouler's side, a double (Sent-off) bad.
      judge: (v) => Math.max(-1, (v.sum + fixed >= target.av ? 1 : -1) - (v.dbl && !canUse(p, 'sneakyGit') ? 0.8 : 0)),
      prefer: () => true,
      cacheKey: 'foularmour',
    });
  let ar = armourRoll();
  let sum = ar.value.sum + fixed;
  let broken = sum >= target.av;
  ctx.emit('roll', `Foul Armour Roll for ${label(target)}: ${ar.faces[0]}+${ar.faces[1]}=${ar.value.sum}${modTxt} → ${sum} vs AV ${target.av}+ — ${broken ? 'armour broken' : 'armour holds'}${ar.value.dbl ? ' (a natural double!)' : ''}.`, rule, { playerId: target.id, faces: ar.faces, av: target.av, broken, armour: true, foul: true });
  // Lone Fouler (p.130): re-roll a failed Armour Roll when nobody gives an assist.
  if (!broken && lone) {
    const c = ctx.ask({
      type: 'reroll',
      team: p.team,
      prompt: `Armour Roll ${sum} vs AV ${target.av}+ failed. Use Lone Fouler to re-roll it (no assists on this Foul)?`,
      options: [
        { id: 'skill', label: 'Re-roll the Armour Roll (Lone Fouler)' },
        { id: 'none', label: 'Keep the result' },
      ],
      rule: { page: 130, title: 'Lone Fouler' },
      context: { kind: 'loneFouler' },
    });
    if (c === 'skill') {
      ar = armourRoll();
      sum = ar.value.sum + fixed;
      broken = sum >= target.av;
      ctx.emit('roll', `Lone Fouler re-roll: ${ar.faces[0]}+${ar.faces[1]}=${ar.value.sum}${modTxt} → ${sum} — ${broken ? 'armour broken' : 'armour holds'}${ar.value.dbl ? ' (a natural double!)' : ''}.`, { page: 130, title: 'Lone Fouler' }, { playerId: target.id, faces: ar.faces, av: target.av, broken, armour: true, foul: true });
    }
  }
  // Dirty Player (p.127): +1 to the Armour Roll (if it breaks the armour) or keep it for the Injury Roll.
  if (!broken && dpSource && !ihs && sum + 1 >= target.av) {
    const c = ctx.ask({
      type: 'dirtyPlayer',
      team: p.team,
      prompt: `Armour Roll ${sum} vs AV ${target.av}+. Apply Dirty Player (+1) to break the armour, or keep it for the Injury Roll?`,
      options: [
        { id: 'armour', label: 'Apply Dirty Player to the Armour Roll' },
        { id: 'save', label: 'Keep it for the Injury Roll' },
      ],
      rule: { page: 127, title: 'Dirty Player' },
      context: { stage: 'armour', breaks: true },
    });
    if (c === 'armour') {
      dpSource.used = true;
      broken = true;
      ctx.emit('roll', `Dirty Player +1 applied to the Armour Roll → ${sum + 1} — armour broken.`, { page: 127, title: 'Dirty Player' }, { playerId: target.id, armour: true, broken: true, foul: true });
    }
  }
  let doubled = ar.value.dbl;
  // Sneaky Git (p.136): no Sent-off for a double on the Armour Roll if the armour is not broken.
  if (doubled && sneaky && !broken) {
    doubled = false;
    ctx.emit('note', `Sneaky Git: the double on the Armour Roll goes unnoticed (armour not broken).`, { page: 136, title: 'Sneaky Git' });
  }
  if (broken) {
    const out: { faces?: number[] } = {};
    const hadBall = hasBall(s, target);
    injuryRoll(ctx, target, dpSource && !dpSource.used ? [dpSource] : [], false, { out, rerollBy: p });
    if (out.faces && out.faces[0] === out.faces[1]) {
      doubled = true;
      ctx.emit('note', 'A natural double on the Injury Roll: the referee saw the Foul.', rule);
    }
    void hadBall;
  }
  // Under Scrutiny (the fouled team's Prayer to Nuffle 15, p.143): breaking armour is enough to be Sent-off.
  if (!doubled && broken && hasPrayer(s, p.team === 'A' ? 'B' : 'A', 15)) {
    doubled = true;
    ctx.emit('note', 'Under Scrutiny (Prayer to Nuffle): the fouler broke armour and is Sent-off.', PRAYER_RULE);
  }
  act.over = (!canUse(p, 'quickFoul') || !!opts.free) && !(act.razzle && !act.razzle.second);
  // Sevens Desperate Measure Grudge Match (Spike! 22 p.15): the player cannot be Sent-off when committing this Foul.
  if (doubled && act.grudge) {
    doubled = false;
    ctx.emit('note', `Grudge Match (Desperate Measure): ${label(p)} cannot be Sent-off for this Foul.`, DESPERATE_RULE);
  }
  if (doubled) {
    ctx.emit('note', `The referee spots the Foul (natural double): ${label(p)} is Sent-off.`, rule);
    const res = sendOff(ctx, p, 'Foul');
    if (res !== 'bribed' && p.team === s.turn.active) {
      act.over = true;
      ctx.setTurnover(res === 'argued' ? `${label(p)} was caught fouling (Argue the Call kept them on the pitch, but the Turnover stands)` : `${label(p)} was Sent-off for fouling`, FOUL_RULE);
      throw new ActionStop('sent off');
    }
  }
  // Biased Referee — Dodgy League Rep, Close Scrutiny (p.146): after an opposition Foul that did not end in a Sent-off, D6 5+ sends the fouler off.
  const opp: TeamId = p.team === 'A' ? 'B' : 'A';
  if (p.location === 'pitch' && induced(s, opp, 'biasedReferee') && !act.grudge) {
    const r = ctx.roll({ dice: [6], interpret: ([n]) => (n >= 5 ? 'out' : 'ok'), cacheKey: 'scrutiny', by: opp, judge: (v) => (v === 'out' ? 1 : -1) });
    ctx.emit('roll', `Close Scrutiny (${s.teams[opp].name}'s Dodgy League Rep): ${r.faces[0]} — ${r.value === 'out' ? `${label(p)} is Sent-off` : 'nothing happens'}.`, INDUCE_RULE('biasedReferee'));
    if (r.value === 'out') {
      const res = sendOff(ctx, p, 'Close Scrutiny');
      if (res !== 'bribed' && p.team === s.turn.active) {
        act.over = true;
        ctx.setTurnover(res === 'argued' ? `${label(p)} was caught by Close Scrutiny (Argue the Call kept them on the pitch, but the Turnover stands)` : `${label(p)} was Sent-off (Close Scrutiny)`, INDUCE_RULE('biasedReferee'));
        throw new ActionStop('sent off');
      }
    }
  }
  if (!act.over && canUse(p, 'quickFoul')) ctx.emit('note', 'Quick Foul: the player may continue moving.', { page: 134, title: 'Quick Foul' });
}
