/**
 * Offline batch runner for the strategy platform (coach-v-coach and self-play), independent of the app and of any
 * other tool: controlled seeds, side and roster swaps, formats, budgets and coach versions; writes a reproducible,
 * documented JSONL dataset (docs/AI_PLATFORM_DATASET.md).
 *
 *   esbuild scripts/ai-platform-batch.ts --bundle --platform=node --format=esm --outfile=build/ai-platform-batch.mjs \
 *     "--banner:js=import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
 *   node build/ai-platform-batch.mjs --out runs/test1 --coaches module:ai-models/hopeful/hopeful-0-2.js:6000,builtin:balanced \
 *        --seeds 1-2 --rosters human,orc --format standard --observations compact
 *
 * Options: --out DIR (required) · --coaches a,b[,c…] (builtin:<style> | module:<file>[:timeLimitMs]) · --seeds 1-4 or 1,5,9
 *   --rosters R1,R2 (human, orc) · --format standard|sevens · --observations none|compact|full · --no-features
 *   --no-swap (skip the side/roster swaps) · --label-suffix TEXT
 * Design per seed and coach pair (X, Y) with rosters (R1, R2): X/A R1 v Y/B R2, Y/A R1 v X/B R2, X/A R2 v Y/B R1,
 * Y/A R2 v X/B R1 — every coach plays every roster on every side.
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import * as Engine from '../src/engine/index';
import { bindEngine, type AIStyle } from '../src/ai/index';
import { API_MINOR } from '../src/platform/limits';
import { moduleMeta } from '../src/platform/host';
import { nodeSpawn } from '../src/platform/research/nodehost';
import { playMatch, type CoachSpec, type MatchConfig, type MatchResult, TRAJECTORY_SCHEMA, RESULT_SCHEMA, INTERNAL_SCHEMA } from '../src/platform/research/match';
import { FEATURE_NAMES, FEATURE_SCHEMA_VERSION } from '../src/platform/evaluation';

declare const process: { argv: string[]; exit(n: number): never; version: string };
bindEngine(Engine);

function args(): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2);
    const v = a[i + 1];
    if (v === undefined || v.startsWith('--')) out[k] = true;
    else { out[k] = v; i++; }
  }
  return out;
}

function seeds(v: string): number[] {
  const out: number[] = [];
  for (const part of v.split(',')) {
    const m = /^(\d+)-(\d+)$/.exec(part);
    if (m) for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
    else if (/^\d+$/.test(part)) out.push(Number(part));
    else throw new Error(`bad seed list "${v}"`);
  }
  return out;
}

async function coachOf(spec: string): Promise<CoachSpec> {
  if (spec.startsWith('builtin:')) {
    const style = spec.slice(8) as AIStyle;
    return { label: `builtin-${style}`, kind: 'builtin', style };
  }
  if (spec.startsWith('module:')) {
    const [file, limit] = spec.slice(7).split(/:(?=\d+$)/);
    const code = readFileSync(file, 'utf8');
    const m = await moduleMeta(nodeSpawn, code);
    if (!m.meta) throw new Error(`${file}: ${m.error}`);
    const sha = createHash('sha256').update(code).digest('hex').slice(0, 16);
    const tl = limit ? Number(limit) : m.meta.timeLimitMs;
    return { label: `${m.meta.id}@${m.meta.version}${limit ? `/${limit}ms` : ''}`, kind: 'module', code, id: m.meta.id, version: m.meta.version, timeLimitMs: tl, apiMinor: Number(m.meta.apiMinor ?? 0) || 0, sha };
  }
  throw new Error(`coach spec "${spec}": use builtin:<style> or module:<file>[:timeLimitMs]`);
}

async function main() {
  const a = args();
  if (!a.out || typeof a.out !== 'string') throw new Error('--out DIR is required');
  const out = a.out;
  mkdirSync(out, { recursive: true });
  const coaches = await Promise.all(String(a.coaches ?? 'builtin:balanced,builtin:balanced').split(',').map((x) => coachOf(x.trim())));
  const seedList = seeds(String(a.seeds ?? '1'));
  const [r1, r2] = String(a.rosters ?? 'human,orc').split(',');
  const format = a.format === 'sevens' ? 'sevens' : 'standard';
  const observations = (['none', 'compact', 'full'].includes(String(a.observations)) ? a.observations : 'compact') as 'none' | 'compact' | 'full';
  const swap = !a['no-swap'];
  const files = { trajectory: join(out, 'trajectories.jsonl'), internal: join(out, 'internal.jsonl'), result: join(out, 'results.jsonl') };
  for (const f of Object.values(files)) writeFileSync(f, '');
  const sink = {
    trajectory: (l: Record<string, unknown>) => appendFileSync(files.trajectory, JSON.stringify(l) + '\n'),
    internal: (l: Record<string, unknown>) => appendFileSync(files.internal, JSON.stringify(l) + '\n'),
    result: (l: Record<string, unknown>) => appendFileSync(files.result, JSON.stringify(l) + '\n'),
  };
  const plan: MatchConfig[] = [];
  for (let i = 0; i < coaches.length; i++) for (let j = i + 1; j < coaches.length; j++) {
    const X = coaches[i];
    const Y = coaches[j];
    for (const seed of seedList) {
      const quartet: Array<[CoachSpec, CoachSpec, string, string]> = [[X, Y, r1, r2]];
      if (swap) quartet.push([Y, X, r1, r2], [X, Y, r2, r1], [Y, X, r2, r1]);
      quartet.forEach(([ca, cb, ra, rb], k) => plan.push({ game: `s${seed}-${i}v${j}-${k}`, seed, format, mode: 'tournament', rosters: { A: ra, B: rb }, coaches: { A: ca, B: cb }, observations, features: a['no-features'] !== true }));
    }
  }
  const meta = {
    schemas: { trajectory: TRAJECTORY_SCHEMA, result: RESULT_SCHEMA, internal: INTERNAL_SCHEMA },
    platform: { apiMinor: API_MINOR, featureSchema: FEATURE_SCHEMA_VERSION, featureNames: FEATURE_NAMES },
    node: process.version,
    createdAt: new Date().toISOString(),
    argv: process.argv.slice(2),
    coaches: coaches.map((c) => ({ label: c.label, kind: c.kind, style: c.style ?? null, id: c.id ?? null, version: c.version ?? null, timeLimitMs: c.timeLimitMs ?? null, apiMinor: c.apiMinor ?? null, sha256_16: c.sha ?? null, file: undefined })),
    design: { seeds: seedList, rosters: [r1, r2], format, swap, observations, games: plan.length },
    reproducibility: 'Seeded dice and built-in coaches reproduce exactly. A strategy module whose search is bounded by wall-clock time (for example Hopeful) may choose differently on a slower or faster machine when the time budget, not the search space, ends its search; the exact decisions taken are recorded in trajectories.jsonl.',
    files: { trajectory: basename(files.trajectory), internal: basename(files.internal), results: basename(files.result) },
    separation: 'internal.jsonl holds dice and engine log entries. It must never be given to a coach; trajectories.jsonl contains only what a coach could see or choose.',
  };
  writeFileSync(join(out, 'meta.json'), JSON.stringify(meta, null, 1));
  const results: MatchResult[] = [];
  let n = 0;
  for (const cfg of plan) {
    const r = await playMatch(cfg, sink);
    results.push(r);
    n++;
    console.log(`${n}/${plan.length} ${cfg.game} ${cfg.coaches.A.label}(${cfg.rosters.A}) ${r.score.A}-${r.score.B} ${cfg.coaches.B.label}(${cfg.rosters.B})  ${Math.round(r.ms / 1000)}s  fallbacks A${r.fallbacks.A}/B${r.fallbacks.B}`);
  }
  // Summary per coach: results over the whole design.
  const sum: Record<string, { games: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; fallbacks: number; decisions: number; thinkMs: number; maxThinkMs: number }> = {};
  plan.forEach((cfg, k) => {
    const r = results[k];
    for (const t of ['A', 'B'] as const) {
      const c = cfg.coaches[t].label;
      const s = (sum[c] ??= { games: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, fallbacks: 0, decisions: 0, thinkMs: 0, maxThinkMs: 0 });
      s.games++;
      if (r.winner === 'draw') s.draws++;
      else if (r.winner === t) s.wins++;
      else s.losses++;
      s.goalsFor += r.score[t];
      s.goalsAgainst += r.score[t === 'A' ? 'B' : 'A'];
      s.fallbacks += r.fallbacks[t];
      s.decisions += r.decisions[t];
      s.thinkMs += r.thinkMs[t];
      s.maxThinkMs = Math.max(s.maxThinkMs, r.maxThinkMs[t]);
    }
  });
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ coaches: sum, games: plan.length, note: 'Small samples say little: do not read strength into a handful of matches.' }, null, 1));
  console.log(JSON.stringify(sum, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
