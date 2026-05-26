import { test } from 'node:test';
import assert from 'node:assert';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/frontmatter.js';
import { fixturePath } from './helpers.js';

const R02 = RULES.get('R02');

test('R02 passes when IDENTITY.md has required frontmatter', async () => {
  const r = await R02.run(fixturePath('valid-minimal'));
  assert.strictEqual(r.pass, true, JSON.stringify(r.violations));
});

test('R02 fails when IDENTITY.md missing', async () => {
  const r = await R02.run(fixturePath('invalid-no-identity'));
  assert.strictEqual(r.pass, false);
  assert.match(r.violations[0].message, /missing.*IDENTITY\.md/i);
});

test('R02 fails when IDENTITY.md has no frontmatter', async () => {
  const r = await R02.run(fixturePath('invalid-identity-no-frontmatter'));
  assert.strictEqual(r.pass, false);
  assert.match(r.violations[0].message, /frontmatter/i);
});
