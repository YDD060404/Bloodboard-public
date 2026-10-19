// Canonical match history in the game UI (V7-06): export the current match, and open a history or a batch directly in Replay.
import { E } from './engine-global';
import type { App } from './app';
import { computerCoaches } from './computer';

export const looksLikeHistory = (text: string): boolean => /"format"\s*:\s*"bloodboard-history(-batch)?"/.test(text.slice(0, 400));

/** Build the canonical history for the match on screen. Returns text, or a plain-language reason it cannot be exported. */
export function exportCurrentHistory(app: App): { ok: true; text: string; name: string } | { ok: false; error: string } {
  const g = app.game;
  const coaches = computerCoaches(app);
  const ctrl = (t: 'A' | 'B') => {
    const c = coaches.find((x) => x.team === t);
    return c ? { kind: 'coach' as const, coachId: c.entry.id, coachVersion: c.entry.version } : { kind: 'human' as const };
  };
  const r = E.toHistory(g, { source: 'game', initial: app.st.matchInitial ?? null, participants: { A: { controller: ctrl('A') }, B: { controller: ctrl('B') } } });
  if (!r.ok) return r;
  const safe = (app.st.docName ?? r.history.title).replace(/[^\w\- ]+/g, '').trim() || 'bloodboard-history';
  return { ok: true, text: E.serializeHistory(r.history), name: `${safe}.history.json` };
}

/** Open a history file (or the first verified game of a batch) in Replay. Every game is verified by re-execution first. */
export function openHistoryText(app: App, text: string): boolean {
  const imp = E.importHistories(text);
  if (!imp.ok) { app.toast(`Could not open history: ${imp.errors.slice(0, 3).join('; ')}`, 'error'); return false; }
  const bad = imp.reports.filter((x) => x.grade === 'refused');
  if (!imp.verified.length) { app.toast(`History refused: ${bad[0]?.reason ?? 'nothing verified'}`, 'error'); return false; }
  const h = imp.verified[0];
  const v = E.verifyHistory(h);
  if (!v.final) return false;
  const save = E.toSaveFile(v.final, h.title, `Opened from a ${h.source} history (${h.id}).`, { initial: h.initial });
  const n = imp.reports.length;
  void import('./replayui').then(({ openSaved }) => {
    openSaved(app, save, null, 'replay');
    app.toast(n > 1 ? `Batch of ${n} games: ${imp.verified.length} verified${bad.length ? `, ${bad.length} refused (${bad[0].reason})` : ''}. Showing “${h.title}”.` : `History “${h.title}” verified: ${v.reason}`);
  });
  return true;
}
