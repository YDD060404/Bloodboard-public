/**
 * V7: the "Online coaches" panel — DeepSeek (API key) and ChatGPT Luna (subscription sign-in).
 *
 * The panel never holds a provider credential. It talks to the local bridge (online/bridge.mjs, loopback only) with a pairing
 * capability obtained by entering the one-time code the bridge prints. A DeepSeek key typed here is sent once to the bridge,
 * which stores it in the macOS Keychain; the field is cleared immediately and the key is never kept in page storage.
 * Choosing a coach for a match stays where it always was (the AI list); installing here just puts the generated coach
 * file into the AI folders so it appears in that list for the game AND for Match Lab.
 */
import type { App } from './app';
import { h } from './dom';
import { aiStoreKind, loadAIFolder, saveAIFileText } from './aiload';
import { shell } from './modals';

const STORE_KEY = 'bloodboard.onlineBridge.v1';
const DEFAULT_ENDPOINT = 'http://127.0.0.1:60557';

interface Pairing { endpoint: string; capability: string }
interface ProviderStatus {
  id: string; name: string; route: string; configured?: boolean; connected?: boolean | 'unknown'; keyStorage?: string; lastCheck?: { ok: boolean; error?: { message: string } } | null;
  session?: { state: string; sharing: boolean; profile: string | null; identityLabel: string | null; error: { message: string } | null };
  signIn?: { state: string; authUrl: string | null; error: { message: string } | null };
  unavailable?: { code: string; message: string };
}
interface InstalledCoach { dir: string; name: string; sha256: string }

const oc = {
  pairing: null as Pairing | null,
  endpoint: DEFAULT_ENDPOINT,
  code: '',
  reachable: null as null | boolean,
  error: '' as string,
  busy: '' as string,
  providers: [] as ProviderStatus[],
  models: {} as Record<string, Array<{ id: string; name: string }>>,
  model: {} as Record<string, string>,
  keyDraft: '',
  installed: [] as InstalledCoach[],
  notice: '' as string,
  timer: 0 as number,
};

