/**
 * Dice tray: every die actually rolled by the engine (GameEvent.dice) is shown
 * here, stage by stage. With "Pause after each roll" on, the board, the tray
 * and the action log stop after each roll until the coach presses Continue;
 * decisions (re-rolls, block dice, skills) appear only once the dice they
 * depend on have been shown.
 */
import type { App } from './app';
import { computerToAct, controlledElsewhere, isComputerTeam, remoteHeld } from './computer';
import { h, pct } from './dom';
import { desperateControls, draftSkillControls, endTurnNow, standUpButton } from './panels';
import { matchStepBar } from './matchui';
import { jumpControl } from './pitch';
import { E, type DecisionRequest, type DiceRecord, type GameEvent, type GameState, type Player } from './engine-global';

const FACE_GLYPH: Record<string, string> = { playerDown: '☠', bothDown: '✖', push: '➜', stumble: '!', pow: '✸' };
const D8_ARROW = ['', '↖', '↑', '↗', '←', '→', '↙', '↓', '↘'];

/** Tray stages already animated (so re-renders do not restart the animation). */
const animated = new Set<string>();

/** V5.5: the tray shows long texts clamped to a few lines; More ▾ shows every roll and event of the action in full. */
let expanded = false;
let expandedFor: unknown = null;
function moreButton(app: App, key: unknown): HTMLElement {
  return h(
    'button',
    {
      class: 'btn ghost small traymore',
      id: 'tray-more',
      'aria-expanded': expanded ? 'true' : 'false',
      title: expanded ? 'Show the short version again' : 'Show every roll and event of this action in full',
      onclick: () => {
        expanded = !expanded;
        expandedFor = key;
        app.emit();
      },
    },
    expanded ? 'Less ▴' : 'More ▾',
  );
}

function pips(n: number): HTMLElement {
  const layout: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  const grid = h('span', { class: 'pips' });
  for (let i = 0; i < 9; i++) grid.appendChild(h('i', { class: layout[n]?.includes(i) ? 'on' : '' }));
  return grid;
}

export function dieEl(rec: DiceRecord, i: number, roll: boolean): HTMLElement {
  const face = rec.faces[i];
  const delay = `animation-delay:${i * 90}ms`;
  if (rec.kind === 'block') {
    const f = rec.block?.[i] ?? 'push';
    const lbl = E.BLOCK_FACE_LABEL[f as keyof typeof E.BLOCK_FACE_LABEL];
    return h('span', { class: `die block f-${f} ${roll ? 'rolling' : ''}`, style: delay, title: `Block die: ${lbl} (face ${face})` }, h('b', null, FACE_GLYPH[f] ?? '?'), h('small', null, lbl));
  }
  if (rec.kind === 'd6') return h('span', { class: `die d6 ${roll ? 'rolling' : ''}`, style: delay, title: `D6: ${face}` }, pips(face));
  if (rec.kind === 'd8') return h('span', { class: `die d8 ${roll ? 'rolling' : ''}`, style: delay, title: `D8: ${face} (direction on the Random Direction Template, p.34)` }, h('b', null, String(face)), h('small', null, D8_ARROW[face] ?? ''));
  if (rec.kind === 'random') return h('span', { class: `die dr ${roll ? 'rolling' : ''}`, style: delay, title: `Random selection: ${face} of ${rec.sides}` }, h('b', null, String(face)), h('small', null, `of ${rec.sides}`));
  return h('span', { class: `die ${rec.kind} ${roll ? 'rolling' : ''}`, style: delay, title: `${rec.kind.toUpperCase()}: ${face}` }, h('b', null, String(face)), h('small', null, rec.kind.toUpperCase()));
}

function diceGroup(ev: GameEvent, roll: boolean): HTMLElement {
  return h(
    'div',
    { class: 'traygroup' },
    h('div', { class: 'traydice' }, (ev.dice ?? []).flatMap((rec) => rec.faces.map((_, i) => dieEl(rec, i, roll)))),
    h('div', { class: 'traytext' }, ev.text),
  );
}

