/**
 * Shared analysis caching (V5.7). Every expensive engine result the platform computes is a pure function of the
 * ANALYSED POSITION and the question asked; nothing about it depends on the dice generator, the action log or the
 * match clock. This file defines
 *
 *  - `analysisView` / `analysisHash`: the part of a game state that can influence an analysis (players, skills, ball,
 *    Turn, teams and their resources, weather, rules variant and options, pending decision…). The dice generator
 *    (`rng`), the log, the clock and the title are NOT part of it — they never influence an analysis and are never sent
 *    to an engine worker (a worker gets `rng: {seed:0, counter:0}` and an empty log).
 *  - `PlanCache`: exact enumerations of one input in one position (the engine planner), keyed by position hash, the
 *    input, the precision settings (`followUp`, `threshold`, `maxLeaves`) and the decision-policy / engine version. A
 *    stored result answers a later request when it is at least as precise (exact, or computed with a leaf cap that is
 *    not lower); its `unresolved` mass is stored with it and reported unchanged. Truncated results are never presented
 *    as exact.
 *  - `ResultCache`: whole results of pure services (`threats.*`, `reach`, `plan`…) that completed without truncation,
 *    keyed by position hash, service, the normalised arguments and the limits that shape the result.
 */
import type { GameState } from '../engine/index';

/** Bump when the planner / analysis semantics change: older entries are then never reused. */
export const ANALYSIS_VERSION = 'analysis/1';

const VOLATILE = new Set(['log', 'rng', 'clock', 'title']);

/** The analysis-relevant view of a state (a shallow copy without the volatile members). */
export function analysisView(s: GameState): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(s)) if (!VOLATILE.has(k)) o[k] = (s as unknown as Record<string, unknown>)[k];
  return o;
}

/** A state as sent to an engine worker: complete for analysis, no dice generator, no history. */
export function forWorker(s: GameState): GameState {
  const o = analysisView(s) as unknown as GameState;
  (o as { rng: unknown }).rng = { seed: 0, counter: 0 };
  (o as { log: unknown[] }).log = [];
  return o;
}

