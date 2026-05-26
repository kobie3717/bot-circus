import { test } from 'node:test';
import assert from 'node:assert';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js'; // registers R01
import { fixturePath } from './helpers.js';

const R01 = RULES.get('R01');

test('R01 passes on valid-minimal fixture', async () => {
  const result = await R01.run(fixturePath('valid-minimal'));
  assert.strictEqual(result.pass, true, JSON.stringify(result.violations));
});

test('R01 fails when config.json missing', async () => {
  const result = await R01.run(fixturePath('invalid-no-config'));
  assert.strictEqual(result.pass, false);
  assert.match(result.violations[0].message, /missing.*config\.json/i);
});

test('R01 fails when config.json malformed JSON', async () => {
  const result = await R01.run(fixturePath('invalid-malformed-config'));
  assert.strictEqual(result.pass, false);
  assert.match(result.violations[0].message, /parse|invalid json/i);
});
