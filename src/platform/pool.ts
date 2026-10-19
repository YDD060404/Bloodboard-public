/**
 * The engine worker pool (V5.7): a small, reusable set of workers that run the expensive engine calculations (plan
 * enumeration, `explore`, threat scans, the built-in coach) OFF the interface thread, in parallel, with a bounded
 * queue. Transport-agnostic like the strategy host: the app spawns Web Workers, the headless host `worker_threads`.
 *
 * Isolation: a worker holds its own copy of the engine (its own pitch context, its own position registry per request)
 * and receives game states only through `forWorker()` — no dice generator, no log. Nothing a worker computes can touch
 * the live match.
 *
 * The pool knows nothing about services: it schedules `submit(build, meta)` jobs, tracks which positions each worker
 * already holds (so a state is sent once per worker and request), bounds run time with a watchdog, and keeps the
 * numbers that describe real concurrency (peak and time-weighted busy workers, queue depth, per-worker busy time).
 */
import type { WorkerLike } from './host';
import { PlanCache, ResultCache } from './analysis';
import type { PlanResult } from '../engine/planner';

export interface JobMeta {
  /** The request (one coach decision) the job belongs to: cancellable as a group. */
  request: number;
  /** For display and statistics. */
  label: string;
  /** Jobs still queued after this time are dropped (answered `{ skipped: true }`). */
  deadlineAt?: number;
  /** A running job is stopped (its worker restarted) this long after `hardAt`; the worker cannot be interrupted otherwise. */
  hardAt?: number;
  /** Position keys this job needs, so a worker that already holds them is preferred. */
  affinity?: string[];
  /** Lower runs first (default 0). */
  priority?: number;
}

/** What a job builder may ask about the worker that will run the job. */
export interface WorkerView {
  id: number;
  hasContext(request: number): boolean;
  hasPosition(request: number, key: string): boolean;
  /** The builder calls these for what it puts into the message (the pool remembers them for later jobs). */
  sentContext(request: number): void;
  sentPosition(request: number, key: string): void;
}

export type Reply = Record<string, unknown> & { t?: string; id?: number; workerId?: number };
export type SpecialReply = { cancelled: true } | { skipped: true } | { timedOut: true } | { error: string };
export type JobResult = Reply | SpecialReply;

interface Job {
  id: number;
  meta: JobMeta;
  build: (w: WorkerView) => Record<string, unknown>;
  resolve: (r: JobResult) => void;
  queuedAt: number;
  startedAt?: number;
  workerId?: number;
  cancelled?: boolean;
}

interface WState {
  id: number;
  w: WorkerLike | null;
  job: Job | null;
  ctx: Set<number>;
  pos: Map<number, Set<string>>;
  busyMs: number;
  jobs: number;
  spawnedAt: number;
  label: string;
}

export interface PoolStats {
  size: number;
  jobs: number;
  cancelled: number;
  skipped: number;
  timedOut: number;
  errors: number;
  respawns: number;
  peakBusy: number;
  peakQueued: number;
  /** Average number of busy workers while any job was queued or running (time-weighted). */
  avgBusy: number;
  /** Wall-clock milliseconds during which at least one job was queued or running. */
  activeMs: number;
  workerBusyMs: number[];
  workerJobs: number[];
  cache: { plans: ReturnType<PlanCache['stats']>; results: ReturnType<ResultCache['stats']> };
}

export interface PoolSnapshot {
  size: number;
  busy: number;
  queued: number;
  jobsDone: number;
  workers: Array<{ busy: boolean; label: string; sinceMs: number }>;
}

export interface PoolOptions {
  size: number;
  spawn: () => WorkerLike;
  /** Extra time a running job may exceed its `hardAt` before its worker is restarted (default 0: `hardAt` is the limit). */
  graceMs?: number;
}

export class EnginePool {
  readonly size: number;
  readonly plans = new PlanCache<PlanResult>();
  readonly results = new ResultCache();
  private workers: WState[] = [];
  private queue: Job[] = [];
  private seq = 1;
  private closed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private counters = { jobs: 0, cancelled: 0, skipped: 0, timedOut: 0, errors: 0, respawns: 0, peakBusy: 0, peakQueued: 0 };
  private activeSince = 0;
  private activeMs = 0;
  private busyIntegral = 0;
  private lastSample = 0;
  private lastBusy = 0;
  private listeners = new Set<() => void>();

