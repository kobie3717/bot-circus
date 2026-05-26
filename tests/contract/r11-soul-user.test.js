import { test } from 'node:test';
import assert from 'node:assert';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-warn.js';
import { fixturePath, makeTmpWorkspace, cleanupTmp, writeFiles } from './helpers.js';
import path from 'node:path';

const R11 = RULES.get('R11');

test('R11 has warn severity', () => {
  assert.strictEqual(R11.severity, 'warn');
});

test('R11 passes when SOUL.md + USER.md both present', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      'SOUL.md': '# Persona\n',
      'USER.md': '# Behaviour rules\n'
    });
  });
  try {
    const r = await R11.run(dir);
    assert.strictEqual(r.pass, true);
  } finally { cleanupTmp(dir); }
});

test('R11 fails when SOUL.md missing', async () => {
  const r = await R11.run(fixturePath('valid-minimal'));
  assert.strictEqual(r.pass, false);
  assert.ok(r.violations.some(v => /SOUL\.md/.test(v.message)));
});
