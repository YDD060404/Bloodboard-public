// V7-05 / V7-12: the network-match client. It never runs rules: it sends intents (an action input or a decision choice) to the match
// server and applies the public state and events the server returns. Transport: HTTP + Server-Sent Events from the same origin that served
// the page (LAN or a tunnel to it). Nothing here touches the online-coach bridge or any credential.
import type { App } from './app';
import { h } from './dom';
import { E } from './engine-global';
import type { ActionInput, ExecutionResult, GameEvent, GameState, LogEntry, TeamId } from '../engine/index';
import { shell } from './modals';
import { openSetup } from './matchsetup';
import { modeCfg } from './setupPrefs';

export type Seat = 'A' | 'B' | 'S';
export interface PeerView { A: { name: string; connected: boolean } | null; B: { name: string; connected: boolean } | null; spectators: number }
type Command = { kind: 'action'; input: ActionInput } | { kind: 'decision'; choice: { requestId: string; optionId: string } };
const STORE = 'bloodboard.lan.session.v1';
const PROTOCOL = 1;
const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));
/** A free host sleeps after ~15 minutes without traffic and needs about a minute to wake. Gateway answers (502/503/504) and dropped connections mean "still waking", not "wrong address". */
const WAKE_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524]);
const WAKE_TOTAL_MS = 120_000;
const KEEPALIVE_MS = 4 * 60_000;

interface Saved { base: string; token: string; seat: Seat; room: string; name: string }
const readSaved = (): Saved | null => { try { const v = JSON.parse(localStorage.getItem(STORE) || 'null') as Saved | null; return v && v.token ? v : null; } catch { return null; } };
const writeSaved = (v: Saved | null) => { try { if (v) localStorage.setItem(STORE, JSON.stringify(v)); else localStorage.removeItem(STORE); return true; } catch { return false; } };

export class LanSession {
  base = '';
  room = '';
  seat: Seat = 'S';
  token = '';
  name = '';
  rev = 0;
  started = false;
  hosting = false;
  over = false;
  reopenAt: number | null = null;
  status: 'connecting' | 'online' | 'reconnecting' | 'closed' = 'connecting';
  /** How the server says it is run (lan | internet) and whether the connection is encrypted (HTTPS here or terminated by the host's tunnel). */
  mode: 'lan' | 'internet' = 'lan';
  secure = false;
  get connectionLabel(): string { return this.mode === 'internet' ? (this.secure ? 'Internet match — encrypted (HTTPS)' : 'Internet match — NOT encrypted (anyone on the path can read it)') : 'Local network match'; }
  peers: PeerView = { A: null, B: null, spectators: 0 };
  busy = false;
  lastError: string | null = null;
  credentialsSaved = true;
  /** Shown while the (free) host is waking up or the connection is being re-established; null when everything is fine. */
  note: string | null = null;
  /** The room code is kept in memory only (never saved) so a reset room can be re-joined automatically. */
  private code = '';
  private resetting = false;
  private es: EventSource | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private keepTimer: ReturnType<typeof setInterval> | null = null;
  private retryN = 0;
  private reconnecting = false;
  private boardOpen = false;
  private resyncing = false;
  constructor(private app: App) {}

  get active(): boolean { return this.started && this.status !== 'closed'; }
  get mySeat(): TeamId | null { return this.seat === 'A' || this.seat === 'B' ? this.seat : null; }

