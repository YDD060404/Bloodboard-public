/**
 * The interface talks to the rules engine only through its public API.
 * At runtime the engine is a separate bundle (engine.js) that defines the
 * global `BloodboardEngine`; this module re-exports it with full types.
 */
import type * as EngineModule from '../engine/index';

declare global {
  interface Window {
    BloodboardEngine: typeof EngineModule;
  }
}

export const E: typeof EngineModule = window.BloodboardEngine;
export type * from '../engine/index';
