/**
 * Game variants: standard Blood Bowl (the Third Season rulebook) and Blood Bowl
 * Sevens (Spike! Journal: Sevens, Issue 22, Games Workshop 2026 — see
 * docs/SEVENS_RULES.md for the sourced checklist).
 *
 * Every rule that differs between the two lives in the RULESETS table below
 * (numbers, tables and source pages), so the rest of the engine asks
 * `rulesFor(s)` instead of testing the variant in scattered places. A state
 * without `variant` is a standard game (older saves stay standard).
 *
 * Pitch geometry is the one piece of the variant the board helpers need
 * without a state in hand (`inBounds`, Wide Zones, End Zones…). The engine
 * therefore keeps a "current pitch": `cloneState` — which starts every engine
 * operation — and the interface's render entry points set it from the state
 * they are about to use (`usePitch`). Only one variant is ever in use at a time.
 */
import { useD6Edition } from './dice';
import type { GameState, RuleRef, TeamId, Variant } from './types';

export interface PitchGeometry {
  /** Squares along the length (x) and across (y). End Zones are x = 0 and x = w − 1. */
  w: number;
  h: number;
  /** Squares in each Wide Zone (rows 0..wide−1 and h−wide..h−1). */
  wide: number;
  /** Line of Scrimmage column of each team's own area: A sets up at x ≤ losA, B at x ≥ losB. */
  losA: number;
  losB: number;
}

export interface Ruleset {
  variant: Variant;
  label: string;
  pitch: PitchGeometry;
  /** Players set up for a Drive (p.47 / Sevens p.10). */
  playersPerDrive: number;
  /** Players of a team allowed in each Wide Zone at set-up. */
  maxPerWideZone: number;
  /** Turns per half (p.44 / Sevens p.7). */
  turnsPerHalf: number;
  /** Time-out (p.48 / Sevens p.11): the Turn markers move back when the kicking team's marker is on this turn or later. */
  timeOutBackFrom: number;
  /** Kick-off deviation distance: one D6 (p.47) or the lower of two D6 (Sevens p.10). */
  kickDistance: 'd6' | 'lowerOf2d6';
  /** Kick-off Event 4: Solid Defence (D3+3, set up again) or Alert Defence (D3+1, one square each; Sevens p.11). */
  event4: 'solidDefence' | 'alertDefence';
  /** Quick Snap and Charge!: D3 + this many players. */
  kickoffPlayersBonus: number;
  /** Pitch Invasion: D3 players, or one (Sevens p.11). */
  pitchInvasion: 'd3' | 'one';
  /** Throw-in distance: 2D6 (p.73) or D6+2 (Sevens p.13). */
  throwInDistance: '2d6' | 'd6plus2';
  /** Injury tables: rulebook Injury + Casualty tables, or the Sevens tables without a Casualty Roll (p.12). */
  injuryTables: 'standard' | 'sevens';
  /** Argue the Call table: rulebook (p.69) or Amateur Referees (Sevens p.13). */
  argueTable: 'standard' | 'amateur';
  /** Star Player Points are earned (League play; Sevens has none, p.16). */
  spp: boolean;
  /** Source of the variant's own rules, for rule references. */
  source?: RuleRef['source'];
  /** Rule references used in messages. */
  refs: Record<'pitch' | 'setup' | 'kickoff' | 'events' | 'injury' | 'argue' | 'throwIn' | 'veteran' | 'draft' | 'staff', RuleRef>;
}

const std = (page: number, title: string): RuleRef => ({ page, title });
const sev = (page: number, title: string): RuleRef => ({ page, title, source: 'sevens' });

