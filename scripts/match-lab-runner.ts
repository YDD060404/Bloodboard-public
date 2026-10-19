/**
 * Match Lab runner (bundled to match-lab/runner/runner.mjs). One process plays the games of one run, several at a time,
 * sharing one engine pool (worker threads), and saves every finished game immediately, so an interrupted run resumes where it stopped.
 *
 *   node runner.mjs plan <spec.json>               write run.json + team snapshots for a batch specification
 *   node runner.mjs run <run-dir> [--games G] [--workers W] [--retry-failed]   play the pending games of <run-dir>/run.json (control lines on stdin: pause | resume | stop)
 *   node runner.mjs verify <game.json>...          replay recorded games with the engine and compare
 *   node runner.mjs cpuplan [kinds]                default concurrency for this computer
 *   node runner.mjs inspect <list.json>            describe coach files (a JSON array of absolute paths) → JSON on stdout
 *   node runner.mjs rosters                        the rosters a run may name → JSON on stdout
 *   node runner.mjs teamcheck <file>               check a saved team file → JSON on stdout
 *
 * Events are JSON lines on stdout ({ "type": ... }). Nothing here is used by the game app.
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as Engine from '../src/engine/index';
import { bindEngine, parseAIFile, type AIFile } from '../src/ai/index';
import { moduleMeta } from '../src/platform/host';
import { nodeSpawn } from '../src/platform/research/nodehost';
import { playMatch, replayHistory, MatchAborted, MatchInvalid, type CoachSpec, type MatchConfig, type MatchTrace, TRAJECTORY_SCHEMA, RESULT_SCHEMA, INTERNAL_SCHEMA } from '../src/platform/research/match';
import { buildTeam, listRosters, registerTeam } from '../src/platform/research/teams';
import { planBatch, cpuPlan, type BatchSpec, type TeamSource, type PlannedGame, type Format, type PlayMode } from '../src/platform/research/labplan';
import { makeNodePool } from '../src/platform/research/nodepool';
import { FEATURE_SCHEMA_VERSION } from '../src/platform/evaluation';
import { API_MINOR, DEFAULT_LIMITS } from '../src/platform/limits';
import { HOST_EXTENSIONS_VERSION } from '../src/platform/hostext';
import { BUILD_FINGERPRINT } from '../src/engine/index';
import { buildTeamFor, type StageReport } from '../src/platform/lifecycle';
import type { CoachEntry } from '../src/ai/index';

declare const process: any;
bindEngine(Engine);

export const RUNNER_VERSION = '2.1';
export const GAME_SCHEMA = 'bloodboard-lab-game/2';
export const HISTORY_FORMAT = 'bloodboard-lab-history/2';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const emit = (o: Record<string, unknown>) => process.stdout.write(JSON.stringify({ t: Date.now(), ...o }) + '\n');
declare const setImmediate: (f: () => void) => void;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── inspect ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
const SEARCH_DEFAULTS: Record<string, number> = { maxExplored: 12, maxLeaves: 2500, threshold: 1e-4, minGain: 0.5 };
const OBJECTIVE_DEFAULTS: Record<string, number> = { protectThreats: 2, protectCageBelow: 2 };

/** What a parameter file actually changes: defaults and zero-effect entries removed, so equal behaviour gives an equal signature. */
function signatureOf(f: AIFile): string {
  const P = f.parameters ?? {};
  const weights = Object.fromEntries(Object.entries(P.weights ?? {}).filter(([, v]) => v !== 1));
  const prefs = Object.fromEntries(Object.entries(P.preferences ?? {}).filter(([, v]) => v !== 0));
  const search = Object.fromEntries(Object.entries(P.search ?? {}).filter(([k, v]) => SEARCH_DEFAULTS[k] !== v));
  const conds = (P.conditions ?? []).map((c) => canon(c));
  const sig = { weights, prefs, objectives: Object.fromEntries(Object.entries(P.objectives ?? {}).filter(([k, v]) => OBJECTIVE_DEFAULTS[k] !== v)), search, conds, formats: (f.formats ?? []).slice().sort() };
  return sha256(JSON.stringify(canon(sig))).slice(0, 16);
}

