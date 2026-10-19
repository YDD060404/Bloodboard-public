import type { Coord, TeamId } from './types';
import { pitch } from './variant';

/** Standard pitch size (p.23). The pitch in use (standard or Sevens) is `pitch()` from variant.ts. */
export const PITCH_W = 26;
export const PITCH_H = 15;

export function inBounds(c: Coord): boolean {
  const g = pitch();
  return c.x >= 0 && c.x < g.w && c.y >= 0 && c.y < g.h;
}

export function eq(a: Coord | null | undefined, b: Coord | null | undefined): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}

export function add(a: Coord, d: Coord): Coord {
  return { x: a.x + d.x, y: a.y + d.y };
}

/** Chebyshev distance (squares on a Blood Bowl grid). */
export function dist(a: Coord, b: Coord): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function adjacent(a: Coord, b: Coord): boolean {
  return dist(a, b) === 1;
}

export const DIRS8: Coord[] = [
  { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: -1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 },
];

export function neighbours(c: Coord): Coord[] {
  return DIRS8.map((d) => add(c, d)).filter(inBounds);
}

export function key(c: Coord): string {
  return `${c.x},${c.y}`;
}

export function fmt(c: Coord | null | undefined): string {
  if (!c) return '—';
  // Columns are shown A..Z (x = 0..25; Sevens A..T), rows 1..15 (y = 0..14; Sevens 1..11).
  return `${String.fromCharCode(65 + c.x)}${c.y + 1}`;
}

/** End zone column a team SCORES in. Team A attacks to the right (x = 25; Sevens x = 19). */
export function scoringEndZoneX(team: TeamId): number {
  return team === 'A' ? pitch().w - 1 : 0;
}

export function inScoringEndZone(team: TeamId, c: Coord): boolean {
  return c.x === scoringEndZoneX(team);
}

export function isWideZone(c: Coord): boolean {
  const g = pitch();
  return c.y < g.wide || c.y >= g.h - g.wide;
}

/**
 * Random Direction Template (p.25): D8 result -> direction.
 *   1 2 3
 *   4 . 5
 *   6 7 8
 * (y grows downwards on screen).
 */
export const D8_DIRS: Record<number, Coord> = {
  1: { x: -1, y: -1 },
  2: { x: 0, y: -1 },
  3: { x: 1, y: -1 },
  4: { x: -1, y: 0 },
  5: { x: 1, y: 0 },
  6: { x: -1, y: 1 },
  7: { x: 0, y: 1 },
  8: { x: 1, y: 1 },
};

/**
 * Push-back squares (p.62): the three squares adjacent to the defender that are
 * not adjacent to the attacker, on the far side of the defender.
 */
export function pushSquares(attacker: Coord, defender: Coord): Coord[] {
  const dx = Math.sign(defender.x - attacker.x);
  const dy = Math.sign(defender.y - attacker.y);
  if (dx !== 0 && dy !== 0) {
    return [
      { x: defender.x + dx, y: defender.y + dy },
      { x: defender.x + dx, y: defender.y },
      { x: defender.x, y: defender.y + dy },
    ];
  }
  if (dx !== 0) {
    return [
      { x: defender.x + dx, y: defender.y },
      { x: defender.x + dx, y: defender.y - 1 },
      { x: defender.x + dx, y: defender.y + 1 },
    ];
  }
  return [
    { x: defender.x, y: defender.y + dy },
    { x: defender.x - 1, y: defender.y + dy },
    { x: defender.x + 1, y: defender.y + dy },
  ];
}

// ---------------------------------------------------------------------------
// Passing Range Chart (p.71), transcribed cell by cell from the printed chart.
// Indexed by (a = max(|dx|,|dy|), b = min(|dx|,|dy|)); the chart is symmetric.
// ---------------------------------------------------------------------------

export type PassRange = 'quick' | 'short' | 'long' | 'bomb';