export function renderTray(app: App): HTMLElement {
  const pb = app.st.playback;
  const wrap = h('div', { class: `tray ${app.playbackActive() ? 'active' : ''}`, 'aria-live': 'polite' });
  const toggle = h(
    'label',
    { class: 'small check traytoggle', title: 'When on, the game stops after each roll until you press Continue.' },
    h('input', {
      type: 'checkbox',
      id: 'pause-dice-toggle',
      checked: app.st.pauseDice,
      onchange: (e: Event) => {
        app.st.pauseDice = (e.target as HTMLInputElement).checked;
        app.savePrefs();
        if (!app.st.pauseDice && app.playbackActive()) app.skipPlayback();
        else app.emit();
      },
    }),
    ' Pause after each roll',
  );
  const animToggle = h(
    'label',
    { class: 'small check', title: 'Animate moves, the ball and knock-downs between the revealed steps (the engine\'s own results).' },
    h('input', {
      type: 'checkbox',
      id: 'anim-toggle',
      checked: app.st.animate,
      onchange: (e: Event) => {
        app.st.animate = (e.target as HTMLInputElement).checked;
        app.savePrefs();
        app.emit();
      },
    }),
    ' Animate',
  );
  const toggles = h('span', { class: 'traytoggle' }, animToggle, toggle);
  toggle.classList.remove('traytoggle');
  // V4: the tray is the action bar next to the board — the plan being built (odds, Confirm), a
  // decision that is not about dice (buttons, or click a highlighted square), and End Turn.
  const pend0 = app.game.pending?.request;
  if (app.st.draft && !app.playbackActive() && !pend0) return renderPlanBar(app, wrap, toggles);
  if (pend0 && !app.playbackActive() && !controlledElsewhere(app, pend0.team) && !trayDecision(app, pend0)) {
    const lastDice = pb ? [...pb.events.slice(0, pb.shown)].reverse().find((e) => e.dice?.length) : undefined;
    wrap.appendChild(h('div', { class: 'trayhead' }, h('span', { class: 'traytitle' }, 'Decision'), h('span', { class: 'small muted' }, `${app.game.teams[pend0.team].name} coach`), toggles));
    const body = h('div', { class: 'traybody' });
    if (lastDice) body.appendChild(diceGroup(lastDice, false));
    body.appendChild(genericDecision(app, pend0));
    wrap.appendChild(body);
    return wrap;
  }
  if (!pb || !pb.events.some((e) => e.dice?.length)) {
    wrap.appendChild(h('div', { class: 'trayhead' }, h('span', { class: 'traytitle' }, 'Dice tray'), h('span', { class: 'small muted' }, pb ? 'No dice were rolled for the last action.' : 'Every die rolled appears here when an action is confirmed. Planning never rolls dice.'), toggles));
    const idle = idleControls(app) ?? matchStepBar(app);
    if (idle) wrap.appendChild(idle);
    return wrap;
  }
  const shownEvents = pb.events.slice(0, pb.shown);
  const rolled = shownEvents.filter((e) => e.dice?.length);
  const current = rolled[rolled.length - 1];
  const active = app.playbackActive();
  const stageKey = `${pb.seq}:${rolled.length}`;
  const roll = !!current && !animated.has(stageKey);
  if (current) animated.add(stageKey);
  const total = pb.events.filter((e) => e.dice?.length).length;
  // A new action shows the short version again.
  if (expandedFor !== pb.before) expanded = false;
  const req = !active && app.game.pending ? app.game.pending.request : null;
  const inline = req && !controlledElsewhere(app, req.team) ? trayDecision(app, req) : null;
  // Non-dice events revealed since the last roll (e.g. "moves to …", "Turnover").
  const lastRollIdx = current ? shownEvents.lastIndexOf(current) : -1;
  const after = shownEvents.slice(lastRollIdx + 1).filter((e) => e.type !== 'note' || e.text !== 'Dice rolled.');
  const earlier = rolled.slice(0, -1).slice(-4);
  const hasMore = (current?.text.length ?? 0) > 100 || after.length > 2 || after.some((e) => e.text.length > 60) || rolled.length > 1;
  const head = h(
    'div',
    { class: 'trayhead' },
    h('span', { class: 'traytitle' }, 'Dice tray'),
    h('span', { class: 'small muted' }, `Roll ${rolled.length} of ${total} in this action`),
    hasMore ? moreButton(app, pb.before) : null,
    toggles,
  );
  if (expanded) wrap.classList.add('expanded');
  wrap.appendChild(head);
  const body = h('div', { class: 'traybody' });
  if (earlier.length && !expanded) body.appendChild(h('div', { class: 'trayearlier' }, earlier.map((e) => h('div', { class: 'trayprev', title: e.text }, (e.dice ?? []).flatMap((rec) => rec.faces.map((_, i) => dieEl(rec, i, false)))))));
  // A decision about these dice replaces the plain dice row (the dice are shown inside it).
  if (inline) body.appendChild(inline);
  else if (current) body.appendChild(diceGroup(current, roll));
  if (after.length && !active && !inline) body.appendChild(h('ul', { class: 'trayafter small' }, (expanded ? after : after.slice(-2)).map((e) => h('li', { title: e.text }, e.text))));
  wrap.appendChild(body);
  if (expanded) {
    // Every roll of this action so far, with its text (the log below the board has the same lines with rule pages).
    wrap.appendChild(
      h(
        'ol',
        { class: 'trayall small', id: 'tray-all' },
        shownEvents
          .filter((e) => e.type !== 'note' || e.text !== 'Dice rolled.')
          .map((e) => h('li', { class: e.dice?.length ? 'rolled' : '' }, e.dice?.length ? h('span', { class: 'trayalldice' }, (e.dice ?? []).flatMap((rec) => rec.faces.map((_, i) => dieEl(rec, i, false)))) : null, h('span', null, e.text))),
      ),
    );
  }
  const ctl = h('div', { class: 'trayctl' });
  if (active) {
    ctl.appendChild(h('button', { class: 'btn primary', id: 'tray-continue', onclick: () => app.advancePlayback() }, 'Continue ▶'));
    ctl.appendChild(h('button', { class: 'btn ghost small', onclick: () => app.skipPlayback() }, 'Show the rest'));
    // V5.5: End Turn straight away — the remaining dice of this action are shown (and logged) at once, then the Turn
    // ends; no Continue presses first. Only when the action left the Turn going and no decision follows.
    const g = app.game;
    if (g.phase === 'play' && !g.pending && pb.by === 'human' && pb.before.turn.active === g.turn.active && !controlledElsewhere(app, g.turn.active) && app.st.view === 'play' && g.match?.pendingPhase?.type !== 'charge')
      ctl.appendChild(h('button', { class: 'btn small danger', id: 'tray-end-turn', title: 'Show the rest of the dice at once and end the Turn (no confirmation). Undo can take it back.', onclick: () => endTurnNow(app) }, `End Turn ${g.teams[g.turn.active].turn}`));
    ctl.appendChild(h('span', { class: 'small muted' }, 'Space / Enter = Continue'));
  } else if (app.st.replayQueue.length) {
    ctl.appendChild(h('button', { class: 'btn primary', id: 'tray-replay-next', onclick: () => app.replayNext() }, `Replay next recorded action (${app.st.replayQueue.length} left) ▶`));
  } else if (req && !inline) {
    ctl.appendChild(h('span', { class: 'small strong' }, remoteHeld(app, req.team) ? 'Waiting for the other coach…' : isComputerTeam(app, req.team) ? 'The computer decides…' : 'Decision needed — see the panel on the right.'));
  } else if (!req) {
    const idle = idleControls(app) ?? matchStepBar(app);
    if (idle) ctl.appendChild(idle);
  }
  wrap.appendChild(ctl);
  return wrap;
}