/** The code without comments and blank space: the same module with different formatting hashes equal. */
function normalisedCode(code: string): string {
  return sha256(code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1').replace(/\s+/g, ' ').trim()).slice(0, 16);
}

async function inspectFile(path: string): Promise<Record<string, unknown>> {
  const name = basename(path);
  const out: Record<string, unknown> = { file: path, fileName: name, valid: false, errors: [] as string[] };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    (out.errors as string[]).push(`Cannot read the file: ${(e as Error).message}`);
    return out;
  }
  out.bytes = text.length;
  out.sha = sha256(text);
  if (name.toLowerCase().endsWith('.json')) {
    const e = parseAIFile(text, name);
    Object.assign(out, { kind: 'profile', id: e.id, name: e.name, version: e.version, description: e.description, formats: e.formats ?? null, valid: !e.errors, errors: e.errors ?? [], timeLimitMs: null });
    if (e.profile) out.signature = signatureOf(e.profile);
    return out;
  }
  if (name.toLowerCase().endsWith('.js')) {
    out.kind = 'module';
    out.normalised = normalisedCode(text);
    const m = await moduleMeta(nodeSpawn, text);
    if (!m.meta) {
      (out.errors as string[]).push(m.error ?? 'The module did not register.');
      return out;
    }
    const meta = m.meta as unknown as Record<string, unknown>;
    Object.assign(out, { id: meta.id, name: meta.name, version: meta.version, description: meta.description, timeLimitMs: meta.timeLimitMs ?? null, apiMinor: meta.apiMinor ?? 0, requires: meta.requires ?? [], hooks: meta.hooks ?? null, apiVersion: meta.apiVersion ?? 1, contextSchema: meta.contextSchema ?? null, declaredCapabilities: meta.declaredCapabilities ?? null, requiresCapabilities: meta.requiresCapabilities ?? [], valid: true });
    const apiMinor = Number(meta.apiMinor ?? 0) || 0;
    if (apiMinor > API_MINOR) {
      out.valid = false;
      (out.errors as string[]).push(`Written for strategy API 1.${apiMinor}; this runner supports 1.${API_MINOR}.`);
    }
    return out;
  }
  (out.errors as string[]).push('Not an AI file (.json parameter file or .js strategy module).');
  return out;
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface CoachRef { key: string; kind: 'builtin' | 'profile' | 'module'; style?: string; file?: string; name: string; id?: string; version?: string; sha?: string; timeLimitMs?: number | null; apiMinor?: number; apiVersion?: number; contextSchema?: string | null; declaredCapabilities?: Record<string, boolean> | null; requiresCapabilities?: string[] }
interface RunFile {
  version?: number;
  id: string;
  label: string;
  batch?: string;
  createdAt: string;
  settings: { format: Format; mode?: PlayMode; rules?: 'full' | 'introductory'; observations: 'none' | 'compact' | 'full'; features: boolean; timeLimitMs: number | null; maxSteps: number; lifecycle?: 'preset' | 'builtin' | 'ai'; concurrency?: { games: number; workers: number }; estimate?: { samples: number; everyTurns: number } | null };
  coaches: CoachRef[];
  teamFiles?: Record<string, string>;
  snapshots?: Record<string, { file: string; source: string; label: string }>;
  games: PlannedGame[] & Array<{ rosters?: { A: string; B: string } }>;
}

function specOf(dir: string, c: CoachRef, limitOverride: number | null): CoachSpec {
  if (c.kind === 'builtin') return { label: c.name, kind: 'builtin', style: (c.style ?? 'balanced') as 'balanced' };
  const code = readFileSync(join(dir, 'coaches', c.file as string), 'utf8');
  if (c.kind === 'profile') {
    const e = parseAIFile(code, c.file as string);
    if (e.errors || !e.profile) throw new Error(`${c.name}: ${(e.errors ?? []).join('; ')}`);
    return { label: c.name, kind: 'profile', profile: e.profile, id: e.id, version: e.version, sha: sha256(code).slice(0, 16) };
  }
  // An explicit thinking limit of the batch replaces the module's own; otherwise its declared limit applies (never silently shortened).
  const limit = limitOverride ?? (c.timeLimitMs ?? undefined);
  return { label: c.name, kind: 'module', code, id: c.id, version: c.version, timeLimitMs: limit === null ? undefined : limit, apiMinor: c.apiMinor ?? 0, apiGeneration: c.apiVersion === 2 ? 2 : 1, contextSchema: c.contextSchema ?? undefined, capabilities: c.declaredCapabilities ?? undefined, requiresCapabilities: c.requiresCapabilities, sha: sha256(code).slice(0, 16) };
}

function teamSummary(def: Engine.TeamDef, ref: string) {
  return { ref, name: def.name, rosterId: def.rosterId ?? null, variant: def.variant ?? 'standard', rerolls: def.rerolls, apothecary: !!def.apothecary, tier: (def as { tier?: number }).tier ?? null, inducements: def.inducements ?? null, players: def.players.map((p) => ({ id: p.id, name: p.name ?? p.position, position: p.position, ma: p.ma, st: p.st, ag: p.ag, pa: p.pa, av: p.av, skills: (p.skills ?? []).map((s) => (typeof s === 'string' ? s : s.id)) })) };
}

const readTeamDef = (path: string): Engine.TeamDef => {
  const v = JSON.parse(readFileSync(path, 'utf8'));
  const def = (v && v.players ? v : v && v.team && v.team.players ? v.team : v && v.def && v.def.players ? v.def : null) as Engine.TeamDef | null;
  if (!def) throw new Error(`${path}: not a team file`);
  return def;
};

function loadTeamFiles(files: Record<string, string>, dir: string): void {
  for (const [key, rel] of Object.entries(files)) registerTeam(key, readTeamDef(rel.startsWith('/') ? rel : join(dir, rel)));
}

const atomicWrite = (path: string, text: string) => {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
};

const isGameFile = (f: string) => f.endsWith('.json') && !/\.(error|aborted|save)\.json$/.test(f);
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);

/** A plan from a batch specification file: writes run.json, the team snapshots, and prints a summary. */
function planCommand(specPath: string): void {
  const input = JSON.parse(readFileSync(specPath, 'utf8')) as { dir: string; id: string; label: string; spec: BatchSpec; sources: Array<Omit<TeamSource, 'def'> & { file?: string }>; coaches: CoachRef[]; observations?: 'none' | 'compact' | 'full'; features?: boolean; timeLimitMs?: number | null; maxSteps?: number; lifecycle?: 'preset' | 'builtin' | 'ai'; concurrency?: { games: number; workers: number }; estimate?: { samples: number; everyTurns: number } | null; extra?: Record<string, unknown> };
  const sources: TeamSource[] = input.sources.map((s) => ({ ...s, def: s.kind === 'file' && s.file ? readTeamDef(s.file) : undefined }));
  const plan = planBatch(input.spec, sources);
  mkdirSync(join(input.dir, 'teams'), { recursive: true });
  const snaps: NonNullable<RunFile['snapshots']> = {};
  for (const sn of Object.values(plan.snapshots)) {
    const rel = join('teams', `${sn.id}.json`);
    writeFileSync(join(input.dir, rel), JSON.stringify({ schema: 'bloodboard-lab-team/1', id: sn.id, source: sn.source, label: sn.label, format: sn.format, def: sn.def }, null, 1));
    snaps[sn.id] = { file: rel, source: sn.source, label: sn.label };
  }
  const run: RunFile & Record<string, unknown> = {
    version: 2, id: input.id, label: input.label, batch: input.id, createdAt: new Date().toISOString(), lab: 'v2', runner: RUNNER_VERSION, fingerprint: { version: BUILD_FINGERPRINT.version, engineHash: BUILD_FINGERPRINT.engineHash, rulesHash: BUILD_FINGERPRINT.rulesHash, apiHash: BUILD_FINGERPRINT.apiHash, saveFormatVersion: BUILD_FINGERPRINT.saveFormatVersion, aiApiVersion: BUILD_FINGERPRINT.aiApiVersion },
    settings: { format: input.spec.format, mode: input.spec.mode, rules: input.spec.rules, observations: input.observations ?? 'compact', features: input.features !== false, timeLimitMs: input.timeLimitMs ?? null, maxSteps: input.maxSteps ?? 6000, lifecycle: input.lifecycle ?? 'preset', concurrency: input.concurrency, estimate: input.estimate ?? null },
    batchSpec: { ...input.spec, teamSeed: plan.teamSeed, seedBase: plan.seedBase },
    plan: { pairs: plan.pairs, games: plan.gamesTotal, teamSeed: plan.teamSeed, seedBase: plan.seedBase, notes: plan.notes },
    coaches: input.coaches, snapshots: snaps, games: plan.games as RunFile['games'],
    ...(input.extra ?? {}),
  };
  writeFileSync(join(input.dir, 'run.json'), JSON.stringify(run, null, 1));
  process.stdout.write(JSON.stringify({ ok: true, games: plan.gamesTotal, pairs: plan.pairs, teams: Object.keys(plan.snapshots).length, teamSeed: plan.teamSeed, seedBase: plan.seedBase, notes: plan.notes }));
}

