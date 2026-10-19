import type { App } from './app';
import { controlledElsewhere } from './computer';
import { h } from './dom';
import { E, type Coord, type DecisionRequest } from './engine-global';
import { stayChoice } from './pitch';
interface Item { id: string; label: string; square?: Coord; face?: string }
const selections = new WeakMap<App, { request: DecisionRequest; index: number }>();

function choices(app: App): { request: DecisionRequest; items: Item[]; index: number } | null {
  const request = app.game.pending?.request;
  if (!request || app.playbackActive() || app.st.ctx.kind === 'replay' || controlledElsewhere(app, request.team)) return null;
  let items: Item[] = request.options.map(o => ({ ...o }));
  if (request.type === 'reroll' && request.context?.kind === 'blockDice' && request.context.chooser === 'attacker') {
    const pool = request.context.pool as string[] | undefined;
    if (pool?.length && request.options.some(o => o.id === 'none')) {
      items = [...pool.map((face, i) => ({ id: 'keep:' + i, face, label: E.BLOCK_FACE_LABEL[face as keyof typeof E.BLOCK_FACE_LABEL] })), ...items.filter(o => o.id !== 'none')];
    }
  }
  const stay = stayChoice(app.game, request);
  if (stay) { const item = items.find(o => o.id === stay.id); if (item) item.square = stay.c; }
  if (!items.length) return null;
  let state = selections.get(app);
  if (!state || state.request !== request) { state = { request, index: 0 }; selections.set(app, state); }
  state.index = Math.min(state.index, items.length - 1);
  return { request, items, index: state.index };
}

export function refreshDecisionKeys(app: App, focus = false): void {
  document.querySelectorAll('.keyboard-choice').forEach(el => { el.classList.remove('keyboard-choice'); el.removeAttribute('aria-current'); });
  document.getElementById('decision-keyboard-status')?.remove();
  const c = choices(app); if (!c) return;
  const item = c.items[c.index];
  const matches = [...document.querySelectorAll<HTMLElement>('[data-opt], [data-keep-face]')].filter(el => item.face ? el.dataset.keepFace === item.face : el.dataset.opt === item.id);
  for (const el of matches) { el.classList.add('keyboard-choice'); el.setAttribute('aria-current', 'true'); }
  const host = document.querySelector('.traydecision') ?? document.querySelector('.side .decision');
  host?.appendChild(h('div', { id: 'decision-keyboard-status', class: 'small keyboard-hint', 'aria-live': 'polite', 'data-selected-option': item.id }, h('span', null, 'Arrow keys: select · Enter: confirm'), ' — ', h('b', null, item.label)));
  if (focus) {
    const button = matches.find(el => el instanceof HTMLButtonElement && !el.disabled);
    button?.focus({ preventScroll: true });
    (matches.find(el => el.tagName.toLowerCase() === 'rect') ?? button)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

/** Select only public legal choices; no dice are rolled by navigation. */
export function handleDecisionKey(app: App, ev: KeyboardEvent): boolean {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(ev.key)) return false;
  const c = choices(app); if (!c) return false;
  ev.preventDefault();
  if (ev.key === 'Enter') {
    if (!ev.repeat && !app.lan?.busy) {
      const item = c.items[c.index];
      if (item.face) app.keepBlockDie(c.request, item.face);
      else app.decide(c.request, item.id);
    }
    return true;
  }
  let next = (c.index + (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 1) + c.items.length) % c.items.length;
  const current = c.items[c.index].square;
  if (current) {
    const svg = document.querySelector<SVGSVGElement>('.pitchhost svg');
    const display = (p: Coord) => svg?.dataset.orientation !== 'vertical' ? p : svg.dataset.homeTeam === 'A' ? { x: p.y, y: -p.x } : { x: -p.y, y: p.x };
    const origin = display(current), dir = ev.key === 'ArrowLeft' ? [-1, 0] : ev.key === 'ArrowRight' ? [1, 0] : ev.key === 'ArrowUp' ? [0, -1] : [0, 1];
    let best = Infinity;
    c.items.forEach((item, i) => {
      if (i === c.index || !item.square) return;
      const p = display(item.square), dx = p.x - origin.x, dy = p.y - origin.y;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 0) return;
      const cost = Math.abs(dx * dir[1] - dy * dir[0]) / along * 100 + Math.hypot(dx, dy);
      if (cost < best) { best = cost; next = i; }
    });
  }
  selections.set(app, { request: c.request, index: next });
  refreshDecisionKeys(app, true);
  return true;
}
