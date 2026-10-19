/**
 * Wizard: Sports-Wizard (Inducement, rulebook p.149; 0-1, 150,000 gp, any team — Exhibition / Matched Play teams
 * buy it from the Team Draft Budget). V5 step 6.
 *
 * Once per game, "at the end of any Turn, before the next Turn begins", the coach may cast ONE of two spells:
 *  - Fireball: any square on the pitch; a D6 for every player in it or next to it (both teams): 4+ hit. A Standing
 *    player hit is Knocked Down with +1 to the Armour Roll; a Prone or Stunned player hit has an Armour Roll with +1.
 *  - Zap!: any player on the pitch; a D6: a natural 6, or a roll ≥ the player's ST (never a natural 1), turns them
 *    into a Frog (MA 5, ST 1, AG 2+, PA -, AV 5+; Dodge, Leap, No Ball, Stunty, Titchy, Very Long Legs). A ball
 *    carrier's ball Bounces. A Frog's Casualty is always Badly Hurt (no Casualty Roll, no Apothecary); at the end of
 *    the Drive the player is back to normal (Reserves Box).
 *
 * Interpretations (docs/RULES_COVERAGE.md): the moment between two Turns is kept open from the end of a Turn until
 * the next Turn's first activation (either coach may cast; the computer casts at the start of its own Turn), and
 * after the last Turn of a Drive (Touchdown, end of the half) until the next Drive — then the ball is dead and is not
 * bounced. Nothing a spell causes is a Turnover. Only Blood Bowl (11-a-side) teams can buy it: the Sevens
 * Inducement list (Spike! 22 p.14) has no Wizard.
 */
import { dist, fmt, inBounds } from './board';
import { bounce } from './ball';
import { Ctx, IllegalAction } from './context';
import { armourAndInjury, goDown } from './injury';
import { induceLeft, spendInduce } from './inducements';
import { findPlayer, hasBall, label, pitchPlayers } from './state';
import type { Coord, GameState, Player, SkillRef, TeamId } from './types';

export const WIZARD_RULE = { page: 149, title: 'Wizard: Sports-Wizard' };
export const FIREBALL_RULE = { page: 149, title: 'Wizard: Fireball' };
export const ZAP_RULE = { page: 149, title: 'Wizard: Zap!' };

/** The Frog profile (p.149). */
export const FROG = {
  ma: 5,
  st: 1,
  ag: 2,
  pa: null as number | null,
  av: 5,
  skills: ['dodge', 'leap', 'noBall', 'stunty', 'titchy', 'veryLongLegs'],
  keywords: ['Frog', 'Special'],
};

export type WizardInput = { kind: 'wizard'; team: TeamId; spell: 'fireball' | 'zap' | 'none'; square?: Coord; target?: string };

/** Is the gap between two Turns open now (p.149)? */
export function wizardWindowOpen(s: GameState): boolean {
  if (s.pending || !s.match || !s.turn.betweenTurns) return false;
  if (s.phase === 'touchdown' || s.phase === 'halfOver') return true;
  if (s.phase !== 'play' || s.match.pendingPhase) return false;
  return !s.turn.activation && !s.players.some((p) => p.team === s.turn.active && p.activated);
}

/** Why `team` cannot cast its Sports-Wizard now (with this spell / target), or null. */
export function wizardReason(s: GameState, team: TeamId, input?: Omit<WizardInput, 'kind' | 'team'>): string | null {
  if (induceLeft(s, team, 'wizard') < 1) return s.match?.inducements?.[team]?.wizard ? 'The Sports-Wizard casts once per game (p.149).' : `${s.teams[team].name} have no Sports-Wizard.`;
  if (!wizardWindowOpen(s)) return 'A Sports-Wizard casts at the end of a Turn, before the next Turn begins (p.149): after a Turn ends and before the next Turn\'s first activation.';
  if (!input) return null;
  if (input.spell === 'none') return s.turn.wizardDeclined?.includes(team) ? 'Already decided for this gap between Turns.' : null;
  if (input.spell === 'fireball') {
    if (!input.square || !inBounds(input.square)) return 'Fireball: choose a square on the pitch (p.149).';
    return null;
  }
  if (input.spell === 'zap') {
    const q = input.target ? findPlayer(s, input.target) : undefined;
    if (!q || q.location !== 'pitch' || !q.pos) return 'Zap!: choose a player on the pitch (p.149).';
    return null;
  }
  return 'Choose Fireball or Zap!.';
}

/** Players in or next to `sq` (the Fireball's targets). */
export function fireballTargets(s: GameState, sq: Coord): Player[] {
  return pitchPlayers(s)
    .filter((p) => !!p.pos && dist(p.pos, sq) <= 1)
    .sort((a, b) => (a.team === b.team ? a.number - b.number : a.team < b.team ? -1 : 1));
}

/** P(Zap! turns this player into a Frog): a natural 6, or a roll ≥ ST that is not a natural 1. */
export function zapChance(p: Player, w?: number[] | null): number {
  let q = 0;
  for (let n = 1; n <= 6; n++) if (n === 6 || (n !== 1 && n >= p.st)) q += w ? w[n - 1] : 1 / 6;
  return q;
}