function loadPairing(): void {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { const p = JSON.parse(raw) as Pairing; if (p?.capability && p?.endpoint) { oc.pairing = p; oc.endpoint = p.endpoint; } }
  } catch { /* storage unavailable: pairing is then per session */ }
}
function savePairing(p: Pairing | null): void {
  oc.pairing = p;
  try { if (p) localStorage.setItem(STORE_KEY, JSON.stringify(p)); else localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
}

async function call<T = Record<string, unknown>>(path: string, method = 'GET', body?: unknown, timeoutMs = 30000): Promise<T> {
  const p = oc.pairing;
  const res = await fetch((p?.endpoint ?? oc.endpoint) + path, {
    method,
    headers: { ...(p ? { Authorization: `Bearer ${p.capability}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const e = data.error as { message?: string; code?: string } | string | undefined;
    const err = new Error(typeof e === 'string' ? e : e?.message ?? `The bridge answered ${res.status}.`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

const say = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function refresh(app: App, full = false): Promise<void> {
  try {
    if (!oc.pairing) {
      const ping = await call<{ bloodboardBridge?: boolean }>('/ping', 'GET', undefined, 4000);
      oc.reachable = !!ping.bloodboardBridge;
      return;
    }
    const st = await call<{ providers: ProviderStatus[] }>('/status', 'GET', undefined, 8000);
    oc.reachable = true; oc.error = '';
    oc.providers = st.providers;
    // Models are (re)listed on a full refresh, and whenever a provider has just become ready (for example after the ChatGPT sign-in finished).
    {
      for (const p of st.providers) {
        const ready = p.id === 'deepseek' ? p.configured : p.connected;
        if (!ready) { oc.models[p.id] = []; continue; }
        if (full || !(oc.models[p.id] ?? []).length) {
          try { oc.models[p.id] = (await call<{ models: Array<{ id: string; name: string }> }>(`/providers/${p.id}/models`)).models; if (!oc.model[p.id] && oc.models[p.id][0]) oc.model[p.id] = oc.models[p.id][0].id; }
          catch (e) { oc.models[p.id] = []; oc.notice = `${p.name}: ${say(e)}`; }
        }
      }
      if (full) oc.installed = (await call<{ coaches: InstalledCoach[] }>('/coaches').catch(() => ({ coaches: [] }))).coaches;
    }
  } catch (e) {
    oc.reachable = false;
    if ((e as { status?: number }).status === 403 && oc.pairing) { savePairing(null); oc.error = 'The bridge no longer accepts this pairing. Enter the new code.'; }
  }
}

/**
 * The native Mac app (when built with the bridge launcher) starts the bridge itself and injects {port, pairingCode} into this page.
 * Pair once with it automatically; the one-time code is dropped from the page object right after use. Absent in a browser or a
 * standard build, where the user starts the bridge and types the code instead.
 */
interface NativeBridgeInfo { port: number; pairingCode?: string; version?: string }
export async function adoptNativeBridge(): Promise<string | null> {
  const info = (window as unknown as { __bloodboardBridge?: NativeBridgeInfo }).__bloodboardBridge;
  if (!info || !Number.isInteger(info.port) || info.port < 1 || info.port > 65535) return null;
  const endpoint = `http://127.0.0.1:${info.port}`;
  oc.endpoint = endpoint;
  if (oc.pairing && oc.pairing.endpoint === endpoint) { try { await call('/status', 'GET', undefined, 4000); return null; } catch { /* stale capability: pair again below */ } }
  if (!info.pairingCode) return null;
  try {
    const r = await call<{ capability: string }>('/pair', 'POST', { code: info.pairingCode }, 8000);
    savePairing({ endpoint, capability: r.capability });
    delete info.pairingCode;
    return 'Paired automatically with the bridge started by this app.';
  } catch (e) { return `Automatic pairing with the app's bridge failed: ${say(e)}`; }
}

export function openOnlineCoaches(app: App): void {
  loadPairing();
  oc.notice = ''; oc.error = '';
  app.set({ modal: { kind: 'onlineCoaches' } });
  void adoptNativeBridge().then((n) => { if (n) oc.notice = n; return refresh(app, true); }).then(() => app.emit());
  window.clearInterval(oc.timer);
  oc.timer = window.setInterval(() => {
    if (app.st.modal?.kind !== 'onlineCoaches') { window.clearInterval(oc.timer); return; }
    if (document.activeElement instanceof HTMLInputElement) return; // never re-render under the user's typing
    void refresh(app).then(() => app.emit());
  }, 4000);
}

const act = (app: App, label: string, f: () => Promise<void>) => async () => {
  oc.busy = label; oc.error = ''; app.emit();
  try { await f(); } catch (e) { oc.error = say(e); }
  oc.busy = ''; await refresh(app, true); app.emit();
};

function providerCard(app: App, p: ProviderStatus): HTMLElement {
  const models = oc.models[p.id] ?? [];
  const ready = p.id === 'deepseek' ? !!p.configured : !!p.connected;
  const status = p.unavailable ? `Unavailable: ${p.unavailable.message}`
    : p.id === 'deepseek'
      ? (p.configured ? `Key stored (${p.keyStorage === 'keychain' ? 'macOS Keychain' : p.keyStorage === 'environment' ? 'environment variable' : 'this session only — not saved'}). ${p.lastCheck ? (p.lastCheck.ok ? 'Last connection check: OK.' : `Last check failed: ${p.lastCheck.error?.message ?? 'error'}`) : 'Not checked yet.'}` : 'No API key yet.')
      : p.session ? (p.session.state === 'connected' && p.session.sharing ? `Signed in${p.session.identityLabel ? ` as ${p.session.identityLabel}` : ''}. Subscription route; no API key.` : p.session.state === 'connected' ? 'Signed in, but token sharing is off in the ChatGPT account settings.' : p.session.state === 'reauth_required' ? 'Sign-in expired. Sign in again.' : 'Not signed in.') : 'Not signed in.';
  const keyBox = p.id === 'deepseek'
    ? h('div', { class: 'row-between', style: 'gap:6px;margin:6px 0' },
      h('input', { type: 'password', id: 'oc-deepseek-key', autocomplete: 'off', spellcheck: 'false', placeholder: 'DeepSeek API key', style: 'flex:1', value: oc.keyDraft, oninput: (e: Event) => { oc.keyDraft = (e.target as HTMLInputElement).value; } }),
      h('button', { class: 'btn small primary', id: 'oc-deepseek-save', disabled: !!oc.busy, onclick: act(app, 'Saving key…', async () => { const k = oc.keyDraft; oc.keyDraft = ''; await call('/providers/deepseek/key', 'POST', { key: k }); oc.notice = 'Key saved. It is held by the bridge, not by this page.'; }) }, 'Save key'),
      p.configured ? h('button', { class: 'btn small ghost', id: 'oc-deepseek-remove', onclick: act(app, 'Removing key…', async () => { await call('/providers/deepseek/key', 'DELETE'); oc.models.deepseek = []; }) }, 'Remove key') : null)
    : h('div', { class: 'btnrow', style: 'margin:6px 0' },
      p.session?.state === 'connected' && p.session.sharing
        ? h('button', { class: 'btn small ghost', id: 'oc-luna-signout', onclick: act(app, 'Signing out…', async () => { await call('/providers/luna/signout', 'POST', {}); oc.models.luna = []; }) }, 'Sign out')
        : p.signIn?.state === 'pending'
          ? h('button', { class: 'btn small ghost', id: 'oc-luna-cancel', onclick: act(app, 'Cancelling…', async () => { await call('/providers/luna/cancel-signin', 'POST', {}); }) }, 'Cancel sign-in')
          : h('button', { class: 'btn small primary', id: 'oc-luna-signin', disabled: !!p.unavailable, onclick: act(app, 'Starting sign-in…', async () => { const r = await call<{ authUrl: string | null }>('/providers/luna/signin', 'POST', {}); if (r.authUrl) oc.notice = 'Finish the sign-in in the browser window that opened (or open the link below).'; }) }, 'Sign in with ChatGPT'),
      p.signIn?.state === 'pending' && p.signIn.authUrl ? h('a', { href: p.signIn.authUrl, target: '_blank', rel: 'noopener noreferrer', style: 'margin-left:8px' }, 'Open the sign-in page') : null);
  return h('div', { class: 'card', id: `oc-${p.id}`, style: 'padding:10px;margin:8px 0;border:1px solid var(--line, #ccc);border-radius:8px' },
    h('div', { class: 'row-between' }, h('strong', null, p.name), h('span', { class: 'muted small' }, p.route === 'api-key' ? 'API key' : 'ChatGPT subscription')),
    h('div', { class: 'muted small', id: `oc-${p.id}-status` }, status),
    keyBox,
    h('div', { class: 'row-between', style: 'gap:6px;margin-top:6px' },
      h('select', { id: `oc-${p.id}-model`, disabled: !ready || !models.length, onchange: (e: Event) => { oc.model[p.id] = (e.target as HTMLSelectElement).value; } },
        ...(models.length ? models.map((m) => h('option', { value: m.id, selected: oc.model[p.id] === m.id }, m.name === m.id ? m.id : `${m.name} (${m.id})`)) : [h('option', { value: '' }, ready ? 'No models listed' : 'Set up first to list models')])),
      h('button', { class: 'btn small', id: `oc-${p.id}-check`, disabled: !ready || !!oc.busy, onclick: act(app, 'Checking…', async () => { const r = await call<{ ok: boolean; error?: { message: string } }>(`/providers/${p.id}/check`, 'POST', {}); oc.notice = r.ok ? `${p.name}: connection OK.` : `${p.name}: ${r.error?.message ?? 'check failed'}`; }) }, 'Check connection'),
      h('button', { class: 'btn small primary', id: `oc-${p.id}-install`, disabled: !ready || !oc.model[p.id] || !!oc.busy, onclick: act(app, 'Installing…', async () => {
        const r = await call<{ fileName: string; written: string[]; sha256: string }>('/coaches/install', 'POST', { provider: p.id, model: oc.model[p.id] });
        if (aiStoreKind() === 'native') await loadAIFolder(app);
        else { const f = await call<{ name: string; text: string }>(`/coaches/file?name=${encodeURIComponent(r.fileName)}`); await saveAIFileText(app, f.name, f.text); }
        oc.notice = `Installed ${r.fileName} in the shared AI folder (SHA-256 ${r.sha256.slice(0, 12)}…). The game and the Match Lab both read this file.`;
      }) }, 'Install as coach')));
}

export function onlineCoachesModal(app: App): HTMLElement {
  const paired = !!oc.pairing;
  const body: Array<HTMLElement | null> = [
    h('p', { class: 'muted small' }, 'Online coaches run through a small program on this computer (the online-coach bridge). It holds your DeepSeek key or ChatGPT sign-in; this page and Match Lab never see them. Online coaches decide actions and rule choices; set-up and kick-off use the built-in coach, and any failure is shown and recorded as a fallback.'),
    oc.error ? h('div', { class: 'notice error', id: 'oc-error' }, oc.error) : null,
    oc.notice ? h('div', { class: 'notice', id: 'oc-notice' }, oc.notice) : null,
    oc.busy ? h('div', { class: 'muted small' }, oc.busy) : null,
    oc.pairing && oc.reachable === false ? h('div', { class: 'notice error', id: 'oc-unreachable' }, 'The bridge is not reachable right now (it may have stopped). Status below is the last one seen.') : null,
  ];
  if (!paired) {
    body.push(
      h('div', { class: 'card', id: 'oc-pair', style: 'padding:10px;margin:8px 0;border:1px solid var(--line, #ccc);border-radius:8px' },
        h('strong', null, oc.reachable === false ? 'The bridge is not running' : 'Pair with the bridge'),
        h('p', { class: 'muted small' }, oc.reachable === false
          ? 'Start it in Terminal:  node online/bridge.mjs serve   (see docs/ONLINE_COACHES.md). This page will notice automatically.'
          : 'Enter the 8-digit code the bridge printed when it started.'),
        h('div', { class: 'row-between', style: 'gap:6px' },
          h('input', { id: 'oc-code', inputmode: 'numeric', maxlength: 8, placeholder: '8-digit pairing code', autocomplete: 'off', value: oc.code, oninput: (e: Event) => { oc.code = (e.target as HTMLInputElement).value.trim(); } }),
          h('button', { class: 'btn small primary', id: 'oc-pair-go', disabled: !!oc.busy || oc.reachable === false, onclick: act(app, 'Pairing…', async () => {
            try { const r = await call<{ capability: string }>('/pair', 'POST', { code: oc.code }); savePairing({ endpoint: oc.endpoint, capability: r.capability }); oc.code = ''; oc.notice = 'Paired.'; }
            catch (e) { if ((e as { status?: number }).status === 403) throw new Error('That code was not accepted.'); if ((e as { status?: number }).status === 429) throw new Error('Too many wrong codes. Wait a minute.'); throw e; }
          }) }, 'Pair'))));
  } else {
    for (const p of oc.providers) body.push(providerCard(app, p));
    if (!oc.providers.length) body.push(h('p', { class: 'muted' }, oc.reachable === false ? 'The bridge is not reachable right now.' : 'Loading…'));
    if (oc.installed.length) body.push(h('div', { class: 'muted small', id: 'oc-installed' }, 'Installed online coaches: ', oc.installed.map((c) => `${c.name} (${c.sha256.slice(0, 8)})`).join(', ')));
    body.push(h('div', { class: 'btnrow' }, h('button', { class: 'btn small ghost', id: 'oc-unpair', onclick: () => { savePairing(null); oc.providers = []; app.emit(); } }, 'Forget pairing')));
  }
  body.push(h('div', { class: 'btnrow' }, h('button', { class: 'btn', id: 'oc-close', onclick: () => app.set({ modal: null }) }, 'Close')));
  return shell(app, 'Online coaches — DeepSeek and ChatGPT Luna', body, true);
}

/** Test hook (UI flows): the panel's state without credentials. */
export const onlineCoachesDebug = () => ({ paired: !!oc.pairing, reachable: oc.reachable, providers: oc.providers.map((p) => p.id), installed: oc.installed.length });
