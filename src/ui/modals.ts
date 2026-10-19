import type { App } from './app';
import { openReplayFromStore } from './replayui';
import { h } from './dom';
import { E } from './engine-global';
import { EXAMPLES } from './examples';
import { advanceModal } from './advance';
import { onlineCoachesModal } from './onlinecoaches';
import { authorModal, resultModal, trainingModal } from './trainingui';
import { lanModal } from './lanclient';
import { avatarsModal } from './avatarui';

export function shell(app: App, title: string, body: HTMLElement | Array<HTMLElement | null>, wide = false) {
  return h(
    'div',
    { class: 'modal-back', onclick: (e: Event) => { if (e.target === e.currentTarget) app.set({ modal: null }); } },
    h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-label': title }, h('div', { class: 'row-between' }, h('h3', null, title), h('button', { class: 'btn ghost small', onclick: () => app.set({ modal: null }) }, 'Close')), body),
  );
}

export function renderModal(app: App): HTMLElement | null {
  const m = app.st.modal;
  if (!m) return null;
  switch (m.kind) {
    case 'saveAs':
      return saveAsModal(app);
    case 'library':
      return libraryModal(app);
    case 'examples':
      return examplesModal(app);
    case 'endTurn':
      return endTurnModal(app);
    case 'lan':
      return lanModal(app);
    case 'avatars':
      return avatarsModal(app);
    case 'training':
      return trainingModal(app);
    case 'trainingAuthor':
      return authorModal(app);
    case 'trainingResult':
      return resultModal(app);
    case 'help':
      return helpModal(app);
    case 'onlineCoaches':
      return onlineCoachesModal(app);
    case 'undo':
      return undoModal(app);
    case 'advance':
      return advanceModal(app, m.playerId);
    case 'confirm':
      return shell(app, m.title, [
        h('p', null, m.text),
        h(
          'div',
          { class: 'btnrow' },
          h('button', { class: `btn ${m.danger ? 'danger' : 'primary'}`, id: 'confirm-yes', onclick: () => { app.set({ modal: null }); m.onYes(); } }, m.yes),
          h('button', { class: 'btn', id: 'confirm-no', onclick: () => app.set({ modal: null }) }, 'Cancel'),
        ),
        h('p', { class: 'small muted' }, 'Enter confirms · Escape cancels.'),
      ]);
    default:
      return null;
  }
}

function undoModal(app: App) {
  const last = app.undoEntry();
  if (!last) return shell(app, 'Nothing to undo', [h('p', null, app.game.match?.options.computer ? 'You have not confirmed an action on this board yet (the computer’s actions are only taken back together with yours).' : 'No action has been confirmed on this board yet.')]);
  const pending = app.game.pending;
  return shell(app, 'Undo the last confirmed action?', [
    h('p', null, h('b', null, last.title || 'Last action'), pending && !last.computerActions ? ' — still waiting for a decision; the whole action is taken back.' : ''),
    last.computerActions ? h('p', { class: 'small' }, `The computer's ${last.computerActions} action${last.computerActions === 1 ? '' : 's'} since then ${last.computerActions === 1 ? 'is' : 'are'} taken back too.`) : null,
    h('p', { class: 'small' }, 'Everything returns to exactly how it was before that action: the board, the ball, re-rolls, the Turn, the action log and the dice generator. Confirming the same action again therefore gives the same dice.'),
    h('p', { class: 'small warn' }, 'Outside the rules: once dice have been rolled a decision must stand (“Take-backs and changing one’s mind”, p.35). Undo is an analysis tool — in a match, use it only if both coaches agree.'),
    h(
      'div',
      { class: 'btnrow' },
      h('button', { class: 'btn danger', id: 'confirm-undo', onclick: () => { app.set({ modal: null }); app.undo(); } }, 'Undo'),
      h('button', { class: 'btn', onclick: () => app.set({ modal: null }) }, 'Keep it'),
    ),
  ]);
}

