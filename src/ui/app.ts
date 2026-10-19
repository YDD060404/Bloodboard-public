import { noteExecution, REACTION_MS } from './avatars';
import { CoachContextStore, type ContextResetCode } from '../platform/hostext';
import {
  E,
  type ActionInput,
  type ActionType,
  type Coord,
  type DecisionRequest,
  type ExecutionResult,
  type Facing,
  type GameEvent,
  type GameState,
  type LogEntry,
  type MatchClock,
  type MatchKind,
  type PathStep,
  type PlanResult,
  type Player,
  type PlayerActionInput,
  type SaveFile,
  type SpecialId,
  type TeamDef,
  type TeamId,
} from './engine-global';
import { computerCoaches, interruptComputer } from './computer';
import { openSaved, stopReplayTimer } from './replayui';
import { looksLikeHistory, openHistoryText } from './historyio';
import { looksLikeTraining } from './trainingui';
import { lanSend } from './lanclient';
import { loadClock, tickClock, withClock, zeroClock } from './clock';
import { createStore, saveUnique, type PositionStore } from './storage';

export interface Draft {
  playerId: string;
  action: ActionType;
  path: PathStep[];
  blitzTarget?: string;
  blockTarget?: string;
  /** Multiple Block (p.132): the second opponent Blocked at the same time. */
  blockTarget2?: string;
  passTarget?: Coord;
  handoffTarget?: string;
  hailMary?: boolean;
  /** Throw Team-mate: the player thrown and the target square. */
  thrownPlayerId?: string;
  throwTarget?: Coord;
  /** Special Action and its target (`vomitTarget` holds the target of any targeted one); in a Blitz draft, the Special Action used instead of the Block. */
  special?: string;
  vomitTarget?: string;
  /** Foul Action (p.69): the Prone or Stunned opponent to foul after the move. */
  foulTarget?: string;
  /** Punt (p.134): which way the Throw-in Template faces. */
  facing?: Facing;
  /** Throw Bomb (Bombardier, p.125): the target square. */
  bombTarget?: Coord;
  /** Fumblerooski (p.128): leave the ball in the square this move starts from. */
  leaveBall?: boolean;
  /** V5: use the Star Player's start-of-activation rule with this Action (starActions.ts). */
  starRule?: boolean;
  /** V5.5: a Blood Bowl Sevens Desperate Measure used with this Action (Razzle-Dazzle, Grudge Match, Set Piece). */
  desperate?: 'razzleDazzle' | 'grudgeMatch' | 'setPiece';
  /** For Pass / Throw Team-mate: whether pitch clicks edit the path or pick the target square. */
  clickMode: 'path' | 'target';
  /** Set when the path was chosen automatically (click on a reachable square). */
  auto?: { pSafe: number; dodges: number; rushes: number; detour: boolean } | null;
  /** V5.5: Jump / Leap mode — the next click on a highlighted square adds a Jump (p.56) or Leap (p.132). */
  jumpMode?: boolean;
}

export type SetupTool =
  | { kind: 'select' }
  | { kind: 'place'; team: TeamId; rosterId: string; positionId: string }
  | { kind: 'ball' };

export type Screen = 'home' | 'board' | 'teams' | 'newMatch' | 'learn';

/** What the board is being used for. */
export type BoardCtx =
  | { kind: 'practice'; name: string; start: GameState }
  | { kind: 'match'; matchKind: MatchKind }
  | { kind: 'replay'; name: string; grade: string }
  | { kind: 'lesson'; course: 'blockSchool' | 'basics'; id: string; start: GameState };

/** Staged display of the dice and events of the last execution (dice tray). */
export interface Playback {
  events: GameEvent[];
  /** Number of events revealed so far. */
  shown: number;
  /** Board before the first event of this playback. */
  before: GameState;
  /** Log entry id of the finished action, if any (to reveal the log line in step). */
  logId: number | null;
  /** Unique id so the tray animates each stage once. */
  seq: number;
  /** Who started the action: the computer's dice advance by themselves. */
  by: 'human' | 'computer';
  /** Events already shown before this playback started (a decision continues an action): not animated again. */
  animFrom?: number;
}

/** A player set-up being arranged before it is confirmed (match set-up, Solid Defence, Quick Snap, Swarming). */
export interface SetupDraft {
  kind: 'setup' | 'solidDefence' | 'quickSnap' | 'swarming' | 'dwarfenWisdom';
  team: TeamId;
  positions: Record<string, Coord | null>;
}

export interface KickDraft {
  kicker?: string;
  target?: Coord;
  useKick: boolean;
}

/** V5 step 6: a Sports-Wizard spell being planned (p.149): 'now' = in the gap between two Turns; 'afterTurn' = end my Turn, then cast. */
export interface WizardDraft {
  team: TeamId;
  spell: 'fireball' | 'zap';
  when: 'now' | 'afterTurn';
  square?: Coord;
  target?: string;
}

export type Modal =
  | null
  | { kind: 'library' }
  | { kind: 'saveAs' }
  | { kind: 'examples' }
  | { kind: 'help' }
  | { kind: 'onlineCoaches' }
  | { kind: 'endTurn' }
  | { kind: 'about' }
  | { kind: 'undo' }
  | { kind: 'training' }
  | { kind: 'lan' }
  | { kind: 'avatars' }
  | { kind: 'trainingAuthor' }
  | { kind: 'trainingResult' }
  | { kind: 'advance'; playerId: string }
  | { kind: 'confirm'; title: string; text: string; yes: string; danger?: boolean; onYes: () => void };

export interface LessonUI {
  /** Selected mover / blocker while answering a Level 7 exercise. */
  pick: string | null;
  result: import('./engine-global').ExerciseResult | null;
  attempts: number;
  hints: number;
  solution: boolean;
  /** Board shows the lesson position being played (Plan → Confirm) instead of the quiz. */
  playing: boolean;
  /** Basic tutorials: objective reached / failed in this attempt. */
  status: 'open' | 'done' | 'failed';
  message: string | null;
}

