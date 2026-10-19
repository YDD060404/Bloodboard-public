// Generates an installed coach module for one provider/model and (optionally) installs byte-identical copies into AI folders.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { BRIDGE_VERSION, DEFAULT_PORT, loadOrCreateCapability } from './bridge.mjs';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'model';
export const PROVIDER_LABELS = { deepseek: 'DeepSeek', luna: 'ChatGPT Luna' };
const ROUTES = { deepseek: 'api-key', luna: 'official-chatgpt-plan-oauth' };

export async function coachSource({ provider, model, capability, port = DEFAULT_PORT, budgetMs = 55000 }) {
  if (!PROVIDER_LABELS[provider]) throw new Error('provider must be deepseek or luna');
  if (typeof model !== 'string' || !model.trim()) throw new Error('model is required (choose one from the provider\'s discovered models)');
  if (!/^[a-f0-9]{64}$/.test(capability)) throw new Error('invalid pairing capability');
  const here = new URL('./', import.meta.url);
  const core = await readFile(new URL('coach-core.js', here), 'utf8');
  const proto = await readFile(new URL('protocol.mjs', here), 'utf8');
  const m = /\/\/ <<checkCommand\n([\s\S]*?)\/\/ checkCommand>>/.exec(proto);
  if (!m) throw new Error('protocol.mjs markers missing');
  const check = m[1].replace(/^export /gm, '');
  const config = {
    id: `online-${provider}-${slug(model)}`, label: `${PROVIDER_LABELS[provider]} ${model} (online)`, provider, model, route: ROUTES[provider],
    version: BRIDGE_VERSION, endpoint: `http://127.0.0.1:${port}`, capability, budgetMs,
  };
  return { config, text: core.replace('__BRIDGE_CONFIG__', JSON.stringify(config)).replace('__CHECK_COMMAND__', check) };
}

/** Build the coach and write the SAME bytes to every target folder. Returns names, paths and SHA-256 for the report. */
export async function buildCoach({ provider, model, stateDir, port = DEFAULT_PORT, targets = [], budgetMs }) {
  const capability = await loadOrCreateCapability(join(stateDir, 'private'));
  const { config, text } = await coachSource({ provider, model, capability, port, budgetMs });
  const sha256 = createHash('sha256').update(text).digest('hex');
  const fileName = `Online-${PROVIDER_LABELS[provider].replace(/ /g, '-')}-${slug(model)}-${BRIDGE_VERSION}.js`;
  const dirs = targets.length ? targets : [join(stateDir, 'coaches')];
  const written = [];
  for (const d of dirs) { await mkdir(d, { recursive: true }); const p = join(d, fileName); await writeFile(p, text); written.push(p); }
  return { fileName, coachId: config.id, provider, model, bytes: Buffer.byteLength(text), sha256, written, note: 'Contains the local pairing capability only (no provider key or token). Do not share; regenerate to rotate.' };
}
