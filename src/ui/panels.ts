import type { App } from './app';
import { h, pct } from './dom';
import { computerToAct, controlledElsewhere, isComputerTeam, remoteHeld, renderAdvisor, renderCoachesCard, renderComputerCard } from './computer';
import { E, type ActionAvailability, type DecisionRequest, type Facing, type GameEvent, type GameState, type OutcomeSummary, type PlanResult, type Player, type StepRecord, type TeamId } from './engine-global';
import { draftJumps, jumpControl } from './pitch';
import { endHungryButton } from './tray';
import { sideClock, totalClock } from './clock';

const ACTION_NAMES: Record<string, string> = { move: 'Move', blitz: 'Blitz', block: 'Block', pass: 'Pass', handoff: 'Hand-off', secure: 'Secure the Ball', foul: 'Foul', ttm: 'Throw Team-mate', special: 'Special' };
const WEATHER: Record<string, string> = { perfect: 'Perfect Conditions', verySunny: 'Very Sunny (−1 Passing Ability Tests)', pouringRain: 'Pouring Rain (−1 pick up / catch / intercept)', blizzard: 'Blizzard (−1 Rush; Quick/Short passes only)', swelteringHeat: 'Sweltering Heat (no effect during a Turn)' };

export function ruleTag(r?: { page: number; title: string; source?: 'sevens' }) {
  if (!r) return null;
  if (r.source === 'sevens') return h('span', { class: 'rule sevens', title: `Spike! Journal 22 (Blood Bowl Sevens) p.${r.page}: ${r.title}` }, `7s p.${r.page}`);
  return h('span', { class: 'rule', title: `Rulebook p.${r.page}: ${r.title}` }, `p.${r.page}`);
}

export function teamChip(app: App, t: TeamId) {
  const tm = app.game.teams[t];
  return h('span', { class: 'teamchip', style: `--c:${tm.color};--a:${tm.accent}` }, tm.name);
}

// ---------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------

export function renderScoreboard(app: App): HTMLElement {
  const g = app.game;
  const side = (t: TeamId) => {
    const tm = g.teams[t];
    const active = g.turn.active === t && g.phase === 'play';
    const leader = tm.leaderReroll ? h('span', { class: 'rr leader', title: 'Leader Re-roll (usable while a Leader is on the pitch, p.130)' }, 'L') : null;
    const clk = sideClock(app, t);
    return h(
      'div',
      { class: `sb-team ${active ? 'active' : ''} ${t === 'B' ? 'right' : ''}`, style: `--c:${tm.color};--a:${tm.accent}` },
      h('div', { class: 'sb-name' }, h('span', { class: 'sb-swatch' }), tm.name, isComputerTeam(app, t) ? h('span', { class: 'sb-cpu', title: 'Coached by the computer' }, 'COMPUTER') : null, active ? h('span', { class: 'sb-turnflag' }, 'TO PLAY') : null),
      h(
        'div',
        { class: 'sb-meta' },
        h('span', { title: 'Turn marker' }, `Turn ${tm.turn}/${E.rulesFor(g).turnsPerHalf}`),
        h('span', { class: 'sep' }, '·'),
        h('span', { title: 'Team Re-rolls remaining' }, 'Re-rolls ', ...Array.from({ length: Math.min(tm.rerolls, 8) }, () => h('span', { class: 'rr' }, '')), tm.rerolls === 0 ? h('span', { class: 'muted' }, '0') : null, leader),
        clk ? h('span', { class: 'sep' }, '·') : null,
        clk,
      ),
    );
  };
  const score = h('div', { class: 'sb-score' }, h('span', null, String(g.teams.A.score)), h('span', { class: 'dash' }, '–'), h('span', null, String(g.teams.B.score)));
  const phase =
    g.phase === 'setup'
      ? h('span', { class: 'pill' }, 'Setting up position')
      : g.phase === 'touchdown'
        ? h('span', { class: 'pill gold' }, 'Touchdown — drive over')
        : g.phase === 'halfOver'
          ? h('span', { class: 'pill' }, 'End of half')
          : g.phase === 'pregame'
            ? h('span', { class: 'pill' }, 'Pre-game')
            : g.phase === 'driveSetup'
              ? h('span', { class: 'pill' }, `Set-up · Drive ${g.match?.drive ?? ''}`)
              : g.phase === 'kickoff'
                ? h('span', { class: 'pill' }, 'Kick-off')
                : g.phase === 'fullTime'
                  ? h('span', { class: 'pill gold' }, 'Full time')
                  : g.match?.pendingPhase?.type === 'charge'
                    ? h('span', { class: 'pill live' }, `${g.teams[g.turn.active].name}: Charge!`)
                    : h('span', { class: 'pill live' }, `${g.teams[g.turn.active].name} Turn ${g.teams[g.turn.active].turn}${g.match ? ` · half ${g.match.half}` : ''}`);
  return h(
    'div',
    { class: 'scoreboard' },
    side('A'),
    h(
      'div',
      { class: 'sb-mid' },
      E.isSevens(g) ? h('div', { class: 'sb-variant', title: 'Blood Bowl Sevens — Spike! Journal 22 (2026): 20 × 11 pitch, 7 players, 6 Turns a half' }, 'BLOOD BOWL SEVENS') : null,
      h('div', { class: 'sb-midrow' }, score, phase),
      h('div', { class: 'sb-weather' }, h('span', { title: 'Weather (p.46)' }, WEATHER[g.weather] ?? g.weather), totalClock(app)),
    ),
    side('B'),
  );
}

// ---------------------------------------------------------------------------
// Side panel (play)
// ---------------------------------------------------------------------------

/** Extra cards at the top of the play panel (practice controls, match flow, tutorial), supplied by main.ts. */
export let topCards: (app: App) => Array<HTMLElement | null> = () => [];
export function setTopCards(fn: (app: App) => Array<HTMLElement | null>) {
  topCards = fn;
}

export function renderPlaySide(app: App, separateInspection = false): HTMLElement {
  const g = app.game;
  const wrap = h('div', { class: 'side-inner' });
  const cpu = renderComputerCard(app);
  if (cpu) wrap.appendChild(cpu);
  const coaches = renderCoachesCard(app);
  if (coaches) wrap.appendChild(coaches);
  for (const c of topCards(app)) if (c) wrap.appendChild(c);
  if (app.playbackActive()) {
    const pb = app.st.playback!;
    wrap.appendChild(
      h(
        'div',
        { class: 'card rolling' },
        h('h3', null, 'Rolling…'),
        h('p', { class: 'small' }, 'The dice tray above the pitch shows each roll in turn. Press Continue (or Space) for the next one; the board shows the position at this point.'),
        h('ol', { class: 'events compact' }, pb.events.slice(0, pb.shown).slice(-6).map((e) => eventLine(e))),
      ),
    );
    return wrap;
  }
  if (g.pending) {
    wrap.appendChild(remoteHeld(app, g.pending.request.team) ? h('div', { class: 'card', id: 'remote-deciding' }, h('b', null, 'Waiting for the other coach'), h('p', { class: 'small muted' }, `${g.teams[g.pending.request.team].name} is deciding: ${g.pending.request.prompt}`)) : isComputerTeam(app, g.pending.request.team) ? renderComputerDeciding(app, g.pending.request, g.pending.events) : renderDecision(app, g.pending.request, g.pending.events));
    return wrap;
  }
  if ((g.phase === 'touchdown' || g.phase === 'halfOver') && app.st.ctx.kind !== 'match') {
    const over = renderGameOver(app);
    if (over) wrap.appendChild(over);
  }
  if (app.st.draft) {
    wrap.appendChild(renderPlan(app));
    return wrap;
  }
  const sel = app.player(app.st.selected);
  if (sel) wrap.appendChild(renderPlayerCard(app, sel, separateInspection));
  else if (g.phase === 'play') wrap.appendChild(renderIdle(app));
  const adv = g.phase === 'play' ? renderAdvisor(app) : null;
  if (adv) wrap.appendChild(adv);
  const last = g.log[g.log.length - 1];
  if (last && app.st.lastExecutedLogId === last.id) wrap.appendChild(renderLastResult(app));
  if (g.phase === 'play') wrap.appendChild(renderTurnControls(app));
  else if (app.canUndo()) wrap.appendChild(h('div', { class: 'card turnctl' }, undoButton(app)));
  return wrap;
}