interface RunOpts { games: number; workers: number; retryFailed: boolean; heapMb: number }

async function run(dir: string, o: RunOpts): Promise<void> {
  const plan = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as RunFile;
  const format = plan.settings.format;
  mkdirSync(join(dir, 'games'), { recursive: true });
  loadTeamFiles(plan.teamFiles ?? {}, dir);
  const gamesDir = join(dir, 'games');
  const listDone = () => new Set(readdirSync(gamesDir).filter(isGameFile).map((f: string) => f.slice(0, -5)));
  const listFailed = () => new Set(readdirSync(gamesDir).filter((f: string) => f.endsWith('.error.json')).map((f: string) => f.slice(0, -11)));
  // Team snapshots: the exact teams every game uses were written by `plan` before any game ran.
  const snap = new Map<string, Engine.TeamDef>();
  for (const [id, s] of Object.entries(plan.snapshots ?? {})) snap.set(id, readTeamDef(join(dir, s.file)));
  const teamsOf = (g: RunFile['games'][number]): Record<'A' | 'B', Engine.TeamDef> => {
    if (g.teams) return { A: JSON.parse(JSON.stringify(snap.get(g.teams.A))), B: JSON.parse(JSON.stringify(snap.get(g.teams.B))) };
    const r = g.rosters as { A: string; B: string };
    return { A: buildTeam(r.A, g.format), B: buildTeam(r.B, g.format) };
  };
  const slotsOf = (g: RunFile['games'][number]) => g.slots ?? { A: g.coach.A === 0 ? 'P1' : 'P2', B: g.coach.B === 0 ? 'P1' : 'P2' };
  // A game file is the record of a finished game; make the flat files agree with it (a crash may have cut between the writes).
  const files = { trajectory: join(dir, 'trajectories.jsonl'), internal: join(dir, 'internal.jsonl'), results: join(dir, 'results.jsonl') };
  for (const f of Object.values(files)) if (!existsSync(f)) writeFileSync(f, '');
  const inResults = new Set(String(readFileSync(files.results, 'utf8')).split('\n').filter(Boolean).map((l: string) => { try { return JSON.parse(l).game as string; } catch { return ''; } }));
  for (const g of listDone()) {
    if (inResults.has(g)) continue;
    const gf = JSON.parse(readFileSync(join(gamesDir, `${g}.json`), 'utf8'));
    for (const l of gf.decisions ?? []) appendFileSync(files.trajectory, JSON.stringify(l) + '\n');
    for (const l of gf.log ?? []) appendFileSync(files.internal, JSON.stringify(l) + '\n');
    appendFileSync(files.results, JSON.stringify(gf.result) + '\n');
    emit({ type: 'note', text: `repaired the flat files for ${g}` });
  }
  // Failed games are kept as they are (never overwritten). Retrying moves the old record aside first.
  if (o.retryFailed) {
    mkdirSync(join(gamesDir, 'failed'), { recursive: true });
    for (const g of listFailed()) renameSync(join(gamesDir, `${g}.error.json`), join(gamesDir, 'failed', `${g}.${stamp()}.error.json`));
  }
  const failedBefore = listFailed();
  const doneBefore = listDone();
  const pending = plan.games.filter((g) => !doneBefore.has(g.game) && !failedBefore.has(g.game));
  const total = plan.games.length;
  let paused = false;
  let stopping = false;
  // V7-09 live estimates: at most ONE estimate child process runs at a time across all games (so concurrent games never multiply the load), at lower CPU priority, and a stop kills it.
  const estChildren = new Map<{ kill: () => boolean }, string>();
  const killEstimates = (game?: string) => { for (const [c, g] of [...estChildren]) { if (game !== undefined && g !== game) continue; try { c.kill(); } catch { /* already gone */ } estChildren.delete(c); } };
  let buf = '';
  const running = new Map<string, { g: RunFile['games'][number]; step: number; score: { A: number; B: number }; started: number; team?: string; phase?: string }>();
  let peakRunning = 0;
  let doneCount = doneBefore.size;
  let failedCount = failedBefore.size;
  let abortedCount = 0;
  /** Stop: mark every running game aborted at once (a decision in progress may take a while to end), then shut the pool if they do not end by themselves. */
  const markAborted = (game: string) => {
    const st = running.get(game);
    if (!st) return;
    const g = st.g;
    try { atomicWrite(join(gamesDir, `${g.game}.aborted.json`), JSON.stringify({ schema: GAME_SCHEMA, status: 'aborted', game: g.game, pair: g.pair, leg: g.leg, seed: g.seed, at: new Date().toISOString(), steps: st.step, score: st.score, plan: g, note: 'Stopped by the user before full time; not counted as a result. It is played again (from the start) on resume.' })); } catch { /* ignore */ }
  };
  const onStop = () => {
    for (const game of running.keys()) markAborted(game);
    setTimeout(() => { if (running.size) pool?.close(); }, 2500);
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d: string) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const cmd = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (cmd === 'pause') { paused = true; emit({ type: 'control', state: 'pausing', shard: 0 }); }
      else if (cmd === 'resume') { paused = false; emit({ type: 'control', state: 'running', shard: 0 }); }
      else if (cmd === 'stop') { if (!stopping) { stopping = true; killEstimates(); emit({ type: 'control', state: 'stopping', shard: 0 }); onStop(); } }
    }
  });
  // The Lab holds our stdin: if it goes away, stop. A hand-started run (`--no-stdin-stop`) ignores the end of input.
  process.stdin.on('end', () => { if (!process.argv.includes('--no-stdin-stop')) { stopping = true; killEstimates(); } });
  let pool: ReturnType<typeof makeNodePool> | undefined;
  let workers = o.workers;
  if (workers > 0) {
    try { pool = makeNodePool({ size: workers, heapMb: o.heapMb }); } catch (e) { emit({ type: 'note', text: `Engine workers unavailable (${(e as Error).message}); decisions run on the main thread.` }); workers = 0; }
  }
  const t0 = Date.now();
  emit({ type: 'start', run: plan.id, shard: 0, shards: 1, total, pending: pending.length, done: doneBefore.size, failed: failedBefore.size, runner: RUNNER_VERSION, concurrency: { games: Math.min(o.games, Math.max(1, pending.length)), workers } });
  const specs = new Map<number, CoachSpec>();
  const getSpec = (i: number) => {
    let s = specs.get(i);
    if (!s) { s = specOf(dir, plan.coaches[i], plan.settings.timeLimitMs); specs.set(i, s); }
    return s;
  };
  const lastStepAt = new Map<string, number>();
  let lag = 0;
  let lagLast = Date.now();
  const lagTimer = setInterval(() => { const n = Date.now(); lag = Math.max(lag * 0.8, n - lagLast - 200); lagLast = n; }, 200);
  const statTimer = setInterval(() => {
    const mem = process.memoryUsage();
    emit({ type: 'stats', running: running.size, peakRunning, done: doneCount, failed: failedCount, aborted: abortedCount, queued: Math.max(0, pending.length - (doneCount - doneBefore.size) - (failedCount - failedBefore.size) - abortedCount - running.size), pool: pool ? pool.snapshot() : null, rssMb: Math.round(mem.rss / 1048576), heapMb: Math.round(mem.heapUsed / 1048576), lagMs: Math.round(lag), elapsedMs: Date.now() - t0 });
  }, 1000);

  async function playOne(g: RunFile['games'][number]): Promise<void> {
    // an earlier stop left an aborted marker: keep it (never deleted) in games/aborted/ and play the game again from the start
    const stale = join(gamesDir, `${g.game}.aborted.json`);
    if (existsSync(stale)) { mkdirSync(join(gamesDir, 'aborted'), { recursive: true }); renameSync(stale, join(gamesDir, 'aborted', `${g.game}.${stamp()}.aborted.json`)); }
    const coaches = { A: getSpec(g.coach.A), B: getSpec(g.coach.B) };
    const slots = slotsOf(g);
    const tdefs = teamsOf(g);
    // V6 lifecycle option: 'builtin' = each side's team is built by the built-in builder for the planned roster; 'ai' = by the coach's own
    // buildTeam hook when it has one (engine-validated, 3 correction attempts, built-in fallback). 'preset' (default) = the planned snapshots.
    const lifecycleReports: Partial<Record<'A' | 'B', StageReport>> = {};
    if ((plan.settings.lifecycle ?? 'preset') !== 'preset') {
      for (const side of ['A', 'B'] as const) {
        const spec = coaches[side];
        const rosterId = tdefs[side].rosterId;
        if (!rosterId) continue;
        let entry: CoachEntry | null = null;
        if (plan.settings.lifecycle === 'ai' && spec.kind === 'module' && spec.code) {
          const m = await moduleMeta(nodeSpawn, spec.code);
          if (m.meta) entry = { id: m.meta.id, name: m.meta.name, kind: 'strategy', implementation: 'strategy:' + m.meta.id, version: m.meta.version, description: '', code: spec.code, timeLimitMs: m.meta.timeLimitMs, apiMinor: m.meta.apiMinor, apiGeneration: m.meta.apiVersion === 2 ? 2 : 1, capabilities: m.meta.declaredCapabilities } as unknown as CoachEntry;
        }
        try {
          const b = await buildTeamFor({ spawn: nodeSpawn }, { rosterId, format: g.format, play: (plan.settings.mode ?? 'exhibition') as 'exhibition' | 'tournament', id: tdefs[side].id, name: tdefs[side].name, entry });
          tdefs[side] = b.team;
          lifecycleReports[side] = b.report;
        } catch (e) { emit({ type: 'note', text: `${g.game}: lifecycle build for ${side} failed (${(e as Error).message}); the planned team is used.` }); }
      }
    }
    const decisions: Array<Record<string, unknown>> = [];
    const log: Array<Record<string, unknown>> = [];
    let resultLine: Record<string, unknown> | null = null;
    const trace: MatchTrace = { replay: [], incidents: [], steps: 0 };
    const st = { g, step: 0, score: { A: 0, B: 0 }, started: Date.now() } as { g: RunFile['games'][number]; step: number; score: { A: number; B: number }; started: number; team?: string; phase?: string; turnTotal?: number; turnsSeen?: number; estimating?: boolean };
    running.set(g.game, st);
    peakRunning = Math.max(peakRunning, running.size);
    const cfg: MatchConfig = {
      game: g.game, seed: g.seed, format: g.format, mode: 'tournament', rosters: { A: g.teams?.A ?? '', B: g.teams?.B ?? '' }, coaches, teams: tdefs,
      rules: plan.settings.rules ?? 'full', pool, trace,
      observations: plan.settings.observations, features: plan.settings.features, maxSteps: plan.settings.maxSteps,
      hooks: {
        aborted: () => stopping,
        tick: () => new Promise<void>((r) => setImmediate(r)),
        onStep: (e, state) => {
          st.step = e.step; st.score = e.score; st.team = e.team ?? undefined; st.phase = e.phase;
          // V7-09 opt-in live estimate: at every K-th turn boundary a CHILD process plays N continuations from this position (both sides the built-in
          // Balanced coach). One estimate per game at a time; boundaries that arrive while one is running are skipped. Never blocks or alters the game.
          const est = plan.settings.estimate;
          if (e.phase === 'fullTime') killEstimates(g.game); // the game is over: an estimate of a finished game would only burn CPU
          if (est && est.samples >= 1 && state && e.phase !== 'fullTime') {
            const total = state.teams.A.turn + state.teams.B.turn;
            if (total !== st.turnTotal) {
              st.turnTotal = total; st.turnsSeen = (st.turnsSeen ?? 0) + 1;
              if (st.turnsSeen % Math.max(1, est.everyTurns) === 0 && !st.estimating && estChildren.size === 0 && !stopping) {
                st.estimating = true;
                const at = e.step;
                const child = spawn(process.execPath, [process.argv[1], 'win-estimate', '-', '--samples', String(est.samples), '--seed', String(g.seed)], { stdio: ['pipe', 'pipe', 'ignore'] });
                estChildren.set(child, g.game);
                try { void import('node:os').then((os) => { if (child.pid) os.setPriority(child.pid, 10); }).catch(() => undefined); } catch { /* priority is best effort */ }
                let out = '';
                child.stdout.on('data', (d: unknown) => { out += String(d); });
                child.on('close', () => {
                  st.estimating = false; estChildren.delete(child);
                  try { const r = JSON.parse(out); if (r && r.schema === 'bloodboard-win-estimate/1') emit({ type: 'estimate', game: g.game, step: at, estimate: r }); } catch { /* an estimate that did not finish is simply absent */ }
                });
                child.on('error', () => { st.estimating = false; estChildren.delete(child); });
                child.stdin.on('error', () => undefined);
                child.stdin.end(JSON.stringify(state));
              }
            }
          }
          const last = lastStepAt.get(g.game) ?? 0;
          if (Date.now() - last < 300 && e.phase !== 'fullTime') return;
          lastStepAt.set(g.game, Date.now());
          emit({ type: 'step', game: e.game, pair: g.pair, leg: g.leg, step: e.step, team: e.team, phase: e.phase, score: e.score, half: e.half, turn: e.turn, thinkMs: e.thinkMs, label: e.label, coach: e.coach, analytics: state ? Engine.matchAnalytics(state) : undefined });
        },
      },
    };
    emit({ type: 'game-start', game: g.game, pair: g.pair, leg: g.leg, seed: g.seed, teams: { A: tdefs.A.name, B: tdefs.B.name }, rosters: { A: tdefs.A.name, B: tdefs.B.name }, coaches: { A: coaches.A.label, B: coaches.B.label }, slots });
    try {
      const res = await playMatch(cfg, { trajectory: (l) => decisions.push(l), internal: (l) => log.push(l), result: (l) => { resultLine = l; } });
      const cref = (i: 'A' | 'B') => ({ label: coaches[i].label, kind: coaches[i].kind, id: coaches[i].id ?? null, version: coaches[i].version ?? null, sha: coaches[i].sha ?? null, timeLimitMs: coaches[i].timeLimitMs ?? null, slot: slots[i] });
      const record = {
        schema: GAME_SCHEMA, status: 'completed', game: g.game, batch: plan.batch ?? plan.id, pair: g.pair, leg: g.leg, slots, seed: g.seed, format: g.format, mode: plan.settings.mode ?? 'exhibition', rules: plan.settings.rules ?? 'full',
        finishedAt: new Date().toISOString(), runner: RUNNER_VERSION, hostExtensions: { version: HOST_EXTENSIONS_VERSION, setup: true, coachContext: true, hostUse: res.hostUse ?? null }, featureSchema: FEATURE_SCHEMA_VERSION,
        settings: { thinkingLimitMs: plan.settings.timeLimitMs, observations: plan.settings.observations, maxSteps: plan.settings.maxSteps, concurrency: plan.settings.concurrency ?? null, enginePool: workers },
        engine: { version: BUILD_FINGERPRINT.version, engineHash: BUILD_FINGERPRINT.engineHash, rulesHash: BUILD_FINGERPRINT.rulesHash, apiHash: BUILD_FINGERPRINT.apiHash, saveFormatVersion: BUILD_FINGERPRINT.saveFormatVersion },
        lifecycle: { mode: plan.settings.lifecycle ?? 'preset', reports: lifecycleReports },
        plan: g, teamRefs: g.teams ?? null,
        initialTeams: { A: tdefs.A, B: tdefs.B },
        teams: { A: teamSummary(tdefs.A, g.teams?.A ?? ''), B: teamSummary(tdefs.B, g.teams?.B ?? '') },
        coaches: { A: cref('A'), B: cref('B') },
        result: resultLine, incidents: res.incidents ?? [],
        history: { format: HISTORY_FORMAT, note: 'inputs = every engine input in order; replaying them from initialTeams + seed + rules reproduces the match (verify-history does this).', inputs: res.replay ?? [], finalScore: res.score },
        decisions, log,
        schemas: { trajectory: TRAJECTORY_SCHEMA, result: RESULT_SCHEMA, internal: INTERNAL_SCHEMA },
        note: 'decisions = what a coach could see and chose; log = the engine log with the dice (never given to a coach).',
      };
      if (res.finalState) atomicWrite(join(gamesDir, `${g.game}.save.json`), JSON.stringify(Engine.toSaveFile(res.finalState, `${plan.label} ${g.game}: ${tdefs.A.name} ${res.score.A}-${res.score.B} ${tdefs.B.name}`, `Match Lab game ${g.game} of ${plan.id}, seed ${g.seed}. Open with the game's position loader.`)));
      // V7-06: the canonical, self-verifying history (same format as the game's export). A failure is recorded, never silently skipped.
      if (res.finalState) {
        const ctrl = (i: 'A' | 'B') => ({ kind: (coaches[i].kind === 'builtin' ? 'builtin' : 'coach') as 'builtin' | 'coach', coachId: coaches[i].id ?? undefined, coachVersion: coaches[i].version ?? undefined });
        const h = Engine.toHistory(res.finalState, { source: 'lab', participants: { A: { controller: ctrl('A') }, B: { controller: ctrl('B') } }, extensions: { lab: { plan: plan.id, game: g.game, pair: g.pair, leg: g.leg, seed: g.seed } } });
        if (h.ok) atomicWrite(join(gamesDir, `${g.game}.bbhistory.json`), Engine.serializeHistory(h.history));
        else (record as Record<string, unknown>).canonicalHistoryError = h.error;
      }
      atomicWrite(join(gamesDir, `${g.game}.json`), JSON.stringify(record));
      for (const l of decisions) appendFileSync(files.trajectory, JSON.stringify(l) + '\n');
      for (const l of log) appendFileSync(files.internal, JSON.stringify(l) + '\n');
      appendFileSync(files.results, JSON.stringify({ ...(resultLine as unknown as Record<string, unknown>), pair: g.pair, leg: g.leg, slots, incidents: (res.incidents ?? []).length }) + '\n');
      doneCount++;
      emit({ type: 'game-done', game: g.game, pair: g.pair, leg: g.leg, result: resultLine, slots, incidents: (res.incidents ?? []).length, ms: res.ms });
    } catch (e) {
      if (e instanceof MatchAborted) {
        abortedCount++;
        atomicWrite(join(gamesDir, `${g.game}.aborted.json`), JSON.stringify({ schema: GAME_SCHEMA, status: 'aborted', game: g.game, pair: g.pair, leg: g.leg, seed: g.seed, at: new Date().toISOString(), steps: trace.steps, score: st.score, incidents: trace.incidents, plan: g, note: 'Stopped by the user before full time; not counted as a result. It is played again (from the start) on resume.' }));
        emit({ type: 'game-aborted', game: g.game, pair: g.pair, leg: g.leg });
      } else {
        const msg = (e as Error).message ?? String(e);
        failedCount++;
        const kind = e instanceof MatchInvalid ? 'invalid' : 'error';
        atomicWrite(join(gamesDir, `${g.game}.error.json`), JSON.stringify({ schema: GAME_SCHEMA, status: 'failed', kind, game: g.game, pair: g.pair, leg: g.leg, seed: g.seed, error: msg, at: new Date().toISOString(), steps: trace.steps, score: st.score, incidents: trace.incidents, initialTeams: { A: tdefs.A, B: tdefs.B }, coaches: { A: coaches.A.label, B: coaches.B.label }, history: { format: HISTORY_FORMAT, inputs: trace.replay }, plan: g }));
        if (trace.state) { try { atomicWrite(join(gamesDir, `${g.game}.error.save.json`), JSON.stringify(Engine.toSaveFile(trace.state, `${plan.label} ${g.game} (failed)`, msg))); } catch { /* the record above is enough */ } }
        emit({ type: 'game-error', game: g.game, pair: g.pair, leg: g.leg, error: msg, kind });
      }
    } finally {
      running.delete(g.game);
      lastStepAt.delete(g.game);
    }
  }

  const queue = pending.slice();
  const lanes = Math.max(1, Math.min(o.games, queue.length || 1));
  let announcedPause = false;
  const lane = async () => {
    for (;;) {
      if (stopping) return;
      while (paused && !stopping) {
        if (!announcedPause && running.size === 0) { announcedPause = true; emit({ type: 'control', state: 'paused', shard: 0 }); }
        await sleep(300);
      }
      announcedPause = false;
      if (stopping) return;
      const g = queue.shift();
      if (!g) return;
      await playOne(g);
    }
  };
  await Promise.all(Array.from({ length: lanes }, () => lane()));
  clearInterval(statTimer);
  clearInterval(lagTimer);
  const ps = pool ? pool.stats() : null;
  emit({ type: 'engine-summary', wallMs: Date.now() - t0, peakRunning, games: lanes, workers, pool: ps ? { size: ps.size, jobs: ps.jobs, peakBusy: ps.peakBusy, avgBusy: Number(ps.avgBusy.toFixed(2)), errors: ps.errors, timedOut: ps.timedOut, respawns: ps.respawns, workerBusyMs: ps.workerBusyMs } : null, rssMb: Math.round(process.memoryUsage().rss / 1048576) });
  pool?.close();
  killEstimates();
  emit({ type: stopping ? 'stopped' : 'done', shard: 0, finished: listDone().size, failed: listFailed().size, total });
  process.exit(0);
}

