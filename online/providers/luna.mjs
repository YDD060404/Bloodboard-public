// ChatGPT "Luna" provider: the official ChatGPT-subscription authorization route (OAuth with token sharing) through the supplied
// siwc-local runtime. No API key, no paid-API fallback, no scraping, no cookies, no private Codex credentials.
// Models are whatever the signed-in account actually lists; none is assumed.
import { ProviderError, asProviderError } from './errors.mjs';

export const LUNA_APP_NAME = 'Bloodboard ChatGPT Plan Probe';   // kept identical to the earlier probe so an existing sign-in stays valid
export const LUNA_APP_ID = 'bloodboard-chatgpt-plan-probe';

const mapSession = (s) => ({
  state: s.status, sharing: !!s.sharing, profile: s.profileLabel ?? null,
  identityLabel: s.identity?.name ?? s.identity?.email ?? null, // shown only to the paired local UI
  error: s.error ? { code: s.error.code, message: s.error.message, retryable: !!s.error.retryable } : null,
});

export function createLunaProvider({ loadRuntime, encryption, storageDir, openBrowser, createChatGPT } = {}) {
  let client = null, runtimeError = null, signIn = { state: 'idle' }, modelCache = null;

  async function ensure() {
    if (client) return client;
    if (runtimeError) throw runtimeError;
    try {
      const make = createChatGPT ?? (await loadRuntime()).createChatGPT;
      if (!(await encryption.isAvailable())) throw new ProviderError('credential_protection_unavailable', 'Secure credential storage (macOS Keychain helper) is not available, so ChatGPT credentials cannot be stored.');
      client = make({
        appName: LUNA_APP_NAME, appId: LUNA_APP_ID, sendHostId: true, redirectPort: 0, storageDir, credentialEncryption: encryption,
        openBrowser: async (url) => { signIn = { ...signIn, authUrl: url }; if (openBrowser) await openBrowser(url); },
      });
      return client;
    } catch (e) {
      runtimeError = e instanceof ProviderError ? e : new ProviderError('runtime_unavailable', 'The ChatGPT sign-in runtime could not be loaded. Run "npm install" in the online folder.');
      throw runtimeError;
    }
  }

  return {
    id: 'luna', name: 'ChatGPT Luna', route: 'official-chatgpt-plan-oauth', concurrency: 2,
    async status() {
      const base = { id: 'luna', name: 'ChatGPT Luna', route: 'official-chatgpt-plan-oauth', apiKeyUsed: false, paidApiFallback: false, signIn: { state: signIn.state, authUrl: signIn.state === 'pending' ? signIn.authUrl ?? null : null, error: signIn.error ?? null } };
      try {
        const c = await ensure();
        const session = mapSession(await c.getSession());
        return { ...base, configured: session.state !== 'disconnected', connected: session.state === 'connected' && session.sharing, session };
      } catch (e) {
        const t = asProviderError(e);
        return { ...base, configured: false, connected: false, unavailable: t.toJSON() };
      }
    },
    /** Start (or restart) the browser authorization without blocking the caller. */
    async startSignIn(options = {}) {
      const c = await ensure();
      if (signIn.state === 'pending') return { state: 'pending', authUrl: signIn.authUrl ?? null };
      signIn = { state: 'pending', startedAt: Date.now() };
      c.signIn(options).then(() => { signIn = { state: 'done' }; modelCache = null; }, (e) => { const t = asProviderError(e); signIn = { state: t.code === 'cancelled' ? 'idle' : 'failed', error: t.toJSON() }; });
      // give the runtime a moment to produce the authorization URL
      for (let i = 0; i < 40 && !signIn.authUrl && signIn.state === 'pending'; i++) await new Promise((r) => setTimeout(r, 50));
      return { state: signIn.state, authUrl: signIn.authUrl ?? null };
    },
    async cancelSignIn() { if (client) client.cancelSignIn(); signIn = { state: 'idle' }; },
    async signOut() { const c = await ensure(); await c.disconnect(); modelCache = null; signIn = { state: 'idle' }; },
    async listModels({ signal } = {}) {
      const c = await ensure();
      if (modelCache && Date.now() - modelCache.at < 300000) return modelCache.models;
      let list;
      try { list = await c.listModels({ signal }); } catch (e) { throw mapRuntimeError(e); }
      const models = list.map((m) => ({ id: m.slug, name: m.displayName }));
      modelCache = { at: Date.now(), models };
      return models;
    },
    async check({ signal } = {}) {
      const started = Date.now();
      try { const m = await this.listModels({ signal }); return { ok: true, at: new Date().toISOString(), ms: Date.now() - started, models: m.length }; }
      catch (e) { return { ok: false, at: new Date().toISOString(), error: asProviderError(e).toJSON() }; }
    },
    async complete({ model, system, messages, signal }) {
      const c = await ensure();
      const models = await this.listModels({ signal });
      if (!models.some((m) => m.id === model)) throw new ProviderError('model_not_available_on_account', 'That model is not available on the signed-in ChatGPT account.');
      const started = performance.now();
      let r;
      try { r = await c.streamResponse({ model, instructions: system, input: messages, signal }); } catch (e) { throw mapRuntimeError(e); }
      return { text: r.text, meta: { elapsedMs: Math.round(performance.now() - started), model } };
    },
  };
}

function mapRuntimeError(e) {
  if (e instanceof ProviderError) return e;
  const code = typeof e?.code === 'string' ? e.code : '';
  if (code === 'cancelled' || e?.name === 'AbortError') return new ProviderError('cancelled', 'The request was cancelled.');
  if (['sign_in_required', 'sharing_not_enabled', 'reauth_required'].includes(code)) return new ProviderError(code, typeof e.message === 'string' ? e.message.slice(0, 300) : 'ChatGPT authorization is required.');
  return new ProviderError(/^[a-z_0-9]{2,60}$/.test(code) ? code : 'subscription_request_failed', 'The ChatGPT subscription request failed.', { retryable: !!e?.retryable });
}
