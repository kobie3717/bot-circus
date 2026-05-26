import { RULES } from './contract/index.js';

const LAYER_RULE_FILTER = {
  lint: r => r.layers.includes('lint'),
  ci: r => r.layers.includes('ci'),
  runtime: r => r.layers.includes('runtime'),
  all: () => true
};

export async function lintWorkspace(workspaceDir, ctx = {}, layer = 'all') {
  const filter = LAYER_RULE_FILTER[layer] || LAYER_RULE_FILTER.all;
  const rules = [...RULES.values()].filter(filter);
  const ruleResults = [];
  for (const rule of rules) {
    try {
      const out = await rule.run(workspaceDir, ctx);
      ruleResults.push({ id: rule.id, severity: rule.severity, ...out });
    } catch (err) {
      ruleResults.push({
        id: rule.id,
        severity: rule.severity,
        pass: false,
        violations: [{ rule: rule.id, message: `rule crashed: ${err.message}` }]
      });
    }
  }
  return { workspace: workspaceDir, ruleResults };
}

export async function lintWorkspaces({ workspaces, layer = 'all' }) {
  const results = [];
  let errorCount = 0;
  let warnCount = 0;
  for (const ws of workspaces) {
    const r = await lintWorkspace(ws, { allWorkspaces: workspaces }, layer);
    results.push(r);
    for (const rr of r.ruleResults) {
      if (rr.pass) continue;
      if (rr.severity === 'error') errorCount += rr.violations.length;
      if (rr.severity === 'warn') warnCount += rr.violations.length;
    }
  }
  return { results, errorCount, warnCount };
}