  private url(path: string): string { return `${this.base}${path}`; }
  private async api(path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const ctl = new AbortController(); const timeout = setTimeout(() => ctl.abort(), 35_000);
    try {
      const r = await fetch(this.url(path), body === undefined ? { signal: ctl.signal } : { signal: ctl.signal, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: r.status, json };
    } finally { clearTimeout(timeout); }
  }
  private clientInfo() { const fp = E.BUILD_FINGERPRINT; return { protocol: PROTOCOL, rulesHash: fp.rulesHash, apiHash: fp.apiHash, engineVersion: fp.version, editions: ['faq2026', 'legacy'] }; }

  /** Take a seat (with the room code) or re-take it (with the saved token). */
  async join(o: { base: string; code?: string; seat?: Seat; name: string; token?: string }): Promise<{ ok: true } | { ok: false; message: string; code?: string }> {
    this.base = o.base.replace(/\/+$/, '');
    this.name = o.name;
    this.code = o.code ?? '';
    const ping = await this.wakeUp();
    if (!ping) return { ok: false, message: `Cannot reach the match server at ${this.base || location.origin}. Check the address, that the host's server is running and (for a local match) that both devices are on the same network; for an internet match use the https:// address the host gives you. A free host can take up to two minutes to wake up: try again once.` };
    if (!ping.json.bloodboardLan) return { ok: false, message: 'That address is not a Bloodboard match server.' };
    this.room = String(ping.json.room ?? '');
    this.mode = ping.json.mode === 'internet' ? 'internet' : 'lan'; this.secure = !!ping.json.secure || location.protocol === 'https:' || this.base.startsWith('https://');
    let r = await this.api('/api/join', { code: o.code, seat: o.seat, name: o.name, token: o.token, client: this.clientInfo() });
    for (let i = 0; i < 4 && (r.status === 503 || WAKE_STATUS.has(r.status)); i++) { this.setNote('The match server is busy saving or waking; retrying…'); await sleep(1500 * (i + 1)); r = await this.api('/api/join', { code: o.code, seat: o.seat, name: o.name, token: o.token, client: this.clientInfo() }); }
    this.setNote(null);
    if (r.status !== 200 || !r.json.ok) return { ok: false, message: String(r.json.message ?? `The server refused the request (${r.status}).`), code: String(r.json.code ?? '') };
    this.seat = r.json.seat as Seat; this.token = r.json.token as string;
    this.credentialsSaved = writeSaved({ base: this.base, token: this.token, seat: this.seat, room: this.room, name: this.name });
    this.app.lan = this; // set before the first snapshot can arrive (the board then opens with network gating in place)
    this.connect();
    this.startKeepalive();
    return { ok: true };
  }

  private setNote(n: string | null): void { if (this.note !== n) { this.note = n; joinNote = n; this.app.emit(); } }

  /** Ping until the server answers like a Bloodboard server. Covers a free host's cold start (about a minute) with a visible note instead of a failure. */
  private async wakeUp(): Promise<{ status: number; json: Record<string, unknown> } | null> {
    const t0 = Date.now();
    for (let i = 0; ; i++) {
      try {
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 25_000);
        let r;
        try { const x = await fetch(this.url('/api/ping'), { signal: ctl.signal }); r = { status: x.status, json: (await x.json().catch(() => ({}))) as Record<string, unknown> }; } finally { clearTimeout(to); }
        if (r.json.bloodboardLan) { this.setNote(null); return r; }
        if (!WAKE_STATUS.has(r.status)) { this.setNote(null); return r; }
      } catch { /* network error or timeout: treat like waking, up to the limit */ }
      if (Date.now() - t0 > WAKE_TOTAL_MS) { this.setNote(null); return null; }
      this.setNote(i === 0 ? 'The match server is waking up (a free host sleeps when idle). This can take up to a minute…' : `Still waking up… ${Math.round((Date.now() - t0) / 1000)} s`);
      await sleep(Math.min(8000, 2000 + i * 1000));
    }
  }

