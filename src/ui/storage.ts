/**
 * Position storage. Inside the native Mac app (WKWebView) positions are saved
 * as JSON files in ~/Library/Application Support/Bloodboard Endgame Workshop/Positions
 * through a message bridge, and Import/Export use the native Open/Save panels.
 * In a plain browser the same API falls back to localStorage plus file
 * download/upload.
 */
export interface SavedEntry {
  name: string;
  savedAt: string;
  notes?: string;
}

export interface PositionStore {
  kind: 'native' | 'browser';
  list(): Promise<SavedEntry[]>;
  /** `exclusive`: fail with Error('exists') instead of replacing a file of that name (race-safe in the native store). */
  save(name: string, json: string, opts?: { exclusive?: boolean }): Promise<void>;
  load(name: string): Promise<string>;
  remove(name: string): Promise<void>;
  exportFile(suggestedName: string, json: string): Promise<boolean>;
  importFile(): Promise<string | null>;
  revealFolder?(): Promise<void>;
  folderLabel: string;
  /** V5.5 (AI folder): every .json / .js file by file name, and one file's text. */
  listFiles(): Promise<SavedEntry[]>;
  loadFile(name: string): Promise<string>;
  /** V5.5: keep a file under its own name (a browser's "Import AI file", or the Settings file). */
  saveFile(name: string, text: string): Promise<void>;
}

interface NativeHandler {
  postMessage(msg: unknown): void;
}

declare global {
  interface Window {
    webkit?: { messageHandlers?: { bloodboard?: NativeHandler } };
    __bloodboardNativeReply?: (id: number, ok: boolean, payload: unknown) => void;
  }
}

export type StoreFolder = 'Positions' | 'Teams' | 'Progress' | 'Settings' | 'AI';

// One reply handler and one id sequence for every native store (Positions, Teams, Progress).
let nativeSeq = 1;
const nativeWaiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
function installNativeReply() {
  window.__bloodboardNativeReply = (id, ok, payload) => {
    const w = nativeWaiting.get(id);
    if (!w) return;
    nativeWaiting.delete(id);
    if (ok) w.resolve(payload);
    else w.reject(new Error(String(payload)));
  };
}

class NativeStore implements PositionStore {
  kind = 'native' as const;
  folderLabel: string;
  constructor(
    private handler: NativeHandler,
    private folder: StoreFolder,
  ) {
    // The AI folder is ONE shared folder for the game and the Match Lab (docs/AI_FOLDER.md); the other folders stay in the app's own data folder.
    this.folderLabel = folder === 'AI' ? '~/Library/Application Support/Bloodboard/AI' : `~/Library/Application Support/Bloodboard V6/${folder}`;
    installNativeReply();
  }
  private call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
    const id = nativeSeq++;
    return new Promise<T>((resolve, reject) => {
      nativeWaiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.handler.postMessage({ id, cmd, folder: this.folder, ...args });
    });
  }
  /** Older version-specific AI folders that still hold coach files not yet migrated into the shared folder (Mac app only). */
  legacyAI(): Promise<Array<{ path: string; files: number; pending: number }>> {
    return this.call('legacyAI');
  }
  list() {
    return this.call<SavedEntry[]>('list');
  }
  save(name: string, json: string, opts: { exclusive?: boolean } = {}) {
    return this.call<void>('save', { name, json, exclusive: !!opts.exclusive });
  }
  load(name: string) {
    return this.call<string>('load', { name });
  }
  remove(name: string) {
    return this.call<void>('delete', { name });
  }
  exportFile(suggestedName: string, json: string) {
    return this.call<boolean>('export', { name: suggestedName, json });
  }
  importFile() {
    return this.call<string | null>('import');
  }
  revealFolder() {
    return this.call<void>('reveal');
  }
  listFiles() {
    return this.call<SavedEntry[]>('listFiles');
  }
  loadFile(name: string) {
    return this.call<string>('loadFile', { name });
  }
  saveFile(name: string, text: string) {
    // Native Settings / AI folders: JSON files by name (the .json extension is added by the app).
    return this.call<void>('save', { name: name.replace(/\.json$/i, ''), json: text });
  }
  /** V5.5 (AI folder): copy the bundled AI files that are missing back into the folder; returns how many. */
  restoreBundled() {
    return this.call<number>('restoreAI');
  }
}

