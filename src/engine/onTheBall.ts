/**
 * On the Ball (p.132): when an opposition player performs a Pass Action,
 * after the target square has been declared and before the Passing Ability
 * Test, players with this Skill may each move up to 3 squares (normal Move
 * rules, no Rush), one at a time; if one Falls Over, their move ends, the
 * Pass resumes and no further On the Ball moves are made. At the kick-off,
 * after the kick Deviates and before the Kick-off Event, one Open receiving
 * player with the Skill may move up to 3 squares, not into the opposition half
 * (not after a Touchback). In Blood Bowl Sevens that includes the team's side of
 * No Man's Land (GW Designer's Commentary: "Yes"; V5.5) — unless the match uses the optional NAF recommendation.
 *
 * The coach picks a player and a destination; the engine moves them along
 * the route with the fewest Dodges (then the fewest squares). Jumps and
 * Leaps are not offered here.
 */
import { fmt, inBounds, neighbours } from './board';
import { ActionStop, Ctx } from './context';
import { maxRushes, moveStep } from './move';
import { gated } from './skills';
import { canUse, heldInPlace, hasTackleZone, isOpen, label, markersOf, pitchPlayers, playerAt } from './state';
import type { Activation, Coord, PathStep, Player, TeamId } from './types';
import { isSevens } from './variant';

export const OTB_RULE = { page: 132, title: 'On the Ball' };

/** Destinations within `limit` steps through empty squares, with the route that needs the fewest Dodges. */
export function shortMoves(ctx: Ctx | { s: Ctx['s'] }, p: Player, limit: number, allowed: (c: Coord) => boolean): Array<{ to: Coord; path: PathStep[]; dodges: number }> {
  const s = ctx.s;
  const start = p.pos as Coord;
  type Node = { c: Coord; path: PathStep[]; dodges: number };
  const best = new Map<string, Node>();
  let frontier: Node[] = [{ c: start, path: [], dodges: 0 }];
  best.set(`${start.x},${start.y}`, frontier[0]);
  for (let step = 0; step < limit; step++) {
    const next: Node[] = [];
    for (const n of frontier) {
      const leaving = markersOf(s, n.c, p.team).length > 0;
      for (const c of neighbours(n.c)) {
        if (!inBounds(c) || playerAt(s, c)) continue;
        const k = `${c.x},${c.y}`;
        const node = { c, path: [...n.path, { to: c, kind: 'step' as const }], dodges: n.dodges + (leaving ? 1 : 0) };
        const old = best.get(k);
        if (old && (old.dodges < node.dodges || (old.dodges === node.dodges && old.path.length <= node.path.length))) continue;
        best.set(k, node);
        next.push(node);
      }
    }
    frontier = next;
  }
  const out: Array<{ to: Coord; path: PathStep[]; dodges: number }> = [];
  for (const n of best.values()) if (n.path.length && allowed(n.c)) out.push({ to: n.c, path: n.path, dodges: n.dodges });
  out.sort((a, b) => a.dodges - b.dodges || a.path.length - b.path.length || a.to.x - b.to.x || a.to.y - b.to.y);
  return out;
}

/** Move a player along a short path outside their own activation. Returns false if they fell or were held. */
function freeMove(ctx: Ctx, p: Player, path: PathStep[]): boolean {
  const limit = path.length;
  const tmp: Activation = { playerId: p.id, action: 'move', maUsed: Math.max(0, p.ma - limit), rushesUsed: maxRushes(p), blocksDone: 0, ballActionDone: false, proUsed: true, stallingCandidate: false, over: false };
  try {
    for (const st of path) moveStep(ctx, p, tmp, st, { noPickup: true });
  } catch (e) {
    if (e instanceof ActionStop) return false;
    throw e;
  }
  return true;
}

/** On the Ball during an opposition Pass Action (after the target is declared). */
export function onTheBallPass(ctx: Ctx, passer: Player): void {
  const s = ctx.s;
  if (gated('onTheBall')) return;
  const team: TeamId = passer.team === 'A' ? 'B' : 'A';
  const moved = new Set<string>();
  for (let guard = 0; guard < 16; guard++) {
    const cands = pitchPlayers(s, team).filter((q) => !moved.has(q.id) && canUse(q, 'onTheBall') && !heldInPlace(s, q) && Math.min(3, q.ma) > 0);
    if (!cands.length) return;
    const pick = ctx.ask({
      type: 'onTheBall',
      team,
      prompt: `${label(passer)} is about to pass. Move a player with On the Ball (up to 3 squares, no Rush) before the Passing Ability Test?`,
      options: [{ id: 'none', label: 'No (more) On the Ball moves' }, ...cands.map((q) => ({ id: q.id, label: `Move ${label(q)}`, square: q.pos as Coord }))],
      rule: OTB_RULE,
    });
    if (pick === 'none') return;
    const q = cands.find((c) => c.id === pick) as Player;
    moved.add(q.id);
    if (!moveOnTheBall(ctx, q, () => true)) return;
  }
}

/** The move itself: choose a destination and walk there. Returns false if the player fell or was held. */
function moveOnTheBall(ctx: Ctx, q: Player, allowed: (c: Coord) => boolean): boolean {
  const moves = shortMoves(ctx, q, Math.min(3, q.ma), allowed);
  if (!moves.length) return true;
  const dest = ctx.ask({
    type: 'onTheBall',
    team: q.team,
    prompt: `On the Ball: where does ${label(q)} move (route with the fewest Dodges)?`,
    options: [{ id: 'stay', label: 'Stay put' }, ...moves.map((m) => ({ id: `${m.to.x},${m.to.y}`, label: `${fmt(m.to)}${m.dodges ? ` (${m.dodges} Dodge${m.dodges > 1 ? 's' : ''})` : ''}`, square: m.to }))],
    rule: OTB_RULE,
    context: { mover: q.id },
  });
  if (dest === 'stay') return true;
  const m = moves.find((x) => `${x.to.x},${x.to.y}` === dest) as (typeof moves)[number];
  ctx.emit('move', `${label(q)} uses On the Ball.`, OTB_RULE, { playerId: q.id });
  const ok = freeMove(ctx, q, m.path);
  if (!ok) ctx.emit('note', `${label(q)}'s On the Ball move ends.`, OTB_RULE);
  return ok;
}

/** On the Ball at the kick-off: one Open receiving player, not into the opposition half. */
export function onTheBallKickoff(ctx: Ctx, receiving: TeamId, ownHalf: (c: Coord) => boolean): void {
  const s = ctx.s;
  if (gated('onTheBall')) return;
  const cands = pitchPlayers(s, receiving).filter((q) => canUse(q, 'onTheBall') && hasTackleZone(q) && isOpen(s, q) && !heldInPlace(s, q));
  if (!cands.length) return;
  const pick = ctx.ask({
    type: 'onTheBall',
    team: receiving,
    prompt: isSevens(s)
      ? "On the Ball: move one Open player up to 3 squares — No Man's Land included, not past the halfway line — before the Kick-off Event?"
      : 'On the Ball: move one Open player up to 3 squares in your half before the Kick-off Event?',
    options: [{ id: 'none', label: 'No On the Ball move' }, ...cands.map((q) => ({ id: q.id, label: `Move ${label(q)}`, square: q.pos as Coord }))],
    rule: OTB_RULE,
  });
  if (pick === 'none') return;
  moveOnTheBall(ctx, cands.find((c) => c.id === pick) as Player, ownHalf);
}
