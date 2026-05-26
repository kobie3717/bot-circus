import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-basic.js';
import '../../lib/contract/rules-source.js';
import { makeTmpWorkspace, cleanupTmp, writeFiles } from './helpers.js';

const R07 = RULES.get('R07');

test('R07 passes when no cross-performer string', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: 'test-bot', name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: test-bot\nname: t\nrole: t\n---\n',
      'handler.mjs': "console.log('hello');"
    });
  });
  try {
    const r = await R07.run(dir);
    assert.strictEqual(r.pass, true);
  } finally { cleanupTmp(dir); }
});

test('R07 fails on string "performers/other-bot/" in source', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: 'test-bot', name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: test-bot\nname: t\nrole: t\n---\n',
      'handler.mjs': "const sibling = 'performers/other-bot/MEMORY.md';"
    });
  });
  try {
    const r = await R07.run(dir);
    assert.strictEqual(r.pass, false);
    assert.match(r.violations[0].message, /performers\/other-bot/);
  } finally { cleanupTmp(dir); }
});

test('R07 allows own-id path reference', async () => {
  const dir = makeTmpWorkspace((d) => {
    const ownId = 'test-bot';
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: ownId, name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: test-bot\nname: t\nrole: t\n---\n',
      'handler.mjs': `const own = 'performers/${ownId}/MEMORY.md';`
    });
  });
  try {
    const r = await R07.run(dir);
    assert.strictEqual(r.pass, true, JSON.stringify(r.violations));
  } finally { cleanupTmp(dir); }
});