/** A decision the computer made, as shown to the human coach. */
export interface ComputerRecord {
  /** V5.5: the team whose coach made it (two computer coaches in a watched match). */
  team?: TeamId;
  /** e.g. "Turn 3" or "Set-up". */
  when: string;
  kind: 'action' | 'decision' | 'step';
  /** Plain-language reason (objective, choice, probabilities). */
  text: string;
  objective: string | null;
  urgent: boolean;
  /** Closest alternatives it considered (label + numbers), best first. */
  alternatives: Array<{ label: string; gain: number; pSuccess?: number; pTurnover?: number; pTouchdown?: number }>;
  millis: number;
}

export type ComputerSpeed = 'slow' | 'normal' | 'fast' | 'instant';

/** Live notes from a strategy module during a long decision (display only). */
export interface ThinkingProgress {
  team: TeamId;
  coach: string;
  elapsedMs: number;
  limitMs: number;
  serviceCalls: number;
  /** V5.7: real engine-work facts (stage, work done, best option found so far, unresolved probability, worker activity). */
  engine?: import('../platform/index').ProgressEvent['engine'];
  updates: Array<{ seq: number; tMs: number; stage: string; headline: string; evaluating?: string[]; ruledOut?: string[]; best?: { label: string; detail?: string; pTurnover?: number; pTouchdown?: number; value?: number }; fraction?: number }>;
}

export interface ComputerUI {
  thinking: boolean;
  /** V5.6: what a strategy module reports while it is still calculating. */
  progress?: ThinkingProgress | null;
  /** Stopped by the human (Pause); resumes with Resume. */
  paused: boolean;
  /** No pauses between the computer's actions and dice. */
  fast: boolean;
  /** V5.5: how fast the computer acts and rolls (also for watched computer v computer matches). */
  speed?: ComputerSpeed;
  /** Show the computer's reasons for its actions. */
  explain: boolean;
  records: ComputerRecord[];
  /** Move advisor (AI Focus) for the human coach. */
  advisor: import('./computer').AdvisorState | null;
  /** V5.5: the advisory coach — the AI file (id) that gives AI Focus advice and takes over when asked. */
  advisorAi?: string;
  /** V5.5: coach changes waiting for a safe moment (after the current action and its decisions). */
  changes?: Partial<Record<TeamId, import('./computer').CoachChangeRequest>>;
  /** V5.5: the Coaches card's controls are open. */
  coachesOpen?: boolean;
}

export interface AppState {
  screen: Screen;
  ctx: BoardCtx;
  game: GameState;
  view: 'play' | 'setup';
  selected: string | null;
  draft: Draft | null;
  stage: 'plan' | 'review';
  plan: PlanResult | null;
  planKey: string;
  planBusy: boolean;
  followUp: boolean;
  showTZ: boolean;
  showReach: boolean;
  /** Local display preference only; never part of a match or network state. */
  pitchOrientation: 'horizontal' | 'vertical';
  pitchZoom: number;
  pitchFit: boolean;
  setupTool: SetupTool;
  docName: string | null;
  /** V6: the saved file this board is tied to (the file name inside the store). The display name and the match id are separate. */
  saveFile: string | null;
  /** V6: identity of the open match (survives Save As; a new match gets a new one). */
  matchId: string | null;
  /** V6: the match as it was created (stored in V6 saves: exact Replay). */
  matchInitial: GameState | null;
  /** V6: what happened to each side's saved coach context when the match was loaded. */
  contextRestore: unknown;
  /** V6: Replay of a saved match, when screen is the replay board. */
  replay: import('./replayui').ReplayUI | null;
  dirty: boolean;
  toast: { text: string; kind: 'info' | 'error' } | null;
  /** V5.5: the match timer (clock.ts) — kept here so Undo never winds it back; saved with the match. */
  clock: MatchClock;
  hover: Coord | null;
  expandedLog: Set<number>;
  modal: Modal;
  lastExecutedLogId: number | null;
  /** Snapshot of the state before the current plan was started (used to prove cancel is a no-op). */
  planBaseline: string | null;
  /**
   * V5.5: the plan as it was before each planning operation (one click, one target, one toggle — a whole
   * automatic route counts as one operation). Backspace / Delete goes back one entry; `null` = no plan.
   */
  draftHistory: Array<Draft | null>;
  /** States before each confirmed action of this board session (Undo). */
  history: Array<{ game: GameState; title: string; by?: 'human' | 'computer' }>;
  playback: Playback | null;
  /** Pause the dice tray after every roll (Continue to go on). */
  pauseDice: boolean;
  /** V4: animate the moves, the ball and knock-downs between the revealed board states. */
  animate: boolean;
  /** V3: the action log below the board is expanded (collapsed = one line, more room for the pitch). */
  logOpen: boolean;
  /** V3: the board legend is expanded. */
  legendOpen: boolean;
  /** Recorded actions still to replay (Practice → Replay). */
  replayQueue: LogEntry[];
  setupDraft: SetupDraft | null;
  kickDraft: KickDraft | null;
  wizardDraft: WizardDraft | null;
  lesson: LessonUI;
  /** Computer opponent (matches) and the move advisor. */
  computer: ComputerUI;
  /** Teams screen: League, Tournament / Exhibition, or Blood Bowl Sevens teams. */
  teamKind: TeamCat;
  /** 11-a-side or Blood Bowl Sevens (Tournament and Exhibition; League teams are 11-a-side). */
  teamFormat: TeamFormat;
  /** V5.5: the mode shown by the match set-up (League, Tournament, Exhibition, All-Star). */
  setupMode?: import('./setupPrefs').SetupMode;
  /** V5.5: the set-up screen is configuring this Quick Match preset (its id). */
  quickEdit?: string;
  teamEdit: TeamDef | null;
  teamDirty: boolean;
  teamSel: string | null;
}

/** Team list shown on the Teams / New match screens: the engine's match kinds plus Blood Bowl Sevens (Exhibition teams with the Sevens draft). */
/** V5 step 6: the three modes (the format — 11-a-side or Sevens — is chosen separately, `teamFormat`). */
export type TeamCat = 'league' | 'tournament' | 'exhibition';
export type TeamFormat = 'standard' | 'sevens';

type Listener = () => void;

const PREFS_KEY = 'bloodboard.prefs.v2';