export function undoButton(app: App) {
  const last = app.undoEntry();
  return h(
    'button',
    { class: 'btn ghost small', id: 'undo-btn', disabled: !last, title: last ? `Undo: ${last.title}` : 'Nothing to undo', onclick: () => app.requestUndo() },
    '↶ Undo last action',
  );
}

function renderGameOver(app: App): HTMLElement | null {
  const g = app.game;
  if (app.st.ctx.kind === 'lesson') return null;
  const td = g.touchdown;
  const title = g.phase === 'touchdown' && td ? `Touchdown for ${g.teams[td.team].name}!` : 'End of the half';
  return h(
    'div',
    { class: 'card banner' },
    h('h3', null, title),
    h('p', null, `Score: ${g.teams.A.name} ${g.teams.A.score} – ${g.teams.B.score} ${g.teams.B.name}. `, g.phase === 'touchdown' ? 'This tactical-board position ends with the Drive.' : 'No Turns remain in this half.'),
    h('p', { class: 'muted small' }, 'Reset to play it again with the same dice, or start a League / Tournament match to play whole Drives with set-up and kick-off.'),
    h('div', { class: 'btnrow' }, h('button', { class: 'btn', onclick: () => app.practiceReset() }, 'Reset'), h('button', { class: 'btn', onclick: () => app.replaceGame(E.backToSetup(app.game), { keepDirty: true }) }, 'Edit position')),
  );
}

function renderIdle(app: App): HTMLElement {
  const g = app.game;
  if (computerToAct(app)) return h('div', { class: 'card' }, h('h3', null, teamChip(app, g.turn.active), ' — the computer is playing'), h('p', { class: 'small' }, 'Watch its actions on the board, in the dice tray and in the log. You can select players to look at them; you act again when it is your Turn or your decision.'));
  return h(
    'div',
    { class: 'card' },
    h('h3', null, teamChip(app, g.turn.active), ' to play'),
    h('p', null, 'Click one of your players to see what they can do. Every action goes through ', h('b', null, 'Plan → Execute (Details optional)'), ': nothing is rolled until you execute.'),
    h('p', { class: 'small' }, 'A selected player shows where they can move: ', h('span', { class: 'swatch reachswatch' }), ' green within Move Allowance, ', h('span', { class: 'swatch reachswatch rush' }), ' yellow with Rushes. Click one of those squares to plan a Move along the lowest-risk route.'),
    h('p', { class: 'muted small' }, 'Tips: T toggles Tackle Zone shading · R toggles the movement area.'),
  );
}

function statCell(label: string, v: string) {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, label), h('div', { class: 'v' }, v));
}

export function skillChips(p: Player) {
  return h(
    'div',
    { class: 'chips' },
    p.skills.length
      ? p.skills.map((k) => {
          const def = E.SKILL_BY_ID[k.id];
          const sup = def?.support ?? 'unsupported';
          const tip = def ? `${E.skillName(k)} (${def.active ? 'Active' : 'Passive'}${def.mandatory ? ', must be used' : ''}) — p.${def.page}\n${def.summary}${def.note ? `\n⚠ ${def.note}` : ''}\nv1 support: ${sup}` : k.id;
          return h('span', { class: `chip sup-${sup}`, title: tip }, E.skillName(k), sup === 'unsupported' ? ' ⚠' : sup === 'partial' ? ' ◐' : sup === 'noEffect' ? ' ○' : '');
        })
      : h('span', { class: 'muted small' }, 'No skills'),
  );
}

export function renderPlayerFacts(app: App, p: Player, g: GameState = app.game): HTMLElement {
  const tm = g.teams[p.team];
  const act = g.turn.activation;
  const acting = act?.playerId === p.id;
  const status = [p.location !== 'pitch' ? p.location : p.stance, p.distracted ? 'Distracted' : null, p.activated && !acting ? 'already activated' : null, acting ? 'acting now' : null, g.ball.kind === 'held' && g.ball.playerId === p.id ? 'has the ball' : null].filter(Boolean);
  const card = h(
    'div',
    { class: 'card player-card' },
    h('div', { class: 'pc-head' }, h('div', { class: 'pc-num', style: `background:${tm.color};color:${tm.accent}` }, String(p.number)), h('div', null, h('div', { class: 'pc-pos' }, p.position, p.captain ? h('span', { class: 'variant-chip captain-chip', title: 'Team Captain (p.155): Pro; while on the pitch a natural 6 after using a Team Re-roll makes it free' }, 'CAPTAIN') : null, p.raised ? h('span', { class: 'variant-chip', title: 'Raised by Masters of Undeath this game (p.155)' }, 'RAISED') : null, p.mercenary ? h('span', { class: 'variant-chip', title: 'Mercenary Player (p.147): Loner (4+)' }, 'MERCENARY') : null, p.star ? starChip(g, p) : null), h('div', { class: 'pc-team muted small' }, h('span', { 'data-bb-no-translate': true }, tm.name), ...status.flatMap(text => [' · ', h('span', null, text)])))),
    h('div', { class: 'stats' }, statCell('MA', String(p.ma)), statCell('ST', String(p.st)), statCell('AG', `${p.ag}+`), statCell('PA', p.pa === null ? '–' : `${p.pa}+`), statCell('AV', `${p.av}+`)),
    skillChips(p),
  );
  return card;
}

