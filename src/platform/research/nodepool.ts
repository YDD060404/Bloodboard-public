/**
 * Headless engine pool (Node `worker_threads`): the same pool and worker script the app uses, for batches and
 * benchmarks. The worker script is the bundle built from src/platform/engine-worker.ts (build/engine-worker.js next to
 * the runner, or dist/web/engine-worker.js); see `findWorkerFile`.
 */
import { Worker } from 'node:worker_threads';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { EnginePool } from '../pool';
import type { WorkerLike } from '../host';

declare const process: any;

const PRELUDE = `
const { parentPort } = require('worker_threads');
globalThis.self = globalThis;
globalThis.postMessage = (m) => parentPort.postMessage(m);
parentPort.on('message', (d) => { if (typeof globalThis.onmessage === 'function') globalThis.onmessage({ data: d }); });
`;

export function findWorkerFile(explicit?: string): string {
  const here = process.argv[1] ? dirname(resolve(process.argv[1])) : process.cwd();
  const tries = [explicit, process.env.BLOODBOARD_ENGINE_WORKER, join(here, 'engine-worker.js'), join(process.cwd(), 'build/engine-worker.js'), join(process.cwd(), 'dist/web/engine-worker.js'), join(here, '../build/engine-worker.js')].filter(Boolean) as string[];
  for (const t of tries) if (existsSync(t)) return t;
  throw new Error(`Engine worker bundle not found (looked for: ${tries.join(', ')}). Build it with scripts/build.mjs or set BLOODBOARD_ENGINE_WORKER.`);
}

export interface NodePoolOptions {
  size: number;
  workerFile?: string;
  /** Heap limit of each worker (MB). */
  heapMb?: number;
}

export function makeNodePool(o: NodePoolOptions): EnginePool {
  const source = `${PRELUDE}\n${readFileSync(findWorkerFile(o.workerFile), 'utf8')}`;
  const heap = o.heapMb ?? 768;
  return new EnginePool({
    size: o.size,
    spawn: (): WorkerLike => {
      const w = new Worker(source, { eval: true, resourceLimits: { maxOldGenerationSizeMb: heap, maxYoungGenerationSizeMb: 64 } });
      let ended = false;
      const out: WorkerLike = {
        postMessage: (m) => w.postMessage(m),
        terminate: () => { ended = true; void w.terminate(); },
        onmessage: null,
        onerror: null,
      };
      w.on('message', (d: Record<string, unknown>) => out.onmessage?.(d));
      w.on('error', (e: Error) => { if (!ended) out.onerror?.(String(e?.message ?? e)); });
      w.on('exit', (code: number) => { if (!ended && code !== 0) out.onerror?.(`the worker exited with code ${code}`); });
      return out;
    },
  });
}
