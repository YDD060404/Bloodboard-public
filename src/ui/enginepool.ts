/**
 * V5.7: the game's engine worker pool. Heavy engine calculations (a strategy coach's services, the built-in coach's
 * decision) run in these workers, off the interface thread; with several workers independent analyses run in
 * parallel. The same pool code and worker script serve the headless Match Lab (src/platform/research/nodepool.ts).
 *
 * Setting ("Analysis workers"): Auto (default), Off (everything on the interface thread, as before V5.7), or 1-8.
 * Kept in Settings/engine.json (the Mac app's support folder) / the browser's local storage. If workers cannot be
 * started (no Web Worker, blocked, script missing) the game silently uses the interface thread and says so in the
 * Coaches card.
 */
import { EnginePool } from '../platform/pool';
import { forWorker } from '../platform/analysis';
import type { WorkerLike } from '../platform/host';
import type { AIFile, AIMove } from '../ai/index';
import type { GameState, TeamId } from './engine-global';
import { createStore } from './storage';

declare global {
  interface Window {
    /** dist/web/engine-worker-src.js: the engine worker script as text. */
    BLOODBOARD_ENGINE_WORKER_SRC?: string;
  }
}

export type WorkersSetting = 'auto' | 'off' | number;
export const WORKER_CHOICES: Array<{ value: WorkersSetting; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'off', label: 'Off (interface thread)' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 4, label: '4' },
  { value: 6, label: '6' },
  { value: 8, label: '8' },
];

let setting: WorkersSetting = 'auto';
let loaded = false;
let pool: EnginePool | null = null;
let poolFailed: string | null = null;
const listeners = new Set<() => void>();

/** Workers "Auto" uses: half the cores less one (the interface, the coach's module worker and the operating system need some), 1-4. */
export function autoWorkers(cores: number = navigator.hardwareConcurrency || 4): number {
  return Math.max(1, Math.min(4, Math.floor((cores - 2) / 2)));
}

export function workersSetting(): WorkersSetting {
  return setting;
}
export function effectiveWorkers(): number {
  if (setting === 'off') return 0;
  return setting === 'auto' ? autoWorkers() : Math.max(1, Math.min(8, setting));
}
export function poolProblem(): string | null {
  return poolFailed;
}
export function onEngineSettingChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export async function loadEngineSettings(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const txt = await createStore('Settings').load('engine');
    const o = txt ? (JSON.parse(txt) as { workers?: unknown }) : null;
    if (o && (o.workers === 'auto' || o.workers === 'off' || (typeof o.workers === 'number' && o.workers >= 1 && o.workers <= 8))) setting = o.workers as WorkersSetting;
  } catch {
    /* no setting saved yet */
  }
}

export function setWorkersSetting(v: WorkersSetting): void {
  setting = v;
  loaded = true;
  void createStore('Settings').save('engine', JSON.stringify({ format: 'bloodboard-engine-settings', version: 1, workers: v }, null, 1)).catch(() => undefined);
  for (const f of listeners) f();
}

function spawn(): WorkerLike {
  const src = window.BLOODBOARD_ENGINE_WORKER_SRC;
  if (!src) throw new Error('the engine worker script is missing');
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  const out: WorkerLike = { postMessage: (m) => w.postMessage(m), terminate: () => w.terminate(), onmessage: null, onerror: null };
  w.onmessage = (ev: MessageEvent) => out.onmessage?.(ev.data ?? {});
  w.onerror = (e: ErrorEvent) => out.onerror?.(e.message);
  return out;
}

/** The pool for the current setting, or null (Off, or workers unavailable): the caller then works on the interface thread. */
export function getPool(): EnginePool | null {
  const n = effectiveWorkers();
  if (n === 0 || poolFailed) return null;
  if (pool && pool.size === n) return pool;
  try {
    if (typeof Worker === 'undefined') throw new Error('this browser has no Web Workers');
    if (!window.BLOODBOARD_ENGINE_WORKER_SRC) throw new Error('the engine worker script is missing');
    pool?.close();
    pool = new EnginePool({ size: n, spawn });
    // A quick self-test: one trivial job, so a blocked worker is noticed now rather than in the middle of a decision.
    void pool.submit(() => ({ t: 'job', kind: 'nop' }), { request: 0, label: 'start-up check', hardAt: Date.now() + 15000 }).then((r) => {
      const x = r as { error?: string; timedOut?: boolean };
      if (x.error || x.timedOut) {
        poolFailed = x.error ?? 'the engine workers did not start';
        pool?.close();
        pool = null;
        for (const f of listeners) f();
      }
    });
    return pool;
  } catch (e) {
    poolFailed = (e as Error).message;
    pool = null;
    return null;
  }
}

let builtinSeq = 1_000_000;

/**
 * The built-in algorithm's decision (for a parameter file or as the fallback) computed in a worker. Resolves `undefined`
 * if the workers could not do it (the caller computes it on the interface thread instead); `null` is the algorithm's own
 * "nothing to do".
 */
export async function builtinMoveInWorker(game: GameState, team: TeamId, profile: AIFile | undefined, cancelled: () => boolean): Promise<AIMove | null | undefined> {
  const p = getPool();
  if (!p) return undefined;
  const request = builtinSeq++;
  const timer = setInterval(() => {
    if (cancelled()) p.cancelRequest(request);
  }, 250);
  try {
    const r = (await p.submit(() => ({ t: 'job', kind: 'builtin', state: forWorker(game as never), team, profile }), { request, label: 'built-in coach', hardAt: Date.now() + 120_000 })) as { move?: AIMove | null; error?: string; t?: string; cancelled?: boolean };
    if (r.cancelled) return null;
    if (r.error || r.t === 'fail' || !('move' in r)) return undefined;
    return r.move ?? null;
  } finally {
    clearInterval(timer);
  }
}