function renderPlayerCard(app: App, p: Player, separateInspection: boolean): HTMLElement {
  const g = app.game;
  const act = g.turn.activation;
  const acting = act?.playerId === p.id;
  const card = separateInspection ? h('div', { class: 'card player-card player-actions' }, h('h3', null, `#${p.number} ${p.position}`)) : renderPlayerFacts(app, p, g);
  if (acting && act) {
    card.appendChild(h('div', { class: 'small muted' }, `${ACTION_NAMES[act.action]} Action · Move Allowance used ${act.maUsed}/${p.ma} · Rushes ${act.rushesUsed}/${E.maxRushes(p)}${act.blitzTarget ? ` · Blitz target ${E.label(E.getPlayer(g, act.blitzTarget))}` : ''}`));
  }
  if (g.phase === 'play' && p.team === g.turn.active && controlledElsewhere(app, p.team)) {
    card.appendChild(h('p', { class: 'muted small' }, remoteHeld(app, p.team) ? 'Coached by the other player.' : 'Coached by the computer.'));
  } else if (g.phase === 'play' && p.team === g.turn.active) {
    const opts = E.actionOptions(g, p);
    const grid = h('div', { class: 'actions' });
    for (const o of opts) grid.appendChild(actionButton(app, o));
    card.appendChild(h('div', { class: 'section-label' }, acting ? 'Continue this activation' : 'Declare an Action'));
    card.appendChild(grid);
    const reasons = opts.filter((o) => !o.enabled && o.reason);
    if (reasons.length) {
      card.appendChild(
        h(
          'details',
          { class: 'why' },
          h('summary', null, `Why are some actions unavailable? (${reasons.length})`),
          h('ul', null, reasons.map((o) => h('li', null, h('b', null, `${o.label}: `), o.reason ?? ''))),
        ),
      );
    }
    const row = h('div', { class: 'btnrow' });
    const stand = standUpButton(app, p, 'stand-up-now');
    if (stand) row.appendChild(stand);
    if (acting && act?.bloodlust === 'hungry') row.appendChild(endHungryButton(app, p.id, 'pc-end-hungry'));
    else if (acting) row.appendChild(h('button', { class: 'btn', onclick: () => app.runSimple({ kind: 'endActivation' }) }, 'End activation'));
    else if (!p.activated && p.location === 'pitch' && p.stance !== 'stunned')
      row.appendChild(h('button', { class: 'btn ghost', title: 'Forego Activation (p.52): the player will not act this Turn.', onclick: () => app.runSimple({ kind: 'forgo', playerId: p.id }) }, 'Forego activation'));
    card.appendChild(row);
  } else if (g.phase === 'play') {
    card.appendChild(h('p', { class: 'muted small' }, `Opposition player — it is ${g.teams[g.turn.active].name}'s Turn.`));
  }
  return card;
}

/** Explicit immediate action; pitch clicks still build editable movement routes. */
export function standUpButton(app: App, p: Player, id: string): HTMLElement | null {
  const canStand = () => {
    const g = app.game, current = app.player(p.id);
    return current?.location === 'pitch' && current.stance === 'prone' && current.team === g.turn.active
      && g.phase === 'play' && app.st.view === 'play' && !g.pending && !app.st.draft && !app.playbackActive()
      && !controlledElsewhere(app, current.team) && !!E.actionOptions(g, current).find(o => o.action === 'move' && o.enabled);
  };
  if (!canStand()) return null;
  return h('button', { class: 'btn', id, title: 'Start a Move Action and stand up now; movement costs and trait rolls still apply.', onclick: () => {
    if (canStand()) app.runSimple({ kind: 'playerAction', playerId: p.id, action: 'move', path: [] });
  } }, 'Stand up now');
}

function actionButton(app: App, o: ActionAvailability) {
  return h(
    'button',
    {
      class: `btn action ${o.unsupported ? 'unsupported' : ''}`,
      disabled: !o.enabled,
      title: o.enabled ? `Plan a ${o.label}` : o.reason ?? '',
      'data-action': o.action,
      onclick: () => app.startDraft(o.action, o.action === 'special' && o.special ? { special: o.special } : {}),
    },
    o.label,
    o.unsupported ? h('span', { class: 'tag' }, 'not implemented') : null,
  );
}

/** End the Turn immediately (a plan that was not confirmed is simply dropped; the rules engine still applies every end-of-Turn rule). */
export function endTurnNow(app: App) {
  // V5.5: End Turn needs no extra presses: dice still being revealed are shown at once first.
  if (app.playbackActive() && !app.game.pending) app.skipPlayback();
  if (app.game.pending || app.playbackActive()) return app.toast('Finish the current decision first.', 'error');
  if (app.st.draft) app.cancelDraft(false);
  app.runSimple({ kind: 'endTurn' });
}

/** Stalling (p.80-81) is shown next to End Turn instead of in a confirmation dialog. */
function stallingWarning(app: App): HTMLElement | null {
  const g = app.game;
  const h0 = E.ballHolder(g);
  const stalling = h0 && h0.team === g.turn.active && !h0.activated && E.canScoreWithoutDice(g, h0);
  const act = g.turn.activation;
  const actP = act ? E.findPlayer(g, act.playerId) : undefined;
  const stall2 = act && act.stallingCandidate && actP && h0?.id === actP.id;
  if (!stalling && !stall2) return null;
  return h('p', { class: 'small warn' }, `Stalling (p.80-81): ${E.label((h0 ?? actP)!)} could score without rolling dice. Ending the Turn now lets the Crowd Take Action (D6 ≥ ${g.teams[g.turn.active].turn}: Knocked Down, Turnover).`);
}

function renderTurnControls(app: App): HTMLElement {
  const g = app.game;
  if (computerToAct(app)) return h('div', { class: 'card turnctl' }, h('div', { class: 'small muted' }, `${g.teams[g.turn.active].name} (computer): Blitz ${g.turn.used.blitz ? 'used' : 'available'} · Pass ${g.turn.used.pass ? 'used' : 'available'} · Hand-off ${g.turn.used.handoff ? 'used' : 'available'}`), h('div', { class: 'btnrow tight' }, undoButton(app)));
  return h(
    'div',
    { class: 'card turnctl' },
    h('div', { class: 'small muted' }, `${g.teams[g.turn.active].name}: Blitz ${g.turn.used.blitz ? 'used' : 'available'} · Pass ${g.turn.used.pass ? 'used' : 'available'} · Hand-off ${g.turn.used.handoff ? 'used' : 'available'} · Secure ${g.turn.used.secure ? 'used' : 'available'}`),
    g.match?.pendingPhase?.type === 'charge'
      ? h('button', { class: 'btn danger', onclick: () => app.runSimple({ kind: 'endCharge' }) }, 'End the Charge')
      : h('button', { class: 'btn danger', id: 'end-turn', title: 'Ends the Turn at once (no confirmation). Undo can take it back.', onclick: () => endTurnNow(app) }, `End ${g.teams[g.turn.active].name} Turn ${g.teams[g.turn.active].turn}`),
    stallingWarning(app),
    h('div', { class: 'btnrow tight' }, undoButton(app), h('span', { class: 'small muted' }, 'Delete/Backspace: take back the last planning step, or undo the last action (press again to confirm)')),
  );
}

export function renderLastResult(app: App): HTMLElement {
  const g = app.game;
  const last = g.log[g.log.length - 1];
  const badge = last.outcome === 'turnover' ? h('span', { class: 'pill bad' }, 'Turnover') : last.outcome === 'touchdown' ? h('span', { class: 'pill gold' }, 'Touchdown') : h('span', { class: 'pill ok' }, 'Done');
  return h(
    'div',
    { class: 'card result' },
    h('div', { class: 'row-between' }, h('h4', null, 'What just happened'), badge),
    h('div', { class: 'small muted' }, last.title),
    h('ol', { class: 'events compact' }, last.events.map((e) => eventLine(e))),
  );
}

export function eventLine(e: GameEvent) {
  return h('li', { class: `ev ev-${e.type}` }, h('span', { class: 'evtxt' }, e.text), ' ', ruleTag(e.rule));
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

const FACE_GLYPH: Record<string, string> = { playerDown: '☠', bothDown: '✖', push: '➜', stumble: '!', pow: '✸' };

function renderComputerDeciding(app: App, req: DecisionRequest, events: GameEvent[]): HTMLElement {
  const tm = app.game.teams[req.team];
  const paused = app.st.computer.paused;
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'card decision', style: `--c:${tm.color}` },
      h('div', { class: 'row-between' }, h('h3', null, 'The computer decides'), h('span', { class: 'pill', style: `background:${tm.color};color:${tm.accent}` }, `${tm.name} (computer)`)),
      h('p', { class: 'prompt' }, req.prompt, ' ', ruleTag(req.rule)),
      h('p', { class: 'small muted' }, paused ? 'The computer is paused — Resume it in its card.' : 'Choosing…'),
    ),
    h('div', { class: 'card' }, h('h4', null, 'So far in this action'), h('ol', { class: 'events compact' }, events.map((e) => eventLine(e)))),
  );
}

