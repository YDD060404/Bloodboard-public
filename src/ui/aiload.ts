/**
 * V5.5: reading the AI folder — the AI files (parameter files *.json and strategy modules *.js) — into the one list
 * the game offers wherever a computer coach is chosen: Player 1, Player 2, computer v computer, the advisory coach
 * (src/ai/registry.ts, docs/AI_EXTENSIONS.md).
 *
 *  - Mac app: ~/Library/Application Support/Bloodboard/AI — ONE folder shared with the Match Lab (File ▸ Show AI Folder in Finder). On the
 *    first launch of V5.5 the app puts the bundled AI files there once (the three "Bloodboard AI" files); after that
 *    the folder holds exactly what you leave in it — "Restore bundled AI files" puts missing ones back.
 *  - browser: the AI files bundled in dist/web/ai (the release's ai/ folder when the interface was built), plus files
 *    imported with "Import AI file…" (kept in this browser's local storage).
 * Invalid files are listed with their errors and cannot be chosen; loading never throws.
 */
import type { App } from './app';
import { parseAIFile, setLoadedCoaches, AI_API_VERSION, type CoachEntry } from '../ai/index';
import { createStore, type PositionStore } from './storage';
import { STRATEGY_API_MINOR, STRATEGY_API_VERSION, STRATEGY_SERVICES, strategyMeta } from './strategy';
import { negotiate } from '../platform/capabilities';
import { API_V2_MINOR, API_V2_VERSION, SUPPORTED_API_VERSIONS } from '../platform/limits';

declare global {
  interface Window {
    /** dist/web/ai/bundled.js: the AI files bundled with the interface (browser use). */
    BLOODBOARD_BUNDLED_AI?: Array<{ name: string; text: string }>;
  }
}