function loadPrefs(): { pitchZoom?: number; pitchFit?: boolean; pitchOrientation?: 'horizontal' | 'vertical'; pauseDice?: boolean; animate?: boolean; showReach?: boolean; computerFast?: boolean; computerSpeed?: ComputerSpeed; computerExplain?: boolean; logOpen?: boolean; legendOpen?: boolean; advisorAi?: string } {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function freshLesson(): LessonUI {
  return { pick: null, result: null, attempts: 0, hints: 0, solution: false, playing: false, status: 'open', message: null };
}

export class App {
  st: AppState;
  store: PositionStore;
  teamStore: PositionStore;
  progressStore: PositionStore;
  /** V7-11: the tactical-training attempt in progress (null when none). */
  training: import('./trainingui').TrainingSession | null = null;
  /** V7-05/12: the network match this client takes part in (null = a local game). */
  lan: import('./lanclient').LanSession | null = null;
  private listeners: Listener[] = [];
  private planSeq = 0;
  private playSeq = 0;
  /** Called after every execution (lessons check their objective). */
  onExecuted: ((res: ExecutionResult) => void) | null = null;

  constructor(game: GameState) {
    this.store = createStore('Positions');
    this.teamStore = createStore('Teams');
    this.progressStore = createStore('Progress');
    const prefs = loadPrefs();
    this.st = {
      screen: 'home',
      ctx: { kind: 'practice', name: 'Untitled', start: game },
      game,
      view: game.phase === 'setup' ? 'setup' : 'play',
      selected: null,
      draft: null,
      stage: 'plan',
      plan: null,
      planKey: '',
      planBusy: false,
      followUp: true,
      showTZ: false,
      showReach: prefs.showReach ?? true,
      pitchOrientation: prefs.pitchOrientation === 'vertical' ? 'vertical' : 'horizontal',
      pitchZoom: typeof prefs.pitchZoom === 'number' && Number.isFinite(prefs.pitchZoom) ? Math.max(0.75, Math.min(2, prefs.pitchZoom)) : 1,
      pitchFit: prefs.pitchFit === true,
      setupTool: { kind: 'select' },
      docName: null,
      saveFile: null,
      matchId: null,
      matchInitial: null,
      contextRestore: null,
      replay: null,
      dirty: false,
      toast: null,
      clock: zeroClock(),
      hover: null,
      expandedLog: new Set(),
      modal: null,
      lastExecutedLogId: null,
      planBaseline: null,
      draftHistory: [],
      history: [],
      playback: null,
      pauseDice: prefs.pauseDice ?? false,
      animate: prefs.animate ?? true,
      logOpen: prefs.logOpen ?? false,
      legendOpen: prefs.legendOpen ?? false,
      replayQueue: [],
      setupDraft: null,
      kickDraft: null,
      wizardDraft: null,
      lesson: freshLesson(),
      computer: { thinking: false, paused: false, fast: prefs.computerFast ?? false, speed: prefs.computerSpeed ?? (prefs.computerFast ? 'fast' : 'normal'), explain: prefs.computerExplain ?? true, records: [], advisor: null, advisorAi: prefs.advisorAi, changes: {} },
      teamKind: 'league',
      teamFormat: 'standard',
      teamEdit: null,
      teamDirty: false,
      teamSel: null,
    };
  }

  savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ pitchZoom: this.st.pitchZoom, pitchFit: this.st.pitchFit, pitchOrientation: this.st.pitchOrientation, pauseDice: this.st.pauseDice, animate: this.st.animate, showReach: this.st.showReach, computerFast: this.st.computer.fast, computerSpeed: this.st.computer.speed, computerExplain: this.st.computer.explain, logOpen: this.st.logOpen, legendOpen: this.st.legendOpen, advisorAi: this.st.computer.advisorAi }));
    } catch {
      /* preferences are optional */
    }
  }

  onChange(fn: Listener) {
    this.listeners.push(fn);
  }

  private emitting = false;
  private emitAgain = false;

  /**
   * Re-render. Re-entrant calls (e.g. an input's change event fired while the
   * previous render removes that input) are deferred until the current render
   * has finished, so the DOM is never rebuilt from inside itself.
   */
  emit() {
    if (this.emitting) {
      this.emitAgain = true;
      return;
    }
    this.emitting = true;
    try {
      let guard = 0;
      do {
        this.emitAgain = false;
        for (const l of this.listeners) l();
      } while (this.emitAgain && guard++ < 5);
    } finally {
      this.emitting = false;
    }
  }

  set(patch: Partial<AppState>) {
    Object.assign(this.st, patch);
    this.emit();
  }

  /** V7-03: a failed-action message belongs to the attempt that failed; once the coach picks another player or starts something new it must not linger. */
  dismissStaleError() {
    if (this.st.toast?.kind === 'error') this.st.toast = null;
  }

  toast(text: string, kind: 'info' | 'error' = 'info') {
    this.st.toast = { text, kind };
    this.emit();
    const t = this.st.toast;
    setTimeout(() => {
      if (this.st.toast === t) {
        this.st.toast = null;
        this.emit();
      }
    }, kind === 'error' ? 6500 : 3500);
  }

  confirmModal(title: string, text: string, yes: string, onYes: () => void, danger = true) {
    this.set({ modal: { kind: 'confirm', title, text, yes, danger, onYes } });
  }

  // -------------------------------------------------------------------------
  // Board sessions
  // -------------------------------------------------------------------------

  /** Open the board with a new game and context (clears plan, history and playback). */
  openBoard(game: GameState, ctx: BoardCtx, opts: { docName?: string | null; saveFile?: string | null; matchId?: string | null; initial?: GameState | null } = {}) {
    stopReplayTimer(this.st.replay);
    this.st.screen = 'board';
    this.st.replay = null;
    this.st.saveFile = opts.saveFile ?? null;
    if (ctx.kind === 'match') {
      const fresh = game.log.length === 0 && !opts.matchId;
      const id = opts.matchId ?? game.match?.matchId ?? (fresh ? E.newMatchId() : E.legacyMatchId(game));
      this.st.matchId = id;
      if (game.match && !game.match.matchId && fresh) game.match.matchId = id;
      this.st.matchInitial = opts.initial ?? (fresh ? E.cloneState(game) : null);
    } else {
      this.st.matchId = null;
      this.st.matchInitial = null;
    }
    this.st.ctx = ctx;
    this.st.history = [];
    this.st.playback = null;
    this.st.replayQueue = [];
    this.st.lastExecutedLogId = null;
    this.st.expandedLog = new Set();
    this.st.setupDraft = null;
    this.st.kickDraft = null;
    this.st.wizardDraft = null;
    this.st.lesson = freshLesson();
    interruptComputer(this);
    this.st.computer = { ...this.st.computer, thinking: false, paused: false, records: [], advisor: null, changes: {} };
    tickClock(this);
    loadClock(this, game);
    this.replaceGame(game, { docName: opts.docName ?? null });
  }

  /** V5.8: host-managed coach context of the open match (shared contract: src/platform/hostext.ts). Invalidated by replaceGame: new match, loading, undo. */
  readonly coachStore = new CoachContextStore();

  replaceGame(game: GameState, opts: { docName?: string | null; keepDirty?: boolean; context?: { reason: 'undo'; logLength: number } | { reason: ContextResetCode } } = {}) {
    if (opts.context && opts.context.reason === 'undo' && 'logLength' in opts.context) this.coachStore.rewind(opts.context.logLength);
    else this.coachStore.invalidate({ code: opts.context && opts.context.reason !== 'undo' ? opts.context.reason : 'replace' });
    this.st.game = game;
    this.st.view = game.phase === 'setup' ? 'setup' : 'play';
    this.st.selected = null;
    this.st.draft = null;
    this.st.plan = null;
    this.st.stage = 'plan';
    this.st.planBaseline = null;
    this.st.setupDraft = null;
    this.st.kickDraft = null;
    this.st.wizardDraft = null;
    this.st.computer.advisor = null;
    if (opts.docName !== undefined) this.st.docName = opts.docName;
    this.st.dirty = !!opts.keepDirty;
    this.emit();
  }

  get game(): GameState {
    return this.st.game;
  }

  player(id: string | null | undefined): Player | undefined {
    return id ? E.findPlayer(this.st.game, id) : undefined;
  }

  /** The state drawn on the board: mid-playback snapshots, set-up drafts and lesson what-ifs. */
  displayGame(): GameState {
    const pb = this.st.playback;
    // A finished playback is kept only so the tray can still show the last dice;
    // it must not hide a set-up draft (V3 fix: after the pre-game roll or the
    // other team's set-up, placed players stayed drawn in the Reserves Box).
    if (pb && pb.shown < pb.events.length) {
      for (let i = pb.shown - 1; i >= 0; i--) {
        const snap = pb.events[i].snap;
        if (snap) {
          const g = E.cloneState(this.st.game);
          const byId = new Map(g.players.map((p) => [p.id, p]));
          for (const [id, x, y, stance, location] of snap.players) {
            const p = byId.get(id);
            if (!p) continue;
            p.pos = x < 0 ? null : { x, y };
            p.stance = stance;
            p.location = location;
          }
          g.ball = JSON.parse(JSON.stringify(snap.ball));
          return g;
        }
      }
      return pb.before.pending ? this.st.game : pb.before;
    }
    const sd = this.st.setupDraft;
    if (sd) {
      const g = E.cloneState(this.st.game);
      for (const p of g.players) {
        if (p.team !== sd.team || !(p.id in sd.positions)) continue;
        const to = sd.positions[p.id];
        if (to) {
          p.location = 'pitch';
          p.pos = { ...to };
        } else if (p.location === 'pitch' || p.location === 'reserves') {
          p.location = 'reserves';
          p.pos = null;
        }
      }
      return g;
    }
    if (pb) return this.st.game;
    const res = this.st.lesson.result;
    if (res?.state && !this.st.lesson.playing) return res.state;
    return this.st.game;
  }

  // -------------------------------------------------------------------------
  // Play: selection, drafts and plans
  // -------------------------------------------------------------------------

  select(id: string | null) {
    this.dismissStaleError();
    if (this.st.draft && this.st.draft.playerId !== id) this.cancelDraft(false);
    this.st.selected = id;
    this.emit();
  }

  startDraft(action: ActionType, extra: Partial<Draft> = {}) {
    this.dismissStaleError();
    const pid = this.st.selected;
    if (!pid) return;
    const act = this.st.game.turn.activation;
    const draft: Draft = { playerId: pid, action, path: [], clickMode: 'path', ...extra };
    if (act && act.playerId === pid && act.blitzTarget) draft.blitzTarget = act.blitzTarget;
    if (!this.st.draft) this.st.draftHistory = [];
    this.recordDraftOp();
    this.st.draft = draft;
    this.st.stage = 'plan';
    this.st.planBaseline = JSON.stringify(this.st.game);
    this.recomputePlan();
  }

  cancelDraft(emit = true) {
    this.st.draft = null;
    this.st.plan = null;
    this.st.stage = 'plan';
    this.st.planKey = '';
    this.st.planBaseline = null;
    this.st.draftHistory = [];
    if (emit) this.emit();
  }

  updateDraft(patch: Partial<Draft>) {
    if (!this.st.draft) return;
    this.recordDraftOp();
    if ('path' in patch && !('auto' in patch)) patch.auto = null;
    Object.assign(this.st.draft, patch);
    this.st.stage = 'plan';
    this.recomputePlan();
  }

  /**
   * V5.5: remember the plan before a planning operation. Everything one click does (start a plan, add a whole
   * automatic route, set a target) is one operation: only the first change in the same event is recorded.
   */
  private draftOpOpen = false;
  private recordDraftOp() {
    if (this.draftOpOpen) return;
    this.draftOpOpen = true;
    queueMicrotask(() => {
      this.draftOpOpen = false;
    });
    const d = this.st.draft;
    this.st.draftHistory.push(d ? JSON.parse(JSON.stringify(d)) : null);
    if (this.st.draftHistory.length > 200) this.st.draftHistory.shift();
  }

  /** V5.5: Backspace / Delete while planning — take back the last planning operation (the first one cancels the plan). */
  undoDraftOp(): 'undone' | 'cancelled' | null {
    if (!this.st.draft) return null;
    const prev = this.st.draftHistory.pop();
    if (!prev || prev.playerId !== this.st.draft.playerId) {
      this.cancelDraft();
      return 'cancelled';
    }
    this.st.draft = prev;
    this.st.stage = 'plan';
    this.recomputePlan();
    return 'undone';
  }

  draftInput(): PlayerActionInput | null {
    const d = this.st.draft;
    if (!d) return null;
    const input: PlayerActionInput = { kind: 'playerAction', playerId: d.playerId, action: d.action, path: d.path.map((x) => ({ to: { ...x.to }, kind: x.kind })) };
    const act = this.st.game.turn.activation;
    const continuing = !!act && act.playerId === d.playerId;
    // Sevens Razzle-Dazzle: a second, different Action of the same activation is declared like a new one.
    const second = continuing && !!act?.razzle && !act.razzle.second && act.action !== d.action;
    if (d.starRule && !continuing) input.starRule = true;
    if (d.desperate === 'setPiece' ? d.action === 'pass' && !!d.passTarget && !d.hailMary : !!d.desperate && !continuing) input.desperate = d.desperate;
    if (d.action === 'blitz') {
      const tgt = continuing && !second ? act?.blitzTarget : d.blitzTarget;
      if ((!continuing || second) && d.blitzTarget) input.blitzTarget = d.blitzTarget;
      if (d.blockTarget && d.blockTarget === tgt) {
        // A Special Action instead of the Block (Projectile Vomit, Stab, Chainsaw, Breathe Fire, Chomp).
        const sp = (d.special as SpecialId | undefined) ?? (d.vomitTarget ? 'projectileVomit' : undefined);
        if (sp === 'projectileVomit') input.vomitTarget = d.blockTarget;
        else if (sp) {
          input.special = sp;
          input.specialTarget = d.blockTarget;
        } else input.blockTarget = d.blockTarget;
      }
    }
    if (d.action === 'block' && d.blockTarget) {
      input.blockTarget = d.blockTarget;
      if (d.blockTarget2 && d.blockTarget2 !== d.blockTarget) input.blockTarget2 = d.blockTarget2;
    }
    if (d.action === 'pass' && d.passTarget) {
      input.passTarget = { ...d.passTarget };
      if (d.hailMary) input.hailMary = true;
    }
    if (d.action === 'handoff' && d.handoffTarget) input.handoffTarget = d.handoffTarget;
    if (d.action === 'ttm') {
      if (d.thrownPlayerId) input.thrownPlayerId = d.thrownPlayerId;
      if (d.throwTarget) input.throwTarget = { ...d.throwTarget };
    }
    if (d.action === 'special') {
      input.special = (d.special as SpecialId | undefined) ?? 'projectileVomit';
      if (input.special === 'projectileVomit' && d.vomitTarget) input.vomitTarget = d.vomitTarget;
      else if (d.vomitTarget && E.SPECIALS[input.special]?.targeted) input.specialTarget = d.vomitTarget;
      if ((input.special === 'punt' || input.special === 'ballAndChain') && d.facing) input.facing = d.facing;
      if (input.special === 'bombardier' && d.bombTarget) {
        input.bombTarget = { ...d.bombTarget };
        if (d.hailMary) input.hailMary = true;
      }
      if (input.special === 'kickTeamMate') {
        if (d.thrownPlayerId) input.thrownPlayerId = d.thrownPlayerId;
        if (d.throwTarget) input.throwTarget = { ...d.throwTarget };
      }
    }
    if (d.action === 'move' && d.leaveBall) input.leaveBall = true;
    if (d.action === 'foul' && d.foulTarget) input.foulTarget = d.foulTarget;
    return input;
  }

  recomputePlan() {
    const input = this.draftInput();
    if (!input) return;
    const key = JSON.stringify({ input, f: this.st.followUp });
    this.st.planKey = key;
    this.st.planBusy = true;
    this.emit();
    const seq = ++this.planSeq;
    setTimeout(() => {
      if (seq !== this.planSeq || !this.st.draft) return;
      let plan: PlanResult;
      try {
        plan = E.planAction(this.st.game, input, { followUp: this.st.followUp });
      } catch (e) {
        console.error(e);
        plan = {
          ok: false,
          errors: [`Internal error while planning: ${(e as Error).message}`],
          input,
          steps: [],
          withTeamRerolls: null,
          withoutTeamRerolls: null,
          assumptions: [],
          traceEvents: [],
          teamRerollsAvailable: 0,
        };
      }
      if (seq !== this.planSeq) return;
      this.st.plan = plan;
      this.st.planBusy = false;
      this.emit();
    }, 30);
  }

  review() {
    if (!this.st.plan?.ok) return;
    this.st.stage = 'review';
    this.emit();
  }

  backToPlan() {
    this.st.stage = 'plan';
    this.emit();
  }

  /** Confirm straight from the plan (the odds are shown next to the Confirm button in the tray). */
  confirmNow() {
    if (!this.st.plan?.ok || this.st.planBusy || this.st.game.pending || this.playbackActive() || this.lan?.busy) return;
    this.st.stage = 'review';
    this.confirm();
  }

  confirm() {
    const input = this.draftInput();
    const plan = this.st.plan;
    if (!input || !plan?.ok || this.st.stage !== 'review') return;
    if (this.lan?.active) { lanSend(this, { kind: 'action', input }); return; }
    const summary = planSummaryForLog(this.st.game, plan);
    const before = this.st.game;
    const res = E.execute(before, input, summary);
    this.afterExecution(res, before, E.describeInput(before, input), false);
  }

  runSimple(input: ActionInput, by: 'human' | 'computer' = 'human') {
    if (this.lan?.active) { lanSend(this, { kind: 'action', input }); return; }
    const before = this.st.game;
    const res = E.execute(before, input);
    this.afterExecution(res, before, E.describeInput(before, input), false, by);
  }

  /** An action chosen by the computer: executed like a confirmed plan (its probabilities go to the log). */
  runComputerAction(input: ActionInput) {
    const before = this.st.game;
    let summary: ReturnType<typeof planSummaryForLog> | undefined;
    if (input.kind === 'playerAction') {
      try {
        const plan = E.planAction(before, input, { followUp: true });
        if (plan.ok) summary = planSummaryForLog(before, plan);
      } catch {
        /* the log simply has no plan summary */
      }
    }
    const res = E.execute(before, input, summary);
    this.afterExecution(res, before, E.describeInput(before, input), false, 'computer');
  }

  decide(req: DecisionRequest, optionId: string, _by: 'human' | 'computer' = 'human') {
    if (this.lan?.active) { lanSend(this, { kind: 'decision', choice: { requestId: req.id, optionId } }); return; }
    const before = this.st.game;
    const res = E.decide(before, { requestId: req.id, optionId });
    this.afterExecution(res, before, '', true, this.actionBy);
  }

  /**
   * V5.5: keep the Block dice (no re-roll) and use face `face` at once — one click on the die instead of "Keep these
   * dice" followed by the choice. Both answers go to the engine as the usual two decisions.
   */
  keepBlockDie(req: DecisionRequest, face: string) {
    this.decide(req, 'none');
    if (this.lan?.active) return; // over the network the next question arrives from the server; the face is chosen with the next click
    const next = this.st.game.pending?.request;
    if (next && next.type === 'blockDie' && next.team === req.team && next.options.some((o) => o.id === face) && !this.playbackActive()) this.decide(next, face);
  }

  /** Who started the action in progress (a decision continues it). */
  private actionBy: 'human' | 'computer' = 'human';

  private afterExecution(res: ExecutionResult, before: GameState, title: string, isDecision: boolean, by: 'human' | 'computer' = 'human', preservePlayback = false) {
    const queued = preservePlayback && this.playbackActive() ? this.st.playback : null;
    tickClock(this);
    if (res.status === 'illegal') {
      this.toast(res.error ?? 'That action is not allowed.', 'error');
      return;
    }
    if (!isDecision) {
      this.st.history.push({ game: before, title, by });
      this.actionBy = by;
    }
    this.st.game = res.state;
    this.st.dirty = true;
    this.st.setupDraft = null;
    this.st.kickDraft = null;
    this.st.wizardDraft = null;
    this.st.computer.advisor = null;
    // Dice tray: reveal the new events stage by stage (a decision continues after the events already shown).
    const already = isDecision ? before.pending?.events.length ?? 0 : 0;
    const last = res.status !== 'awaitingDecision' ? res.state.log[res.state.log.length - 1] : undefined;
    this.st.playback = queued
      ? { ...queued, events: [...queued.events, ...res.events.slice(already)], logId: last?.id ?? null, seq: ++this.playSeq }
      : { events: res.events, shown: already, before, logId: last?.id ?? null, seq: ++this.playSeq, by: isDecision ? this.actionBy : by, animFrom: already };
    if (res.status !== 'awaitingDecision') {
      // Ball & Chain (p.124): each step is its own action — keep planning the next step with the same facing.
      const prevDraft = this.st.draft;
      const nextAct = res.state.turn.activation;
      const chain = !!prevDraft && prevDraft.action === 'special' && prevDraft.special === 'ballAndChain' && !!nextAct && !nextAct.over && nextAct.playerId === prevDraft.playerId && res.status === 'completed' && by === 'human' ? prevDraft.facing : undefined;
      this.st.draft = null;
      this.st.plan = null;
      if (chain) queueMicrotask(() => { if (!this.st.draft && this.st.game === res.state) this.startDraft('special', { special: 'ballAndChain', facing: chain }); });
      this.st.stage = 'plan';
      this.st.planBaseline = null;
      this.st.lastExecutedLogId = last?.id ?? null;
      if (last) this.st.expandedLog.add(last.id);
      const act = res.state.turn.activation;
      if (!act || act.playerId !== this.st.selected) {
        if (res.state.turn.active !== this.player(this.st.selected)?.team || !act) this.st.selected = act?.playerId ?? null;
      }
    }
    // V7-04: the coaches' faces react to what really happened, once the dice have been shown
    this.avatarPending = { after: res.state, events: res.events, actor: last?.team ?? null, outcome: last?.outcome ?? null };
    if (queued) this.emit(); else this.advancePlayback();
    this.onExecuted?.(res);
  }

  /** V7-05/12: the authoritative result of a command (ours or the other coach's) as received from the match server. */
  applyRemoteResult(res: ExecutionResult, title: string, isDecision: boolean, bySeat: TeamId) {
    const before = this.st.game;
    this.afterExecution(res, before, title, isDecision, this.lan?.mySeat === bySeat ? 'human' : 'computer', true);
  }

  /** Reveal events up to and including the next roll (or all of them when not pausing). */
  advancePlayback() {
    const pb = this.st.playback;
    if (!pb) return;
    if (!this.st.pauseDice) pb.shown = pb.events.length;
    else {
      let i = pb.shown;
      while (i < pb.events.length && !(pb.events[i].dice && pb.events[i].dice!.length)) i++;
      pb.shown = Math.min(pb.events.length, i + 1);
    }
    pb.seq = ++this.playSeq;
    if (pb.shown >= pb.events.length) this.finishPlayback();
    else this.emit();
  }

  skipPlayback() {
    const pb = this.st.playback;
    if (!pb) return;
    pb.shown = pb.events.length;
    this.finishPlayback();
  }

  private avatarPending: { after: GameState; events: GameEvent[]; actor: TeamId | null; outcome: string | null } | null = null;

  private finishPlayback() {
    const pb = this.st.playback;
    if (!pb) return;
    pb.shown = pb.events.length;
    const ap = this.avatarPending; this.avatarPending = null;
    if (ap && noteExecution(ap.after, ap.events, ap.actor, ap.outcome).length) setTimeout(() => this.emit(), REACTION_MS + 60);
    // Keep the finished playback so the tray still shows the last dice; `shown === events.length` means done.
    this.emit();
    if (this.st.replayQueue.length && !this.st.game.pending) {
      // Replay continues on the next Continue press (see replayNext).
    }
  }

  playbackActive(): boolean {
    const pb = this.st.playback;
    return !!pb && pb.shown < pb.events.length;
  }

  // -------------------------------------------------------------------------
  // Undo (take-backs are not part of the rules, p.35: both coaches should agree)
  // -------------------------------------------------------------------------

  /** In a match against the computer, Undo goes back to before the human coach's last action (the computer's replies are taken back with it). */
  private undoTarget(): number {
    const hist = this.st.history;
    for (let i = hist.length - 1; i >= 0; i--) if (hist[i].by !== 'computer') return i;
    return -1;
  }

  canUndo(): boolean {
    if (this.lan?.active) return false; // a take-back needs the other coach's agreement: not available in network matches
    return this.undoTarget() >= 0;
  }

  /** The entry Undo would go back to (for the confirmation). */
  undoEntry(): { title: string; computerActions: number } | null {
    const i = this.undoTarget();
    if (i < 0) return null;
    return { title: this.st.history[i].title, computerActions: this.st.history.length - 1 - i };
  }

  /** V7-03: Undo asks first only where taking an action back matters — a real match, or when the computer's replies would be taken back with it.
   *  In practice, lessons and training, where re-confirming the same action reproduces the same dice, it just undoes (the toast says what was undone). */
  requestUndo() {
    const e = this.undoEntry();
    if (e && this.st.ctx.kind !== 'match' && e.computerActions === 0 && !this.game.pending) { this.undo(); return; }
    this.set({ modal: { kind: 'undo' } });
  }

  undo() {
    const i = this.undoTarget();
    if (i < 0) return;
    const last = this.st.history[i];
    if (this.training) this.training.attempt.labels.undos++;
    interruptComputer(this);
    this.st.history = this.st.history.slice(0, i);
    this.st.playback = null;
    this.st.replayQueue = [];
    const keepSel = this.st.selected;
    this.replaceGame(last.game, { keepDirty: true, context: { reason: 'undo', logLength: last.game.log.length } });
    this.st.selected = keepSel && this.player(keepSel) ? keepSel : null;
    this.st.lastExecutedLogId = null;
    this.toast(`Undone: ${last.title || 'the last action'}. The board, log and dice generator are exactly as before it.`);
  }

  // -------------------------------------------------------------------------
  // Practice: reset, replay, new seed
  // -------------------------------------------------------------------------

  practiceReset() {
    const c = this.st.ctx;
    if (c.kind !== 'practice' && c.kind !== 'lesson') return;
    this.st.history = [];
    this.st.playback = null;
    this.st.replayQueue = [];
    this.st.lastExecutedLogId = null;
    const lesson = this.st.lesson;
    this.replaceGame(E.cloneState(c.start), { keepDirty: false });
    if (c.kind === 'lesson') this.st.lesson = { ...freshLesson(), attempts: lesson.attempts, hints: lesson.hints, solution: lesson.solution, playing: lesson.playing };
    this.emit();
  }

  practiceNewSeed(seed: number) {
    const c = this.st.ctx;
    if (c.kind !== 'practice' && c.kind !== 'lesson') return;
    const s = E.cloneState(c.start);
    s.rng = { seed: seed >>> 0, counter: 0 };
    s.log = [];
    c.start = s;
    this.practiceReset();
    this.toast(`New dice seed ${seed >>> 0}. Replaying the same actions now gives different dice.`);
  }

  /** Back to the start and re-play the recorded actions one by one (same seed → same dice). */
  practiceReplay() {
    const c = this.st.ctx;
    if (c.kind !== 'practice' && c.kind !== 'lesson') return;
    const log = this.st.game.log.slice(c.start.log.length);
    if (!log.length) return this.toast('Nothing to replay yet: confirm some actions first.', 'error');
    if (this.st.game.pending) return this.toast('Finish the pending decision first.', 'error');
    this.practiceReset();
    this.st.replayQueue = log;
    this.replayNext();
  }

  replayNext() {
    const entry = this.st.replayQueue.shift();
    if (!entry) return;
    const before = this.st.game;
    let res = E.execute(before, entry.input, entry.plan);
    let i = 0;
    while (res.status === 'awaitingDecision' && res.decision) {
      const d = entry.decisions[i++];
      if (!d) break;
      res = E.decide(res.state, { requestId: res.decision.id, optionId: d.optionId });
    }
    if (res.status === 'illegal') {
      this.st.replayQueue = [];
      return this.toast(`Replay stopped: ${res.error}`, 'error');
    }
    this.afterExecution(res, before, entry.title, false);
  }
}

