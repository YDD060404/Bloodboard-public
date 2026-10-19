// A few short Sevens games with a reduced time limit — pipeline check (legality, fallbacks, timing), NOT a strength measurement.
import { readFileSync } from 'node:fs';
import * as Engine from '../src/engine/index';
import { bindEngine } from '../src/ai/index';
import { playMatch } from '../src/platform/research/match';
bindEngine(Engine);
declare const process: any;
const [, , aKind, bKind, seedS, limS] = process.argv;
const lim = Number(limS || 6000);
const v2 = readFileSync('ai-models/vanguard/vanguard-2-0.js', 'utf8');
const v1 = readFileSync('ai-models/vanguard/vanguard-1-0.js', 'utf8');
const spec = (k: string) => k === 'bal' ? { label: 'Balanced', kind: 'builtin' as const, style: 'balanced' as const } : k === 'v1' ? { label: 'Vanguard 1.0', kind: 'module' as const, id: 'vanguard-1-0', version: '1.0', code: v1, timeLimitMs: lim, apiMinor: 2 } : { label: 'Vanguard 2.0', kind: 'module' as const, id: 'vanguard-2-0', version: '2.0', code: v2, timeLimitMs: lim, apiMinor: 2 };
const lines: any[] = [];
const t0 = Date.now();
const res = await playMatch({ game: `${aKind}-${bKind}-${seedS}`, seed: Number(seedS), format: 'sevens', mode: 'tournament', rosters: { A: 'human', B: 'orc' }, coaches: { A: spec(aKind), B: spec(bKind) }, observations: 'none', rules: 'introductory', maxSteps: 4000 } as never, { trajectory: (l) => lines.push(l), internal: () => undefined, result: () => undefined });
const dec = lines.filter((l) => l.kind !== 'setup');
const v2d = dec.filter((l) => String(l.source?.coach ?? l.coach ?? '').includes('2.0') || l.why?.startsWith?.('Vanguard 2.0'));
console.log(JSON.stringify({ game: res.game, A: aKind, B: bKind, score: res.score, winner: res.winner, fallbacks: res.fallbacks, decisions: res.decisions, thinkMs: res.thinkMs, maxThinkMs: res.maxThinkMs, incidents: (res.incidents || []).slice(0, 5), wallS: Math.round((Date.now() - t0) / 1000), v2Why: v2d.length }));
