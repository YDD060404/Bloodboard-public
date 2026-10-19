/**
 * V4: simple action animations on the board, driven only by what the rules
 * engine actually resolved. Every executed event carries a snapshot of the
 * board (GameEvent.snap); when the dice tray reveals events, consecutive
 * snapshots are compared and the differences are animated in order:
 *
 *  - players sliding square by square along the moves the engine made (steps,
 *    Jumps / Leaps, pushes, follow-ups, Shadowing, Hit and Run, …);
 *  - the ball travelling between the squares where the engine put it
 *    (passes, hand-offs, bounces, throw-ins, catches, pick-ups, kick-offs);
 *  - a short "thud" where a player went down, and a fading ghost where a
 *    player left the pitch (KO, Casualty, crowd, Sent-off).
 *
 * Nothing is recomputed: the path of every animation is the list of board
 * states the engine produced, so an animation can never show something
 * that did not happen. The board is redrawn often (hover), so the current
 * animation is re-applied to each new drawing at the elapsed time. The dice
 * tray still reveals the events step by step; animations only fill in the
 * movement between two revealed states.
 */
import type { App, Playback } from './app';
import type { BoardSnap, GameState } from './engine-global';

export interface AnimPoint {
  t: number;
  x: number;
  y: number;
}

export interface AnimTimeline {
  /** Total duration in ms (0 = nothing to animate). */
  total: number;
  /** Waypoints per player id (board squares), in time order. */
  players: Record<string, AnimPoint[]>;
  /** Waypoints of the ball (board squares). */
  ball: AnimPoint[];
  /** A player went down here at time t. */
  pulses: AnimPoint[];
  /** A player left the pitch from this square (id for the team colour). */
  ghosts: Array<AnimPoint & { id: string }>;
}

const STEP_MS = 170;
const JUMP_MS = 260;
const BALL_MS_PER_SQ = 55;
const BALL_MIN_MS = 220;
const PULSE_MS = 140;
const GHOST_MS = 420;
/** Longest animation for one reveal of the dice tray (longer ones are sped up). */
export const MAX_ANIM_MS = 2200;

type Snap = BoardSnap;

function ballSquare(s: Snap, air?: { x: number; y: number }): { x: number; y: number; holder?: string } | null {
  if (s.ball.kind === 'none' && air) return { x: air.x, y: air.y };
  if (s.ball.kind === 'ground') return { x: s.ball.pos.x, y: s.ball.pos.y };
  if (s.ball.kind === 'held') {
    const holder = s.ball.playerId;
    const row = s.players.find((r) => r[0] === holder);
    if (row && row[1] >= 0) return { x: row[1], y: row[2], holder };
  }
  return null;
}

const cheb = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/**
 * Timeline for going from `snaps[0]` through each following snapshot.
 * `air[i]` is where the ball is coming down while snapshot i has it in the
 * air (the engine's landing square of a pass, kick or punt), if any.
 * Pure: the same snapshots always give the same timeline (tested against the
 * engine in tests/animate.test.ts).
 */