/** 53-bit string hash (cyrb53): fast, well distributed; the key also embeds the length, so an accidental collision needs both. */
export function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}.${str.length.toString(36)}`;
}

const hashes = new WeakMap<object, string>();

/** The position hash of a state (memoised per state object: states in a request are never mutated). */
export function analysisHash(s: GameState): string {
  let h = hashes.get(s);
  if (!h) {
    h = hash53(JSON.stringify(analysisView(s)));
    hashes.set(s, h);
  }
  return h;
}

/** Bounded cache of immutable property-name quotes; never cache mutable objects. */
const quotedCanonicalKeys = new Map<string, string>();
function quoteCanonicalKey(key: string): string {
  const hit = quotedCanonicalKeys.get(key);
  if (hit !== undefined) return hit;
  const value = JSON.stringify(key);
  if (key.length <= 128 && quotedCanonicalKeys.size < 1024) quotedCanonicalKeys.set(key, value);
  return value;
}

/** Deterministic legacy bytes for ordinary analysis/RPC data (sorted keys). */
export function canonical(v: unknown): string {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) {
    let body = '[';
    for (let i = 0, n = v.length; i < n; i++) {
      if (i) body += ',';
      if (i in v) { const item = canonical(v[i]); if (item != null) body += item; }
    }
    return body + ']';
  }
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  let count = 0;
  for (let i = 0; i < keys.length; i++) if (o[keys[i]] !== undefined) keys[count++] = keys[i];
  keys.length = count;
  keys.sort();
  let body = '{';
  for (let i = 0; i < count; i++) {
    if (i) body += ',';
    body += quoteCanonicalKey(keys[i]) + ':' + canonical(o[keys[i]]);
  }
  return body + '}';
}

export interface PlanOpts {
  followUp?: boolean;
  threshold?: number;
  maxLeaves?: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  stores: number;
  entries: number;
  approxBytes: number;
  evicted: number;
}

interface Entry<T> {
  value: T;
  bytes: number;
  cap: number;
  exact: boolean;
}

/** LRU by entry count and approximate size. */
class Lru<T> {
  private m = new Map<string, Entry<T>>();
  bytes = 0;
  evicted = 0;
  constructor(private maxEntries: number, private maxBytes: number) {}
  get(k: string): Entry<T> | undefined {
    const e = this.m.get(k);
    if (e) {
      this.m.delete(k);
      this.m.set(k, e);
    }
    return e;
  }
  set(k: string, e: Entry<T>): void {
    const old = this.m.get(k);
    if (old) this.bytes -= old.bytes;
    this.m.delete(k);
    this.m.set(k, e);
    this.bytes += e.bytes;
    while ((this.m.size > this.maxEntries || this.bytes > this.maxBytes) && this.m.size > 1) {
      const first = this.m.keys().next().value as string;
      const f = this.m.get(first) as Entry<T>;
      this.bytes -= f.bytes;
      this.m.delete(first);
      this.evicted++;
    }
  }
  get size(): number {
    return this.m.size;
  }
  clear(): void {
    this.m.clear();
    this.bytes = 0;
  }
}

export interface PlanLike {
  ok: boolean;
  withTeamRerolls: { unresolved: number } | null;
  withoutTeamRerolls: { unresolved: number } | null;
}

const unresolvedOf = (p: PlanLike): number => Math.max(p.withTeamRerolls?.unresolved ?? 0, p.withoutTeamRerolls?.unresolved ?? 0);

export class PlanCache<P extends PlanLike = PlanLike> {
  private lru: Lru<P>;
  hits = 0;
  misses = 0;
  stores = 0;
  constructor(maxEntries = 6000, maxBytes = 96 * 1024 * 1024) {
    this.lru = new Lru<P>(maxEntries, maxBytes);
  }
  /** Key of the question without its leaf cap. */
  static base(posHash: string, input: unknown, o: PlanOpts): string {
    return `${ANALYSIS_VERSION}|${posHash}|${canonical(input)}|f${o.followUp === false ? 0 : 1}|t${o.threshold ?? 'd'}`;
  }
  get(posHash: string, input: unknown, o: PlanOpts): P | null {
    const e = this.lru.get(PlanCache.base(posHash, input, o));
    const want = o.maxLeaves ?? Infinity;
    if (e && (e.exact || e.cap >= want)) {
      this.hits++;
      return e.value;
    }
    this.misses++;
    return null;
  }
  has(posHash: string, input: unknown, o: PlanOpts): boolean {
    const e = this.lru.get(PlanCache.base(posHash, input, o));
    return !!e && (e.exact || e.cap >= (o.maxLeaves ?? Infinity));
  }
  set(posHash: string, input: unknown, o: PlanOpts, value: P): void {
    const k = PlanCache.base(posHash, input, o);
    const cap = o.maxLeaves ?? Infinity;
    const old = this.lru.get(k);
    // Keep the more precise of the two (exact beats any cap; otherwise the higher cap).
    const exact = value.ok ? unresolvedOf(value) < 1e-12 : true;
    if (old && (old.exact || (!exact && old.cap >= cap))) return;
    this.lru.set(k, { value, bytes: 400 + JSON.stringify(value).length, cap, exact });
    this.stores++;
  }
  stats(): CacheStats {
    return { hits: this.hits, misses: this.misses, stores: this.stores, entries: this.lru.size, approxBytes: this.lru.bytes, evicted: this.lru.evicted };
  }
  clear(): void {
    this.lru.clear();
  }
}

/** Whole-service results that are pure functions of (position, arguments) and were complete. */
export class ResultCache {
  private lru: Lru<unknown>;
  hits = 0;
  misses = 0;
  stores = 0;
  constructor(maxEntries = 2000, maxBytes = 64 * 1024 * 1024) {
    this.lru = new Lru<unknown>(maxEntries, maxBytes);
  }
  static key(posHash: string, service: string, args: unknown, extra: unknown): string {
    return `${ANALYSIS_VERSION}|${posHash}|${service}|${canonical(args)}|${canonical(extra)}`;
  }
  get(k: string): unknown | undefined {
    const e = this.lru.get(k);
    if (e) {
      this.hits++;
      return JSON.parse(JSON.stringify(e.value));
    }
    this.misses++;
    return undefined;
  }
  set(k: string, v: unknown): void {
    const txt = JSON.stringify(v);
    this.lru.set(k, { value: JSON.parse(txt), bytes: 300 + txt.length, cap: 0, exact: true });
    this.stores++;
  }
  stats(): CacheStats {
    return { hits: this.hits, misses: this.misses, stores: this.stores, entries: this.lru.size, approxBytes: this.lru.bytes, evicted: this.lru.evicted };
  }
  clear(): void {
    this.lru.clear();
  }
}
