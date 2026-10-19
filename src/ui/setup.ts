import type { App } from './app';
import { h } from './dom';
import { E, type GameState, type Player, type SkillRef, type TeamId, type Weather } from './engine-global';
import { skillChips } from './panels';
import { armDrag } from './drag';

function numInput(value: number, min: number, max: number, onchange: (v: number) => void, attrs: Record<string, unknown> = {}) {
  return h('input', {
    type: 'number',
    value: String(value),
    min: String(min),
    max: String(max),
    class: 'num',
    ...attrs,
    onchange: (e: Event) => {
      const v = Math.round(Number((e.target as HTMLInputElement).value));
      if (Number.isFinite(v)) onchange(Math.max(min, Math.min(max, v)));
    },
  });
}

function field(label: string, control: HTMLElement, hint?: string) {
  return h('label', { class: 'field' }, h('span', { class: 'flabel' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

function touch(app: App) {
  app.st.dirty = true;
  app.emit();
}

function teamEditor(app: App, t: TeamId) {
  const g = app.game;
  const tm = g.teams[t];
  const rosterSel = h(
    'select',
    {
      onchange: (e: Event) => {
        const id = (e.target as HTMLSelectElement).value;
        tm.rosterId = id || undefined;
        const r = id ? E.ROSTER_BY_ID[id] : undefined;
        if (r) {
          tm.color = r.color;
          tm.accent = r.accent;
          if (/^(Home|Away|Team [AB])$/.test(tm.name)) tm.name = r.name;
        }
        touch(app);
      },
    },
    h('option', { value: '' }, '— none (custom) —'),
    E.ROSTERS.map((r) => h('option', { value: r.id, selected: tm.rosterId === r.id }, `${r.name} (p.${r.page})`)),
  );
  return h(
    'div',
    { class: 'card teamed', style: `--c:${tm.color}` },
    h('div', { class: 'row-between' }, h('h4', null, `Team ${t} — ${t === 'A' ? 'attacks → (scores at column Z)' : 'attacks ← (scores at column A)'}`)),
    h(
      'div',
      { class: 'grid2' },
      field('Name', h('input', { type: 'text', value: tm.name, onchange: (e: Event) => { tm.name = (e.target as HTMLInputElement).value || `Team ${t}`; touch(app); } })),
      field('Roster', rosterSel),
      field('Colour', h('input', { type: 'color', value: tm.color, onchange: (e: Event) => { tm.color = (e.target as HTMLInputElement).value; touch(app); } })),
      field('Number colour', h('input', { type: 'color', value: tm.accent, onchange: (e: Event) => { tm.accent = (e.target as HTMLInputElement).value; touch(app); } })),
      field('Team Re-rolls left', numInput(tm.rerolls, 0, 8, (v) => { tm.rerolls = v; touch(app); })),
      field('Turn marker', numInput(tm.turn, 0, 8, (v) => { tm.turn = v; touch(app); }), t === g.turn.active ? 'current Turn' : 'last Turn played'),
      field('Score', numInput(tm.score, 0, 20, (v) => { tm.score = v; touch(app); })),
      field('Leader Re-roll', h('input', { type: 'checkbox', checked: tm.leaderReroll, onchange: (e: Event) => { tm.leaderReroll = (e.target as HTMLInputElement).checked; touch(app); } }), 'needs a Leader on the pitch'),
    ),
  );
}

function palette(app: App) {
  const g = app.game;
  const tool = app.st.setupTool;
  const blocks: HTMLElement[] = [];
  for (const t of ['A', 'B'] as TeamId[]) {
    const tm = g.teams[t];
    const r = tm.rosterId ? E.ROSTER_BY_ID[tm.rosterId] : E.ROSTERS[t === 'A' ? 2 : 3];
    blocks.push(
      h(
        'div',
        { class: 'palette' },
        h('div', { class: 'small muted' }, `Add to ${tm.name} (${r.name} roster, p.${r.page}) — pick, then click empty squares:`),
        h(
          'div',
          { class: 'palbtns' },
          r.positions.map((pos) => {
            const on = tool.kind === 'place' && tool.team === t && tool.rosterId === r.id && tool.positionId === pos.id;
            return h(
              'button',
              {
                class: `btn small ${on ? 'on' : ''}`,
                style: `--c:${tm.color}`,
                title: `${pos.name} ${pos.qty}: MA ${pos.ma} ST ${pos.st} AG ${pos.ag}+ PA ${pos.pa ?? '-'}${pos.pa ? '+' : ''} AV ${pos.av}+ — ${pos.skills.map((sk) => E.skillName(sk)).join(', ') || 'no skills'}`,
                onclick: () => app.set({ setupTool: on ? { kind: 'select' } : { kind: 'place', team: t, rosterId: r.id, positionId: pos.id } }),
              },
              pos.name.replace(/^(Bretonnian|Tomb Kings|Human|Orc)\s+/, ''),
            );
          }),
        ),
      ),
    );
  }
  return h(
    'div',
    { class: 'card' },
    h('h4', null, 'Arrange the position'),
    h(
      'div',
      { class: 'seg' },
      h('button', { class: `segbtn ${tool.kind === 'select' ? 'on' : ''}`, onclick: () => app.set({ setupTool: { kind: 'select' } }) }, 'Select / move'),
      h('button', { class: `segbtn ${tool.kind === 'ball' ? 'on' : ''}`, onclick: () => app.set({ setupTool: { kind: 'ball' } }) }, 'Place ball'),
    ),
    h('p', { class: 'small muted' }, tool.kind === 'select' ? 'Click a player to edit; click an empty square to move the selected player there (or drag).' : tool.kind === 'ball' ? 'Click a square: a Standing player there receives the ball, otherwise it lies loose.' : 'Click empty squares to add players. Click the button again to stop.'),
    blocks,
  );
}

const SKILL_OPTIONS = () =>
  E.SKILLS.slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => h('option', { value: d.id }, `${d.name}${d.support === 'unsupported' ? ' (not in v1)' : d.support === 'noEffect' ? ' (no effect in v1)' : d.support === 'partial' ? ' (partial)' : ''}`));

function playerEditor(app: App, p: Player) {
  const g = app.game;
  const hasBall = g.ball.kind === 'held' && g.ball.playerId === p.id;
  const stat = (label: string, key: 'ma' | 'st' | 'ag' | 'av', min: number, max: number) => field(label, numInput(p[key], min, max, (v) => { p[key] = v; touch(app); }));
  let addSel: HTMLSelectElement;
  let addVal: HTMLInputElement;
  const addSkill = () => {
    const id = addSel.value;
    const def = E.SKILL_BY_ID[id];
    if (!def) return;
    const ref: SkillRef = { id };
    if (def.valued) ref.value = Math.max(2, Math.min(6, Number(addVal.value) || 4));
    if (def.keyworded) ref.keyword = addVal.value.trim() || 'all';
    p.skills.push(ref);
    touch(app);
  };
  return h(
    'div',
    { class: 'card' },
    h('div', { class: 'row-between' }, h('h4', null, `Edit #${p.number} ${p.position}`), h('span', { class: 'teamchip', style: `--c:${g.teams[p.team].color};--a:${g.teams[p.team].accent}` }, g.teams[p.team].name)),
    h(
      'div',
      { class: 'grid3' },
      field('Number', numInput(p.number, 1, 99, (v) => { p.number = v; touch(app); })),
      field('Position', h('input', { type: 'text', value: p.position, onchange: (e: Event) => { p.position = (e.target as HTMLInputElement).value || 'Player'; p.name = p.position; touch(app); } })),
      field('Keywords', h('input', { type: 'text', value: p.keywords.join(', '), onchange: (e: Event) => { p.keywords = (e.target as HTMLInputElement).value.split(',').map((x) => x.trim()).filter(Boolean); touch(app); } })),
    ),
    h(
      'div',
      { class: 'grid5' },
      stat('MA', 'ma', 1, 9),
      stat('ST', 'st', 1, 8),
      stat('AG (+)', 'ag', 1, 6),
      field('PA (+)', h('input', { type: 'text', value: p.pa === null ? '-' : String(p.pa), class: 'num', onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value.trim(); p.pa = v === '-' || v === '' ? null : Math.max(1, Math.min(6, Math.round(Number(v)) || 4)); touch(app); } })),
      stat('AV (+)', 'av', 3, 11),
    ),
    h(
      'div',
      { class: 'grid3' },
      field(
        'Status',
        h(
          'select',
          { onchange: (e: Event) => { p.stance = (e.target as HTMLSelectElement).value as Player['stance']; if (p.stance !== 'standing') { p.distracted = false; if (hasBall) { g.ball = { kind: 'none' }; app.toast('A player on the ground cannot hold the ball — the ball was removed; place it again.'); } } touch(app); } },
          ['standing', 'prone', 'stunned'].map((v) => h('option', { value: v, selected: p.stance === v }, v[0].toUpperCase() + v.slice(1))),
        ),
      ),
      field('Distracted', h('input', { type: 'checkbox', checked: p.distracted, disabled: p.stance !== 'standing', onchange: (e: Event) => { p.distracted = (e.target as HTMLInputElement).checked; touch(app); } })),
      field('Ball', h('button', { class: 'btn small', disabled: p.stance !== 'standing' || p.location !== 'pitch', onclick: () => { g.ball = hasBall ? { kind: 'none' } : { kind: 'held', playerId: p.id }; touch(app); } }, hasBall ? 'Remove the ball' : 'Give ball')),
    ),
    h('div', { class: 'section-label' }, 'Skills & Traits'),
    h(
      'div',
      { class: 'chips editable' },
      p.skills.map((k, i) =>
        h('span', { class: `chip sup-${E.SKILL_BY_ID[k.id]?.support ?? 'unsupported'}` }, E.skillName(k), h('button', { class: 'x', title: 'Remove', onclick: () => { p.skills.splice(i, 1); touch(app); } }, '×')),
      ),
    ),
    h(
      'div',
      { class: 'addskill' },
      (addSel = h('select', null, SKILL_OPTIONS())),
      (addVal = h('input', { type: 'text', placeholder: 'X+ / keyword', class: 'small', size: 8 })),
      h('button', { class: 'btn small', onclick: addSkill }, 'Add'),
    ),
    h('p', { class: 'small muted' }, 'Skills marked “not in v1” can be placed but anything they affect is disabled during play. Hover a chip for its rules summary and page.'),
    h(
      'div',
      { class: 'btnrow' },
      h('button', { class: 'btn small', onclick: () => { p.location = 'reserves'; p.pos = null; if (hasBall) g.ball = { kind: 'none' }; app.st.selected = null; touch(app); } }, 'Move to Reserves'),
      h('button', { class: 'btn small danger', onclick: () => { g.players = g.players.filter((q) => q.id !== p.id); if (hasBall) g.ball = { kind: 'none' }; app.st.selected = null; touch(app); } }, 'Delete player'),
    ),
  );
}

function reserves(app: App) {
  const g = app.game;
  const off = g.players.filter((p) => p.location !== 'pitch');
  if (!off.length) return null;
  return h(
    'div',
    { class: 'card offpitch' },
    h('h4', null, 'Off the pitch'),
    h('p', { class: 'small muted' }, 'Select one, then click an empty square to put them back on the pitch — or drag them there (drag a player here to take them off).'),
    h(
      'div',
      { class: 'palbtns' },
      off.map((p) => h('button', { class: `btn small ${app.st.selected === p.id ? 'on' : ''}`, style: `--c:${g.teams[p.team].color}`, 'data-player': p.id, onpointerdown: (ev: PointerEvent) => armDrag(app, ev, p.id, E.label(p)), onclick: () => app.set({ selected: p.id, setupTool: { kind: 'select' } }) }, `${g.teams[p.team].name} #${p.number} (${p.location})`)),
    ),
  );
}

export function renderSetupSide(app: App): HTMLElement {
  const g = app.game;
  const issues = E.validatePosition(g);
  const errors = issues.filter((i) => i.level === 'error');
  const sel = app.player(app.st.selected);
  return h(
    'div',
    { class: 'side-inner' },
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'row-between' }, h('h3', null, 'Set up a position'), editorUndoLabel() ? h('button', { class: 'btn small ghost', id: 'editor-undo', title: `Undo: ${editorUndoLabel()} (⌘Z / Ctrl+Z)`, onclick: () => undoEditorDelete(app) }, '↶ Undo delete') : null),
      h(
        'div',
        { class: 'grid2' },
        field('Team to play', h('select', { onchange: (e: Event) => { g.turn.active = (e.target as HTMLSelectElement).value as TeamId; touch(app); } }, (['A', 'B'] as TeamId[]).map((t) => h('option', { value: t, selected: g.turn.active === t }, g.teams[t].name)))),
        field(
          'Weather',
          h(
            'select',
            { onchange: (e: Event) => { g.weather = (e.target as HTMLSelectElement).value as Weather; touch(app); } },
            [
              ['perfect', 'Perfect Conditions'],
              ['verySunny', 'Very Sunny'],
              ['pouringRain', 'Pouring Rain'],
              ['blizzard', 'Blizzard'],
              ['swelteringHeat', 'Sweltering Heat'],
            ].map(([v, l]) => h('option', { value: v, selected: g.weather === v }, l)),
          ),
          'p.46',
        ),
        field('Dice seed', h('input', { type: 'number', value: String(g.rng.seed), class: 'num wide', onchange: (e: Event) => { g.rng.seed = (Math.abs(Math.round(Number((e.target as HTMLInputElement).value))) >>> 0) || 1; g.rng.counter = 0; touch(app); } }), 'same seed + same actions = same dice'),
        field('Ruler width (squares)', numInputFloat(g.options.rulerWidth, (v) => { g.options.rulerWidth = v; touch(app); }), 'interception model, see docs'),
      ),
      h('div', { class: 'btnrow' }, h('button', { class: 'btn small', onclick: () => { g.rng.seed = (Math.floor(Math.random() * 4294967295) >>> 0) || 1; g.rng.counter = 0; touch(app); } }, 'New random seed')),
    ),
    teamEditor(app, 'A'),
    teamEditor(app, 'B'),
    palette(app),
    sel ? playerEditor(app, sel) : null,
    reserves(app),
    h(
      'div',
      { class: 'card' },
      h('h4', null, 'Check and start'),
      issues.length ? h('ul', { class: 'issues' }, issues.map((i) => h('li', { class: i.level }, i.text))) : h('p', { class: 'small ok' }, 'The position looks valid.'),
      h(
        'div',
        { class: 'btnrow' },
        h('button', { class: 'btn primary', id: 'start-practice', disabled: errors.length > 0, title: 'Any legal arrangement; a missing ball is allowed', onclick: () => startFromEditor(app, false) }, 'Play it on the tactical board ▶'),
        h('button', { class: 'btn', id: 'start-formal', title: 'Strict check: the ball must be in play and at most 11 players per team', onclick: () => startFromEditor(app, true) }, 'Start as formal match position'),
      ),
      h('p', { class: 'small muted' }, 'The tactical board (Exhibition) may leave out the ball or use unusual numbers of players. A formal match position must have the ball in play (as after any kick-off) and at most 11 players per team; otherwise it is rejected with the reason.'),
    ),
  );
}