function renderDecision(app: App, req: DecisionRequest, events: GameEvent[]): HTMLElement {
  const tm = app.game.teams[req.team];
  const pool = (req.context?.pool as string[] | undefined) ?? null;
  const card = h(
    'div',
    { class: 'card decision', style: `--c:${tm.color}` },
    h('div', { class: 'row-between' }, h('h3', null, 'Decision needed'), h('span', { class: 'pill', style: `background:${tm.color};color:${tm.accent}` }, `${tm.name} coach decides`)),
    h('p', { class: 'prompt' }, req.prompt, ' ', ruleTag(req.rule)),
    pool ? h('div', { class: 'dicepool' }, pool.map((f) => h('span', { class: `bdie f-${f}`, title: E.BLOCK_FACE_LABEL[f as keyof typeof E.BLOCK_FACE_LABEL] }, FACE_GLYPH[f] ?? '?', h('small', null, E.BLOCK_FACE_LABEL[f as keyof typeof E.BLOCK_FACE_LABEL])))) : null,
    h(
      'div',
      { class: 'options' },
      req.options.map((o) => h('button', { class: `btn opt ${o.id === 'none' || o.id === 'no' ? 'ghost' : ''}`, onclick: () => app.decide(req, o.id), 'data-opt': o.id }, h('span', null, o.label), o.detail ? h('small', null, o.detail) : null)),
    ),
    req.options.some((o) => o.square) ? h('p', { class: 'small muted' }, 'You can also click a highlighted square on the pitch.') : null,
  );
  const wrap = h('div', null, card);
  wrap.appendChild(h('div', { class: 'card' }, h('h4', null, 'So far in this action'), h('ol', { class: 'events compact' }, events.map((e) => eventLine(e)))));
  return wrap;
}

// ---------------------------------------------------------------------------
// Plan and Review
// ---------------------------------------------------------------------------

function stepper(stage: 'plan' | 'review') {
  const steps = ['Plan', 'Details (optional)', 'Execute'];
  const idx = stage === 'plan' ? 0 : 1;
  return h('ol', { class: 'stepper' }, steps.map((sname, i) => h('li', { class: i < idx ? 'done' : i === idx ? 'current' : '' }, h('span', null, String(i + 1)), sname)));
}

/**
 * V4 skill controls of the plan being built, shown in the side panel and in
 * the tray: the Punt's facing (p.134) and Fumblerooski (p.128).
 */
/**
 * V5.5: Blood Bowl Sevens Desperate Measures chosen with an Action (Spike! 22 p.15) — Razzle-Dazzle and Grudge Match
 * when the player is activated, Set Piece with a Pass. Shown only when the team still has one of them.
 */
export function desperateControls(app: App, idSuffix = ''): HTMLElement | null {
  const d = app.st.draft;
  const g = app.game;
  if (!d || g.variant !== 'sevens' || !g.match?.desperate) return null;
  const p = app.player(d.playerId);
  if (!p) return null;
  const act = g.turn.activation;
  const continuing = !!act && act.playerId === p.id;
  const opts: Array<['razzleDazzle' | 'grudgeMatch' | 'setPiece', string]> = [];
  if (!continuing && E.desperateLeft(g, p.team, 'razzleDazzle') && d.action !== 'special') opts.push(['razzleDazzle', 'Razzle-Dazzle: a second, different Action this activation (not two with a Move)']);
  if (!continuing && d.action === 'foul' && E.desperateLeft(g, p.team, 'grudgeMatch')) opts.push(['grudgeMatch', 'Grudge Match: Foul even if the team already did, and no Sent-off']);
  if (d.action === 'pass' && !d.hailMary && E.desperateLeft(g, p.team, 'setPiece')) opts.push(['setPiece', 'Set Piece: Accurate on any 2+, caught on any 2+']);
  if (!opts.length) return null;
  return h(
    'div',
    { class: 'desperate small', id: `desperate-controls${idSuffix}` },
    h('span', { class: 'muted' }, 'Desperate Measure (once per game): '),
    opts.map(([id, lbl]) =>
      h(
        'label',
        { class: 'check', title: E.DESPERATE[E.DESPERATE_NUMBER[id]].text },
        h('input', { type: 'checkbox', 'data-desperate': id, checked: d.desperate === id, onchange: (e: Event) => app.updateDraft({ desperate: (e.target as HTMLInputElement).checked ? id : undefined }) }),
        ` ${lbl}`,
      ),
    ),
  );
}

export function draftSkillControls(app: App): HTMLElement | null {
  const d = app.st.draft;
  if (!d) return null;
  const p = app.player(d.playerId);
  if (!p) return null;
  if (d.action === 'special' && (d.special === 'punt' || d.special === 'ballAndChain')) {
    const oppRight = p.team === 'A';
    const what = d.special === 'punt' ? 'Punt' : 'Ball & Chain';
    const dirs: Array<[Facing, string]> = [
      ['x-', `◀ ${oppRight ? 'own' : 'opposition'} End Zone`],
      ['x+', `▶ ${oppRight ? 'opposition' : 'own'} End Zone`],
      ['y-', '▲ top Sideline'],
      ['y+', '▼ bottom Sideline'],
    ];
    return h(
      'div',
      { class: 'seg puntfacing', id: d.special === 'punt' ? 'punt-facing' : 'chain-facing' },
      h('span', { class: 'small muted' }, `${what}: the Throw-in Template faces `),
      dirs.map(([f, lbl]) => h('button', { class: `segbtn ${d.facing === f ? 'on' : ''}`, 'data-facing': f, 'aria-label': `${what} ${E.board.FACING_LABEL[f]}`, onclick: () => app.updateDraft({ facing: d.facing === f ? undefined : f }) }, lbl)),
    );
  }
  // V5: a Star Player's rule used at the start of this activation (the choices are asked when it is carried out).
  const info = E.startRuleInfo(p);
  const act0 = app.game.turn.activation;
  if (info && !info.ends && !(act0 && act0.playerId === p.id) && (!info.actions || info.actions.includes(d.action)) && (!info.special || info.special === d.special)) {
    const why = E.startRuleReason(app.game, p, d.action, d.special as never);
    return h(
      'label',
      { class: 'small check', id: 'star-rule-toggle', title: `${info.name}: ${info.summary}` },
      h('input', { type: 'checkbox', checked: !!d.starRule && !why, disabled: !!why, onchange: (e: Event) => app.updateDraft({ starRule: (e.target as HTMLInputElement).checked || undefined }) }),
      ` ★ ${info.name} at the start of this activation${why ? ` — ${why}` : ` (${info.summary})`}`,
    );
  }
  if (d.action === 'move' && E.canUse(p, 'fumblerooski') && !E.gated('fumblerooski') && app.game.ball.kind === 'held' && app.game.ball.playerId === p.id && p.pos) {
    return h(
      'label',
      { class: 'small check', id: 'fumblerooski' },
      h('input', { type: 'checkbox', checked: !!d.leaveBall, onchange: (e: Event) => app.updateDraft({ leaveBall: (e.target as HTMLInputElement).checked || undefined }) }),
      ` Fumblerooski: leave the ball in ${E.board.fmt(p.pos)} as the move starts (no Turnover, p.128)`,
    );
  }
  return null;
}

