/**
 * Match flow panel: pre-game, set-up editor (validated by the engine, p.47),
 * kick-off, interactive Kick-off Events, End of Drive, half-time and full time.
 */
import { renderPostGame } from './advance';
import type { App, SetupDraft } from './app';
import { h } from './dom';
import { E, type Coord, type GameState, type Roster, type TeamDef, type TeamId } from './engine-global';
import { computerOf, computerToAct } from './computer';
import { armDrag } from './drag';
import { renderWizardControls, wizardClick, wizardMarks } from './wizard';
import { ruleTag } from './panels';
import type { Marks } from './pitch';

const other = (t: TeamId): TeamId => (t === 'A' ? 'B' : 'A');

/** V5 step 6: a ready-made team for Tournament play (Matched Play) or Exhibition play. */
export interface QuickOpts {
  play?: 'tournament' | 'exhibition';
  tier?: 1 | 2 | 3 | 4;
}

/**
 * Tournament (Matched Play) teams start with 0 Dedicated Fans (p.110; Spike! 22 p.18) and carry their Tier — its
 * Skill Points are theirs to spend in the team builder (the ready-made team buys none: the same players as before).
 */
function forPlay(t: TeamDef, o: QuickOpts): void {
  if (!o.play) return;
  t.play = o.play;
  if (o.play === 'tournament') {
    t.dedicatedFans = 0;
    if (o.tier) t.tier = o.tier;
  }
}

/** A ready-made drafted team (tournament template) for demos and quick starts. */
export function quickDraft(rosterId: string, id: string, name?: string, opts: QuickOpts = {}): TeamDef {
  const r = E.ROSTER_BY_ID[rosterId];
  const t = E.newTeamDef('tournament', rosterId, name ?? r.name, id);
  forPlay(t, opts);
  const plans: Record<string, Array<[string, number]>> = {
    human: [['lineman', 7], ['blitzer', 2], ['catcher', 2], ['thrower', 1]],
    orc: [['lineman', 7], ['blitzer', 2], ['bigUn', 2]],
    tombKings: [['skeleton', 7], ['tkBlitzer', 2], ['tombGuardian', 2]],
    bretonnian: [['squire', 7], ['knightCatcher', 2], ['grailKnight', 2]],
    lizardmen: [['skink', 5], ['chameleon', 1], ['saurus', 4], ['kroxigor', 1]],
    norse: [['raider', 6], ['beerBoar', 1], ['berserker', 2], ['valkyrie', 2], ['yhetee', 1]],
    // V5: the other rosters (pp.160-190) — 11-13 players, legal for the Team Draft (checked in tests/rosters-v5.test.ts).
    amazon: [['eagleWarrior', 5], ['pythonWarrior', 2], ['piranhaWarrior', 2], ['jaguarWarrior', 2]],
    blackOrc: [['goblinBruiser', 5], ['blackOrc', 5], ['trainedTroll', 1]],
    chaosChosen: [['beastman', 7], ['chosen', 3], ['minotaur', 1]],
    chaosDwarf: [['hobgoblin', 3], ['sneakyStabba', 1], ['blocker', 4], ['bullCentaur', 2], ['flamesmith', 1]],
    chaosRenegade: [['human', 5], ['goblin', 1], ['orc', 1], ['skaven', 1], ['darkElf', 1], ['thrower', 1], ['ogre', 1]],
    darkElf: [['lineman', 7], ['runner', 1], ['blitzer', 2], ['witchElf', 1]],
    dwarf: [['lineman', 7], ['runner', 1], ['blitzer', 2], ['trollSlayer', 1]],
    elvenUnion: [['lineman', 7], ['thrower', 1], ['catcher', 1], ['blitzer', 2]],
    gnome: [['lineman', 5], ['woodlandFox', 2], ['illusionist', 1], ['beastmaster', 2], ['treeman', 1]],
    goblin: [['lineman', 6], ['ooligan', 1], ['doomDiver', 1], ['pogoer', 1], ['trainedTroll', 2]],
    halfling: [['hopeful', 7], ['hefty', 2], ['catcher', 2], ['treeman', 2]],
    highElf: [['lineman', 7], ['phoenixWarrior', 1], ['dragonPrince', 1], ['whiteLion', 2]],
    imperialNobility: [['retainer', 6], ['thrower', 1], ['bodyguard', 2], ['nobleBlitzer', 1], ['ogre', 1]],
    khorne: [['marauder', 6], ['khorngor', 2], ['bloodseeker', 3]],
    necromantic: [['zombie', 6], ['ghoul', 2], ['wraith', 1], ['fleshGolem', 1], ['werewolf', 2]],
    nurgle: [['rotter', 6], ['pestigor', 2], ['bloater', 3], ['rotspawn', 1]],
    ogre: [['gnoblar', 7], ['ogreBlocker', 4], ['runtPunter', 1]],
    oldWorldAlliance: [['humanLineman', 5], ['dwarfLineman', 2], ['halfling', 1], ['humanCatcher', 1], ['humanThrower', 1], ['humanBlitzer', 1], ['dwarfBlitzer', 1]],
    shamblingUndead: [['skeleton', 3], ['zombie', 2], ['ghoul', 2], ['wight', 2], ['mummy', 2]],
    skaven: [['clanrat', 5], ['thrower', 1], ['gutterRunner', 2], ['blitzer', 2], ['ratOgre', 1]],
    slann: [['lineman', 7], ['catcher', 2], ['blitzer', 1], ['kroxigor', 1]],
    // Linemen numbered last: the default formation fields the others first and keeps Linemen in the Reserves Box for Swarming.
    snotling: [['funHoppa', 2], ['stiltyRunna', 2], ['pumpWagon', 2], ['trainedTroll', 1], ['lineman', 7]],
    underworld: [['goblin', 4], ['snotling', 2], ['clanrat', 1], ['thrower', 1], ['gutterRunner', 1], ['blitzer', 1], ['troll', 1]],
    vampire: [['thrall', 6], ['runner', 1], ['thrower', 1], ['blitzer', 2], ['vargheist', 1]],
    woodElf: [['lineman', 7], ['thrower', 1], ['catcher', 1], ['wardancer', 2]],
  };
  let n = 1;
  for (const [pos, k] of plans[rosterId] ?? []) for (let i = 0; i < k; i++) t.players.push(E.playerFromRoster(r, pos, n, `${id}-${n++}`));
  // A roster with several Leagues (Norse) plays in the first one printed (p.152); editable in the team builder.
  if (r.leagues.length > 1) t.league = r.leagues[0];
  // "Favoured of (choose …)" (p.154): Undivided by default; editable in the team builder.
  if (r.favouredOf) t.favoured = r.favouredOf.includes('Undivided') ? 'Undivided' : r.favouredOf[0];
  // Two Team Re-rolls, an Apothecary if the roster allows one, then as many Team Re-rolls as the budget allows (max 8).
  const fits = (x: Partial<TeamDef>) => E.teamCost({ ...t, ...x }).total <= E.DRAFT_TEMPLATE.budget;
  t.rerolls = 0;
  while (t.rerolls < 2 && fits({ rerolls: t.rerolls + 1 })) t.rerolls += 1;
  t.apothecary = r.apothecary && fits({ apothecary: true });
  while (t.rerolls < 8 && fits({ rerolls: t.rerolls + 1 })) t.rerolls += 1;
  nominateCaptain(t);
  t.updatedAt = new Date().toISOString();
  return t;
}

/**
 * V5: a Sevens plan for any roster (Spike! 22 p.8): up to three non-Linemen (Big Guys only if there is
 * nothing else), in roster order, while seven players and one Team Re-roll still fit the 600,000 gp;
 * the rest Linemen (the roster's 0-16 Lineman).
 */
