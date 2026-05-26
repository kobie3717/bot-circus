import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { validateAtBoot, writeQuarantineState, readQuarantineState } from '../../lib/validator.js';
import { fixturePath, makeTmpWorkspace, cleanupTmp } from './helpers.js';

test('validateAtBoot returns pass+fail Maps', async () => {
  const r = await validateAtBoot([
    fixturePath('valid-minimal'),
    fixturePath('invalid-no-config')
  ]);
  assert.ok(r.passed instanceof Map);
  assert.ok(r.failed instanceof Map);
  assert.strictEqual(r.passed.has('valid-minimal'), true);
  assert.strictEqual(r.failed.has('invalid-no-config'), true);
});

test('validateAtBoot only runs runtime-layer rules (R01–R06)', async () => {
  const r = await validateAtBoot([fixturePath('valid-minimal')]);
  const ruleIds = r.passed.get('valid-minimal').ruleResults.map(x => x.id);
  // Should include R01–R06 only
  for (const id of ['R01','R02','R03','R04','R05','R06']) {
    assert.ok(ruleIds.includes(id), `missing ${id}`);
  }
  for (const id of ['R07','R08','R09','R10','R11','R12']) {
    assert.ok(!ruleIds.includes(id), `${id} should not run at runtime`);
  }
});

test('writeQuarantineState writes JSON; readQuarantineState reads it back', () => {
  const dir = makeTmpWorkspace(() => {});
  try {
    const statePath = `${dir}/quarantine.json`;
    writeQuarantineState(statePath, new Map([
      ['friday', { errors: [{ rule: 'R02', message: 'missing IDENTITY.md' }] }]
    ]));
    const read = readQuarantineState(statePath);
    assert.strictEqual(read.has('friday'), true);
    assert.strictEqual(read.get('friday').errors[0].rule, 'R02');
  } finally { cleanupTmp(dir); }
});