/** Cast the Sports-Wizard's spell (or record the computer's decision to keep it). */
export function castWizard(ctx: Ctx, input: WizardInput): void {
  const s = ctx.s;
  const why = wizardReason(s, input.team, input);
  if (why) throw new IllegalAction(why);
  const team = input.team;
  if (input.spell === 'none') {
    s.turn.wizardDeclined = [...(s.turn.wizardDeclined ?? []), team];
    ctx.emit('note', `${s.teams[team].name} keep their Sports-Wizard for later.`, WIZARD_RULE, { team });
    return;
  }
  spendInduce(s, team, 'wizard');
  const dead = s.phase !== 'play';
  if (input.spell === 'fireball') {
    const sq = input.square as Coord;
    const targets = fireballTargets(s, sq);
    ctx.emit('declare', `${s.teams[team].name} — Sports-Wizard casts a Fireball at ${fmt(sq)} (${targets.length ? targets.map((p) => label(p)).join(', ') : 'nobody there'}).`, FIREBALL_RULE, { team, square: sq, spell: 'fireball' });
    const hits: Player[] = [];
    for (const p of targets) {
      const r = ctx.roll({ dice: [6], interpret: ([n]) => (n >= 4 ? 'hit' : 'miss'), cacheKey: 'fireball4', by: team, judge: (v) => ((v === 'hit') === (p.team !== team) ? 1 : -1), prefer: (v) => (v === 'hit') === (p.team !== s.turn.active) });
      ctx.emit('roll', `Fireball — ${label(p)}: D6 ${r.faces[0]} — ${r.value === 'hit' ? 'hit' : 'avoids it'}.`, FIREBALL_RULE, { playerId: p.id, natural: r.faces[0] });
      if (r.value === 'hit') hits.push(p);
    }
    for (const p of hits) {
      if (p.location !== 'pitch' || !p.pos) continue;
      if (dead && hasBall(s, p)) {
        s.ball = { kind: 'none' };
        ctx.emit('note', 'The Drive is over: the ball stays out of play.', FIREBALL_RULE);
      }
      if (p.stance === 'standing') goDown(ctx, p, { kind: 'knockedDown', reason: 'Fireball', betweenTurns: true, noTurnover: true, armourMod: 1 });
      else armourAndInjury(ctx, p, { kind: 'knockedDown', reason: 'Fireball', betweenTurns: true, noTurnover: true, armourMod: 1 });
    }
    return;
  }
  const q = findPlayer(s, input.target) as Player;
  const r = ctx.roll({ dice: [6], interpret: ([n]) => (n === 6 || (n !== 1 && n >= q.st) ? 'frog' : 'nothing'), cacheKey: `zap|${q.st}`, by: team, judge: (v) => ((v === 'frog') === (q.team !== team) ? 1 : -1), prefer: (v) => (v === 'frog') === (q.team !== s.turn.active) });
  const n = r.faces[0];
  ctx.emit('declare', `${s.teams[team].name} — Sports-Wizard casts Zap! at ${label(q)}.`, ZAP_RULE, { team, target: q.id, spell: 'zap' });
  ctx.emit('roll', `Zap! — ${label(q)}: D6 ${n} vs ST ${q.st} — ${r.value === 'frog' ? 'turned into a Frog until the end of the Drive' : 'nothing happens'}.`, ZAP_RULE, { playerId: q.id, natural: n });
  if (r.value !== 'frog') return;
  const carried = hasBall(s, q);
  turnIntoFrog(q);
  ctx.emit('status', `${label(q)} is a Frog: MA 5, ST 1, AG 2+, PA -, AV 5+ — Dodge, Leap, No Ball, Stunty, Titchy, Very Long Legs.`, ZAP_RULE, { playerId: q.id, frog: true });
  if (carried && q.pos) {
    if (dead) {
      s.ball = { kind: 'none' };
      return;
    }
    s.ball = { kind: 'ground', pos: { ...q.pos } };
    ctx.emit('ball', `The ball Bounces from ${fmt(q.pos)} (the Frog cannot hold it).`, ZAP_RULE);
    bounce(ctx, q.pos);
  }
}

export function turnIntoFrog(p: Player): void {
  if (p.frog) return;
  p.frog = { ma: p.ma, st: p.st, ag: p.ag, pa: p.pa, av: p.av, skills: p.skills.filter((k) => !(k as SkillRef).until).map((k) => ({ ...k })), keywords: p.keywords.slice(), position: p.position };
  p.ma = FROG.ma;
  p.st = FROG.st;
  p.ag = FROG.ag;
  p.pa = FROG.pa;
  p.av = FROG.av;
  p.skills = FROG.skills.map((id) => ({ id }));
  p.keywords = FROG.keywords.slice();
  p.position = 'Frog';
}

/** End of the Drive (p.149): the Frog is the player again, "with no ill effects". */
export function restoreFrog(p: Player): boolean {
  const f = p.frog;
  if (!f) return false;
  p.ma = f.ma;
  p.st = f.st;
  p.ag = f.ag;
  p.pa = f.pa;
  p.av = f.av;
  p.skills = f.skills.map((k) => ({ ...k }));
  p.keywords = f.keywords.slice();
  p.position = f.position;
  p.frog = undefined;
  return true;
}
