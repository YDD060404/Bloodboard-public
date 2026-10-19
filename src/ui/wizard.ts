/**
 * V5 step 6: the Sports-Wizard in the interface (p.149), in the same plan → review → confirm flow as an action:
 *  1. plan: choose the spell on the match card, then click the square (Fireball) or the player (Zap!) on the pitch;
 *  2. review: the card lists who can be hit and the exact chances (and the area is marked on the pitch);
 *  3. confirm: "Cast" — or, during your own Turn, "End the Turn and cast" (the spell comes at the end of the Turn,
 *     before the next Turn begins); the dice are shown in the dice tray like any other roll.
 * The computer casts its own Wizard by itself (see src/ai/brain.ts wizardChoice).
 */
import type { Coord, GameState, TeamId } from '../engine/index';
import type { App, WizardDraft } from './app';
import { computerOf } from './computer';
import { h } from './dom';
import { E } from './engine-global';
import type { Marks } from './pitch';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Can the human coach of `t` plan a spell now, and when would it be cast? */
function wizardWhen(g: GameState, t: TeamId): 'now' | 'afterTurn' | null {
  if (E.induceLeft(g, t, 'wizard') < 1) return null;
  if (!E.wizardReason(g, t)) return 'now';
  // During your own Turn: end it, then cast (the gap before the next Turn).
  if (g.phase === 'play' && !g.pending && !g.match?.pendingPhase && g.turn.active === t) return 'afterTurn';
  return null;
}

/** The Wizard lines of the match card (one per human team that still has its Wizard). */
export function renderWizardControls(app: App): HTMLElement | null {
  const g = app.game;
  if (!g.match || g.pending || app.playbackActive()) return null;
  const cpu = computerOf(app)?.team;
  const teams = (['A', 'B'] as TeamId[]).filter((t) => t !== cpu && E.induceLeft(g, t, 'wizard') > 0);
  if (!teams.length) return null;
  const box = h('div', { class: 'wizardbox', id: 'wizard' });
  const d = app.st.wizardDraft;
  for (const t of teams) {
    const when = wizardWhen(g, t);
    if (!when) continue;
    const name = g.teams[t].name;
    if (!d || d.team !== t) {
      const start = (spell: 'fireball' | 'zap') => {
        app.st.wizardDraft = { team: t, spell, when };
        app.emit();
      };
      box.appendChild(
        h(
          'div',
          { class: 'btnrow small' },
          h('span', null, `${name} — Sports-Wizard (once per game, p.149), ${when === 'now' ? 'between Turns now' : 'at the end of this Turn'}: `),
          h('button', { class: 'btn small', id: `wizard-fireball-${t}`, onclick: () => start('fireball') }, 'Fireball…'),
          h('button', { class: 'btn small', id: `wizard-zap-${t}`, onclick: () => start('zap') }, 'Zap!…'),
        ),
      );
      continue;
    }
    box.appendChild(reviewCard(app, g, d));
  }
  return box.childNodes.length ? box : null;
}