function sevensPlan(r: Roster): Array<[string, number]> {
  const line = r.positions.find((p) => p.keywords.includes('Lineman') && p.qty.endsWith('16')) ?? r.positions.find((p) => p.keywords.includes('Lineman'))!;
  const others = r.positions.filter((p) => !p.keywords.includes('Lineman'));
  const ordered = [...others.filter((p) => !p.keywords.includes('Big Guy')), ...others.filter((p) => p.keywords.includes('Big Guy'))];
  const plan: Array<[string, number]> = [];
  let cost = 0;
  let non = 0;
  // Insignificant Linemen (Snotlings, p.129): no more of them than other players — take the full four non-Linemen.
  const most = line.skills.some((k) => k.id === 'insignificant') ? E.SEVENS_DRAFT.maxNonLineman : 3;
  const took: Record<string, number> = {};
  // One of each non-Big Guy first, then a second of each (if the roster allows it), then a Big Guy only if still short.
  const passes = [...ordered.filter((p) => !p.keywords.includes('Big Guy')), ...ordered.filter((p) => !p.keywords.includes('Big Guy') && Number(p.qty.split('-')[1]) >= 2), ...ordered.filter((p) => p.keywords.includes('Big Guy'))];
  for (const p of passes) {
    if (non >= most) break;
    if (p.keywords.includes('Big Guy') && non >= 2 && most === 3) break;
    if (cost + p.cost + (7 - non - 1) * line.cost + E.SEVENS_DRAFT.rerollCost > E.SEVENS_DRAFT.budget) continue;
    took[p.id] = (took[p.id] ?? 0) + 1;
    cost += p.cost;
    non++;
  }
  for (const [id, k] of Object.entries(took)) plan.push([id, k]);
  plan.push([line.id, 7 - non]);
  return plan;
}

/** Team Captain (p.155): a ready-made team nominates its first Blitzer (or first non-Big Guy). */
function nominateCaptain(t: TeamDef): void {
  if (!E.hasTeamCaptainRule(t)) return;
  const c = t.players.find((p) => p.keywords.includes('Blitzer')) ?? t.players.find((p) => !p.keywords.includes('Big Guy'));
  if (c) E.setCaptain(t, c.id);
}

/**
 * A ready-made Blood Bowl Sevens team (Spike! 22 pp.8-9): at most 4 non-Linemen, 7-11 players,
 * then Team Re-rolls (100k), an Apothecary (80k) if allowed and affordable, Assistant Coaches (20k)
 * with what is left; the first Lineman is the Veteran (MA −1, p.13).
 */
export function quickSevens(rosterId: string, id: string, name?: string, opts: QuickOpts = {}): TeamDef {
  const r = E.ROSTER_BY_ID[rosterId];
  const t = E.newTeamDef('tournament', rosterId, name ?? `${r.name} Sevens`, id, 'sevens');
  forPlay(t, opts);
  const plans: Record<string, Array<[string, number]>> = {
    human: [['blitzer', 2], ['catcher', 1], ['lineman', 5]],
    orc: [['blitzer', 2], ['bigUn', 1], ['lineman', 4]],
    tombKings: [['tkBlitzer', 2], ['tombGuardian', 1], ['skeleton', 5]],
    bretonnian: [['grailKnight', 2], ['knightCatcher', 1], ['squire', 4]],
    lizardmen: [['saurus', 2], ['chameleon', 1], ['skink', 4]],
    norse: [['berserker', 1], ['valkyrie', 1], ['ulfwerener', 1], ['raider', 4]],
  };
  let n = 1;
  for (const [pos, k] of plans[rosterId] ?? sevensPlan(r)) for (let i = 0; i < k; i++) t.players.push(E.playerFromRoster(r, pos, n, `${id}-${n++}`));
  if (r.leagues.length > 1) t.league = r.leagues[0];
  if (r.favouredOf) t.favoured = r.favouredOf.includes('Undivided') ? 'Undivided' : r.favouredOf[0];
  const fits = (x: Partial<TeamDef>) => E.teamCost({ ...t, ...x }).total <= E.SEVENS_DRAFT.budget;
  while (t.rerolls < 3 && fits({ rerolls: t.rerolls + 1 })) t.rerolls += 1;
  if (r.apothecary && fits({ apothecary: true })) t.apothecary = true;
  while (t.assistantCoaches < E.SEVENS_DRAFT.maxAssistants && fits({ assistantCoaches: t.assistantCoaches + 1 })) t.assistantCoaches += 1;
  const vet = t.players.find((p) => p.keywords.includes('Lineman'));
  if (vet) E.setVeteran(t, vet.id);
  nominateCaptain(t);
  t.updatedAt = new Date().toISOString();
  return t;
}

export function startDemoMatch(app: App) {
  const a = quickDraft('tombKings', 'demo-tk', 'Tomb Kings demo team');
  const b = quickDraft('bretonnian', 'demo-bret', 'Bretonnian demo team');
  const r = E.createMatch('tournament', a, b, { rules: 'introductory', play: 'exhibition' }, Math.floor(Math.random() * 2 ** 31));
  if (!r.ok || !r.state) return app.toast(r.errors.join(' '), 'error');
  app.openBoard(r.state, { kind: 'match', matchKind: 'tournament' }, { docName: 'Demo match (introductory rules)' });
  app.toast('Demo match: roll the pre-game, then set up (kicking team first).');
}

/** A match against the computer with two ready-made drafted teams (standard, or Blood Bowl Sevens). */
export function startComputerMatch(app: App, yourRoster: string, cpuRoster: string, style: 'balanced' | 'offensive' | 'defensive', rules: 'full' | 'introductory' = 'full', difficulty?: { player: number; computer: number }, variant: 'standard' | 'sevens' = 'standard', play: { mode?: 'tournament' | 'exhibition'; youTier?: 1 | 2 | 3 | 4; cpuTier?: 1 | 2 | 3 | 4; you?: TeamDef } = {}) {
  const sevens = variant === 'sevens';
  const draft = sevens ? quickSevens : quickDraft;
  const mode = play.mode ?? 'exhibition';
  const tag = `${sevens ? ' Sevens' : ''}${mode === 'tournament' ? ' Tournament' : ''}`;
  // Your team: a saved Tournament team chosen on the Home screen (its bought skills), or the ready-made one.
  const a = play.you ?? draft(yourRoster, `quick${sevens ? '7' : ''}-${yourRoster}-you`, `${E.ROSTER_BY_ID[yourRoster].name}${tag} (you)`, { play: mode, tier: play.youTier });
  const b = draft(cpuRoster, `quick${sevens ? '7' : ''}-${cpuRoster}-cpu`, `${E.ROSTER_BY_ID[cpuRoster].name}${tag} (computer)`, { play: mode, tier: play.cpuTier });
  const r = E.createMatch('tournament', a, b, { rules, computer: { team: 'B', style }, ...(difficulty ? { difficulty } : {}), play: mode }, Math.floor(Math.random() * 2 ** 31));
  if (!r.ok || !r.state) return app.toast(r.errors.join(' '), 'error');
  app.openBoard(r.state, { kind: 'match', matchKind: 'tournament' }, { docName: `${a.name} v ${b.name}` });
  app.toast(`${sevens ? 'Blood Bowl Sevens ' : ''}${mode === 'tournament' ? 'Tournament' : 'Exhibition'} match against the computer (${style}). Roll the pre-game to start.`);
}

/** Team that must set up now (kicking team first, p.47). */
export function settingUpTeam(g: GameState): TeamId | null {
  const m = g.match;
  if (!m || g.phase !== 'driveSetup' || !m.kicking) return null;
  return m.setupDone[m.kicking] ? other(m.kicking) : m.kicking;
}

