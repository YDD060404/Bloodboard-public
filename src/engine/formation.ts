/**
 * V6 built-in starters and formation. Chooses WHICH players take the pitch (not just the lowest numbers) and puts the
 * sturdiest on the Line of Scrimmage and the most capable behind it. It is a plain, explainable rule set — no matchup
 * model — and always returns a formation the engine accepts (the legacy default formation is the fallback).
 */
import { positionValue } from './teambuild';
import { defaultFormation, formationSlots, matchInputReason, setupCandidates } from './match';
import type { Coord, GameState, Player, TeamId } from './types';

const prof = (p: Player) => positionValue({ ma: p.ma, st: p.st, ag: p.ag, pa: p.pa, av: p.av, skills: p.skills, keywords: p.keywords });
const sk = (p: Player, id: string) => p.skills.some((k) => k.id === id);
/** How well a player holds the Line of Scrimmage: strength and armour, Block / Guard / Stand Firm. */
const lineScore = (p: Player) => p.st * 3 + p.av + (sk(p, 'block') ? 1.5 : 0) + (sk(p, 'guard') ? 2 : 0) + (sk(p, 'standFirm') ? 1.5 : 0) + (sk(p, 'mightyBlow') ? 1 : 0) - (sk(p, 'loner') ? 0.5 : 0);

export interface FormationChoice {
  positions: Record<string, Coord | null>;
  fielded: string[];
  why: string;
  /** The engine rejected the built formation and the legacy default formation was used. */
  fellBack: boolean;
}

export function builtinFormation(s: GameState, team: TeamId): FormationChoice {
  const base = defaultFormation(s, team);
  const baseIds = Object.keys(base).filter((id) => base[id]);
  const legacy = (why: string): FormationChoice => ({ positions: base, fielded: baseIds, why, fellBack: true });
  const slots = formationSlots(s, team);
  const cands = setupCandidates(s, team);
  const count = Math.min(slots.length, cands.length);
  if (count === 0) return legacy('No players available.');
  const cap = !!s.teams[team].specialRules?.includes('Team Captain');
  const must = cands.filter((p) => (cap && p.captain) || !!p.star).slice(0, count);
  const rest = cands.filter((p) => !must.includes(p)).sort((a, b) => prof(b) - prof(a) || a.number - b.number);
  const fielded = [...must, ...rest.slice(0, count - must.length)];
  // Line of Scrimmage: the sturdiest `lineN` (the rule is 3, or everyone when fewer than 3 are fielded).
  const lineN = Math.min(3, fielded.length);
  const byLine = fielded.slice().sort((a, b) => lineScore(b) - lineScore(a) || a.number - b.number);
  const line = byLine.slice(0, lineN);
  const back = fielded.filter((p) => !line.includes(p)).sort((a, b) => prof(b) - prof(a) || a.number - b.number);
  const positions: Record<string, Coord | null> = {};
  for (const p of cands) positions[p.id] = null;
  // Slots 0-2 are the Line of Scrimmage (centre first); the others fill from the front to the back.
  line.forEach((p, i) => (positions[p.id] = { ...slots[i] }));
  back.forEach((p, i) => (positions[p.id] = { ...slots[lineN + i] }));
  const bad = matchInputReason(s, { kind: 'setupTeam', team, positions });
  if (bad) return legacy(`Built formation rejected (${bad}); legacy default used.`);
  return { positions, fielded: fielded.map((p) => p.id), why: `Fielded the ${count} highest-value players${must.length ? ` (${must.length} required: Captain / Star)` : ''}; the sturdiest hold the Line of Scrimmage.`, fellBack: false };
}
