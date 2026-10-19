/**
 * V4 League play: the post-game Star Player Points table and MVP roll
 * (p.96) on the full-time card, and the "Advance" dialog of the team editor
 * (Advancement Table p.97, Skill Table p.121, Characteristic Improvement
 * Table p.97, limits p.37). The rules are the engine's (`advancement.ts`,
 * `spp.ts`); this file only presents them and rolls the dice.
 */
import type { App } from './app';
import { h } from './dom';
import { E, type TeamDef, type TeamPlayerDef } from './engine-global';
import type { AdvancementChoice, AdvKind, CharKey, SkillCat, TeamId } from '../engine/index';
import { shell } from './modals';
import { saveTeam, teamCache } from './teams';

/** A fair die from the browser's cryptographic generator (advancement dice are not part of a match's seeded dice). */
function die(sides: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return 1 + (a[0] % sides);
}

// ---------------------------------------------------------------------------
// Post-game (full time of a League match)
// ---------------------------------------------------------------------------

const nominations = new Map<string, Set<string>>();

function sppText(t: Record<string, number | undefined>): string {
  const parts: string[] = [];
  for (const k of Object.keys(E.SPP_AWARD) as Array<keyof typeof E.SPP_AWARD>) {
    const n = t[k] ?? 0;
    if (n) parts.push(`${n > 1 ? `${n}× ` : ''}${E.SPP_LABEL[k]}`);
  }
  return parts.join(', ');
}

