import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-git.js';
import { makeTmpWorkspace, cleanupTmp, writeFiles } from './helpers.js';

const R10 = RULES.get('R10');

test('R10 passes when no package.json present', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n'
    });
  });
  try {
    const r = await R10.run(dir, { allWorkspaces: [dir] });
    assert.strictEqual(r.pass, true);
  } finally { cleanupTmp(dir); }
});

test('R10 fails when package.json name collides with another performer', async () => {
  const ws1 = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      'package.json': { name: 'shared-bot', version: '1.0.0' }
    });
  });
  const ws2 = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't2', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t2\nname: t2\nrole: t\n---\n',
      'package.json': { name: 'shared-bot', version: '1.0.0' }
    });
  });
  try {
    const r = await R10.run(ws1, { allWorkspaces: [ws1, ws2] });
    assert.strictEqual(r.pass, false);
    assert.match(r.violations[0].message, /name.*collid|conflict/i);
  } finally { cleanupTmp(ws1); cleanupTmp(ws2); }
});
