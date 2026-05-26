import path from 'node:path';
import fs from 'node:fs/promises';
import { registerRule } from './rules.js';
import { loadConfig } from './schema.js';

registerRule({
  id: 'R03',
  severity: 'error',
  layers: ['lint', 'ci', 'runtime'],
  run: async (workspaceDir) => {
    const cfg = await loadConfig(workspaceDir);
    if (!cfg.ok) {
      return { pass: true, violations: [] }; // R01 catches; R03 stays quiet
    }
    const dirName = path.basename(path.resolve(workspaceDir));
    if (cfg.config.id !== dirName) {
      return {
        pass: false,
        violations: [{
          rule: 'R03',
          message: `config.id "${cfg.config.id}" does not match parent directory "${dirName}"`
        }]
      };
    }
    return { pass: true, violations: [] };
  }
});

registerRule({
  id: 'R04',
  severity: 'error',
  layers: ['lint', 'ci', 'runtime'],
  run: async (workspaceDir) => {
    const cfg = await loadConfig(workspaceDir);
    if (!cfg.ok) return { pass: true, violations: [] };
    if (cfg.config.runtime !== 'custom') return { pass: true, violations: [] };
    const mdPath = path.join(workspaceDir, 'CUSTOM_RUNTIME.md');
    try {
      await fs.access(mdPath);
      return { pass: true, violations: [] };
    } catch {
      return {
        pass: false,
        violations: [{
          rule: 'R04',
          message: `runtime is "custom" but CUSTOM_RUNTIME.md is missing`
        }]
      };
    }
  }
});
