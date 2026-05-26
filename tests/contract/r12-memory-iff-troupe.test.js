import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-warn.js';
import { makeTmpWorkspace, cleanupTmp, writeFiles } from './helpers.js';

const R12 = RULES.get('R12');

test('R12 passes when no troupes and no MEMORY.md', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: 'test-r12-notroupes', name: 't', runtime: 'shared', secrets: { provider: 'env-file' }, troupes: [] },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n'
    });
  });
  try {
    const r = await R12.run(dir);
    assert.strictEqual(r.pass, true);
  } finally { cleanupTmp(dir); }
});

test('R12 passes when troupes present and MEMORY.md present', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: 'test-r12-with-memory', name: 't', runtime: 'shared', secrets: { provider: 'env-file' }, troupes: ['support'] },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      'MEMORY.md': '# Memory'
    });
  });
  try {
    const r = await R12.run(dir);
    assert.strictEqual(r.pass, true);
  } finally { cleanupTmp(dir); }
});

test('R12 fails when troupes present and MEMORY.md missing', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: 'test-r12-no-memory', name: 't', runtime: 'shared', secrets: { provider: 'env-file' }, troupes: ['support'] },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n'
    });
  });
  try {
    const r = await R12.run(dir);
    assert.strictEqual(r.pass, false);
    assert.match(r.violations[0].message, /MEMORY\.md/);
  } finally { cleanupTmp(dir); }
});