// Persistence (Positions folder): practice positions and matches in progress.
export interface App {
  saveAs(name: string, notes?: string): Promise<void>;
  saveCurrent(notes?: string): Promise<void>;
  open(name: string, how?: 'auto' | 'position' | 'replay'): Promise<void>;
  loadText(text: string, name: string | null): boolean;
  openLoaded(state: GameState, name: string, save?: SaveFile, saveFile?: string | null): void;
}

/**
 * V6 saving. File name, display name and match id are three different things:
 *  - Save (update): only the file this board is already tied to (`st.saveFile`) is replaced, and only by the same match.
 *  - Everything else (a new match, Save As, a name that already exists) creates a NEW file with a free name (`Name`, `Name (1)` …) —
 *    an identical display name never authorises replacing another match.
 */
function matchSaveOptions(app: App) {
  const st = app.st;
  const ctxs = { coachContext: app.coachStore.persistable() } as Record<string, unknown>;
  return { matchId: st.matchId ?? undefined, initial: st.matchInitial, ...(ctxs.coachContext ? { coachContext: ctxs.coachContext as never } : {}) };
}

App.prototype.saveCurrent = async function (this: App, notes?: string) {
  if (this.lan?.active) return this.toast('A network match is saved by the host\'s server (journal). Download the verified history from the Network match window.', 'error');
  const name = (this.st.docName ?? '').trim();
  if (!name) return this.set({ modal: { kind: 'saveAs' } });
  tickClock(this);
  const file = E.toSaveFile(withClock(this, this.st.game), name, notes ?? this.st.game.notes, matchSaveOptions(this));
  const json = JSON.stringify(file, null, 1);
  try {
    let target = this.st.saveFile;
    if (target) {
      // update in place — but never over a file that holds a DIFFERENT match
      const other = await this.store.load(target).then((t) => E.parseSaveFile(t)).catch(() => null);
      const otherId = other && other.ok ? other.save.meta?.matchId ?? (other.save.state.match ? E.legacyMatchId(other.save.state) : null) : null;
      if (other && other.ok && otherId && file.meta && otherId !== file.meta.matchId && file.state.match) target = null;
    }
    if (target) await this.store.save(target, json);
    else target = await saveUnique(this.store, name, json);
    this.st.saveFile = target;
    this.st.dirty = false;
    this.toast(`Saved “${target}” (${this.store.kind === 'native' ? 'Positions folder' : 'browser storage'}).`);
  } catch (e) {
    this.toast(`Could not save: ${(e as Error).message}`, 'error');
  }
};