export function renderPostGame(app: App): HTMLElement {
  const g = app.game;
  const m = g.match!;
  const cpu = m.options.computer?.team as TeamId | undefined;
  const box = h('div', { class: 'postgame' }, h('h4', null, 'Post-game: Star Player Points ', h('span', { class: 'muted small' }, '(League, p.96)')));
  const key = E.matchKey(g);
  for (const team of ['A', 'B'] as TeamId[]) {
    const rows = E.postGameSpp(g, team);
    const name = g.teams[team].name;
    box.appendChild(h('div', { class: 'section-label' }, `${name}${cpu === team ? ' (computer)' : ''}`));
    box.appendChild(
      rows.length
        ? h('table', { class: 'roster small sppTable', id: `spp-${team}` }, h('thead', null, h('tr', null, h('th', null, 'Player'), h('th', null, 'Earned'), h('th', null, 'SPP'))), h('tbody', null, rows.map((r) => h('tr', null, h('td', null, `#${r.number} ${r.name}`), h('td', null, sppText(r.tally as Record<string, number>)), h('td', null, String(r.total))))))
        : h('p', { class: 'small muted' }, 'No Star Player Points earned yet.'),
    );
    if (m.mirror?.team === team) {
      box.appendChild(h('p', { class: 'small muted', id: `mirror-${team}` }, `${name} is Player 2’s match copy of the same saved team: nothing from it is added to the saved team.`));
      continue;
    }
    const raised = E.raisedDead(g, team);
    if (raised.length) {
      const def = teamCache.get(m.teamIds[team]);
      const room = !def || def.players.length < 16;
      box.appendChild(
        h(
          'p',
          { class: 'small', id: `raised-${team}` },
          h('b', null, 'Masters of Undeath: '),
          `${raised.map((p) => `#${p.number} ${p.position}`).join(', ')} raised during the game — ${room ? 'hired for free when the SPP are added (it still adds its value to Team Value)' : 'lost: the Team Draft List already has 16 players'} (p.155).`,
        ),
      );
    }
    const mvp = m.mvp?.[team];
    if (mvp) {
      const p = E.getPlayer(g, mvp);
      box.appendChild(h('p', { class: 'small good', id: `mvp-done-${team}` }, `Most Valuable Player: #${p.number} ${p.name} (+4 SPP).`));
      continue;
    }
    const eligible = E.mvpEligible(g, team);
    const nkey = `${key}:${team}`;
    let sel = nominations.get(nkey);
    if (!sel) nominations.set(nkey, (sel = new Set(E.defaultMvpNominees(g, team))));
    const chosen = sel;
    const nominees = eligible.filter((p) => chosen.has(p.id)).map((p) => p.id);
    const roll = h(
      'button',
      {
        class: 'btn small primary',
        id: `mvp-roll-${team}`,
        disabled: !nominees.length || nominees.length > 6,
        onclick: () => app.runSimple({ kind: 'mvp', team, nominees }, cpu === team ? 'computer' : 'human'),
      },
      `Roll D6 for ${name}'s MVP`,
    );
    if (cpu === team) {
      box.appendChild(h('p', { class: 'small' }, `The computer nominates: ${nominees.map((id, i) => `${i + 1} #${E.getPlayer(g, id).number}`).join(', ')}. `, roll));
      continue;
    }
    box.appendChild(
      h(
        'div',
        { class: 'mvpnominate small' },
        h('span', null, `Nominate up to six players who played (numbered 1–6 in this order), then roll: `),
        h(
          'div',
          { class: 'chips' },
          eligible.map((p) =>
            h(
              'label',
              { class: 'chip check', title: `#${p.number} ${p.name} (${p.position})` },
              h('input', {
                type: 'checkbox',
                checked: chosen.has(p.id),
                disabled: !chosen.has(p.id) && chosen.size >= 6,
                onchange: (e: Event) => {
                  if ((e.target as HTMLInputElement).checked) chosen.add(p.id);
                  else chosen.delete(p.id);
                  app.emit();
                },
              }),
              ` #${p.number}`,
            ),
          ),
        ),
        roll,
        nominees.length > 6 ? h('span', { class: 'warn' }, ' At most six.') : null,
      ),
    );
  }
  const both = !!((m.mvp?.A || m.mirror?.team === 'A') && (m.mvp?.B || m.mirror?.team === 'B'));
  const applied = !!(m.sppApplied?.A && m.sppApplied?.B);
  if (applied) {
    box.appendChild(
      h(
        'p',
        { class: 'small good', id: 'spp-applied' },
        m.mirror ? 'The Star Player Points of Player 1’s side were added to the saved team (Player 2 played a copy of it). Players with enough SPP can advance in Teams (the “Advance” button). ' : 'The Star Player Points were added to both saved teams. Players with enough SPP can advance in Teams (the “Advance” button). ',
        h('button', { class: 'btn small', onclick: () => app.set({ screen: 'teams', teamKind: 'league', teamEdit: null }) }, 'Open Teams'),
      ),
    );
  } else {
    box.appendChild(
      h(
        'div',
        { class: 'btnrow' },
        h('button', { class: 'btn primary', id: 'spp-apply', disabled: !both, title: both ? '' : 'Roll both MVPs first', onclick: () => void applySpp(app) }, 'Add the SPP to the saved teams'),
        !both ? h('span', { class: 'small muted' }, 'Roll both MVPs first.') : null,
      ),
    );
  }
  return box;
}

async function applySpp(app: App) {
  const g = app.game;
  const m = g.match!;
  const done: string[] = [];
  const flags: Partial<Record<TeamId, boolean>> = { ...(m.sppApplied ?? {}) };
  for (const team of ['A', 'B'] as TeamId[]) {
    if (flags[team]) continue;
    // V5.5: Player 2's copy of the same saved team is never written back (the saved team gets Player 1's side only).
    if (m.mirror?.team === team) {
      flags[team] = true;
      continue;
    }
    const def = teamCache.get(m.teamIds[team]);
    if (!def) {
      app.toast(`The saved team “${g.teams[team].name}” was not found (renamed or deleted?): its SPP cannot be added.`, 'error');
      continue;
    }
    try {
      const { team: updated, added, hired } = E.applyMatchSpp(JSON.parse(JSON.stringify(def)) as TeamDef, g, team);
      await saveTeam(app, updated, false);
      // The same team open in the editor: unsaved edits are kept and get the SPP too.
      const ed = app.st.teamEdit;
      if (ed?.id === updated.id) app.st.teamEdit = app.st.teamDirty ? E.applyMatchSpp(ed, g, team).team : (JSON.parse(JSON.stringify(updated)) as TeamDef);
      flags[team] = true;
      done.push(`${updated.name}: ${added.length ? added.map((a) => `${a.name} +${a.spp}`).join(', ') : 'no SPP'}${hired.length ? `; hired for free (Masters of Undeath): ${hired.join(', ')}` : ''}`);
    } catch (e) {
      app.toast((e as Error).message, 'error');
      if (/already been added/.test((e as Error).message)) flags[team] = true;
    }
  }
  const ns = E.cloneState(g);
  ns.match!.sppApplied = flags;
  app.st.game = ns;
  app.st.dirty = true;
  if (done.length) app.toast(`Star Player Points added — ${done.join(' · ')}.`);
  app.emit();
}

// ---------------------------------------------------------------------------
// The Advance dialog (team editor, League teams)
// ---------------------------------------------------------------------------

const KINDS: AdvKind[] = ['randomPrimary', 'primary', 'secondary', 'characteristic'];

function title(n: number): string {
  return n ? E.ADVANCEMENT_TITLES[n - 1] : 'Rookie';
}

export function advanceButton(app: App, t: TeamDef, p: TeamPlayerDef): HTMLElement | null {
  const cats = E.playerCategories(t, p);
  const ap = { ...p, primary: cats.primary, secondary: cats.secondary };
  const can = KINDS.some((k) => !E.advancementBlocked(ap, k)) || !!p.pendingAdvance;
  const must = E.mustAdvance(ap);
  // Shown only when an advancement can be taken (a disabled button in every row would only add noise).
  if (!can) return null;
  return h(
    'button',
    {
      class: `btn small ${must ? 'primary' : 'ghost'}`,
      'data-advance': p.id,
      title: must ? 'Enough SPP for a Characteristic Improvement: must take an advancement before the next game (p.96)' : 'Spend Star Player Points (p.97)',
      onclick: (e: Event) => {
        e.stopPropagation();
        app.set({ modal: { kind: 'advance', playerId: p.id } });
      },
    },
    must ? 'Advance!' : 'Advance',
  );
}

function skillOption(id: string) {
  const d = E.SKILL_BY_ID[id];
  const note = d.support === 'unsupported' ? ' — not in this app yet' : d.support === 'partial' ? ' — partly in this app' : d.support === 'noEffect' ? ' — no effect in this app' : '';
  return h('option', { value: id }, `${d.name}${note}`);
}

/** A category + skill picker with a Take button. */
function skillPicker(ap: { skills: Array<{ id: string }> }, cats: SkillCat[], label: string, take: (cat: SkillCat, id: string) => void, id: string): HTMLElement {
  let catSel: HTMLSelectElement;
  let skillSel: HTMLSelectElement;
  const fill = () => {
    const cat = catSel.value as SkillCat;
    skillSel.replaceChildren(...E.eligibleSkills(ap, cat).map(skillOption));
  };
  const usable = cats.filter((c) => E.eligibleSkills(ap, c).length);
  catSel = h('select', { class: 'small', onchange: fill }, usable.map((c) => h('option', { value: c }, E.CAT_NAME[c]))) as HTMLSelectElement;
  skillSel = h('select', { class: 'small', id: `${id}-skill` }) as HTMLSelectElement;
  fill();
  return h(
    'span',
    { class: 'btnrow tight', id },
    catSel,
    skillSel,
    h('button', { class: 'btn small primary', disabled: !usable.length, onclick: () => skillSel.value && take(catSel.value as SkillCat, skillSel.value) }, label),
  );
}

export function advanceModal(app: App, playerId: string): HTMLElement {
  const t = app.st.teamEdit;
  const p = t?.players.find((x) => x.id === playerId);
  if (!t || !p) return shell(app, 'Advance', [h('p', null, 'This player is not in the team being edited.')]);
  const cats = E.playerCategories(t, p);
  const ap = { ...p, primary: cats.primary, secondary: cats.secondary };
  const n = p.advancements?.length ?? 0;
  const commit = async (choice: AdvancementChoice) => {
    try {
      const out = E.applyAdvancement(ap, choice);
      Object.assign(p, out);
      if (cats.fromRoster) {
        delete p.primary;
        delete p.secondary;
      }
      delete p.pendingAdvance;
      const rec = out.advancements![out.advancements!.length - 1];
      await saveTeam(app, t, false);
      app.toast(`#${p.number} ${p.name}: ${rec.skill ? E.SKILL_BY_ID[rec.skill].name : `+1 ${E.CHAR_LABEL[rec.char as CharKey]}`} (${rec.spp} SPP; value +${rec.value.toLocaleString('en-GB')} gp).`);
      app.set({ modal: null });
    } catch (e) {
      app.toast((e as Error).message, 'error');
    }
  };
  const persistPending = async (pend: NonNullable<TeamPlayerDef['pendingAdvance']>) => {
    p.pendingAdvance = pend;
    await saveTeam(app, t, false);
    app.emit();
  };
  const head = h(
    'p',
    null,
    h('b', null, `#${p.number} ${p.name}`),
    ` — ${p.position} · ${p.spp ?? 0} SPP · ${n} advancement${n === 1 ? '' : 's'} (${title(n)}) · Primary ${cats.primary.join(' ') || '–'} · Secondary ${cats.secondary.join(' ') || '–'}`,
  );
  const body: Array<HTMLElement | null> = [head];
  if (E.mustAdvance(ap)) body.push(h('p', { class: 'small warn' }, 'Enough SPP for a Characteristic Improvement: this player must take an advancement before the next game (it does not have to be a Characteristic, p.96).'));
  const pend = p.pendingAdvance;
  if (pend?.kind === 'randomPrimary') {
    const rolls = pend.rolls.map(([a, b]) => `${a}-${b} ${E.SKILL_BY_ID[E.skillFromTable(pend.cat, a, b)].name}`).join(' · ');
    body.push(h('p', null, `Random ${E.CAT_NAME[pend.cat]} skill — rolled ${rolls}${pend.rolls.length > 2 ? ' (a skill the player has or cannot use is rolled again)' : ''}.`));
    body.push(
      h(
        'div',
        { class: 'btnrow', id: 'adv-choices' },
        pend.choices.map((id) => h('button', { class: 'btn primary', onclick: () => void commit({ kind: 'randomPrimary', cat: pend.cat, skill: id, rolls: pend.rolls }) }, `Take ${E.SKILL_BY_ID[id].name}${E.SKILL_BY_ID[id].support === 'unsupported' ? ' (not in this app yet)' : ''}`)),
      ),
    );
    body.push(h('p', { class: 'small muted' }, `Costs ${E.advancementCost(ap, 'randomPrimary')} SPP. The dice are kept with the player until you choose.`));
    return shell(app, 'Advance: random Primary skill', body);
  }
  if (pend?.kind === 'characteristic') {
    const opts = E.charOptions(ap, pend.d8);
    const row = E.CHAR_TABLE[pend.d8].map((c) => E.CHAR_LABEL[c]).join(' / ');
    body.push(h('p', null, `Characteristic Improvement — D8: ${pend.d8} (${pend.d8 === 8 ? 'any' : row}).`));
    const show = (c: CharKey) => {
      const v = p[c];
      if (c === 'ag' || c === 'pa') return `${E.CHAR_LABEL[c]} ${v}+ → ${(v as number) - 1}+`;
      if (c === 'av') return `AV ${v}+ → ${(v as number) + 1}+`;
      return `${E.CHAR_LABEL[c]} ${v} → ${(v as number) + 1}`;
    };
    body.push(
      opts.length
        ? h('div', { class: 'btnrow', id: 'adv-chars' }, opts.map((c) => h('button', { class: 'btn primary', 'data-char': c, onclick: () => void commit({ kind: 'characteristic', d8: pend.d8, char: c }) }, show(c))))
        : h('p', { class: 'small warn' }, 'None of these can be improved further (at most twice each, never past the maximum, p.37): take a skill instead.'),
    );
    body.push(h('p', { class: 'small' }, 'Or a skill instead (the SPP are spent either way, p.97):'));
    if (cats.primary.length) body.push(skillPicker(ap, cats.primary, 'Take (Primary)', (cat, id) => void commit({ kind: 'characteristic', d8: pend.d8, skill: id, cat, as: 'primary' }), 'adv-inst-primary'));
    if (cats.secondary.length) body.push(skillPicker(ap, cats.secondary, 'Take (Secondary)', (cat, id) => void commit({ kind: 'characteristic', d8: pend.d8, skill: id, cat, as: 'secondary' }), 'adv-inst-secondary'));
    return shell(app, 'Advance: Characteristic Improvement', body);
  }
  const rows = KINDS.map((k) => {
    const cost = E.advancementCost(ap, k);
    const why = E.advancementBlocked(ap, k);
    let action: HTMLElement | null = null;
    if (!why) {
      if (k === 'randomPrimary')
        action = h(
          'span',
          { class: 'btnrow tight', id: 'adv-random' },
          cats.primary
            .filter((c) => E.eligibleSkills(ap, c).length)
            .map((c) =>
              h(
                'button',
                {
                  class: 'btn small',
                  onclick: () => {
                    const r = E.rollRandomSkill(ap, c, () => die(6));
                    void persistPending({ kind: 'randomPrimary', cat: c, rolls: r.rolls, choices: r.choices });
                  },
                },
                `Roll ${E.CAT_NAME[c]}`,
              ),
            ),
        );
      else if (k === 'primary') action = skillPicker(ap, cats.primary, 'Take', (cat, id) => void commit({ kind: 'primary', cat, skill: id }), 'adv-primary');
      else if (k === 'secondary') action = skillPicker(ap, cats.secondary, 'Take', (cat, id) => void commit({ kind: 'secondary', cat, skill: id }), 'adv-secondary');
      else action = h('button', { class: 'btn small', id: 'adv-d8', onclick: () => void persistPending({ kind: 'characteristic', d8: die(8) }) }, 'Roll D8');
    }
    return h('tr', null, h('td', null, E.ADV_KIND_LABEL[k]), h('td', null, cost === null ? '–' : `${cost} SPP`), h('td', null, why ? h('span', { class: 'small muted' }, why) : action));
  });
  body.push(h('table', { class: 'roster small advtable' }, h('tbody', null, rows)));
  body.push(h('p', { class: 'small muted' }, 'Costs by the number of advancements already taken (Advancement Table, p.97). Skills come from the Skill Table (p.121); a skill the player has or cannot use is never offered. Elite Skills (Block, Dodge, Guard, Mighty Blow) add 10,000 gp more to the player’s value.'));
  if (p.advancements?.length)
    body.push(
      h(
        'p',
        { class: 'small' },
        'Taken: ',
        p.advancements.map((a, i) => `${i + 1}. ${a.skill ? E.SKILL_BY_ID[a.skill]?.name ?? a.skill : `+1 ${E.CHAR_LABEL[a.char as CharKey]}`} (${a.spp} SPP)`).join(' · '),
      ),
    );
  return shell(app, 'Advance', body, true);
}