/** Make sure the set-up draft matches the current phase (default formation to start from). */
export function ensureDraft(app: App): SetupDraft | null {
  const g = app.game;
  const m = g.match;
  if (!m || app.playbackActive() || g.pending) return null;
  const cur = app.st.setupDraft;
  if (computerToAct(app)) {
    // The computer arranges its own players (no editor for its team).
    app.st.setupDraft = null;
    return null;
  }
  if (g.phase === 'driveSetup') {
    const t = settingUpTeam(g) as TeamId;
    if (cur && cur.kind === 'setup' && cur.team === t) return cur;
    app.st.setupDraft = { kind: 'setup', team: t, positions: E.defaultFormation(g, t) };
    return app.st.setupDraft;
  }
  const ph = m.pendingPhase;
  if (g.phase === 'kickoff' && (ph?.type === 'solidDefence' || ph?.type === 'quickSnap' || ph?.type === 'swarming' || ph?.type === 'dwarfenWisdom')) {
    if (cur && cur.kind === ph.type && cur.team === ph.team) return cur;
    app.st.setupDraft = { kind: ph.type, team: ph.team, positions: {} };
    return app.st.setupDraft;
  }
  app.st.setupDraft = null;
  return null;
}

function moved(g: GameState, d: SetupDraft): string[] {
  return Object.keys(d.positions).filter((id) => {
    const p = E.findPlayer(g, id);
    const to = d.positions[id];
    return !!p && !(p.pos && to && p.pos.x === to.x && p.pos.y === to.y);
  });
}

/** Board clicks during set-up / kick-off. Returns true when handled. */
/** Modifier keys of the last pitch click (set by the pitch input handler): Shift/⌘ = select without swapping. */
export const mods = { select: false };

/** V5.5: swap two players of the team being set up (or re-arranged in Solid Defence / Dwarfen Wisdom). */
function swapInDraft(app: App, d: SetupDraft, a: string, b: string) {
  const shown = app.displayGame();
  const pa = E.findPlayer(shown, a);
  const pb = E.findPlayer(shown, b);
  if (!pa || !pb) return;
  const ca = pa.location === 'pitch' && pa.pos ? { ...pa.pos } : null;
  const cb = pb.location === 'pitch' && pb.pos ? { ...pb.pos } : null;
  if (!cb) return;
  // Limited re-arrangements (Solid Defence: D3+3 players) count both players as moved.
  const ph = app.game.match?.pendingPhase;
  if (d.kind !== 'setup' && ph && 'max' in ph) {
    const before = moved(app.game, d);
    const after = new Set([...before, a, b]);
    if (after.size > (ph.max as number)) {
      app.toast(`At most ${ph.max} players can be set up again — ${before.length} already moved. Put one back first (Backspace with it selected).`, 'error');
      return;
    }
  }
  d.positions[a] = cb;
  if (ca) d.positions[b] = ca;
  else d.positions[b] = null;
  app.st.selected = null;
  app.emit();
  app.toast(ca ? `Swapped ${E.label(pa)} and ${E.label(pb)}.` : `${E.label(pa)} takes ${E.board.fmt(cb)}; ${E.label(pb)} goes to the Reserves Box.`);
}

export function matchClick(app: App, c: Coord): boolean {
  const g = app.game;
  const m = g.match;
  if (!m || app.st.ctx.kind !== 'match' || g.pending || app.playbackActive()) return false;
  if (wizardClick(app, c)) return true;
  if (computerToAct(app)) {
    app.toast('The computer is choosing — wait until it has finished.', 'error');
    return true;
  }
  const d = ensureDraft(app);
  const shown = app.displayGame();
  const occ = E.playerAt(shown, c);
  if (d) {
    if (occ && occ.team === d.team) {
      // V5.5: with one of your players selected, clicking another of yours swaps their squares (a player selected in
      // the Reserves Box takes the square and the other goes to the Reserves Box). Click the selected player again to
      // deselect it; hold Shift (or ⌘) while clicking to select another player without swapping.
      const sel = app.player(app.st.selected);
      const swap = !mods.select && sel && sel.team === d.team && sel.id !== occ.id && (d.kind === 'setup' || d.kind === 'solidDefence' || d.kind === 'dwarfenWisdom');
      if (swap) {
        swapInDraft(app, d, sel.id, occ.id);
        return true;
      }
      app.set({ selected: app.st.selected === occ.id ? null : occ.id });
      return true;
    }
    // V5.5: Quick Snap / Alert Defence: clicking a moved player's original square puts them back (undoes the move).
    if (d.kind === 'quickSnap' && !occ) {
      const sel = app.player(app.st.selected);
      if (sel && sel.team === d.team && sel.pos && sel.pos.x === c.x && sel.pos.y === c.y && sel.id in d.positions) {
        delete d.positions[sel.id];
        app.emit();
        app.toast(`${E.label(sel)} back in ${E.board.fmt(c)}.`);
        return true;
      }
    }
    const sel = app.player(app.st.selected);
    if (!sel || sel.team !== d.team) {
      app.toast(d.kind === 'setup' ? 'Select one of your players (on the pitch or in the Reserves Box), then click a square in your half — or drag the player there.' : 'Select one of your Open players first.', 'error');
      return true;
    }
    placeInDraft(app, d, sel.id, c);
    return true;
  }
  if (g.phase === 'kickoff' && !m.pendingPhase) {
    const k = app.st.kickDraft ?? { useKick: false };
    app.st.kickDraft = k;
    const kicking = m.kicking as TeamId;
    if (occ && occ.team === kicking) {
      k.kicker = occ.id;
      k.useKick = E.hasSkill(occ, 'kick');
    } else if (E.inOwnHalf(other(kicking), c)) k.target = { ...c };
    else app.toast(E.isSevens(g) ? "Sevens: place the kick in the receiving team's area, between its End Zone and its Line of Scrimmage — not in No Man's Land." : "Place the kick in the opponent's half (p.47).", 'error');
    app.emit();
    return true;
  }
  return false;
}

/** The pending kick-off phase is the Sevens Alert Defence (kicking team, one square each). */
function alertDefence(g: GameState): boolean {
  const ph = g.match?.pendingPhase;
  return ph?.type === 'quickSnap' && !!ph.alert;
}

/** Why a player of the drafting team may not go to square c (null = allowed). Same rules for clicks and drags. */
export function setupDropReason(app: App, d: SetupDraft, playerId: string, c: Coord): string | null {
  const occ = E.playerAt(app.displayGame(), c);
  if (occ && occ.id !== playerId) return 'That square is occupied.';
  if (d.kind === 'swarming') {
    const p = E.findPlayer(app.game, playerId);
    if (!p || p.location !== 'reserves' || !p.keywords.includes('Lineman')) return 'Swarming: only Lineman players from the Reserves Box can be set up now (p.155).';
    const ph = app.game.match?.pendingPhase;
    const placed = Object.keys(d.positions).filter((id) => d.positions[id] && id !== playerId).length;
    if (ph?.type === 'swarming' && placed >= ph.max) return `Swarming: at most ${ph.max} more Linemen (D3 rolled).`;
  }
  // V5.5: Alert Defence / Quick Snap / Solid Defence / Dwarfen Wisdom move a limited number of players: a player not
  // yet moved cannot be moved once the limit is reached (put one back first — Backspace, or its original square).
  const phx = app.game.match?.pendingPhase;
  if ((d.kind === 'quickSnap' || d.kind === 'solidDefence' || d.kind === 'dwarfenWisdom') && phx && 'max' in phx) {
    const already = moved(app.game, d).filter((id) => id !== playerId);
    const orig = E.findPlayer(app.game, playerId)?.pos;
    const back = !!orig && orig.x === c.x && orig.y === c.y;
    if (!back && already.length >= (phx.max as number)) return `${d.kind === 'quickSnap' ? (alertDefence(app.game) ? 'Alert Defence' : 'Quick Snap') : d.kind === 'solidDefence' ? 'Solid Defence' : 'Dwarfen Wisdom'}: at most ${phx.max} player${phx.max === 1 ? '' : 's'} — ${already.length} already moved. Put one back first (select it and press Backspace).`;
  }
  if (d.kind === 'quickSnap') {
    const from = E.findPlayer(app.game, playerId)?.pos;
    if (!from || Math.max(Math.abs(from.x - c.x), Math.abs(from.y - c.y)) !== 1) return `${alertDefence(app.game) ? 'Alert Defence' : 'Quick Snap'}: a player moves exactly one square (p.48).`;
  } else if (!E.inOwnHalf(d.team, c)) return E.isSevens(app.game) ? "Sevens: set up between your End Zone and your Line of Scrimmage — never in No Man's Land (Sevens p.10)." : 'Players set up in their own half (p.47).';
  return null;
}

