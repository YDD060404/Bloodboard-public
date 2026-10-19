/**
 * The computer opponent talks to the rules engine only through its public
 * API (the same object the interface uses: `window.BloodboardEngine` in the
 * app, the module in tests). Nothing here re-implements a rule: legality,
 * dice, re-rolls, skills and turn changes all come from the engine.
 */
import type * as EngineModule from '../engine/index';

export type EngineAPI = typeof EngineModule;

// eslint-disable-next-line import/no-mutable-exports
export let E: EngineAPI = undefined as unknown as EngineAPI;

export function bindEngine(api: EngineAPI): void {
  E = api;
}
