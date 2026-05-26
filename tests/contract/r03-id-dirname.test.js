import { test } from 'node:test';
import assert from 'node:assert';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-basic.js';
import { fixturePath } from './helpers.js';

const R03 = RULES.get('R03');

test('R03 passes when config.id matches parent dir', async () => {
  const r = await R03.run(fixturePath('valid-minimal'));
  assert.strictEqual(r.pass, true, JSON.stringify(r.violations));
});

test('R03 fails when config.id differs from parent dir', async () => {
  const r = await R03.run(fixturePath('invalid-id-mismatch'));
  assert.strictEqual(r.pass, false);
  assert.match(r.violations[0].message, /id.*does not match.*directory/i);
});