function reviewCard(app: App, g: GameState, d: WizardDraft): HTMLElement {
  const lines: HTMLElement[] = [];
  const title = d.spell === 'fireball' ? 'Fireball' : 'Zap!';
  let ready = false;
  if (d.spell === 'fireball') {
    if (!d.square) lines.push(h('p', { class: 'small' }, 'Click the square on the pitch the Fireball is aimed at: every player in it or next to it is hit on a 4+ (D6).'));
    else {
      ready = true;
      const hit = E.fireballTargets(g, d.square);
      // A hit is good for the wizard's side on an opponent, bad on a team-mate (difficulty house rule: judged the same way).
      const p4For = (q: { team: string }) => { const w = E.testWeights(g, d.team, (f: number) => (f >= 4) === (q.team !== d.team)); return w ? w[3] + w[4] + w[5] : 0.5; };
      lines.push(h('p', { class: 'small' }, `Fireball at ${E.board.fmt(d.square)}: ${hit.length ? `${hit.length} player${hit.length === 1 ? '' : 's'} in the area` : 'nobody in the area'}.`));
      if (hit.length)
        lines.push(
          h(
            'ul',
            { class: 'small wizardlist' },
            hit.map((q) => h('li', null, `${q.team === d.team ? '(yours) ' : ''}${E.label(q)} — hit ${pct(p4For(q))}: ${q.stance === 'standing' ? 'Knocked Down' : `${q.stance === 'prone' ? 'Prone' : 'Stunned'}: an Armour Roll`}, +1 to the Armour Roll (AV ${q.av}+)${E.ballHolder(g)?.id === q.id ? '; the ball bounces' : ''}`)),
          ),
        );
    }
  } else {
    const q = d.target ? E.findPlayer(g, d.target) : undefined;
    if (!q) lines.push(h('p', { class: 'small' }, 'Click the player on the pitch to Zap!: a D6 equal to or higher than their ST (or a 6, never a 1) turns them into a Frog until the end of the Drive.'));
    else {
      ready = true;
      const zap = (f: number) => f === 6 || (f !== 1 && f >= q.st);
      const pz = E.zapChance(q, E.testWeights(g, d.team, (f: number) => zap(f) === (q.team !== d.team)));
      lines.push(h('p', { class: 'small' }, `Zap! ${E.label(q)} (ST ${q.st}): ${pct(pz)} to become a Frog (MA 5, ST 1, AG 2+, AV 5+; Dodge, Leap, No Ball, Stunty, Titchy, Very Long Legs)${E.ballHolder(g)?.id === q.id ? ' — the ball would bounce' : ''}.`));
    }
  }
  const confirm = () => {
    const draft = { ...d };
    if (draft.when === 'afterTurn') {
      app.runSimple({ kind: 'endTurn' });
      const why = E.wizardReason(app.game, draft.team, { spell: draft.spell, square: draft.square, target: draft.target });
      if (why) {
        app.toast(`The Turn ended, but the spell could not be cast: ${why}`, 'error');
        return;
      }
    }
    app.runSimple({ kind: 'wizard', team: draft.team, spell: draft.spell, square: draft.square, target: draft.target });
  };
  return h(
    'div',
    { class: 'card wizardreview', id: 'wizard-review' },
    h('div', { class: 'row-between' }, h('b', null, `${g.teams[d.team].name}: Sports-Wizard — ${title}`), h('span', { class: 'small muted' }, 'p.149, once per game')),
    ...lines,
    h(
      'div',
      { class: 'btnrow small' },
      h('button', { class: 'btn small primary', id: 'wizard-cast', disabled: !ready, onclick: confirm }, d.when === 'afterTurn' ? 'End the Turn and cast' : 'Cast'),
      h('button', { class: 'btn small', id: 'wizard-other', onclick: () => { app.st.wizardDraft = { team: d.team, spell: d.spell === 'fireball' ? 'zap' : 'fireball', when: d.when }; app.emit(); } }, d.spell === 'fireball' ? 'Zap! instead' : 'Fireball instead'),
      h('button', { class: 'btn small ghost', id: 'wizard-cancel', onclick: () => { app.st.wizardDraft = null; app.emit(); } }, 'Cancel'),
    ),
  );
}

/** A board click while a spell is planned: the Fireball's square or the Zap!'s player. Returns true when handled. */
export function wizardClick(app: App, c: Coord): boolean {
  const d = app.st.wizardDraft;
  if (!d) return false;
  const g = app.game;
  if (d.spell === 'fireball') {
    d.square = { ...c };
  } else {
    const q = E.playerAt(g, c);
    if (!q) {
      app.toast('Zap!: click a player on the pitch.', 'error');
      return true;
    }
    d.target = q.id;
  }
  app.emit();
  return true;
}

/** Pitch marks for a planned spell. */
export function wizardMarks(app: App): Marks {
  const d = app.st.wizardDraft;
  const marks: Marks = { squares: [] };
  if (!d) return marks;
  const g = app.game;
  if (d.spell === 'fireball' && d.square) {
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const sq = { x: d.square.x + dx, y: d.square.y + dy };
        if (E.board.inBounds(sq)) marks.squares!.push({ c: sq, cls: dx || dy ? 'choice' : 'target', label: dx || dy ? undefined : '✶' });
      }
  }
  if (d.spell === 'zap' && d.target) {
    const q = E.findPlayer(g, d.target);
    if (q?.pos) marks.squares!.push({ c: q.pos, cls: 'target' });
  }
  return marks;
}
