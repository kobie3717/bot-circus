import path from 'node:path';
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
