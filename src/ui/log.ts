import type { App } from './app';
import { h } from './dom';
import { eventLine } from './panels';

export function renderLog(app: App): HTMLElement {
  const g = app.game;
  const entries = g.log;
  const wrap = h('div', { class: 'log-inner' });
  const toggle = () => {
    app.st.logOpen = !app.st.logOpen;
    app.savePrefs();
    app.emit();
  };
  const last = entries[entries.length - 1];
  wrap.appendChild(
    h(
      'div',
      { class: 'log-head' },
      h('button', { class: 'linkbtn log-toggle', id: 'log-toggle', 'aria-expanded': app.st.logOpen ? 'true' : 'false', title: app.st.logOpen ? 'Collapse the log (more room for the board)' : 'Show the full action log', onclick: toggle }, h('h3', null, `${app.st.logOpen ? '▾' : '▸'} Action log`)),
      h('span', { class: 'small muted' }, `${entries.length} action${entries.length === 1 ? '' : 's'} · dice seed ${g.rng.seed} · ${g.rng.counter} random draws used`),
      !app.st.logOpen && last ? h('span', { class: 'small log-last', title: last.title }, `Last: ${last.title}`) : null,
      app.st.logOpen
        ? h(
            'div',
            { class: 'btnrow tight' },
            h('button', { class: 'btn small ghost', onclick: () => { entries.forEach((e) => app.st.expandedLog.add(e.id)); app.emit(); } }, 'Expand all'),
            h('button', { class: 'btn small ghost', onclick: () => { app.st.expandedLog.clear(); app.emit(); } }, 'Collapse all'),
          )
        : h('div', { class: 'btnrow tight' }, h('button', { class: 'btn small ghost', onclick: toggle }, 'Show log')),
    ),
  );
  if (!app.st.logOpen) return wrap;
  if (!entries.length) {
    wrap.appendChild(h('p', { class: 'muted small pad' }, 'Nothing has happened yet. Each confirmed action appears here with its plan, every dice roll, every decision and the rule behind each change.'));
    return wrap;
  }
  const list = h('ol', { class: 'log-list' });
  for (const e of entries) {
    const open = app.st.expandedLog.has(e.id);
    const tm = g.teams[e.team];
    const badge = e.outcome === 'turnover' ? h('span', { class: 'pill bad' }, 'Turnover') : e.outcome === 'touchdown' ? h('span', { class: 'pill gold' }, 'Touchdown') : e.outcome === 'stopped' ? h('span', { class: 'pill' }, 'Stopped') : h('span', { class: 'pill ok' }, 'Done');
    const item = h(
      'li',
      { class: `log-entry ${open ? 'open' : ''} ${app.st.lastExecutedLogId === e.id ? 'latest' : ''}` },
      h(
        'button',
        { class: 'log-title', onclick: () => { if (open) app.st.expandedLog.delete(e.id); else app.st.expandedLog.add(e.id); app.emit(); } },
        h('span', { class: 'swatch', style: `background:${tm.color}` }),
        h('span', { class: 'small muted' }, `#${e.id} · ${tm.name} T${e.turn}`),
        h('span', { class: 'lt' }, e.title),
        badge,
        h('span', { class: 'chev' }, open ? '▾' : '▸'),
      ),
    );
    if (open) {
      const body = h('div', { class: 'log-body' });
      if (e.plan) {
        body.appendChild(
          h(
            'div',
            { class: 'log-plan' },
            h('div', { class: 'section-label' }, 'Planned & reviewed before rolling'),
            e.plan.steps.length ? h('ul', null, e.plan.steps.map((s) => h('li', null, s))) : h('p', { class: 'small muted' }, 'No dice needed.'),
            h('ul', { class: 'probs' }, e.plan.probabilities.map((s) => h('li', null, s))),
          ),
        );
      }
      body.appendChild(h('div', { class: 'section-label' }, 'What was rolled and why the board changed'));
      // While the dice tray is still revealing this action, the log shows the same events as the tray.
      const pb = app.st.playback;
      const hidden = pb && pb.logId === e.id && pb.shown < pb.events.length ? e.events.length - pb.shown : 0;
      body.appendChild(h('ol', { class: 'events' }, e.events.slice(0, e.events.length - hidden).map((ev) => eventLine(ev))));
      if (hidden) body.appendChild(h('p', { class: 'small muted' }, `…${hidden} more event${hidden === 1 ? '' : 's'} after you press Continue in the dice tray.`));
      if (e.decisions.length) {
        body.appendChild(h('div', { class: 'section-label' }, 'Decisions'));
        body.appendChild(h('ul', { class: 'small' }, e.decisions.map((d) => h('li', null, `${g.teams[d.team].name}: ${d.label}`))));
      }
      item.appendChild(body);
    }
    list.appendChild(item);
  }
  wrap.appendChild(list);
  return wrap;
}