/** Resource accounting for strategy modules (V7-01). The old 400 KB rejection is gone: these are a warning level and a memory guard. */
export const AI_MODULE_WARN_BYTES = 8 * 1024 * 1024;
export const AI_MODULE_GUARD_BYTES = 192 * 1024 * 1024;
export const formatBytes = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(0)} KB` : `${n} B`);

let store: PositionStore | null = null;
const aiStore = () => (store ??= createStore('AI'));

export let aiLoadState: { loading: boolean; loadedAt: string | null; files: number; errors: number; folder: string } = { loading: false, loadedAt: null, files: 0, errors: 0, folder: '' };

let legacyWarned = false;

/** What was read from the AI folder in the last load, with each file's SHA-256 of its bytes (used by verification: the game and the Match Lab must agree). */
export interface LoadedCoachReport { file: string; id: string; name: string; version: string; sha: string | null; errors: string[] }
let lastReport: LoadedCoachReport[] = [];
export const loadedCoachReport = (): LoadedCoachReport[] => lastReport;
async function sha256Hex(text: string): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

/** Read every file of the AI folder and make the valid ones selectable. */
export async function loadAIFolder(app: App): Promise<void> {
  const s = aiStore();
  const native = s.kind === 'native';
  aiLoadState = { ...aiLoadState, loading: true, folder: native ? '~/Library/Application Support/Bloodboard/AI' : "the AI files bundled with this page (dist/web/ai) and those imported into this browser's local storage" };
  const entries: CoachEntry[] = [];
  const reports: LoadedCoachReport[] = [];
  const add = async (name: string, text: string) => {
    let e: CoachEntry | null = null;
    if (/\.js$/i.test(name)) e = await strategyEntry(name, text);
    else if (/\.json$/i.test(name)) e = parseAIFile(text, name);
    if (!e) return;
    entries.push(e);
    reports.push({ file: name, id: e.id, name: e.name, version: e.version, sha: await sha256Hex(text), errors: e.errors ?? [] });
  };
  try {
    const files = await s.listFiles();
    for (const f of files) {
      let text = '';
      try {
        text = await s.loadFile(f.name);
      } catch (e) {
        entries.push(broken(f.name, `Could not read the file: ${(e as Error).message}`));
        continue;
      }
      await add(f.name, text);
    }
    if (!native) for (const b of window.BLOODBOARD_BUNDLED_AI ?? []) await add(b.name, b.text);
  } catch (e) {
    aiLoadState = { ...aiLoadState, loading: false };
    app.toast(`Could not read the AI folder: ${(e as Error).message}`, 'error');
    return;
  }
  // Two files with the same id: the first one found wins, the others are listed as duplicates.
  const seen = new Set<string>();
  for (const x of entries) {
    if (x.errors?.length) continue;
    if (seen.has(x.id)) x.errors = [`Another AI file already uses the id "${x.id}".`];
    seen.add(x.id);
  }
  setLoadedCoaches(entries);
  lastReport = reports;
  // Older version-specific AI folders: never read as a second source; if they still hold files the shared folder lacks, say so once.
  if (native && typeof (s as unknown as { legacyAI?: unknown }).legacyAI === 'function') {
    try {
      const legacy = await (s as unknown as { legacyAI(): Promise<Array<{ path: string; files: number; pending: number }>> }).legacyAI();
      const n = legacy.reduce((a, x) => a + x.pending, 0);
      if (n > 0 && !legacyWarned) {
        legacyWarned = true;
        app.toast(`${n} coach file${n === 1 ? '' : 's'} in older AI folders ${n === 1 ? 'is' : 'are'} not in the shared AI folder yet. Run the migration (docs/AI_FOLDER.md), then press “Reload AI list”.`, 'error');
      }
    } catch { /* an older app build has no such command */ }
  }
  aiLoadState = { ...aiLoadState, loading: false, loadedAt: new Date().toISOString(), files: entries.length, errors: entries.filter((x) => x.errors?.length).length };
  app.emit();
}

/** Put the bundled AI files back into the AI folder (only those missing; nothing is overwritten). */
export async function restoreBundledAI(app: App): Promise<void> {
  const s = aiStore();
  if (s.kind === 'native') {
    try {
      await (s as unknown as { restoreBundled: () => Promise<number> }).restoreBundled();
    } catch (e) {
      app.toast(`Could not restore the bundled AI files: ${(e as Error).message}`, 'error');
      return;
    }
  }
  await loadAIFolder(app);
  app.toast('The bundled AI files are in the AI folder again.');
}

function broken(name: string, why: string): CoachEntry {
  return { id: `file:${name}`, name, kind: /\.js$/i.test(name) ? 'strategy' : 'parameters', implementation: '?', version: '?', description: '', source: name, errors: [why] };
}

async function strategyEntry(name: string, code: string): Promise<CoachEntry> {
  // V7-01: no arbitrary size ceiling. Size is ACCOUNTED (shown in the AI list, warned about when large) and only a guard against
  // exhausting the page's memory applies; the guard says why and how to proceed instead of silently rejecting.
  const bytes = new Blob([code]).size;
  if (bytes > AI_MODULE_GUARD_BYTES) return broken(name, `The module is ${formatBytes(bytes)}, above the ${formatBytes(AI_MODULE_GUARD_BYTES)} the interface can hold in memory as one script. Ship large model data as a separate package resource (docs/AI_PACKAGES.md) instead of inside the script.`);
  const m = await strategyMeta(code);
  if (!m.meta) return broken(name, m.error ?? 'Not a strategy module.');
  const errors: string[] = [];
  const gen = Number(m.meta.apiVersion);
  if (!SUPPORTED_API_VERSIONS.includes(gen)) errors.push(`apiVersion ${String(m.meta.apiVersion)} is not supported (this app: ${SUPPORTED_API_VERSIONS.join(' and ')}).`);
  const minor = Number(m.meta.apiMinor ?? 0) || 0;
  const maxMinor = gen === API_V2_VERSION ? API_V2_MINOR : STRATEGY_API_MINOR;
  if (SUPPORTED_API_VERSIONS.includes(gen) && minor > maxMinor) errors.push(`apiMinor ${minor} is newer than this app (${maxMinor}).`);
  const neg = negotiate({ apiVersion: gen, hooks: m.meta.hooks, declaredCapabilities: m.meta.declaredCapabilities, requiresCapabilities: m.meta.requiresCapabilities, contextSchema: m.meta.contextSchema });
  errors.push(...neg.errors);
  const req = Array.isArray(m.meta.requires) ? m.meta.requires.map(String) : [];
  const missing = req.filter((x) => !STRATEGY_SERVICES.includes(x));
  if (missing.length) errors.push(`requires services this app does not offer: ${missing.join(', ')}.`);
  if (typeof m.meta.id !== 'string' || !/^[a-z0-9][a-z0-9-_]{1,40}$/i.test(m.meta.id)) errors.push('id: 2-41 letters, digits, "-" or "_".');
  if (typeof m.meta.name !== 'string' || !m.meta.name.trim()) errors.push('name is missing.');
  if (typeof m.meta.version !== 'string' || !m.meta.version.trim()) errors.push('version is missing (a short text such as "1.0").');
  const e: CoachEntry = {
    id: String(m.meta.id),
    name: m.meta.name || name,
    kind: 'strategy',
    implementation: `strategy:${m.meta.id}`,
    version: String(m.meta.version ?? '?'),
    description: (m.meta.description ?? 'A strategy module.').slice(0, 500),
    source: name,
    errors: errors.length ? errors : undefined,
    code: errors.length ? undefined : code,
    // The coach's own thinking-time limit per decision, from its file: 0.5 s – 120 s (5 s when absent); the host clamps again.
    timeLimitMs: Number.isFinite(Number(m.meta.timeLimitMs)) && Number(m.meta.timeLimitMs) > 0 ? Math.min(120000, Math.max(500, Number(m.meta.timeLimitMs))) : undefined,
    apiMinor: minor,
    apiGeneration: gen,
    contextSchema: typeof m.meta.contextSchema === 'string' ? m.meta.contextSchema : undefined,
    capabilities: neg.capabilities,
    requiresCapabilities: m.meta.requiresCapabilities,
    requires: req.length ? req : undefined,
    resource: { bytes, level: bytes > AI_MODULE_WARN_BYTES ? 'large' : 'normal' },
  };
  if (bytes > AI_MODULE_WARN_BYTES) e.description = `${e.description} [${formatBytes(bytes)} — loading it into each worker takes longer]`.slice(0, 560);
  return e;
}

/** A browser: import a profile (.json) or strategy module (.js) into local storage. The Mac app: open the AI folder. */
export async function importAIFile(app: App): Promise<void> {
  const s = aiStore();
  if (s.kind === 'native') {
    await s.revealFolder?.();
    app.toast('Put AI files (.json parameter files, .js strategy modules) into this folder, then press “Reload AI list”.');
    return;
  }
  const picked = await new Promise<{ name: string; text: string } | null>((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,.js,application/json,text/javascript';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve({ name: f.name, text: String(r.result) });
      r.onerror = () => resolve(null);
      r.readAsText(f);
    };
    inp.click();
  });
  if (!picked) return;
  if (!/\.(json|js)$/i.test(picked.name)) return app.toast('Choose an AI file: .json (parameter file) or .js (strategy module).', 'error');
  await s.saveFile(picked.name, picked.text);
  await loadAIFolder(app);
  app.toast(`Imported ${picked.name}.`);
}

/** Browser only: keep a generated coach in this page's AI store (the Mac app reads the AI folder, where the bridge installs it). */
export async function saveAIFileText(app: App, name: string, text: string): Promise<void> {
  const s = aiStore();
  if (s.kind === 'native') return loadAIFolder(app);
  await s.saveFile(name, text);
  await loadAIFolder(app);
}

/** Remove an imported AI file (browser storage only; in the Mac app remove the file from the AI folder). */
export async function removeAIFile(app: App, name: string): Promise<void> {
  const s = aiStore();
  if (s.kind === 'native') return app.toast('Remove the file from the AI folder in Finder, then press “Reload AI list”.');
  await s.remove(name);
  await loadAIFolder(app);
}

export const aiStoreKind = () => aiStore().kind;

export const AI_FOLDER_DOC = `AI files: parameter files (*.json, format "bloodboard-ai" 1, apiVersion ${AI_API_VERSION}) and strategy modules (*.js, strategy API ${STRATEGY_API_VERSION}) — docs/AI_EXTENSIONS.md`;

/**
 * V7-07: a file dropped on the window. Both platforms go through here (the browser store and the native AI folder share the store interface).
 * Returns a plain-language outcome. Size is checked against the resource guard (never an arbitrary small cap); nothing is executed here —
 * a module is only stored, then loaded (and validated) by the same loader as every other AI file.
 */
export async function dropAIFile(app: App, name: string, text: string): Promise<{ ok: boolean; message: string }> {
  const s = aiStore();
  const bytes = new Blob([text]).size;
  if (bytes > AI_MODULE_GUARD_BYTES) return { ok: false, message: `${name} is ${formatBytes(bytes)}, above the ${formatBytes(AI_MODULE_GUARD_BYTES)} resource guard; place it in the AI folder and see docs/AI_PACKAGES.md.` };
  if (/\.js$/i.test(name) && s.kind === 'native') {
    await s.revealFolder?.();
    return { ok: false, message: `${name} is a strategy module: the Mac app stores modules as files, so copy it into the AI folder (opened now) and press “Reload AI list”.` };
  }
  if (!/^[\w][\w .()+-]*\.(json|js)$/i.test(name)) return { ok: false, message: `“${name}” is not a usable AI file name (letters, digits, space, . _ - ( ) +).` };
  await s.saveFile(name, text);
  await loadAIFolder(app);
  return { ok: true, message: `Imported ${name} (${formatBytes(bytes)}); the AI list was reloaded and the file validated by the normal loader.` };
}
