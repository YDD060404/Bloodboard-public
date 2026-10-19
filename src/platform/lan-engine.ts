/**
 * Entry point of the Node bundle used by the LAN/internet match server (lan/engine.mjs): the authoritative rules engine plus the
 * 'who must act' helper and the built-in coach (used only by component tests and by headless seats; the server itself never plays).
 */
import * as Engine from '../engine/index';
import { bindEngine } from '../ai/engine';
import { nextMove, waitingFor } from '../ai/driver';

bindEngine(Engine);

export * from '../engine/index';
export { nextMove, waitingFor };
export { buildTeam } from './research/teams';
