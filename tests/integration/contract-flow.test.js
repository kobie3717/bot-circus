import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateAtBoot, writeQuarantineState, readQuarantineState } from '../../lib/validator.js';

function mkPerfFixture(parent, id, opts = {}) {
  const dir = path.join(parent, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    contract_version: '1.0', id, name: id, runtime: 'shared', secrets: { provider: 'env-file' }
  }));
  if (!opts.skipIdentity) {
    fs.writeFileSync(path.join(dir, 'IDENTITY.md'), `---\nid: ${id}\nname: ${id}\nrole: t\n---\n`);
  }
  return dir;
}

test('boot validation passes good performers and quarantines bad ones', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-flow-'));
  try {
    const good1 = mkPerfFixture(tmp, 'good-1');
    const good2 = mkPerfFixture(tmp, 'good-2');
    const bad = mkPerfFixture(tmp, 'bad-1', { skipIdentity: true });

    const r = await validateAtBoot([good1, good2, bad]);
    assert.strictEqual(r.passed.size, 2);
    assert.strictEqual(r.failed.size, 1);
    assert.ok(r.failed.has('bad-1'));

    const statePath = path.join(tmp, 'quarantine.json');
    writeQuarantineState(statePath, r.failed);
    const round = readQuarantineState(statePath);
    assert.strictEqual(round.has('bad-1'), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
