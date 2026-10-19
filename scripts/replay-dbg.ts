import { readFileSync } from 'node:fs';
import { parseSaveFile, reconstructInitial, applyEntry } from '../src/engine/index';
declare const process: any;
const p: any = parseSaveFile(readFileSync(process.argv[2], 'utf8'));
const st = p.save.state; const init: any = reconstructInitial(st);
const r = applyEntry(init, st.log[0]);
console.log('ok', r.ok, r.error);
const a = r.state.log[r.state.log.length - 1], b = st.log[0];
const ea = a.events.map((e: any) => e.text + ' ' + JSON.stringify(e.dice)), eb = b.events.map((e: any) => e.text + ' ' + JSON.stringify(e.dice));
for (let i = 0; i < Math.max(ea.length, eb.length); i++) if (ea[i] !== eb[i]) { console.log('DIFF', i, '\n new:', ea[i], '\n old:', eb[i]); break; }
console.log('decisions', JSON.stringify(a.decisions.map((d: any) => d.optionId)), JSON.stringify(b.decisions.map((d: any) => d.optionId)), a.outcome, b.outcome);
console.log('keys differ:', JSON.stringify(Object.keys(a)), JSON.stringify(Object.keys(b)));
