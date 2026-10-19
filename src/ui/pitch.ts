import { applyAnimations, inAir } from './animate';
import type { App, Draft } from './app';
import { clear, h, s } from './dom';
import { dragging } from './drag';
import { computerCoaches } from './computer';
import { E, type Coord, type DecisionRequest, type GameState, type PathStep, type Player } from './engine-global';

/** The local human keeps the same bottom half throughout an opponent's turn. */
export function homeTeamForView(app: App): 'A' | 'B' {
  if (app.lan?.active && app.lan.mySeat) return app.lan.mySeat;
  if (app.st.ctx.kind === 'replay') return 'A';
  const coaches = computerCoaches(app);
  if (coaches.length === 1) return coaches[0].team === 'A' ? 'B' : 'A';
  if (coaches.length === 2) return 'A';
  return app.game.pending?.request.team ?? app.st.setupDraft?.team ?? app.game.turn.active;
}

export const SQ = 34;
export const MARGIN = 22;
/** Pitch size of the game last drawn: 26 × 15, or 20 × 11 for Blood Bowl Sevens (set by renderPitch). */
let W = 26;
let H = 15;

const cx = (x: number) => MARGIN + x * SQ + SQ / 2;
const cy = (y: number) => MARGIN + y * SQ + SQ / 2;

/** Whole position names whose last word alone would be ambiguous on a mixed roster (V5 rosters). */
const ABBREV_NAME: Record<string, string> = {
  'Goblin Lineman': 'Gob',
  'Snotling Lineman': 'Snt',
  'Gnoblar Lineman': 'Gnb',
  'Zombie Lineman': 'Zmb',
  'Dwarf Lineman': 'DLn',
  'Dwarf Blitzer': 'DBz',
  'Dwarf Runner': 'Run',
  'Rat Ogre': 'RtO',
  'Ogre Runt Punter': 'Pnt',
  'Witch Elf': 'Wch',
  'Troll Slayer': 'Sly',
  'Gutter Runner': 'Gut',
  'Skaven Clanrat': 'Clr',
  'Renegade Human': 'Hum',
  'Renegade Goblin': 'Gob',
  'Renegade Orc': 'Orc',
  'Renegade Skaven': 'Skv',
  'Renegade Dark Elf': 'DE',
  'Chaos Chosen': 'Cho',
  'Bull Centaur': 'Cen',
  'Sneaky Stabba': 'Stb',
  'Woodland Fox': 'Fox',
  'Doom Diver': 'Div',
  'Stilty Runna': 'Stl',
  'Fungus Flinga': 'Fng',
  'Fun-hoppa': 'Hop',
  'Pump Wagon': 'Pmp',
  'Noble Blitzer': 'Nbl',
  'Imperial Retainer': 'Ret',
  'Bloodborn Marauder': 'Mar',
  'Rotter Lineman': 'Rot',
  'Thrall Lineman': 'Thl',
};

/** A Star Player on the pitch: a star and the first three letters of the name (skipping titles). */
export function starAbbrev(name: string): string {
  const w = name.split(/\s+/).find((x) => !['The', 'Count', 'Lord', 'Captain'].includes(x)) ?? name;
  return `★${w.replace(/[^A-Za-z]/g, '').slice(0, 3)}`;
}

export function abbrev(pos: string): string {
  const name = pos.trim();
  if (ABBREV_NAME[name]) return ABBREV_NAME[name];
  const words = name.split(/\s+/);
  const last = words.pop() ?? name;
  // "Eagle Warrior", "Python Warrior"…: the first word tells them apart.
  if (last === 'Warrior' && words.length) return words[0].slice(0, 3);
  const map: Record<string, string> = { Lineman: 'Lin', Blitzer: 'Blz', Thrower: 'Thr', Catcher: 'Cat', Blocker: 'Blk', Squire: 'Sq', Knight: 'Kn', Guardian: 'TG', Ogre: 'Ogr', Troll: 'Trl', Hopeful: 'Hlf', Skink: 'Cha', Kroxigor: 'Krx', Raider: 'Rdr', Boar: 'Boar', Berserker: 'Brs', Valkyrie: 'Val', Ulfwerener: 'Ulf', Yhetee: 'Yht', Runner: 'Run', Treeman: 'Tre', Minotaur: 'Min' };
  return map[last] ?? last.slice(0, 3);
}

function probColor(p: number): string {
  if (p >= 0.83) return 'var(--good)';
  if (p >= 0.6) return 'var(--warn)';
  return 'var(--bad)';
}

export function currentEnd(app: App, d: Draft): Coord | null {
  if (d.path.length) return d.path[d.path.length - 1].to;
  return app.player(d.playerId)?.pos ?? null;
}

function occupied(g: GameState, c: Coord, ignoreId?: string): Player | undefined {
  const p = E.playerAt(g, c);
  return p && p.id !== ignoreId ? p : undefined;
}

/** Shortest path through empty squares (fewest squares, deterministic tie-break). */
export function shortestPath(g: GameState, from: Coord, to: Coord, moverId: string, avoid: Coord[]): Coord[] | null {
  const key = (c: Coord) => `${c.x},${c.y}`;
  const prev = new Map<string, Coord | null>();
  prev.set(key(from), null);
  const q: Coord[] = [from];
  const avoidSet = new Set(avoid.map(key));
  while (q.length) {
    const cur = q.shift() as Coord;
    if (cur.x === to.x && cur.y === to.y) break;
    for (const n of E.board.neighbours(cur)) {
      const k = key(n);
      if (prev.has(k) || avoidSet.has(k)) continue;
      if (occupied(g, n, moverId)) continue;
      prev.set(k, cur);
      q.push(n);
    }
  }
  if (!prev.has(key(to))) return null;
  const out: Coord[] = [];
  let c: Coord | null = to;
  while (c && !(c.x === from.x && c.y === from.y)) {
    out.unshift(c);
    c = prev.get(key(c)) ?? null;
  }
  return out;
}

function jumpKind(g: GameState, mover: Player, from: Coord, to: Coord): PathStep['kind'] | null {
  if (E.board.dist(from, to) !== 2 || occupied(g, to, mover.id)) return null;
  if (E.jumpedSquare(g, mover, from, to, 'jump')) return 'jump';
  if (E.canUse(mover, 'leap') && E.jumpedSquare(g, mover, from, to, 'leap')) return 'leap';
  if (E.canUse(mover, 'pogo') && E.jumpedSquare(g, mover, from, to, 'pogo')) return 'pogo';
  return null;
}