/** V5.5 Bloodlust (p.125): end a hungry player's activation now — the bite choice, or the Turnover. */
export function endHungryButton(app: App, playerId: string, id: string): HTMLElement {
  const g = app.game;
  const v = E.findPlayer(g, playerId);
  const adjacentThrall = !!v && E.biteTargetAdjacent(g, v);
  return h(
    'button',
    {
      class: `btn small ${adjacentThrall ? '' : 'danger'}`,
      id,
      title: adjacentThrall ? 'End the activation: choose whether to bite the adjacent Thrall (no bite = Turnover).' : 'No Thrall is next to this player: ending the activation is a Turnover (Distracted, the ball is dropped). Undo can take it back.',
      onclick: () => {
        app.cancelDraft(false);
        app.runSimple({ kind: 'endActivation' });
      },
    },
    v ? `End ${E.label(v)}'s activation${adjacentThrall ? ' (bite a Thrall?)' : ' (Bloodlust Turnover)'}` : 'End activation',
  );
}

/** V5.5 Bloodlust (p.125): what the hungry acting player still has to do, next to the End activation button. */
function hungryLine(g: GameState, act: NonNullable<GameState['turn']['activation']>): HTMLElement | null {
  if (act.bloodlust !== 'hungry') return null;
  const v = E.findPlayer(g, act.playerId);
  if (!v) return null;
  const near = E.biteTargetAdjacent(g, v);
  return h('span', { class: 'small warn', id: 'tray-hungry' }, near ? `Bloodlust: ${E.label(v)} must bite a Thrall — ending the activation asks which one (no bite = Turnover).` : `Bloodlust: ${E.label(v)} must still bite a Thrall — move next to one, or end the activation (Turnover).`);
}

