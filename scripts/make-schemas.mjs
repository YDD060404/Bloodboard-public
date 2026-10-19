// Generates docs/schemas/bloodboard.schema.json (JSON Schema 2020-12) from the
// engine's TypeScript types, so the documented formats can never drift from
// the code. Needs the `typescript` package (a dev dependency);
// TYPESCRIPT_MODULE can point at another installation.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require(process.env.TYPESCRIPT_MODULE || 'typescript');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Exported types that make up the interface boundary.
const ROOTS = {
  'src/engine/types.ts': '*',
  'src/engine/serialize.ts': ['SaveFile'],
  'src/engine/planner.ts': ['PlanResult', 'OutcomeSummary', 'BlockAnalysis', 'PassAnalysis', 'PlanOptions'],
  'src/engine/context.ts': ['StepRecord', 'Mod'],
  'src/engine/actions.ts': ['ActionAvailability'],
  'src/engine/dice.ts': ['BlockFace'],
};

const files = Object.keys(ROOTS).map((f) => join(root, f));
const program = ts.createProgram(files, {
  strict: true,
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler ?? ts.ModuleResolutionKind.NodeJs,
  skipLibCheck: true,
  noEmit: true,
  types: [],
});
const checker = program.getTypeChecker();

const decls = new Map(); // name -> declaration node
for (const [rel, names] of Object.entries(ROOTS)) {
  const sf = program.getSourceFile(join(root, rel));
  if (!sf) throw new Error(`cannot read ${rel}`);
  for (const st of sf.statements) {
    if (!(ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st))) continue;
    const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    const name = st.name.text;
    if (names === '*' || names.includes(name)) decls.set(name, st);
  }
}

const docOf = (sym) => (sym ? ts.displayPartsToString(sym.getDocumentationComment(checker)).trim() : '');

function namedOf(type) {
  const alias = type.aliasSymbol?.name;
  if (alias && decls.has(alias) && !type.aliasTypeArguments?.length) return alias;
  const sym = type.symbol?.name;
  if (sym && decls.has(sym) && ts.isInterfaceDeclaration(decls.get(sym))) return sym;
  return null;
}

function toSchema(type, top = false) {
  const named = namedOf(type);
  if (named && !top) return { $ref: `#/$defs/${named}` };
  const f = type.flags;
  if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return {};
  if (f & ts.TypeFlags.String) return { type: 'string' };
  if (f & ts.TypeFlags.Number) return { type: 'number' };
  if (f & ts.TypeFlags.Boolean) return { type: 'boolean' };
  if (f & ts.TypeFlags.Null) return { type: 'null' };
  if (f & ts.TypeFlags.StringLiteral) return { const: type.value };
  if (f & ts.TypeFlags.NumberLiteral) return { const: type.value };
  if (f & ts.TypeFlags.BooleanLiteral) return { const: type.intrinsicName === 'true' };
  if (type.isUnion()) {
    const members = type.types.filter((t) => !(t.flags & ts.TypeFlags.Undefined));
    if (members.length && members.every((t) => t.flags & ts.TypeFlags.StringLiteral)) return { type: 'string', enum: members.map((t) => t.value) };
    if (members.length && members.every((t) => t.flags & ts.TypeFlags.NumberLiteral)) return { type: 'number', enum: members.map((t) => t.value) };
    const bools = members.filter((t) => t.flags & ts.TypeFlags.BooleanLiteral);
    const parts = members.filter((t) => !(t.flags & ts.TypeFlags.BooleanLiteral)).map((t) => toSchema(t));
    if (bools.length === 2) parts.push({ type: 'boolean' });
    else for (const b of bools) parts.push(toSchema(b));
    return parts.length === 1 ? parts[0] : { anyOf: parts };
  }
  if (checker.isArrayType(type)) return { type: 'array', items: toSchema(checker.getTypeArguments(type)[0]) };
  if (checker.isTupleType(type)) {
    const items = checker.getTypeArguments(type).map((t) => toSchema(t));
    return { type: 'array', prefixItems: items, minItems: items.length, maxItems: items.length };
  }
  if (f & ts.TypeFlags.Object) {
    const out = { type: 'object', properties: {}, required: [] };
    for (const p of checker.getPropertiesOfType(type)) {
      const decl = p.valueDeclaration ?? p.declarations?.[0];
      // Properties of mapped types such as Record<TeamId, TeamState> have no declaration.
      const pt = decl ? checker.getTypeOfSymbolAtLocation(p, decl) : checker.getTypeOfSymbol(p);
      if (pt.getCallSignatures().length) continue; // methods are not data
      const s = toSchema(pt);
      const doc = docOf(p);
      out.properties[p.name] = doc ? { description: doc, ...s } : s;
      if (!(p.flags & ts.SymbolFlags.Optional)) out.required.push(p.name);
    }
    const index = checker.getIndexInfosOfType ? checker.getIndexInfosOfType(type) : [];
    const strIndex = index.find((i) => i.keyType.flags & ts.TypeFlags.String);
    if (strIndex) out.additionalProperties = toSchema(strIndex.type);
    else out.additionalProperties = false;
    if (!out.required.length) delete out.required;
    if (!Object.keys(out.properties).length) delete out.properties;
    return out;
  }
  throw new Error(`unsupported type: ${checker.typeToString(type)}`);
}

const $defs = {};
for (const [name, decl] of [...decls.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const type = checker.getTypeAtLocation(decl.name);
  const s = toSchema(type, true);
  const doc = docOf(checker.getSymbolAtLocation(decl.name));
  $defs[name] = doc ? { description: doc, ...s } : s;
}

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://bloodboard.local/schemas/bloodboard.schema.json',
  title: 'Bloodboard: Endgame Workshop — engine interface formats',
  description:
    'Generated from src/engine/*.ts by scripts/make-schemas.mjs. Main entry points: GameState (the whole game), SaveFile (a saved position), ActionInput (what a coach or agent asks for), PlanResult (preview, no dice), ExecutionResult (after dice), DecisionRequest / DecisionChoice (mid-action choices).',
  $defs,
};
const outDir = join(root, 'docs', 'schemas');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'bloodboard.schema.json'), JSON.stringify(schema, null, 2) + '\n');
console.log(`docs/schemas/bloodboard.schema.json: ${Object.keys($defs).length} definitions`);
