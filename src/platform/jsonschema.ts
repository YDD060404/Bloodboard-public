/** A small JSON-Schema validator (the subset the Bloodboard API schemas use): type, enum, const, required, properties, additionalProperties, items, anyOf, nullable via anyOf. */
export type Schema = Record<string, unknown>;

export function validate(schema: Schema, value: unknown, path = '$'): string[] {
  const errs: string[] = [];
  const s = schema as { type?: string; enum?: unknown[]; const?: unknown; required?: string[]; properties?: Record<string, Schema>; additionalProperties?: boolean | Schema; items?: Schema; anyOf?: Schema[] };
  if (s.anyOf) {
    const all = s.anyOf.map((x) => validate(x, value, path));
    return all.some((e) => e.length === 0) ? [] : [`${path}: matches none of ${s.anyOf.length} alternatives (${all.map((e) => e[0]).join(' | ')})`];
  }
  if (s.const !== undefined && value !== s.const) return [`${path}: expected ${JSON.stringify(s.const)}`];
  if (s.enum && !s.enum.includes(value)) return [`${path}: ${JSON.stringify(value)} not in ${JSON.stringify(s.enum)}`];
  const t = s.type;
  if (t) {
    const ok = t === 'integer' ? Number.isInteger(value) : t === 'number' ? typeof value === 'number' && Number.isFinite(value) : t === 'array' ? Array.isArray(value) : t === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value) : t === 'null' ? value === null : typeof value === t;
    if (!ok) return [`${path}: expected ${t}, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`];
  }
  if (t === 'object' || (!t && s.properties)) {
    const o = (value ?? {}) as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in o) || o[k] === undefined) errs.push(`${path}.${k}: missing`);
    for (const [k, sub] of Object.entries(s.properties ?? {})) if (k in o && o[k] !== undefined) errs.push(...validate(sub, o[k], `${path}.${k}`));
    if (s.additionalProperties === false) for (const k of Object.keys(o)) if (!(k in (s.properties ?? {}))) errs.push(`${path}.${k}: not allowed`);
  }
  if (t === 'array' && s.items) (value as unknown[]).forEach((v, i) => errs.push(...validate(s.items as Schema, v, `${path}[${i}]`)));
  return errs;
}