  /** While a match is on and this tab is visible, ping every 4 minutes so the free host does not go to sleep mid-game. */
  private startKeepalive(): void {
    if (this.keepTimer) return;
    this.keepTimer = setInterval(() => {
      if (this.status === 'closed' || this.over || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
      void fetch(this.url('/api/ping')).catch(() => undefined);
    }, KEEPALIVE_MS);
  }

  connect(): void {
    this.es?.close();
    this.status = this.started ? 'reconnecting' : 'connecting';
    const es = new EventSource(this.url(`/api/events?token=${encodeURIComponent(this.token)}`));
    this.es = es;
    es.onopen = () => { this.status = 'online'; this.retryN = 0; this.note = null; this.app.emit(); };
    // A 502/503 while a free host wakes makes the browser give up on EventSource for good, so reconnecting is done here, with back-off.
    es.onerror = () => { if (this.status === 'closed') return; this.status = 'reconnecting'; es.close(); if (this.es === es) this.es = null; this.app.emit(); this.scheduleReconnect(); };
    es.onmessage = (ev) => { try { this.onMessage(JSON.parse(ev.data) as Record<string, unknown>); } catch (e) { this.lastError = (e as Error).message; } };
  }

  private scheduleReconnect(): void {
    if (this.retryTimer || this.status === 'closed') return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.retryN, 5)); this.retryN++;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.reconnect(); }, delay);
  }
  private async reconnect(): Promise<void> {
    if (this.status === 'closed' || this.reconnecting) return;
    this.reconnecting = true;
    try {
      let r;
      try { r = await this.api(`/api/state?token=${encodeURIComponent(this.token)}`); } catch { r = null; }
      if ((this.status as string) === 'closed') return;
      if (r && r.status === 200) { this.onMessage(r.json); this.connect(); return; } // the server (possibly just woken from its store) knows this seat
      if (r && r.status === 401) { await this.lostRoom(); return; }                   // the room was reset or replaced: the saved token is void
      this.setNote(this.retryN > 2 ? 'Connection lost; the server may be waking up. Retrying automatically…' : 'Reconnecting…');
      this.scheduleReconnect();
    } finally { this.reconnecting = false; }
  }
  /** The server no longer knows this seat. If we still hold the room code, take the same seat again; otherwise ask for the code. */
  private async lostRoom(): Promise<void> {
    if (this.resetting) return;
    if (this.code && this.seat !== 'A') {
      const l = new LanSession(this.app); const old = this; old.close(false);
      const r = await l.join({ base: this.base, code: this.code, seat: this.seat, name: this.name });
      if (r.ok) { this.app.lan = l; this.app.toast('A new match room was opened; you were seated again automatically.'); this.app.emit(); return; }
    }
    this.lastError = 'The match room was reset or is no longer available. Join again with the room code.';
    writeSaved(null); this.close(true); this.app.toast(`Network match: ${this.lastError}`, 'error');
  }

  close(forget = true): void {
    this.status = 'closed';
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.keepTimer) { clearInterval(this.keepTimer); this.keepTimer = null; }
    this.es?.close(); this.es = null;
    if (forget) writeSaved(null);
    this.app.emit();
  }

  private onMessage(m: Record<string, unknown>): void {
    const app = this.app;
    if ('reopenAt' in m) this.reopenAt = typeof m.reopenAt === 'number' ? m.reopenAt : null;
    if (m.type === 'snapshot') {
      this.rev = m.rev as number; this.peers = m.seats as PeerView; this.status = 'online';
      if (m.state) this.adopt(m.state as GameState, m.over === true);
      else app.emit();
    } else if (m.type === 'update') {
      if ((m.rev as number) !== this.rev + 1) { void this.resync('missed an update'); return; }
      const r = E.applyWireUpdate(app.game, m as never);
      if (!r.ok) { void this.resync(r.reason); return; }
      this.rev = m.rev as number;
      const state = r.state;
      const res = { status: m.status as ExecutionResult['status'], state, events: (m.events as GameEvent[]) ?? [], ...(m.status === 'awaitingDecision' ? { decision: state.pending?.request } : {}) } as ExecutionResult;
      app.applyRemoteResult(res, String(m.title ?? ''), m.isDecision === true, m.by as TeamId);
      if (state.phase === 'fullTime') { this.over = true; app.toast('Full time. This room reopens automatically in one minute. Download the verified history from the Network menu.'); }
    } else if (m.type === 'presence') {
      this.peers = m.seats as PeerView; app.emit();
    } else if (m.type === 'error' && m.code === 'room_reset') {
      this.es?.close(); this.es = null;
      if (m.automatic === true) {
        this.close(true); app.set({ screen: 'home', modal: null });
        app.toast('The finished match was archived and both seats released. Use the same room code to start a new match.');
      } else void this.lostRoom();
    } else if (m.type === 'error') {
      this.lastError = String(m.message ?? 'error');
      this.close(m.code === 'unauthorized' || m.code === 'seat_released'); app.toast(`Network match: ${this.lastError}`, 'error'); app.emit();
    }
  }

  /** (Re)build the board from an authoritative snapshot. */
  private adopt(state: GameState, over: boolean): void {
    const app = this.app;
    this.started = true; this.over = over; this.hosting = false;
    if (!this.boardOpen || app.st.ctx.kind !== 'match') {
      app.openBoard(state, { kind: 'match', matchKind: 'tournament' }, { docName: `${state.teams.A.name} v ${state.teams.B.name} (network)`, matchId: this.room });
      this.boardOpen = true;
      app.set({ modal: null });
      app.toast(this.seat === 'S' ? 'Watching a network match.' : `Network match: you are Player ${this.seat === 'A' ? '1' : '2'} (${state.teams[this.seat].name}).`);
    } else app.replaceGame(state, { keepDirty: true });
  }

  async resync(why: string): Promise<void> {
    if (this.resyncing) return;
    this.resyncing = true;
    try { const r = await this.api(`/api/state?token=${encodeURIComponent(this.token)}`); if (r.status === 200) this.onMessage(r.json); else this.app.toast(`Could not resynchronise (${why}).`, 'error'); }
    catch { this.app.toast('Lost the connection to the match server; retrying…', 'error'); }
    finally { this.resyncing = false; }
  }

  /** Send an intent. The result arrives as an update for everybody (including this client); errors are explained here. */
  async send(c: Command): Promise<boolean> {
    if (this.seat === 'S') { this.app.toast('Spectators cannot play.', 'error'); return false; }
    if (this.busy) return false;
    this.busy = true;
    const commandId = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        let r;
        try { r = await this.api('/api/command', { token: this.token, commandId, baseRev: this.rev, ...c }); }
        catch { if (attempt === 4) { this.app.toast('The network connection dropped before the server answered. Your command was not lost or doubled: reconnecting.', 'error'); this.status = 'reconnecting'; this.scheduleReconnect(); return false; } await sleep(600 * (attempt + 1)); continue; }
        if (r.status === 503 || WAKE_STATUS.has(r.status)) { // store busy or host waking: the same commandId makes the retry safe (applied exactly once)
          if (attempt === 4) { this.app.toast('The match server could not save your move yet; nothing was changed. Try again in a moment.', 'error'); return false; }
          this.setNote('Saving your move… the server is busy; retrying.'); await sleep(1200 * (attempt + 1)); continue;
        }
        this.setNote(null);
        if (r.status === 200) return true; // the same commandId is idempotent on the server, so a retry after a lost answer cannot act twice
        const code = String(r.json.code ?? '');
        if (code === 'stale') { this.app.toast('The other coach acted first; your view was refreshed — decide again.', 'error'); await this.resync('stale'); return false; }
        this.app.toast(String(r.json.message ?? `Refused (${code}).`), 'error');
        return false;
      }
      return false;
    } finally { this.busy = false; this.app.emit(); }
  }

  /** Player 1 hands the finished set-up to the server, which owns the dice from then on. */
  async startMatch(state: GameState): Promise<boolean> {
    const r = await this.api('/api/start', { token: this.token, state });
    if (r.status !== 200 || !r.json.ok) { this.app.toast(`Could not start the network match: ${String(r.json.message ?? r.status)}`, 'error'); return false; }
    return true;
  }

  /** Player 1 archives the finished (or, with abandon, the running) match and opens a fresh one in the same room with the same code. */
  async newMatch(abandon = false): Promise<boolean> {
    if (this.seat !== 'A' || this.busy) return false;
    this.busy = true; this.resetting = true; this.app.emit();
    try {
      const r = await this.api('/api/reset', { token: this.token, abandon });
      if (r.status !== 200 || !r.json.ok) { this.app.toast(String(r.json.message ?? 'Reset was not confirmed; reconnect to check the room.'), 'error'); return false; }
      this.close(true);
      this.app.lan = null; this.app.set({ screen: 'home', modal: { kind: 'lan' } });
      if (!this.code) { this.app.toast('Old match archived. Rejoin with the same room code.'); return true; }
      const s = new LanSession(this.app);
      const j = await s.join({ base: this.base, code: this.code, seat: 'A', name: this.name });
      if (!j.ok) { this.app.toast(`Room reset succeeded. Rejoin: ${j.message}`, 'error'); return true; }
      this.app.lan = s; this.app.toast('Fresh room ready. Player 2 can rejoin with the same code.'); return true;
    } catch { this.app.toast('Reset was not confirmed. Your credentials are retained; reconnect to check the room.', 'error'); return false; }
    finally { this.busy = false; this.resetting = false; this.app.emit(); }
  }

  async releaseSeat(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true; this.app.emit();
    try {
      const r = await this.api('/api/leave', { token: this.token });
      if (r.status !== 200 || !r.json.ok) { this.app.toast(String(r.json.message ?? 'Seat release was not confirmed; your reconnect credentials are retained.'), 'error'); return false; }
      this.close(true); this.app.lan = null; this.app.set({ screen: 'home', modal: null }); return true;
    } catch { this.app.toast('Seat release was not confirmed. Reconnect credentials were retained; try again.', 'error'); return false; }
    finally { this.busy = false; this.app.emit(); }
  }

  historyUrl(): string { return this.url(`/api/history?token=${encodeURIComponent(this.token)}`); }
}