/** Replays a game record with the engine and compares it with what was recorded. */
function verifyHistory(path: string): Record<string, unknown> {
  const rec = JSON.parse(readFileSync(path, 'utf8'));
  const out: Record<string, unknown> = { file: path, game: rec.game, ok: false, problems: [] as string[] };
  const problems = out.problems as string[];
  if (!rec.history?.inputs || !rec.initialTeams) { problems.push('not a v2 game record (no history.inputs / initialTeams)'); return out; }
  const r = replayHistory(rec.initialTeams, rec.seed, rec.rules ?? 'full', rec.history.inputs);
  const warnings: string[] = [];
  out.warnings = warnings;
  out.recordedEngine = rec.engine ?? null;
  if (!rec.engine) warnings.push('record from before V6: no engine fingerprint stored');
  else if (rec.engine.rulesHash !== BUILD_FINGERPRINT.rulesHash) warnings.push(`rules fingerprint differs (recorded ${String(rec.engine.rulesHash).slice(0, 12)}, current ${BUILD_FINGERPRINT.rulesHash.slice(0, 12)}): the replay may differ for that reason`);
  out.inputs = rec.history.inputs.length;
  out.applied = r.applied;
  if (r.error) { problems.push(r.error); return out; }
  const s = r.state;
  const score = { A: s.teams.A.score, B: s.teams.B.score };
  out.score = score;
  if (rec.result && (rec.result.score.A !== score.A || rec.result.score.B !== score.B)) problems.push(`score differs: recorded ${rec.result.score.A}-${rec.result.score.B}, replay ${score.A}-${score.B}`);
  if (Array.isArray(rec.log)) {
    const recorded = rec.log.reduce((n: number, l: { log?: unknown[] }) => n + (l.log?.length ?? 0), 0);
    if (recorded !== s.log.length) problems.push(`log length differs: recorded ${recorded}, replay ${s.log.length}`);
    out.logEntries = s.log.length;
  }
  if (s.phase !== 'fullTime') problems.push(`replay ended in phase ${s.phase}`);
  // The saved final position must load with the engine's own loader.
  const savePath = path.replace(/\.json$/, '.save.json');
  if (existsSync(savePath)) {
    const parsed = Engine.parseSaveFile(readFileSync(savePath, 'utf8'));
    out.saveLoads = parsed.ok;
    if (!parsed.ok) problems.push(`the saved position does not load: ${parsed.errors.join('; ')}`);
    else if (parsed.save.state.teams.A.score !== score.A || parsed.save.state.teams.B.score !== score.B) problems.push('the saved position has a different score than the replay');
  } else out.saveLoads = null;
  out.ok = problems.length === 0;
  return out;
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const [cmd, arg] = process.argv.slice(2) as string[];
  if (cmd === 'fingerprint') {
    // Reports exactly which engine/rules/API build this runner carries and the decision-time ceiling it enforces (install verification).
    process.stdout.write(JSON.stringify({ schema: 'bloodboard-runner-fingerprint/1', runner: RUNNER_VERSION, fingerprint: BUILD_FINGERPRINT, maxDecisionMs: DEFAULT_LIMITS.maxModuleMs, minDecisionMs: DEFAULT_LIMITS.minModuleMs, apiMinor: API_MINOR, hostExtensions: HOST_EXTENSIONS_VERSION }, null, 2) + '\n');
    process.exit(0);
  }
  if (cmd === 'inspect') {
    const list = JSON.parse(readFileSync(arg, 'utf8')) as string[];
    const out: unknown[] = [];
    for (const f of list) out.push(await inspectFile(f));
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
  }
  if (cmd === 'rosters') {
    process.stdout.write(JSON.stringify({ rosters: listRosters(), tiers: Engine.OFFICIAL_TIERS.tiers, budgets: { standard: Engine.MATCHED.standard.budgets, sevens: Engine.MATCHED.sevens.budgets, draftStandard: Engine.DRAFT_TEMPLATE.budget, draftOptions: Engine.DRAFT_BUDGETS, draftSevens: Engine.SEVENS_DRAFT.budget }, skillPoints: { standard: Engine.MATCHED.standard.skillPoints, sevens: Engine.MATCHED.sevens.skillPoints }, inducements: { standard: Engine.inducementsFor('standard').map((d) => ({ id: d.id, name: d.name, cost: d.cost([]), max: d.max([]) })), sevens: Engine.inducementsFor('sevens').map((d) => ({ id: d.id, name: d.name, cost: d.cost([]), max: d.max([]) })) }, runner: RUNNER_VERSION, apiMinor: API_MINOR, defaultProfileSignature: signatureOf({ format: 'bloodboard-ai', formatVersion: 1, apiVersion: 1, id: 'x', name: 'x', version: '1', implementation: 'bloodboard' } as AIFile) }));
    process.exit(0);
  }
  if (cmd === 'teamcheck') {
    try {
      const v = JSON.parse(readFileSync(arg, 'utf8'));
      const def = (v && v.players ? v : v && v.team && v.team.players ? v.team : null) as Engine.TeamDef | null;
      if (!def) throw new Error('not a team file (no "players")');
      const issues = Engine.validateTeamDef(def).filter((i: { level: string }) => i.level === 'error').map((i: { text: string }) => i.text);
      process.stdout.write(JSON.stringify({ ok: issues.length === 0, name: def.name, rosterId: def.rosterId ?? null, variant: def.variant ?? 'standard', kind: def.kind ?? null, players: def.players.length, errors: issues }));
    } catch (e) {
      process.stdout.write(JSON.stringify({ ok: false, errors: [(e as Error).message] }));
    }
    process.exit(0);
  }
  if (cmd === 'plan') {
    planCommand(arg);
    process.exit(0);
  }
  if (cmd === 'verify') {
    const results = process.argv.slice(3).map((f: string) => { try { return verifyHistory(f); } catch (e) { return { file: f, ok: false, problems: [(e as Error).message] }; } });
    process.stdout.write(JSON.stringify(results));
    process.exit(results.every((r: { ok: unknown }) => r.ok) ? 0 : 1);
  }
  if (cmd === 'history-batch') {
    // usage: history-batch LABEL file… — verifies each canonical history by re-execution and prints ONE batch (verified games only) on stdout;
    // the report of every file (also the refused ones) goes to stderr as JSON so nothing is hidden.
    const [label, ...paths] = process.argv.slice(3);
    const good: unknown[] = [], report: Array<Record<string, unknown>> = [];
    for (const f of paths) {
      try {
        const r = Engine.importHistories(readFileSync(f, 'utf8'));
        if (!r.ok) { report.push({ file: f, grade: 'refused', reason: r.errors.join('; ') }); continue; }
        for (const x of r.reports) report.push({ file: f, ...x });
        good.push(...r.verified);
      } catch (e) { report.push({ file: f, grade: 'refused', reason: (e as Error).message }); }
    }
    const code = report.every((x) => x.grade !== 'refused') ? 0 : 1;
    // Pipes are written asynchronously: exiting straight after write() truncates large output. Exit only when both streams have flushed.
    process.stderr.write(JSON.stringify(report), () => process.stdout.write(Engine.serializeHistory(Engine.toBatch(good as never, label || 'Match Lab batch')), () => process.exit(code)));
    await new Promise(() => undefined);
  }
  if (cmd === 'training-run' || cmd === 'training-grade') {
    // training-run EXERCISE.json [--coach balanced|vanguard|... ] [--samples N]   → one coach attempt + score on stdout (JSON)
    // training-grade EXERCISE.json ATTEMPT.json [--samples N]                      → re-verify and grade an attempt record (from the game or another run)
    const flag = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
    try {
      const ex = JSON.parse(readFileSync(arg, 'utf8')) as Engine.TacticalExercise;
      const chk = Engine.checkTacticalExercise(ex);
      if (!chk.ok) throw new Error(`exercise refused: ${chk.errors.join(' ')}`);
      const samples = flag('samples', '') ? Number(flag('samples', '')) : undefined;
      let out: unknown;
      if (cmd === 'training-run') {
        const { runCoachAttempt } = await import('../src/platform/training-run');
        const style = flag('coach', 'balanced') as 'balanced';
        const r = runCoachAttempt(ex, { style, coachId: `builtin:${style}`, coachVersion: BUILD_FINGERPRINT.version, ...(samples ? { samples } : {}) });
        out = { ok: true, ...r };
      } else {
        const at = JSON.parse(readFileSync(process.argv[4], 'utf8')) as Engine.Attempt;
        const p = Engine.replayAttempt(ex, at);
        out = { ok: p.ok, error: p.error ?? null, report: p.ok ? Engine.gradeAttempt(ex, at, samples ? { samples } : {}) : null };
      }
      process.stdout.write(JSON.stringify(out), () => process.exit(0));
    } catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: (e as Error).message }), () => process.exit(1)); }
    await new Promise(() => undefined);
  }
  if (cmd === 'win-estimate') {
    // win-estimate FILE|- [--at N] [--samples N] [--seed N] [--coach balanced|offensive|defensive]
    //   FILE: a bare game state, a save file or a game record's save; `-` reads a state from stdin. --at N: the state after N recorded actions of that match.
    const flag = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
    try {
      // stdin is read as a stream: reading /dev/stdin synchronously fails (ENXIO/EAGAIN) when the parent hands us a socket pipe, which is how the Lab runner spawns this command.
      const text = arg === '-' ? await new Promise<string>((res) => { let t = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (d: string) => { t += d; }); process.stdin.on('end', () => res(t)); }) : String(readFileSync(arg, 'utf8'));
      const j = JSON.parse(text) as { phase?: string; state?: unknown };
      let state: Engine.GameState;
      if (j.phase) state = j as unknown as Engine.GameState;
      else { const ps = Engine.parseSaveFile(text); if (!ps.ok) throw new Error(`not a game state or save file: ${ps.errors[0]}`); state = ps.save.state; }
      if (flag('at', '')) {
        const m = Engine.assessReplay(state);
        if (!m.initial) throw new Error(`this match cannot be replayed (${m.assessment.reason})`);
        const ses = new Engine.ReplaySession(m);
        state = ses.stateAt(Number(flag('at', '0')));
      }
      const { estimateWin } = await import('../src/platform/win-estimate');
      const t0 = Date.now();
      const r0 = estimateWin({ execute: Engine.execute as never, decide: Engine.decide as never, cloneState: Engine.cloneState }, state, { samples: Math.max(1, Math.min(500, Number(flag('samples', '20')))), seedBase: Number(flag('seed', '1')), style: flag('coach', 'balanced') as 'balanced' });
      const r = { ...r0, computeMs: Date.now() - t0 };
      process.stdout.write(JSON.stringify(r), () => process.exit(0));
    } catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: (e as Error).message }), () => process.exit(1)); }
    await new Promise(() => undefined);
  }
  if (cmd === 'cpuplan') {
    const os = await import('node:os');
    const kinds = (process.argv.slice(3).filter(Boolean) as Array<'builtin' | 'profile' | 'module'>);
    process.stdout.write(JSON.stringify({ cores: os.cpus().length, memGiB: os.totalmem() / 1073741824, ...cpuPlan(os.cpus().length, os.totalmem() / 1073741824, kinds) }));
    process.exit(0);
  }
  if (cmd === 'run') {
    const flag = (n: string, d: number) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
    await run(arg, { games: Math.max(1, flag('games', 1)), workers: Math.max(0, flag('workers', 0)), retryFailed: process.argv.includes('--retry-failed'), heapMb: flag('heap', 768) });
    return;
  }
  process.stderr.write('usage: runner.mjs plan <spec.json> | run <run-dir> [--games G --workers W --retry-failed] | verify <game.json>... | cpuplan [kinds] | inspect <list.json> | rosters | teamcheck <file>\n');
  process.exit(2);
}
main().catch((e) => { process.stderr.write(String((e as Error).stack ?? e) + '\n'); process.exit(1); });