/**
 * Edit the draft path with a click on square `c` (one planning operation — Backspace takes it back).
 * V5.5: a route may come back through squares it has already visited, the start square included (p.54 does not
 * forbid it; every square entered costs movement and may need a Dodge or Rush as usual). A Jump / Leap is added only
 * in Jump mode (the Jump / Leap control), or when a square two away can be reached no other way.
 */
export function editPath(app: App, c: Coord): void {
  const d = app.st.draft;
  if (!d) return;
  const g = app.game;
  const mover = app.player(d.playerId);
  if (!mover?.pos) return;
  const end = currentEnd(app, d) as Coord;
  if (c.x === end.x && c.y === end.y) return;
  if (occupied(g, c, mover.id)) return;
  if (d.jumpMode) {
    const j = E.jumpOptions(g, mover.id, d.path).find((o) => o.to.x === c.x && o.to.y === c.y);
    if (j) {
      app.updateDraft({ path: [...d.path, { to: c, kind: j.kind }], jumpMode: false });
      return;
    }
    app.toast(`${E.board.fmt(c)} is not a square ${E.label(mover)} can ${E.canUse(mover, 'leap') ? 'Jump or Leap' : 'Jump'} to from ${E.board.fmt(end)} — pick a highlighted square, or turn Jump mode off.`, 'error');
    return;
  }
  if (E.board.adjacent(end, c)) {
    app.updateDraft({ path: [...d.path, { to: c, kind: 'step' }] });
    return;
  }
  const route = E.safestRoute(g, mover.id, c, d.path, { revisit: true });
  if (route) {
    app.updateDraft({ path: [...d.path, ...route.path], auto: { pSafe: route.pSafe, dodges: route.dodges, rushes: route.rushes, detour: route.detour } });
    return;
  }
  const jk = jumpKind(g, mover, end, c);
  if (jk) {
    app.updateDraft({ path: [...d.path, { to: c, kind: jk }] });
    return;
  }
  const sp = shortestPath(g, end, c, mover.id, []);
  const b = sp ? E.movementBudget(g, mover.id, [...d.path, ...sp.map((to) => ({ to, kind: 'step' as const }))]) : null;
  if (sp && b) app.updateDraft({ path: [...d.path, ...sp.map((to) => ({ to, kind: 'step' as const }))] });
  else app.toast(`${E.board.fmt(c)} cannot be reached from here with the movement left.`, 'error');
}

/**
 * V5.5: the Jump / Leap planning control: a toggle shown while a route is being planned and a Jump (over a Prone or
 * Stunned player, p.56), a Leap (Leap skill, over any adjacent square, p.132) or a Pogo jump is possible from the end
 * of the route. Jump mode highlights the landing squares with the Agility Test needed; a click adds the jump.
 */
export function jumpControl(app: App, id = 'jump-toggle'): HTMLElement | null {
  const d = app.st.draft;
  if (!d) return null;
  const mover = app.player(d.playerId);
  if (!mover) return null;
  const opts = draftJumps(app);
  if (!opts.length && !d.jumpMode) return null;
  const leap = E.canUse(mover, 'leap');
  const pogo = E.canUse(mover, 'pogo');
  const what = pogo ? 'Pogo jump' : leap ? 'Jump / Leap' : 'Jump';
  const kinds = [...new Set(opts.map((o) => o.kind))];
  return h(
    'button',
    {
      class: `btn small jumpbtn ${d.jumpMode ? 'on' : ''}`,
      id,
      'aria-pressed': d.jumpMode ? 'true' : 'false',
      title: d.jumpMode
        ? 'Jump mode: click a highlighted square to add the jump (2 squares of movement, an Agility Test; a fail is a Turnover). J or this button turns it off.'
        : `${what}: ${opts.length} landing square${opts.length === 1 ? '' : 's'} from here (${kinds.join(', ')}). Jump (p.56) goes over a Prone or Stunned player; Leap (p.132) over any adjacent square with the negative modifiers reduced by 1 (minimum −1). Key: J`,
      onclick: () => app.updateDraft({ jumpMode: !d.jumpMode }),
    },
    d.jumpMode ? `⤴ ${what}: pick a square (${opts.length})` : `⤴ ${what} (${opts.length})`,
  );
}

/** V5.5: the Jumps / Leaps available from the end of the draft's path (the Jump / Leap planning control). */
export function draftJumps(app: App): ReturnType<typeof E.jumpOptions> {
  const d = app.st.draft;
  if (!d || !isPathDraft(d) || d.clickMode !== 'path' || app.st.stage !== 'plan') return [];
  const g = app.game;
  if (g.phase !== 'play' || g.pending || app.playbackActive()) return [];
  return E.jumpOptions(g, d.playerId, d.path);
}

/** Actions whose plan starts with a path (a click on a reachable square adds steps). */
export const PATH_ACTIONS = ['move', 'blitz', 'pass', 'handoff', 'secure', 'ttm', 'foul'];

/** A draft whose clicks build a path: the path actions, and a Punt (move first, p.134). */
export function isPathDraft(d: { action: string; special?: string }): boolean {
  return PATH_ACTIONS.includes(d.action) || (d.action === 'special' && (d.special === 'punt' || d.special === 'hypnoticGaze' || d.special === 'kickTeamMate'));
}

let reachCache: { key: string; squares: Array<{ c: Coord; rushes: number }> } | null = null;