  constructor(private o: PoolOptions) {
    this.size = Math.max(1, Math.floor(o.size));
    for (let i = 0; i < this.size; i++) this.workers.push({ id: i, w: null, job: null, ctx: new Set(), pos: new Map(), busyMs: 0, jobs: 0, spawnedAt: 0, label: '' });
    this.timer = setInterval(() => this.watchdog(), 200);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  /** Called whenever a job starts, ends or is queued (for live displays; keep it cheap). */
  onChange(f: () => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }
  private changed(): void {
    for (const f of this.listeners) {
      try {
        f();
      } catch {
        /* display only */
      }
    }
  }

  private sample(): void {
    const now = Date.now();
    const busy = this.workers.filter((x) => x.job).length;
    // integrate the busy count that held SINCE the previous sample (the state changed just before this call)
    if (this.lastSample) this.busyIntegral += this.lastBusy * (now - this.lastSample);
    this.lastBusy = busy;
    this.lastSample = now;
    const active = busy > 0 || this.queue.length > 0;
    if (active && !this.activeSince) this.activeSince = now;
    if (!active && this.activeSince) {
      this.activeMs += now - this.activeSince;
      this.activeSince = 0;
    }
    this.counters.peakBusy = Math.max(this.counters.peakBusy, busy);
    this.counters.peakQueued = Math.max(this.counters.peakQueued, this.queue.length);
  }

  private spawn(ws: WState): void {
    const w = this.o.spawn();
    ws.w = w;
    ws.ctx = new Set();
    ws.pos = new Map();
    ws.spawnedAt = Date.now();
    w.onmessage = (m) => this.onMessage(ws, m);
    w.onerror = (msg) => this.onError(ws, String(msg));
  }

  private view(ws: WState): WorkerView {
    return {
      id: ws.id,
      hasContext: (r) => ws.ctx.has(r),
      hasPosition: (r, k) => k === 'root' ? ws.ctx.has(r) : !!ws.pos.get(r)?.has(k),
      sentContext: (r) => { ws.ctx.add(r); },
      sentPosition: (r, k) => { let s = ws.pos.get(r); if (!s) ws.pos.set(r, (s = new Set())); s.add(k); },
    };
  }

  /** Queue a job. The promise always resolves (never rejects): a worker's reply, or `{cancelled|skipped|timedOut|error}`. */
  submit(build: (w: WorkerView) => Record<string, unknown>, meta: JobMeta): Promise<JobResult> {
    if (this.closed) return Promise.resolve({ error: 'the engine pool is closed' });
    return new Promise((resolve) => {
      const job: Job = { id: this.seq++, meta, build, resolve, queuedAt: Date.now() };
      this.queue.push(job);
      this.sample();
      this.pump();
      this.changed();
    });
  }

  private pickFor(ws: WState): number {
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < this.queue.length; i++) {
      const j = this.queue[i];
      let score = -(j.meta.priority ?? 0) * 1000 - i * 0.001;
      const aff = j.meta.affinity;
      if (aff && aff.length) for (const k of aff) if (ws.pos.get(j.meta.request)?.has(k) || (k === 'root' && ws.ctx.has(j.meta.request))) score += 10;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  private pump(): void {
    if (this.closed) return;
    for (const ws of this.workers) {
      if (ws.job) continue;
      // drop jobs that are cancelled or past their deadline before they start
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const j = this.queue[i];
        if (j.cancelled) {
          this.queue.splice(i, 1);
          this.counters.cancelled++;
          j.resolve({ cancelled: true });
        } else if (j.meta.deadlineAt !== undefined && Date.now() > j.meta.deadlineAt) {
          this.queue.splice(i, 1);
          this.counters.skipped++;
          j.resolve({ skipped: true });
        }
      }
      if (!this.queue.length) break;
      const idx = this.pickFor(ws);
      if (idx < 0) break;
      const job = this.queue.splice(idx, 1)[0];
      if (!ws.w) {
        try {
          this.spawn(ws);
        } catch (e) {
          this.counters.errors++;
          job.resolve({ error: `could not start an engine worker: ${(e as Error).message}` });
          continue;
        }
      }
      let msg: Record<string, unknown>;
      try {
        msg = { ...job.build(this.view(ws)), id: job.id };
      } catch (e) {
        this.counters.errors++;
        job.resolve({ error: `could not build the job: ${(e as Error).message}` });
        continue;
      }
      job.startedAt = Date.now();
      job.workerId = ws.id;
      ws.job = job;
      ws.label = job.meta.label;
      try {
        (ws.w as WorkerLike).postMessage(msg);
      } catch (e) {
        ws.job = null;
        this.counters.errors++;
        job.resolve({ error: `could not send the job: ${(e as Error).message}` });
      }
    }
    this.sample();
  }

  private finish(ws: WState, r: JobResult): void {
    const job = ws.job;
    if (!job) return;
    ws.job = null;
    const took = Date.now() - (job.startedAt ?? Date.now());
    ws.busyMs += took;
    ws.jobs++;
    this.counters.jobs++;
    if (job.cancelled) {
      this.counters.cancelled++;
      job.resolve({ cancelled: true });
    } else job.resolve(r);
    this.sample();
    this.pump();
    this.changed();
  }

  private onMessage(ws: WState, m: Record<string, unknown>): void {
    const job = ws.job;
    if (!job || m.id !== job.id) return; // a late reply of a job that was already given up on
    this.finish(ws, { ...m, workerId: ws.id } as Reply);
  }

  private onError(ws: WState, message: string): void {
    this.counters.errors++;
    const job = ws.job;
    this.kill(ws);
    if (job) {
      ws.job = job;
      this.finish(ws, { error: `engine worker failed: ${message}` });
    }
  }

  private kill(ws: WState): void {
    try {
      ws.w?.terminate();
    } catch {
      /* already gone */
    }
    ws.w = null;
    ws.ctx = new Set();
    ws.pos = new Map();
    this.counters.respawns++;
  }

  private watchdog(): void {
    const now = Date.now();
    for (const ws of this.workers) {
      const j = ws.job;
      if (!j) continue;
      if (j.meta.hardAt !== undefined && now > j.meta.hardAt + (this.o.graceMs ?? 0)) {
        this.counters.timedOut++;
        this.kill(ws);
        this.finish(ws, { timedOut: true });
      } else if (j.cancelled && j.meta.hardAt === undefined && now - (j.startedAt ?? now) > 30000) {
        // a cancelled job that nobody bounded: do not keep a worker busy for ever
        this.kill(ws);
        this.finish(ws, { cancelled: true });
      }
    }
    // a worker may have freed up while everything else was quiet
    if (this.queue.length) this.pump();
  }

  /** Drop everything queued for a request and mark its running jobs: their results are discarded when they end. */
  cancelRequest(request: number): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].meta.request === request) {
        const j = this.queue.splice(i, 1)[0];
        this.counters.cancelled++;
        j.resolve({ cancelled: true });
      }
    }
    for (const ws of this.workers) if (ws.job && ws.job.meta.request === request) ws.job.cancelled = true;
    this.sample();
    this.changed();
  }

  /** The request is over: workers forget its positions (their memory is bounded by the request's lifetime). */
  release(request: number): void {
    this.cancelRequest(request);
    for (const ws of this.workers) {
      if (ws.w && ws.ctx.has(request)) {
        try {
          ws.w.postMessage({ t: 'end', request });
        } catch {
          /* worker gone */
        }
      }
      ws.ctx.delete(request);
      ws.pos.delete(request);
    }
  }

  /** Record that a worker now holds a position of a request (it produced it). */
  knows(workerId: number, request: number, key: string): void {
    const ws = this.workers[workerId];
    if (!ws || !ws.w) return;
    let set = ws.pos.get(request);
    if (!set) ws.pos.set(request, (set = new Set()));
    set.add(key);
    ws.ctx.add(request);
  }

  snapshot(): PoolSnapshot {
    const now = Date.now();
    return {
      size: this.size,
      busy: this.workers.filter((x) => x.job).length,
      queued: this.queue.length,
      jobsDone: this.counters.jobs,
      workers: this.workers.map((x) => ({ busy: !!x.job, label: x.job ? x.label : '', sinceMs: x.job ? now - (x.job.startedAt ?? now) : 0 })),
    };
  }

  stats(): PoolStats {
    this.sample();
    const active = this.activeMs + (this.activeSince ? Date.now() - this.activeSince : 0);
    return {
      size: this.size,
      ...this.counters,
      avgBusy: active > 0 ? this.busyIntegral / active : 0,
      activeMs: active,
      workerBusyMs: this.workers.map((x) => x.busyMs),
      workerJobs: this.workers.map((x) => x.jobs),
      cache: { plans: this.plans.stats(), results: this.results.stats() },
    };
  }

  resetStats(): void {
    this.counters = { jobs: 0, cancelled: 0, skipped: 0, timedOut: 0, errors: 0, respawns: 0, peakBusy: 0, peakQueued: 0 };
    this.activeMs = 0;
    this.activeSince = 0;
    this.busyIntegral = 0;
    this.lastSample = 0;
    for (const w of this.workers) {
      w.busyMs = 0;
      w.jobs = 0;
    }
  }

  clearCaches(): void {
    this.plans.clear();
    this.results.clear();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    for (const j of this.queue) j.resolve({ cancelled: true });
    this.queue = [];
    for (const ws of this.workers) {
      const j = ws.job;
      try {
        ws.w?.terminate();
      } catch {
        /* ignore */
      }
      ws.w = null;
      if (j) j.resolve({ cancelled: true });
      ws.job = null;
    }
  }
}
