import type { App } from './app';
import { h } from './dom';
import { armDrag } from './drag';
import { controlledElsewhere } from './computer';
import { E, type Player, type TeamId } from './engine-global';
import { renderPlayerFacts } from './panels';
import { abbrev } from './pitch';

/** Inspection is read-only even while an action, remote turn or replay is active. */
export function renderInspection(app: App, id: string | null, hovering: boolean): HTMLElement {
  const shown = app.displayGame();
  const p = shown.players.find(p => p.id === id);
  if (!p) return h('div', { class: 'card inspection empty', id: 'player-inspection' }, h('h3', null, 'Player information'), h('p', { class: 'small muted' }, 'Hover or select a player to see attributes and skills.'));
  const card = renderPlayerFacts(app, p, shown);
  card.classList.add('inspection');
  card.id = 'player-inspection';
  card.dataset.playerId = p.id;
  card.prepend(h('div', { class: 'inspection-mode' }, hovering ? 'Hover preview' : 'Selected player'));
  if (p.name && p.name !== p.position) card.insertBefore(h('div', { class: 'pc-name', 'data-bb-no-translate': true }, p.name), card.querySelector('.stats'));
  return card;
}

/** Tabletop-style three-zone strip; engine locations remain unchanged. */
export function renderDugout(app: App, team: TeamId, hover: (id: string | null) => void): HTMLElement {
  const shown = app.displayGame(), tm = shown.teams[team];
  const players = shown.players.filter(p => p.team === team);
  const box = h('section', { class: 'dugout-team', 'data-team': team, style: '--team-color:' + tm.color + ';--team-accent:' + tm.accent, 'aria-label': tm.name },
    h('header', { class: 'dugout-title' }, h('b', { 'data-bb-no-translate': true }, tm.name), h('span', { class: 'small' }, 'On pitch', ' ' + players.filter(p => p.location === 'pitch').length + ' / ' + players.length)));
  const list = h('div', { class: 'dugout-list' });
  for (const [location, label] of [['cas', 'Casualties'], ['ko', 'Knocked out'], ['reserves', 'Reserves']] as const) {
    const off = players.filter(p => p.location === location);
    list.appendChild(h('section', { class: 'dugout-group ' + (location === 'reserves' ? 'reserves' : ''), 'data-box': location },
      h('div', { class: 'dugout-group-head' }, h('span', null, label), h('b', null, String(off.length))),
      h('div', { class: 'dugout-players' }, ...off.map(playerButton), off.length ? null : h('span', { class: 'dugout-empty', title: 'No players in this box.' }, '—'))));
  }
  box.appendChild(list);
  const sent = players.filter(p => p.location === 'sentOff');
  if (sent.length) box.querySelector('.dugout-title')?.appendChild(h('div', { class: 'dugout-sent-off', 'data-box': 'sentOff' }, h('span', null, 'Sent off'), h('b', null, String(sent.length)), ...sent.map(playerButton)));
  return box;

  function playerButton(p: Player): HTMLButtonElement {
    const editor = app.st.ctx.kind === 'practice' && app.st.view === 'setup';
    const setup = app.st.ctx.kind === 'match' && app.st.setupDraft?.team === p.team && !controlledElsewhere(app, p.team);
    const draggable = (editor || setup) && p.location === 'reserves' && !p.benched && !app.playbackActive();
    const label = '#' + p.number + ' ' + p.position + (p.benched ? ' — Unavailable this drive' : '');
    return h('button', {
      class: 'dugout-player' + (app.st.selected === p.id ? ' on' : '') + (draggable ? ' draggable' : '') + (p.benched ? ' unavailable' : ''),
      'data-player': p.id, 'aria-label': label + (p.name ? ' — ' + p.name : ''),
      title: label + '\n' + (draggable ? 'Click to select, then click a square in your half — or drag onto the pitch' : 'Inspect only; this player cannot enter the pitch now.'),
      onpointerenter: () => hover(p.id), onpointerleave: () => hover(null),
      onfocus: () => hover(p.id), onblur: () => hover(null),
      onpointerdown: draggable ? (ev: PointerEvent) => armDrag(app, ev, p.id, E.label(p)) : undefined,
      onclick: () => { hover(null); if (editor) app.st.setupTool = { kind: 'select' }; app.select(p.id); },
    }, h('span', { class: 'player-number' }, String(p.number)), h('span', { class: 'player-position', 'data-bb-no-translate': true }, abbrev(p.position)));
  }
}