function instructions(app: App): HTMLElement {
  const d = app.st.draft;
  if (!d) return h('div');
  const g = app.game;
  const p = app.player(d.playerId);
  const lines: (string | HTMLElement)[] = [];
  const act = g.turn.activation;
  const continuing = act?.playerId === d.playerId;
  if (d.action !== 'block') lines.push('Click squares to build the path — a route may come back through earlier squares, even the start. Backspace takes back the last click (a whole automatic route at once); Cancel drops the plan.');
  if (p?.stance === 'prone' && d.action !== 'block') lines.push(E.canUse(p, 'jumpUp') ? 'The player is Prone and stands up for free (Jump Up).' : p.ma <= 2 ? 'The player is Prone: standing up needs a 4+ (MA 2 or less) and uses all their MA.' : 'The player is Prone: standing up costs 3 squares of movement.');
  if (d.action === 'block') lines.push('Click an adjacent Standing opponent to Block.');
  if (d.action === 'block' && p && E.canUse(p, 'multipleBlock') && !E.gated('multipleBlock'))
    lines.push(d.blockTarget2 ? 'Multiple Block: both targets are Blocked at ST −2, without Follow-up. Click the second target again to Block only one.' : 'Multiple Block (p.132): click a second adjacent opponent to Block both at once (ST −2 for both Blocks, no Follow-up).');
  if (d.action === 'blitz') lines.push(continuing ? 'After the Block you may keep moving with any movement left.' : 'Click the opponent you want to Blitz (the declared target), then path next to them; the Block costs 1 square of movement.');
  if (d.action === 'pass') lines.push('Click a team-mate to throw to them, or switch clicks to “target” to aim at any square.');
  if (d.action === 'handoff') lines.push('Finish next to a Standing team-mate, then click them to hand off.');
  if (d.action === 'secure') lines.push('End the move on the loose ball; then a D6 2+ picks it up (no Agility Test).');
  if (d.action === 'ttm') lines.push(d.thrownPlayerId ? 'Switch clicks to “target” and click the square to throw to (Quick or Short range only, p.76).' : 'Move next to a team-mate with Right Stuff if needed, then click them to pick who is thrown.');
  const SPECIAL_HELP: Record<string, string> = {
    projectileVomit: 'Click an adjacent Standing opponent to Projectile Vomit on (D6 2+: an Armour Roll against them; on a 1 against your player, p.133).',
    stab: 'Click an adjacent Standing opponent to Stab: an Armour Roll that cannot be modified, an Injury Roll if it breaks (p.136).',
    chainsaw: 'Click an adjacent Standing opponent: D6, on a 1 Kick-back (your player is Knocked Down), otherwise an Armour Roll +3 against them (p.126).',
    breatheFire: 'Click a Standing opponent your player Marks: D6 (−1 against ST 5+) — 1 your player is Knocked Down, 2-3 nothing, 4+ they are Placed Prone, a natural 6 Knocks them Down (p.126).',
    monstrousMouth: 'Click a Standing opponent your player Marks to Chomp: D6 3+ — they cannot leave their square while your player Marks them (p.131).',
    hypnoticGaze: 'Move first if you like (click squares), then click an adjacent Standing opponent: D6 3+ — they are Distracted; the activation ends either way (p.129).',
    bombardier: 'Click the target square (no move first). The bomb is thrown like a Pass (range, Passing Ability Test, Interceptions); where it comes to rest it explodes: the player there is hit, each adjacent player on 4+ (Standing → Knocked Down, others an Armour Roll). A caught bomb is thrown again at once (p.125).',
    ballAndChain: 'Choose which way the Throw-in Template faces, then Confirm: a D6 moves the player one square (1-2 / 3-4 / 5-6); a Standing player there is Blocked, a fallen one Pushed Back with an Armour Roll. One step per Confirm, up to MA (then Rushes); the next step is planned with the same facing (p.124).',
    kickTeamMate: 'Like Throw Team-mate (p.130): move first if you like, click the team-mate with Right Stuff to kick, then switch clicks to “target” and click the square. It does not use the team\'s Throw Team-mate Action; a Fumbled kick is an Injury Roll for the kicked player.',
  };
  if (d.action === 'special' && SPECIAL_HELP[d.special ?? 'projectileVomit']) lines.push(SPECIAL_HELP[d.special ?? 'projectileVomit']);
  if (d.action === 'special' && d.special === 'punt')
    lines.push('Punt (p.134): move first if you like (click squares), then choose which way the Throw-in Template faces. A D6 gives the direction, a D6 the distance; a catch or a Bounce where it lands. No Turnover if it ends on the ground — only if an opponent has it or it went into the crowd.');
  if (d.action === 'foul') lines.push(d.foulTarget ? 'The Foul is an Armour Roll with +1 per Offensive and −1 per Defensive Assist. A natural double on the Armour or Injury Roll gets your player Sent-off after the Foul (a Turnover, p.69).' : 'Click the Prone or Stunned opponent to foul — a route next to them is planned — or build the path first.');
  if (d.auto) lines.push(`Auto-route: ${d.path.length} square${d.path.length === 1 ? '' : 's'} with ${d.auto.dodges} Dodge${d.auto.dodges === 1 ? '' : 's'} and ${d.auto.rushes} Rush${d.auto.rushes === 1 ? '' : 'es'} — the lowest-risk way there${d.auto.detour ? ' (a detour: the shortest way is riskier)' : ''}.${d.auto.pSafe < 1 ? ' Those rolls cannot be avoided on any route with this movement.' : ''} Backspace takes this route back.`);
  const box = h('div', { class: 'instructions small' }, h('ul', null, lines.map((l) => h('li', null, l))));
  const sk = draftSkillControls(app);
  if (sk) box.appendChild(sk);
  const dm = app.st.stage === 'plan' ? desperateControls(app) : null;
  if (dm) box.appendChild(dm);
  const jc = app.st.stage === 'plan' ? jumpControl(app) : null;
  if (jc) box.appendChild(h('div', { class: 'btnrow tight' }, jc, h('span', { class: 'small muted' }, d.jumpMode ? 'Highlighted: where the jump can land, with the Agility Test (J = Jump, L = Leap, P = Pogo; R = Rushes first).' : 'A Jump or Leap is possible from the end of the route.')));
  if (d.jumpMode && app.st.stage === 'plan') {
    // V5.5: each landing square with its cost, modifiers and chance; a failed test is a Turnover (a natural 1 falls
    // in the square left, any other failure in the landing square, p.56).
    const js = draftJumps(app);
    const name = { jump: 'Jump', leap: 'Leap', pogo: 'Pogo' } as const;
    box.appendChild(
      h(
        'ul',
        { class: 'small jumplist', id: 'jump-list' },
        js.map((j) => {
          const m = j.mods.reduce((a, x) => a + x.value, 0);
          const need = Math.max(2, Math.min(6, j.target - m));
          const pAll = j.pTest * j.pRushes;
          return h(
            'li',
            { 'data-jump': `${j.to.x},${j.to.y}` },
            `${name[j.kind]} ${E.board.fmt(j.to)} over ${E.board.fmt(j.over)}: 2 squares of movement${j.rushes ? ` (${j.rushes} Rush${j.rushes > 1 ? 'es' : ''} first, ${pct(j.pRushes)})` : ''}; Agility ${j.target}+${j.mods.map((x) => ` ${x.value > 0 ? '+' : ''}${x.value} ${x.label}`).join(',')} → needs ${need}+ = ${pct(j.pTest)}. Succeeds ${pct(pAll)}, Turnover ${pct(1 - pAll)} (no re-rolls counted).`,
          );
        }),
      ),
    );
  }
  if (d.action === 'ttm' || (d.action === 'special' && d.special === 'kickTeamMate')) {
    box.appendChild(
      h(
        'div',
        { class: 'seg' },
        h('span', { class: 'small muted' }, 'Clicks set: '),
        h('button', { class: `segbtn ${d.clickMode === 'path' ? 'on' : ''}`, onclick: () => app.updateDraft({ clickMode: 'path' }) }, 'Path / thrown player'),
        h('button', { class: `segbtn ${d.clickMode === 'target' ? 'on' : ''}`, onclick: () => app.updateDraft({ clickMode: 'target' }) }, 'Throw target'),
      ),
    );
  }
  if (d.action === 'blitz' && p) {
    // Special Actions that may replace the Block of a Blitz (PV p.133, Stab p.136, Chainsaw p.126, Breathe Fire p.126, Chomp p.131).
    const alts = (['projectileVomit', 'stab', 'chainsaw', 'breatheFire', 'monstrousMouth'] as const).filter((id) => E.hasSkill(p, E.SPECIALS[id].skill));
    if (alts.length) {
      const cur = d.special ?? (d.vomitTarget ? 'projectileVomit' : '');
      box.appendChild(
        h(
          'label',
          { class: 'small check', id: 'blitz-special' },
          ' Instead of the Block: ',
          h(
            'select',
            { class: 'small', onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; app.updateDraft({ special: v || undefined, vomitTarget: undefined }); } },
            h('option', { value: '', selected: !cur }, 'Block'),
            alts.map((id) => h('option', { value: id, selected: cur === id }, `${E.SPECIALS[id].name} (p.${E.SPECIALS[id].page})`)),
          ),
        ),
      );
    }
  }
  if (d.action === 'special' && d.special === 'bombardier' && p && E.canUse(p, 'hailMaryPass')) {
    box.appendChild(h('label', { class: 'small check' }, h('input', { type: 'checkbox', checked: !!d.hailMary, onchange: (e: Event) => app.updateDraft({ hailMary: (e.target as HTMLInputElement).checked }) }), ' Hail Mary Pass (the bomb)'));
  }
  if (d.action === 'pass') {
    box.appendChild(
      h(
        'div',
        { class: 'seg' },
        h('span', { class: 'small muted' }, 'Clicks set: '),
        h('button', { class: `segbtn ${d.clickMode === 'path' ? 'on' : ''}`, onclick: () => app.updateDraft({ clickMode: 'path' }) }, 'Path'),
        h('button', { class: `segbtn ${d.clickMode === 'target' ? 'on' : ''}`, onclick: () => app.updateDraft({ clickMode: 'target' }) }, 'Pass target'),
        p && E.canUse(p, 'hailMaryPass')
          ? h('label', { class: 'small check' }, h('input', { type: 'checkbox', checked: !!d.hailMary, onchange: (e: Event) => app.updateDraft({ hailMary: (e.target as HTMLInputElement).checked }) }), ' Hail Mary Pass')
          : null,
      ),
    );
  }
  if (d.action === 'block' || d.action === 'blitz') {
    box.appendChild(
      h('label', { class: 'small check' }, h('input', { type: 'checkbox', checked: app.st.followUp, onchange: (e: Event) => { app.st.followUp = (e.target as HTMLInputElement).checked; app.recomputePlan(); } }), ' Preview assumes I follow up after a push'),
    );
  }
  return box;
}