/** Save As: always a new file (a free name), never a replacement. */
App.prototype.saveAs = async function (this: App, name: string, notes?: string) {
  const clean = name.trim();
  if (!clean) return this.toast('Please enter a name.', 'error');
  tickClock(this);
  const file = E.toSaveFile(withClock(this, this.st.game), clean, notes ?? this.st.game.notes, matchSaveOptions(this));
  try {
    const target = await saveUnique(this.store, clean, JSON.stringify(file, null, 1));
    this.st.docName = clean;
    this.st.saveFile = target;
    this.st.dirty = false;
    this.toast(`Saved “${target}” (${this.store.kind === 'native' ? 'Positions folder' : 'browser storage'}).`);
  } catch (e) {
    this.toast(`Could not save: ${(e as Error).message}`, 'error');
  }
};

App.prototype.open = async function (this: App, name: string, how: 'auto' | 'position' | 'replay' = 'auto') {
  try {
    const txt = await this.store.load(name);
    const parsed = E.parseSaveFile(txt);
    if (!parsed.ok) return this.toast(`Could not open: ${parsed.errors.join('; ')}`, 'error');
    openSaved(this, parsed.save, name, how);
    const compat = E.checkCompatibility(parsed.save);
    if (compat.rules === 'different-rules') this.toast(`Opened “${name}”. ${compat.note}`);
  } catch (e) {
    this.toast(`Could not open: ${(e as Error).message}`, 'error');
  }
};