function placeInDraft(app: App, d: SetupDraft, playerId: string, c: Coord) {
  app.st.selected = playerId;
  const why = setupDropReason(app, d, playerId, c);
  if (why) {
    app.emit();
    app.toast(why, 'error');
    return;
  }
  d.positions[playerId] = { ...c };
  app.emit();
}

/**
 * Put a player of the team now setting up (or moving in Solid Defence / Quick
 * Snap) on square c — the shared path for clicks and drags in every match mode.
 * The engine still validates the whole set-up on Confirm (p.47).
 */
export function matchPlace(app: App, playerId: string, c: Coord): boolean {
  const g = app.game;
  if (!g.match || app.st.ctx.kind !== 'match' || g.pending || app.playbackActive()) return false;
  if (computerToAct(app)) {
    app.toast('The computer is choosing — wait until it has finished.', 'error');
    return true;
  }
  const d = ensureDraft(app);
  const p = app.player(playerId);
  if (!d || !p) return false;
  if (p.team !== d.team) {
    app.toast(`It is ${g.teams[d.team].name}'s set-up: only their players can be placed now.`, 'error');
    return true;
  }
  placeInDraft(app, d, playerId, c);
  return true;
}

/** Delete / Backspace in a set-up: the selected player goes back to the Reserves Box (nothing is deleted). */
export function setupRemoveSelected(app: App): boolean {
  const d = app.st.setupDraft;
  const sel = app.player(app.st.selected);
  // V5.5: in Alert Defence / Quick Snap / Solid Defence / Dwarfen Wisdom, Backspace puts the selected player back.
  if (d && sel && sel.team === d.team && (d.kind === 'quickSnap' || d.kind === 'solidDefence' || d.kind === 'dwarfenWisdom')) {
    if (!(sel.id in d.positions)) return false;
    delete d.positions[sel.id];
    app.st.selected = null;
    app.toast(`${E.label(sel)} back where they were.`);
    return true;
  }
  if (!d || (d.kind !== 'setup' && d.kind !== 'swarming') || !sel || sel.team !== d.team) return false;
  if (d.kind === 'swarming') {
    if (!(sel.id in d.positions)) return false;
    delete d.positions[sel.id];
    app.st.selected = null;
    app.toast(`${E.label(sel)} back in the Reserves Box.`);
    return true;
  }
  d.positions[sel.id] = null;
  app.st.selected = null;
  app.toast(`${E.label(sel)} moved to the Reserves Box.`);
  return true;
}

/**
 * Pitch marks of a match (set-up areas, Line of Scrimmage, kick targets, a planned Wizard spell). V5.5: a plain
 * function imported by lessons.ts — registering it at module start could be undone by the bundle's module order.
 */
export function matchMarks(app: App): Marks {
  const g = app.game;
  const m = g.match;
  if (app.st.wizardDraft && !app.playbackActive()) return wizardMarks(app);
  const marks: Marks = { squares: [] };
  if (!m || app.st.ctx.kind !== 'match' || app.playbackActive() || computerToAct(app)) return marks;
  const d = app.st.setupDraft;
  if (g.phase === 'driveSetup' && d) {
    E.usePitch(g);
    const geo = E.pitch();
    for (let y = geo.wide; y < geo.h - geo.wide; y++) marks.squares!.push({ c: { x: E.losColumn(d.team), y }, cls: 'los' });
    const sel = app.player(app.st.selected);
    if (sel && sel.team === d.team) {
      for (let x = 0; x < geo.w; x++) for (let y = 0; y < geo.h; y++) if (E.inOwnHalf(d.team, { x, y }) && !E.playerAt(app.displayGame(), { x, y })) marks.squares!.push({ c: { x, y }, cls: 'half' });
    }
  }
  if (g.phase === 'kickoff' && !m.pendingPhase) {
    const kicking = m.kicking as TeamId;
    const k = app.st.kickDraft;
    marks.good = E.kickerCandidates(g, kicking).map((p) => p.id).filter((id) => id !== k?.kicker);
    if (k?.kicker) marks.bad = [];
    if (k?.target) marks.squares!.push({ c: k.target, cls: 'target', label: '⊕' });
  }
  if (g.phase === 'kickoff' && m.pendingPhase?.type === 'swarming' && d) {
    const ph = m.pendingPhase;
    marks.good = E.swarmingCandidates(g, ph.team).filter((p) => !(p.id in d.positions)).map((p) => p.id);
    const sel = app.player(app.st.selected);
    if (sel && sel.team === ph.team) {
      E.usePitch(g);
      const geo = E.pitch();
      for (let x = 0; x < geo.w; x++) for (let y = 0; y < geo.h; y++) if (E.inOwnHalf(ph.team, { x, y }) && !E.playerAt(app.displayGame(), { x, y })) marks.squares!.push({ c: { x, y }, cls: 'half' });
    }
  }
  if (g.phase === 'kickoff' && m.pendingPhase?.type === 'dwarfenWisdom') {
    const ph = m.pendingPhase;
    marks.good = g.players.filter((p) => p.team === ph.team && p.location === 'pitch').map((p) => p.id);
  }
  if (g.phase === 'kickoff' && (m.pendingPhase?.type === 'solidDefence' || m.pendingPhase?.type === 'quickSnap')) {
    const ph = m.pendingPhase;
    marks.good = g.players.filter((p) => p.team === ph.team && p.location === 'pitch' && E.isOpen(g, p)).map((p) => p.id);
    const sel = app.player(app.st.selected);
    const shown = app.displayGame();
    if (sel && sel.team === ph.team && ph.type === 'quickSnap' && sel.pos) {
      const orig = E.findPlayer(g, sel.id)?.pos as Coord;
      for (const n of E.board.neighbours(orig)) if (!E.playerAt(shown, n)) marks.squares!.push({ c: n, cls: 'choice' });
    }
  }
  return marks;
}

// ---------------------------------------------------------------------------
// Side panel
// ---------------------------------------------------------------------------

const WEATHER: Record<string, string> = { perfect: 'Perfect Conditions', verySunny: 'Very Sunny', pouringRain: 'Pouring Rain', blizzard: 'Blizzard', swelteringHeat: 'Sweltering Heat' };

/** V5 step 6: "Sevens Tournament match", "Exhibition match", "League match"… */
export function matchModeLabel(g: GameState): string {
  const m = g.match;
  if (!m) return '';
  const mode = m.kind === 'league' ? 'League' : m.allStar ? 'All-Star' : m.options.play === 'tournament' ? 'Tournament' : 'Exhibition';
  return `${E.isSevens(g) ? 'Sevens ' : ''}${mode} match`;
}

