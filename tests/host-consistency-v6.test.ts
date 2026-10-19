/** Host consistency: generation-2 modules get object rule answers; the Lab's module entry keeps generation/schema/capabilities. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveMinor } from '../src/platform/host';
import { resolveDecision } from '../src/platform/respond';

const options = [{ id: 'a' }, { id: 'b' }];

test('effectiveMinor: gen-2 declaring minor 0 behaves as minor >= 2; gen-1 keeps its own minor', () => {
  assert.equal(effectiveMinor({ apiMinor: 0, apiGeneration: 2 }), 2);
  assert.equal(effectiveMinor({ apiMinor: 0, apiGeneration: 1 }), 0);
  assert.equal(effectiveMinor({ apiMinor: 1 }), 1);
  assert.equal(effectiveMinor({}), 0);
});

test('gen-2 module object answers to rule choices are accepted; gen-1 minor 0 still rejected', () => {
  const r2 = resolveDecision(options, { optionId: 'b', why: 'x' }, effectiveMinor({ apiMinor: 0, apiGeneration: 2 }));
  assert.equal(r2.ok, true);
  const r1 = resolveDecision(options, { optionId: 'b' }, effectiveMinor({ apiMinor: 0, apiGeneration: 1 }));
  assert.equal(r1.ok, false);
  assert.equal(resolveDecision(options, 'a', 0).ok, true);
});
