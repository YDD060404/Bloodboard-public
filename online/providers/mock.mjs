// Scripted provider for component tests. Behaves like a real provider from the bridge's point of view.
import { ProviderError } from './errors.mjs';
export function createMockProvider({ id = 'mock', name = 'Mock', responses = [], models = [{ id: 'mock-1', name: 'Mock 1' }], delayMs = 0, concurrency = 4 } = {}) {
  const calls = [];
  let configured = true;
  return {
    id, name, route: 'mock', concurrency, calls,
    async status() { return { id, name, route: 'mock', configured, connected: configured }; },
    async listModels() { return models; },
    async check() { return { ok: configured, at: new Date().toISOString() }; },
    async complete({ model, system, messages, signal }) {
      calls.push({ model, system, messages: structuredClone(messages) });
      if (delayMs) await new Promise((res, rej) => { const t = setTimeout(res, delayMs); signal?.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true }); });
      signal?.throwIfAborted();
      const next = responses.shift();
      if (next instanceof Error || next instanceof ProviderError) throw next;
      if (next === undefined) throw new ProviderError('mock_exhausted', 'No scripted response left.');
      return { text: typeof next === 'string' ? next : JSON.stringify(next), meta: { elapsedMs: 1, model } };
    },
    unconfigure() { configured = false; },
  };
}