/** Reachable squares for the selected player / current draft (green = Move Allowance, yellow = Rush). */
export function reachFor(app: App): Array<{ c: Coord; rushes: number }> {
  const st = app.st;
  const g = app.game;
  if (!st.showReach || st.view !== 'play' || g.phase !== 'play' || g.pending || app.playbackActive()) return [];
  if (st.ctx.kind === 'lesson' && st.ctx.course === 'blockSchool' && !st.lesson.playing) return [];
  const d = st.draft;
  const id = d ? d.playerId : st.selected;
  const p = app.player(id);
  if (!p || p.team !== g.turn.active || p.location !== 'pitch') return [];
  if (d) {
    if (!isPathDraft(d) || d.clickMode !== 'path' || st.stage !== 'plan') return [];
  } else {
    const act = g.turn.activation;
    const continuing = act && act.playerId === p.id && !act.over;
    if (!continuing) {
      const mv = E.actionOptions(g, p).find((o) => o.action === 'move');
      if (!mv?.enabled) return [];
    } else if (!PATH_ACTIONS.includes(act!.action)) return [];
  }
  if (d?.jumpMode) return [];
  const key = JSON.stringify([g.rng.counter, g.log.length, g.turn.activation, id, d?.path ?? null, p.pos, p.stance]);
  if (reachCache?.key === key) return reachCache.squares;
  // V5.5: with a route started, earlier squares (the start included) can be entered again.
  const squares = E.reachableSquares(g, p.id, d?.path ?? [], { revisit: !!d?.path.length }).map((r) => ({ c: r.c, rushes: r.rushes }));
  reachCache = { key, squares };
  return squares;
}

/**
 * Pitch square under a viewport point. Uses the board's on-screen box and its
 * viewBox (preserveAspectRatio "xMidYMid meet") so the result is the same in
 * every engine and at any page zoom; getScreenCTM is not used.
 */
export function squareFromPoint(svg: SVGSVGElement, clientX: number, clientY: number): Coord | null {
  // A scrollable pitch can extend under the toolbar or outside its viewport.
  // Reject those hidden portions for drag/drop as well as ordinary clicks.
  const viewport = svg.closest('.pitchhost')?.getBoundingClientRect();
  if (viewport && (clientX < viewport.left || clientX >= viewport.right || clientY < viewport.top || clientY >= viewport.bottom)) return null;
  const r = svg.getBoundingClientRect();
  if (clientX < r.left || clientX >= r.right || clientY < r.top || clientY >= r.bottom) return null;
  const vbAttr = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  if (vbAttr.length !== 4 || vbAttr.some((v) => !Number.isFinite(v))) return null;
  const [vx, vy, vw, vh] = vbAttr;
  if (!(r.width > 0 && r.height > 0 && vw > 0 && vh > 0)) return null;
  const k = Math.min(r.width / vw, r.height / vh);
  const ox = r.left + (r.width - vw * k) / 2;
  const oy = r.top + (r.height - vh * k) / 2;
  const displayX = vx + (clientX - ox) / k;
  const displayY = vy + (clientY - oy) / k;
  if (displayX < vx || displayX >= vx + vw || displayY < vy || displayY >= vy + vh) return null;
  // Invert the clockwise display transform. Shared by clicks, hover and drag/drop.
  const vertical = svg.dataset.orientation === 'vertical';
  const counterClockwise = svg.dataset.homeTeam === 'A';
  const ux = vertical ? (counterClockwise ? Number(svg.dataset.pitchWidth) - displayY : displayY) : displayX;
  const uy = vertical ? (counterClockwise ? displayX : Number(svg.dataset.pitchHeight) - displayX) : displayY;
  const x = Math.floor((ux - MARGIN) / SQ);
  const y = Math.floor((uy - MARGIN) / SQ);
  const cols = Number(svg.dataset.pitchCols) || W, rows = Number(svg.dataset.pitchRows) || H;
  if (x < 0 || x >= cols || y < 0 || y >= rows) return null;
  return { x, y };
}

export function squareFromEvent(svg: SVGSVGElement, ev: MouseEvent): Coord | null {
  return squareFromPoint(svg, ev.clientX, ev.clientY);
}

function decisionSquares(req: DecisionRequest | undefined): Array<{ c: Coord; id: string }> {
  if (!req) return [];
  return req.options.filter((o) => o.square).map((o) => ({ c: o.square as Coord, id: o.id }));
}

/**
 * V5.5: a decision whose answer can be "stay where you are" (Follow-up: Stay put; On the Ball, Hit and Run, Trickster,
 * Furious Outburst: Stay) — clicking the square of the player concerned chooses it. Null when there is none.
 */
export function stayChoice(g: GameState, req: DecisionRequest | undefined): { id: string; c: Coord } | null {
  if (!req) return null;
  const opt = req.options.find((o) => !o.square && (o.id === 'stay' || (req.type === 'followUp' && o.id === 'no')));
  if (!opt) return null;
  const ctx = (req.context ?? {}) as Record<string, unknown>;
  const pid = (ctx.mover ?? (req.type === 'trickster' ? ctx.target : undefined) ?? ctx.playerId ?? g.turn.activation?.playerId) as string | undefined;
  const p = pid ? E.findPlayer(g, pid) : undefined;
  if (!p?.pos || p.location !== 'pitch') return null;
  return { id: opt.id, c: { ...p.pos } };
}

/** Board region shown for a Block School exercise (workbook grid), or null for the full pitch. */
export function cropFor(app: App): { x0: number; y0: number; w: number; h: number } | null {
  const c = app.st.ctx;
  if (c.kind !== 'lesson' || c.course !== 'blockSchool') return null;
  const ex = lessonGrid(app);
  if (!ex) return null;
  return { x0: E.LESSON_ORIGIN.x, y0: E.LESSON_ORIGIN.y, w: ex.cols, h: ex.rows };
}

/** Set by lessons.ts: the current workbook exercise grid size. */
export let lessonGrid: (app: App) => { cols: number; rows: number } | null = () => null;
export function setLessonGrid(fn: (app: App) => { cols: number; rows: number } | null) {
  lessonGrid = fn;
}

/** Extra board decorations supplied by the current mode (lessons, match set-up). */
export interface Marks {
  good?: string[];
  bad?: string[];
  squares?: Array<{ c: Coord; cls: string; label?: string }>;
}
export let extraMarks: (app: App) => Marks = () => ({});
export function setExtraMarks(fn: (app: App) => Marks) {
  extraMarks = fn;
}