export function buildTimeline(snaps: Snap[], air: Array<{ x: number; y: number } | undefined> = []): AnimTimeline {
  const tl: AnimTimeline = { total: 0, players: {}, ball: [], pulses: [], ghosts: [] };
  if (snaps.length < 2) return tl;
  let t = 0;
  let lastBall = ballSquare(snaps[0]);
  const addPoint = (id: string, p: AnimPoint) => {
    const list = (tl.players[id] ??= []);
    const last = list[list.length - 1];
    if (last && last.t === p.t && last.x === p.x && last.y === p.y) return;
    list.push(p);
  };
  for (let i = 1; i < snaps.length; i++) {
    const a = snaps[i - 1];
    const b = snaps[i];
    const before = new Map(a.players.map((r) => [r[0], r]));
    let slot = 0;
    for (const rb of b.players) {
      const ra = before.get(rb[0]);
      if (!ra) continue;
      const onA = ra[4] === 'pitch' && ra[1] >= 0;
      const onB = rb[4] === 'pitch' && rb[1] >= 0;
      if (onA && onB && (ra[1] !== rb[1] || ra[2] !== rb[2])) {
        const d = cheb({ x: ra[1], y: ra[2] }, { x: rb[1], y: rb[2] });
        const dur = d <= 1 ? STEP_MS : d === 2 ? JUMP_MS : STEP_MS * Math.min(d, 6);
        addPoint(rb[0], { t, x: ra[1], y: ra[2] });
        addPoint(rb[0], { t: t + dur, x: rb[1], y: rb[2] });
        slot = Math.max(slot, dur);
      }
      if (onA && onB && ra[3] === 'standing' && rb[3] !== 'standing') tl.pulses.push({ t: t + slot, x: rb[1], y: rb[2] });
      if (onA && !onB) tl.ghosts.push({ t, x: ra[1], y: ra[2], id: rb[0] });
    }
    if (tl.pulses.some((p) => p.t >= t)) slot = Math.max(slot, PULSE_MS);
    if (tl.ghosts.some((g) => g.t === t)) slot = Math.max(slot, PULSE_MS);
    // The ball: only when it moves on its own (a carried ball moves with its carrier's token).
    const bb = ballSquare(b, air[i]);
    const ba = ballSquare(a, air[i - 1]);
    if (bb && lastBall && (bb.x !== lastBall.x || bb.y !== lastBall.y)) {
      const carried = !!ba?.holder && ba.holder === bb.holder;
      if (!carried) {
        const d = cheb(lastBall, bb);
        const dur = Math.max(BALL_MIN_MS, BALL_MS_PER_SQ * d);
        const start = t + slot;
        if (!tl.ball.length || tl.ball[tl.ball.length - 1].x !== lastBall.x || tl.ball[tl.ball.length - 1].y !== lastBall.y) tl.ball.push({ t: start, x: lastBall.x, y: lastBall.y });
        tl.ball.push({ t: start + dur, x: bb.x, y: bb.y });
        slot += dur;
      }
    }
    if (bb) lastBall = bb;
    t += slot;
  }
  tl.total = t;
  if (t > MAX_ANIM_MS) {
    const k = MAX_ANIM_MS / t;
    const sc = (p: AnimPoint) => (p.t *= k);
    for (const list of Object.values(tl.players)) list.forEach(sc);
    tl.ball.forEach(sc);
    tl.pulses.forEach(sc);
    tl.ghosts.forEach(sc);
    tl.total = MAX_ANIM_MS;
  }
  return tl;
}

/**
 * Where a ball that is in the air comes down: the landing square the engine
 * reported last (pass, kick-off, punt), until the ball is placed or caught.
 */
export function inAir(events: Array<{ type: string; data?: Record<string, unknown> }>): { x: number; y: number } | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const d = events[i].data;
    if (!d || events[i].type !== 'ball') continue;
    if (d.holder || d.to) return undefined;
    const l = d.landing as { x: number; y: number } | null | undefined;
    if (l && typeof l.x === 'number') return { x: l.x, y: l.y };
    if (d.landing === null) return undefined;
  }
  return undefined;
}

/** Board snapshot of a whole state (players and ball). */
export function snapOf(g: GameState): Snap {
  return { players: g.players.map((p) => [p.id, p.pos ? p.pos.x : -1, p.pos ? p.pos.y : -1, p.stance, p.location]), ball: JSON.parse(JSON.stringify(g.ball)) };
}

// ---------------------------------------------------------------------------
// Playing a timeline on the drawn board
// ---------------------------------------------------------------------------

let current: { tl: AnimTimeline; start: number } | null = null;
let lastSeq = -1;
const shownBefore = new WeakMap<Playback, number>();

function reducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function animationsOn(app: App): boolean {
  return app.st.animate && !reducedMotion();
}

/** Milliseconds left of the animation being played (0 if none). */
export function animationRemaining(): number {
  if (!current) return 0;
  return Math.max(0, current.tl.total - (performance.now() - current.start));
}

/** The timeline currently played (for tests and the interface flow checks). */
export function currentTimeline(): AnimTimeline | null {
  return current && animationRemaining() > 0 ? current.tl : null;
}

/** Called for every drawing of the board: starts the animation of a new reveal and (re)applies the current one. */
export function applyAnimations(app: App, svg: SVGSVGElement, geom: { sq: number; margin: number }): void {
  const pb = app.st.playback;
  if (pb && pb.seq !== lastSeq) {
    lastSeq = pb.seq;
    const from = shownBefore.get(pb) ?? pb.animFrom ?? 0;
    shownBefore.set(pb, pb.shown);
    current = null;
    if (animationsOn(app) && pb.shown > from) {
      const first = from > 0 ? pb.events.slice(0, from).reverse().find((e) => e.snap)?.snap : undefined;
      const evs = pb.events.slice(from, pb.shown).filter((e) => e.snap);
      const snaps = [first ?? snapOf(pb.before), ...evs.map((e) => e.snap as Snap)];
      const tl = buildTimeline(snaps, [inAir(pb.events.slice(0, from)), ...evs.map((e, i) => inAir([...pb.events.slice(0, from), ...evs.slice(0, i + 1)]))]);
      if (tl.total > 0) current = { tl, start: performance.now() };
    }
  }
  if (!current || !animationsOn(app)) return;
  const elapsed = performance.now() - current.start;
  if (elapsed >= current.tl.total) {
    current = null;
    return;
  }
  play(app, svg, current.tl, elapsed, geom);
}

