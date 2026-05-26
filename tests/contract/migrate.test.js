import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { scaffoldFromTemplate } from '../../lib/migrate.js';
import { makeTmpWorkspace, cleanupTmp, writeFiles } from './helpers.js';

test('scaffoldFromTemplate copies template into dest with placeholders filled', async () => {
  const dest = makeTmpWorkspace(() => {}); // empty
  cleanupTmp(dest); // remove so scaffold creates
  try {
    await scaffoldFromTemplate({
      destDir: dest,
      values: {
        id: path.basename(dest),
        name: 'Tmp Bot',
        role: 'test',
        telegram_username: '@tmp_bot',
        owner: 'tester'
      }
    });
    assert.ok(fs.existsSync(path.join(dest, 'IDENTITY.md')));
    assert.ok(fs.existsSync(path.join(dest, 'config.json')));
    const cfg = JSON.parse(fs.readFileSync(path.join(dest, 'config.json'), 'utf8'));
    assert.strictEqual(cfg.id, path.basename(dest));
    assert.strictEqual(cfg.runtime, 'shared');
    const id = fs.readFileSync(path.join(dest, 'IDENTITY.md'), 'utf8');
    assert.match(id, /name: Tmp Bot/);
  } finally { fs.rmSync(dest, { recursive: true, force: true }); }
});

test('scaffoldFromTemplate refuses to overwrite without force', async () => {
  const dest = makeTmpWorkspace((d) => writeFiles(d, { 'existing.txt': 'do not touch' }));
  try {
    await assert.rejects(scaffoldFromTemplate({
      destDir: dest,
      values: { id: path.basename(dest), name: 't', role: 't', telegram_username: '@t', owner: 't' }
    }), /exists|not empty/i);
    assert.ok(fs.existsSync(path.join(dest, 'existing.txt')));
  } finally { cleanupTmp(dest); }
});