/** For each b (0..9): [maxQuickA, maxShortA, maxLongA, maxBombA]; -1 = none. */
const RANGE_ROWS: Array<[number, number, number, number]> = [
  /* b=0 */ [3, 6, 10, 13],
  /* b=1 */ [3, 6, 10, 13],
  /* b=2 */ [2, 6, 10, 13],
  /* b=3 */ [-1, 6, 9, 12],
  /* b=4 */ [-1, 5, 9, 12],
  /* b=5 */ [-1, -1, 8, 11],
  /* b=6 */ [-1, -1, 8, 11],
  /* b=7 */ [-1, -1, 7, 10],
  /* b=8 */ [-1, -1, -1, 10],
  /* b=9 */ [-1, -1, -1, 9],
];

export function passRange(from: Coord, to: Coord): PassRange | null {
  const ax = Math.abs(to.x - from.x);
  const ay = Math.abs(to.y - from.y);
  const a = Math.max(ax, ay);
  const b = Math.min(ax, ay);
  if (a === 0) return null;
  if (b >= RANGE_ROWS.length) return null;
  const [q, s, l, bomb] = RANGE_ROWS[b];
  if (q >= 0 && a <= q) return 'quick';
  if (s >= 0 && a <= s) return 'short';
  if (l >= 0 && a <= l) return 'long';
  if (bomb >= 0 && a <= bomb) return 'bomb';
  return null;
}

export const RANGE_LABEL: Record<PassRange, string> = {
  quick: 'Quick Pass',
  short: 'Short Pass',
  long: 'Long Pass',
  bomb: 'Long Bomb',
};

export const RANGE_MOD: Record<PassRange, number> = {
  quick: 0,
  short: -1,
  long: -2,
  bomb: -3,
};

// ---------------------------------------------------------------------------
// Range Ruler model for interceptions (p.71). The ruler is modelled as a strip
// of width `rulerWidth` squares centred on the line from the centre of the
// thrower's square to the centre of the landing square, with a round end cap
// over the thrower. A square is "overlapped" if the strip covers part of it.
// The strip runs from the thrower to the far edge of the landing square.
// ---------------------------------------------------------------------------

export function rulerOverlaps(from: Coord, landing: Coord, sq: Coord, rulerWidth: number): boolean {
  if (eq(sq, from)) return false;
  const h = rulerWidth / 2;
  const vx = landing.x - from.x;
  const vy = landing.y - from.y;
  const len = Math.hypot(vx, vy);
  if (len === 0) return false;
  const ux = vx / len;
  const uy = vy / len;
  const nx = -uy;
  const ny = ux;
  const eps = 1e-9;
  // square centre relative to thrower centre
  const cx = sq.x - from.x;
  const cy = sq.y - from.y;
  // half extent of a unit square projected on an axis (a,b)
  const halfProj = (a: number, b: number) => 0.5 * (Math.abs(a) + Math.abs(b));
  // Separating axis test between the oriented rectangle [0, far] x [-h, h]
  // (in (u, n) coordinates) and the axis-aligned unit square.
  const far = len + halfProj(ux, uy); // reaches the far edge of the landing square
  const cu = cx * ux + cy * uy;
  const cn = cx * nx + cy * ny;
  const eu = halfProj(ux, uy);
  const en = halfProj(nx, ny);
  let rectHit = true;
  // axis u
  if (cu + eu <= 0 + eps || cu - eu >= far - eps) rectHit = false;
  // axis n
  if (rectHit && (cn + en <= -h + eps || cn - en >= h - eps)) rectHit = false;
  // axes x and y (square's own axes): project rectangle corners
  if (rectHit) {
    const corners: Array<[number, number]> = [
      [0, -h], [0, h], [far, -h], [far, h],
    ].map(([u, n]) => [u * ux + n * nx, u * uy + n * ny]);
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    if (Math.max(...xs) <= cx - 0.5 + eps || Math.min(...xs) >= cx + 0.5 - eps) rectHit = false;
    if (rectHit && (Math.max(...ys) <= cy - 0.5 + eps || Math.min(...ys) >= cy + 0.5 - eps)) rectHit = false;
  }
  if (rectHit) return true;
  // round end cap (disc of radius h centred on the thrower)
  const dxs = Math.max(Math.abs(cx) - 0.5, 0);
  const dys = Math.max(Math.abs(cy) - 0.5, 0);
  return Math.hypot(dxs, dys) < h - eps;
}

