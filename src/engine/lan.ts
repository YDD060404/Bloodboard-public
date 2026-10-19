/**
 * Network-play helpers shared by the game client and the tests (V7-05/12). A client never executes rules: it receives the public state
 * from the authoritative room. To keep updates small the room sends the state WITHOUT its log plus the log entries added since the
 * receiver's revision; this rebuilds the full public state or says the receiver is out of sync (and must ask for a snapshot).
 */
import type { GameState, LogEntry } from './types';

export interface WireUpdate { state: GameState; logFrom: number; logEntries: LogEntry[] }

export function applyWireUpdate(prev: GameState | null, u: WireUpdate): { ok: true; state: GameState } | { ok: false; reason: string } {
  if (!prev) return { ok: false, reason: 'no state yet' };
  if (prev.log.length !== u.logFrom) return { ok: false, reason: `log length ${prev.log.length} does not match the update (${u.logFrom})` };
  return { ok: true, state: { ...u.state, log: [...prev.log, ...u.logEntries] } };
}