// ------------------------------------------------------------------ app glue

export function lanSend(app: App, c: Command): void { void app.lan?.send(c); }

/** Set-up screen → start: when this client is hosting, the finished match goes to the server instead of opening a local board. */
export function lanHostIntercept(app: App, state: GameState): boolean {
  const l = app.lan;
  if (!l || !l.hosting || l.seat !== 'A') return false;
  void l.startMatch(state).then((ok) => { if (ok) app.toast('Match started. Waiting for Player 2…'); });
  return true;
}

export async function restoreLan(app: App): Promise<void> {
  const memory = app.lan;
  const s = readSaved() ?? (memory && memory.status === 'closed' && memory.token ? { base: memory.base, token: memory.token, seat: memory.seat, room: memory.room, name: memory.name } : null);
  if (!s || (app.lan && app.lan.status !== 'closed')) return;
  const l = new LanSession(app);
  const r = await l.join({ base: s.base, token: s.token, name: s.name });
  if (r.ok) { app.lan = l; app.emit(); } else { if (r.code === 'unauthorized') writeSaved(null); app.toast(r.message, 'error'); }
}

export function openLan(app: App): void { app.set({ modal: { kind: 'lan' } }); }

let form = { code: '', name: '', seat: 'A' as Seat, server: '' };
/** Shown on the join form while a sleeping free host wakes (the session is not attached to the app yet at that point). */
let joinNote: string | null = null;
let joinError: string | null = null;
let joining = false;

