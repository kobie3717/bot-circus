import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-basic.js';
import { makeTmpWorkspace, cleanupTmp, writeFiles } from './helpers.js';

const R06 = RULES.get('R06');

test('R06 passes when no symlinks present', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n'
    });
  });
  try {
    const r = await R06.run(dir);
    assert.strictEqual(r.pass, true);
  } finally { cleanupTmp(dir); }
});

test('R06 passes for internal symlink', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      'memory/seed.txt': 'seed'
    });
    fs.symlinkSync('memory/seed.txt', path.join(d, 'seed-link'));
  });
  try {
    const r = await R06.run(dir);
    assert.strictEqual(r.pass, true, JSON.stringify(r.violations));
  } finally { cleanupTmp(dir); }
});

test('R06 fails for symlink escaping workspace', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n'
    });
    fs.symlinkSync('/etc/hosts', path.join(d, 'hosts-leak'));
  });
  try {
    const r = await R06.run(dir);
    assert.strictEqual(r.pass, false);
    assert.match(r.violations[0].message, /symlink.*outside|escapes/i);
  } finally { cleanupTmp(dir); }
});
