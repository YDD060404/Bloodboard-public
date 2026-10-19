import {REQUIRED_ENGINE} from './tactical-models.mjs';
/** S4.35 explicit engine compatibility for the learned/teacher path.
 * TRAINING_ENGINE is the fingerprint the frozen models were built and verified on: Bloodboard 7.0.1 (GUI build).
 * The compiled TRAIN receipt (teacher-domain.mjs) must carry exactly this fingerprint; that check never consults
 * the runtime list below, so a receipt relabelled to another engine stays unverified.
 * ACCEPTED_RUNTIME_ENGINES is the closed list of host fingerprints on which the path may run. An entry is admitted
 * only on an exact match of all three hashes (lower-case hex as the host reports them); o.engine.version is a label
 * and is not compared. 7.0.1-cc1 differs from 7.0.1 only in src/engine/ball.ts (solveBallChain rewrite and a
 * planChain cache; apiHash unchanged). It is declared bit-exact to 7.0.1 by its verification package; the models
 * were NOT trained on it. Deliberately absent: the Match Lab runner build (apiHash f51ae035…), whose observation
 * does not expose ruleset.rulesEdition, and every other fingerprint. A public fact the host did not send (such as
 * the rules edition) is never synthesised here or by the callers. */
// Unified 0.2.0 repairs Glotl continuation; its entry claims compatibility, not bit-exact equivalence.
export const TRAINING_ENGINE=REQUIRED_ENGINE;
const HASH_KEYS=Object.freeze(['engineHash','rulesHash','apiHash']);
export const ACCEPTED_RUNTIME_ENGINES=Object.freeze([
 Object.freeze({id:'7.0.1',relation:'training-domain',
  engineHash:REQUIRED_ENGINE.engineHash,rulesHash:REQUIRED_ENGINE.rulesHash,apiHash:REQUIRED_ENGINE.apiHash,
  evidence:'src/teacher-domain.mjs TEACHER_TRAIN_DOMAIN.engine (frozen TRAIN receipt fingerprint)'}),
 Object.freeze({id:'7.0.1-cc1',relation:'declared-bit-exact-equivalent-of-7.0.1',
  engineHash:'363a910be141a2c613fafb40021cb7f6d2f3f7bb72f55d2869a9e3d2b6b6f269',
  rulesHash:'1ae54891eed97354e1aaca931b44a7710c50ebe72a90fe9de178247a16dcb831',
  apiHash:'cc8878821f67091585f79e6553b67cd01b2794235e73c33f2dcb0d43e607dd97',
  evidence:'engine-candidates/bloodboard-7.0.1-cc1/VERIFICATION.md'}),
 Object.freeze({id:'7.0.1-cc1-loop1',relation:'experimental-canonical-equivalent-of-cc1',
  engineHash:'363a910be141a2c613fafb40021cb7f6d2f3f7bb72f55d2869a9e3d2b6b6f269',
  rulesHash:'1ae54891eed97354e1aaca931b44a7710c50ebe72a90fe9de178247a16dcb831',
  apiHash:'da7ab681dfa1b1f031239759f6286ddd2897dd734109df0673d8eae721d656d4',
  evidence:'evaluation/local-s435/canonical-loop/SERVICE-RESULT.json; candidate-only native acceptance pending'}),
 Object.freeze({"id": "0.2.0", "relation": "rules-repair-compatible; Glotl continuation corrected", "engineHash": "8ffd4c86ed2f6f0471fac87b8493e04a1bfeec216a7ebf511702835bb9f9a84d", "rulesHash": "ef05264a2b584e775696b0bb3a6ce0a8e308b9eb585e73236dd8ff20da7610cf", "apiHash": "a9a1ef052c4ae583eb768db306f34be82a5d9d94a56477c2b1e85d4d71833278", "evidence": "../unified-source/dist/web/build-info.json"})]);
/** The accepted entry whose three hashes all equal the observed fingerprint, else null. */
export function runtimeEngine(engine){
 if(!engine||typeof engine!=='object')return null;
 return ACCEPTED_RUNTIME_ENGINES.find(e=>HASH_KEYS.every(k=>typeof engine[k]==='string'&&engine[k]===e[k]))??null;
}
