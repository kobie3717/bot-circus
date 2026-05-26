import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateAtBoot } from '../../lib/validator.js';

test('a passing performer becomes quarantined when broken, then recovers on next validate', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reload-'));
  const id = 'reload-test';
  const dir = path.join(tmp, id);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      contract_version: '1.0', id, name: id, runtime: 'shared', secrets: { provider: 'env-file' }
    }));
    fs.writeFileSync(path.join(dir, 'IDENTITY.md'), `---\nid: ${id}\nname: ${id}\nrole: t\n---\n`);

    let r = await validateAtBoot([dir]);
    assert.strictEqual(r.passed.size, 1);
    assert.strictEqual(r.failed.size, 0);

    fs.rmSync(path.join(dir, 'IDENTITY.md'));
    r = await validateAtBoot([dir]);
    assert.strictEqual(r.passed.size, 0);
    assert.strictEqual(r.failed.size, 1);

    fs.writeFileSync(path.join(dir, 'IDENTITY.md'), `---\nid: ${id}\nname: ${id}\nrole: t\n---\n`);
    r = await validateAtBoot([dir]);
    assert.strictEqual(r.passed.size, 1);
    assert.strictEqual(r.failed.size, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
