// DeepSeek provider. Written from the official API documentation (https://api-docs.deepseek.com):
//   base URL https://api.deepseek.com, "Authorization: Bearer <key>", GET /models, POST /chat/completions
//   with response_format {"type":"json_object"} (the prompt must itself ask for JSON), usage.prompt_cache_hit_tokens, finish_reason.
// Model IDs are never hard-coded: the user picks one from the account's GET /models answer.
import { ProviderError, asProviderError } from './errors.mjs';

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const SECRET = 'deepseek-api-key';

function mapHttp(status, retryAfter) {
  switch (status) {
    case 400: case 422: return new ProviderError('invalid_parameters', 'DeepSeek rejected the request parameters.', { status });
    case 401: return new ProviderError('invalid_api_key', 'DeepSeek rejected the API key. Check or replace it.', { status });
    case 402: return new ProviderError('insufficient_balance', 'The DeepSeek account has no balance left.', { status });
    case 429: return new ProviderError('rate_limited', 'DeepSeek is rate limiting requests. Slow down.', { status, retryable: true });
    case 500: return new ProviderError('provider_error', 'DeepSeek reported an internal error.', { status, retryable: true });
    case 503: return new ProviderError('provider_overloaded', 'DeepSeek is overloaded.', { status, retryable: true });
    default: return new ProviderError('provider_http_error', `DeepSeek answered HTTP ${status}.`, { status, retryable: status >= 500 });
  }
}

export function createDeepSeekProvider({ secrets, fetchImpl = globalThis.fetch, baseUrl = DEEPSEEK_BASE_URL, env = process.env, defaults = {} } = {}) {
  const cfg = { temperature: 0.3, maxTokens: 2048, thinking: undefined, ...defaults };
  let lastCheck = null;

  async function apiKey() {
    const stored = secrets ? await secrets.get(SECRET) : null;
    return stored || env.BLOODBOARD_DEEPSEEK_API_KEY || null;
  }
  async function call(path, { method = 'GET', body, signal } = {}) {
    const key = await apiKey();
    if (!key) throw new ProviderError('api_key_required', 'Enter a DeepSeek API key first.');
    let res;
    try {
      res = await fetchImpl(baseUrl + path, {
        method, signal,
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      const typed = asProviderError(e);
      if (typed.code === 'provider_failed') throw new ProviderError('network_error', 'Could not reach DeepSeek.', { retryable: true });
      throw typed;
    }
    if (!res.ok) { await res.text().catch(() => ''); throw mapHttp(res.status); }
    try { return await res.json(); } catch { throw new ProviderError('invalid_response', 'DeepSeek returned an unreadable response.', { retryable: true }); }
  }

  return {
    id: 'deepseek', name: 'DeepSeek', route: 'api-key', concurrency: 4,
    async status() {
      const configured = !!(await apiKey());
      const persistent = secrets ? await secrets.persistent() : false;
      return {
        id: 'deepseek', name: 'DeepSeek', route: 'api-key', configured,
        keyStorage: !configured ? 'none' : (secrets && await secrets.get(SECRET)) ? (persistent ? 'keychain' : 'session-memory') : 'environment',
        connected: lastCheck ? lastCheck.ok : 'unknown', lastCheck, baseUrl,
      };
    },
    async setKey(key) { return secrets.set(SECRET, String(key ?? '').trim()); },
    async clearKey() { await secrets.remove(SECRET); lastCheck = null; },
    /** Account-supported models (GET /models). */
    async listModels({ signal } = {}) {
      const body = await call('/models', { signal });
      if (!body || !Array.isArray(body.data)) throw new ProviderError('invalid_model_catalog', 'DeepSeek returned an unexpected model list.', { retryable: true });
      return body.data.filter((m) => m && typeof m.id === 'string').map((m) => ({
        id: m.id, name: typeof m.name === 'string' ? m.name : m.id,
        contextWindow: Number.isFinite(m.context_window) ? m.context_window : undefined,
        maxOutputTokens: Number.isFinite(m.max_output_tokens) ? m.max_output_tokens : undefined,
        effort: m.effort ?? undefined,
      }));
    },
    /** Connection health: a cheap authenticated call. Records the outcome for status(). */
    async check({ signal } = {}) {
      const started = Date.now();
      try { const models = await this.listModels({ signal }); lastCheck = { ok: true, at: new Date().toISOString(), ms: Date.now() - started, models: models.length }; }
      catch (e) { const t = asProviderError(e); lastCheck = { ok: false, at: new Date().toISOString(), error: t.toJSON() }; }
      return lastCheck;
    },
    /** One completion. `system` is the stable instruction block (kept first so provider-side prefix caching can apply). */
    async complete({ model, system, messages, signal, options = {} }) {
      if (!model || typeof model !== 'string') throw new ProviderError('model_required', 'Choose a DeepSeek model first.');
      const started = performance.now();
      const body = {
        model, stream: false,
        messages: [{ role: 'system', content: system }, ...messages],
        response_format: { type: 'json_object' },
        temperature: options.temperature ?? cfg.temperature,
        max_tokens: options.maxTokens ?? cfg.maxTokens,
      };
      const thinking = options.thinking ?? cfg.thinking;
      if (thinking) body.thinking = thinking;
      const data = await call('/chat/completions', { method: 'POST', body, signal });
      const choice = data?.choices?.[0];
      const text = choice?.message?.content;
      const usage = data?.usage ?? {};
      const details = usage.prompt_tokens_details ?? {};
      const meta = {
        elapsedMs: Math.round(performance.now() - started), finishReason: choice?.finish_reason ?? null,
        promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens,
        cacheHitTokens: details.prompt_cache_hit_tokens ?? usage.prompt_cache_hit_tokens, cacheMissTokens: details.prompt_cache_miss_tokens ?? usage.prompt_cache_miss_tokens,
        model: data?.model ?? model,
      };
      if (choice?.finish_reason === 'length') throw Object.assign(new ProviderError('truncated_response', 'The model ran out of output tokens before finishing its answer.', { retryable: false }), { meta });
      if (choice?.finish_reason === 'content_filter') throw Object.assign(new ProviderError('content_filtered', 'The provider filtered the response.'), { meta });
      if (typeof text !== 'string') throw Object.assign(new ProviderError('invalid_response', 'DeepSeek returned no message text.', { retryable: true }), { meta });
      return { text, meta };
    },
  };
}
