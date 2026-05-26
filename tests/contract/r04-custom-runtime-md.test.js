import { test } from 'node:test';
import assert from 'node:assert';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-basic.js';
import { fixturePath } from './helpers.js';

const R04 = RULES.get('R04');

test('R04 passes for shared runtime regardless of md', async () => {
  const r = await R04.run(fixturePath('valid-minimal'));
  assert.strictEqual(r.pass, true);
});

test('R04 passes for custom + CUSTOM_RUNTIME.md present', async () => {
  const r = await R04.run(fixturePath('valid-custom'));
  assert.strictEqual(r.pass, true);
});

test('R04 fails for custom without CUSTOM_RUNTIME.md', async () => {
  const r = await R04.run(fixturePath('invalid-custom-no-md'));
  assert.strictEqual(r.pass, false);
  assert.match(r.violations[0].message, /CUSTOM_RUNTIME\.md/);
});
