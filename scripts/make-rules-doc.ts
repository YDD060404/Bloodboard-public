/**
 * Fills the skills table in docs/RULES_COVERAGE.md (between the
 * <!-- skills:start --> and <!-- skills:end --> markers) from the engine's
 * skill catalogue, so the documented support level always matches the code.
 */
import { SKILLS } from '../src/engine/index';

declare const process: { argv: string[] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function require(m: string): any;
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2] ?? '.';
const file = path.join(root, 'docs', 'RULES_COVERAGE.md');
const text: string = fs.readFileSync(file, 'utf8');

const LABEL: Record<string, string> = { implemented: '✅ implemented', partial: '◐ partly', noEffect: 'no effect here', unsupported: '⛔ not implemented' };
const count = (k: string) => SKILLS.filter((s) => s.support === k).length;
const esc = (s: string) => s.replace(/\|/g, '\\|');

let table = `${SKILLS.length} Skills and Traits: ${count('implemented')} implemented, ${count('partial')} partly, ${count('noEffect')} with no effect on anything the app can do, ${count('unsupported')} not implemented.\n\n`;
table += '| Skill / Trait | Page | Type | Status | What it does in the app |\n|---|---|---|---|---|\n';
for (const s of [...SKILLS].sort((a, b) => a.name.localeCompare(b.name))) {
  const what = s.note ? `${s.summary} **${s.note}**` : s.summary;
  table += `| ${esc(s.name)}${s.mandatory ? '*' : ''} | ${s.page} | ${s.category} | ${LABEL[s.support]} | ${esc(what)} |\n`;
}
table += '\n\\* = must always be used when it applies (compulsory in the rulebook).\n';

const start = '<!-- skills:start -->';
const end = '<!-- skills:end -->';
const i = text.indexOf(start);
const j = text.indexOf(end);
if (i < 0 || j < 0) throw new Error('markers not found in docs/RULES_COVERAGE.md');
fs.writeFileSync(file, text.slice(0, i + start.length) + '\n' + table + text.slice(j));
console.log(`docs/RULES_COVERAGE.md: ${SKILLS.length} skills listed`);
