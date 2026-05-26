import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv from 'ajv';
import { registerRule } from './rules.js';

const ajv = new Ajv({ allErrors: true });

export const configSchema = {
  type: 'object',
  required: ['contract_version', 'id', 'name', 'runtime', 'secrets'],
  additionalProperties: true,
  properties: {
    contract_version: { type: 'string', const: '1.0' },
    id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' },
    name: { type: 'string', minLength: 1 },
    telegram_username: { type: 'string' },
    runtime: { enum: ['shared', 'sidecar', 'custom'] },
    secrets: {
      type: 'object',
      required: ['provider'],
      properties: {
        provider: { enum: ['env-file'] },
        path: { type: 'string' }
      }
    },
    troupes: { type: 'array', items: { type: 'string' } },
    sidecars: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'script'],
        properties: {
          name: { type: 'string' },
          script: { type: 'string' }
        }
      }
    },
    owner: { type: 'string' }
  }
};

const validate = ajv.compile(configSchema);

export async function loadConfig(workspaceDir) {
  const p = path.join(workspaceDir, 'config.json');
  let raw;
  try {
    raw = await fs.readFile(p, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { ok: false, error: `missing config.json at ${p}` };
    }
    return { ok: false, error: `read failed: ${err.message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `parse failed: ${err.message}` };
  }
  if (!validate(parsed)) {
    return {
      ok: false,
      error: `schema invalid: ${ajv.errorsText(validate.errors)}`,
      parsed
    };
  }
  return { ok: true, config: parsed };
}

registerRule({
  id: 'R01',
  severity: 'error',
  layers: ['lint', 'ci', 'runtime'],
  run: async (workspaceDir) => {
    const result = await loadConfig(workspaceDir);
    if (!result.ok) {
      return { pass: false, violations: [{ rule: 'R01', message: result.error }] };
    }
    return { pass: true, violations: [] };
  }
});
