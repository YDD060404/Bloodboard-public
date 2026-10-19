// Shared test helpers: the real engine, a ready match, and a client mirror driven by the built-in coach (never the server's engine state).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
export const here = dirname(fileURLToPath(import.meta.url));
export const E = await import(new URL('../engine.mjs', import.meta.url).href);

export function makeMatch(seed = 7, format = 'sevens') {
  const a = E.buildTeam('human', format), b = E.buildTeam('orc', format);
  const r = E.createMatch('tournament', a, b, { rules: 'full', play: 'tournament' }, seed);
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.state;
}

export const CLIENT = { protocol: 1, rulesHash: E.BUILD_FINGERPRINT.rulesHash, apiHash: E.BUILD_FINGERPRINT.apiHash, engineVersion: E.BUILD_FINGERPRINT.version, editions: ['faq2026', 'legacy'] };

/** What the coach for `seat` would send next given the public state it holds (null when it is not that seat's move). */
export function aiIntent(state, seat) {
  const w = E.waitingFor(state);
  if (w === null) {
    if (state.phase === 'fullTime') return null;
    return seat === 'A' ? { kind: 'action', input: { kind: state.phase === 'pregame' ? 'pregame' : 'nextDrive' } } : null;
  }
  if (w !== seat) return null;
  const mv = E.nextMove(state, seat, 'balanced');
  if (!mv) return null;
  if (mv.type === 'decision') return { kind: 'decision', choice: { requestId: mv.requestId, optionId: mv.optionId } };
  return { kind: 'action', input: mv.input };
}

let n = 0;
export const cid = (p = 'c') => `${p}-${Date.now().toString(36)}-${(n++).toString(36)}`;
