// Generates docs/ACCEPTANCE_MATRIX.md from PROGRESS.json (single source of truth). Run: node scripts/acceptance-matrix.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const d = JSON.parse(readFileSync('PROGRESS.json', 'utf8'));
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
let out = `# Requirement acceptance matrix\n\nGenerated from PROGRESS.json (${d.updated}). Release scheme: ${d.release?.scheme}\n\nCurrent: **${d.release?.current}**. ${d.release?.note}\n\n| ID | Title | Acceptance | Location | Stage | Status | Evidence | Remaining / blocker |\n|---|---|---|---|---|---|---|---|\n`;
for (const r of d.requirements) out += `| ${r.id} | ${esc(r.title)} | ${esc(r.acceptance ?? '')} | ${esc(r.location ?? '')} | ${esc(r.stage ?? r.phase)} | ${esc(r.status)} | ${esc((r.evidence ?? []).join('; '))} | ${esc(r.remaining ?? (r.blockedBy ?? []).join('; ') ?? r.notes)} |\n`;
out += `\n## League lifecycle checks (FAQ pack items)\n\n`;
for (const [k, v] of Object.entries(d.lifecycle ?? {})) out += `- **${k}** — ${v}\n`;
out += `\nStatus words: *deferred-by-user* = the user paused this requirement; kept for resumption, not completed, not cancelled, not a release blocker; *done-stand-in* = verified with a local stand-in provider only; *partial* = some acceptance items remain; *blocked-user-device* / *blocked* = needs a user-side action or material (see Remaining).\n`;
writeFileSync('docs/ACCEPTANCE_MATRIX.md', out);
console.log('wrote docs/ACCEPTANCE_MATRIX.md', d.requirements.length, 'rows');
