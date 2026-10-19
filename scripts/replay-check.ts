import { readFileSync, readdirSync } from 'node:fs';
import { parseSaveFile, assessReplay } from '../src/engine/index';
declare const process: any;
for (const f of process.argv.slice(2)) {
  const p = parseSaveFile(readFileSync(f, 'utf8'));
  if (!p.ok) { console.log(f.split('/').pop(), 'PARSE', p.errors.slice(0, 2)); continue; }
  const t0 = Date.now(); const a = assessReplay(p.save.state);
  console.log(f.split('/').pop(), '=>', a.assessment.grade, `entries=${a.assessment.entries}`, a.assessment.firstMismatch ?? '', a.assessment.reason.slice(0, 150), `${Date.now() - t0}ms`);
}
