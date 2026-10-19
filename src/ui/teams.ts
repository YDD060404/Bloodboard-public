/**
 * Saved teams and the New Match screen, by mode (V5 step 6):
 *  - League: flexible team state, Star Player Points and advancement (11-a-side);
 *  - Tournament: Matched Play teams — the Team Draft Budget and Skill Points by Tier (rulebook pp.110-113, Sevens
 *    Spike! 22 pp.18-19); 11-a-side or Sevens;
 *  - Exhibition: drafted teams without purchased skills (pp.114-117); 11-a-side or Sevens.
 * Teams are JSON files in the Teams folder (or browser storage), named by their team id. Drafted teams saved by
 * earlier versions (no `play`) are Exhibition teams — their data is unchanged; the team editor can move a team to
 * Tournament.
 */
import type { App, TeamCat, TeamFormat } from './app';
import { h } from './dom';
import { E, type MatchKind, type Roster, type TeamDef, type TeamPlayerDef } from './engine-global';
import { quickDraft, quickSevens } from './matchui';
import { skillChips } from './panels';
import { advanceButton } from './advance';
import { loadSetup } from './setupPrefs';

export const teamCache = new Map<string, TeamDef>();
let loadedOnce = false;
let loading = false;

export async function refreshTeams(app: App) {
  if (loading) return;
  loading = true;
  try {
    const list = await app.teamStore.list();
    teamCache.clear();
    for (const it of list) {
      try {
        const parsed = E.parseTeamDef(await app.teamStore.load(it.name));
        if (parsed.ok) teamCache.set(parsed.team.id, parsed.team);
      } catch {
        /* skip unreadable files */
      }
    }
  } catch (e) {
    app.toast(`Could not list teams: ${(e as Error).message}`, 'error');
  } finally {
    loading = false;
    loadedOnce = true;
    app.emit();
  }
}

/** Load the saved teams once (the Home screen lists saved Tournament teams). */
export function ensureTeamsLoaded(app: App): void {
  if (!loadedOnce) void refreshTeams(app);
}

export const CAT_LABEL: Record<TeamCat, string> = { league: 'League', tournament: 'Tournament', exhibition: 'Exhibition' };
export const FORMAT_LABEL: Record<TeamFormat, string> = { standard: '11-a-side', sevens: 'Sevens' };
/** The mode a saved team belongs to (drafted teams without `play` are Exhibition teams). */
export const catOf = (t: TeamDef): TeamCat => (t.kind === 'league' ? 'league' : t.play === 'tournament' ? 'tournament' : 'exhibition');
export const formatOf = (t: TeamDef): TeamFormat => (t.variant === 'sevens' ? 'sevens' : 'standard');
/** The engine match kind of a mode (Tournament and Exhibition teams are drafted teams). */
export const matchKindOf = (c: TeamCat): MatchKind => (c === 'league' ? 'league' : 'tournament');
/** "Sevens Tournament", "11-a-side Exhibition", "League". */
export const modeLabel = (c: TeamCat, f: TeamFormat): string => (c === 'league' ? 'League' : `${f === 'sevens' ? 'Sevens' : '11-a-side'} ${CAT_LABEL[c]}`);

/**
 * The Tier a new Tournament team starts with: the one last chosen for the roster, else its official / stated Tier
 * (11-a-side: the May 2026 list; Sevens: Spike! 22, else the May 2026 Tier as a labelled suggestion). V5.5: a roster
 * the list does not name (the legacy Slann) gets no guessed Tier — an event Tier has to be chosen.
 */
export function defaultTier(rosterId: string, f: TeamFormat): 1 | 2 | 3 | 4 | undefined {
  const saved = loadSetup().tiers[`${f}:${rosterId}`];
  return saved ?? E.tierInfo(rosterId, f).tier ?? undefined;
}

/** Every Team Roster, in alphabetical order (V5: 31 rosters). */
export function rostersByName() {
  return E.ROSTERS.slice().sort((a, b) => a.name.localeCompare(b.name));
}

export function teamsOfKind(kind: TeamCat, format: TeamFormat = 'standard'): TeamDef[] {
  return [...teamCache.values()].filter((t) => catOf(t) === kind && (kind === 'league' || formatOf(t) === format)).sort((a, b) => a.name.localeCompare(b.name));
}