export function renderPitch(app: App, host: HTMLElement): void {
  const g = app.displayGame();
  const real = app.game;
  const st = app.st;
  // The board helpers and this drawing use the game's pitch (standard or Sevens).
  E.usePitch(g);
  const geo = E.pitch();
  W = geo.w;
  H = geo.h;
  const sevens = E.isSevens(g);
  const oldScroll = { x: host.scrollLeft, y: host.scrollTop, key: host.dataset.viewKey };
  clear(host);
  const crop = cropFor(app);
  const vb = crop ? `${MARGIN + crop.x0 * SQ - 26} ${MARGIN + crop.y0 * SQ - 24} ${crop.w * SQ + 34} ${crop.h * SQ + 30}` : `0 0 ${W * SQ + 2 * MARGIN} ${H * SQ + 2 * MARGIN}`;
  const vertical = st.pitchOrientation === 'vertical';
  const pitchHeight = H * SQ + 2 * MARGIN;
  const pitchWidth = W * SQ + 2 * MARGIN;
  const homeTeam = homeTeamForView(app), counterClockwise = homeTeam === 'A';
  const [vx, vy, vw, vh] = vb.split(' ').map(Number);
  const displayVB = vertical ? (counterClockwise ? [vy, pitchWidth - vx - vw, vh, vw] : [pitchHeight - vy - vh, vx, vh, vw]).join(' ') : vb;
  const svg = s('svg', { viewBox: displayVB, 'data-orientation': st.pitchOrientation, 'data-pitch-height': pitchHeight, 'data-pitch-width': pitchWidth, 'data-home-team': homeTeam, 'data-pitch-cols': W, 'data-pitch-rows': H, class: `pitch ${crop ? 'cropped' : ''}${sevens ? ' sevens' : ''}${vertical ? ' vertical' : ''}`, role: 'img', 'aria-label': sevens ? 'Blood Bowl Sevens pitch (20 × 11)' : 'Blood Bowl pitch' });
  const scrollable = vertical && !st.pitchFit;
  host.classList.toggle('pitch-scroll', scrollable);
  const viewKey = `${st.pitchOrientation}:${homeTeam}:${displayVB}:${scrollable ? st.pitchZoom : 'fit'}`;
  host.dataset.viewKey = viewKey;
  if (scrollable) {
    svg.style.width = `${vh * st.pitchZoom}px`;
    svg.style.height = `${vw * st.pitchZoom}px`;
  }
  const defs = s('defs');
  defs.appendChild(
    s('pattern', { id: 'ezA', width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('rect', { width: 8, height: 8, fill: g.teams.A.color, opacity: 0.35 }), s('rect', { width: 4, height: 8, fill: g.teams.A.color, opacity: 0.55 })),
  );
  defs.appendChild(
    s('pattern', { id: 'ezB', width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('rect', { width: 8, height: 8, fill: g.teams.B.color, opacity: 0.35 }), s('rect', { width: 4, height: 8, fill: g.teams.B.color, opacity: 0.55 })),
  );
  svg.appendChild(defs);

  // grass
  const grass = s('g', { class: 'grass' });
  for (let x = 0; x < W; x++) grass.appendChild(s('rect', { x: MARGIN + x * SQ, y: MARGIN, width: SQ, height: H * SQ, fill: x % 2 ? 'var(--grass-a)' : 'var(--grass-b)' }));
  grass.appendChild(s('rect', { x: MARGIN, y: MARGIN, width: SQ, height: H * SQ, fill: 'url(#ezA)' }));
  grass.appendChild(s('rect', { x: MARGIN + (W - 1) * SQ, y: MARGIN, width: SQ, height: H * SQ, fill: 'url(#ezB)' }));
  // Sevens (Spike! 22 p.7): No Man's Land between the two Lines of Scrimmage; one Trapdoor in a Wide Zone of each half.
  if (sevens) grass.appendChild(s('rect', { x: MARGIN + (geo.losA + 1) * SQ, y: MARGIN, width: (geo.losB - geo.losA - 1) * SQ, height: H * SQ, class: 'nml' }, s('title', {}, "No Man's Land: no player may be set up here (Sevens p.10)")));
  // Trapdoors: one in a Wide Zone of each half (p.23; Sevens p.7) — they matter with the Treacherous Trapdoor Prayer to Nuffle (p.143).
  for (const t of sevens ? [{ x: 5, y: 1 }, { x: 14, y: 9 }] : [{ x: 6, y: 1 }, { x: 19, y: 13 }]) grass.appendChild(s('rect', { x: MARGIN + t.x * SQ + 7, y: MARGIN + t.y * SQ + 7, width: SQ - 14, height: SQ - 14, rx: 2, class: 'trapdoor' }, s('title', {}, 'Trapdoor (p.23): it only matters with the Treacherous Trapdoor Prayer to Nuffle (p.143) — then a player entering it falls through on a 1')));
  svg.appendChild(grass);

  // overlays below the grid
  const under = s('g', { class: 'under' });
  svg.appendChild(under);

  // grid
  const grid = s('g', { class: 'grid' });
  for (let x = 0; x <= W; x++) grid.appendChild(s('line', { x1: MARGIN + x * SQ, y1: MARGIN, x2: MARGIN + x * SQ, y2: MARGIN + H * SQ }));
  for (let y = 0; y <= H; y++) grid.appendChild(s('line', { x1: MARGIN, y1: MARGIN + y * SQ, x2: MARGIN + W * SQ, y2: MARGIN + y * SQ }));
  svg.appendChild(grid);
  const lines = s('g', { class: 'lines' });
  // Line(s) of Scrimmage: the halfway line, or the two Sevens lines on either side of No Man's Land.
  for (const lx of sevens ? [geo.losA + 1, geo.losB] : [geo.losB]) lines.appendChild(s('line', { x1: MARGIN + lx * SQ, y1: MARGIN, x2: MARGIN + lx * SQ, y2: MARGIN + H * SQ, class: 'los' }));
  for (const yy of [geo.wide, H - geo.wide]) lines.appendChild(s('line', { x1: MARGIN + SQ, y1: MARGIN + yy * SQ, x2: MARGIN + (W - 1) * SQ, y2: MARGIN + yy * SQ, class: 'wide' }));
  lines.appendChild(s('line', { x1: MARGIN + SQ, y1: MARGIN, x2: MARGIN + SQ, y2: MARGIN + H * SQ, class: 'goal' }));
  lines.appendChild(s('line', { x1: MARGIN + (W - 1) * SQ, y1: MARGIN, x2: MARGIN + (W - 1) * SQ, y2: MARGIN + H * SQ, class: 'goal' }));
  if (!crop) svg.appendChild(lines);

  // coordinates
  const lab = s('g', { class: 'coords' });
  if (crop) {
    for (let i = 0; i < crop.w; i++) lab.appendChild(s('text', { x: cx(crop.x0 + i), y: MARGIN + crop.y0 * SQ - 7, 'text-anchor': 'middle', class: 'wblabel' }, String.fromCharCode(65 + i)));
    for (let j = 0; j < crop.h; j++) lab.appendChild(s('text', { x: MARGIN + crop.x0 * SQ - 7, y: cy(crop.y0 + j) + 4, 'text-anchor': 'end', class: 'wblabel' }, String(j + 1)));
    svg.appendChild(s('rect', { x: MARGIN + crop.x0 * SQ, y: MARGIN + crop.y0 * SQ, width: crop.w * SQ, height: crop.h * SQ, class: 'cropframe' }));
  }
  if (!crop) for (let x = 0; x < W; x++) lab.appendChild(s('text', { x: cx(x), y: MARGIN - 7, 'text-anchor': 'middle' }, String.fromCharCode(65 + x)));
  if (!crop) for (let y = 0; y < H; y++) lab.appendChild(s('text', { x: MARGIN - 6, y: cy(y) + 4, 'text-anchor': 'end' }, String(y + 1)));
  if (!crop) lab.appendChild(s('text', { x: MARGIN, y: MARGIN + H * SQ + 15, 'text-anchor': 'start', class: 'ezlabel' }, `${g.teams.A.name} EZ`));
  if (!crop) lab.appendChild(s('text', { x: MARGIN + W * SQ, y: MARGIN + H * SQ + 15, 'text-anchor': 'end', class: 'ezlabel' }, `${g.teams.B.name} EZ`));
  svg.appendChild(lab);

  const pend = app.playbackActive() ? undefined : real.pending?.request;
  const decSq = decisionSquares(pend);

  // reachable area: green within Move Allowance, yellow with Rushes
  for (const r of reachFor(app)) {
    under.appendChild(s('rect', { x: MARGIN + r.c.x * SQ + 1, y: MARGIN + r.c.y * SQ + 1, width: SQ - 2, height: SQ - 2, class: r.rushes ? 'reach rush' : 'reach' }));
  }
  // V5.5: Jump / Leap mode — the legal landing squares with the Agility Test and its chance (re-rolls not counted).
  if (st.draft?.jumpMode) {
    for (const j of draftJumps(app)) {
      const m = j.mods.reduce((a, x) => a + x.value, 0);
      const need = Math.max(2, Math.min(6, j.target - m));
      const pAll = j.pTest * j.pRushes;
      under.appendChild(s('rect', { x: MARGIN + j.to.x * SQ + 1.5, y: MARGIN + j.to.y * SQ + 1.5, width: SQ - 3, height: SQ - 3, class: `mark jumpsq ${j.kind}` }));
      under.appendChild(s('rect', { x: MARGIN + j.over.x * SQ + 9, y: MARGIN + j.over.y * SQ + 9, width: SQ - 18, height: SQ - 18, rx: 3, class: 'mark jumpover' }));
      const tag = `${j.kind === 'jump' ? 'J' : j.kind === 'leap' ? 'L' : 'P'}${need}+${j.rushes ? ` R${j.rushes}` : ''}`;
      const w = Math.max(22, tag.length * 5.6 + 6);
      const gx = MARGIN + j.to.x * SQ + SQ / 2 - w / 2;
      const gy = MARGIN + j.to.y * SQ + SQ - 13;
      under.appendChild(s('rect', { x: gx, y: gy, width: w, height: 12, rx: 3, class: 'rolltag', fill: probColor(pAll) }));
      under.appendChild(s('text', { x: gx + w / 2, y: gy + 9, class: 'rolltagtxt', 'text-anchor': 'middle' }, tag));
    }
  }
  const marks = extraMarks(app);
  for (const m of marks.squares ?? []) {
    under.appendChild(s('rect', { x: MARGIN + m.c.x * SQ + 1.5, y: MARGIN + m.c.y * SQ + 1.5, width: SQ - 3, height: SQ - 3, class: `mark ${m.cls}` }));
    if (m.label) under.appendChild(s('text', { x: cx(m.c.x), y: cy(m.c.y) + 4, 'text-anchor': 'middle', class: 'marklabel' }, m.label));
  }

  // tackle zone overlay
  if (st.showTZ || (st.draft && st.view === 'play')) {
    const mover = st.draft ? app.player(st.draft.playerId) : app.player(st.selected);
    const team = mover?.team ?? g.turn.active;
    if (st.showTZ || mover) {
      for (let x = 0; x < W; x++)
        for (let y = 0; y < H; y++) {
          const n = E.markersOf(g, { x, y }, team).length;
          if (!n) continue;
          under.appendChild(s('rect', { x: MARGIN + x * SQ + 1, y: MARGIN + y * SQ + 1, width: SQ - 2, height: SQ - 2, class: 'tz', opacity: Math.min(0.14 + 0.1 * n, 0.45) }));
          if (st.showTZ) under.appendChild(s('text', { x: MARGIN + x * SQ + SQ - 4, y: MARGIN + y * SQ + 11, class: 'tzn', 'text-anchor': 'end' }, String(n)));
        }
    }
  }

  // pass range overlay
  const d = st.draft;
  const ttmLike = !!d && (d.action === 'ttm' || (d.action === 'special' && d.special === 'kickTeamMate'));
  const passLike = !!d && (d.action === 'pass' || (d.action === 'special' && d.special === 'bombardier'));
  if (d && (passLike || ttmLike) && st.view === 'play' && !real.pending) {
    const mover = app.player(d.playerId);
    const from = currentEnd(app, d);
    if (mover && from) {
      for (let x = 0; x < W; x++)
        for (let y = 0; y < H; y++) {
          const r = ttmLike ? E.ttmRange(from, { x, y }) : E.board.passRange(from, { x, y });
          if (!r) continue;
          under.appendChild(s('rect', { x: MARGIN + x * SQ, y: MARGIN + y * SQ, width: SQ, height: SQ, class: `range range-${r}` }));
        }
      if (d.passTarget && !d.hailMary) {
        const t = d.passTarget;
        const len = Math.hypot(t.x - from.x, t.y - from.y);
        if (len > 0) {
          const ux = (t.x - from.x) / len;
          const uy = (t.y - from.y) / len;
          const hw = (g.options.rulerWidth / 2) * SQ;
          const far = len * SQ + 0.5 * (Math.abs(ux) + Math.abs(uy)) * SQ;
          const nx = -uy;
          const ny = ux;
          const x0 = cx(from.x);
          const y0 = cy(from.y);
          const pts = [
            [x0 + nx * hw, y0 + ny * hw],
            [x0 + ux * far + nx * hw, y0 + uy * far + ny * hw],
            [x0 + ux * far - nx * hw, y0 + uy * far - ny * hw],
            [x0 - nx * hw, y0 - ny * hw],
          ];
          under.appendChild(s('polygon', { points: pts.map((p) => p.join(',')).join(' '), class: 'ruler' }));
          under.appendChild(s('circle', { cx: x0, cy: y0, r: hw, class: 'ruler' }));
        }
      }
    }
  }

  // loose ball
  const top = s('g', { class: 'top' });
  if (g.ball.kind === 'ground') {
    top.appendChild(ballIcon(cx(g.ball.pos.x), cy(g.ball.pos.y), 9, 'loose'));
  }
  // A ball in the air (a catch or a re-roll is pending): drawn above the players, where the engine says it comes down.
  let airBall: SVGGElement | null = null;
  if (g.ball.kind === 'none' && st.view === 'play' && st.playback) {
    const pb = st.playback;
    const air = inAir([...(real.pending?.events ?? []), ...pb.events.slice(0, pb.shown)]);
    if (air) airBall = ballIcon(cx(air.x) + 8, cy(air.y) - 12, 9, 'air');
  }

  // path preview (hidden while a decision is pending: the board shows the partial result)
  if (d && st.view === 'play' && !real.pending) {
    const mover = app.player(d.playerId);
    if (mover?.pos) {
      const pts = [mover.pos, ...d.path.map((x) => x.to)];
      svg.appendChild(s('polyline', { points: pts.map((c) => `${cx(c.x)},${cy(c.y)}`).join(' '), class: 'path' }));
      // V5.5: a square entered more than once shows all its step numbers ("2·5"); the start square too ("0·6").
      const nums = new Map<string, number[]>();
      d.path.forEach((stp, i) => {
        const k = `${stp.to.x},${stp.to.y}`;
        nums.set(k, [...(nums.get(k) ?? []), i + 1]);
      });
      const drawn = new Set<string>();
      d.path.forEach((stp) => {
        const k = `${stp.to.x},${stp.to.y}`;
        if (drawn.has(k)) return;
        drawn.add(k);
        const isStart = stp.to.x === mover.pos!.x && stp.to.y === mover.pos!.y;
        const txt = [...(isStart ? [0] : []), ...(nums.get(k) ?? [])].join('·');
        const r = txt.length > 2 ? 4 + txt.length * 2.4 : 6;
        top.appendChild(s('rect', { x: cx(stp.to.x) - r, y: cy(stp.to.y) - 6, width: 2 * r, height: 12, rx: 6, class: `pathdot ${stp.kind !== 'step' ? 'jumpdot' : ''}` }));
        top.appendChild(s('text', { x: cx(stp.to.x), y: cy(stp.to.y) + 3.5, class: 'pathnum', 'text-anchor': 'middle' }, txt));
      });
      // roll markers from the plan trace
      const plan = st.plan;
      if (plan?.ok) {
        const perSquare = new Map<string, string[]>();
        for (const stp of plan.steps) {
          if (!stp.at || stp.kind === 'block') continue;
          const k = `${stp.at.x},${stp.at.y}`;
          const short = { dodge: 'D', rush: 'R', jump: 'J', pickup: 'P', secure: 'S', standUp: 'U', catch: 'C', pass: 'T', boneHead: 'BH', reallyStupid: 'RS', unchannelledFury: 'UF', foulAppearance: 'FA', dauntless: 'Da', jumpUp: 'JU', animosity: 'An' } as Record<string, string>;
          const tag = `${short[stp.kind] ?? stp.kind.slice(0, 2)}${stp.target}+`;
          const arr = perSquare.get(k) ?? [];
          arr.push(tag);
          perSquare.set(k, arr);
          void probColor;
        }
        for (const [k, tags] of perSquare) {
          const [x, y] = k.split(',').map(Number);
          const worst = plan.steps.filter((q) => q.at && q.at.x === x && q.at.y === y && q.kind !== 'block').reduce((m, q) => Math.min(m, q.pSingle ?? 1), 1);
          const txt = tags.join(' ');
          const w = Math.max(20, txt.length * 5.6 + 6);
          const gx = MARGIN + x * SQ + SQ / 2 - w / 2;
          const gy = MARGIN + y * SQ + 1;
          top.appendChild(s('rect', { x: gx, y: gy, width: w, height: 12, rx: 3, class: 'rolltag', fill: probColor(worst) }));
          top.appendChild(s('text', { x: gx + w / 2, y: gy + 9, class: 'rolltagtxt', 'text-anchor': 'middle' }, txt));
        }
      }
    }
  }

  // players
  for (const p of g.players) {
    if (p.location !== 'pitch' || !p.pos) continue;
    top.appendChild(playerGlyph(app, p, g));
  }
  if (airBall) top.appendChild(airBall);

  // lesson / mode highlights on players
  for (const id of marks.good ?? []) {
    const q = E.findPlayer(g, id);
    if (q?.pos) top.appendChild(s('circle', { cx: cx(q.pos.x), cy: cy(q.pos.y), r: 17, class: 'hl good' }));
  }
  for (const id of marks.bad ?? []) {
    const q = E.findPlayer(g, id);
    if (q?.pos) top.appendChild(s('circle', { cx: cx(q.pos.x), cy: cy(q.pos.y), r: 17, class: 'hl bad' }));
  }

  // targets
  if (d && st.view === 'play' && !real.pending) {
    const tgtIds = [d.blockTarget, d.blockTarget2, d.handoffTarget, d.blitzTarget, d.thrownPlayerId, d.vomitTarget, d.foulTarget].filter(Boolean) as string[];
    for (const id of new Set(tgtIds)) {
      const t = app.player(id);
      if (!t?.pos) continue;
      top.appendChild(s('circle', { cx: cx(t.pos.x), cy: cy(t.pos.y), r: 16.5, class: id === d.handoffTarget || id === d.thrownPlayerId ? 'target friendly' : 'target' }));
    }
    const plan = st.plan;
    if (plan?.block && d.blockTarget) {
      const t = app.player(d.blockTarget);
      if (t?.pos) {
        const bx = cx(t.pos.x) + 9;
        const by = cy(t.pos.y) - 21;
        top.appendChild(s('rect', { x: bx - 2, y: by, width: 24, height: 13, rx: 3, class: plan.block.chooser === 'attacker' ? 'dicebadge good' : 'dicebadge bad' }));
        top.appendChild(s('text', { x: bx + 10, y: by + 10, 'text-anchor': 'middle', class: 'dicebadgetxt' }, `${plan.block.dice}${plan.block.chooser === 'attacker' ? 'D' : 'D!'}`));
      }
    }
    if (d.throwTarget) top.appendChild(s('rect', { x: MARGIN + d.throwTarget.x * SQ + 2, y: MARGIN + d.throwTarget.y * SQ + 2, width: SQ - 4, height: SQ - 4, class: 'passtarget' }));
    if (d.bombTarget) top.appendChild(s('rect', { x: MARGIN + d.bombTarget.x * SQ + 2, y: MARGIN + d.bombTarget.y * SQ + 2, width: SQ - 4, height: SQ - 4, class: 'passtarget bombtarget' }));
    if (d.passTarget) {
      top.appendChild(s('rect', { x: MARGIN + d.passTarget.x * SQ + 2, y: MARGIN + d.passTarget.y * SQ + 2, width: SQ - 4, height: SQ - 4, class: 'passtarget' }));
      const plan2 = st.plan;
      for (const it of plan2?.pass?.interceptorsIfAccurate ?? []) {
        const q = app.player(it.id);
        if (q?.pos) top.appendChild(s('rect', { x: MARGIN + q.pos.x * SQ + 1, y: MARGIN + q.pos.y * SQ + 1, width: SQ - 2, height: SQ - 2, class: 'interceptor' }));
      }
    }
  }

  // decision squares
  for (const ds of decSq) {
    const r = s('rect', { x: MARGIN + ds.c.x * SQ + 2, y: MARGIN + ds.c.y * SQ + 2, width: SQ - 4, height: SQ - 4, class: 'decsq', 'data-opt': ds.id });
    top.appendChild(r);
  }
  // V5.5: "stay where you are" — the player's own square answers it.
  const stay = pend ? stayChoice(real, pend) : null;
  if (stay) top.appendChild(s('rect', { x: MARGIN + stay.c.x * SQ + 2, y: MARGIN + stay.c.y * SQ + 2, width: SQ - 4, height: SQ - 4, class: 'mark staysq', 'data-opt': stay.id }));

  // hover (and the ghost of a player being dragged)
  if (st.hover) {
    const dragId = dragging();
    const dp = dragId ? E.findPlayer(g, dragId) : undefined;
    if (dp) {
      const team = g.teams[dp.team];
      top.appendChild(s('circle', { cx: cx(st.hover.x), cy: cy(st.hover.y), r: 13.5, fill: team.color, stroke: team.accent, 'stroke-width': 2, class: 'dragdrop' }));
      top.appendChild(s('text', { x: cx(st.hover.x), y: cy(st.hover.y) + 4.5, 'text-anchor': 'middle', class: 'num dragdrop', fill: team.accent }, String(dp.number)));
    }
    top.appendChild(s('rect', { x: MARGIN + st.hover.x * SQ + 0.5, y: MARGIN + st.hover.y * SQ + 0.5, width: SQ - 1, height: SQ - 1, class: 'hover' }));
  }
  svg.appendChild(top);

  // interaction layer
  const hit = s('rect', { x: MARGIN, y: MARGIN, width: W * SQ, height: H * SQ, fill: 'transparent', class: 'hit' });
  svg.appendChild(hit);
  if (vertical) {
    // Rotate a single board layer: paths, players, targeting and animations share it.
    // Coordinate labels stay outside that layer so they can be laid out upright.
    const board = s('g', { class: 'pitch-board', transform: counterClockwise ? 'translate(0,' + pitchWidth + ') rotate(-90)' : 'translate(' + pitchHeight + ',0) rotate(90)' });
    for (const child of [...svg.children]) if (child !== defs && child !== lab) board.appendChild(child);
    svg.appendChild(board);
    clear(lab);
    const x0 = crop?.x0 ?? 0, y0 = crop?.y0 ?? 0;
    const width = crop?.w ?? W, height = crop?.h ?? H;
    for (let i = 0; i < width; i++) lab.appendChild(s('text', { x: counterClockwise ? MARGIN + y0 * SQ - 7 : pitchHeight - (MARGIN + (y0 + height) * SQ) - 7, y: (counterClockwise ? pitchWidth - cx(x0 + i) : cx(x0 + i)) + 4, 'text-anchor': 'end' }, String.fromCharCode(65 + i)));
    for (let j = 0; j < height; j++) lab.appendChild(s('text', { x: counterClockwise ? cy(y0 + j) : pitchHeight - cy(y0 + j), y: counterClockwise ? pitchWidth - (MARGIN + (x0 + width) * SQ) - 7 : MARGIN + x0 * SQ - 7, 'text-anchor': 'middle' }, String(j + 1)));
    if (!crop) {
      lab.appendChild(s('text', { x: pitchHeight / 2, y: 10, 'text-anchor': 'middle', class: 'ezlabel' }, `${g.teams[homeTeam === 'A' ? 'B' : 'A'].name} EZ`));
      lab.appendChild(s('text', { x: pitchHeight / 2, y: W * SQ + 2 * MARGIN - 5, 'text-anchor': 'middle', class: 'ezlabel' }, `${g.teams[homeTeam].name} EZ`));
    }
    // Counter-rotate the glyph contents, leaving the animated player transform intact.
    for (const player of board.querySelectorAll('g.player')) {
      const upright = s('g', { class: 'upright-player', transform: counterClockwise ? 'rotate(90)' : 'rotate(-90)' });
      for (const child of [...player.childNodes]) upright.appendChild(child);
      player.appendChild(upright);
    }
    for (const text of board.querySelectorAll('text')) {
      if (text.closest('.upright-player')) continue;
      const x = text.getAttribute('x') ?? '0', y = text.getAttribute('y') ?? '0';
      text.setAttribute('transform', 'rotate(' + (counterClockwise ? 90 : -90) + ' ' + x + ' ' + y + ')');
    }
  }
  host.appendChild(svg);
  if (scrollable) {
    if (oldScroll.key === viewKey) {
      // Hover and animation redraw the SVG; retain the viewport instead of jumping to the top.
      host.scrollLeft = oldScroll.x;
      host.scrollTop = oldScroll.y;
    } else {
      const carrierId = g.ball.kind === 'held' ? g.ball.playerId : null;
      const holder = carrierId ? g.players.find(p => p.id === carrierId)?.pos : null;
      const focus = app.player(st.selected)?.pos ?? holder ?? (g.ball.kind === 'ground' ? g.ball.pos : null);
      if (focus && !crop) {
        host.scrollLeft = (counterClockwise ? cy(focus.y) : pitchHeight - cy(focus.y)) * st.pitchZoom - host.clientWidth / 2;
        host.scrollTop = (counterClockwise ? pitchWidth - cx(focus.x) : cx(focus.x)) * st.pitchZoom - host.clientHeight / 2;
      }
    }
  }
  applyAnimations(app, svg as unknown as SVGSVGElement, { sq: SQ, margin: MARGIN });
}

function ballIcon(x: number, y: number, r: number, cls: string): SVGGElement {
  return s(
    'g',
    { class: `ball ${cls}`, transform: `translate(${x},${y}) rotate(-30)` },
    s('ellipse', { cx: 0, cy: 0, rx: r, ry: r * 0.62, class: 'ballbody' }),
    s('line', { x1: -r * 0.45, y1: 0, x2: r * 0.45, y2: 0, class: 'balllace' }),
    s('line', { x1: -r * 0.2, y1: -2.2, x2: -r * 0.2, y2: 2.2, class: 'balllace' }),
    s('line', { x1: 0, y1: -2.2, x2: 0, y2: 2.2, class: 'balllace' }),
    s('line', { x1: r * 0.2, y1: -2.2, x2: r * 0.2, y2: 2.2, class: 'balllace' }),
  );
}

function playerGlyph(app: App, p: Player, g: GameState): SVGGElement {
  const st = app.st;
  const x = cx((p.pos as Coord).x);
  const y = cy((p.pos as Coord).y);
  const team = g.teams[p.team];
  const act = g.turn.activation;
  const isActing = act?.playerId === p.id;
  const dim = st.view === 'play' && g.phase === 'play' && p.team === g.turn.active && p.activated && !isActing;
  const cls = ['player', p.stance, p.distracted ? 'distracted' : '', dim ? 'done' : '', st.selected === p.id ? 'selected' : '', isActing ? 'acting' : ''].join(' ');
  const grp = s('g', { class: cls, transform: `translate(${x},${y})`, 'data-player': p.id });
  const skills = p.skills.map((k) => E.skillName(k)).join(', ');
  grp.appendChild(s('title', {}, `#${p.number} ${p.position} (${team.name})\nMA ${p.ma} ST ${p.st} AG ${p.ag}+ PA ${p.pa === null ? '-' : p.pa + '+'} AV ${p.av}+\n${skills || 'No skills'}\n${p.stance}${p.distracted ? ', Distracted' : ''}${p.activated ? ', activated' : ''}`));
  if (st.selected === p.id) grp.appendChild(s('circle', { r: 16.5, class: 'selring' }));
  const down = p.stance !== 'standing';
  grp.appendChild(s('circle', { r: down ? 11.5 : 13.5, fill: team.color, stroke: team.accent, 'stroke-width': 2.2, class: 'body' }));
  if (down) grp.appendChild(s('circle', { r: 14.5, class: p.stance === 'prone' ? 'ring-prone' : 'ring-stunned' }));
  if (p.distracted) grp.appendChild(s('circle', { r: 15, class: 'ring-distracted' }));
  grp.appendChild(s('text', { y: 4.5, 'text-anchor': 'middle', class: 'num', fill: team.accent }, String(p.number)));
  const diagramName = /^[XY]\d+$/.test(p.name);
  grp.appendChild(s('text', { y: 16.2, 'text-anchor': 'middle', class: diagramName ? 'pos wbname' : 'pos' }, diagramName ? p.name : p.star ? starAbbrev(p.position) : abbrev(p.position)));
  if (diagramName && p.skills.some((k) => k.id === 'guard')) {
    grp.appendChild(s('circle', { cx: 11, cy: -11, r: 6, class: 'badge badge-guard' }));
    grp.appendChild(s('text', { x: 11, y: -8.5, 'text-anchor': 'middle', class: 'badgetxt' }, 'G'));
  }
  const badge = p.stance === 'prone' ? 'P' : p.stance === 'stunned' ? 'S' : p.distracted ? 'D' : '';
  if (badge) {
    grp.appendChild(s('circle', { cx: -11, cy: -11, r: 6, class: `badge badge-${badge}` }));
    grp.appendChild(s('text', { x: -11, y: -8.5, 'text-anchor': 'middle', class: 'badgetxt' }, badge));
  }
  if (g.ball.kind === 'held' && g.ball.playerId === p.id) grp.appendChild(ballIcon(10, -10, 7, 'held'));
  const unsupported = p.skills.some((k) => E.SKILL_BY_ID[k.id]?.support === 'unsupported');
  if (unsupported) {
    grp.appendChild(s('circle', { cx: 11, cy: 11, r: 5, class: 'badge badge-warn' }));
    grp.appendChild(s('text', { x: 11, y: 13.5, 'text-anchor': 'middle', class: 'badgetxt' }, '!'));
  }
  return grp;
}

export function playerAtSquare(g: GameState, c: Coord): Player | undefined {
  return E.playerAt(g, c);
}