export function lanModal(app: App) {
  const l = app.lan;
  const err = h('div', { class: 'small', id: 'lan-error', style: 'color:#b3261e' }, joinError ?? '');
  const peerLine = (p: PeerView) => `Player 1: ${p.A ? `${p.A.name} (${p.A.connected ? 'connected' : 'offline'})` : 'empty'} · Player 2: ${p.B ? `${p.B.name} (${p.B.connected ? 'connected' : 'offline'})` : 'empty'}${p.spectators ? ` · ${p.spectators} watching` : ''}`;
  if (l && l.status !== 'closed') {
    return shell(app, 'Network match', [
      h('p', { id: 'lan-status' }, `Connected as ${l.seat === 'S' ? 'a spectator' : `Player ${l.seat === 'A' ? '1 (host)' : '2'}`} — ${l.status}.`),
      h('p', { class: 'small', id: 'lan-mode' }, l.connectionLabel),
      !l.credentialsSaved ? h('p', { class: 'small' }, 'Browser storage is unavailable. Keep this tab open: reconnect credentials are held in memory only and will be lost on reload.') : null,
      l.note ? h('p', { class: 'small', id: 'lan-note', style: 'color:#8a5a00' }, l.note) : null,
      h('p', { class: 'small', id: 'lan-peers' }, peerLine(l.peers)),
      !l.started && l.seat === 'A' ? h('div', null, h('p', { class: 'small' }, 'Set up the match as usual (Exhibition or Tournament, both players Human), then press Start match: it is sent to the server, which runs the dice for both coaches.'),
        h('button', { class: 'btn primary', id: 'lan-setup', onclick: () => { l.hosting = true; const cfg = modeCfg('exhibition'); cfg.p1.controller = 'human'; cfg.p2.controller = 'human'; app.set({ modal: null }); openSetup(app, 'exhibition'); } }, 'Set up the match…')) : null,
      !l.started && l.seat !== 'A' ? h('p', { class: 'small' }, 'Waiting for Player 1 to start the match…') : null,
      l.started && l.over ? h('a', { class: 'btn', id: 'lan-history', href: l.historyUrl(), download: 'bloodboard-lan-match.history.json' }, 'Download verified history') : null,
      l.started && l.over && l.reopenAt !== null ? h('p', { class: 'small', id: 'lan-auto-close' }, 'This finished match is archived automatically after one minute. Both seats are released; the room code stays the same. Download the history before leaving.') : null,
      l.started && !l.over ? h('p', { class: 'small muted', id: 'lan-history-note' }, 'The server retains the match journal. Verified export is available at full time; the dice seed remains private while playing.') : null,
      l.seat === 'A' ? h('button', { class: 'btn', id: 'lan-new-match', disabled: l.busy, onclick: () => {
        const live = l.started && !l.over;
        if (!confirm(live ? 'Abandon this unfinished match? Its journal will be archived, both old seats released, and the same room code retained.' : 'Archive this room and release both seats? The room code stays the same.')) return;
        void l.newMatch(live);
      } }, l.started && !l.over ? 'Abandon and restart…' : 'Archive and reopen room…') : null,
      h('div', { class: 'btnrow' },
        h('button', { class: 'btn ghost', id: 'lan-disconnect', disabled: l.busy, onclick: () => { l.close(false); app.set({ screen: 'home', modal: null }); } }, 'Disconnect temporarily'),
        h('button', { class: 'btn ghost', id: 'lan-release', disabled: l.busy || (l.started && !l.over && l.seat !== 'S'), onclick: () => {
          if (confirm('Release your seat? Saved reconnect credentials are removed only after server confirmation.')) void l.releaseSeat();
        } }, 'Release my seat…')),
      h('p', { class: 'small muted' }, 'Disconnect preserves your seat and reconnect credentials in this browser. During a match, only the host can abandon and reopen the room; no confirmed action is undone.'),

    ]);
  }
  const saved = readSaved() ?? (l && l.token && l.status === 'closed' ? { seat: l.seat } : null);
  const resume = saved ? h('button', { class: 'btn primary', id: 'lan-resume', onclick: () => void restoreLan(app) }, `Reconnect as Player ${saved.seat === 'A' ? '1' : saved.seat === 'B' ? '2' : 'Spectator'}`) : null;
  const sameOrigin = location.protocol.startsWith('http');
  const inCode = h('input', { id: 'lan-code', value: form.code, placeholder: 'ROOM CODE', autocomplete: 'off', maxlength: '24', 'aria-label': 'Room code' }) as HTMLInputElement;
  const inName = h('input', { id: 'lan-name', value: form.name, placeholder: 'Your name', maxlength: '40', 'aria-label': 'Your name' }) as HTMLInputElement;
  const inServer = h('input', { id: 'lan-server', value: form.server, placeholder: sameOrigin ? 'blank = this server' : 'http://192.168.1.20:8787', 'aria-label': 'Server address' }) as HTMLInputElement;
  const inSeat = h('select', { id: 'lan-seat', 'aria-label': 'Seat' }, [['A', 'Player 1 (host)'], ['B', 'Player 2'], ['S', 'Spectator']].map(([v, t]) => h('option', { value: v, selected: v === form.seat }, t))) as HTMLSelectElement;
  const go = async () => {
    form = { code: inCode.value, name: inName.value, seat: inSeat.value as Seat, server: inServer.value };
    if (joining) return;
    joinError = null; err.textContent = '';
    const base = form.server.trim() || (sameOrigin ? '' : '');
    if (!sameOrigin && !base) { err.textContent = 'Enter the server address shown by the host (for example http://192.168.1.20:8787).'; return; }
    const s = new LanSession(app); joining = true; app.emit();
    try {
      const r = await s.join({ base, code: form.code.trim(), seat: form.seat, name: form.name.trim() || 'Coach' });
      if (!r.ok) { joinError = r.message; return; }
      app.lan = s;
    } catch { joinError = 'Connection was not confirmed. Retry; existing saved credentials are retained.'; }
    finally { joining = false; app.emit(); }
  };
  return shell(app, 'Broadboard Online — join a room', [
    resume,
    h('p', { class: 'small muted' }, 'On a hosted website, leave Server blank. Both players open this same address and enter the private room code. Player 1 sets up the match; Player 2 joins. Local preview serves one independent test room.'),
    h('div', { class: 'formgrid' }, h('label', null, 'Server ', inServer), h('label', null, 'Room code ', inCode), h('label', null, 'Name ', inName), h('label', null, 'Seat ', inSeat)),
    err,
    joinNote ? h('div', { class: 'small', id: 'lan-wake', style: 'color:#8a5a00' }, joinNote) : null,
    h('div', { class: 'btnrow' }, h('button', { class: 'btn primary', id: 'lan-connect', disabled: joining, onclick: () => void go() }, 'Connect'), h('button', { class: 'btn', onclick: () => app.set({ modal: null }) }, 'Cancel')),
  ]);
}

export type { LogEntry };
