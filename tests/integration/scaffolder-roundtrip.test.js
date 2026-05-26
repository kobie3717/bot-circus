import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scaffoldFromTemplate, inspectLegacy } from '../../lib/migrate.js';
import { lintWorkspaces } from '../../lib/lint.js';

test('scaffolder output lints clean (errors zero, warnings allowed)', async () => {
  const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-legacy-'));
  // Use timestamp-based name to ensure lowercase ID for schema compliance
  const dest = path.join(os.tmpdir(), 'scaffold-dest-' + Date.now());
  try {
    // Create legacy bot structure
    fs.writeFileSync(path.join(legacy, 'package.json'), JSON.stringify({ name: 'legacy-test', version: '1.0.0' }));
    fs.writeFileSync(path.join(legacy, '.env'), 'TELEGRAM_BOT_TOKEN=xxx\n');
    fs.writeFileSync(path.join(legacy, 'bot.mjs'), 'console.log("x");');

    // Inspect legacy bot
    const info = await inspectLegacy(legacy);
    assert.strictEqual(info.suggestedRuntime, 'shared');

    // Clean destination and scaffold
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    const id = path.basename(dest);
    await scaffoldFromTemplate({
      destDir: dest,
      values: { id, name: 'Legacy Test', role: 'test', telegram_username: '@legacy_bot', owner: 'kobie3717' }
    });

    // Lint the scaffolded workspace
    const summary = await lintWorkspaces({ workspaces: [dest] });
    assert.strictEqual(summary.errorCount, 0, `unexpected errors: ${JSON.stringify(summary.results, null, 2)}`);
  } finally {
    fs.rmSync(legacy, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});
