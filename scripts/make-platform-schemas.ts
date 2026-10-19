/** Writes docs/schemas/platform/*.json (JSON Schemas + capabilities) from src/platform/schemas.ts. Run after `npm run build`-style bundling. */
import { writeFileSync, mkdirSync } from 'node:fs';
import * as Engine from '../src/engine/index';
import { bindEngine } from '../src/ai/index';
import { capabilities, schemas } from '../src/platform/schemas';
bindEngine(Engine);
const dir = 'docs/schemas/platform';
mkdirSync(dir, { recursive: true });
const all = schemas() as Record<string, unknown>;
for (const [k, v] of Object.entries(all)) writeFileSync(`${dir}/${k}.schema.json`, JSON.stringify({ $schema: 'https://json-schema.org/draft/2020-12/schema', title: k, ...(v as object) }, null, 2) + '\n');
writeFileSync(`${dir}/capabilities.json`, JSON.stringify(capabilities(), null, 2) + '\n');
console.log(`wrote ${Object.keys(all).length} schemas + capabilities.json to ${dir}`);