const KEYS: Record<StoreFolder, string> = { Positions: 'bloodboard.positions.v1', Teams: 'bloodboard.teams.v1', Progress: 'bloodboard.progress.v1', Settings: 'bloodboard.settings.v1', AI: 'bloodboard.ai.v1' };

class BrowserStore implements PositionStore {
  kind = 'browser' as const;
  folderLabel = 'this browser\'s local storage';
  constructor(private key: string) {}
  private read(): Record<string, { json: string; savedAt: string; notes?: string }> {
    try {
      return JSON.parse(localStorage.getItem(this.key) || '{}');
    } catch {
      return {};
    }
  }
  private write(v: Record<string, { json: string; savedAt: string; notes?: string }>) {
    localStorage.setItem(this.key, JSON.stringify(v));
  }
  async list() {
    const d = this.read();
    return Object.entries(d)
      .map(([name, v]) => ({ name, savedAt: v.savedAt, notes: v.notes }))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }
  async save(name: string, json: string, opts: { exclusive?: boolean } = {}) {
    const d = this.read();
    if (opts.exclusive && d[name]) throw new Error('exists');
    let notes: string | undefined;
    try {
      notes = JSON.parse(json).notes;
    } catch {
      notes = undefined;
    }
    d[name] = { json, savedAt: new Date().toISOString(), notes };
    this.write(d);
  }
  async load(name: string) {
    const d = this.read();
    if (!d[name]) throw new Error(`Nothing saved as "${name}".`);
    return d[name].json;
  }
  async remove(name: string) {
    const d = this.read();
    delete d[name];
    this.write(d);
  }
  async exportFile(suggestedName: string, json: string) {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = suggestedName.endsWith('.json') ? suggestedName : `${suggestedName}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    return true;
  }
  async listFiles() {
    return this.list();
  }
  async loadFile(name: string) {
    return this.load(name);
  }
  async saveFile(name: string, text: string) {
    const d = this.read();
    d[name] = { json: text, savedAt: new Date().toISOString() };
    this.write(d);
  }
  importFile(accept = '.json,application/json') {
    return new Promise<string | null>((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = accept;
      inp.onchange = () => {
        const f = inp.files?.[0];
        if (!f) return resolve(null);
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => resolve(null);
        r.readAsText(f);
      };
      inp.click();
    });
  }
}

export function createStore(folder: StoreFolder = 'Positions'): PositionStore {
  const handler = window.webkit?.messageHandlers?.bloodboard;
  if (handler) return new NativeStore(handler, folder);
  return new BrowserStore(KEYS[folder]);
}

/** Names already taken in a store (for the unique-name search). */
const isExists = (e: unknown) => /\bexists\b|already exists|file exists/i.test(String((e as Error)?.message ?? e));

/**
 * V6: create a NEW saved file without ever replacing another one: `Name`, `Name (1)`, `Name (2)` …
 * Each attempt is an exclusive create in the store itself (race-safe), not a prior existence check.
 */
export async function saveUnique(store: PositionStore, baseName: string, json: string, maxTries = 500): Promise<string> {
  const base = baseName.trim() || 'Untitled';
  for (let i = 0; i < maxTries; i++) {
    const name = i === 0 ? base : `${base} (${i})`;
    try {
      await store.save(name, json, { exclusive: true });
      return name;
    } catch (e) {
      if (!isExists(e)) throw e;
    }
  }
  throw new Error(`Could not find a free file name for "${base}".`);
}