/** End Turn (and End activation) next to the board when it is the human coach's Turn and nothing is pending. */
function idleControls(app: App): HTMLElement | null {
  const g = app.game;
  if (g.phase !== 'play' || g.pending || app.playbackActive() || app.st.draft || computerToAct(app) || app.st.view !== 'play') return null;
  if (g.match?.pendingPhase?.type === 'charge') return null;
  const act = g.turn.activation;
  const actor = act ? E.findPlayer(g, act.playerId) : undefined;
  // The selected player's Actions, as in the side panel's player card (the pitch clicks still work too).
  const sel = app.player(app.st.selected);
  const mine = sel && sel.team === g.turn.active && sel.location === 'pitch' ? sel : undefined;
  const acting = !!mine && act?.playerId === mine.id;
  const opts = mine && (!mine.activated || acting) ? E.actionOptions(g, mine) : [];
  const shown = opts.filter((o) => o.enabled);
  return h(
    'div',
    { class: 'trayidle' },
    mine && shown.length
      ? h(
          'span',
          { class: 'trayactions', id: 'tray-actions' },
          h('span', { class: 'small muted' }, `${E.label(mine)}:`),
          shown.map((o) => h('button', { class: 'btn small', 'data-action': o.action, title: `Plan a ${o.label}`, 'aria-label': `${o.label} with ${E.label(mine)}`, onclick: () => app.startDraft(o.action, o.action === 'special' && o.special ? { special: o.special } : {}) }, o.label)),
          !acting && !mine.activated ? starRuleButton(app, mine) : null,
          !acting && !mine.activated && mine.stance !== 'stunned' ? h('button', { class: 'btn small ghost', 'aria-label': `Forego the activation of ${E.label(mine)}`, title: 'Forego Activation (p.52): the player will not act this Turn.', onclick: () => app.runSimple({ kind: 'forgo', playerId: mine.id }) }, 'Forego') : null,
        )
      : h('span', { class: 'small muted' }, act && actor ? `${E.label(actor)} is still acting.` : 'Select a player on the pitch to plan an action.'),
    act ? hungryLine(g, act) : null,
    mine ? standUpButton(app, mine, 'tray-stand-up-now') : null,
    act ? h('button', { class: 'btn small', id: 'tray-end-activation', 'aria-label': 'End this activation (tray)', onclick: () => app.runSimple({ kind: 'endActivation' }) }, act.bloodlust === 'hungry' && actor ? (E.biteTargetAdjacent(g, actor) ? 'End activation (bite?)' : 'End activation (Turnover)') : 'End activation') : null,
    h('button', { class: 'btn small danger', id: 'tray-end-turn', 'aria-label': `End Turn ${g.teams[g.turn.active].turn} (tray)`, title: 'Ends the Turn at once (no confirmation). Undo can take it back.', onclick: () => endTurnNow(app) }, `End Turn ${g.teams[g.turn.active].turn}`),
  );
}

/**
 * V5: a Star Player's rule used at the start of an activation, as a one-click Action in the tray (the choices —
 * target, square, skill — are then asked as decisions). Rules that let the activation go on start a Move Action;
 * to use one with another Action, tick it while planning that Action.
 */