App.prototype.loadText = function (this: App, text: string, name: string | null) {
  if (looksLikeHistory(text)) return openHistoryText(this, text);
  if (looksLikeTraining(text)) { void import('./trainingui').then((m) => m.importTrainingText(this, text, name ?? 'Import')); return true; }
  const parsed = E.parseSaveFile(text);
  if (!parsed.ok) {
    this.toast(`Could not import: ${parsed.errors.slice(0, 3).join('; ')}`, 'error');
    return false;
  }
  openSaved(this, parsed.save, null, 'auto');
  return true;
};

/** A saved match opens in match mode; anything else is a practice position (Reset returns to it as loaded). */
App.prototype.openLoaded = function (this: App, state: GameState, name: string, save?: SaveFile, saveFile?: string | null) {
  if (state.match) {
    this.openBoard(state, { kind: 'match', matchKind: state.match.kind }, { docName: name, saveFile: saveFile ?? null, matchId: save?.meta?.matchId ?? E.legacyMatchId(state), initial: (save?.meta?.initial as GameState | undefined) ?? null });
    // V6: a saved coach context comes back only for the same coach, version and context schema (else a structured reason, never silently used).
    const ids: Partial<Record<TeamId, { coachId: string; coachVersion?: string; schema?: string }>> = {};
    for (const c of computerCoaches(this)) ids[c.team] = { coachId: c.entry.id, coachVersion: c.entry.version, schema: c.entry.contextSchema };
    this.st.contextRestore = this.coachStore.restore(save?.meta?.coachContext as never, ids, state.log.length);
  }
  else this.openBoard(state, { kind: 'practice', name, start: E.cloneState(state) }, { docName: name });
};

