// Drag-and-drop of players onto the pitch (set-ups and the position editor).
//
// One shared mechanism for every mode: a drag starts from a Reserves chip (or
// an "Off the pitch" button) or from a player on the pitch, a small ghost
// follows the pointer, and on release the pitch square under the pointer is
// handed to the same placement function a click would use — so the set-up
// rules (own half, occupied squares, Quick Snap, …) are checked in one place.
// Pointer Events are used (mouse, pen and touch alike); the listeners live on
// `window`, so they survive the pitch and side panel being re-rendered.

import type { App } from './app';
import type { Coord } from './engine-global';

export interface DragHooks {
  /** Pitch square under a viewport point (null outside the pitch). */
  squareAt(x: number, y: number): Coord | null;
  /** Place / move the player: `c` is the square under the pointer, `target` the element under it. */
  drop(playerId: string, c: Coord | null, target: Element | null): void;
}

let hooks: DragHooks | null = null;
export function setDragHooks(h: DragHooks) {
  hooks = h;
}

interface DragState {
  app: App;
  playerId: string;
  label: string;
  pointerId: number;
  x0: number;
  y0: number;
  active: boolean;
  ghost: HTMLElement | null;
}

let cur: DragState | null = null;
const THRESHOLD = 6;

/** True while a player is being dragged (the pointer has moved past the threshold). */
export function dragging(): string | null {
  return cur?.active ? cur.playerId : null;
}

/**
 * Arm a drag from a pointerdown. Nothing happens until the pointer moves a few
 * pixels; a press and release without movement stays an ordinary click.
 */
export function armDrag(app: App, ev: PointerEvent, playerId: string, label: string) {
  if (ev.button !== 0) return;
  cancelDrag();
  cur = { app, playerId, label, pointerId: ev.pointerId, x0: ev.clientX, y0: ev.clientY, active: false, ghost: null };
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
}

function onMove(ev: PointerEvent) {
  const d = cur;
  if (!d || ev.pointerId !== d.pointerId) return;
  if (!d.active) {
    if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < THRESHOLD) return;
    d.active = true;
    d.ghost = document.createElement('div');
    d.ghost.className = 'dragghost';
    d.ghost.textContent = d.label;
    document.body.appendChild(d.ghost);
    document.body.classList.add('is-dragging');
    // Select the dragged player so the legal squares are highlighted.
    d.app.st.selected = d.playerId;
    d.app.emit();
  }
  if (d.ghost) {
    d.ghost.style.left = `${ev.clientX + 12}px`;
    d.ghost.style.top = `${ev.clientY + 10}px`;
  }
  const c = hooks?.squareAt(ev.clientX, ev.clientY) ?? null;
  const h = d.app.st.hover;
  if ((c && h && c.x === h.x && c.y === h.y) || (!c && !h)) return;
  d.app.st.hover = c;
  d.app.emit();
}

function onUp(ev: PointerEvent) {
  const d = cur;
  if (!d || ev.pointerId !== d.pointerId) return;
  const wasActive = d.active;
  cleanup();
  if (!wasActive) return; // a plain click: the element's own click handler deals with it
  ev.preventDefault();
  ev.stopPropagation();
  const target = document.elementFromPoint(ev.clientX, ev.clientY);
  const c = hooks?.squareAt(ev.clientX, ev.clientY) ?? null;
  hooks?.drop(d.playerId, c, target);
}

function onCancel(ev: PointerEvent) {
  if (cur && ev.pointerId === cur.pointerId) cancelDrag();
}

export function cancelDrag() {
  const d = cur;
  cleanup();
  if (d?.active) d.app.emit();
}

function cleanup() {
  const d = cur;
  cur = null;
  window.removeEventListener('pointermove', onMove, true);
  window.removeEventListener('pointerup', onUp, true);
  window.removeEventListener('pointercancel', onCancel, true);
  if (d?.ghost) d.ghost.remove();
  document.body.classList.remove('is-dragging');
}