// ---------------------------------------------------------------------------
// Throw-ins (p.73)
// ---------------------------------------------------------------------------

/**
 * Directions for a Throw-in from `last` (the last square the ball occupied)
 * after it tried to move to the off-pitch square `out`.
 * Returns a function mapping the D6 (or D3 for corners) to a direction, plus
 * whether it is a corner throw-in.
 */
export function throwInDirections(last: Coord, out: Coord): { corner: boolean; dirs: Coord[] } {
  const g = pitch();
  const isCorner = (last.x === 0 || last.x === g.w - 1) && (last.y === 0 || last.y === g.h - 1);
  const ix = last.x === 0 ? 1 : -1;
  const iy = last.y === 0 ? 1 : -1;
  if (isCorner) {
    // D3: 1 = along the sideline, 2 = diagonal into the pitch, 3 = along the end line
    return { corner: true, dirs: [{ x: ix, y: 0 }, { x: ix, y: iy }, { x: 0, y: iy }] };
  }
  // Template facing into the pitch; results 1-2 / 3-4 / 5-6 left, straight, right.
  let inward: Coord;
  if (out.y < 0) inward = { x: 0, y: 1 };
  else if (out.y >= g.h) inward = { x: 0, y: -1 };
  else if (out.x < 0) inward = { x: 1, y: 0 };
  else inward = { x: -1, y: 0 };
  // "left" diagonal for a template facing `inward` (as drawn on p.73 facing up:
  // 1-2 = up-left, 3-4 = up, 5-6 = up-right). Rotate the up-facing template.
  const rot = (v: Coord): Coord => {
    if (inward.y === -1) return v; // facing up
    if (inward.y === 1) return { x: -v.x, y: -v.y }; // facing down
    if (inward.x === -1) return { x: v.y, y: -v.x }; // facing left
    return { x: -v.y, y: v.x }; // facing right
  };
  const up = [{ x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 }];
  return { corner: false, dirs: up.map(rot) };
}

/**
 * The three directions of a Throw-in Template facing an End Zone or a
 * Sideline (Punt p.134, Ball & Chain p.124, Swoop p.137): D6 1-2 left
 * diagonal, 3-4 straight ahead, 5-6 right diagonal — the same template and
 * numbering as a throw-in (p.73), with "left" as seen facing that way.
 */
export function facingDirections(facing: 'x-' | 'x+' | 'y-' | 'y+'): Coord[] {
  const f: Coord = facing === 'x-' ? { x: -1, y: 0 } : facing === 'x+' ? { x: 1, y: 0 } : facing === 'y-' ? { x: 0, y: -1 } : { x: 0, y: 1 };
  // left of facing (dx,dy) is (dy,-dx) in screen coordinates (y grows downwards)
  const left: Coord = { x: f.y, y: -f.x };
  return [
    { x: f.x + left.x, y: f.y + left.y },
    { x: f.x, y: f.y },
    { x: f.x - left.x, y: f.y - left.y },
  ];
}

/** Direction for a D6 on a template facing that way. */
export function facingDirection(facing: 'x-' | 'x+' | 'y-' | 'y+', d6: number): Coord {
  return facingDirections(facing)[Math.ceil(d6 / 2) - 1];
}

export const FACING_LABEL: Record<'x-' | 'x+' | 'y-' | 'y+', string> = {
  'x-': 'towards the left End Zone',
  'x+': 'towards the right End Zone',
  'y-': 'towards the top Sideline',
  'y+': 'towards the bottom Sideline',
};
