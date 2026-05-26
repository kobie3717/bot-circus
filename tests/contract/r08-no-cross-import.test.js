import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-basic.js';
import '../../lib/contract/rules-source.js';
import { makeTmpWorkspace, cleanupTmp, writeFiles } from './helpers.js';

const R08 = RULES.get('R08');

test('R08 passes on benign source', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: 'test-bot', name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: test-bot\nname: t\nrole: t\n---\n',
      'handler.mjs': "import { pino } from 'pino';"
    });
  });
  try {
    const r = await R08.run(dir);
    assert.strictEqual(r.pass, true);
  } finally { cleanupTmp(dir); }
});

test('R08 fails on import from sibling performer', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: 'test-bot', name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: test-bot\nname: t\nrole: t\n---\n',
      'handler.mjs': "import x from '../other-bot/handler.mjs';"
    });
  });
  try {
    const r = await R08.run(dir);
    assert.strictEqual(r.pass, false);
    assert.match(r.violations[0].message, /import|require/i);
  } finally { cleanupTmp(dir); }
});

test('R08 fails on fs.readFile of sibling performer absolute path', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: 'test-bot', name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: test-bot\nname: t\nrole: t\n---\n',
      'handler.mjs': "fs.readFile('/root/bot-circus/performers/other/MEMORY.md');"
    });
  });
  try {
    const r = await R08.run(dir);
    assert.strictEqual(r.pass, false);
  } finally { cleanupTmp(dir); }
});