function stepRows(steps: StepRecord[], app: App) {
  if (!steps.length) return h('p', { class: 'muted small' }, 'No dice are needed for this plan.');
  const rows = steps.map((st, i) => {
    if (st.kind === 'block') {
      const ex = st.extra as { dice: number; chooser: string; attST: number; defST: number; offAssists: number; defAssists: number };
      return h(
        'tr',
        { class: 'blockrow' },
        h('td', null, String(i + 1)),
        h('td', null, st.label, ' ', ruleTag(st.rule)),
        h('td', null, `${ex.dice} block ${ex.dice === 1 ? 'die' : 'dice'}`),
        h('td', { colspan: 4 }, `ST ${ex.attST} vs ${ex.defST} (${ex.offAssists} off. / ${ex.defAssists} def. assist${ex.defAssists === 1 ? '' : 's'}); ${ex.dice === 1 ? 'single die' : ex.chooser === 'attacker' ? 'you choose the result' : 'the defender chooses'} — see block analysis`),
      );
    }
    const mods = st.mods.length ? st.mods.map((m) => `${m.value >= 0 ? '+' : ''}${m.value} ${m.label}`).join(', ') : '—';
    const dt = st.extra && typeof st.extra.pIfDivingTackle === 'number' ? h('div', { class: 'small warn' }, `If Diving Tackle is used: ${pct(st.extra.pIfDivingTackle as number)}`) : null;
    if (st.by === 'opponent') {
      return h(
        'tr',
        { class: 'opprow' },
        h('td', null, String(i + 1)),
        h('td', null, h('span', { class: 'opptag' }, 'Opponent'), ' ', st.label, ' ', ruleTag(st.rule)),
        h('td', null, st.dice),
        h('td', { class: 'num' }, st.target !== undefined ? `${st.target}+` : '—'),
        h('td', { class: 'small' }, mods),
        h('td', { class: 'num strong bad' }, pct(st.pSingle ?? NaN)),
        h('td', { class: 'small muted' }, `chance it succeeds (bad for you) — fails ${pct(1 - (st.pSingle ?? NaN))}`),
      );
    }
    return h(
      'tr',
      null,
      h('td', null, String(i + 1)),
      h('td', null, st.label, ' ', ruleTag(st.rule), dt),
      h('td', null, st.dice),
      h('td', { class: 'num' }, st.target !== undefined ? `${st.target}+` : '—'),
      h('td', { class: 'small' }, mods),
      h('td', { class: 'num strong' }, pct(st.pSingle ?? NaN)),
      h('td', { class: 'small' }, st.pWithReroll !== undefined ? h('span', null, h('b', null, pct(st.pWithReroll)), h('div', { class: 'muted' }, st.rerolls.join(' / '))) : h('span', { class: 'muted' }, 'no re-roll')),
    );
  });
  void app;
  return h(
    'div',
    { class: 'tablewrap' },
    h(
      'table',
      { class: 'steps' },
      h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Step'), h('th', null, 'Dice'), h('th', null, 'Need'), h('th', null, 'Modifiers'), h('th', null, 'Chance'), h('th', null, 'If re-rolled'))),
      h('tbody', null, rows),
    ),
  );
}

function bar(p: number, cls = '') {
  return h('span', { class: `bar ${cls}` }, h('span', { style: `width:${Math.max(0, Math.min(1, p)) * 100}%` }));
}

function outcomeRow(label: string, a: number | undefined, b: number | undefined, cls = '', showB = true) {
  return h('tr', { class: cls }, h('td', null, label), h('td', { class: 'num' }, a === undefined ? '—' : pct(a)), showB ? h('td', { class: 'num' }, b === undefined ? '—' : pct(b)) : null, h('td', null, bar(a ?? 0, cls)));
}

