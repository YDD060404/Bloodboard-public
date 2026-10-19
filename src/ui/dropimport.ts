// V7-07: drag-and-drop import on the game window.
//  - match histories (bloodboard-history / batch) and saved positions/matches open directly (histories in Replay, verified first);
//  - AI files (parameter .json, strategy .js) are stored and loaded by the normal AI loader (browser and Mac app).
// Anything else is refused with the file name and a reason. Dropping never navigates the window to the file.
import type { App } from './app';
import { dropAIFile } from './aiload';
import { looksLikeHistory } from './historyio';
import { importTrainingText, looksLikeTraining } from './trainingui';

const MAX_FILES = 40;

export type DropKind = 'history' | 'position' | 'training' | 'ai-json' | 'ai-js' | 'unknown';

/** Classify by name and (for JSON) by the declared format. Pure; exported for tests. */
export function classifyDrop(name: string, head: string): DropKind {
  if (/\.js$/i.test(name)) return 'ai-js';
  if (!/\.json$/i.test(name)) return 'unknown';
  if (looksLikeHistory(head)) return 'history';
  if (looksLikeTraining(head)) return 'training';
  if (/"format"\s*:\s*"bloodboard-ai"/.test(head.slice(0, 600))) return 'ai-json';
  if (/"format"\s*:\s*"bloodboard-position"/.test(head.slice(0, 600))) return 'position';
  return 'unknown';
}

export async function handleDrop(app: App, files: File[]): Promise<void> {
  if (files.length > MAX_FILES) return app.toast(`Too many files at once (${files.length}); drop at most ${MAX_FILES}.`, 'error');
  const report: string[] = [];
  let opened = false;
  for (const f of files) {
    try {
      const text = await f.text();
      const kind = classifyDrop(f.name, text.slice(0, 700));
      if (kind === 'history' || kind === 'position') {
        if (opened) { report.push(`${f.name}: skipped (one match opens at a time; drop it separately)`); continue; }
        if (app.loadText(text, f.name)) { opened = true; report.push(`${f.name}: opened`); }
        else report.push(`${f.name}: refused (see the message above)`);
      } else if (kind === 'training') {
        await importTrainingText(app, text, f.name); // explains its own result in a message of its own (per item); nothing to add here
      } else if (kind === 'ai-json' || kind === 'ai-js') {
        const r = await dropAIFile(app, f.name, text);
        report.push(`${f.name}: ${r.message}`);
      } else report.push(`${f.name}: not recognised (expected a Bloodboard history, saved match/position, or AI file)`);
    } catch (e) { report.push(`${f.name}: could not be read (${(e as Error).message})`); }
  }
  const single = files.length === 1 && /\.json$/i.test(files[0].name) && report.length === 1 && /: (opened|refused)/.test(report[0]); // loadText already explained why
  if (report.length && !single) app.toast(report.join(' · '), report.some((r) => /refused|not recognised|could not|skipped|too/i.test(r)) ? 'error' : undefined);
}

export function installDropImport(app: App): void {
  const hasFiles = (ev: DragEvent) => !!ev.dataTransfer && Array.from(ev.dataTransfer.types ?? []).includes('Files');
  let depth = 0;
  const hint = () => document.body.classList.toggle('dropping', depth > 0);
  window.addEventListener('dragenter', (ev) => { if (hasFiles(ev)) { depth++; hint(); } });
  window.addEventListener('dragleave', (ev) => { if (hasFiles(ev)) { depth = Math.max(0, depth - 1); hint(); } });
  window.addEventListener('dragover', (ev) => { if (hasFiles(ev)) { ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('drop', (ev) => {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    depth = 0; hint();
    void handleDrop(app, Array.from(ev.dataTransfer?.files ?? []));
  });
}
