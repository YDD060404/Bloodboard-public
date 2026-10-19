/**
 * The published JSON Schema (docs/schemas/bloodboard.schema.json, generated
 * from the TypeScript types) must accept real engine data: example positions,
 * plans, executions paused for a decision, finished executions and their logs.
 * A tiny validator for the subset of JSON Schema the generator emits is
 * included so the test needs no extra packages.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, execute, parseSaveFile, planAction, type GameState, type PlayerActionInput } from '../src/engine/index';
import { c, Pos } from './helpers';
declare function require(m: string): any;
const fs = require('node:fs');

type Schema = Record<string, any>;
const root: Schema = JSON.parse(fs.readFileSync('docs/schemas/bloodboard.schema.json', 'utf8'));

function validate(value: unknown, schema: Schema, path: string, errors: string[]): void {
  if (schema.$ref) {
    const name = String(schema.$ref).replace('#/$defs/', '');
    const def = root.$defs[name];
    if (!def) {
      errors.push(`${path}: unknown $ref ${schema.$ref}`);
      return;
    }
    validate(value, def, path, errors);
    return;
  }
  if (schema.anyOf) {
    const ok = (schema.anyOf as Schema[]).some((s) => {
      const e: string[] = [];
      validate(value, s, path, e);
      return e.length === 0;
    });
    if (!ok) errors.push(`${path}: matches none of anyOf (${JSON.stringify(value)?.slice(0, 120)})`);
    return;
  }
  if ('const' in schema && value !== schema.const) errors.push(`${path}: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  if (schema.enum && !(schema.enum as unknown[]).includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  const t = schema.type;
  if (t === 'string' && typeof value !== 'string') errors.push(`${path}: expected string`);
  if (t === 'number' && typeof value !== 'number') errors.push(`${path}: expected number`);
  if (t === 'boolean' && typeof value !== 'boolean') errors.push(`${path}: expected boolean`);
  if (t === 'null' && value !== null) errors.push(`${path}: expected null`);
  if (t === 'array') {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`);
      return;
    }
    if (schema.prefixItems) (schema.prefixItems as Schema[]).forEach((s, i) => validate(value[i], s, `${path}[${i}]`, errors));
    else if (schema.items) value.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`, errors));
  }
  if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(`${path}: expected object`);
      return;
    }
    const obj = value as Record<string, unknown>;
    for (const r of (schema.required as string[]) ?? []) if (!(r in obj)) errors.push(`${path}: missing required "${r}"`);
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) validate(v, props[k], `${path}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property "${k}"`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validate(v, schema.additionalProperties, `${path}.${k}`, errors);
    }
  }
}

function check(def: string, value: unknown) {
  const errors: string[] = [];
  validate(JSON.parse(JSON.stringify(value)), { $ref: `#/$defs/${def}` }, def, errors);
  assert.deepEqual(errors.slice(0, 8), [], `${def} does not match the schema`);
}

const EXAMPLES = fs.readdirSync('examples').filter((f: string) => /^\d\d-.*\.json$/.test(f));

test('the schema defines the interface types', () => {
  for (const k of ['GameState', 'SaveFile', 'ActionInput', 'PlanResult', 'ExecutionResult', 'DecisionRequest', 'DecisionChoice', 'GameEvent', 'LogEntry', 'StepRecord']) assert.ok(root.$defs[k], k);
});

test('every example position is a valid SaveFile', () => {
  assert.ok(EXAMPLES.length >= 5);
  for (const f of EXAMPLES) check('SaveFile', JSON.parse(fs.readFileSync(`examples/${f}`, 'utf8')));
});

test('plans, paused executions, decisions and finished executions match the schema', () => {
  const load = (f: string): GameState => {
    const r = parseSaveFile(fs.readFileSync(`examples/${f}`, 'utf8'));
    if (!r.ok) throw new Error(r.errors.join());
    return r.save.state;
  };
  const pid = (s: GameState, team: 'A' | 'B', n: number) => (s.players.find((q) => q.team === team && q.number === n) as { id: string }).id;
  const s2 = load('02-blitz-the-carrier.json');
  const blitz: PlayerActionInput = { kind: 'playerAction', playerId: pid(s2, 'A', 6), action: 'blitz', blitzTarget: pid(s2, 'B', 8), blockTarget: pid(s2, 'B', 8), path: [c(11, 7), c(10, 7), c(9, 7)].map((to) => ({ to, kind: 'step' as const })) };
  check('ActionInput', blitz);
  const plan = planAction(s2, blitz);
  assert.ok(plan.ok, plan.errors.join());
  check('PlanResult', plan);
  let res = execute(s2, blitz);
  check('ExecutionResult', res);
  let guard = 0;
  while (res.status === 'awaitingDecision' && res.decision && guard++ < 20) {
    check('DecisionRequest', res.decision);
    const choice = { requestId: res.decision.id, optionId: res.decision.options[0].id };
    check('DecisionChoice', choice);
    res = decide(res.state, choice);
    check('ExecutionResult', res);
  }
  check('GameState', res.state);
  // a pass with interceptors, and an End Turn
  const s3 = load('03-short-pass-to-the-end-zone.json');
  const pass: PlayerActionInput = { kind: 'playerAction', playerId: pid(s3, 'A', 10), action: 'pass', path: [], passTarget: c(25, 5) };
  check('PlanResult', planAction(s3, pass));
  const r3 = execute(s3, { kind: 'endTurn' });
  check('ExecutionResult', r3);
});

test('an unfinished decision stored in the state (pending) matches the schema', () => {
  const b = new Pos({ rerollsA: 1 });
  b.add('A', 'human', 'lineman', c(10, 7), { id: 'A1' });
  b.add('B', 'orc', 'lineman', c(11, 7), { id: 'B1' });
  b.ball(c(1, 1));
  const s = b.start();
  for (let seed = 1; seed < 100; seed++) {
    const t = JSON.parse(JSON.stringify(s)) as GameState;
    t.rng = { seed, counter: 0 };
    const r = execute(t, { kind: 'playerAction', playerId: 'A1', action: 'block', path: [], blockTarget: 'B1' });
    if (r.status === 'awaitingDecision') {
      assert.ok(r.state.pending);
      check('GameState', r.state);
      return;
    }
  }
  assert.ok(false, 'no decision found');
});