function unresolvedNote(s: OutcomeSummary | null) {
  if (!s || s.unresolved < 1e-12) return null;
  const u = s.unresolved * 100;
  const txt = u >= 0.01 ? `${u.toFixed(2)}%` : `${u.toPrecision(2)}%`;
  return h('p', { class: `small ${u >= 0.05 ? 'warn' : 'muted'}` }, `Exact to within ${txt}: that share of outcomes (extremely long chains of bounces or throw-ins) was not enumerated, so any figure could be up to that much higher. Nothing is estimated.`);
}

function renderOutcomes(app: App, plan: PlanResult): HTMLElement {
  const wo = plan.withoutTeamRerolls;
  const w = plan.withTeamRerolls;
  const g = app.game;
  const tr = g.teams[g.turn.active].rerolls + (g.teams[g.turn.active].leaderReroll ? 1 : 0);
  const showB = tr > 0;
  const input = plan.input;
  const rows: HTMLElement[] = [];
  if (!wo || !w) return h('div');
  rows.push(outcomeRow('Action completes as planned', wo.pCompleted, w.pCompleted, 'good', showB));
  rows.push(outcomeRow('Turnover', wo.pTurnover, w.pTurnover, 'bad', showB));
  if (wo.pTouchdownActive > 0 || w.pTouchdownActive > 0) rows.push(outcomeRow('Touchdown (your team)', wo.pTouchdownActive, w.pTouchdownActive, 'good', showB));
  if (wo.pTouchdownOpp > 0) rows.push(outcomeRow('Touchdown for the opponent', wo.pTouchdownOpp, w.pTouchdownOpp, 'bad', showB));
  if (wo.pActorFell > 0) rows.push(outcomeRow('Your player falls over', wo.pActorFell, w.pActorFell, 'bad', showB));
  if (wo.pActorDown > 0) rows.push(outcomeRow('Your player ends on the ground / off the pitch', wo.pActorDown, w.pActorDown, 'bad', showB));
  if (wo.pActorRemoved > 0) rows.push(outcomeRow('…and is KO’d / a Casualty / in the crowd', wo.pActorRemoved, w.pActorRemoved, 'bad', showB));
  const isBlock = input.kind === 'playerAction' && !!(input.blockTarget || input.foulTarget || input.specialTarget || input.vomitTarget);
  if (isBlock) {
    rows.push(outcomeRow('Target ends on the ground / off the pitch', wo.pTargetDown, w.pTargetDown, 'good', showB));
    rows.push(outcomeRow('Target’s armour broken', wo.pTargetArmourBroken, w.pTargetArmourBroken, 'good', showB));
    rows.push(outcomeRow('Target KO’d', wo.pTargetKO, w.pTargetKO, 'good', showB));
    rows.push(outcomeRow('Target a Casualty', wo.pTargetCas, w.pTargetCas, 'good', showB));
    if (wo.pTargetCrowd > 0) rows.push(outcomeRow('Target pushed into the crowd', wo.pTargetCrowd, w.pTargetCrowd, 'good', showB));
    if (input.kind === 'playerAction' && input.blockTarget2) rows.push(outcomeRow('Second target (Multiple Block) ends on the ground / off the pitch', wo.pTarget2Down, w.pTarget2Down, 'good', showB));
  }
  const ballInvolved = g.ball.kind !== 'none';
  if (ballInvolved) {
    rows.push(outcomeRow('Your team holds the ball afterwards', wo.pActiveHasBall, w.pActiveHasBall, '', showB));
    if (wo.pOppHasBall > 0 || w.pOppHasBall > 0) rows.push(outcomeRow('Opponent holds the ball', wo.pOppHasBall, w.pOppHasBall, 'bad', showB));
    rows.push(outcomeRow('Ball loose on the ground', wo.pBallGround, w.pBallGround, '', showB));
    if (input.kind === 'playerAction' && (input.passTarget || input.handoffTarget)) rows.push(outcomeRow('Intended receiver has the ball', wo.pBallWithReceiver, w.pBallWithReceiver, 'good', showB));
    if (wo.pIntercepted > 0) rows.push(outcomeRow('Pass intercepted', wo.pIntercepted, w.pIntercepted, 'bad', showB));
  }
  const table = h(
    'table',
    { class: 'outcomes' },
    h('thead', null, h('tr', null, h('th', null, 'Outcome'), h('th', null, 'No Team Re-rolls'), showB ? h('th', null, `Using Team Re-rolls (${tr})`) : null, h('th', null, ''))),
    h('tbody', null, rows),
  );
  const falls = Object.entries(wo.fallSquares).filter(([, v]) => v > 1e-9);
  return h(
    'div',
    null,
    table,
    falls.length ? h('p', { class: 'small muted' }, 'Where your player can fall (no Team Re-rolls): ', falls.map(([k, v]) => `${k} ${pct(v)}`).join(' · ')) : null,
    unresolvedNote(wo),
    h('p', { class: 'small muted' }, `Computed by enumerating ${w.leaves.toLocaleString()} distinct dice outcomes with the same rules code that executes the action.`),
  );
}

function combineBox(plan: PlanResult) {
  const d6 = plan.steps.filter((s0): s0 is StepRecord & { pSingle: number } => s0.kind !== 'block' && s0.pSingle !== null);
  if (!d6.length || !plan.withoutTeamRerolls || !plan.withTeamRerolls) return null;
  const good = (s0: StepRecord & { pSingle: number }) => (s0.by === 'opponent' ? 1 - s0.pSingle : s0.pSingle);
  const prod = d6.reduce((a, s0) => a * good(s0), 1);
  const hasBlock = plan.steps.some((s0) => s0.kind === 'block');
  return h(
    'div',
    { class: 'combine' },
    h('div', null, h('span', { class: 'muted' }, hasBlock ? 'All dice rolls before the Block go your way first time: ' : 'Every roll goes your way first time (product of the chances): '), h('b', null, pct(prod)), ' = ', d6.map((s0) => (s0.by === 'opponent' ? `(1 − ${pct(s0.pSingle, 1)})` : pct(s0.pSingle, 1))).join(' × ')),
    h('div', null, h('span', { class: 'muted' }, 'Exactly, using free skill re-rolls and Pro but no Team Re-roll: '), h('b', null, pct(plan.withoutTeamRerolls.pCompleted))),
    plan.teamRerollsAvailable > 0 ? h('div', null, h('span', { class: 'muted' }, 'Exactly, also spending Team Re-rolls on failures (Loner checks included): '), h('b', null, pct(plan.withTeamRerolls.pCompleted))) : null,
  );
}

function renderBlockAnalysis(plan: PlanResult) {
  const b = plan.block;
  if (!b) return null;
  const order: Array<keyof typeof b.atLeastOne> = ['pow', 'stumble', 'push', 'bothDown', 'playerDown'];
  return h(
    'div',
    { class: 'blockbox' },
    h('h4', null, `Block: ${b.dice} ${b.dice === 1 ? 'die' : 'dice'} — ${b.dice === 1 ? 'no choice' : b.chooser === 'attacker' ? 'you choose' : 'the defender chooses'}`),
    h('p', { class: 'small muted' }, `Strength ${b.attST} vs ${b.defST} (${b.offAssists} offensive, ${b.defAssists} defensive assists). ${b.dice === 3 ? 'Over double: 3 dice.' : ''}`),
    h(
      'table',
      { class: 'steps' },
      h('thead', null, h('tr', null, h('th', null, 'Face'), h('th', null, 'At least one shows it'), h('th', null, b.dice === 1 ? 'Result' : `Chosen if ${b.chooser === 'attacker' ? 'you pick' : 'the defender picks'} the best`), h('th', null, 'Effect here'))),
      h(
        'tbody',
        null,
        order.map((f) =>
          h(
            'tr',
            null,
            h('td', null, h('span', { class: `bdie small f-${f}` }, FACE_GLYPH[f]), ' ', E.BLOCK_FACE_LABEL[f]),
            h('td', { class: 'num' }, pct(b.atLeastOne[f])),
            h('td', { class: 'num' }, f === 'stumble' ? h('span', { class: 'muted' }, 'counted as ↓') : pct(b.chosen[f] ?? 0)),
            h('td', { class: 'small' }, b.faceNotes[f]),
          ),
        ),
      ),
    ),
    h('p', { class: 'small muted' }, 'The “chosen” column is conditional on the stated preference for picking dice (see assumptions). Stumble is shown under the result it turns into.'),
  );
}