function starRuleButton(app: App, p: Player): HTMLElement | null {
  const info = E.startRuleInfo(p);
  if (!info) return null;
  const action = info.actions?.[0] ?? 'move';
  if (info.special === 'bombardier') return null; // Cindy: ticked while planning the Throw Bomb (it needs the target square)
  const why = E.startRuleReason(app.game, p, action, info.special as never);
  return h(
    'button',
    {
      class: 'btn small star-rule',
      id: 'tray-star-rule',
      'data-star-rule': info.star,
      disabled: !!why,
      title: why ?? `${info.name}: ${info.summary}${info.ends ? '' : ' Then the activation goes on as a Move Action (tick it in the plan to use it with another Action).'}`,
      onclick: () => app.runSimple({ kind: 'playerAction', playerId: p.id, action, path: [], ...(info.special ? { special: info.special } : {}), starRule: true }),
    },
    `★ ${info.name}`,
  );
}

/**
 * The plan being built, shown next to the board: what it is, its exact odds,
 * and Confirm — without a trip to the side panel. The full step-by-step
 * review stays one click away (Details).
 */
function renderPlanBar(app: App, wrap: HTMLElement, toggle: HTMLElement): HTMLElement {
  const g = app.game;
  const st = app.st;
  const input = app.draftInput();
  const plan = st.plan;
  const busy = st.planBusy;
  wrap.classList.add('planbar');
  wrap.appendChild(h('div', { class: 'trayhead' }, h('span', { class: 'traytitle' }, st.stage === 'review' ? 'Review' : 'Plan'), h('span', { class: 'small' }, input ? E.describeInput(g, input) : ''), toggle));
  const sk = st.stage === 'plan' ? draftSkillControls(app) : null;
  const jc = st.stage === 'plan' ? jumpControl(app, 'tray-jump') : null;
  const dm = st.stage === 'plan' ? desperateControls(app, '-tray') : null;
  if (sk || jc || dm) {
    if (sk) sk.id = `${sk.id}-tray`;
    wrap.appendChild(h('div', { class: 'trayskill' }, jc, sk, dm));
  }
  const body = h('div', { class: 'traybody planodds', id: 'tray-plan' });
  if (busy) body.appendChild(h('span', { class: 'small muted' }, 'Working out the exact odds…'));
  else if (!plan) body.appendChild(h('span', { class: 'small muted' }, 'Build the plan on the pitch.'));
  else if (!plan.ok) {
    body.appendChild(h('span', { class: 'small warn' }, plan.errors[0] ?? 'This plan cannot be carried out.'));
    // V5.5 Bloodlust (p.125): the hungry team-mate's activation has to end first, and that is a Turnover — one click
    // resolves it (no need to confirm an Action that would not be taken).
    if (plan.endsHungry?.turnover) body.appendChild(endHungryButton(app, plan.endsHungry.playerId, 'tray-end-hungry'));
  } else {
    if (plan.endsHungry) body.appendChild(h('span', { class: 'small note', id: 'tray-hungry-note' }, plan.endsHungry.text));
    const wo = plan.withoutTeamRerolls;
    const w = plan.withTeamRerolls;
    const rr = g.teams[g.turn.active].rerolls + (g.teams[g.turn.active].leaderReroll ? 1 : 0) > 0;
    const chip = (label: string, a: number | undefined, b: number | undefined, cls: string) =>
      h('span', { class: `oddchip ${cls}` }, h('small', null, label), h('b', null, pct(a ?? 0)), rr && b !== undefined && Math.abs((b ?? 0) - (a ?? 0)) > 0.0005 ? h('small', null, ` ${pct(b)} with re-rolls`) : null);
    if (wo && w) {
      body.appendChild(chip('Completes', wo.pCompleted, w.pCompleted, 'good'));
      body.appendChild(chip('Turnover', wo.pTurnover, w.pTurnover, wo.pTurnover > 0.0005 ? 'bad' : ''));
      if (wo.pTouchdownActive > 0.0005 || w.pTouchdownActive > 0.0005) body.appendChild(chip('Touchdown', wo.pTouchdownActive, w.pTouchdownActive, 'good'));
      if (input && (input.blockTarget || input.foulTarget || input.specialTarget || input.vomitTarget) && wo.pTargetDown > 0) body.appendChild(chip(input.blockTarget2 ? '1st target down' : 'Target down', wo.pTargetDown, w.pTargetDown, ''));
      if (input && input.blockTarget2) body.appendChild(chip('2nd target down', wo.pTarget2Down, w.pTarget2Down, ''));
      if (input && input.special === 'punt' && input.facing) {
        body.appendChild(chip('Opponent gets it', wo.pOppHasBall, w.pOppHasBall, wo.pOppHasBall > 0.0005 ? 'bad' : ''));
        body.appendChild(chip('Your team has it', wo.pActiveHasBall, w.pActiveHasBall, ''));
      }
    }
  }
  wrap.appendChild(body);
  const ok = !!plan?.ok && !busy;
  wrap.appendChild(
    h(
      'div',
      { class: 'trayctl' },
      h('button', { class: 'btn primary', id: 'tray-confirm', 'aria-label': 'Execute the plan (tray)', disabled: !ok, title: 'Execute this plan now (the dice are rolled)', onclick: () => app.confirmNow() }, 'Execute now'),
      st.stage === 'review'
        ? h('button', { class: 'btn small', id: 'tray-back', 'aria-label': 'Back to editing the plan (tray)', onclick: () => app.backToPlan() }, '← Edit plan')
        : h('button', { class: 'btn small', id: 'tray-review', 'aria-label': 'Plan details (tray)', disabled: !ok, title: 'Every roll, modifier and outcome in the side panel', onclick: () => app.review() }, 'Details'),
      h('button', { class: 'btn small ghost', id: 'tray-cancel', 'aria-label': 'Cancel the plan (tray)', onclick: () => app.cancelDraft() }, 'Cancel'),
      h('span', { class: 'small muted' }, 'Backspace = undo last step'),
    ),
  );
  return wrap;
}