export function startFromEditor(app: App, formal: boolean) {
  const g = app.game;
  const issues = formal ? E.validateFormalStart(g) : E.validatePosition(g);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) {
    app.toast(`${formal ? 'Not a valid formal match position' : 'Fix the position first'}: ${errors.map((e) => e.text).join(' ')}`, 'error');
    return;
  }
  const s = E.startPlay(g);
  const name = app.st.docName ?? (formal ? 'Match position' : 'Tactical board position');
  app.openBoard(s, { kind: 'practice', name, start: E.cloneState(s) }, { docName: name });
  app.st.dirty = true;
  const warn = issues.filter((i) => i.level === 'warning');
  app.toast(`Play started: ${s.teams[s.turn.active].name} Turn ${s.teams[s.turn.active].turn}.${warn.length && !formal ? ` Note: ${warn[0].text}` : ''}`);
}

/** V5.5: deleted players of the position editor, for Undo (no confirmation needed). */
const editorUndo: Array<{ game: GameState; what: string }> = [];

/** Delete / Backspace in the position editor: remove the selected player at once — Undo (⌘Z / Ctrl+Z) puts them back. */
export function editorDeleteSelected(app: App): boolean {
  const g = app.game;
  const p = app.player(app.st.selected);
  if (!p) return false;
  editorUndo.push({ game: E.cloneState(g), what: `delete #${p.number} ${p.position}` });
  if (editorUndo.length > 40) editorUndo.shift();
  const hadBall = g.ball.kind === 'held' && g.ball.playerId === p.id;
  g.players = g.players.filter((q) => q.id !== p.id);
  if (hadBall) g.ball = { kind: 'none' };
  app.st.selected = null;
  app.toast(`Deleted #${p.number} ${p.position}. Undo: ⌘Z / Ctrl+Z or “↶ Undo delete”.`);
  touch(app);
  return true;
}

/** Undo the last player deletion in the position editor. */
export function undoEditorDelete(app: App): boolean {
  const u = editorUndo.pop();
  if (!u || app.st.view !== 'setup') return false;
  app.st.game = u.game;
  app.st.selected = null;
  app.toast(`Undone: ${u.what}.`);
  touch(app);
  return true;
}

export const editorUndoLabel = () => editorUndo[editorUndo.length - 1]?.what ?? null;

function numInputFloat(value: number, onchange: (v: number) => void) {
  return h('input', {
    type: 'number',
    step: '0.1',
    min: '1',
    max: '3',
    value: String(value),
    class: 'num',
    onchange: (e: Event) => {
      const v = Number((e.target as HTMLInputElement).value);
      if (Number.isFinite(v) && v >= 1 && v <= 3) onchange(v);
    },
  });
}

export { skillChips };
