import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { scaffoldFromTemplate, inspectLegacy } from '../../lib/migrate.js';
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

test('inspectLegacy reads name from package.json and env keys from .env', async () => {
  const legacy = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'package.json': { name: 'old-bot', version: '1.0.0' },
      '.env': 'TELEGRAM_BOT_TOKEN=xxx\nANTHROPIC_API_KEY=yyy\n',
      'bot.mjs': 'console.log("old runtime");'
    });
  });
  try {
    const info = await inspectLegacy(legacy);
    assert.strictEqual(info.pkgName, 'old-bot');
    assert.deepStrictEqual(info.envKeys, ['TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY']);
    assert.deepStrictEqual(info.entryScripts, ['bot.mjs']);
    assert.strictEqual(info.suggestedRuntime, 'shared');
  } finally { cleanupTmp(legacy); }
});

test('inspectLegacy detects sidecar pattern when multiple top-level scripts', async () => {
  const legacy = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'package.json': { name: 'multi', version: '1.0.0' },
      'bot.mjs': '',
      'email.mjs': '',
      'whatsapp.mjs': ''
    });
  });
  try {
    const info = await inspectLegacy(legacy);
    assert.strictEqual(info.suggestedRuntime, 'sidecar');
    assert.deepStrictEqual(info.entryScripts.sort(), ['bot.mjs','email.mjs','whatsapp.mjs']);
  } finally { cleanupTmp(legacy); }
});
