import { test } from 'node:test';
import assert from 'node:assert';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-basic.js';
import { fixturePath } from './helpers.js';

const R05 = RULES.get('R05');

test('R05 passes for shared/custom runtime regardless of sidecars', async () => {
  const r = await R05.run(fixturePath('valid-minimal'));
  assert.strictEqual(r.pass, true);
});

test('R05 passes when all sidecars resolve inside workspace and files exist', async () => {
  const r = await R05.run(fixturePath('valid-sidecar'));
  assert.strictEqual(r.pass, true, JSON.stringify(r.violations));
});

test('R05 fails when a sidecar script escapes workspace', async () => {
  const r = await R05.run(fixturePath('invalid-sidecar-escape'));
  assert.strictEqual(r.pass, false);
  assert.match(r.violations[0].message, /escapes.*workspace|outside/i);
});
