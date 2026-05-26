import { test } from 'node:test';
import assert from 'node:assert';
import { RULES } from '../../lib/contract/rules.js';

test('RULES is a Map keyed by rule id', () => {
  assert.ok(RULES instanceof Map);
});

test('each rule has id, severity, layer, run fn', () => {
  for (const [id, rule] of RULES) {
    assert.match(id, /^R\d{2}$/, `bad id format: ${id}`);
    assert.ok(['error', 'warn'].includes(rule.severity), `bad severity for ${id}`);
    assert.ok(Array.isArray(rule.layers), `layers must be array for ${id}`);
    for (const l of rule.layers) {
      assert.ok(['lint', 'ci', 'runtime'].includes(l), `bad layer ${l} for ${id}`);
    }
    assert.strictEqual(typeof rule.run, 'function', `run must be function for ${id}`);
  }
});