export function planSummaryForLog(game: GameState, plan: PlanResult): { headline: string; steps: string[]; probabilities: string[]; assumptions: string[] } {
  const f = (x: number) => `${(x * 100).toFixed(1)}%`;
  const steps = plan.steps.map((st, i) => {
    if (st.kind === 'block') return `${i + 1}. ${st.label} — ${st.dice}`;
    const mods = st.mods.length ? ` (${st.mods.map((m) => `${m.value >= 0 ? '+' : ''}${m.value} ${m.label}`).join(', ')})` : '';
    return `${i + 1}. ${st.label}: D6 needs ${st.target}+${mods} → ${f(st.pSingle ?? NaN)}${st.pWithReroll !== undefined ? `, ${f(st.pWithReroll)} with ${st.rerolls.join(' / ')}` : ''}`;
  });
  const w = plan.withTeamRerolls;
  const wo = plan.withoutTeamRerolls;
  const probs: string[] = [];
  if (wo) probs.push(`Completes as planned: ${f(wo.pCompleted)} without Team Re-rolls`);
  if (w && game.teams[game.turn.active].rerolls > 0) probs.push(`Completes as planned: ${f(w.pCompleted)} using Team Re-rolls when needed`);
  if (wo) probs.push(`Turnover risk: ${f(wo.pTurnover)} (no Team Re-rolls)${w && w !== wo ? ` / ${f(w.pTurnover)} (with)` : ''}`);
  if (wo && wo.pTouchdownActive > 0) probs.push(`Touchdown: ${f(wo.pTouchdownActive)}${w && w !== wo ? ` / ${f(w.pTouchdownActive)} with Team Re-rolls` : ''}`);
  if (wo && wo.unresolved > 1e-12) probs.push(`Not computed: ${(wo.unresolved * 100).toExponential(1)}% of outcomes (very long bounce chains)`);
  const input = plan.input;
  const who = input.kind === 'playerAction' ? E.findPlayer(game, input.playerId) : undefined;
  return {
    headline: who ? `${E.label(who)} — ${input.kind === 'playerAction' ? input.action : ''}` : 'Plan',
    steps,
    probabilities: probs,
    assumptions: plan.assumptions.slice(0, 3),
  };
}