export function renderMatchPanel(app: App): HTMLElement | null {
  const g = app.game;
  const m = g.match;
  if (!m || app.st.ctx.kind !== 'match') return null;
  const name = (t: TeamId) => g.teams[t].name;
  const head = h(
    'div',
    { class: 'row-between' },
    h('span', { class: 'pill', id: 'match-mode' }, `${matchModeLabel(g)}${m.options.rules === 'introductory' ? ' · introductory rules' : ''}${m.options.coaches?.A && m.options.coaches?.B ? ' · computer v computer' : m.options.computer ? ' · vs computer' : ''}`),
    h('span', { class: 'small muted' }, `Half ${m.half} · Drive ${m.drive || '–'}`),
  );
  const card = h('div', { class: 'card matchcard' }, head);
  // Leagues and team special rules (pp.152-155), e.g. "Norse: Chaos Clash · Favoured of Khorne".
  const lg = (['A', 'B'] as TeamId[]).filter((t) => g.teams[t].league || g.teams[t].specialRules?.length);
  if (lg.length)
    card.appendChild(
      h(
        'p',
        { class: 'small muted', id: 'match-leagues', title: 'Leagues and team special rules (pp.152-155). Team Captain, Brawlin\' Brutes (League SPP) and Masters of Undeath are played by the rules engine; Favoured of… and Leagues only matter for Star Players and Inducements.' },
        lg.map((t) => `${name(t)}: ${[g.teams[t].league, ...(g.teams[t].specialRules ?? [])].filter(Boolean).join(' · ')}`).join(' — '),
      ),
    );
  // V5 step 6: Tournament (Matched Play) — each team's Tier and Skill Points (p.112; Sevens Spike! 22 p.19).
  const mt = (['A', 'B'] as TeamId[]).filter((t) => m.matched?.[t]);
  if (mt.length)
    card.appendChild(
      h(
        'p',
        { class: 'small muted', id: 'match-skillpoints' },
        'Skill Points — ',
        mt.map((t) => { const x = m.matched![t]!; return `${name(t)}: Tier ${x.tier}, ${x.spent} of ${x.allowance} spent${x.skills.length ? ` (${x.skills.map((k) => { const [n, id] = k.split(' '); return `${n} ${E.SKILL_BY_ID[id]?.name ?? id}`; }).join(', ')})` : ''}`; }).join(' — '),
      ),
    );
  // V5: Inducements bought on the Team Draft Lists (pp.141-147) and what is left of the once-per-game ones.
  const indTeams = (['A', 'B'] as TeamId[]).filter((t) => Object.keys(m.inducements?.[t] ?? {}).length);
  if (indTeams.length)
    card.appendChild(
      h(
        'p',
        { class: 'small muted', id: 'match-inducements' },
        'Inducements — ',
        indTeams
          .map((t) => `${name(t)}: ${Object.entries(m.inducements![t]).map(([id, k]) => `${k > 1 ? `${k} × ` : ''}${E.INDUCEMENT_BY_ID[id]?.name ?? id}${['weatherMage', 'mortuaryAssistant', 'plagueDoctor', 'wanderingApothecary', 'josefBugman', 'wizard'].includes(id) && E.induceLeft(g, t, id) < k ? ' (used)' : ''}`).join(', ')}`)
          .join(' — '),
      ),
    );
  // V5.5: Blood Bowl Sevens Desperate Measures (Spike! 22 p.15): what each team rolled and what is used.
  const dmTeams = (['A', 'B'] as TeamId[]).filter((t) => (m.desperate?.[t] ?? []).length);
  if (dmTeams.length)
    card.appendChild(
      h(
        'p',
        { class: 'small muted', id: 'match-desperate' },
        'Desperate Measures — ',
        dmTeams.map((t) => `${name(t)}: ${(m.desperate![t] ?? []).map((n) => `${E.DESPERATE[n].name}${(m.desperateUsed?.[t] ?? []).includes(n) ? ' (used)' : ''}`).join(', ')}`).join(' — '),
      ),
    );
  // Star Players hired (p.148): the special rule and whether it has been used.
  const starTeams = (['A', 'B'] as TeamId[]).filter((t) => g.players.some((q) => q.team === t && q.star));
  if (starTeams.length)
    card.appendChild(
      h(
        'p',
        { class: 'small muted', id: 'match-stars' },
        'Star Players — ',
        starTeams
          .map((t) => `${name(t)}: ${g.players.filter((q) => q.team === t && q.star).map((q) => { const st = E.STAR_BY_ID[q.star as string]; return `${st?.name ?? q.star} (${st?.rule.name}${st && st.rule.per !== 'always' && !E.starReady(g, q, st.id) ? ', used' : ''})`; }).join(', ')}`)
          .join(' — '),
      ),
    );
  // Prayers to Nuffle received in the pre-game (p.143).
  const prTeams = (['A', 'B'] as TeamId[]).filter((t) => E.prayersOf(g, t).length);
  if (prTeams.length)
    card.appendChild(
      h(
        'p',
        { class: 'small muted', id: 'match-prayers' },
        'Prayers to Nuffle — ',
        prTeams.map((t) => `${name(t)}: ${E.prayersOf(g, t).map((n) => E.PRAYERS[n].name).join(', ')}`).join(' — '),
      ),
    );
  // Throw a Rock (Prayer 14): at the start of your Turn, before any activation.
  const tr = g.turn.active;
  if (g.phase === 'play' && !g.pending && !E.throwARockReason(g, tr) && computerOf(app)?.team !== tr)
    card.appendChild(h('div', { class: 'btnrow small', id: 'throw-a-rock' }, h('span', null, 'Throw a Rock (Prayer to Nuffle, once per game): a random opposition player on the pitch is Knocked Down on a 4+. '), h('button', { class: 'btn small', id: 'throw-a-rock-btn', onclick: () => app.runSimple({ kind: 'throwARock', team: tr }) }, 'Throw a Rock')));
  // Weather Mage (p.144): at the start of one of your Turns, before any player is activated.
  const wm = g.turn.active;
  if (g.phase === 'play' && !m.pendingPhase && !g.pending && E.induceLeft(g, wm, 'weatherMage') > 0 && !g.turn.activation && !g.players.some((p) => p.team === wm && p.activated) && computerOf(app)?.team !== wm) {
    let mod = 0;
    card.appendChild(
      h(
        'div',
        { class: 'btnrow small', id: 'weather-mage' },
        h('span', null, 'Weather Mage (once per game): roll on the Weather Table with '),
        h('select', { id: 'weather-mage-mod', onchange: (e: Event) => (mod = Number((e.target as HTMLSelectElement).value)) }, [-2, -1, 0, 1, 2].map((v) => h('option', { value: String(v), selected: v === 0 }, v > 0 ? `+${v}` : String(v)))),
        h('button', { class: 'btn small', id: 'weather-mage-btn', onclick: () => app.runSimple({ kind: 'weatherMage', team: wm, modifier: mod }) }, 'Use the Weather Mage'),
      ),
    );
  }
  // Sports-Wizard (p.149): plan the spell here, target it on the pitch, then cast (V5 step 6).
  const wz = renderWizardControls(app);
  if (wz) card.appendChild(wz);
  const dif = m.options.computer && m.options.difficulty;
  if (dif && (dif.player || dif.computer)) {
    const nm = (lv: number) => E.D6_LEVEL_NAMES[lv].replace(/ \(.*/, '');
    card.appendChild(h('p', { class: 'small warn', id: 'house-rule-line', title: 'Optional difficulty chosen when the match was created (not standard Blood Bowl): every consequential roll is weighed by who its result helps; the previews use the same odds.' }, `House rule: difficulty — human side ${nm(dif.player)}, computer side ${nm(dif.computer)} (${m.options.computer ? `${g.teams[m.options.computer.team].name} is the computer side` : ''}).`));
  }
  if (g.variant === 'sevens' && m.options.sevensOnTheBall === 'ownArea') card.appendChild(h('p', { class: 'small muted', id: 'otb-rule-line' }, "Optional NAF recommendation: On the Ball at the kick-off may not move into No Man's Land (the GW ruling allows it)."));
  if (m.fanFactor) card.appendChild(h('p', { class: 'small muted' }, `Fan Factor ${name('A')} ${m.fanFactor.A}, ${name('B')} ${m.fanFactor.B} · ${WEATHER[g.weather]}`));
  if (m.kickoffEvent && (g.phase === 'kickoff' || g.phase === 'play')) card.appendChild(h('p', { class: 'small' }, `Kick-off Event: ${m.kickoffEvent.roll} — ${m.kickoffEvent.name} `, ruleTag(E.rulesFor(g).refs.events)));
  if (g.pending || app.playbackActive()) return card;
  const cpu = computerOf(app);
  if (cpu && computerToAct(app) && g.phase !== 'play') {
    const what = g.phase === 'driveSetup' ? 'sets up its players' : g.phase === 'kickoff' && m.pendingPhase ? (m.pendingPhase.type === 'solidDefence' ? 'uses Solid Defence' : m.pendingPhase.type === 'swarming' ? 'sets up its Swarming Linemen' : m.pendingPhase.type === 'dwarfenWisdom' ? "uses Josef Bugman's Dwarfen Wisdom" : 'uses Quick Snap') : 'kicks off';
    card.appendChild(h('h3', null, `${name(cpu.team)} (computer) ${what}`));
    card.appendChild(h('p', { class: 'small muted' }, app.st.computer.paused ? 'The computer is paused — press Resume in its card.' : 'One moment…'));
    return card;
  }
  switch (g.phase) {
    case 'pregame':
      card.appendChild(h('h3', null, 'Pre-game'));
      card.appendChild(
        h(
          'p',
          { class: 'small' },
          m.options.rules === 'full' ? 'Roll Fan Factor (D3 + Dedicated Fans) for each team, then the Weather (2D6), then roll off: the winner chooses to kick or receive. ' : 'Introductory rules: both teams have equal Fan Factor and the Weather is Perfect Conditions. Roll off: the winner chooses to kick or receive. ',
          ruleTag(E.MATCH_RULES.structure),
          ruleTag(E.MATCH_RULES.kicking),
        ),
      );
      card.appendChild(h('button', { class: 'btn primary', id: 'pregame-btn', onclick: () => app.runSimple({ kind: 'pregame' }) }, 'Roll the pre-game sequence'));
      break;
    case 'driveSetup':
      renderSetup(app, card);
      break;
    case 'kickoff':
      if (m.pendingPhase?.type === 'solidDefence' || m.pendingPhase?.type === 'quickSnap' || m.pendingPhase?.type === 'dwarfenWisdom') renderEventSetup(app, card);
      else if (m.pendingPhase?.type === 'swarming') renderSwarming(app, card);
      else renderKickoff(app, card);
      break;
    case 'play':
      if (m.pendingPhase?.type === 'charge') {
        const ph = m.pendingPhase;
        card.appendChild(
          h(
            'div',
            { class: 'banner-inline' },
            h('b', null, 'Charge! '),
            `${name(ph.team)} may activate up to ${ph.max} Open players for a free Move (one may Blitz${ph.blitz ? ' — used' : ''}, one may Throw a Team-mate${ph.ttm ? ' — used' : ''}, one may Kick a Team-mate${ph.ktm ? ' — used' : ''}). ${ph.activated.length} activated. A selected player who Falls Over or is Knocked Down ends the Charge. `,
            ruleTag(E.rulesFor(g).refs.events),
          ),
        );
        card.appendChild(h('button', { class: 'btn', id: 'end-charge', onclick: () => app.runSimple({ kind: 'endCharge' }) }, 'End the Charge (the ball lands)'));
      }
      break;
    case 'touchdown':
    case 'halfOver': {
      const td = g.touchdown;
      card.appendChild(h('h3', null, g.phase === 'touchdown' && td ? `Touchdown for ${name(td.team)}!` : m.half === 1 ? 'End of the first half' : 'End of the second half'));
      card.appendChild(h('p', null, `Score: ${name('A')} ${g.teams.A.score} – ${g.teams.B.score} ${name('B')}.`));
      card.appendChild(
        h('p', { class: 'small' }, 'End of Drive: Secret Weapons are Sent-off, end-of-Drive effects (Weather first), Knocked-out players try to recover on 4+, then the next Drive — or half-time / full time. ', ruleTag(E.MATCH_RULES.endOfDrive), ruleTag(E.MATCH_RULES.restart)),
      );
      card.appendChild(h('button', { class: 'btn primary', id: 'next-drive', onclick: () => app.runSimple({ kind: 'nextDrive' }) }, m.half === 2 && g.phase === 'halfOver' ? 'Final whistle' : 'End the Drive'));
      break;
    }
    case 'fullTime': {
      const r = m.result;
      card.appendChild(h('h3', null, 'Full time'));
      card.appendChild(h('p', { class: 'big' }, `${name('A')} ${g.teams.A.score} – ${g.teams.B.score} ${name('B')}`));
      card.appendChild(h('p', null, r?.winner ? `${name(r.winner)} win.` : 'A draw.'));
      if (m.kind === 'league') card.appendChild(renderPostGame(app));
      card.appendChild(h('p', { class: 'small muted' }, m.kind === 'league' ? 'Winnings, Dedicated Fans, lasting injuries, hiring, Extra Time and Penalties are not part of this app.' : E.isSevens(g) ? 'Blood Bowl Sevens Exhibition match: Sevens League advancement (a random skill per game), Extra Time and Penalties are not part of this app.' : 'The post-game sequence (winnings, advancement), Extra Time and Penalties are not part of this app; Tournament / Exhibition teams do not earn Star Player Points.'));
      card.appendChild(h('div', { class: 'btnrow' }, h('button', { class: 'btn', id: 'fulltime-new', onclick: () => app.set({ screen: 'newMatch', quickEdit: undefined, setupMode: m.kind === 'league' ? 'league' : m.allStar ? 'allstar' : m.options.play ?? 'exhibition', teamKind: m.kind === 'league' ? 'league' : m.options.play ?? 'exhibition', teamFormat: E.isSevens(g) ? 'sevens' : 'standard' }) }, 'New match'), h('button', { class: 'btn ghost', onclick: () => app.set({ screen: 'home' }) }, 'Home')));
      break;
    }
  }
  return card;
}

/**
 * V4: the current match step as a compact bar for the dice tray next to the
 * board (pre-game roll, set-up, kick-off, Kick-off Event set-ups, Charge!,
 * End of Drive) — the same actions as the side panel's match card, so the
 * usual flow of a match needs no trip to the panel. Null when there is no
 * step for the human coach to take.
 */
export function matchStepBar(app: App): HTMLElement | null {
  const g = app.game;
  const m = g.match;
  if (!m || app.st.ctx.kind !== 'match' || g.pending || app.playbackActive() || app.st.draft) return null;
  if (computerOf(app) && computerToAct(app)) return null;
  const bar = (hint: string, ...btns: Array<HTMLElement | null>) => h('div', { class: 'trayidle matchstep', id: 'tray-matchstep' }, h('span', { class: 'small' }, hint), ...btns);
  const btn = (label: string, id: string, run: () => void, opts: { primary?: boolean; disabled?: boolean } = {}) => h('button', { class: `btn small ${opts.primary ? 'primary' : ''}`, id, disabled: !!opts.disabled, onclick: run }, label);
  switch (g.phase) {
    case 'pregame':
      return bar('Pre-game: Fan Factor, Weather and the roll-off.', btn('Roll the pre-game sequence', 'tray-pregame', () => app.runSimple({ kind: 'pregame' }), { primary: true }));
    case 'driveSetup': {
      const d = ensureDraft(app) as SetupDraft | null;
      if (!d || d.kind !== 'setup') return null;
      const t = d.team;
      const shown = app.displayGame();
      const on = shown.players.filter((q) => q.team === t && q.location === 'pitch').length;
      const errors = E.validateDriveSetup(shown, t).filter((i) => i.level === 'error').length;
      return bar(
        `Set-up: ${on} on the pitch${errors ? ` — ${errors} problem${errors === 1 ? '' : 's'} (see the panel)` : ' — legal'}.`,
        btn('Default formation', 'tray-default-formation', () => { d.positions = E.defaultFormation(g, t); app.emit(); }),
        btn('Confirm set-up', 'tray-confirm-setup', () => app.runSimple({ kind: 'setupTeam', team: t, positions: { ...d.positions } }), { primary: true }),
      );
    }
    case 'kickoff': {
      const ph = m.pendingPhase;
      if (ph?.type === 'swarming') {
        const d = ensureDraft(app) as SetupDraft | null;
        if (!d) return null;
        const n = Object.keys(swarmPositions(d)).length;
        return bar(
          `Swarming: ${n} of up to ${ph.max} more Linemen placed (select one in the Reserves Box, then a square).`,
          btn('Place them for me', 'tray-swarming-default', () => { d.positions = { ...E.defaultSwarming(g, ph.team) }; app.emit(); }),
          btn(n ? 'Confirm' : 'Confirm (none)', 'tray-confirm-swarming', () => app.runSimple({ kind: 'swarming', positions: swarmPositions(d) }), { primary: true }),
        );
      }
      if (ph?.type === 'solidDefence' || ph?.type === 'quickSnap' || ph?.type === 'dwarfenWisdom') {
        const d = ensureDraft(app) as SetupDraft | null;
        if (!d) return null;
        const n = moved(g, d).length;
        const sd = ph.type !== 'quickSnap';
        return bar(
          `${ph.type === 'dwarfenWisdom' ? 'Dwarfen Wisdom' : ph.type === 'solidDefence' ? 'Solid Defence' : alertDefence(g) ? 'Alert Defence' : 'Quick Snap'}: ${n} of ${ph.max} players ${sd ? 'set up again' : 'moved'}.`,
          btn(n ? 'Confirm' : 'Confirm (no changes)', 'tray-confirm-event', () => {
            const pos: Record<string, Coord> = {};
            for (const id of moved(g, d)) pos[id] = d.positions[id] as Coord;
            app.runSimple(eventInput(ph.type, pos));
          }, { primary: true }),
        );
      }
      if (ph) return null;
      const k = app.st.kickDraft ?? (app.st.kickDraft = { useKick: false });
      const kicker = app.player(k.kicker);
      return bar(
        `Kick-off: click the kicker${kicker ? ` (${E.label(kicker)})` : ''}, then the target square${k.target ? ` (${E.board.fmt(k.target)})` : ''}.`,
        btn('Kick off!', 'tray-kickoff', () => app.runSimple({ kind: 'kickoff', kicker: k.kicker as string, target: k.target as Coord, useKick: k.useKick }), { primary: true, disabled: !k.kicker || !k.target }),
      );
    }
    case 'play':
      if (m.pendingPhase?.type === 'charge') return bar(`Charge!: ${m.pendingPhase.activated.length} of ${m.pendingPhase.max} players activated.`, btn('End the Charge', 'tray-end-charge', () => app.runSimple({ kind: 'endCharge' })));
      return null;
    case 'touchdown':
    case 'halfOver':
      return bar(g.phase === 'touchdown' ? 'Touchdown! End of the Drive.' : `End of the ${m.half === 1 ? 'first' : 'second'} half.`, btn(m.half === 2 && g.phase === 'halfOver' ? 'Final whistle' : 'End the Drive', 'tray-next-drive', () => app.runSimple({ kind: 'nextDrive' }), { primary: true }));
    default:
      return null;
  }
}

function issuesList(issues: Array<{ level: string; text: string }>) {
  if (!issues.length) return h('p', { class: 'small good' }, '✓ This set-up is legal.');
  return h('ul', { class: 'issues small' }, issues.map((i) => h('li', { class: i.level === 'error' ? 'bad' : 'warn' }, i.text)));
}

function renderSetup(app: App, card: HTMLElement) {
  const g = app.game;
  const d = ensureDraft(app) as SetupDraft;
  const t = d.team;
  const shown = app.displayGame();
  const kicking = g.match!.kicking as TeamId;
  card.appendChild(h('h3', null, `${g.teams[t].name}: set up (${t === kicking ? 'kicking — sets up first' : 'receiving'})`));
  card.appendChild(
    h(
      'p',
      { class: 'small' },
      E.isSevens(g)
        ? `Blood Bowl Sevens: 7 players (or all available) between your End Zone and your Line of Scrimmage — never in No Man's Land (the lighter middle area); at least 3 on the Line of Scrimmage in the Centre Field (the highlighted column); at most 1 in each Wide Zone. Select a player, then click a square — or drag a player from the Reserves Box or the pitch. Delete/Backspace (or dragging back here) sends a player to the Reserves Box. `
        : `11 players (or all available) in your own half; at least 3 on the Line of Scrimmage in the Centre Field (the highlighted column); at most 2 in each Wide Zone. Select a player, then click a square — or drag a player from the Reserves Box or the pitch. Delete/Backspace (or dragging back here) sends a player to the Reserves Box. `,
      ruleTag(E.isSevens(g) ? E.rulesFor(g).refs.setup : E.MATCH_RULES.setup),
    ),
  );
  card.appendChild(issuesList(E.validateDriveSetup(shown, t)));
  const reserves = shown.players.filter((p) => p.team === t && p.location === 'reserves' && !p.benched);
  const unavailable = shown.players.filter((p) => p.team === t && (p.location === 'ko' || p.location === 'cas' || p.location === 'sentOff' || p.benched));
  card.appendChild(
    h(
      'div',
      { class: 'reserves' },
      h('div', { class: 'section-label' }, `Reserves Box (${reserves.length})`),
      reserves.length ? h('div', { class: 'chips' }, reserves.map((p) => h('button', { class: `chip btnchip ${app.st.selected === p.id ? 'on' : ''}`, 'data-player': p.id, title: 'Click to select, then click a square in your half — or drag onto the pitch', onpointerdown: (ev: PointerEvent) => armDrag(app, ev, p.id, E.label(p)), onclick: () => app.set({ selected: app.st.selected === p.id ? null : p.id }) }, `#${p.number} ${p.position}`))) : h('p', { class: 'small muted' }, 'Everyone available is on the pitch.'),
      unavailable.length ? h('p', { class: 'small muted' }, `Not available: ${unavailable.map((p) => `#${p.number} (${p.benched ? 'heat' : p.location})`).join(', ')}`) : null,
    ),
  );
  card.appendChild(
    h(
      'div',
      { class: 'btnrow' },
      h('button', { class: 'btn', onclick: () => { d.positions = E.defaultFormation(g, t); app.emit(); } }, 'Default formation'),
      h('button', { class: 'btn ghost', onclick: () => { for (const id of Object.keys(d.positions)) d.positions[id] = null; app.emit(); } }, 'Clear'),
      h('button', { class: 'btn primary', id: 'confirm-setup', onclick: () => app.runSimple({ kind: 'setupTeam', team: t, positions: { ...d.positions } }) }, 'Confirm set-up'),
    ),
  );
  card.appendChild(h('p', { class: 'small muted' }, 'Confirming asks the rules engine to check the set-up; an illegal set-up is rejected with the reason and nothing changes.'));
}

function renderKickoff(app: App, card: HTMLElement) {
  const g = app.game;
  const m = g.match!;
  const kicking = m.kicking as TeamId;
  const k = app.st.kickDraft ?? (app.st.kickDraft = { useKick: false });
  const kicker = app.player(k.kicker);
  card.appendChild(h('h3', null, `${g.teams[kicking].name} kick off`));
  card.appendChild(
    h(
      'p',
      { class: 'small' },
      E.isSevens(g)
        ? "Click your kicking player (highlighted: not on the Line of Scrimmage or in a Wide Zone unless there is no other option), then the target square in the receiving team's area. Sevens: the kick Deviates D8 direction and the LOWER of two D6 squares; a ball that comes down in No Man's Land is still in play — only leaving the pitch or crossing your own Line of Scrimmage is a Touchback. "
        : "Click your kicking player (highlighted: not on the Line of Scrimmage or in a Wide Zone unless there is no other option), then the target square in the opponent's half. The kick Deviates D8 direction and D6 squares, ",
      m.options.rules === 'full' ? `then the Kick-off Event is rolled (2D6${E.isSevens(g) ? ', Sevens table' : ''}), ` : '',
      'then the ball lands. ',
      ruleTag(E.isSevens(g) ? E.rulesFor(g).refs.kickoff : E.MATCH_RULES.kickoff),
      ruleTag(E.MATCH_RULES.touchback),
    ),
  );
  card.appendChild(h('p', null, 'Kicker: ', h('b', null, kicker ? E.label(kicker) : '—'), ' · Target: ', h('b', null, k.target ? E.board.fmt(k.target) : '—')));
  if (kicker && E.hasSkill(kicker, 'kick')) card.appendChild(h('label', { class: 'small check' }, h('input', { type: 'checkbox', checked: k.useKick, onchange: (e: Event) => { k.useKick = (e.target as HTMLInputElement).checked; app.emit(); } }), ' Use Kick: Deviate D3 instead of D6 (p.130)'));
  card.appendChild(
    h('button', { class: 'btn primary', id: 'kickoff-btn', disabled: !k.kicker || !k.target, onclick: () => app.runSimple({ kind: 'kickoff', kicker: k.kicker as string, target: k.target as Coord, useKick: k.useKick }) }, 'Kick off!'),
  );
}

/** Swarming (p.155): the extra Linemen from the Reserves Box, placed like a set-up. */
function swarmPositions(d: SetupDraft): Record<string, Coord> {
  const pos: Record<string, Coord> = {};
  for (const id of Object.keys(d.positions)) if (d.positions[id]) pos[id] = d.positions[id] as Coord;
  return pos;
}

function renderSwarming(app: App, card: HTMLElement) {
  const g = app.game;
  const ph = g.match!.pendingPhase as { type: 'swarming'; team: TeamId; max: number };
  const d = ensureDraft(app) as SetupDraft;
  const n = Object.keys(swarmPositions(d)).length;
  card.appendChild(h('h3', null, `Swarming — ${g.teams[ph.team].name}`));
  card.appendChild(
    h(
      'p',
      { class: 'small', id: 'swarming-info' },
      `Set up up to ${ph.max} more Lineman player${ph.max === 1 ? '' : 's'} from the Reserves Box (D3 rolled), following the usual set-up rules — the team may have more than ${E.rulesFor(g).playersPerDrive} players on the pitch this Drive. Select a Lineman in the Reserves Box, then click a square in your half (or drag him there). Placed: ${n} of ${ph.max}. `,
      ruleTag(E.SWARMING_RULE),
    ),
  );
  const trial = E.validateInput(g, { kind: 'swarming', positions: swarmPositions(d) });
  if (trial.length) card.appendChild(h('p', { class: 'small bad' }, trial.join(' ')));
  const left = E.swarmingCandidates(g, ph.team).filter((p) => !d.positions[p.id]);
  card.appendChild(
    h(
      'div',
      { class: 'reserves' },
      h('div', { class: 'section-label' }, `Linemen in the Reserves Box (${left.length})`),
      left.length
        ? h('div', { class: 'chips' }, left.map((p) => h('button', { class: `chip btnchip ${app.st.selected === p.id ? 'on' : ''}`, 'data-player': p.id, title: 'Click to select, then click a square in your half — or drag onto the pitch', onpointerdown: (ev: PointerEvent) => armDrag(app, ev, p.id, E.label(p)), onclick: () => app.set({ selected: app.st.selected === p.id ? null : p.id }) }, `#${p.number} ${p.position}`)))
        : h('p', { class: 'small muted' }, 'No more Linemen in the Reserves Box.'),
    ),
  );
  card.appendChild(
    h(
      'div',
      { class: 'btnrow' },
      h('button', { class: 'btn ghost', id: 'swarming-default', onclick: () => { d.positions = { ...E.defaultSwarming(g, ph.team) }; app.emit(); } }, 'Place them for me'),
      h('button', { class: 'btn ghost', onclick: () => { d.positions = {}; app.emit(); } }, 'Clear'),
      h('button', { class: 'btn primary', id: 'confirm-swarming', onclick: () => app.runSimple({ kind: 'swarming', positions: swarmPositions(d) }) }, n ? `Confirm ${n} more Linemen` : 'Confirm (no extra players)'),
    ),
  );
}

/** The match input that confirms a Solid Defence / Quick Snap / Dwarfen Wisdom draft. */
function eventInput(type: 'solidDefence' | 'quickSnap' | 'dwarfenWisdom', pos: Record<string, Coord>) {
  return type === 'quickSnap' ? ({ kind: 'quickSnap', moves: pos } as const) : type === 'dwarfenWisdom' ? ({ kind: 'dwarfenWisdom', positions: pos } as const) : ({ kind: 'solidDefence', positions: pos } as const);
}

function renderEventSetup(app: App, card: HTMLElement) {
  const g = app.game;
  const ph = g.match!.pendingPhase as { type: 'solidDefence' | 'quickSnap' | 'dwarfenWisdom'; team: TeamId; max: number };
  const d = ensureDraft(app) as SetupDraft;
  const n = moved(g, d).length;
  const sd = ph.type !== 'quickSnap';
  const wisdom = ph.type === 'dwarfenWisdom';
  const alert = alertDefence(g);
  card.appendChild(h('h3', null, `${wisdom ? "Josef Bugman's Dwarfen Wisdom" : sd ? 'Solid Defence' : alert ? 'Alert Defence' : 'Quick Snap'} — ${g.teams[ph.team].name}`));
  card.appendChild(
    h(
      'p',
      { class: 'small' },
      wisdom ? `Set up again up to ${ph.max} of your players (D3 rolled), following the usual set-up rules. ` : sd ? `Set up again up to ${ph.max} Open players (not Marked), following the usual set-up rules. ` : E.isSevens(g) ? `Move up to ${ph.max} Open players one square each, even into No Man's Land. ` : `Move up to ${ph.max} Open players one square each, even into the opponent's half. `,
      `Selected: ${n} of ${ph.max}. `,
      ruleTag(wisdom ? { page: 147, title: 'Infamous Coaching Staff: Josef Bugman' } : E.rulesFor(g).refs.events),
    ),
  );
  if (sd) card.appendChild(issuesList(E.validateDriveSetup(app.displayGame(), ph.team)));
  card.appendChild(
    h(
      'div',
      { class: 'btnrow' },
      h('button', { class: 'btn ghost', onclick: () => { d.positions = {}; app.emit(); } }, 'Undo changes'),
      h(
        'button',
        {
          class: 'btn primary',
          id: 'confirm-event',
          onclick: () => {
            const pos: Record<string, Coord> = {};
            for (const id of moved(g, d)) pos[id] = d.positions[id] as Coord;
            app.runSimple(eventInput(ph.type, pos));
          },
        },
        n ? 'Confirm' : 'Confirm (no changes)',
      ),
    ),
  );
}
