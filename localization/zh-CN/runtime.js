// Display-only bilingual UI for Broadboard Online. Adapted from the existing Bloodboard Chinese patch; the rule engine is unchanged.
const STORAGE_KEY = 'broadboard.online.language';
const exact = new Map(Object.entries(CATALOG));
const patterns = new Map();
const shortPatterns = [];
const shortSources = new Set(['{0} · P1 {1} v P2 {2}', '{0} EZ']);
const translatedText = new WeakMap();
const translatedAttrs = new WeakMap();
let language = 'zh-CN';
try { language = localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'zh-CN'; } catch { /* private/file origins can deny storage */ }
const escapeRE = text => [...text].map(char => '\\^$.*+?()[]{}|'.includes(char) ? '\\' + char : char).join('');
const tokens = text => text.match(/[A-Za-z][A-Za-z-]{3,}/g) || [];
const lookupTokens = text => tokens(text).flatMap(word => {
  const lower = word.toLowerCase();
  return [lower, lower.replace(/s$/, ''), lower.replace(/es$/, ''), lower.replace(/ies$/, 'y')];
});
for (const [source, target] of exact) {
  if (!/\{\d+\}/.test(source)) continue;
  const literals = source.split(/\{\d+\}/);
  if (literals.join('').trim().length < 4 && !shortSources.has(source)) continue;
  const anchor = tokens(literals.join(' ')).sort((a, b) => b.length - a.length)[0];
  if (!anchor && !shortSources.has(source)) continue;
  const slots = [...source.matchAll(/\{(\d+)\}/g)].map(m => m[1]);
  const re = new RegExp('^' + literals.map((literal, i) => escapeRE(literal) + (i < slots.length ? (literals[i + 1] === '' && i + 1 < slots.length ? '([\\s\\S]*)' : '([\\s\\S]*?)') : '')).join('') + '$');
  if (!anchor) { shortPatterns.push({ re, slots, target, weight: literals.join('').length }); continue; }
  const key = anchor.toLowerCase();
  const list = patterns.get(key) || [];
  list.push({ re, slots, target, weight: literals.join('').length });
  patterns.set(key, list);
}
for (const list of patterns.values()) list.sort((a, b) => b.weight - a.weight);

function protectedNames() {
  const app = window.bloodboard;
  const names = new Set();
  if (!app) return names;
  for (const team of Object.values(app.game?.teams || {})) if (team.name) names.add(team.name);
  for (const player of app.game?.players || []) if (player.name) names.add(player.name);
  if (app.st?.docName) names.add(app.st.docName);
  return names;
}

function translate(text, names = new Set(), depth = 0) {
  if (typeof text !== 'string' || language === 'en' || names.has(text) || depth > 3) return text;
  const direct = exact.get(text);
  if (direct !== undefined && !/\{\d+\}/.test(text)) return direct;
  const trimmed = text.trim();
  if (trimmed !== text) {
    const next = translate(trimmed, names, depth + 1);
    if (next !== trimmed) return text.slice(0, text.indexOf(trimmed)) + next + text.slice(text.indexOf(trimmed) + trimmed.length);
  }
  const candidates = new Set(shortPatterns);
  for (const word of lookupTokens(text)) for (const pattern of patterns.get(word) || []) candidates.add(pattern);
  for (const pattern of [...candidates].sort((a, b) => b.weight - a.weight)) {
    const match = pattern.re.exec(text);
    if (!match) continue;
    const values = new Map(pattern.slots.map((slot, i) => [slot, match[i + 1]]));
    return pattern.target.replace(/\{(\d+)\}/g, (_, slot) => translate(values.get(slot) ?? '', names, depth + 1));
  }
  return text;
}

const skipped = 'script,style,textarea,pre,code,[contenteditable]:not([contenteditable="false"]),[data-bb-no-translate]';
function translateNode(node, names) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (!node.parentElement || node.parentElement.closest(skipped)) return;
    const current = node.nodeValue || '';
    const prior = translatedText.get(node);
    const original = prior && current === prior.output ? prior.original : current;
    const output = translate(original, names);
    translatedText.set(node, { original, output });
    if (output !== current) node.nodeValue = output;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || node.matches(skipped)) return;
  if (node instanceof HTMLOptionElement && !node.hasAttribute('value')) node.setAttribute('value', node.value);
  const saved = translatedAttrs.get(node) || {};
  for (const name of ['title', 'placeholder', 'aria-label']) {
    const current = node.getAttribute(name);
    if (current === null) continue;
    const prior = saved[name];
    const original = prior && current === prior.output ? prior.original : current;
    const output = translate(original, names);
    saved[name] = { original, output };
    if (output !== current) node.setAttribute(name, output);
  }
  translatedAttrs.set(node, saved);
  for (const child of node.childNodes) translateNode(child, names);
}

function ensureToggle() {
  const bar = document.querySelector('.topbar');
  if (!bar) return;
  let button = document.getElementById('broadboard-language-toggle');
  if (!button) {
    button = document.createElement('button');
    button.id = 'broadboard-language-toggle';
    button.className = 'btn small ghost';
    button.dataset.bbNoTranslate = 'true';
    button.title = '切换界面语言 / Switch interface language';
    button.addEventListener('click', () => setLanguage(language === 'zh-CN' ? 'en' : 'zh-CN'));
    bar.appendChild(button);
  }
  const text = language === 'zh-CN' ? 'English' : '中文';
  if (button.textContent !== text) button.textContent = text;
  if (button.getAttribute('aria-label') !== text) button.setAttribute('aria-label', text);
}

function setLanguage(next) {
  language = next === 'en' ? 'en' : 'zh-CN';
  try { localStorage.setItem(STORAGE_KEY, language); } catch { /* storage is optional */ }
  document.documentElement.lang = language;
  try { window.webkit?.messageHandlers?.bloodboardLanguage?.postMessage(language); } catch { /* optional native display bridge */ }
  translateNode(document.body, protectedNames());
  ensureToggle();
}

let queued = false;
const pending = new Set();
function flush() {
  queued = false;
  const names = protectedNames();
  for (const node of pending) {
    if (!node.isConnected) continue;
    let parent = node.parentNode;
    while (parent && !pending.has(parent)) parent = parent.parentNode;
    if (!parent) translateNode(node, names);
  }
  pending.clear();
  ensureToggle();
}
const observer = new MutationObserver(records => {
  for (const record of records) {
    if (record.type === 'childList') for (const node of record.addedNodes) pending.add(node);
    else pending.add(record.target);
  }
  if (!queued) { queued = true; queueMicrotask(flush); }
});
observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title', 'placeholder', 'aria-label'] });
document.documentElement.lang = language;
try { window.webkit?.messageHandlers?.bloodboardLanguage?.postMessage(language); } catch { /* optional native display bridge */ }
translateNode(document.body, protectedNames());
for (const name of ['alert', 'confirm', 'prompt']) {
  const original = window[name].bind(window);
  window[name] = (message, ...args) => original(translate(String(message), protectedNames()), ...args);
}
window.BroadboardLanguage = Object.freeze({ version: '0.1.8', targetVersion: '0.1.8', getLanguage: () => language, setLanguage, translate: text => translate(text), entries: exact.size });
