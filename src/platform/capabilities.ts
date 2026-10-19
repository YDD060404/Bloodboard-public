/**
 * AI API v2 — capability manifests and negotiation.
 *
 * A coach (built-in or a module) has a manifest of what it implements; the host has one of what it offers. They are
 * negotiated when a module is loaded and again for every request: the host only calls a hook the manifest says the coach
 * implements, uses the built-in baseline for everything else, and records which one answered.
 */
import type { CoachCapabilities } from '../ai/registry';
import type { ModuleMeta } from './host';

export const CAPABILITY_NAMES: Array<keyof CoachCapabilities> = ['chooseRoster', 'buildTeam', 'chooseFieldedPlayers', 'chooseSetup', 'chooseKick', 'playTurn', 'ruleDecisions', 'persistentContext', 'controlledSimulation'];

export type HostStatus = 'offered' | 'unavailable';
/** What this host build offers. A capability is "offered" only when its host path is implemented and tested. */
export const HOST_CAPABILITIES: Record<keyof CoachCapabilities, { status: HostStatus; note: string }> = {
  chooseRoster: { status: 'offered', note: 'Basic roster choice, blind or sequential; the engine checks the roster can be drafted.' },
  buildTeam: { status: 'offered', note: 'The engine validates the team (structured violations); up to 3 correction attempts; the built-in builder is the explicit fallback.' },
  chooseFieldedPlayers: { status: 'offered', note: 'Through the API v2 set-up request (fielding.mode "free"): which players take the pitch and where.' },
  chooseSetup: { status: 'offered', note: 'Rearranges the fielded players the host fixed; full fielded-player control is chooseFieldedPlayers.' },
  chooseKick: { status: 'offered', note: 'Kicker and target square, validated by the engine.' },
  playTurn: { status: 'offered', note: 'Actions of a Turn, with generic legal-choice discovery.' },
  ruleDecisions: { status: 'offered', note: 'In-action rule decisions.' },
  persistentContext: { status: 'offered', note: 'Host-managed, saved with the match when the coach, version and schema match.' },
  controlledSimulation: { status: 'offered', note: 'fork.open / fork.step / fork.close on any action.' },
};

export interface Negotiated {
  capabilities: CoachCapabilities;
  errors: string[];
  warnings: string[];
}

const none = (): CoachCapabilities => ({ chooseRoster: false, buildTeam: false, chooseFieldedPlayers: false, chooseSetup: false, chooseKick: false, playTurn: false, ruleDecisions: false, persistentContext: false, controlledSimulation: false });

export function negotiate(meta: Pick<ModuleMeta, 'apiVersion' | 'hooks' | 'declaredCapabilities' | 'requiresCapabilities' | 'contextSchema'>): Negotiated {
  const h = meta.hooks ?? { action: false, decision: false, setup: false };
  const errors: string[] = [];
  const warnings: string[] = [];
  const implemented: CoachCapabilities = {
    ...none(),
    chooseRoster: !!h.roster,
    buildTeam: !!h.build,
    chooseFieldedPlayers: !!h.fielded,
    chooseSetup: !!h.setup,
    chooseKick: !!h.kick,
    playTurn: !!h.action,
    ruleDecisions: !!h.decision,
    // Persistent context is a host service any module may use (it just returns `coachContext`); controlled simulation is a service any v2 module may call.
    persistentContext: true,
    controlledSimulation: meta.apiVersion >= 2,
  };
  const out = { ...implemented };
  if (meta.apiVersion >= 2 && meta.declaredCapabilities) {
    for (const k of CAPABILITY_NAMES) {
      const d = meta.declaredCapabilities[k];
      if (d === true && !implemented[k] && k !== 'persistentContext' && k !== 'controlledSimulation') errors.push(`declares the capability "${k}" but does not implement it.`);
      if (d === false) out[k] = false;
    }
    for (const k of Object.keys(meta.declaredCapabilities)) if (!CAPABILITY_NAMES.includes(k as never)) warnings.push(`unknown capability "${k}" in the manifest (ignored).`);
  }
  if (meta.apiVersion < 2) {
    // A legacy module can only be offered what it implemented in API 1 (+ the V5.8 hooks).
    out.chooseRoster = out.buildTeam = out.chooseFieldedPlayers = out.chooseKick = false;
  }
  for (const r of meta.requiresCapabilities ?? []) {
    const hc = (HOST_CAPABILITIES as Record<string, { status: HostStatus }>)[r];
    if (!hc) errors.push(`requires the capability "${r}", which this app does not know.`);
    else if (hc.status !== 'offered') errors.push(`requires the capability "${r}", which this app does not offer yet.`);
  }
  if (out.persistentContext && meta.contextSchema !== undefined && typeof meta.contextSchema !== 'string') errors.push('contextSchema must be a string such as "my-coach-memory/1".');
  return { capabilities: out, errors, warnings };
}

/** The manifest the built-in coach has (the baseline every other coach falls back to). */
export const BUILTIN_CAPABILITIES = (): CoachCapabilities => ({ chooseRoster: true, buildTeam: true, chooseFieldedPlayers: true, chooseSetup: true, chooseKick: true, playTurn: true, ruleDecisions: true, persistentContext: false, controlledSimulation: false });