export const RULESETS: Record<Variant, Ruleset> = {
  standard: {
    variant: 'standard',
    label: 'Standard (11-a-side)',
    pitch: { w: 26, h: 15, wide: 4, losA: 12, losB: 13 },
    playersPerDrive: 11,
    maxPerWideZone: 2,
    turnsPerHalf: 8,
    timeOutBackFrom: 6,
    kickDistance: 'd6',
    event4: 'solidDefence',
    kickoffPlayersBonus: 3,
    pitchInvasion: 'd3',
    throwInDistance: '2d6',
    injuryTables: 'standard',
    argueTable: 'standard',
    spp: true,
    refs: {
      pitch: std(23, 'The Blood Bowl Pitch'),
      setup: std(47, 'Set-up'),
      kickoff: std(47, 'The Kick-off'),
      events: std(48, 'Kick-off Event Table'),
      injury: std(66, 'Injury Roll'),
      argue: std(69, 'Argue the Call'),
      throwIn: std(73, 'Throw-ins'),
      veteran: std(0, '—'),
      draft: std(89, 'Team Draft'),
      staff: std(90, 'Sideline Staff'),
    },
  },
  sevens: {
    variant: 'sevens',
    label: 'Blood Bowl Sevens',
    // Spike! 22 p.7: Wide Zones 2 squares, Centre Field 7; the printed pitch is 20 × 11 squares —
    // End Zone + 6 squares to each Line of Scrimmage, 6 squares of No Man's Land between them.
    pitch: { w: 20, h: 11, wide: 2, losA: 6, losB: 13 },
    playersPerDrive: 7,
    maxPerWideZone: 1,
    turnsPerHalf: 6,
    timeOutBackFrom: 5,
    kickDistance: 'lowerOf2d6',
    event4: 'alertDefence',
    kickoffPlayersBonus: 1,
    pitchInvasion: 'one',
    throwInDistance: 'd6plus2',
    injuryTables: 'sevens',
    argueTable: 'amateur',
    spp: false,
    source: 'sevens',
    refs: {
      pitch: sev(7, 'The Blood Bowl Sevens Pitch'),
      setup: sev(10, 'Sevens Set-up'),
      kickoff: sev(10, 'Sevens Kick-off'),
      events: sev(11, 'Sevens Kick-off Event Table'),
      injury: sev(12, 'Sevens Injury Tables'),
      argue: sev(13, 'Amateur Referees'),
      throwIn: sev(13, 'Sevens Throw-ins'),
      veteran: sev(13, 'Veterans'),
      draft: sev(8, 'Drafting a Blood Bowl Sevens Team'),
      staff: sev(9, 'Hiring Sideline Staff'),
    },
  },
};

export function rulesFor(s: Pick<GameState, 'variant'> | null | undefined): Ruleset {
  return RULESETS[s?.variant === 'sevens' ? 'sevens' : 'standard'];
}

export function isSevens(s: Pick<GameState, 'variant'> | null | undefined): boolean {
  return s?.variant === 'sevens';
}

// ---------------------------------------------------------------------------
// The current pitch (see the file comment)
// ---------------------------------------------------------------------------

let current: PitchGeometry = RULESETS.standard.pitch;
let currentVariant: Variant = 'standard';

/** Make the board helpers use this variant's pitch. Cheap; called by cloneState and the interface. */
export function usePitch(v: Variant | Pick<GameState, 'variant'> | null | undefined): void {
  if (v && typeof v === 'object') useD6Edition(v as { rulesEdition?: string });
  const variant: Variant = typeof v === 'string' ? v : v?.variant === 'sevens' ? 'sevens' : 'standard';
  if (variant === currentVariant) return;
  currentVariant = variant;
  current = RULESETS[variant].pitch;
}

export function pitch(): PitchGeometry {
  return current;
}

export function pitchVariant(): Variant {
  return currentVariant;
}

/** Team's own area (set-up zone; the rulebook's "own half"): between its End Zone and its Line of Scrimmage. */
export function inTeamArea(team: TeamId, x: number): boolean {
  return team === 'A' ? x <= current.losA : x >= current.losB;
}

/**
 * V5.5: the team's half of the pitch, divided at the halfway line. On a standard pitch this is the same as the team's
 * area; in Sevens it also contains the team's side of No Man's Land (Sevens p.7). On the Ball at the kick-off (p.132:
 * "may not move into the opposition half") uses it — GW's Designer's Commentary answers "Yes" to moving into the area
 * between both Lines of Scrimmage in Blood Bowl Sevens (May 2025, p.94, Death Zone section; Spike! 22 has no ruling of
 * its own). The optional NAF recommendation for BB2025 Sevens says no: match option `sevensOnTheBall: 'ownArea'`.
 */
export function inPitchHalf(team: TeamId, x: number): boolean {
  const half = current.w / 2;
  return team === 'A' ? x < half : x >= half;
}

/** No Man's Land (Sevens p.7): between the two Lines of Scrimmage. Empty on a standard pitch. */
export function inNoMansLand(x: number): boolean {
  return x > current.losA && x < current.losB;
}