/** A decision that is not about dice: its options as buttons (squares can also be clicked on the pitch). */
function genericDecision(app: App, req: DecisionRequest): HTMLElement {
  const squares = req.options.filter((o) => o.square);
  const plain = req.options.filter((o) => !o.square);
  const many = req.options.length > 8;
  const shown = many ? plain : req.options;
  return h(
    'div',
    { class: 'traydecision', id: 'tray-decision-generic' },
    h('div', { class: 'trayq' }, h('b', null, req.prompt)),
    h(
      'div',
      { class: 'trayrr' },
      shown.map((o) => h('button', { class: `btn small ${o.id === 'none' || o.id === 'no' ? 'ghost' : ''}`, 'data-opt': o.id, title: o.detail ?? o.label, onclick: () => app.decide(req, o.id) }, o.label)),
      squares.length ? h('span', { class: 'small muted' }, many ? `…or click one of the ${squares.length} highlighted squares on the pitch.` : 'You can also click the highlighted square.') : null,
    ),
  );
}

/** Short label for a re-roll option, next to the die it re-rolls. */
function rerollLabel(o: { id: string; label: string }, app: App, req: DecisionRequest): string {
  const t = app.game.teams[req.team];
  const loner = /Loner (\d)\+/.exec(o.label);
  const lon = loner ? `, Loner ${loner[1]}+` : '';
  if (o.id === 'team') return `↻ Team Re-roll (${t.rerolls} left${lon})`;
  if (o.id === 'leader') return `↻ Leader Re-roll${loner ? ` (Loner ${loner[1]}+)` : ''}`;
  if (o.id === 'pro') return '↻ Pro (3+ to re-roll)';
  if (o.id === 'skill') return `↻ ${o.label.replace(/^Re-roll with\s+/i, '')} (skill)`;
  if (o.id === 'brawler') return '↻ Brawler (one Both Down)';
  if (o.id === 'hatred') return '↻ Hatred (one Player Down)';
  return `↻ ${o.label}`;
}

/**
 * Decisions that are about the dice just rolled are answered in the tray:
 * block dice are chosen by clicking the die; a re-roll is offered as a small
 * control next to the dice, and simply continuing (the primary button, Space
 * or Enter) keeps the result. The same options are listed in the side panel.
 */