function saveAsModal(app: App) {
  let nameInput: HTMLInputElement;
  let notes: HTMLTextAreaElement;
  const go = () => {
    app.game.notes = notes.value.trim() || undefined;
    void app.saveAs(nameInput.value, app.game.notes).then(() => app.set({ modal: null }));
  };
  return shell(app, 'Save position', [
    h('p', { class: 'small muted' }, `Saved positions live in ${app.store.folderLabel}. The save includes the whole game state, the action log and the dice generator position, so reopening it continues exactly where you left off.`),
    h('label', { class: 'field' }, h('span', { class: 'flabel' }, 'Name'), (nameInput = h('input', { type: 'text', value: app.st.docName ?? '', placeholder: 'e.g. Turn 8 two-dodge dash', onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') go(); } }))),
    h('label', { class: 'field' }, h('span', { class: 'flabel' }, 'Notes (optional)'), (notes = h('textarea', { rows: 3 }, app.game.notes ?? ''))),
    h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', onclick: go }, 'Save')),
  ]);
}

function libraryModal(app: App) {
  const list = h('div', { class: 'library' }, h('p', { class: 'muted small' }, 'Loading…'));
  app.store.list().then(
    (items) => {
      list.innerHTML = '';
      if (!items.length) {
        list.appendChild(h('p', { class: 'muted small' }, 'No saved positions yet. Use Save to keep the current one, or load an example.'));
        return;
      }
      for (const it of items) {
        list.appendChild(
          h(
            'div',
            { class: 'libitem' },
            h('div', null, h('b', null, it.name), h('div', { class: 'small muted' }, new Date(it.savedAt).toLocaleString(), it.notes ? ` — ${it.notes}` : '')),
            h(
              'div',
              { class: 'btnrow tight' },
              h('button', { class: 'btn small primary', title: 'Open the saved match: an unfinished match resumes where it was; a completed match opens in Replay from the beginning', onclick: () => { void app.open(it.name); app.set({ modal: null }); } }, 'Open'),
              h('button', { class: 'btn small', title: 'Play back the recorded history of this saved match from the beginning (no AI, no new dice)', onclick: () => { app.set({ modal: null }); void openReplayFromStore(app, it.name); } }, 'Replay'),
              h('button', { class: 'btn small ghost', title: 'Open the saved position itself (the final board of a completed match) instead of Replay', onclick: () => { void app.open(it.name, 'position'); app.set({ modal: null }); } }, 'Position'),
              h(
                'button',
                {
                  class: 'btn small ghost',
                  title: 'Delete this saved position (click twice)',
                  onclick: (ev: MouseEvent) => {
                    if (confirmDelete(it.name)) void app.store.remove(it.name).then(() => app.set({ modal: { kind: 'library' } }));
                    else {
                      const b = ev.currentTarget as HTMLButtonElement;
                      b.textContent = 'Click again to delete';
                      b.classList.add('danger');
                      setTimeout(() => {
                        b.textContent = 'Delete';
                        b.classList.remove('danger');
                      }, 4000);
                    }
                  },
                },
                'Delete',
              ),
            ),
          ),
        );
      }
    },
    (e) => {
      list.innerHTML = '';
      list.appendChild(h('p', { class: 'bad' }, `Could not list positions: ${(e as Error).message}`));
    },
  );
  return shell(app, 'Open a saved position', [
    list,
    h(
      'div',
      { class: 'btnrow' },
      h('button', { class: 'btn', onclick: () => void app.store.importFile().then((t) => { if (t && app.loadText(t, null)) app.set({ modal: null }); }) }, 'Import from file…'),
      app.store.revealFolder ? h('button', { class: 'btn ghost', onclick: () => void app.store.revealFolder?.() }, 'Show folder in Finder') : null,
    ),
  ]);
}

let pendingDelete: string | null = null;
function confirmDelete(name: string): boolean {
  if (pendingDelete === name) {
    pendingDelete = null;
    return true;
  }
  pendingDelete = name;
  setTimeout(() => (pendingDelete = null), 4000);
  return false;
}

function examplesModal(app: App) {
  return shell(
    app,
    'Example positions',
    [
      h('p', { class: 'small muted' }, 'Each example has a fixed dice seed. Loading it and confirming the same actions gives the same dice every time. See docs/EXAMPLES.md for step-by-step walkthroughs.'),
      h(
        'div',
        { class: 'library' },
        EXAMPLES.map((ex) =>
          h(
            'div',
            { class: 'libitem' },
            h('div', null, h('b', null, ex.name), h('div', { class: 'small muted' }, ex.summary)),
            h('button', { class: 'btn small primary', onclick: () => { app.loadText(JSON.stringify(ex.file), ex.name); app.set({ modal: null }); app.toast(`Loaded example: ${ex.name}`); } }, 'Load'),
          ),
        ),
      ),
    ],
    true,
  );
}

function endTurnModal(app: App) {
  const g = app.game;
  const h0 = E.ballHolder(g);
  const stalling = h0 && h0.team === g.turn.active && !h0.activated && E.canScoreWithoutDice(g, h0);
  const act = g.turn.activation;
  const actP = act ? E.findPlayer(g, act.playerId) : undefined;
  const stall2 = act && act.stallingCandidate && actP && E.ballHolder(g)?.id === actP.id;
  return shell(app, `End ${g.teams[g.turn.active].name} Turn ${g.teams[g.turn.active].turn}?`, [
    h('p', null, 'Unactivated players will not act this Turn. Stunned players who started the Turn Stunned roll over to Prone (p.39).'),
    stalling || stall2
      ? h('p', { class: 'warn' }, `Stalling (p.80-81): ${E.label((h0 ?? actP)!)} holds the ball and could score without rolling dice. Ending now counts as not scoring, so the Crowd Takes Action: a D6 equal to or above the Turn number (${g.teams[g.turn.active].turn}) knocks them down and causes a Turnover.`)
      : null,
    h('div', { class: 'btnrow' }, h('button', { class: 'btn danger', id: 'confirm-endturn', onclick: () => { app.set({ modal: null }); app.runSimple({ kind: 'endTurn' }); } }, 'End Turn'), h('button', { class: 'btn', onclick: () => app.set({ modal: null }) }, 'Keep playing')),
  ]);
}

function helpModal(app: App) {
  return shell(
    app,
    'How Bloodboard works',
    [
      h(
        'ol',
        { class: 'help' },
        h('li', null, h('b', null, 'Set up'), ' a position (or load an example): place players, the ball, re-rolls, Turn markers and weather, then play it on the tactical board.'),
        h('li', null, h('b', null, 'Plan'), ': select a player of the team to play, pick an Action and click squares/targets. The path shows every roll needed. Quick actions: with a player selected, click an adjacent opponent for a Block plan, or a square and then an opponent (or a distant opponent directly) for a Blitz plan.'),
        h('li', null, h('b', null, 'Details (optional)'), ': see each roll’s dice, target number, modifiers and chance; how they combine; and the branches (falls, turnovers, lost ball, injuries) with and without Team Re-rolls.'),
        h('li', null, h('b', null, 'Execute now'), ': only now are dice rolled, from the seeded generator saved in the position.'),
        h('li', null, h('b', null, 'Execute'), ': whenever a coach has a choice (re-roll, block die, push square, skills…) play pauses and that coach decides — block dice and re-rolls right in the dice tray.'),
      ),
      h('h4', null, 'Modes'),
      h('ul', { class: 'small' }, h('li', null, h('b', null, 'League'), ': saved teams with their Star Player Points and advancement (11-a-side).'), h('li', null, h('b', null, 'Tournament'), ': Matched Play teams — Team Draft Budget and Skill Points by Tier, 11-a-side or Sevens; quick Sevens Tournament against the computer.'), h('li', null, h('b', null, 'Exhibition'), ': one-off matches without purchased skills, 11-a-side or Sevens, and the Tactical board (free set-up, fixed dice seed — Reset, Replay or New seed).'), h('li', null, h('b', null, 'Teaching'), ': Basic Tutorials and Block School.')),
      h('h4', null, 'Keyboard'),
      h(
        'ul',
        { class: 'small' },
        h('li', null, 'Backspace / Delete while planning or reviewing: takes back the last planning step — one click, including a whole automatic route, or one target — and, at the first step, cancels the plan (nothing was rolled).'),
        h('li', null, 'Backspace / Delete with nothing planned: offers to undo the last confirmed action as a whole (board, dice generator and log); press Backspace again (or Enter) to confirm.'),
        h('li', null, 'Delete / Backspace in a set-up, the position editor or the team builder: removes the selected player at once (set-up: back to the Reserves Box; editor and team builder: ⌘Z / Ctrl+Z or “↶ Undo” puts it back — no confirmation).'),
        h('li', null, 'Space / Enter: Continue when optional dice pausing is enabled, or keep a failed roll without re-rolling · 1-3: pick a block die · Enter: execute the current plan directly · Escape: cancel · T: Tackle Zones · R: movement area.'),
      ),
      h('p', { class: 'small muted' }, 'Rules follow the supplied Third Season rulebook (FAQ Nov 2025 compilation). Every log line cites its page. Not implemented rules are labelled and disabled — see docs/RULES_COVERAGE.md.'),
    ],
    true,
  );
}
