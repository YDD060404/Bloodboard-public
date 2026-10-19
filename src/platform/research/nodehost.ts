/**
 * Headless worker transport (Node `worker_threads`): runs a strategy module exactly as the app does — same HARNESS, same
 * platform services, same validation — so offline batches test what the app runs. Offline/trusted use only: a
 * worker_thread is isolated from the game state but, unlike a browser Worker, can reach Node's `require`; run only
 * modules you have read. The worker's memory is capped with `resourceLimits`.
 */
import { Worker } from 'node:worker_threads';
import type { Spawn, WorkerLike } from '../host';

const PRELUDE = `
const { parentPort } = require('worker_threads');
globalThis.self = globalThis;
globalThis.postMessage = (m) => parentPort.postMessage(m);
parentPort.on('message', (d) => { if (typeof globalThis.onmessage === 'function') globalThis.onmessage({ data: d }); });
`;

export const nodeSpawn: Spawn = (source: string): WorkerLike => {
  const w = new Worker(`${PRELUDE}\n${source}`, { eval: true, resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 } });
  const out: WorkerLike = {
    postMessage: (m) => w.postMessage(m),
    terminate: () => { void w.terminate(); },
    onmessage: null,
    onerror: null,
  };
  w.on('message', (d: Record<string, unknown>) => out.onmessage?.(d));
  w.on('error', (e: Error) => out.onerror?.(String(e?.message ?? e)));
  return out;
};