function renderPassAnalysis(plan: PlanResult) {
  const p = plan.pass;
  if (!p) return null;
  const m = p.mods.length ? p.mods.map((x) => `${x.value >= 0 ? '+' : ''}${x.value} ${x.label}`).join(', ') : 'no modifiers';
  return h(
    'div',
    { class: 'blockbox' },
    h('h4', null, `${p.range} to ${E.board.fmt(p.target)}`),
    h('p', { class: 'small' }, `Passing Ability ${p.pa}+ with ${m}.`, ' ', ruleTag({ page: 71, title: 'Test for Accuracy' })),
    h(
      'table',
      { class: 'outcomes' },
      h('tbody', null, outcomeRow(p.hailMary ? 'Lands inaccurately (Hail Mary)' : 'Accurate', p.hailMary ? p.pInaccurate : p.pAccurate, undefined, 'good', false), p.hailMary ? null : outcomeRow('Inaccurate → Scatter (3)', p.pInaccurate, undefined, '', false), outcomeRow('Fumbled → Turnover', p.pFumble, undefined, 'bad', false)),
    ),
    p.hailMary
      ? h('p', { class: 'small muted' }, 'A Hail Mary Pass cannot be Intercepted (p.129).')
      : p.interceptorsIfAccurate.length
        ? h('p', { class: 'small' }, 'Under the Range Ruler (can try to Intercept an accurate pass): ', p.interceptorsIfAccurate.map((i) => `${i.label} ${pct(i.p)}`).join(', '), '. For an inaccurate pass the ruler is re-laid to where the ball lands (−2 instead of −3).')
        : h('p', { class: 'small muted' }, 'No opposition player is under the Range Ruler for an accurate pass.'),
  );
}

function renderPlan(app: App): HTMLElement {
  const d = app.st.draft;
  const g = app.game;
  const card = h('div', { class: 'card plan' });
  if (!d) return card;
  const p = app.player(d.playerId);
  const plan = app.st.plan;
  const review = app.st.stage === 'review';
  card.appendChild(stepper(app.st.stage));
  card.appendChild(h('h3', null, `${ACTION_NAMES[d.action]} — ${p ? E.label(p) : ''}`));
  if (!review) card.appendChild(instructions(app));
  if (app.st.planBusy && (!plan || app.st.planKey !== JSON.stringify({ input: app.draftInput(), f: app.st.followUp }))) {
    card.appendChild(h('p', { class: 'muted' }, 'Computing exact probabilities…'));
  }
  if (plan && !plan.ok) {
    card.appendChild(h('div', { class: 'errors' }, h('b', null, 'This plan cannot be executed:'), h('ul', null, plan.errors.map((e) => h('li', null, e)))));
    if (plan.endsHungry?.turnover) card.appendChild(h('div', { class: 'btnrow' }, endHungryButton(app, plan.endsHungry.playerId, 'end-hungry')));
  }
  if (plan?.ok && plan.endsHungry) card.appendChild(h('p', { class: 'small note' }, plan.endsHungry.text));
  if (plan?.ok) {
    const wo = plan.withoutTeamRerolls;
    const w = plan.withTeamRerolls;
    const tr = g.teams[g.turn.active].rerolls;
    card.appendChild(
      h(
        'div',
        { class: 'headline' },
        h('div', { class: 'big' }, pct(wo?.pCompleted ?? 0)),
        h('div', null, h('div', null, 'chance the action completes as planned'), h('div', { class: 'small muted' }, 'with skill re-rolls/Pro, no Team Re-rolls', tr > 0 && w ? ` · ${pct(w.pCompleted)} if you also use Team Re-rolls` : '')),
        h('div', { class: 'risk' }, h('div', { class: 'small muted' }, 'Turnover'), h('b', null, pct(wo?.pTurnover ?? 0))),
      ),
    );
    card.appendChild(h('h4', null, 'Steps and dice'));
    card.appendChild(stepRows(plan.steps, app));
    if (review) {
      const cb = combineBox(plan);
      if (cb) card.appendChild(cb);
      const ba = renderBlockAnalysis(plan);
      if (ba) card.appendChild(ba);
      const pa = renderPassAnalysis(plan);
      if (pa) card.appendChild(pa);
      card.appendChild(h('h4', null, 'Outcomes and branches'));
      card.appendChild(renderOutcomes(app, plan));
      card.appendChild(h('details', { class: 'assume', open: true }, h('summary', null, 'Assumptions behind these numbers'), h('ul', null, plan.assumptions.map((a) => h('li', null, a)))));
    } else {
      const pa = renderPassAnalysis(plan);
      if (pa) card.appendChild(pa);
    }
  }
  const btns = h('div', { class: 'btnrow sticky' });
  if (!review) {
    btns.appendChild(h('button', { class: 'btn primary', id: 'execute-plan', disabled: !plan?.ok || app.st.planBusy, onclick: () => app.confirmNow() }, 'Execute now'));
    btns.appendChild(h('button', { class: 'btn', disabled: !plan?.ok || app.st.planBusy, onclick: () => app.review() }, 'Details'));
  } else {
    btns.appendChild(h('button', { class: 'btn primary', disabled: !plan?.ok || app.st.planBusy, onclick: () => app.confirmNow(), id: 'confirm-btn' }, 'Execute now'));
    btns.appendChild(h('button', { class: 'btn', onclick: () => app.backToPlan() }, '← Edit plan'));
  }
  btns.appendChild(h('button', { class: 'btn ghost', onclick: () => app.cancelDraft() }, 'Cancel plan'));
  card.appendChild(btns);
  card.appendChild(h('p', { class: 'small muted' }, 'Planning never rolls dice, spends re-rolls or changes the game. Cancel returns to exactly the same position.'));
  return card;
}

/** V5: a Star Player's chip on the player card — the special rule and whether it is still available (stars.ts). */
function starChip(g: GameState, p: Player): HTMLElement {
  const st = E.STAR_BY_ID[p.star as string];
  if (!st) return h('span', { class: 'variant-chip' }, 'STAR PLAYER');
  const per = st.rule.per === 'game' ? 'once per game' : st.rule.per === 'half' ? 'once per half' : st.rule.per === 'drive' ? 'once per Drive' : st.rule.per === 'activation' ? 'once per activation' : 'whenever it applies';
  const ready = st.rule.per === 'always' || E.starReady(g, p, st.id);
  return h('span', { class: `variant-chip star-chip${ready ? '' : ' used'}`, title: `Star Player — ${st.rule.name} (${per}, p.${st.page}): ${st.rule.summary}` }, ready ? `STAR · ${st.rule.name}` : `STAR · ${st.rule.name} (used)`);
}