function newId(kind: TeamCat) {
  return `${kind}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** A starter team for a list: a drafted team, or a Sevens team (Tournament starters get their Tier). */
function starter(kind: TeamCat, format: TeamFormat, rid: string): TeamDef {
  const play = kind === 'league' ? undefined : kind;
  const tier = kind === 'tournament' ? defaultTier(rid, format) : undefined;
  if (format === 'sevens' && kind !== 'league') return quickSevens(rid, newId(kind), `${E.ROSTER_BY_ID[rid].name} Sevens starter`, { play, tier });
  const d = quickDraft(rid, newId(kind), `${E.ROSTER_BY_ID[rid].name} starter`, { play, tier });
  if (kind === 'league') {
    d.kind = 'league';
    d.play = undefined;
  }
  return d;
}

export async function saveTeam(app: App, t: TeamDef, announce = true) {
  t.updatedAt = new Date().toISOString();
  try {
    await app.teamStore.save(t.id, JSON.stringify(t, null, 1));
    teamCache.set(t.id, JSON.parse(JSON.stringify(t)));
    if (app.st.teamEdit === t) app.st.teamDirty = false;
    if (announce) app.toast(`Saved team “${t.name}”.`);
  } catch (e) {
    app.toast(`Could not save the team: ${(e as Error).message}`, 'error');
  }
}

function deleteTeam(app: App, t: TeamDef) {
  app.confirmModal(`Delete the team “${t.name}”?`, app.teamStore.kind === 'native' ? 'The team file is moved to the Trash.' : 'The team is removed from this browser’s storage.', 'Delete team', () => {
    void app.teamStore.remove(t.id).then(() => {
      teamCache.delete(t.id);
      app.set({ teamEdit: null, teamDirty: false, teamSel: null });
      app.toast(`Deleted “${t.name}”.`);
    });
  });
}

// ---------------------------------------------------------------------------
// V5.5: undo for routine team edits — no confirmation dialogs for them
// ---------------------------------------------------------------------------

const teamUndo: Array<{ teamId: string; team: TeamDef; what: string }> = [];

/** Remember the team before a routine edit, so “Undo” (⌘Z / Ctrl+Z) can put it back. */
export function rememberTeamEdit(t: TeamDef, what: string): void {
  teamUndo.push({ teamId: t.id, team: JSON.parse(JSON.stringify(t)) as TeamDef, what });
  if (teamUndo.length > 40) teamUndo.shift();
}

/** The last routine edit of this team that can be undone. */
export function teamUndoLabel(t: TeamDef | null): string | null {
  if (!t) return null;
  for (let i = teamUndo.length - 1; i >= 0; i--) if (teamUndo[i].teamId === t.id) return teamUndo[i].what;
  return null;
}

/** Undo the last routine edit of the team being edited. */
export function undoTeamEdit(app: App): boolean {
  const t = app.st.teamEdit;
  if (!t) return false;
  for (let i = teamUndo.length - 1; i >= 0; i--) {
    if (teamUndo[i].teamId !== t.id) continue;
    const u = teamUndo.splice(i, 1)[0];
    app.st.teamEdit = u.team;
    app.st.teamDirty = true;
    app.st.teamSel = null;
    app.toast(`Undone: ${u.what}.`);
    app.emit();
    return true;
  }
  return false;
}

/** Remove a player (a paired Star Player with their partner) at once — Undo puts them back. */
export function removeTeamPlayer(app: App, id: string) {
  const t = app.st.teamEdit;
  const p = t?.players.find((x) => x.id === id);
  if (!t || !p) return;
  const partner = p.star ? E.STAR_BY_ID[p.star]?.pair : undefined;
  const pair = partner ? t.players.find((x) => x.star === partner) : undefined;
  const what = `remove #${p.number} ${p.name}${pair ? ` and #${pair.number} ${pair.name}` : ''}`;
  rememberTeamEdit(t, what);
  if (p.star) E.removeStar(t, p.star);
  else t.players = t.players.filter((x) => x.id !== id);
  app.st.teamSel = null;
  app.st.teamDirty = true;
  app.toast(`Removed #${p.number} ${p.name}${pair ? ` and #${pair.number} ${pair.name} (a pair)` : ''}. Undo: ⌘Z / Ctrl+Z or “↶ Undo”.`);
  app.emit();
}

function nextNumber(t: TeamDef) {
  const used = new Set(t.players.map((p) => p.number));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

function num(value: number, min: number, max: number, on: (v: number) => void, disabled = false) {
  return h('input', {
    type: 'number',
    class: 'num',
    value: String(value),
    min: String(min),
    max: String(max),
    disabled,
    onchange: (e: Event) => {
      const v = Math.round(Number((e.target as HTMLInputElement).value));
      if (Number.isFinite(v)) on(Math.max(min, Math.min(max, v)));
    },
  });
}

function field(label: string, control: HTMLElement, hint?: string) {
  return h('label', { class: 'field' }, h('span', { class: 'flabel' }, label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function renderTeams(app: App): HTMLElement {
  if (!loadedOnce) void refreshTeams(app);
  const kind = app.st.teamKind;
  const format: TeamFormat = kind === 'league' ? 'standard' : app.st.teamFormat;
  const label = modeLabel(kind, format);
  const list = teamsOfKind(kind, format);
  const t = app.st.teamEdit;
  let rosterPick = rostersByName()[0].id;
  const left = h(
    'div',
    { class: 'teamlist card' },
    modeSwitch(app, kind, format, (k, f) => guardLeave(app, () => app.set({ teamKind: k, teamFormat: f, teamEdit: null, teamSel: null }))),
    h('h3', null, `${label} teams`),
    list.length ? null : h('p', { class: 'small muted' }, loadedOnce ? 'No saved teams yet.' : 'Loading…'),
    h(
      'ul',
      null,
      list.map((x) =>
        h(
          'li',
          { class: t?.id === x.id ? 'on' : '' },
          h('button', { class: 'linkbtn', onclick: () => guardLeave(app, () => app.set({ teamEdit: JSON.parse(JSON.stringify(x)), teamDirty: false, teamSel: null })) }, h('span', { class: 'swatch', style: `background:${x.color}` }), x.name),
          h('span', { class: 'small muted' }, ` ${x.players.length} players${x.rosterId ? ` · ${E.ROSTER_BY_ID[x.rosterId]?.name ?? x.rosterId}` : ''}`),
        ),
      ),
    ),
    h('div', { class: 'section-label' }, 'New team'),
    h(
      'div',
      { class: 'btnrow' },
      h('select', { onchange: (e: Event) => (rosterPick = (e.target as HTMLSelectElement).value) }, rostersByName().map((r) => h('option', { value: r.id }, `${r.name} (p.${r.page})`))),
      h(
        'button',
        {
          class: 'btn primary',
          id: 'new-team',
          onclick: () =>
            guardLeave(app, () => {
              const r = E.ROSTER_BY_ID[rosterPick];
              const sev = format === 'sevens' && kind !== 'league';
              const nt = E.newTeamDef(matchKindOf(kind), r.id, `New ${r.name}${sev ? ' Sevens' : ''} team`, newId(kind), sev ? 'sevens' : undefined);
              if (kind !== 'league') nt.play = kind;
              if (kind === 'tournament') {
                // Matched Play: Dedicated Fans start at 0 (p.110; Spike! 22 p.18); the Tier sets the Skill Points.
                nt.dedicatedFans = 0;
                nt.tier = defaultTier(r.id, format);
              }
              app.set({ teamEdit: nt, teamDirty: true, teamSel: null });
            }),
        },
        'Create',
      ),
    ),
    h(
      'div',
      { class: 'btnrow' },
      h(
        'button',
        {
          class: 'btn small',
          title: 'Add a drafted Tomb Kings team and Bretonnian team to try a match straight away',
          onclick: () => {
            for (const rid of ['tombKings', 'bretonnian']) void saveTeam(app, starter(kind, format, rid));
          },
        },
        'Add two starter teams',
      ),
      h(
        'button',
        {
          class: 'btn small ghost',
          onclick: () =>
            void app.teamStore.importFile().then((txt) => {
              if (!txt) return;
              const parsed = E.parseTeamDef(txt);
              if (!parsed.ok) return app.toast(parsed.errors.join(' '), 'error');
              const imp = parsed.team;
              imp.id = newId(catOf(imp));
              app.set({ teamKind: catOf(imp), teamFormat: formatOf(imp), teamEdit: imp, teamDirty: true });
              app.toast(`Imported “${imp.name}” — press Save to keep it.`);
            }),
        },
        'Import…',
      ),
    ),
    h('div', { class: 'btnrow' }, h('button', { class: 'btn', id: 'teams-play', onclick: () => guardLeave(app, () => app.set({ screen: 'newMatch', setupMode: kind, quickEdit: undefined })) }, 'Play a match →'), h('button', { class: 'btn ghost', onclick: () => guardLeave(app, () => app.set({ screen: 'home', teamEdit: null })) }, '← Home')),
  );
  const right = t ? teamEditor(app, t) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Choose a team on the left, or create one.'), kind === 'league' ? leagueNote() : kind === 'tournament' ? tournamentNote(format) : format === 'sevens' ? sevensNote() : templateNote());
  return h('div', { class: 'teamsscreen' }, left, right);
}

/** League / Tournament / Exhibition, and 11-a-side / Sevens for the drafted modes (V5 step 6). */
export function modeSwitch(app: App, kind: TeamCat, format: TeamFormat, go: (k: TeamCat, f: TeamFormat) => void, prefix = 'tm'): HTMLElement {
  return h(
    'div',
    { class: 'modeswitch' },
    h('div', { class: 'seg' }, (['league', 'tournament', 'exhibition'] as TeamCat[]).map((k) => h('button', { class: `segbtn ${k === kind ? 'on' : ''}`, id: `${prefix}-cat-${k}`, onclick: () => go(k, format) }, CAT_LABEL[k]))),
    kind === 'league'
      ? h('p', { class: 'small muted' }, 'League teams are 11-a-side. Sevens League play (Spike! 22 pp.14-17) is not in the app yet.')
      : h('div', { class: 'seg small' }, (['standard', 'sevens'] as TeamFormat[]).map((f) => h('button', { class: `segbtn ${f === format ? 'on' : ''}`, id: `${prefix}-format-${f}`, onclick: () => go(kind, f) }, FORMAT_LABEL[f]))),
  );
}

function tournamentNote(format: TeamFormat) {
  const F = E.MATCHED[format];
  const known = Object.entries(E.SOURCE_TIERS[format]).map(([rid, x]) => `${E.ROSTER_BY_ID[rid]?.name ?? rid}: Tier ${x.tier} (${x.ref})`);
  return h(
    'div',
    { class: 'small', id: 'tournament-rules' },
    h('h4', null, `Tournament = Matched Play (${F.source} pp.${F.page})`),
    h(
      'ul',
      null,
      h('li', null, `Team Draft Budget ${F.budgets.map((b) => b.toLocaleString('en-GB')).join(' / ')} gold pieces; Dedicated Fans start at 0; unspent gold is lost.`),
      h('li', null, `Skill Points by Tier: ${E.TIERS.map((t) => `Tier ${t} = ${F.skillPoints[t]}`).join(', ')}. A Primary skill costs 1, a Secondary skill 2 (${format === 'sevens' ? 'one Secondary skill for the whole team' : `Tier 1-4: at most ${E.TIERS.map((t) => F.secondaryMax[t]).join(' / ')} Secondary skills`}); one extra skill per player; ${format === 'sevens' ? `at most ${F.eliteMax} Elite skills (Block, Dodge, Guard, Mighty Blow)` : `each individual Elite skill (Block, Dodge, Guard, Mighty Blow) at most ${F.eliteMax} times`}.`),
      F.starCost ? h('li', null, `Star Players cost their gold and ${F.starCost} Skill Points each (a pair counts once); Tier 1 teams hire at most one; Star Players cannot be given skills.`) : h('li', null, 'Sevens teams: no Star Players in the app.'),
      h('li', null, "The Tier list is in the Blood Bowl Designers' Commentary, not in the rulebook or Spike! 22 — choose your team's Tier. " + (known.length ? `Stated in the sources: ${known.join('; ')}.` : '')),
    ),
  );
}

function templateNote() {
  const d = E.DRAFT_TEMPLATE;
  return h(
    'div',
    { class: 'small' },
    h('h4', null, 'Tournament / Exhibition template (printed pp.89-91)'),
    h('ul', null, h('li', null, `Budget ${d.budget.toLocaleString('en-GB')} gold pieces.`), h('li', null, `${d.minPlayers}-${d.maxPlayers} players from one official Team Roster, within its position limits, with the roster profile.`), h('li', null, `Up to ${d.maxRerolls} Team Re-rolls at the roster price; an Apothecary (${d.apothecaryCost / 1000}k) if the roster allows one.`), h('li', null, `Up to ${d.maxAssistants} Assistant Coaches and ${d.maxCheerleaders} Cheerleaders (${d.assistantCost / 1000}k each); Dedicated Fans ${d.minFans}-${d.maxFans} (${d.fanCost / 1000}k per step above 1).`)),
    h('p', { class: 'muted' }, 'The app includes 6 of the rulebook’s Team Rosters: Bretonnian, Tomb Kings, Human, Orc, Lizardmen and Norse.'),
  );
}

export function sevensNote() {
  const d = E.SEVENS_DRAFT;
  return h(
    'div',
    { class: 'small' },
    h('h4', null, 'Blood Bowl Sevens draft (Spike! Journal: Sevens, Issue 22, 2026 — pp.8-9, 13)'),
    h(
      'ul',
      null,
      h('li', null, `Budget ${d.budget.toLocaleString('en-GB')} gold pieces; ${d.minPlayers}-${d.maxPlayers} players from one Team Roster, within its position limits.`),
      h('li', null, `No more than ${d.maxNonLineman} players without the Lineman keyword.`),
      h('li', null, `Team Re-rolls ${d.rerollCost / 1000}k each; Assistant Coaches and Cheerleaders ${d.assistantCost / 1000}k each (max ${d.maxAssistants} each); an Apothecary ${d.apothecaryCost / 1000}k if the roster allows one; Dedicated Fans ${d.minFans}-${d.maxFans} (${d.fanCost / 1000}k per step above 1).`),
      h('li', null, 'One Lineman is the Veteran: MA −1, and once per game it may re-roll a failed pick-up, catch or Pass, or block dice that would Knock it Down.'),
    ),
    h('p', { class: 'muted' }, 'Sevens matches: 20 × 11 pitch, 7 players a side, 6 Turns a half, the Sevens Kick-off, Injury and Argue the Call tables (docs/SEVENS_RULES.md). Sevens League advancement is not implemented; Sevens teams buy the Sevens Inducements (Spike! 22 p.14) in the team builder.'),
  );
}

function leagueNote() {
  return h(
    'p',
    { class: 'small muted' },
    'League teams are flexible: change any player’s characteristics and skills, mark injured players as unavailable, and set any number of re-rolls, staff and fans. No budget is enforced. V4: Star Player Points earned in League matches (and the MVP) are added after full time; “Advance” spends them by the Advancement Table (p.97). Winnings, injuries, hiring and standings are not part of this app.',
  );
}

function guardLeave(app: App, go: () => void) {
  if (!app.st.teamDirty || !app.st.teamEdit) return go();
  app.confirmModal('Discard unsaved changes?', `“${app.st.teamEdit.name}” has changes that are not saved.`, 'Discard changes', () => {
    app.st.teamDirty = false;
    go();
  });
}

function teamEditor(app: App, t: TeamDef): HTMLElement {
  const touch = () => {
    app.st.teamDirty = true;
    app.emit();
  };
  const r = t.rosterId ? E.ROSTER_BY_ID[t.rosterId] : undefined;
  const league = t.kind === 'league';
  const sevens = t.variant === 'sevens';
  const tournament = E.isTournamentTeam(t);
  const T = E.draftTemplate(t);
  const issues = E.validateTeamDef(t);
  const cost = E.teamCost(t);
  const sp = E.teamSkillPoints(t);
  const fr = E.fansRange(t);
  const head = h(
    'div',
    { class: 'row-between' },
    h('h3', null, t.name, app.st.teamDirty ? h('span', { class: 'muted' }, ' •') : null),
    h(
      'div',
      { class: 'btnrow tight' },
      teamUndoLabel(t) ? h('button', { class: 'btn ghost', id: 'team-undo', title: `Undo: ${teamUndoLabel(t)} (⌘Z / Ctrl+Z)`, onclick: () => undoTeamEdit(app) }, '↶ Undo') : null,
      h('button', { class: 'btn primary', id: 'save-team', onclick: () => void saveTeam(app, t) }, 'Save'),
      h('button', { class: 'btn ghost', onclick: () => void app.teamStore.exportFile(`${t.name.replace(/[^\w\- ]+/g, '') || 'team'}.json`, JSON.stringify(t, null, 1)) }, 'Export…'),
      teamCache.has(t.id) ? h('button', { class: 'btn ghost danger', onclick: () => deleteTeam(app, t) }, 'Delete team') : null,
    ),
  );
  const settings = h(
    'div',
    { class: 'grid3' },
    field('Name', h('input', { type: 'text', value: t.name, onchange: (e: Event) => { t.name = (e.target as HTMLInputElement).value; touch(); } })),
    field(
      'Roster',
      h(
        'select',
        {
          disabled: !league && t.players.length > 0,
          title: !league && t.players.length ? 'Remove the players to change the roster' : '',
          onchange: (e: Event) => {
            const id = (e.target as HTMLSelectElement).value;
            t.rosterId = id || undefined;
            t.league = undefined;
            t.favoured = undefined;
            const rr = id ? E.ROSTER_BY_ID[id] : undefined;
            if (rr) {
              t.color = rr.color;
              t.accent = rr.accent;
            }
            touch();
          },
        },
        league ? h('option', { value: '' }, '— custom —') : null,
        rostersByName().map((x) => h('option', { value: x.id, selected: t.rosterId === x.id }, x.name)),
      ),
    ),
    // V5 step 6: a drafted team is built for Tournament (Matched Play, Skill Points) or Exhibition play.
    league
      ? null
      : field(
          'Mode',
          h(
            'select',
            {
              id: 'team-play',
              onchange: (e: Event) => {
                const v = (e.target as HTMLSelectElement).value as 'tournament' | 'exhibition';
                t.play = v;
                if (v === 'tournament' && !t.tier && t.rosterId) t.tier = defaultTier(t.rosterId, formatOf(t));
                app.st.teamKind = v;
                touch();
              },
            },
            h('option', { value: 'tournament', selected: t.play === 'tournament' }, 'Tournament (Matched Play: Skill Points)'),
            h('option', { value: 'exhibition', selected: t.play !== 'tournament' }, 'Exhibition (no purchased skills)'),
          ),
          sevens ? 'Spike! 22 pp.18-19' : 'pp.110-117',
        ),
    tournament
      ? field(
          'Tier',
          h(
            'select',
            { id: 'team-tier', onchange: (e: Event) => { const v = Number((e.target as HTMLSelectElement).value); t.tier = v ? (v as 1 | 2 | 3 | 4) : undefined; touch(); } },
            h('option', { value: '', selected: !t.tier }, '— choose —'),
            E.TIERS.map((x) => {
              const info = E.tierInfo(t.rosterId, formatOf(t));
              return h('option', { value: String(x), selected: t.tier === x }, `Tier ${x}: ${E.MATCHED[formatOf(t)].skillPoints[x]} Skill Points${info.tier === x ? (info.kind === 'official' ? ' (official)' : info.kind === 'source' ? ' (Spike! 22)' : ' (May 2026 list)') : ' (event)'}`);
            }),
          ),
          (() => {
            const info = E.tierInfo(t.rosterId, formatOf(t));
            const ev = E.isEventTier(t.rosterId, formatOf(t), t.tier);
            return ev ? `Event-specific Tier (not the official one: ${info.label}).` : `${info.label} — ${info.ref}`;
          })(),
        )
      : null,
    r
      ? field(
          'League',
          r.leagues.length > 1
            ? h(
                'select',
                { id: 'team-league', onchange: (e: Event) => { t.league = (e.target as HTMLSelectElement).value || undefined; touch(); } },
                h('option', { value: '', selected: !t.league }, '— choose —'),
                r.leagues.map((l) => h('option', { value: l, selected: t.league === l }, l)),
              )
            : h('span', { class: 'small' }, r.leagues[0]),
          `p.${E.LEAGUES_PAGE}${r.leagues.length > 1 ? '; chosen once, when the team is drafted' : ''}`,
        )
      : null,
    r?.favouredOf
      ? field(
          'Favoured of',
          h(
            'select',
            { id: 'team-favoured', onchange: (e: Event) => { t.favoured = (e.target as HTMLSelectElement).value || undefined; touch(); } },
            h('option', { value: '', selected: !t.favoured }, '— choose —'),
            r.favouredOf.map((f) => h('option', { value: f, selected: t.favoured === f }, f)),
          ),
          'p.154; chosen once, when the team is drafted',
        )
      : null,
    r
      ? field(
          'Team special rules',
          h('span', { class: 'small', id: 'team-special-rules' }, E.teamSpecialRules(t).join(', ') || 'none'),
          `pp.${E.SPECIAL_RULES_PAGES}${r.leagueRules ? ` · ${Object.entries(r.leagueRules).map(([l, x]) => `${l}: ${x.join(', ')}`).join('; ')}` : ''}`,
        )
      : null,
    field('Colours', h('span', { class: 'btnrow tight' }, h('input', { type: 'color', value: t.color, onchange: (e: Event) => { t.color = (e.target as HTMLInputElement).value; touch(); } }), h('input', { type: 'color', value: t.accent, onchange: (e: Event) => { t.accent = (e.target as HTMLInputElement).value; touch(); } }))),
    field('Team Re-rolls', num(t.rerolls, 0, league ? 20 : T.maxRerolls, (v) => { t.rerolls = v; touch(); }), sevens ? `${E.SEVENS_DRAFT.rerollCost / 1000}k each (Sevens)` : r ? `${(r.rerollCost / 1000).toFixed(0)}k each` : undefined),
    field('Apothecary', h('input', { type: 'checkbox', checked: t.apothecary, disabled: !league && !!r && !r.apothecary, onchange: (e: Event) => { t.apothecary = (e.target as HTMLInputElement).checked; touch(); } }), r && !r.apothecary ? 'not available to this roster' : undefined),
    field('Assistant Coaches', num(t.assistantCoaches, 0, league ? 20 : T.maxAssistants, (v) => { t.assistantCoaches = v; touch(); }), league ? undefined : `${T.assistantCost / 1000}k each`),
    field('Cheerleaders', num(t.cheerleaders, 0, league ? 20 : T.maxCheerleaders, (v) => { t.cheerleaders = v; touch(); }), league ? undefined : `${T.cheerleaderCost / 1000}k each`),
    field('Dedicated Fans', num(t.dedicatedFans, league ? 0 : fr.min, league ? 20 : fr.max, (v) => { t.dedicatedFans = v; touch(); }), tournament ? `from 0 (Matched Play), ${T.fanCost / 1000}k each` : undefined),
  );
  const money = financePanel(t, touch);
  const rows = t.players
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((p) => playerRow(app, t, p, league, touch, tournament));
  const table = h(
    'table',
    { class: 'roster' },
    h('thead', null, h('tr', null, ['#', 'Name', 'Position', 'MA', 'ST', 'AG', 'PA', 'AV', 'Skills', league ? 'Unavailable' : sevens ? 'Veteran' : '', ...(league ? ['SPP'] : []), ''].map((c) => h('th', null, c)))),
    h('tbody', null, rows),
  );
  const add = h('div', { class: 'addplayers' });
  if (r) {
    for (const pos of r.positions) {
      const n = t.players.filter((p) => p.positionId === pos.id).length;
      const max = Number(pos.qty.split('-')[1]);
      // Limits across positions printed on the roster ("a single Big Guy, chosen from the following").
      const group = (r.groups ?? []).find((g) => g.positions.includes(pos.id));
      add.appendChild(
        h(
          'button',
          {
            class: 'btn small',
            title: group ? `${group.text} (at most ${group.max})` : '',
            disabled: !league && (n >= max || t.players.length >= T.maxPlayers || E.groupRoom(t, pos.id) <= 0),
            onclick: () => {
              const num0 = nextNumber(t);
              t.players.push(E.playerFromRoster(r, pos.id, num0, `${t.id}-p${Date.now().toString(36)}${num0}`));
              if (addAsMerc && !league && !sevens) t.players[t.players.length - 1].mercenary = true;
              // Sevens: the first Lineman added becomes the Veteran (another Lineman can be chosen in the table).
              if (sevens && !t.players.some((q) => q.veteran) && pos.keywords.includes('Lineman')) E.setVeteran(t, t.players[t.players.length - 1].id);
              touch();
            },
          },
          `+ ${pos.name} (${(pos.cost ?? 0) / 1000}k, ${n}/${max})`,
        ),
      );
    }
  }
  if (league)
    add.appendChild(
      h(
        'button',
        {
          class: 'btn small ghost',
          onclick: () => {
            const n = nextNumber(t);
            t.players.push({ id: `${t.id}-c${Date.now().toString(36)}${n}`, number: n, name: 'Custom player', position: 'Custom', keywords: [], ma: 6, st: 3, ag: 3, pa: 4, av: 9, skills: [] });
            touch();
          },
        },
        '+ Custom player',
      ),
    );
  const errors = issues.filter((i) => i.level === 'error');
  const summary = h(
    'div',
    { class: 'teamsummary' },
    h('span', null, `${t.players.length} players (${t.players.filter((p) => !p.unavailable).length} available)`),
    r ? h('span', { class: !league && cost.total > E.teamBudget(t) ? 'bad' : '' }, `Cost ${cost.total.toLocaleString('en-GB')} gp${league ? '' : ` of ${E.teamBudget(t).toLocaleString('en-GB')}`}${cost.inducements ? ` (Inducements ${cost.inducements.toLocaleString('en-GB')})` : ''}`) : null,
    sevens ? h('span', { class: t.players.filter((q) => !q.keywords.includes('Lineman')).length > E.SEVENS_DRAFT.maxNonLineman ? 'bad' : '' }, `Non-Linemen ${t.players.filter((q) => !q.keywords.includes('Lineman')).length}/${E.SEVENS_DRAFT.maxNonLineman}`) : null,
    tournament ? h('span', { class: sp.spent > sp.allowance ? 'bad' : '', id: 'team-skillpoints' }, t.tier ? `Skill Points ${sp.spent}/${sp.allowance} (Tier ${t.tier})` : 'Skill Points: choose the Tier') : null,
    tournament && t.tier
      ? h(
          'span',
          { class: 'btnrow tight' },
          h('button', { class: 'btn small ghost', id: 'team-autoskills', title: 'Spend the remaining Skill Points on sensible skills for each player (you can change them)', onclick: () => { rememberTeamEdit(t, 'suggest skills'); E.autoSkills(t, true); touch(); } }, 'Suggest skills'),
          h('button', { class: 'btn small ghost', id: 'team-clearskills', disabled: !t.players.some((p) => p.boughtSkill), onclick: () => { rememberTeamEdit(t, 'clear the bought skills'); for (const p of t.players) delete p.boughtSkill; touch(); } }, 'Clear skills'),
        )
      : null,
    !league && r
      ? h(
          'button',
          { class: 'linkbtn', id: 'team-inducements-link', title: 'Go to the Inducements of this team', onclick: () => document.getElementById('team-inducements')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
          `Inducements: ${Object.values(t.inducements ?? {}).reduce((a, k) => a + (k > 0 ? k : 0), 0)} bought${cost.inducements ? ` (${cost.inducements.toLocaleString('en-GB')} gp)` : ''} ▾`,
        )
      : null,
    errors.length ? h('span', { class: 'bad' }, `${errors.length} problem${errors.length === 1 ? '' : 's'}: this team cannot play yet`) : h('span', { class: 'good' }, '✓ Ready to play'),
  );
  return h(
    'div',
    { class: 'card teameditor' },
    head,
    h(
      'p',
      { class: 'small muted' },
      league
        ? 'League team: flexible team state.'
        : `${sevens ? 'Blood Bowl Sevens team: the Sevens draft (Spike! Journal 22 pp.8-9); pick the Veteran among the Linemen. ' : 'Drafted from the Team Roster (pp.89-91). '}${tournament ? `Tournament (Matched Play): buy one extra skill per player with the team's Skill Points in the Skills column (Primary 1, Secondary 2${sevens ? ', one Secondary for the team' : ''}).` : 'Exhibition: no purchased skills.'}`,
      ' Select a row and press Delete to remove a player.',
    ),
    settings,
    money,
    summary,
    issues.length ? h('ul', { class: 'issues small' }, issues.map((i) => h('li', { class: i.level === 'error' ? 'bad' : 'warn' }, i.text))) : null,
    sevens && t.players.some((q) => q.skills.some((k) => k.id === 'insignificant')) || (sevens && r?.positions.some((x) => x.skills.some((k) => k.id === 'insignificant')))
      ? h('p', { class: 'small note', id: 'sevens-insignificant' }, h('b', null, `${E.SEVENS_INSIGNIFICANT.label}. `), E.SEVENS_INSIGNIFICANT.text, E.usesSevensInsignificantException(t) ? ' This team uses it.' : '')
      : null,
    table,
    h('div', { class: 'section-label' }, 'Add players'),
    add,
    !league && r ? renderInducements(t, r, touch) : null,
    !league && !sevens && r ? renderStars(t, touch) : null,
    league
      ? h('p', { class: 'small muted', id: 'team-stars-league' }, 'Star Players and Inducements for League teams are hired for one match in the pre-match step (Petty Cash and Treasury, p.94): Home ▸ League ▸ Set up… — they never join the saved team.')
      : sevens && r
        ? h('p', { class: 'small muted', id: 'team-stars-sevens' }, 'Blood Bowl Sevens: the Sevens Inducement list (Spike! 22 p.14) has no Star Players — the All-Star Match (Exhibition) is the custom variant with Star Players.')
        : null,
  );
}

/**
 * V5.5: the team's money and points, kept apart — the Team Draft Budget (starting budget), what is spent on what,
 * what is left, the Team Value (p.91), League: the Treasury; Tournament: the Skill Points with their limits.
 */
function financePanel(t: TeamDef, touch: () => void): HTMLElement {
  const league = t.kind === 'league';
  const sevens = t.variant === 'sevens';
  const tournament = E.isTournamentTeam(t);
  const cost = E.teamCost(t);
  const budget = E.teamBudget(t);
  const presets = E.budgetsFor(t);
  const gp = (n: number) => `${n.toLocaleString('en-GB')} gp`;
  const rows: Array<[string, string, string?]> = [];
  if (!league) {
    rows.push(['Starting budget (Team Draft Budget)', gp(budget), t.budgetCustom ? 'custom rules' : sevens ? 'Spike! 22 p.8' : tournament ? 'p.110' : budget === 1_000_000 ? 'p.89' : 'p.110']);
    rows.push(['Players', gp(cost.players)]);
    rows.push(['Team Re-rolls', gp(cost.rerolls)]);
    rows.push(['Sideline Staff', gp(cost.staff)]);
    rows.push(['Dedicated Fans', gp(cost.fans), tournament ? 'from 0 in Matched Play' : 'the first one is free']);
    if (cost.inducements) rows.push(['Inducements (Star Players included)', gp(cost.inducements)]);
    rows.push(['Left', gp(budget - cost.total), budget - cost.total < 0 ? 'over the budget' : tournament ? 'not spent = lost (p.110)' : '']);
  }
  rows.push(['Team Value (TV, p.91)', gp(E.teamValue(t)), 'players + Team Re-rolls + Sideline Staff; not Fans, Treasury or Star Players' + (tournament ? '; skills bought with Skill Points add nothing (p.112)' : '')]);
  if (league) rows.push(['Current Team Value (next match)', gp(E.currentTeamValue(t)), 'without unavailable players, with Journeymen (p.94)']);
  const box = h('div', { class: 'finance', id: 'team-finance' });
  box.appendChild(h('div', { class: 'section-label' }, league ? 'Team Value and Treasury' : 'Budget, spending and Team Value'));
  if (!league)
    box.appendChild(
      h(
        'div',
        { class: 'btnrow tight' },
        h('span', { class: 'small' }, 'Team Draft Budget: '),
        h(
          'select',
          {
            id: 'team-budget',
            onchange: (e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              if (v === 'custom') {
                t.budgetCustom = true;
                t.budget = budget;
              } else {
                t.budgetCustom = undefined;
                const n = Number(v);
                t.budget = !tournament && !sevens && n === E.DRAFT_TEMPLATE.budget ? undefined : sevens ? undefined : n;
              }
              touch();
            },
          },
          presets.map((b) => h('option', { value: String(b), selected: !t.budgetCustom && budget === b }, gp(b))),
          h('option', { value: 'custom', selected: !!t.budgetCustom }, 'Custom rules (event / house)…'),
        ),
        t.budgetCustom ? h('input', { type: 'number', class: 'num wide', id: 'team-budget-custom', min: '100000', max: '3000000', step: '5000', value: String(budget), onchange: (e: Event) => { const n = Math.round(Number((e.target as HTMLInputElement).value) / 5000) * 5000; t.budget = Math.max(100_000, Math.min(3_000_000, n || budget)); touch(); } }) : null,
        h('span', { class: 'small muted' }, sevens ? 'Standard Sevens: 600,000 gp; any other amount is a custom rule.' : tournament ? 'Matched Play: usually 1,100,000 / 1,150,000 / 1,200,000 gp (p.110) — both teams use the same.' : '1,000,000 = the League draft (p.89); Exhibition Play often 1,100,000-1,200,000 (p.110).'),
      ),
    );
  else
    box.appendChild(
      h(
        'div',
        { class: 'btnrow tight' },
        h('span', { class: 'small' }, 'Treasury: '),
        h('input', { type: 'number', class: 'num wide', id: 'team-treasury', min: '0', max: '9000000', step: '5000', value: String(t.treasury ?? 0), onchange: (e: Event) => { t.treasury = Math.max(0, Math.round(Number((e.target as HTMLInputElement).value) || 0)); touch(); } }),
        h('span', { class: 'small muted' }, 'gold the team has (p.89: what the draft did not spend). Spent on Inducements and Star Players before a match (p.94): the app takes off the Treasury gold spent when the League match starts. Winnings after a match are entered here by hand.'),
      ),
    );
  box.appendChild(h('table', { class: 'roster small moneytable' }, h('tbody', null, rows.map(([a, b, c]) => h('tr', null, h('td', null, a), h('td', { class: 'num' }, b), h('td', { class: 'muted' }, c ?? '')))))) ;
  if (tournament && t.tier) {
    const F = E.MATCHED[formatOf(t)];
    const sp = E.teamSkillPoints(t);
    const stars = E.starChoices(t.players);
    box.appendChild(
      h(
        'p',
        { class: 'small', id: 'team-sp-detail' },
        h('b', null, `Tournament Skill Points: ${sp.spent} of ${sp.allowance} spent, ${sp.allowance - sp.spent} left`),
        ` (Tier ${t.tier}). Primary skills ${sp.primary} × 1; Secondary ${sp.secondary} × 2 (at most ${F.secondaryMax[t.tier]}); ${t.variant === 'sevens' ? `Elite skills ${sp.elite} of ${F.eliteMax}` : `Elite skills ${sp.elite} (most of one: ${sp.eliteMostSame} of ${F.eliteMax})`}; `,
        F.starCost ? `Star Players ${stars} of ${F.starsMax[t.tier]} (${F.starCost} each, a Mega-star ${E.MEGA_STAR_COST}; at most one Mega-star)${sp.megaStars ? ` — ${sp.megaStars} Mega-star` : ''}.` : 'no Star Players in Sevens.',
      ),
    );
  }
  return box;
}

/** V5 step 5: the Star Players who play for this team (p.148, Plays For p.194, cards pp.195-211). */
let showAllStars = false;
function renderStars(t: TeamDef, touch: () => void): HTMLElement {
  const league = E.teamLeague(t);
  const rules = E.teamSpecialRules(t);
  const list = E.STARS.filter((s) => showAllStars || E.starPlaysFor(s, league, rules)).sort((a, b) => Number(E.starSupported(b.id)) - Number(E.starSupported(a.id)) || a.name.localeCompare(b.name));
  const chosen = E.starChoices(t.players);
  const rows = list.map((s) => {
    const hired = t.players.some((q) => q.star === s.id);
    const why = hired ? null : E.starAddReason(t, s.id);
    const pairName = s.pair ? E.STAR_BY_ID[s.pair]?.name : undefined;
    const prof = `${s.ma} / ${s.st} / ${s.ag}+ / ${s.pa === null ? '–' : `${s.pa}+`} / ${s.av}+`;
    return h(
      'tr',
      { 'data-star': s.id, class: E.starSupported(s.id) ? '' : 'muted' },
      h('td', null, h('b', null, s.name), s.pair ? h('span', { class: 'small muted' }, ` (with ${pairName})`) : null, ' ', h('span', { class: 'small muted' }, `p.${s.page}`)),
      h('td', { class: 'small' }, `${(s.cost / 1000).toFixed(0)}k${s.pair ? ' pair' : ''}${E.isTournamentTeam(t) ? ` + ${E.isMegaStar(s.id) ? E.MEGA_STAR_COST : E.MATCHED.standard.starCost} SP` : ''}`, E.isMegaStar(s.id) ? h('div', { class: 'variant-chip' }, 'MEGA-STAR') : null),
      h('td', { class: 'small' }, prof),
      h('td', { class: 'small' }, s.skills.map((k) => E.skillName(k)).join(', ')),
      h('td', { class: 'small' }, h('b', null, `${s.rule.name}: `), s.rule.summary, h('div', { class: 'muted' }, `Plays for ${E.playsForText(s)}`)),
      h(
        'td',
        null,
        hired
          ? h('span', { class: 'good small' }, '✓ hired')
          : h(
              'button',
              {
                class: 'btn small',
                'data-hire': s.id,
                disabled: !!why,
                title: why ?? `Hire ${s.name}${pairName ? ` and ${pairName}` : ''} for ${s.cost.toLocaleString('en-GB')} gp`,
                onclick: () => {
                  let k = 0;
                  E.addStar(t, s.id, () => `${t.id}-s${Date.now().toString(36)}${k++}`);
                  touch();
                },
              },
              E.starSupported(s.id) ? '+ Hire' : 'not yet',
            ),
      ),
    );
  });
  return h(
    'div',
    { class: 'inducements', id: 'team-stars' },
    h('div', { class: 'section-label' }, E.isTournamentTeam(t) && t.tier ? `Star Players — Matched Play: gold + ${E.MATCHED.standard.starCost} Skill Points each (a Mega-star ${E.MEGA_STAR_COST}), Tier ${t.tier}: at most ${E.MATCHED.standard.starsMax[t.tier]}, one Mega-star (p.113) — hired: ${chosen}` : `Star Players (0-${E.STAR_MAX}, a pair counts as one; bought from the Team Draft Budget, p.148) — hired: ${chosen}/${E.STAR_MAX}`),
    h(
      'label',
      { class: 'small' },
      h('input', { type: 'checkbox', id: 'show-all-stars', checked: showAllStars, onchange: (e: Event) => { showAllStars = (e.target as HTMLInputElement).checked; touch(); } }),
      ' Show every Star Player (not only those who play for this team)',
    ),
    rows.length
      ? h('table', { class: 'roster small starTable' }, h('thead', null, h('tr', null, ['Star Player', 'Cost', 'MA / ST / AG / PA / AV', 'Skills & Traits', 'Special rule', ''].map((c) => h('th', null, c)))), h('tbody', null, rows))
      : h('p', { class: 'small muted' }, 'No Star Player plays for this team (choose its League first if it has several).'),
    h('p', { class: 'small muted' }, 'Star Players earn no Star Player Points and their injuries are waived after the game. Only Star Players whose special rule is implemented can be hired; the others show "not yet".'),
  );
}

/** V5: whether the next roster player added is a Mercenary (p.147). */
let addAsMerc = false;

/**
 * Inducements on a Tournament / Exhibition Team Draft List, bought from its Team Draft Budget (rulebook pp.110, 116,
 * 141-149; Blood Bowl Sevens: its own list and prices, Spike! 22 p.14 — Matched Play p.18). Every item of the format's
 * list is shown with its price, limit, eligibility and effect; what the list does not offer is listed with the reason.
 */
function renderInducements(t: TeamDef, r: Roster, touch: () => void): HTMLElement {
  const rules = E.teamSpecialRules(t);
  const sevens = t.variant === 'sevens';
  const list = (t.inducements ??= {});
  const cost = E.teamCost(t);
  const budget = E.teamBudget(t);
  const rows = E.inducementsFor(sevens ? 'sevens' : 'standard').map((d) => {
    const n = list[d.id] ?? 0;
    const why = d.unavailable(rules, r);
    const max = d.max(rules);
    const price = d.cost(rules, r);
    const left = Number.isFinite(budget) ? budget - cost.total : Infinity;
    const set = (k: number) => {
      if (k > 0) list[d.id] = k;
      else delete list[d.id];
      touch();
    };
    return h(
      'tr',
      { 'data-inducement': d.id, class: why ? 'muted' : '' },
      h('td', { title: d.summary }, d.name, ' ', h('span', { class: 'small muted' }, sevens ? `Spike! 22 p.${d.page}` : `p.${d.page}`)),
      h('td', { class: 'small' }, `${(price / 1000).toFixed(0)}k`),
      h('td', { class: 'small' }, `0-${max}`),
      h(
        'td',
        null,
        why
          ? h('span', { class: 'small muted' }, `Not for this team: ${why}`)
          : h(
              'span',
              { class: 'btnrow tight' },
              h('button', { class: 'btn small ghost', disabled: n <= 0, 'data-dec': d.id, 'aria-label': `One ${d.name} less`, onclick: () => set(n - 1) }, '−'),
              h('b', { class: 'count' }, String(n)),
              h('button', { class: 'btn small ghost', disabled: n >= max, 'data-inc': d.id, 'aria-label': `One more ${d.name}`, title: n >= max ? `At most ${max}` : price > left ? `Over the budget by ${(price - left).toLocaleString('en-GB')} gp` : '', onclick: () => set(n + 1) }, '+'),
            ),
      ),
      h('td', { class: 'small muted' }, d.summary),
    );
  });
  const notOffered = E.inducementsNotOffered(sevens ? 'sevens' : 'standard');
  return h(
    'div',
    { class: 'inducements', id: 'team-inducements' },
    h('div', { class: 'section-label' }, sevens ? 'Inducements — Blood Bowl Sevens list (Spike! 22 p.14), bought from the Team Draft Budget' : 'Inducements (Exhibition / Matched Play: bought from the Team Draft Budget, pp.110, 116)'),
    h(
      'p',
      { class: 'small', id: 'inducement-money' },
      `Spent on Inducements: ${cost.inducements.toLocaleString('en-GB')} gp · team total ${cost.total.toLocaleString('en-GB')} of ${Number.isFinite(budget) ? budget.toLocaleString('en-GB') : 'no limit'} gp${Number.isFinite(budget) ? ` · left: ${(budget - cost.total).toLocaleString('en-GB')} gp` : ''}.${sevens ? ' Matched Play: spend as much or as little as you like, as long as the team keeps seven players (Spike! 22 p.18).' : ''}`,
    ),
    h('table', { class: 'roster small inducementTable' }, h('thead', null, h('tr', null, ['Inducement', 'Cost', 'Limit', 'Bought', 'Effect'].map((c) => h('th', null, c)))), h('tbody', null, rows)),
    sevens
      ? h(
          'details',
          { class: 'why small', id: 'sevens-inducement-tables' },
          h('summary', null, 'The Sevens Prayers to Nuffle (D8) and Desperate Measures (D8) tables'),
          h('p', null, h('b', null, 'Prayers to Nuffle (Sevens, Spike! 22 p.15): '), Object.entries(E.SEVENS_PRAYERS).map(([f, n]) => `${f} ${E.PRAYERS[n].name}`).join(' · '), '. Rolled in the pre-game, duplicates rolled again; they last for the game.'),
          h('ul', null, Object.entries(E.DESPERATE).map(([f, x]) => h('li', null, h('b', null, `${f} ${x.name}: `), x.text))),
          h('p', { class: 'muted' }, 'Desperate Measures are rolled in the pre-game (duplicates rolled again) and each is used once per game: Magic Scroll at once; Hangover before the first set-up; You Dope! after both teams set up; Sports Espionage after a Turnover; Discarded Banana Skin when an opponent enters a Tackle Zone (you are asked); Razzle-Dazzle, Grudge Match and Set Piece with an Action (plan panel).'),
        )
      : null,
    !sevens
      ? h(
          'label',
          { class: 'small', title: `Mercenary Players (p.${E.MERCENARY.page}): a roster player for +30,000 gp, with Loner (4+); one Primary skill for +50,000 gp; at most three` },
          h('input', { type: 'checkbox', id: 'add-as-merc', checked: addAsMerc, onchange: (e: Event) => { addAsMerc = (e.target as HTMLInputElement).checked; } }),
          ' Add players as Mercenaries (+30,000 gp, Loner (4+), p.147)',
        )
      : null,
    h(
      'details',
      { class: 'why small', id: 'inducements-not-offered' },
      h('summary', null, `Not on this list (${notOffered.length})`),
      h('ul', null, notOffered.map((x) => h('li', null, h('b', null, `${x.name}: `), x.why, x.kind === 'unfinished' ? h('span', { class: 'warn' }, ' (not implemented yet)') : h('span', { class: 'muted' }, ' (a rules restriction)')))),
    ),
    h('p', { class: 'small muted' }, sevens ? 'League teams (11-a-side) buy their Inducements for one match in the pre-match step (Petty Cash and Treasury, p.94).' : 'Star Players are below. The Sports-Wizard (p.149) casts once per game between two Turns (match card). League teams buy Inducements for one match in the pre-match step (Petty Cash and Treasury, p.94).'),
  );
}

/** A Mercenary's chip and its optional Primary skill (+50,000 gp, p.147). */
function mercControls(t: TeamDef, p: TeamPlayerDef, touch: () => void): HTMLElement {
  const pos = t.rosterId ? E.ROSTER_BY_ID[t.rosterId]?.positions.find((x) => x.id === p.positionId) : undefined;
  const skills = (pos?.primary ?? []).flatMap((c) => E.SKILL_TABLE[c] ?? []).filter((id) => !p.skills.some((k) => k.id === id));
  return h(
    'span',
    { class: 'merc' },
    h('span', { class: 'variant-chip', title: 'Mercenary Player (p.147): +30,000 gp, Loner (4+) in the match' }, 'MERCENARY'),
    h(
      'select',
      { class: 'small merc-skill', title: 'One Primary skill for +50,000 gp (p.147)', onclick: (e: Event) => e.stopPropagation(), onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; p.mercSkill = v || undefined; touch(); } },
      h('option', { value: '' }, '+ skill (50k)'),
      skills.map((id) => h('option', { value: id, selected: p.mercSkill === id }, E.SKILL_BY_ID[id]?.name ?? id)),
    ),
  );
}

/** V5 step 6: a Tournament player's one extra skill bought with Skill Points (Primary 1, Secondary 2). */
function boughtSkillControl(t: TeamDef, p: TeamPlayerDef, touch: () => void): HTMLElement | null {
  if (p.star) return null;
  const cats = E.playerCategories(t, p);
  const opt = (c: (typeof cats.primary)[number], cost: number) => (E.SKILL_TABLE[c] ?? []).filter((id) => !p.skills.some((k) => k.id === id)).map((id) => h('option', { value: id, selected: p.boughtSkill === id }, `${E.SKILL_BY_ID[id]?.name ?? id} (${cost} SP)`));
  return h(
    'span',
    { class: 'bought' },
    p.boughtSkill ? h('span', { class: 'variant-chip bought-chip', title: 'Bought with Skill Points (Matched Play)' }, `+ ${E.SKILL_BY_ID[p.boughtSkill]?.name ?? p.boughtSkill}`) : null,
    h(
      'select',
      { class: 'small buy-skill', title: 'One extra skill for Skill Points (p.112; Sevens Spike! 22 p.19)', onclick: (e: Event) => e.stopPropagation(), onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; p.boughtSkill = v || undefined; touch(); } },
      h('option', { value: '' }, p.boughtSkill ? '— none —' : '+ skill (SP)'),
      cats.primary.length ? h('optgroup', { label: `Primary (${cats.primary.join(', ')}) — 1 SP` }, cats.primary.flatMap((c) => opt(c, 1))) : null,
      cats.secondary.length ? h('optgroup', { label: `Secondary (${cats.secondary.join(', ')}) — 2 SP` }, cats.secondary.flatMap((c) => opt(c, 2))) : null,
    ),
  );
}

function playerRow(app: App, t: TeamDef, p: TeamPlayerDef, league: boolean, touch: () => void, tournament = false) {
  const sel = app.st.teamSel === p.id;
  const stat = (k: 'ma' | 'st' | 'ag' | 'av', min: number, max: number) => (league ? num(p[k], min, max, (v) => { p[k] = v; touch(); }) : String(k === 'ag' || k === 'av' ? `${p[k]}+` : p[k]));
  const skillSel = league
    ? h(
        'select',
        {
          class: 'small',
          onchange: (e: Event) => {
            const id = (e.target as HTMLSelectElement).value;
            if (id && !p.skills.some((s) => s.id === id)) p.skills.push({ id });
            touch();
          },
        },
        h('option', { value: '' }, '+ skill'),
        E.SKILLS.map((s) => h('option', { value: s.id }, `${s.name}${s.support === 'unsupported' ? ' (not implemented)' : ''}`)),
      )
    : null;
  return h(
    'tr',
    { class: sel ? 'sel' : '', onclick: () => { app.st.teamSel = p.id; app.emit(); } },
    h('td', null, league ? num(p.number, 1, 99, (v) => { p.number = v; touch(); }) : String(p.number)),
    h('td', null, h('input', { type: 'text', value: p.name, onchange: (e: Event) => { p.name = (e.target as HTMLInputElement).value; touch(); } })),
    h(
      'td',
      null,
      p.position,
      p.veteran ? h('span', { class: 'variant-chip', title: 'Veteran (Sevens p.13): MA −1; once per game re-roll a failed pick-up, catch or Pass, or block dice that would Knock it Down' }, 'VETERAN') : null,
      p.captain ? h('span', { class: 'variant-chip captain-chip', title: 'Team Captain (p.155): gains Pro at no cost; while on the pitch, a natural 6 on a D6 after using a Team Re-roll makes it free; must be set up if able' }, 'CAPTAIN · Pro') : null,
      p.mercenary ? mercControls(t, p, touch) : null,
      p.star ? h('span', { class: 'variant-chip star-chip', title: `${E.STAR_BY_ID[p.star]?.rule.name}: ${E.STAR_BY_ID[p.star]?.rule.summary} (p.${E.STAR_BY_ID[p.star]?.page})` }, 'STAR PLAYER') : null,
      E.hasTeamCaptainRule(t) && !p.keywords.includes('Big Guy') && !p.star
        ? h('input', {
            type: 'radio',
            name: `captain-${t.id}`,
            class: 'captain-pick',
            checked: !!p.captain,
            title: 'Nominate as the Team Captain (p.155)',
            onclick: (e: Event) => {
              e.stopPropagation();
              if (!p.captain) {
                E.setCaptain(t, p.id);
                touch();
              }
            },
          })
        : null,
    ),
    h('td', null, stat('ma', 1, 9)),
    h('td', null, stat('st', 1, 7)),
    h('td', null, stat('ag', 1, 6)),
    h('td', null, league ? num(p.pa ?? 0, 0, 6, (v) => { p.pa = v === 0 ? null : v; touch(); }) : p.pa === null ? '–' : `${p.pa}+`),
    h('td', null, stat('av', 3, 12)),
    h(
      'td',
      { class: 'skillcell' },
      league
        ? h(
            'span',
            null,
            p.skills.map((s) => h('button', { class: 'chip btnchip', title: 'Remove this skill', onclick: (e: Event) => { e.stopPropagation(); p.skills = p.skills.filter((x) => x !== s); touch(); } }, `${E.skillName(s)} ✕`)),
            skillSel,
          )
        : h('span', null, skillChips({ skills: p.skills } as never), tournament ? boughtSkillControl(t, p, touch) : null),
    ),
    h(
      'td',
      null,
      league
        ? h('input', { type: 'checkbox', checked: !!p.unavailable, title: 'Misses the next match (injury, etc.)', onchange: (e: Event) => { p.unavailable = (e.target as HTMLInputElement).checked || undefined; touch(); } })
        : t.variant === 'sevens' && p.keywords.includes('Lineman')
          ? h('input', {
              type: 'radio',
              name: `veteran-${t.id}`,
              class: 'veteran-pick',
              checked: !!p.veteran,
              title: 'Veteran: MA −1, a once-per-game re-roll (Sevens p.13)',
              // Handled on click (before the row's own click re-draws the table).
              onclick: (e: Event) => {
                e.stopPropagation();
                if (!p.veteran) {
                  E.setVeteran(t, p.id);
                  touch();
                }
              },
            })
          : null,
    ),
    league
      ? h(
          'td',
          { class: 'spp' },
          num(p.spp ?? 0, 0, 999, (v) => {
            p.spp = v || undefined;
            touch();
          }),
          ' ',
          advanceButton(app, t, p),
        )
      : null,
    h('td', null, h('button', { class: 'btn small ghost', title: 'Remove this player', onclick: (e: Event) => { e.stopPropagation(); removeTeamPlayer(app, p.id); } }, '✕')),
  );
}