export function trayDecision(app: App, req: DecisionRequest): HTMLElement | null {
  const pool = (req.context?.pool as string[] | undefined) ?? null;
  const pbx = app.st.playback;
  const lastRollEv = pbx ? [...pbx.events.slice(0, pbx.shown)].reverse().find((e) => e.dice?.length) : undefined;
  // The dice of the decision, with the rolled event's own text next to them (tray = log = decision).
  const group = (dice: HTMLElement[]) => h('div', { class: 'traygroup' }, h('div', { class: 'traydice' }, dice), lastRollEv ? h('div', { class: 'traytext small muted' }, lastRollEv.text) : null);
  const faceEl = (f: string, extra: Record<string, unknown> = {}, cls = '') =>
    h('button', { class: `die block f-${f} pick ${cls}`, title: E.BLOCK_FACE_LABEL[f as keyof typeof E.BLOCK_FACE_LABEL], ...extra }, h('b', null, FACE_GLYPH[f] ?? '?'), h('small', null, E.BLOCK_FACE_LABEL[f as keyof typeof E.BLOCK_FACE_LABEL]));
  if (req.type === 'blockDie' && pool) {
    const byFace = new Map(req.options.map((o) => [o.id, o]));
    return h(
      'div',
      { class: 'traydecision', id: 'tray-decision' },
      group(
        pool.map((f) => {
          const o = byFace.get(f);
          return faceEl(f, { 'data-opt': f, disabled: !o, title: o ? `${o.label}${o.detail ? ` — ${o.detail}` : ''}` : '', onclick: () => o && app.decide(req, f) });
        }),
      ),
      h('div', { class: 'trayq' }, h('b', null, req.prompt.replace(/:.*$/, '')), ' — click the die to use (or press 1–', String(pool.length), ').'),
    );
  }
  if (req.type !== 'reroll') return null;
  const none = req.options.find((o) => o.id === 'none');
  const others = req.options.filter((o) => o.id !== 'none');
  if (!none || !others.length) return null;
  const ctx = req.context ?? {};
  if (ctx.kind === 'blockDice' && pool) {
    const pros = new Map(others.filter((o) => o.id.startsWith('pro:')).map((o) => [o.id.slice(4), o]));
    const shown = new Set<string>();
    // V5.5: when you choose the die, clicking it keeps the roll and uses that result at once (no "Keep these dice"
    // first). The re-roll controls stay next to the dice.
    const pick = ctx.chooser === 'attacker';
    return h(
      'div',
      { class: 'traydecision', id: 'tray-decision' },
      group(
        pool.map((f, i) => {
          const pro = pros.get(f);
          const first = pro && !shown.has(f);
          if (first) shown.add(f);
          const die = pick
            ? faceEl(f, { 'data-keep-face': f, title: `Keep the dice and use ${E.BLOCK_FACE_LABEL[f as keyof typeof E.BLOCK_FACE_LABEL]} (key ${i + 1})`, onclick: () => app.keepBlockDie(req, f) })
            : faceEl(f, { disabled: true });
          return h('span', { class: 'diewrap' }, die, first ? h('button', { class: 'btn tiny reroll', 'data-opt': pro!.id, title: pro!.label, onclick: () => app.decide(req, pro!.id) }, '↻ Pro') : null);
        }),
      ),
      h('div', { class: 'trayq' }, h('b', null, 'Block dice'), pick ? ` — click the die to use (or press 1–${pool.length}), or re-roll first.` : ' — the defender chooses. Re-roll, or keep them.'),
      h(
        'div',
        { class: 'trayrr' },
        others.filter((o) => !o.id.startsWith('pro:')).map((o) => h('button', { class: 'btn small reroll', 'data-opt': o.id, title: o.label, onclick: () => app.decide(req, o.id) }, rerollLabel(o, app, req))),
        pick ? null : h('button', { class: 'btn primary small', id: 'tray-keep', 'data-opt': 'none', onclick: () => app.decide(req, 'none') }, 'Keep these dice ▶'),
      ),
    );
  }
  const natural = ctx.natural as number | undefined;
  const target = ctx.target as number | undefined;
  return h(
    'div',
    { class: 'traydecision', id: 'tray-decision' },
    lastRollEv ? group((lastRollEv.dice ?? []).flatMap((rec) => rec.faces.map((_, i) => dieEl(rec, i, false)))) : null,
    h('div', { class: 'trayq' }, h('b', null, 'Failed'), natural !== undefined && target !== undefined ? ` — rolled ${natural}, needed ${target}+. ` : ' — ', 'Re-roll it, or accept the result.'),
    h(
      'div',
      { class: 'trayrr' },
      others.map((o) => h('button', { class: 'btn small reroll', 'data-opt': o.id, title: o.label, onclick: () => app.decide(req, o.id) }, rerollLabel(o, app, req))),
      h('button', { class: 'btn primary small', id: 'tray-keep', 'data-opt': 'none', title: none.label, onclick: () => app.decide(req, 'none') }, `${none.label} ▶`),
    ),
  );
}
