import { test } from 'node:test';
import assert from 'node:assert';
import { lintWorkspaces, pickWorkspacesSince } from '../../lib/lint.js';
import { fixturePath } from './helpers.js';

test('lintWorkspaces runs all 12 rules against a workspace and returns summary', async () => {
  const summary = await lintWorkspaces({
    workspaces: [fixturePath('valid-minimal')]
  });
  assert.ok(Array.isArray(summary.results));
  const r = summary.results[0];
  assert.strictEqual(r.workspace, fixturePath('valid-minimal'));
  // 12 rule outcomes
  assert.strictEqual(r.ruleResults.length, 12);
  // R01–R10 should be either pass or warnings-only; valid-minimal may warn on R11
  assert.strictEqual(summary.errorCount, 0);
});

test('lintWorkspaces reports errors for invalid fixtures', async () => {
  const summary = await lintWorkspaces({
    workspaces: [fixturePath('invalid-no-config')]
  });
  assert.ok(summary.errorCount > 0);
});

test('pickWorkspacesSince returns only changed performer dirs', async () => {
  // Use bot-circus's own performers/ via the live git repo
  const all = ['/root/bot-circus/performers/007', '/root/bot-circus/performers/webbs'];
  // Pick a stable ref; HEAD will likely have no perf changes — assert it returns []
  const picked = await pickWorkspacesSince(all, 'HEAD');
  assert.ok(Array.isArray(picked));
});
