import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-git.js';
import { makeTmpWorkspace, cleanupTmp, writeFiles } from './helpers.js';

const R09 = RULES.get('R09');

function initGit(d) {
  execSync('git init -q', { cwd: d });
  execSync('git config user.email test@test.test', { cwd: d });
  execSync('git config user.name test', { cwd: d });
}

test('R09 passes when .env in .gitignore and not tracked', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      '.gitignore': '.env\n',
      '.env': 'TOKEN=abc\n'
    });
    initGit(d);
    execSync('git add .gitignore IDENTITY.md config.json', { cwd: d });
    execSync('git commit -q -m init', { cwd: d });
  });
  try {
    const r = await R09.run(dir);
    assert.strictEqual(r.pass, true, JSON.stringify(r.violations));
  } finally { cleanupTmp(dir); }
});

test('R09 fails when .env not in .gitignore', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      '.env': 'TOKEN=abc\n'
    });
  });
  try {
    const r = await R09.run(dir);
    assert.strictEqual(r.pass, false);
    assert.match(r.violations[0].message, /\.gitignore/);
  } finally { cleanupTmp(dir); }
});