function play(app: App, svg: SVGSVGElement, tl: AnimTimeline, elapsed: number, geom: { sq: number; margin: number }): void {
  if (typeof (svg as unknown as { animate?: unknown }).animate !== 'function') return;
  const { sq, margin } = geom;
  const px = (x: number) => margin + x * sq + sq / 2;
  const top = svg.querySelector('g.top') ?? svg;
  const total = tl.total;
  const run = (el: Element, frames: Keyframe[]) => {
    const a = (el as HTMLElement).animate(frames, { duration: total, easing: 'linear', fill: 'none' });
    a.currentTime = elapsed;
  };
  const frames = (pts: AnimPoint[], tail: string) => {
    const out: Keyframe[] = [];
    out.push({ offset: 0, transform: `translate(${px(pts[0].x)}px, ${px(pts[0].y)}px)${tail}` });
    for (const p of pts) out.push({ offset: Math.min(1, p.t / total), transform: `translate(${px(p.x)}px, ${px(p.y)}px)${tail}` });
    const last = pts[pts.length - 1];
    out.push({ offset: 1, transform: `translate(${px(last.x)}px, ${px(last.y)}px)${tail}` });
    return out;
  };
  for (const [id, pts] of Object.entries(tl.players)) {
    if (pts.length < 2) continue;
    const el = svg.querySelector(`g.player[data-player="${CSS.escape(id)}"]`);
    if (el) run(el, frames(pts, ''));
  }
  if (tl.ball.length >= 2) {
    const endT = tl.ball[tl.ball.length - 1].t / total;
    // The ball drawn at its final place (on the ground or in a player's hands) appears when the flight ends.
    for (const real of svg.querySelectorAll('g.ball')) run(real, [{ offset: 0, opacity: 0 }, { offset: Math.max(0, endT - 0.001), opacity: 0 }, { offset: Math.min(1, endT), opacity: 1 }, { offset: 1, opacity: 1 }]);
    const fly = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    fly.setAttribute('class', 'ball flyball');
    fly.innerHTML = '<ellipse cx="0" cy="0" rx="8" ry="5" class="ballbody"></ellipse><line x1="-3.6" y1="0" x2="3.6" y2="0" class="balllace"></line>';
    top.appendChild(fly);
    const fr = frames(tl.ball, ' rotate(-30deg)');
    // Hidden once it has arrived (the real ball takes over).
    fr.forEach((f) => (f.opacity = (f.offset as number) <= endT ? 1 : 0));
    fr.push({ offset: Math.min(1, endT + 0.0005), opacity: 0, transform: fr[fr.length - 1].transform });
    fr.sort((x, y) => (x.offset as number) - (y.offset as number));
    run(fly, fr);
  }
  for (const p of tl.pulses) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${px(p.x)},${px(p.y)})`);
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('r', '15');
    c.setAttribute('class', 'thud');
    g.appendChild(c);
    top.appendChild(g);
    const o = p.t / total;
    const o2 = Math.min(1, (p.t + PULSE_MS * 2) / total);
    run(c, [
      { offset: 0, opacity: 0, transform: 'scale(0.6)' },
      { offset: o, opacity: 0, transform: 'scale(0.6)' },
      { offset: Math.min(1, (o + o2) / 2), opacity: 0.9, transform: 'scale(1.2)' },
      { offset: o2, opacity: 0, transform: 'scale(1.7)' },
      { offset: 1, opacity: 0, transform: 'scale(1.7)' },
    ]);
  }
  for (const gh of tl.ghosts) {
    const pl = app.game.players.find((q) => q.id === gh.id);
    const team = pl ? app.game.teams[pl.team] : null;
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', String(px(gh.x)));
    c.setAttribute('cy', String(px(gh.y)));
    c.setAttribute('r', '13.5');
    c.setAttribute('class', 'ghost');
    if (team) {
      c.setAttribute('fill', team.color);
      c.setAttribute('stroke', team.accent);
    }
    top.appendChild(c);
    const o = gh.t / total;
    const o2 = Math.min(1, (gh.t + GHOST_MS) / total);
    run(c, [
      { offset: 0, opacity: 0.85 },
      { offset: o, opacity: 0.85 },
      { offset: o2, opacity: 0 },
      { offset: 1, opacity: 0 },
    ]);
  }
}
