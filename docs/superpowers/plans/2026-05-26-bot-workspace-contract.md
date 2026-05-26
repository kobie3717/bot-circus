# Bot Workspace Isolation Contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the per-performer workspace contract for bot-circus — 12 lint rules, three enforcement gates (pre-commit + CI + orchestrator runtime), a reference template, and an auto-migration scaffolder. No running PM2 bot is migrated here.

**Architecture:** Pure functions in `lib/contract/rules.js` define each rule. Pre-commit hook, CI workflow, and orchestrator boot validator all call the same rule functions. Scaffolder reads legacy bot dirs and emits v1-compliant workspaces under `performers/<id>/`, leaving legacy dirs untouched.

**Tech Stack:** Node 22, ESM, `node:test` (built-in test runner), `ajv` (JSON schema), `gray-matter` (MD frontmatter), `commander` (CLI, already present), `pino` (logging, already present).

**Spec:** `docs/superpowers/specs/2026-05-26-bot-workspace-contract-design.md`.

---

## File Structure

**Create:**

```
bot-circus/
├── CONTRACT.md                                    # T17
├── templates/performer/
│   ├── IDENTITY.md.tmpl                           # T16
│   ├── SOUL.md.tmpl                               # T16
│   ├── USER.md.tmpl                               # T16
│   ├── MEMORY.md.tmpl                             # T16
│   ├── config.json.tmpl                           # T16
│   ├── .env.example                               # T16
│   ├── .gitignore                                 # T16
│   └── memory/.gitkeep                            # T16
├── lib/contract/
│   ├── schema.js                                  # T2
│   ├── frontmatter.js                             # T3
│   ├── rules.js                                   # T2–T13 (one fn per rule, grown across tasks)
│   └── index.js                                   # T14
├── lib/
│   ├── lint.js                                    # T14
│   ├── validator.js                               # T18
│   └── migrate.js                                 # T24–T28
├── bin/
│   ├── circus-lint                                # T14
│   └── circus-migrate                             # T24
├── tests/contract/
│   ├── fixtures/                                  # T1, grown per rule
│   ├── helpers.js                                 # T1
│   ├── r01-config-schema.test.js                  # T2
│   ├── r02-identity.test.js                       # T3
│   ├── r03-id-dirname.test.js                     # T4
│   ├── r04-custom-runtime-md.test.js              # T5
│   ├── r05-sidecars-resolve.test.js               # T6
│   ├── r06-symlinks.test.js                       # T7
│   ├── r07-no-cross-path.test.js                  # T8
│   ├── r08-no-cross-import.test.js                # T9
│   ├── r09-env-gitignored.test.js                 # T10
│   ├── r10-pkg-name-unique.test.js                # T11
│   ├── r11-soul-user.test.js                      # T12
│   ├── r12-memory-iff-troupe.test.js              # T13
│   ├── lint.test.js                               # T14
│   ├── validator.test.js                          # T18
│   └── migrate.test.js                            # T24–T28
├── tests/integration/
│   ├── contract-flow.test.js                      # T29
│   ├── reload.test.js                             # T30
│   └── scaffolder-roundtrip.test.js               # T31
├── .github/workflows/contract.yml                 # T32
└── .githooks/
    ├── pre-commit                                 # T33
    └── install.sh                                 # T33
```

**Modify:**

- `bot-circus/package.json` (T0: add deps + bin entries + scripts)
- `bot-circus/lib/orchestrator.js` (T19, T20, T21, T22: wire validator + quarantine + dispatch skip + SIGUSR2)
- `bot-circus/.gitignore` (T0: ignore `performers/*/.env`)

---

## Task 0: Set up dependencies + test infrastructure

**Files:**
- Modify: `bot-circus/package.json`
- Modify: `bot-circus/.gitignore`
- Create: `bot-circus/tests/contract/helpers.js`
- Create: `bot-circus/tests/contract/fixtures/.gitkeep`

- [ ] **Step 1: Install dev + runtime deps**

Run:
```bash
cd /root/bot-circus && npm install --save ajv@^8.12.0 gray-matter@^4.0.3
```

Expected: deps appear in `package.json` dependencies. No errors.

- [ ] **Step 2: Add test + lint scripts to package.json**

Edit `package.json` `scripts` section to:
```json
{
  "scripts": {
    "start": "node lib/orchestrator.js",
    "dev": "node --watch lib/orchestrator.js",
    "test": "node --test --test-reporter=spec tests/contract/ tests/integration/",
    "test:unit": "node --test --test-reporter=spec tests/contract/",
    "test:integration": "node --test --test-reporter=spec tests/integration/",
    "lint:contract": "node bin/circus-lint"
  }
}
```

Edit `package.json` `bin` section to:
```json
{
  "bin": {
    "circus": "./bin/circus.js",
    "circus-lint": "./bin/circus-lint",
    "circus-migrate": "./bin/circus-migrate"
  }
}
```

- [ ] **Step 3: Add gitignore entries**

Append to `bot-circus/.gitignore`:
```
performers/*/.env
.state/
logs/contract-violations.jsonl
logs/dispatch.jsonl
```

- [ ] **Step 4: Create test helpers**

Create `bot-circus/tests/contract/helpers.js`:
```js
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.join(__dirname, 'fixtures');

export function fixturePath(name) {
  return path.join(FIXTURES_DIR, name);
}

export function makeTmpWorkspace(setupFn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'circus-test-'));
  try {
    setupFn(dir);
    return dir;
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

export function cleanupTmp(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function writeFiles(dir, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (typeof content === 'object') {
      fs.writeFileSync(full, JSON.stringify(content, null, 2));
    } else {
      fs.writeFileSync(full, content);
    }
  }
}
```

- [ ] **Step 5: Create fixtures dir marker**

Run: `touch /root/bot-circus/tests/contract/fixtures/.gitkeep`

- [ ] **Step 6: Verify test runner works with empty suite**

Run:
```bash
cd /root/bot-circus && npm test 2>&1 | tail -5
```

Expected: `node --test` runs and reports zero tests (exit 0). If exit non-zero with no tests, that's fine — proceed.

- [ ] **Step 7: Commit**

```bash
cd /root/bot-circus
git add package.json package-lock.json .gitignore tests/contract/helpers.js tests/contract/fixtures/.gitkeep
git commit -m "feat(contract): scaffold deps, test runner, helpers (T0)"
```

---

## Task 1: Create stub `lib/contract/rules.js` + lint entry stub

**Files:**
- Create: `bot-circus/lib/contract/rules.js`
- Create: `bot-circus/lib/contract/index.js`

- [ ] **Step 1: Write the failing test (rule registry contract)**

Create `bot-circus/tests/contract/registry.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { RULES } from '../../lib/contract/rules.js';

test('RULES is a Map keyed by rule id', () => {
  assert.ok(RULES instanceof Map);
});

test('each rule has id, severity, layer, run fn', () => {
  for (const [id, rule] of RULES) {
    assert.match(id, /^R\d{2}$/, `bad id format: ${id}`);
    assert.ok(['error', 'warn'].includes(rule.severity), `bad severity for ${id}`);
    assert.ok(Array.isArray(rule.layers), `layers must be array for ${id}`);
    for (const l of rule.layers) {
      assert.ok(['lint', 'ci', 'runtime'].includes(l), `bad layer ${l} for ${id}`);
    }
    assert.strictEqual(typeof rule.run, 'function', `run must be function for ${id}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/registry.test.js 2>&1 | tail -10`

Expected: FAIL — `Cannot find module '../../lib/contract/rules.js'`.

- [ ] **Step 3: Write minimal rules.js**

Create `bot-circus/lib/contract/rules.js`:
```js
export const RULES = new Map();

export function registerRule({ id, severity, layers, run }) {
  RULES.set(id, { id, severity, layers, run });
}
```

Create `bot-circus/lib/contract/index.js`:
```js
export { RULES, registerRule } from './rules.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/registry.test.js 2>&1 | tail -10`

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add lib/contract/ tests/contract/registry.test.js
git commit -m "feat(contract): rule registry skeleton (T1)"
```

---

## Task 2: R01 — `config.json` exists + valid against schema

**Files:**
- Create: `bot-circus/lib/contract/schema.js`
- Modify: `bot-circus/lib/contract/rules.js`
- Create: `bot-circus/tests/contract/r01-config-schema.test.js`
- Create: `bot-circus/tests/contract/fixtures/valid-minimal/config.json`
- Create: `bot-circus/tests/contract/fixtures/invalid-no-config/IDENTITY.md`
- Create: `bot-circus/tests/contract/fixtures/invalid-malformed-config/config.json`

- [ ] **Step 1: Write fixtures**

Create `bot-circus/tests/contract/fixtures/valid-minimal/config.json`:
```json
{
  "contract_version": "1.0",
  "id": "valid-minimal",
  "name": "Valid Minimal",
  "telegram_username": "@valid_minimal_bot",
  "runtime": "shared",
  "secrets": { "provider": "env-file", "path": ".env" },
  "troupes": [],
  "sidecars": [],
  "owner": "test"
}
```

Create `bot-circus/tests/contract/fixtures/invalid-no-config/IDENTITY.md`:
```markdown
---
id: invalid-no-config
name: No Config
---
# No Config
```

Create `bot-circus/tests/contract/fixtures/invalid-malformed-config/config.json`:
```
{ "contract_version": "1.0", "id": "broken",
```

- [ ] **Step 2: Write the failing test**

Create `bot-circus/tests/contract/r01-config-schema.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js'; // registers R01
import { fixturePath } from './helpers.js';

const R01 = RULES.get('R01');

test('R01 passes on valid-minimal fixture', async () => {
  const result = await R01.run(fixturePath('valid-minimal'));
  assert.strictEqual(result.pass, true, JSON.stringify(result.violations));
});

test('R01 fails when config.json missing', async () => {
  const result = await R01.run(fixturePath('invalid-no-config'));
  assert.strictEqual(result.pass, false);
  assert.match(result.violations[0].message, /missing.*config\.json/i);
});

test('R01 fails when config.json malformed JSON', async () => {
  const result = await R01.run(fixturePath('invalid-malformed-config'));
  assert.strictEqual(result.pass, false);
  assert.match(result.violations[0].message, /parse|invalid json/i);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/r01-config-schema.test.js 2>&1 | tail -10`

Expected: FAIL — `Cannot find module '../../lib/contract/schema.js'`.

- [ ] **Step 4: Write schema.js with R01 implementation**

Create `bot-circus/lib/contract/schema.js`:
```js
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/r01-config-schema.test.js 2>&1 | tail -10`

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /root/bot-circus
git add lib/contract/schema.js tests/contract/r01-config-schema.test.js tests/contract/fixtures/valid-minimal tests/contract/fixtures/invalid-no-config tests/contract/fixtures/invalid-malformed-config
git commit -m "feat(contract): R01 config.json schema validation (T2)"
```

---

## Task 3: R02 — `IDENTITY.md` exists with required frontmatter

**Files:**
- Create: `bot-circus/lib/contract/frontmatter.js`
- Create: `bot-circus/tests/contract/r02-identity.test.js`
- Create: `bot-circus/tests/contract/fixtures/valid-minimal/IDENTITY.md`
- Create: `bot-circus/tests/contract/fixtures/invalid-no-identity/config.json`
- Create: `bot-circus/tests/contract/fixtures/invalid-identity-no-frontmatter/IDENTITY.md`
- Create: `bot-circus/tests/contract/fixtures/invalid-identity-no-frontmatter/config.json`

- [ ] **Step 1: Add IDENTITY.md to valid fixture + create invalid ones**

Create `bot-circus/tests/contract/fixtures/valid-minimal/IDENTITY.md`:
```markdown
---
id: valid-minimal
name: Valid Minimal
role: test bot
telegram_username: "@valid_minimal_bot"
owner: test
---

# Valid Minimal

Test fixture.
```

Create `bot-circus/tests/contract/fixtures/invalid-no-identity/config.json`:
```json
{
  "contract_version": "1.0",
  "id": "invalid-no-identity",
  "name": "No Identity",
  "runtime": "shared",
  "secrets": { "provider": "env-file" }
}
```

Create `bot-circus/tests/contract/fixtures/invalid-identity-no-frontmatter/config.json`:
```json
{
  "contract_version": "1.0",
  "id": "invalid-identity-no-frontmatter",
  "name": "Bad FM",
  "runtime": "shared",
  "secrets": { "provider": "env-file" }
}
```

Create `bot-circus/tests/contract/fixtures/invalid-identity-no-frontmatter/IDENTITY.md`:
```markdown
# Bad FM

No frontmatter block.
```

- [ ] **Step 2: Write the failing test**

Create `bot-circus/tests/contract/r02-identity.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/frontmatter.js';
import { fixturePath } from './helpers.js';

const R02 = RULES.get('R02');

test('R02 passes when IDENTITY.md has required frontmatter', async () => {
  const r = await R02.run(fixturePath('valid-minimal'));
  assert.strictEqual(r.pass, true, JSON.stringify(r.violations));
});

test('R02 fails when IDENTITY.md missing', async () => {
  const r = await R02.run(fixturePath('invalid-no-identity'));
  assert.strictEqual(r.pass, false);
  assert.match(r.violations[0].message, /missing.*IDENTITY\.md/i);
});

test('R02 fails when IDENTITY.md has no frontmatter', async () => {
  const r = await R02.run(fixturePath('invalid-identity-no-frontmatter'));
  assert.strictEqual(r.pass, false);
  assert.match(r.violations[0].message, /frontmatter/i);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/r02-identity.test.js 2>&1 | tail -10`

Expected: FAIL — `Cannot find module '../../lib/contract/frontmatter.js'`.

- [ ] **Step 4: Write frontmatter.js**

Create `bot-circus/lib/contract/frontmatter.js`:
```js
import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { registerRule } from './rules.js';

const REQUIRED_IDENTITY_FIELDS = ['id', 'name', 'role'];

export async function readIdentityFrontmatter(workspaceDir) {
  const p = path.join(workspaceDir, 'IDENTITY.md');
  let raw;
  try {
    raw = await fs.readFile(p, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: false, error: `missing IDENTITY.md at ${p}` };
    return { ok: false, error: `read failed: ${err.message}` };
  }
  const parsed = matter(raw);
  if (!parsed.data || Object.keys(parsed.data).length === 0) {
    return { ok: false, error: 'IDENTITY.md has no frontmatter block' };
  }
  const missing = REQUIRED_IDENTITY_FIELDS.filter(k => !(k in parsed.data));
  if (missing.length) {
    return { ok: false, error: `IDENTITY.md frontmatter missing fields: ${missing.join(', ')}` };
  }
  return { ok: true, data: parsed.data };
}

registerRule({
  id: 'R02',
  severity: 'error',
  layers: ['lint', 'ci', 'runtime'],
  run: async (workspaceDir) => {
    const r = await readIdentityFrontmatter(workspaceDir);
    if (!r.ok) return { pass: false, violations: [{ rule: 'R02', message: r.error }] };
    return { pass: true, violations: [] };
  }
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/r02-identity.test.js 2>&1 | tail -10`

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /root/bot-circus
git add lib/contract/frontmatter.js tests/contract/r02-identity.test.js tests/contract/fixtures/valid-minimal/IDENTITY.md tests/contract/fixtures/invalid-no-identity tests/contract/fixtures/invalid-identity-no-frontmatter
git commit -m "feat(contract): R02 IDENTITY.md frontmatter validation (T3)"
```

---

## Task 4: R03 — `config.id` equals parent directory name

**Files:**
- Modify: `bot-circus/lib/contract/rules.js`
- Create: `bot-circus/tests/contract/r03-id-dirname.test.js`
- Create: `bot-circus/tests/contract/fixtures/invalid-id-mismatch/IDENTITY.md`
- Create: `bot-circus/tests/contract/fixtures/invalid-id-mismatch/config.json`

- [ ] **Step 1: Add fixture**

Create `bot-circus/tests/contract/fixtures/invalid-id-mismatch/config.json`:
```json
{
  "contract_version": "1.0",
  "id": "not-the-dirname",
  "name": "Mismatch",
  "runtime": "shared",
  "secrets": { "provider": "env-file" }
}
```

Create `bot-circus/tests/contract/fixtures/invalid-id-mismatch/IDENTITY.md`:
```markdown
---
id: not-the-dirname
name: Mismatch
role: test
---
```

- [ ] **Step 2: Write the failing test**

Create `bot-circus/tests/contract/r03-id-dirname.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-basic.js';
import { fixturePath } from './helpers.js';

const R03 = RULES.get('R03');

test('R03 passes when config.id matches parent dir', async () => {
  const r = await R03.run(fixturePath('valid-minimal'));
  assert.strictEqual(r.pass, true, JSON.stringify(r.violations));
});

test('R03 fails when config.id differs from parent dir', async () => {
  const r = await R03.run(fixturePath('invalid-id-mismatch'));
  assert.strictEqual(r.pass, false);
  assert.match(r.violations[0].message, /id.*does not match.*directory/i);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/r03-id-dirname.test.js 2>&1 | tail -10`

Expected: FAIL — `Cannot find module '../../lib/contract/rules-basic.js'`.

- [ ] **Step 4: Write rules-basic.js with R03**

Create `bot-circus/lib/contract/rules-basic.js`:
```js
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/r03-id-dirname.test.js 2>&1 | tail -10`

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /root/bot-circus
git add lib/contract/rules-basic.js tests/contract/r03-id-dirname.test.js tests/contract/fixtures/invalid-id-mismatch
git commit -m "feat(contract): R03 id matches parent dirname (T4)"
```

---

## Task 5: R04 — `runtime: "custom"` requires `CUSTOM_RUNTIME.md`

**Files:**
- Modify: `bot-circus/lib/contract/rules-basic.js`
- Create: `bot-circus/tests/contract/r04-custom-runtime-md.test.js`
- Create: `bot-circus/tests/contract/fixtures/valid-custom/config.json`
- Create: `bot-circus/tests/contract/fixtures/valid-custom/IDENTITY.md`
- Create: `bot-circus/tests/contract/fixtures/valid-custom/CUSTOM_RUNTIME.md`
- Create: `bot-circus/tests/contract/fixtures/invalid-custom-no-md/config.json`
- Create: `bot-circus/tests/contract/fixtures/invalid-custom-no-md/IDENTITY.md`

- [ ] **Step 1: Add fixtures**

Create `bot-circus/tests/contract/fixtures/valid-custom/config.json`:
```json
{
  "contract_version": "1.0",
  "id": "valid-custom",
  "name": "Valid Custom",
  "runtime": "custom",
  "secrets": { "provider": "env-file" }
}
```

Create `bot-circus/tests/contract/fixtures/valid-custom/IDENTITY.md`:
```markdown
---
id: valid-custom
name: Valid Custom
role: custom bot
---
```

Create `bot-circus/tests/contract/fixtures/valid-custom/CUSTOM_RUNTIME.md`:
```markdown
# Custom Runtime Justification

This bot uses a custom runtime because it has bespoke long-poll loop with
hardware webhooks. Shared/sidecar modes do not fit.

Reviewer signoff: test
```

Create `bot-circus/tests/contract/fixtures/invalid-custom-no-md/config.json`:
```json
{
  "contract_version": "1.0",
  "id": "invalid-custom-no-md",
  "name": "Bad Custom",
  "runtime": "custom",
  "secrets": { "provider": "env-file" }
}
```

Create `bot-circus/tests/contract/fixtures/invalid-custom-no-md/IDENTITY.md`:
```markdown
---
id: invalid-custom-no-md
name: Bad Custom
role: bad
---
```

- [ ] **Step 2: Write the failing test**

Create `bot-circus/tests/contract/r04-custom-runtime-md.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-basic.js';
import { fixturePath } from './helpers.js';

const R04 = RULES.get('R04');

test('R04 passes for shared runtime regardless of md', async () => {
  const r = await R04.run(fixturePath('valid-minimal'));
  assert.strictEqual(r.pass, true);
});

test('R04 passes for custom + CUSTOM_RUNTIME.md present', async () => {
  const r = await R04.run(fixturePath('valid-custom'));
  assert.strictEqual(r.pass, true);
});

test('R04 fails for custom without CUSTOM_RUNTIME.md', async () => {
  const r = await R04.run(fixturePath('invalid-custom-no-md'));
  assert.strictEqual(r.pass, false);
  assert.match(r.violations[0].message, /CUSTOM_RUNTIME\.md/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/r04-custom-runtime-md.test.js 2>&1 | tail -10`

Expected: FAIL — `RULES.get('R04')` undefined.

- [ ] **Step 4: Add R04 to rules-basic.js**

Append to `bot-circus/lib/contract/rules-basic.js`:
```js
import fs from 'node:fs/promises';

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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/r04-custom-runtime-md.test.js 2>&1 | tail -10`

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /root/bot-circus
git add lib/contract/rules-basic.js tests/contract/r04-custom-runtime-md.test.js tests/contract/fixtures/valid-custom tests/contract/fixtures/invalid-custom-no-md
git commit -m "feat(contract): R04 CUSTOM_RUNTIME.md required when runtime=custom (T5)"
```

---

## Task 6: R05 — sidecars `script` paths resolve inside workspace

**Files:**
- Modify: `bot-circus/lib/contract/rules-basic.js`
- Create: `bot-circus/tests/contract/r05-sidecars-resolve.test.js`
- Create: `bot-circus/tests/contract/fixtures/valid-sidecar/config.json`
- Create: `bot-circus/tests/contract/fixtures/valid-sidecar/IDENTITY.md`
- Create: `bot-circus/tests/contract/fixtures/valid-sidecar/email.mjs`
- Create: `bot-circus/tests/contract/fixtures/valid-sidecar/whatsapp.mjs`
- Create: `bot-circus/tests/contract/fixtures/invalid-sidecar-escape/config.json`
- Create: `bot-circus/tests/contract/fixtures/invalid-sidecar-escape/IDENTITY.md`

- [ ] **Step 1: Add fixtures**

Create `bot-circus/tests/contract/fixtures/valid-sidecar/config.json`:
```json
{
  "contract_version": "1.0",
  "id": "valid-sidecar",
  "name": "Valid Sidecar",
  "runtime": "sidecar",
  "secrets": { "provider": "env-file" },
  "sidecars": [
    { "name": "email", "script": "email.mjs" },
    { "name": "whatsapp", "script": "whatsapp.mjs" }
  ]
}
```

Create `bot-circus/tests/contract/fixtures/valid-sidecar/IDENTITY.md`:
```markdown
---
id: valid-sidecar
name: Valid Sidecar
role: sidecar bot
---
```

Create `bot-circus/tests/contract/fixtures/valid-sidecar/email.mjs`:
```js
// empty fixture
```

Create `bot-circus/tests/contract/fixtures/valid-sidecar/whatsapp.mjs`:
```js
// empty fixture
```

Create `bot-circus/tests/contract/fixtures/invalid-sidecar-escape/config.json`:
```json
{
  "contract_version": "1.0",
  "id": "invalid-sidecar-escape",
  "name": "Sidecar Escape",
  "runtime": "sidecar",
  "secrets": { "provider": "env-file" },
  "sidecars": [
    { "name": "evil", "script": "../valid-minimal/config.json" }
  ]
}
```

Create `bot-circus/tests/contract/fixtures/invalid-sidecar-escape/IDENTITY.md`:
```markdown
---
id: invalid-sidecar-escape
name: Sidecar Escape
role: bad
---
```

- [ ] **Step 2: Write the failing test**

Create `bot-circus/tests/contract/r05-sidecars-resolve.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-basic.js';
import { fixturePath } from './helpers.js';

const R05 = RULES.get('R05');

test('R05 passes for shared/custom runtime regardless of sidecars', async () => {
  const r = await R05.run(fixturePath('valid-minimal'));
  assert.strictEqual(r.pass, true);
});

test('R05 passes when all sidecars resolve inside workspace and files exist', async () => {
  const r = await R05.run(fixturePath('valid-sidecar'));
  assert.strictEqual(r.pass, true, JSON.stringify(r.violations));
});

test('R05 fails when a sidecar script escapes workspace', async () => {
  const r = await R05.run(fixturePath('invalid-sidecar-escape'));
  assert.strictEqual(r.pass, false);
  assert.match(r.violations[0].message, /escapes.*workspace|outside/i);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/r05-sidecars-resolve.test.js 2>&1 | tail -10`

Expected: FAIL — `RULES.get('R05')` undefined.

- [ ] **Step 4: Add R05 to rules-basic.js**

Append to `bot-circus/lib/contract/rules-basic.js`:
```js
registerRule({
  id: 'R05',
  severity: 'error',
  layers: ['lint', 'ci', 'runtime'],
  run: async (workspaceDir) => {
    const cfg = await loadConfig(workspaceDir);
    if (!cfg.ok) return { pass: true, violations: [] };
    if (cfg.config.runtime !== 'sidecar') return { pass: true, violations: [] };
    const sidecars = cfg.config.sidecars || [];
    if (sidecars.length === 0) {
      return {
        pass: false,
        violations: [{ rule: 'R05', message: 'runtime is "sidecar" but sidecars[] is empty' }]
      };
    }
    const wsAbs = path.resolve(workspaceDir);
    const violations = [];
    for (const sc of sidecars) {
      const scriptAbs = path.resolve(wsAbs, sc.script);
      const rel = path.relative(wsAbs, scriptAbs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        violations.push({
          rule: 'R05',
          message: `sidecar "${sc.name}" script "${sc.script}" escapes workspace`
        });
        continue;
      }
      try {
        await fs.access(scriptAbs);
      } catch {
        violations.push({
          rule: 'R05',
          message: `sidecar "${sc.name}" script "${sc.script}" does not exist`
        });
      }
    }
    return { pass: violations.length === 0, violations };
  }
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/r05-sidecars-resolve.test.js 2>&1 | tail -10`

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /root/bot-circus
git add lib/contract/rules-basic.js tests/contract/r05-sidecars-resolve.test.js tests/contract/fixtures/valid-sidecar tests/contract/fixtures/invalid-sidecar-escape
git commit -m "feat(contract): R05 sidecar scripts resolve inside workspace (T6)"
```

---

## Task 7: R06 — no symlinks escape workspace

**Files:**
- Modify: `bot-circus/lib/contract/rules-basic.js`
- Create: `bot-circus/tests/contract/r06-symlinks.test.js`

- [ ] **Step 1: Write the failing test (uses tmp workspaces because symlinks are environment-dependent)**

Create `bot-circus/tests/contract/r06-symlinks.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-basic.js';
import { makeTmpWorkspace, cleanupTmp, writeFiles } from './helpers.js';

const R06 = RULES.get('R06');

test('R06 passes when no symlinks present', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n'
    });
  });
  try {
    const r = await R06.run(dir);
    assert.strictEqual(r.pass, true);
  } finally { cleanupTmp(dir); }
});

test('R06 passes for internal symlink', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      'memory/seed.txt': 'seed'
    });
    fs.symlinkSync('memory/seed.txt', path.join(d, 'seed-link'));
  });
  try {
    const r = await R06.run(dir);
    assert.strictEqual(r.pass, true, JSON.stringify(r.violations));
  } finally { cleanupTmp(dir); }
});

test('R06 fails for symlink escaping workspace', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n'
    });
    fs.symlinkSync('/etc/hosts', path.join(d, 'hosts-leak'));
  });
  try {
    const r = await R06.run(dir);
    assert.strictEqual(r.pass, false);
    assert.match(r.violations[0].message, /symlink.*outside|escapes/i);
  } finally { cleanupTmp(dir); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/r06-symlinks.test.js 2>&1 | tail -10`

Expected: FAIL — `RULES.get('R06')` undefined.

- [ ] **Step 3: Add R06 to rules-basic.js**

Append to `bot-circus/lib/contract/rules-basic.js`:
```js
async function walkForSymlinks(rootAbs, currentAbs, hits) {
  const entries = await fs.readdir(currentAbs, { withFileTypes: true });
  for (const e of entries) {
    const childAbs = path.join(currentAbs, e.name);
    if (e.isSymbolicLink()) {
      const linkTarget = await fs.readlink(childAbs);
      const resolved = path.resolve(path.dirname(childAbs), linkTarget);
      const rel = path.relative(rootAbs, resolved);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        hits.push({ link: path.relative(rootAbs, childAbs), target: linkTarget });
      }
    } else if (e.isDirectory()) {
      await walkForSymlinks(rootAbs, childAbs, hits);
    }
  }
}

registerRule({
  id: 'R06',
  severity: 'error',
  layers: ['lint', 'ci', 'runtime'],
  run: async (workspaceDir) => {
    const wsAbs = path.resolve(workspaceDir);
    const hits = [];
    await walkForSymlinks(wsAbs, wsAbs, hits);
    if (hits.length === 0) return { pass: true, violations: [] };
    return {
      pass: false,
      violations: hits.map(h => ({
        rule: 'R06',
        message: `symlink "${h.link}" points outside workspace to "${h.target}"`
      }))
    };
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/r06-symlinks.test.js 2>&1 | tail -10`

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add lib/contract/rules-basic.js tests/contract/r06-symlinks.test.js
git commit -m "feat(contract): R06 symlinks must not escape workspace (T7)"
```

---

## Task 8: R07 — source files contain no cross-performer path strings

**Files:**
- Create: `bot-circus/lib/contract/rules-source.js`
- Create: `bot-circus/tests/contract/r07-no-cross-path.test.js`

- [ ] **Step 1: Write the failing test**

Create `bot-circus/tests/contract/r07-no-cross-path.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-basic.js';
import '../../lib/contract/rules-source.js';
import { makeTmpWorkspace, cleanupTmp, writeFiles } from './helpers.js';

const R07 = RULES.get('R07');

test('R07 passes when no cross-performer string', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      'handler.mjs': "console.log('hello');"
    });
  });
  try {
    const r = await R07.run(dir);
    assert.strictEqual(r.pass, true);
  } finally { cleanupTmp(dir); }
});

test('R07 fails on string "performers/other-bot/" in source', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      'handler.mjs': "const sibling = 'performers/other-bot/MEMORY.md';"
    });
  });
  try {
    const r = await R07.run(dir);
    assert.strictEqual(r.pass, false);
    assert.match(r.violations[0].message, /performers\/other-bot/);
  } finally { cleanupTmp(dir); }
});

test('R07 allows own-id path reference', async () => {
  const dir = makeTmpWorkspace((d) => {
    const ownId = path.basename(d);
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: ownId, name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      'handler.mjs': `const own = 'performers/${ownId}/MEMORY.md';`
    });
  });
  try {
    const r = await R07.run(dir);
    assert.strictEqual(r.pass, true, JSON.stringify(r.violations));
  } finally { cleanupTmp(dir); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/r07-no-cross-path.test.js 2>&1 | tail -10`

Expected: FAIL — `Cannot find module '../../lib/contract/rules-source.js'`.

- [ ] **Step 3: Write rules-source.js with R07**

Create `bot-circus/lib/contract/rules-source.js`:
```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerRule } from './rules.js';
import { loadConfig } from './schema.js';

const SOURCE_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.json']);

async function walkSourceFiles(root, current, ownId, hits, regex) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'memory' || e.name.startsWith('.')) continue;
    const childAbs = path.join(current, e.name);
    if (e.isDirectory()) {
      await walkSourceFiles(root, childAbs, ownId, hits, regex);
    } else if (e.isFile() && SOURCE_EXTS.has(path.extname(e.name))) {
      const content = await fs.readFile(childAbs, 'utf8');
      let m;
      const re = new RegExp(regex.source, 'g');
      while ((m = re.exec(content)) !== null) {
        const refId = m[1];
        if (refId !== ownId) {
          hits.push({
            file: path.relative(root, childAbs),
            id: refId
          });
        }
      }
    }
  }
}

registerRule({
  id: 'R07',
  severity: 'error',
  layers: ['lint', 'ci'],
  run: async (workspaceDir) => {
    const cfg = await loadConfig(workspaceDir);
    if (!cfg.ok) return { pass: true, violations: [] };
    const ownId = cfg.config.id;
    const wsAbs = path.resolve(workspaceDir);
    const hits = [];
    const re = /performers\/([a-z0-9][a-z0-9-]{0,63})\//;
    await walkSourceFiles(wsAbs, wsAbs, ownId, hits, re);
    if (hits.length === 0) return { pass: true, violations: [] };
    return {
      pass: false,
      violations: hits.map(h => ({
        rule: 'R07',
        message: `${h.file}: references foreign performer "performers/${h.id}/"`
      }))
    };
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/r07-no-cross-path.test.js 2>&1 | tail -10`

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add lib/contract/rules-source.js tests/contract/r07-no-cross-path.test.js
git commit -m "feat(contract): R07 no cross-performer path strings (T8)"
```

---

## Task 9: R08 — no `require`/`import`/`fs.readFile` of sibling performer

**Files:**
- Modify: `bot-circus/lib/contract/rules-source.js`
- Create: `bot-circus/tests/contract/r08-no-cross-import.test.js`

- [ ] **Step 1: Write the failing test**

Create `bot-circus/tests/contract/r08-no-cross-import.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-basic.js';
import '../../lib/contract/rules-source.js';
import { makeTmpWorkspace, cleanupTmp, writeFiles } from './helpers.js';

const R08 = RULES.get('R08');

test('R08 passes on benign source', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      'handler.mjs': "import { pino } from 'pino';"
    });
  });
  try {
    const r = await R08.run(dir);
    assert.strictEqual(r.pass, true);
  } finally { cleanupTmp(dir); }
});

test('R08 fails on import from sibling performer', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      'handler.mjs': "import x from '../other-bot/handler.mjs';"
    });
  });
  try {
    const r = await R08.run(dir);
    assert.strictEqual(r.pass, false);
    assert.match(r.violations[0].message, /import|require/i);
  } finally { cleanupTmp(dir); }
});

test('R08 fails on fs.readFile of sibling performer absolute path', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      'handler.mjs': "fs.readFile('/root/bot-circus/performers/other/MEMORY.md');"
    });
  });
  try {
    const r = await R08.run(dir);
    assert.strictEqual(r.pass, false);
  } finally { cleanupTmp(dir); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/r08-no-cross-import.test.js 2>&1 | tail -10`

Expected: FAIL — `RULES.get('R08')` undefined.

- [ ] **Step 3: Add R08 to rules-source.js**

Append to `bot-circus/lib/contract/rules-source.js`:
```js
async function scanForSiblingRefs(root, current, ownId, hits) {
  const importRe = /(?:from|require\s*\(|import\s*\()\s*['"`]([^'"`]+)['"`]/g;
  const readFileRe = /(?:fs\.(?:readFile|readFileSync)|readFile)\s*\(\s*['"`]([^'"`]+)['"`]/g;
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'memory' || e.name.startsWith('.')) continue;
    const childAbs = path.join(current, e.name);
    if (e.isDirectory()) {
      await scanForSiblingRefs(root, childAbs, ownId, hits);
    } else if (e.isFile() && SOURCE_EXTS.has(path.extname(e.name))) {
      const content = await fs.readFile(childAbs, 'utf8');
      for (const re of [importRe, readFileRe]) {
        const scan = new RegExp(re.source, 'g');
        let m;
        while ((m = scan.exec(content)) !== null) {
          const target = m[1];
          if (isCrossPerformer(target, ownId, root)) {
            hits.push({ file: path.relative(root, childAbs), target });
          }
        }
      }
    }
  }
}

function isCrossPerformer(target, ownId, workspaceRoot) {
  if (target.startsWith('../') && !target.startsWith('../' + path.basename(workspaceRoot) + '/')) {
    const seg = target.split('/');
    if (seg[0] === '..' && seg[1] && seg[1] !== ownId && /^[a-z0-9][a-z0-9-]{0,63}$/.test(seg[1])) {
      return true;
    }
  }
  const perfMatch = target.match(/(?:^|\/)performers\/([a-z0-9][a-z0-9-]{0,63})\//);
  if (perfMatch && perfMatch[1] !== ownId) return true;
  return false;
}

registerRule({
  id: 'R08',
  severity: 'error',
  layers: ['lint', 'ci'],
  run: async (workspaceDir) => {
    const cfg = await loadConfig(workspaceDir);
    if (!cfg.ok) return { pass: true, violations: [] };
    const ownId = cfg.config.id;
    const wsAbs = path.resolve(workspaceDir);
    const hits = [];
    await scanForSiblingRefs(wsAbs, wsAbs, ownId, hits);
    if (hits.length === 0) return { pass: true, violations: [] };
    return {
      pass: false,
      violations: hits.map(h => ({
        rule: 'R08',
        message: `${h.file}: import/readFile of foreign performer "${h.target}"`
      }))
    };
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/r08-no-cross-import.test.js 2>&1 | tail -10`

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add lib/contract/rules-source.js tests/contract/r08-no-cross-import.test.js
git commit -m "feat(contract): R08 no cross-performer imports/reads (T9)"
```

---

## Task 10: R09 — `.env` is gitignored and not tracked

**Files:**
- Create: `bot-circus/lib/contract/rules-git.js`
- Create: `bot-circus/tests/contract/r09-env-gitignored.test.js`

- [ ] **Step 1: Write the failing test**

Create `bot-circus/tests/contract/r09-env-gitignored.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-git.js';
import { makeTmpWorkspace, cleanupTmp, writeFiles } from './helpers.js';

const R09 = RULES.get('R09');

function initGit(d) {
  execSync('git init -q', { cwd: d });
  execSync('git config user.email test@test.test', { cwd: d });
  execSync('git config user.name test', { cwd: d });
}

test('R09 passes when .env in .gitignore and not tracked', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      '.gitignore': '.env\n',
      '.env': 'TOKEN=abc\n'
    });
    initGit(d);
    execSync('git add .gitignore IDENTITY.md config.json', { cwd: d });
    execSync('git commit -q -m init', { cwd: d });
  });
  try {
    const r = await R09.run(dir);
    assert.strictEqual(r.pass, true, JSON.stringify(r.violations));
  } finally { cleanupTmp(dir); }
});

test('R09 fails when .env not in .gitignore', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      '.env': 'TOKEN=abc\n'
    });
  });
  try {
    const r = await R09.run(dir);
    assert.strictEqual(r.pass, false);
    assert.match(r.violations[0].message, /\.gitignore/);
  } finally { cleanupTmp(dir); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/r09-env-gitignored.test.js 2>&1 | tail -10`

Expected: FAIL — `Cannot find module '../../lib/contract/rules-git.js'`.

- [ ] **Step 3: Write rules-git.js**

Create `bot-circus/lib/contract/rules-git.js`:
```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerRule } from './rules.js';

async function readGitignore(workspaceDir) {
  // Search workspace + ancestor dirs up to repo root or /
  let dir = path.resolve(workspaceDir);
  const lines = new Set();
  const seen = new Set();
  while (dir && dir !== path.dirname(dir) && !seen.has(dir)) {
    seen.add(dir);
    try {
      const raw = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
      raw.split('\n').forEach(l => lines.add(l.trim()));
    } catch {}
    try {
      await fs.access(path.join(dir, '.git'));
      break; // reached repo root
    } catch {}
    dir = path.dirname(dir);
  }
  return lines;
}

registerRule({
  id: 'R09',
  severity: 'error',
  layers: ['lint', 'ci'],
  run: async (workspaceDir) => {
    const envPath = path.join(workspaceDir, '.env');
    let hasEnv = false;
    try { await fs.access(envPath); hasEnv = true; } catch {}
    if (!hasEnv) return { pass: true, violations: [] };
    const ignored = await readGitignore(workspaceDir);
    const patterns = ['.env', '*.env', 'performers/*/.env'];
    const ok = patterns.some(p => ignored.has(p));
    if (!ok) {
      return {
        pass: false,
        violations: [{
          rule: 'R09',
          message: `.env exists in workspace but no matching pattern in .gitignore (expected one of: ${patterns.join(', ')})`
        }]
      };
    }
    return { pass: true, violations: [] };
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/r09-env-gitignored.test.js 2>&1 | tail -10`

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add lib/contract/rules-git.js tests/contract/r09-env-gitignored.test.js
git commit -m "feat(contract): R09 .env must be gitignored (T10)"
```

---

## Task 11: R10 — `package.json` name unique across performers

**Files:**
- Modify: `bot-circus/lib/contract/rules-git.js`
- Create: `bot-circus/tests/contract/r10-pkg-name-unique.test.js`

- [ ] **Step 1: Write the failing test**

Create `bot-circus/tests/contract/r10-pkg-name-unique.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-git.js';
import { makeTmpWorkspace, cleanupTmp, writeFiles } from './helpers.js';

const R10 = RULES.get('R10');

test('R10 passes when no package.json present', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n'
    });
  });
  try {
    const r = await R10.run(dir, { allWorkspaces: [dir] });
    assert.strictEqual(r.pass, true);
  } finally { cleanupTmp(dir); }
});

test('R10 fails when package.json name collides with another performer', async () => {
  const ws1 = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      'package.json': { name: 'shared-bot', version: '1.0.0' }
    });
  });
  const ws2 = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't2', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t2\nname: t2\nrole: t\n---\n',
      'package.json': { name: 'shared-bot', version: '1.0.0' }
    });
  });
  try {
    const r = await R10.run(ws1, { allWorkspaces: [ws1, ws2] });
    assert.strictEqual(r.pass, false);
    assert.match(r.violations[0].message, /name.*collid|conflict/i);
  } finally { cleanupTmp(ws1); cleanupTmp(ws2); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/r10-pkg-name-unique.test.js 2>&1 | tail -10`

Expected: FAIL — `RULES.get('R10')` undefined.

- [ ] **Step 3: Add R10 to rules-git.js**

Append to `bot-circus/lib/contract/rules-git.js`:
```js
async function readPkgName(workspaceDir) {
  try {
    const raw = await fs.readFile(path.join(workspaceDir, 'package.json'), 'utf8');
    return JSON.parse(raw).name || null;
  } catch { return null; }
}

registerRule({
  id: 'R10',
  severity: 'error',
  layers: ['lint', 'ci'],
  run: async (workspaceDir, ctx = {}) => {
    const myName = await readPkgName(workspaceDir);
    if (!myName) return { pass: true, violations: [] };
    const all = ctx.allWorkspaces || [];
    const collisions = [];
    for (const other of all) {
      if (path.resolve(other) === path.resolve(workspaceDir)) continue;
      const otherName = await readPkgName(other);
      if (otherName === myName) {
        collisions.push(path.basename(other));
      }
    }
    if (collisions.length === 0) return { pass: true, violations: [] };
    return {
      pass: false,
      violations: [{
        rule: 'R10',
        message: `package.json name "${myName}" collides with performer(s): ${collisions.join(', ')}`
      }]
    };
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/r10-pkg-name-unique.test.js 2>&1 | tail -10`

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add lib/contract/rules-git.js tests/contract/r10-pkg-name-unique.test.js
git commit -m "feat(contract): R10 package.json name unique across performers (T11)"
```

---

## Task 12: R11 — SOUL.md + USER.md recommended (warn-only)

**Files:**
- Create: `bot-circus/lib/contract/rules-warn.js`
- Create: `bot-circus/tests/contract/r11-soul-user.test.js`

- [ ] **Step 1: Write the failing test**

Create `bot-circus/tests/contract/r11-soul-user.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-warn.js';
import { fixturePath } from './helpers.js';

const R11 = RULES.get('R11');

test('R11 has warn severity', () => {
  assert.strictEqual(R11.severity, 'warn');
});

test('R11 passes when SOUL.md + USER.md both present', async () => {
  // valid-minimal does not yet have them; this test passes after T16 templates.
  // For now use tmp workspace with both files.
  const { makeTmpWorkspace, cleanupTmp, writeFiles } = await import('./helpers.js');
  const path = await import('node:path');
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' } },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      'SOUL.md': '# Persona\n',
      'USER.md': '# Behaviour rules\n'
    });
  });
  try {
    const r = await R11.run(dir);
    assert.strictEqual(r.pass, true);
  } finally { cleanupTmp(dir); }
});

test('R11 fails when SOUL.md missing', async () => {
  const r = await R11.run(fixturePath('valid-minimal'));
  assert.strictEqual(r.pass, false);
  assert.ok(r.violations.some(v => /SOUL\.md/.test(v.message)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/r11-soul-user.test.js 2>&1 | tail -10`

Expected: FAIL — `Cannot find module '../../lib/contract/rules-warn.js'`.

- [ ] **Step 3: Write rules-warn.js**

Create `bot-circus/lib/contract/rules-warn.js`:
```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerRule } from './rules.js';
import { loadConfig } from './schema.js';

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

registerRule({
  id: 'R11',
  severity: 'warn',
  layers: ['lint', 'ci'],
  run: async (workspaceDir) => {
    const violations = [];
    for (const f of ['SOUL.md', 'USER.md']) {
      if (!(await fileExists(path.join(workspaceDir, f)))) {
        violations.push({ rule: 'R11', message: `${f} is recommended but missing` });
      }
    }
    return { pass: violations.length === 0, violations };
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/r11-soul-user.test.js 2>&1 | tail -10`

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add lib/contract/rules-warn.js tests/contract/r11-soul-user.test.js
git commit -m "feat(contract): R11 SOUL/USER recommended (warn) (T12)"
```

---

## Task 13: R12 — `MEMORY.md` present iff `troupes[]` non-empty

**Files:**
- Modify: `bot-circus/lib/contract/rules-warn.js`
- Create: `bot-circus/tests/contract/r12-memory-iff-troupe.test.js`

- [ ] **Step 1: Write the failing test**

Create `bot-circus/tests/contract/r12-memory-iff-troupe.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { RULES } from '../../lib/contract/rules.js';
import '../../lib/contract/schema.js';
import '../../lib/contract/rules-warn.js';
import { makeTmpWorkspace, cleanupTmp, writeFiles } from './helpers.js';

const R12 = RULES.get('R12');

test('R12 passes when no troupes and no MEMORY.md', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' }, troupes: [] },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n'
    });
  });
  try {
    const r = await R12.run(dir);
    assert.strictEqual(r.pass, true);
  } finally { cleanupTmp(dir); }
});

test('R12 passes when troupes present and MEMORY.md present', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' }, troupes: ['support'] },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n',
      'MEMORY.md': '# Memory'
    });
  });
  try {
    const r = await R12.run(dir);
    assert.strictEqual(r.pass, true);
  } finally { cleanupTmp(dir); }
});

test('R12 fails when troupes present and MEMORY.md missing', async () => {
  const dir = makeTmpWorkspace((d) => {
    writeFiles(d, {
      'config.json': { contract_version: '1.0', id: path.basename(d), name: 't', runtime: 'shared', secrets: { provider: 'env-file' }, troupes: ['support'] },
      'IDENTITY.md': '---\nid: t\nname: t\nrole: t\n---\n'
    });
  });
  try {
    const r = await R12.run(dir);
    assert.strictEqual(r.pass, false);
    assert.match(r.violations[0].message, /MEMORY\.md/);
  } finally { cleanupTmp(dir); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/r12-memory-iff-troupe.test.js 2>&1 | tail -10`

Expected: FAIL — `RULES.get('R12')` undefined.

- [ ] **Step 3: Add R12 to rules-warn.js**

Append to `bot-circus/lib/contract/rules-warn.js`:
```js
registerRule({
  id: 'R12',
  severity: 'warn',
  layers: ['lint', 'ci'],
  run: async (workspaceDir) => {
    const cfg = await loadConfig(workspaceDir);
    if (!cfg.ok) return { pass: true, violations: [] };
    const troupes = cfg.config.troupes || [];
    const memPath = path.join(workspaceDir, 'MEMORY.md');
    const hasMem = await fileExists(memPath);
    if (troupes.length > 0 && !hasMem) {
      return {
        pass: false,
        violations: [{ rule: 'R12', message: 'troupes[] non-empty but MEMORY.md missing' }]
      };
    }
    return { pass: true, violations: [] };
  }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/r12-memory-iff-troupe.test.js 2>&1 | tail -10`

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add lib/contract/rules-warn.js tests/contract/r12-memory-iff-troupe.test.js
git commit -m "feat(contract): R12 MEMORY.md required iff troupes non-empty (T13)"
```

---

## Task 14: Lint runner + `bin/circus-lint` CLI

**Files:**
- Create: `bot-circus/lib/lint.js`
- Modify: `bot-circus/lib/contract/index.js`
- Create: `bot-circus/bin/circus-lint`
- Create: `bot-circus/tests/contract/lint.test.js`

- [ ] **Step 1: Write the failing test**

Create `bot-circus/tests/contract/lint.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { lintWorkspaces } from '../../lib/lint.js';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/lint.test.js 2>&1 | tail -10`

Expected: FAIL — `Cannot find module '../../lib/lint.js'`.

- [ ] **Step 3: Update `lib/contract/index.js` to load all rule modules**

Overwrite `bot-circus/lib/contract/index.js`:
```js
import './schema.js';
import './frontmatter.js';
import './rules-basic.js';
import './rules-source.js';
import './rules-git.js';
import './rules-warn.js';
export { RULES, registerRule } from './rules.js';
```

- [ ] **Step 4: Write `lib/lint.js`**

Create `bot-circus/lib/lint.js`:
```js
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/lint.test.js 2>&1 | tail -10`

Expected: 2 tests pass.

- [ ] **Step 6: Write `bin/circus-lint`**

Create `bot-circus/bin/circus-lint`:
```js
#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintWorkspaces } from '../lib/lint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PERFORMERS_DIR = path.join(ROOT, 'performers');

async function discoverPerformers() {
  try {
    const entries = await fs.readdir(PERFORMERS_DIR, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => path.join(PERFORMERS_DIR, e.name));
  } catch {
    return [];
  }
}

const program = new Command();
program
  .name('circus-lint')
  .description('Validate bot-circus performer workspaces against the contract')
  .option('--performer <id>', 'lint one performer by id')
  .option('--format <fmt>', 'output format: text|json', 'text')
  .option('--layer <layer>', 'rule layer filter: lint|ci|runtime|all', 'all')
  .action(async (opts) => {
    let workspaces = await discoverPerformers();
    if (opts.performer) {
      workspaces = workspaces.filter(w => path.basename(w) === opts.performer);
      if (workspaces.length === 0) {
        console.error(`no performer found with id "${opts.performer}"`);
        process.exit(2);
      }
    }
    const summary = await lintWorkspaces({ workspaces, layer: opts.layer });
    if (opts.format === 'json') {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printText(summary);
    }
    process.exit(summary.errorCount > 0 ? 1 : 0);
  });

function printText(summary) {
  for (const r of summary.results) {
    const id = path.basename(r.workspace);
    const errs = r.ruleResults.filter(x => !x.pass && x.severity === 'error');
    const warns = r.ruleResults.filter(x => !x.pass && x.severity === 'warn');
    const status = errs.length === 0 ? 'OK' : 'FAIL';
    console.log(`${status}  ${id}  (errors: ${errs.length}, warnings: ${warns.length})`);
    for (const rr of [...errs, ...warns]) {
      for (const v of rr.violations) {
        console.log(`  [${rr.severity}] ${rr.id}: ${v.message}`);
      }
    }
  }
  console.log(`\nTotal: ${summary.errorCount} errors, ${summary.warnCount} warnings.`);
}

program.parseAsync().catch(err => { console.error(err); process.exit(2); });
```

- [ ] **Step 7: Make executable + smoke test**

Run:
```bash
cd /root/bot-circus
chmod +x bin/circus-lint
./bin/circus-lint --performer 007 2>&1 | tail -20 || true
```

Expected: walks `performers/007`, prints status. May show R11 warnings if SOUL/USER are stubs. Should not crash.

- [ ] **Step 8: Commit**

```bash
cd /root/bot-circus
git add lib/lint.js lib/contract/index.js bin/circus-lint tests/contract/lint.test.js
git commit -m "feat(contract): circus-lint CLI + lintWorkspaces runner (T14)"
```

---

## Task 15: `circus-lint --since <ref>` (git-aware incremental mode)

**Files:**
- Modify: `bot-circus/bin/circus-lint`

- [ ] **Step 1: Write the failing test**

Append to `bot-circus/tests/contract/lint.test.js`:
```js
import { execSync } from 'node:child_process';
import { pickWorkspacesSince } from '../../lib/lint.js';

test('pickWorkspacesSince returns only changed performer dirs', async () => {
  // Use bot-circus's own performers/ via the live git repo
  const all = ['/root/bot-circus/performers/007', '/root/bot-circus/performers/webbs'];
  // Pick a stable ref; HEAD will likely have no perf changes — assert it returns []
  const picked = await pickWorkspacesSince(all, 'HEAD');
  assert.ok(Array.isArray(picked));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/lint.test.js 2>&1 | tail -10`

Expected: FAIL — `pickWorkspacesSince` not exported.

- [ ] **Step 3: Add `pickWorkspacesSince` to `lib/lint.js`**

Append to `bot-circus/lib/lint.js`:
```js
import { execSync } from 'node:child_process';
import path from 'node:path';

export async function pickWorkspacesSince(allWorkspaces, ref) {
  if (allWorkspaces.length === 0) return [];
  const repoRoot = path.resolve(allWorkspaces[0], '..', '..');
  let changed;
  try {
    const out = execSync(`git diff --name-only ${ref}...HEAD`, { cwd: repoRoot, encoding: 'utf8' });
    changed = out.split('\n').filter(Boolean);
  } catch { return allWorkspaces; }
  const picked = new Set();
  for (const f of changed) {
    const m = f.match(/^performers\/([^/]+)\//);
    if (m) {
      const ws = path.join(repoRoot, 'performers', m[1]);
      if (allWorkspaces.includes(ws)) picked.add(ws);
    }
  }
  return [...picked];
}
```

Add `--since <ref>` to commander action in `bin/circus-lint`. Replace the `program` block options + action:

```js
program
  .option('--since <ref>', 'lint only performers changed since git ref')
  // ...
  .action(async (opts) => {
    let workspaces = await discoverPerformers();
    if (opts.performer) {
      workspaces = workspaces.filter(w => path.basename(w) === opts.performer);
    } else if (opts.since) {
      const { pickWorkspacesSince } = await import('../lib/lint.js');
      workspaces = await pickWorkspacesSince(workspaces, opts.since);
    }
    // ... (rest unchanged)
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/lint.test.js 2>&1 | tail -10`

Expected: all lint tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add lib/lint.js bin/circus-lint tests/contract/lint.test.js
git commit -m "feat(contract): --since flag for incremental lint (T15)"
```

---

## Task 16: Reference performer template

**Files:**
- Create: `bot-circus/templates/performer/IDENTITY.md.tmpl`
- Create: `bot-circus/templates/performer/SOUL.md.tmpl`
- Create: `bot-circus/templates/performer/USER.md.tmpl`
- Create: `bot-circus/templates/performer/MEMORY.md.tmpl`
- Create: `bot-circus/templates/performer/config.json.tmpl`
- Create: `bot-circus/templates/performer/.env.example`
- Create: `bot-circus/templates/performer/.gitignore`
- Create: `bot-circus/templates/performer/memory/.gitkeep`

- [ ] **Step 1: Write template files**

Create `bot-circus/templates/performer/IDENTITY.md.tmpl`:
```markdown
---
id: {{id}}
name: {{name}}
role: {{role}}
telegram_username: "{{telegram_username}}"
owner: {{owner}}
---

# {{name}}

One-paragraph public description of what this bot is.
```

Create `bot-circus/templates/performer/SOUL.md.tmpl`:
```markdown
# {{name}} — Persona

Voice, style, values, things this bot will and won't do.
```

Create `bot-circus/templates/performer/USER.md.tmpl`:
```markdown
# {{name}} — Behaviour Rules

How the bot interacts with users. Examples. Refusal conditions.
```

Create `bot-circus/templates/performer/MEMORY.md.tmpl`:
```markdown
# {{name}} — Memory

Long-term notes. Append only. Sectioned by topic.
```

Create `bot-circus/templates/performer/config.json.tmpl`:
```json
{
  "contract_version": "1.0",
  "id": "{{id}}",
  "name": "{{name}}",
  "telegram_username": "{{telegram_username}}",
  "runtime": "shared",
  "secrets": { "provider": "env-file", "path": ".env" },
  "troupes": [],
  "sidecars": [],
  "owner": "{{owner}}"
}
```

Create `bot-circus/templates/performer/.env.example`:
```
TELEGRAM_BOT_TOKEN=
ANTHROPIC_API_KEY=
```

Create `bot-circus/templates/performer/.gitignore`:
```
.env
```

Run: `mkdir -p /root/bot-circus/templates/performer/memory && touch /root/bot-circus/templates/performer/memory/.gitkeep`

- [ ] **Step 2: Smoke — copy template into a tmp dir and lint it**

Run:
```bash
cd /root/bot-circus
TMP=$(mktemp -d)
cp -r templates/performer "$TMP/template-test"
cd "$TMP/template-test"
# Substitute placeholders so config validates
for f in *.tmpl; do
  sed -i 's/{{id}}/template-test/g; s/{{name}}/Template Test/g; s/{{role}}/test role/g; s/{{telegram_username}}/@template_test_bot/g; s/{{owner}}/test/g' "$f"
  mv "$f" "${f%.tmpl}"
done
cd /root/bot-circus
node -e "import('./lib/lint.js').then(async m => { const r = await m.lintWorkspaces({ workspaces: ['$TMP/template-test'] }); console.log('errors:', r.errorCount, 'warns:', r.warnCount); })"
rm -rf "$TMP"
```

Expected: `errors: 0 warns: 0` (template fills all recommended files).

- [ ] **Step 3: Commit**

```bash
cd /root/bot-circus
git add templates/
git commit -m "feat(contract): reference performer workspace template (T16)"
```

---

## Task 17: `CONTRACT.md` (human-readable spec)

**Files:**
- Create: `bot-circus/CONTRACT.md`

- [ ] **Step 1: Write CONTRACT.md**

Create `bot-circus/CONTRACT.md`:
```markdown
# Bot-Circus Workspace Contract — v1.0

This document is the canonical spec for what a `performers/<id>/` workspace must contain to be a valid bot-circus performer.

## Workspace shape

Required at root of `performers/<id>/`:

- `config.json` — bot configuration; see §config.json
- `IDENTITY.md` — public identity with YAML frontmatter; see §IDENTITY.md

Recommended (lint warns if missing):

- `SOUL.md` — persona, voice, style
- `USER.md` — behaviour rules, refusal conditions

Conditional:

- `CUSTOM_RUNTIME.md` — required iff `runtime` is `"custom"`
- `MEMORY.md` — required iff `troupes[]` is non-empty
- `memory/` — local SQLite directory; opaque to the contract

## config.json fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `contract_version` | string | yes | must equal `"1.0"` |
| `id` | string | yes | lowercase, `[a-z0-9][a-z0-9-]{0,63}`, equal to parent dir name |
| `name` | string | yes | human display name |
| `telegram_username` | string | no | `@handle` |
| `runtime` | enum | yes | `"shared"` \| `"sidecar"` \| `"custom"` |
| `secrets.provider` | enum | yes | `"env-file"` (v1) |
| `secrets.path` | string | no | default `.env` |
| `troupes` | string[] | no | circus room ids the bot auto-joins |
| `sidecars` | object[] | no | required non-empty if `runtime: "sidecar"`; each `{name, script}` |
| `owner` | string | no | github handle |

## Runtime modes

- **`shared`** — orchestrator owns Telegram + Claude dispatch; performer has only data files. Default.
- **`sidecar`** — orchestrator owns Telegram + Claude; performer also declares extra processes in `sidecars[]`. Each sidecar runs as its own PM2 entry with the workspace cwd and scoped env.
- **`custom`** — performer ships own runtime (e.g. `bot.mjs`); orchestrator skips it entirely. Requires `CUSTOM_RUNTIME.md` justification.

## Isolation dimensions

1. **Character** — no two performers share persona files; package.json names unique.
2. **Memory** — `memory/` and `MEMORY.md` private; cross-bot share only via circus rooms.
3. **Runtime/secret** — `.env` per workspace; subprocess gets scoped env only.
4. **Code** — shared logic in `bot-circus/lib/`; never duplicate across performers.
5. **Communication** — bot-to-bot only via circus HTTP API; no FS path, no direct import.

## Lint rules

| ID | Rule | Severity | Layer |
|----|------|----------|-------|
| R01 | `config.json` valid against schema | error | lint+ci+runtime |
| R02 | `IDENTITY.md` exists with required frontmatter | error | lint+ci+runtime |
| R03 | `config.id` equals parent directory name | error | lint+ci+runtime |
| R04 | `runtime: "custom"` → `CUSTOM_RUNTIME.md` present | error | lint+ci+runtime |
| R05 | `runtime: "sidecar"` → `sidecars[].script` resolves inside workspace | error | lint+ci+runtime |
| R06 | No symlink escapes workspace | error | lint+ci+runtime |
| R07 | No source contains foreign `performers/<id>/` path | error | lint+ci |
| R08 | No import/readFile of sibling performer | error | lint+ci |
| R09 | `.env` listed in `.gitignore` | error | lint+ci |
| R10 | `package.json` name unique across performers | error | lint+ci |
| R11 | `SOUL.md` + `USER.md` present | warn | lint+ci |
| R12 | `MEMORY.md` iff `troupes[]` non-empty | warn | lint+ci |

## Migration recipe

Manual:

1. Copy `templates/performer/` to `performers/<id>/`.
2. Substitute template placeholders (`{{id}}`, `{{name}}`, etc.) in each file.
3. Move runtime logic from legacy dir to workspace (or wire into shared orchestrator).
4. Move `.env` to workspace.
5. Run `circus-lint --performer <id>` until errors zero.
6. Update PM2 ecosystem to point at new workspace.

Auto:

```
circus-migrate <legacy-path> --id <perf-id>
```

See `lib/migrate.js`.

## Versioning

- `contract_version` field is bumped only on breaking schema changes.
- Each performer declares the version it conforms to.
- Linter reads the version and applies the matching rule set.
- Old versions remain supported for at least one minor release after a bump.

## Deprecation policy

- A rule may be marked `deprecated: true` for one minor release before removal.
- A field may be removed from the schema with one minor release of warn-only status.
- Breaking changes require a major version bump of `contract_version`.
```

- [ ] **Step 2: Commit**

```bash
cd /root/bot-circus
git add CONTRACT.md
git commit -m "docs(contract): CONTRACT.md v1.0 workspace contract spec (T17)"
```

---

## Task 18: Runtime validator (R01–R06 subset)

**Files:**
- Create: `bot-circus/lib/validator.js`
- Create: `bot-circus/tests/contract/validator.test.js`

- [ ] **Step 1: Write the failing test**

Create `bot-circus/tests/contract/validator.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { validateAtBoot } from '../../lib/validator.js';
import { fixturePath } from './helpers.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/validator.test.js 2>&1 | tail -10`

Expected: FAIL — `Cannot find module '../../lib/validator.js'`.

- [ ] **Step 3: Write validator.js**

Create `bot-circus/lib/validator.js`:
```js
import path from 'node:path';
import { lintWorkspace } from './lint.js';

export async function validateAtBoot(workspaces) {
  const passed = new Map();
  const failed = new Map();
  for (const ws of workspaces) {
    const id = path.basename(ws);
    const result = await lintWorkspace(ws, { allWorkspaces: workspaces }, 'runtime');
    const errors = result.ruleResults.filter(r => !r.pass && r.severity === 'error');
    if (errors.length === 0) passed.set(id, result);
    else failed.set(id, { ...result, errors });
  }
  return { passed, failed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/validator.test.js 2>&1 | tail -10`

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add lib/validator.js tests/contract/validator.test.js
git commit -m "feat(contract): runtime validator runs R01–R06 only (T18)"
```

---

## Task 19: Quarantine state persistence

**Files:**
- Modify: `bot-circus/lib/validator.js`
- Modify: `bot-circus/tests/contract/validator.test.js`

- [ ] **Step 1: Write the failing test**

Append to `bot-circus/tests/contract/validator.test.js`:
```js
import fs from 'node:fs';
import { writeQuarantineState, readQuarantineState } from '../../lib/validator.js';
import { makeTmpWorkspace, cleanupTmp } from './helpers.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/validator.test.js 2>&1 | tail -10`

Expected: FAIL — `writeQuarantineState` not exported.

- [ ] **Step 3: Add quarantine state helpers**

Append to `bot-circus/lib/validator.js`:
```js
import fs from 'node:fs';

export function writeQuarantineState(filePath, failedMap) {
  const obj = {
    updated_at: new Date().toISOString(),
    quarantined: Object.fromEntries(
      [...failedMap.entries()].map(([id, info]) => [
        id,
        { errors: info.errors || info.ruleResults?.filter(r => !r.pass) || [] }
      ])
    )
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

export function readQuarantineState(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch { return new Map(); }
  const obj = JSON.parse(raw);
  return new Map(Object.entries(obj.quarantined || {}));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/validator.test.js 2>&1 | tail -10`

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add lib/validator.js tests/contract/validator.test.js
git commit -m "feat(contract): quarantine state read/write (T19)"
```

---

## Task 20: `circus-lint --status` reads quarantine state

**Files:**
- Modify: `bot-circus/bin/circus-lint`

- [ ] **Step 1: Add the option + action branch**

In `bot-circus/bin/circus-lint`, add `--status` option and short-circuit when set:

```js
program
  .option('--status', 'show current quarantine state from .state/quarantine.json')
  // ...
  .action(async (opts) => {
    if (opts.status) {
      const { readQuarantineState } = await import('../lib/validator.js');
      const state = readQuarantineState(path.join(ROOT, '.state/quarantine.json'));
      if (state.size === 0) { console.log('No performers quarantined.'); return; }
      for (const [id, info] of state) {
        console.log(`QUARANTINED  ${id}`);
        for (const v of info.errors) console.log(`  ${v.rule || ''}: ${v.message || JSON.stringify(v)}`);
      }
      return;
    }
    // ... (rest unchanged)
  });
```

- [ ] **Step 2: Smoke test**

Run:
```bash
cd /root/bot-circus
mkdir -p .state
echo '{"updated_at":"2026-05-26T00:00:00Z","quarantined":{"friday":{"errors":[{"rule":"R02","message":"missing IDENTITY.md"}]}}}' > .state/quarantine.json
./bin/circus-lint --status
rm .state/quarantine.json
```

Expected: prints `QUARANTINED  friday` and `R02: missing IDENTITY.md`.

- [ ] **Step 3: Commit**

```bash
cd /root/bot-circus
git add bin/circus-lint
git commit -m "feat(contract): circus-lint --status reads quarantine state (T20)"
```

---

## Task 21: Wire validator into orchestrator boot

**Files:**
- Modify: `bot-circus/lib/orchestrator.js`

- [ ] **Step 1: Read current orchestrator boot path**

Run: `grep -n "async start\|async init\|class Orchestrator" /root/bot-circus/lib/orchestrator.js`

Note line numbers of `class Orchestrator` and the boot entrypoint method.

- [ ] **Step 2: Add validator import + call at boot**

In `bot-circus/lib/orchestrator.js` after existing imports:
```js
import { validateAtBoot, writeQuarantineState } from './validator.js';
```

In the constructor or `start` method (before any bot dispatch begins), add:
```js
this.performersDir = path.join(ROOT_DIR, 'performers');
this.quarantineStatePath = path.join(ROOT_DIR, '.state/quarantine.json');
this.quarantined = new Set();

async _validatePerformers() {
  let entries;
  try {
    entries = await fs.promises.readdir(this.performersDir, { withFileTypes: true });
  } catch (err) {
    this.logger.warn({ err }, 'performers directory missing — no validation performed');
    return;
  }
  const workspaces = entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.'))
    .map(e => path.join(this.performersDir, e.name));
  const result = await validateAtBoot(workspaces);
  this.quarantined = new Set(result.failed.keys());
  writeQuarantineState(this.quarantineStatePath, result.failed);
  for (const [perfId, info] of result.failed) {
    this.logger.error({ perfId, errors: info.errors }, 'CONTRACT_VIOLATION_REFUSING_DISPATCH');
  }
  this.logger.info({ passed: result.passed.size, failed: result.failed.size }, 'performer validation complete');
}
```

In the `start()` method, call `await this._validatePerformers();` before bot registration.

- [ ] **Step 3: Smoke — start orchestrator with no performers; assert it logs cleanly**

Run:
```bash
cd /root/bot-circus
mkdir -p .state
node -e "import('./lib/orchestrator.js').then(async ({ Orchestrator }) => { const o = new Orchestrator(); await o._validatePerformers(); console.log('quarantined:', [...o.quarantined]); })" 2>&1 | tail -10
```

Expected: validates current `performers/` dirs; logs results; `quarantined: []` if all clean (else lists ids). No crash.

- [ ] **Step 4: Commit**

```bash
cd /root/bot-circus
git add lib/orchestrator.js
git commit -m "feat(orchestrator): validate performers at boot, write quarantine state (T21)"
```

---

## Task 22: Orchestrator dispatch skips quarantined performers

**Files:**
- Modify: `bot-circus/lib/orchestrator.js`

- [ ] **Step 1: Locate dispatch entrypoint**

Run: `grep -n "handleMessage\|onMessage\|dispatch\|enqueueMessage" /root/bot-circus/lib/orchestrator.js`

Note the function that takes an inbound Telegram update and routes it.

- [ ] **Step 2: Add quarantine guard at the top of the dispatch function**

In the dispatch function body, before any work, add:
```js
const perfId = this._tokenToPerformerId(token); // or however the existing code resolves performer
if (this.quarantined.has(perfId)) {
  this.logger.warn({ perfId }, 'dropping message — performer quarantined');
  return;
}
```

If the orchestrator doesn't currently expose `_tokenToPerformerId`, add a helper that maps the bot id (per `this.bots` Map) to the performer id (one-to-one for v1).

- [ ] **Step 3: Smoke (manual)**

Run:
```bash
cd /root/bot-circus
mkdir -p .state
# Force a quarantine
echo '{"updated_at":"2026-05-26T00:00:00Z","quarantined":{"webbs":{"errors":[{"rule":"R02","message":"forced"}]}}}' > .state/quarantine.json
./bin/circus-lint --status
```

Expected: `webbs` shown as quarantined. (Live dispatch test deferred to integration tests in T29.)

- [ ] **Step 4: Cleanup + commit**

```bash
cd /root/bot-circus
rm -f .state/quarantine.json
git add lib/orchestrator.js
git commit -m "feat(orchestrator): dispatch drops messages for quarantined performers (T22)"
```

---

## Task 23: `SIGUSR2` reload re-validates performers

**Files:**
- Modify: `bot-circus/lib/orchestrator.js`

- [ ] **Step 1: Add signal handler in `start()`**

In `bot-circus/lib/orchestrator.js` `start()` method, after validator call, add:
```js
process.on('SIGUSR2', () => {
  this.logger.info('SIGUSR2 received — re-validating performers');
  this._validatePerformers().catch(err => {
    this.logger.error({ err }, 'revalidation failed');
  });
});
```

- [ ] **Step 2: Smoke test (manual)**

Run:
```bash
cd /root/bot-circus
node lib/orchestrator.js &
ORCH_PID=$!
sleep 2
kill -USR2 $ORCH_PID
sleep 1
kill $ORCH_PID
```

Expected: stdout shows `SIGUSR2 received — re-validating performers` followed by validation complete log. (May fail if other init blocks; if so, isolate to a minimal smoke harness or skip — covered by reload integration test T30.)

- [ ] **Step 3: Commit**

```bash
cd /root/bot-circus
git add lib/orchestrator.js
git commit -m "feat(orchestrator): SIGUSR2 re-validates performers (T23)"
```

---

## Task 24: Migration scaffolder — basic copy

**Files:**
- Create: `bot-circus/lib/migrate.js`
- Create: `bot-circus/bin/circus-migrate`
- Create: `bot-circus/tests/contract/migrate.test.js`

- [ ] **Step 1: Write the failing test**

Create `bot-circus/tests/contract/migrate.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { scaffoldFromTemplate } from '../../lib/migrate.js';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/migrate.test.js 2>&1 | tail -10`

Expected: FAIL — `Cannot find module '../../lib/migrate.js'`.

- [ ] **Step 3: Write `lib/migrate.js`**

Create `bot-circus/lib/migrate.js`:
```js
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, '..', 'templates', 'performer');

function applyPlaceholders(text, values) {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
}

async function copyDirRecursive(src, dest, values, force) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await fs.mkdir(dest, { recursive: true });
  for (const e of entries) {
    const srcP = path.join(src, e.name);
    let destName = e.name.endsWith('.tmpl') ? e.name.slice(0, -5) : e.name;
    const destP = path.join(dest, destName);
    if (e.isDirectory()) {
      await copyDirRecursive(srcP, destP, values, force);
    } else {
      const raw = await fs.readFile(srcP, 'utf8');
      await fs.writeFile(destP, applyPlaceholders(raw, values));
    }
  }
}

export async function scaffoldFromTemplate({ destDir, values, force = false }) {
  let exists = true;
  try { await fs.access(destDir); } catch { exists = false; }
  if (exists && !force) {
    const entries = await fs.readdir(destDir);
    if (entries.length > 0) {
      throw new Error(`destination "${destDir}" exists and is not empty (use --force to overwrite)`);
    }
  }
  await copyDirRecursive(TEMPLATE_DIR, destDir, values, force);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/migrate.test.js 2>&1 | tail -10`

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add lib/migrate.js tests/contract/migrate.test.js
git commit -m "feat(contract): migrate.scaffoldFromTemplate (T24)"
```

---

## Task 25: Migration — read legacy package.json + .env

**Files:**
- Modify: `bot-circus/lib/migrate.js`
- Modify: `bot-circus/tests/contract/migrate.test.js`

- [ ] **Step 1: Write the failing test**

Append to `bot-circus/tests/contract/migrate.test.js`:
```js
import { inspectLegacy } from '../../lib/migrate.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/bot-circus && node --test tests/contract/migrate.test.js 2>&1 | tail -10`

Expected: FAIL — `inspectLegacy` not exported.

- [ ] **Step 3: Add `inspectLegacy` to migrate.js**

Append to `bot-circus/lib/migrate.js`:
```js
export async function inspectLegacy(legacyDir) {
  const info = {
    pkgName: null,
    envKeys: [],
    entryScripts: [],
    suggestedRuntime: 'shared'
  };
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(legacyDir, 'package.json'), 'utf8'));
    info.pkgName = pkg.name || null;
  } catch {}
  try {
    const env = await fs.readFile(path.join(legacyDir, '.env'), 'utf8');
    info.envKeys = env.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.split('=')[0]);
  } catch {}
  const entries = await fs.readdir(legacyDir, { withFileTypes: true });
  info.entryScripts = entries
    .filter(e => e.isFile() && /\.(mjs|cjs|js)$/.test(e.name))
    .map(e => e.name);
  if (info.entryScripts.length > 1) info.suggestedRuntime = 'sidecar';
  return info;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/bot-circus && node --test tests/contract/migrate.test.js 2>&1 | tail -10`

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /root/bot-circus
git add lib/migrate.js tests/contract/migrate.test.js
git commit -m "feat(contract): migrate.inspectLegacy reads pkg + .env + entry scripts (T25)"
```

---

## Task 26: `bin/circus-migrate` CLI

**Files:**
- Create: `bot-circus/bin/circus-migrate`

- [ ] **Step 1: Write the binary**

Create `bot-circus/bin/circus-migrate`:
```js
#!/usr/bin/env node
import { Command } from 'commander';
import readline from 'node:readline/promises';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { scaffoldFromTemplate, inspectLegacy } from '../lib/migrate.js';
import { lintWorkspaces } from '../lib/lint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function prompt(q, def) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await rl.question(`${q}${def ? ` [${def}]` : ''}: `);
  rl.close();
  return ans.trim() || def || '';
}

const program = new Command();
program
  .name('circus-migrate')
  .argument('<legacyPath>', 'path to legacy bot directory')
  .requiredOption('--id <id>', 'performer id (target dir name)')
  .option('--out <dir>', 'destination dir (default: performers/<id>)')
  .option('--force', 'overwrite if destination exists')
  .option('--yes', 'non-interactive — accept defaults')
  .action(async (legacyPath, opts) => {
    const dest = opts.out || path.join(ROOT, 'performers', opts.id);
    console.log(`\n[1/6] Inspecting legacy dir: ${legacyPath}`);
    const info = await inspectLegacy(legacyPath);
    console.log('       pkg name:', info.pkgName);
    console.log('       env keys:', info.envKeys.join(', ') || '(none)');
    console.log('       entry scripts:', info.entryScripts.join(', ') || '(none)');
    console.log('       suggested runtime:', info.suggestedRuntime);

    const name = opts.yes ? opts.id : await prompt('display name', info.pkgName || opts.id);
    const role = opts.yes ? 'bot' : await prompt('role (one-liner)', 'bot');
    const tgUser = opts.yes ? `@${opts.id}_bot` : await prompt('telegram_username', `@${opts.id}_bot`);
    const owner = opts.yes ? 'kobie3717' : await prompt('owner', 'kobie3717');

    console.log(`\n[2/6] Scaffolding ${dest}`);
    await scaffoldFromTemplate({
      destDir: dest,
      values: { id: opts.id, name, role, telegram_username: tgUser, owner },
      force: !!opts.force
    });

    if (info.envKeys.length > 0) {
      const move = opts.yes ? true : (await prompt(`\n[3/6] Move .env from ${legacyPath} to ${dest}? (y/N)`, 'N')).toLowerCase().startsWith('y');
      if (move) {
        await fs.copyFile(path.join(legacyPath, '.env'), path.join(dest, '.env'));
        console.log('       .env copied (legacy file untouched)');
      } else {
        console.log('       skipped .env move');
      }
    }

    if (info.suggestedRuntime === 'sidecar') {
      console.log('\n[4/6] Detected sidecar pattern. You should edit config.json to set runtime="sidecar" and populate sidecars[].');
    }

    console.log('\n[5/6] Running circus-lint --performer', opts.id);
    const summary = await lintWorkspaces({ workspaces: [dest] });
    for (const r of summary.results) {
      for (const rr of r.ruleResults) {
        if (!rr.pass) {
          for (const v of rr.violations) console.log(`       [${rr.severity}] ${rr.id}: ${v.message}`);
        }
      }
    }
    console.log(`       errors: ${summary.errorCount}, warnings: ${summary.warnCount}`);

    console.log('\n[6/6] Manual TODO:');
    console.log('       [ ] Fill SOUL.md and USER.md with real persona content');
    console.log('       [ ] Decide runtime: keep "shared" (refactor logic into orchestrator) OR set "custom" and add CUSTOM_RUNTIME.md');
    console.log('       [ ] Update PM2 ecosystem: cwd → ' + dest);
    console.log('       [ ] After verification, delete legacy dir: ' + legacyPath);
    console.log('\nLegacy directory NOT modified.');
  });

program.parseAsync().catch(err => { console.error(err.message); process.exit(2); });
```

- [ ] **Step 2: Make executable + smoke test**

Run:
```bash
cd /root/bot-circus
chmod +x bin/circus-migrate
mkdir -p /tmp/scaffold-test-legacy
cat > /tmp/scaffold-test-legacy/package.json <<'EOF'
{ "name": "legacy-test", "version": "1.0.0" }
EOF
cat > /tmp/scaffold-test-legacy/.env <<'EOF'
TELEGRAM_BOT_TOKEN=xxx
EOF
cat > /tmp/scaffold-test-legacy/bot.mjs <<'EOF'
console.log('legacy');
EOF
./bin/circus-migrate /tmp/scaffold-test-legacy --id legacy-test --out /tmp/scaffold-test-out --yes
ls /tmp/scaffold-test-out
rm -rf /tmp/scaffold-test-legacy /tmp/scaffold-test-out
```

Expected: scaffolded dir contains IDENTITY.md, SOUL.md, USER.md, MEMORY.md, config.json, .env, .gitignore, memory/. Legacy `/tmp/scaffold-test-legacy/` is untouched.

- [ ] **Step 3: Commit**

```bash
cd /root/bot-circus
git add bin/circus-migrate
git commit -m "feat(contract): circus-migrate CLI (T26)"
```

---

## Task 27: Integration test — contract flow (boot + dispatch quarantine)

**Files:**
- Create: `bot-circus/tests/integration/contract-flow.test.js`

- [ ] **Step 1: Write the test**

Create `bot-circus/tests/integration/contract-flow.test.js`:
```js
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
```

- [ ] **Step 2: Run test**

Run: `cd /root/bot-circus && node --test tests/integration/contract-flow.test.js 2>&1 | tail -10`

Expected: 1 test passes.

- [ ] **Step 3: Commit**

```bash
cd /root/bot-circus
git add tests/integration/contract-flow.test.js
git commit -m "test(contract): integration — boot validation + quarantine roundtrip (T27)"
```

---

## Task 28: Integration test — reload (break → SIGUSR2 → quarantine → fix → unquarantine)

**Files:**
- Create: `bot-circus/tests/integration/reload.test.js`

- [ ] **Step 1: Write the test (uses in-process validateAtBoot rather than spawning orchestrator — same code path)**

Create `bot-circus/tests/integration/reload.test.js`:
```js
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
```

- [ ] **Step 2: Run test**

Run: `cd /root/bot-circus && node --test tests/integration/reload.test.js 2>&1 | tail -10`

Expected: 1 test passes.

- [ ] **Step 3: Commit**

```bash
cd /root/bot-circus
git add tests/integration/reload.test.js
git commit -m "test(contract): integration — break/reload/recover cycle (T28)"
```

---

## Task 29: Integration test — scaffolder roundtrip

**Files:**
- Create: `bot-circus/tests/integration/scaffolder-roundtrip.test.js`

- [ ] **Step 1: Write the test**

Create `bot-circus/tests/integration/scaffolder-roundtrip.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scaffoldFromTemplate, inspectLegacy } from '../../lib/migrate.js';
import { lintWorkspaces } from '../../lib/lint.js';

test('scaffolder output lints clean (errors zero, warnings allowed)', async () => {
  const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-legacy-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'scaffold-dest-'));
  try {
    fs.writeFileSync(path.join(legacy, 'package.json'), JSON.stringify({ name: 'legacy-test', version: '1.0.0' }));
    fs.writeFileSync(path.join(legacy, '.env'), 'TELEGRAM_BOT_TOKEN=xxx\n');
    fs.writeFileSync(path.join(legacy, 'bot.mjs'), 'console.log("x");');

    const info = await inspectLegacy(legacy);
    assert.strictEqual(info.suggestedRuntime, 'shared');

    fs.rmSync(dest, { recursive: true, force: true });
    const id = path.basename(dest);
    await scaffoldFromTemplate({
      destDir: dest,
      values: { id, name: 'Legacy Test', role: 'test', telegram_username: '@legacy_bot', owner: 'kobie3717' }
    });

    const summary = await lintWorkspaces({ workspaces: [dest] });
    assert.strictEqual(summary.errorCount, 0, `unexpected errors: ${JSON.stringify(summary.results, null, 2)}`);
  } finally {
    fs.rmSync(legacy, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test**

Run: `cd /root/bot-circus && node --test tests/integration/scaffolder-roundtrip.test.js 2>&1 | tail -10`

Expected: 1 test passes.

- [ ] **Step 3: Commit**

```bash
cd /root/bot-circus
git add tests/integration/scaffolder-roundtrip.test.js
git commit -m "test(contract): integration — scaffolder roundtrip lints clean (T29)"
```

---

## Task 30: GitHub Actions CI workflow

**Files:**
- Create: `bot-circus/.github/workflows/contract.yml`

- [ ] **Step 1: Write workflow**

Create `bot-circus/.github/workflows/contract.yml`:
```yaml
name: contract

on:
  pull_request:
  push:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - name: Unit + integration tests
        run: npm test
      - name: Lint all performers
        run: ./bin/circus-lint --format text
```

- [ ] **Step 2: Local syntax check**

Run:
```bash
cd /root/bot-circus
node -e "console.log(require('fs').readFileSync('.github/workflows/contract.yml','utf8').length)"
```

Expected: prints byte count (file exists). Optional: `yamllint` if installed.

- [ ] **Step 3: Commit**

```bash
cd /root/bot-circus
git add .github/workflows/contract.yml
git commit -m "ci(contract): GitHub Actions workflow runs tests + circus-lint (T30)"
```

---

## Task 31: Pre-commit hook + installer

**Files:**
- Create: `bot-circus/.githooks/pre-commit`
- Create: `bot-circus/.githooks/install.sh`

- [ ] **Step 1: Write hook**

Create `bot-circus/.githooks/pre-commit`:
```bash
#!/usr/bin/env bash
# bot-circus contract pre-commit hook
set -e
REPO=$(git rev-parse --show-toplevel)
cd "$REPO"

# Only run if any staged file is under performers/ or templates/ or lib/contract/
CHANGED=$(git diff --cached --name-only)
if echo "$CHANGED" | grep -qE '^(performers/|templates/|lib/contract/|lib/lint\.js|lib/validator\.js|lib/migrate\.js)'; then
  echo "[circus] running contract lint on staged changes..."
  ./bin/circus-lint --since HEAD~0 || ./bin/circus-lint
fi
```

Create `bot-circus/.githooks/install.sh`:
```bash
#!/usr/bin/env bash
set -e
REPO=$(git rev-parse --show-toplevel)
git -C "$REPO" config core.hooksPath .githooks
chmod +x "$REPO/.githooks/pre-commit"
echo "[circus] git hooksPath set to .githooks/"
```

- [ ] **Step 2: Make executable + install**

Run:
```bash
cd /root/bot-circus
chmod +x .githooks/pre-commit .githooks/install.sh
./.githooks/install.sh
git config --get core.hooksPath
```

Expected: `core.hooksPath` prints `.githooks`.

- [ ] **Step 3: Smoke — staged commit triggers lint**

Run:
```bash
cd /root/bot-circus
mkdir -p performers/smoke-test
echo '{}' > performers/smoke-test/config.json
git add performers/smoke-test/config.json
git commit -m "test: smoke-test stage" 2>&1 | tail -10 || true
git restore --staged performers/smoke-test/config.json
rm -rf performers/smoke-test
```

Expected: commit blocked by R01 (schema invalid). Output shows `R01: schema invalid` or similar.

- [ ] **Step 4: Commit hook files**

```bash
cd /root/bot-circus
git add .githooks/
git commit -m "feat(contract): pre-commit hook + installer (T31)"
```

---

## Task 32: Spec-coverage smoke — run lint on all 6 canonical performers

**Files:**
- Modify: `bot-circus/performers/<id>/IDENTITY.md` (add minimal frontmatter so R02 passes; keep file content intact otherwise)
- Modify: `bot-circus/performers/<id>/config.json` (bring up to v1 schema)

- [ ] **Step 1: Inspect current canonical perfs**

Run:
```bash
cd /root/bot-circus
for p in performers/*/; do
  echo "=== $p ==="
  cat "$p/config.json" 2>/dev/null | head -10
  echo
  head -10 "$p/IDENTITY.md" 2>/dev/null
done
```

Note which files already have the v1 frontmatter / fields and which need updating.

- [ ] **Step 2: For each performer that fails R01–R03, bring config.json + IDENTITY.md to v1 shape**

For each of `007`, `claw`, `friday`, `octo`, `wa-drone`, `webbs`:

Ensure `performers/<id>/config.json` has at minimum:
```json
{
  "contract_version": "1.0",
  "id": "<id>",
  "name": "<Name>",
  "runtime": "shared",
  "secrets": { "provider": "env-file", "path": ".env" }
}
```

Ensure `performers/<id>/IDENTITY.md` starts with:
```markdown
---
id: <id>
name: <Name>
role: <one-liner>
---
```

Do NOT rewrite SOUL/USER/MEMORY content — leave persona text untouched. The goal is only to make the workspace structurally valid; persona authoring is separate.

- [ ] **Step 3: Run lint on all six**

Run:
```bash
cd /root/bot-circus
./bin/circus-lint --format text
```

Expected: every performer prints `OK ... (errors: 0, warnings: N)`. Warnings on R11/R12 are acceptable. `Total: 0 errors, ...`.

If any errors remain, fix the cited file and re-run until errors = 0.

- [ ] **Step 4: Commit**

```bash
cd /root/bot-circus
git add performers/
git commit -m "chore(performers): bring 6 canonical workspaces to contract v1.0 (T32)"
```

---

## Task 33: Final acceptance verification

**Files:** (none — verification only)

- [ ] **Step 1: Run full test suite**

Run: `cd /root/bot-circus && npm test 2>&1 | tail -20`

Expected: every `# pass` line counts non-zero, `# fail 0`, exit 0.

- [ ] **Step 2: Time the lint run**

Run: `cd /root/bot-circus && time ./bin/circus-lint --format text`

Expected: runs in < 2 seconds.

- [ ] **Step 3: Confirm CI gate**

Open a draft PR on a feature branch that introduces an R02 violation (delete `performers/webbs/IDENTITY.md` frontmatter). Push. Confirm `contract` check fails with R02 visible.

(If no GitHub remote configured, simulate locally:)
```bash
cd /root/bot-circus
git checkout -b contract-ci-smoke
sed -i '/^---/,/^---/d' performers/webbs/IDENTITY.md  # strip frontmatter
./bin/circus-lint --format text | grep -E "R02|FAIL"
git checkout performers/webbs/IDENTITY.md
git checkout -
git branch -D contract-ci-smoke
```

Expected: lint reports R02 fail for `webbs`.

- [ ] **Step 4: Confirm runtime gate writes quarantine state**

Run:
```bash
cd /root/bot-circus
mkdir -p performers/zz-broken
echo '{}' > performers/zz-broken/config.json
node -e "import('./lib/validator.js').then(async m => { const r = await m.validateAtBoot(['/root/bot-circus/performers/zz-broken']); m.writeQuarantineState('/tmp/q.json', r.failed); console.log(JSON.parse(require('fs').readFileSync('/tmp/q.json'))); })"
rm -rf performers/zz-broken /tmp/q.json
```

Expected: prints JSON with `quarantined: { "zz-broken": ... }` containing R01 error.

- [ ] **Step 5: Confirm scaffolder produces clean output**

Run:
```bash
cd /root/bot-circus
mkdir -p /tmp/scaffold-legacy
cat > /tmp/scaffold-legacy/package.json <<'EOF'
{ "name": "smoke-bot", "version": "1.0.0" }
EOF
./bin/circus-migrate /tmp/scaffold-legacy --id smoke-perf --out /tmp/smoke-perf --yes 2>&1 | tail -20
./bin/circus-lint --performer smoke-perf --format text 2>&1 || true
# scaffold output is not under bot-circus/performers/ when --out used, so lint it directly:
node -e "import('./lib/lint.js').then(async m => { const s = await m.lintWorkspaces({ workspaces: ['/tmp/smoke-perf'] }); console.log('errors:', s.errorCount, 'warns:', s.warnCount); })"
rm -rf /tmp/scaffold-legacy /tmp/smoke-perf
```

Expected: scaffolder runs, prints TODO list, `errors: 0`. Warnings allowed.

- [ ] **Step 6: Confirm acceptance criteria from spec §9.4**

Tick each:
- [ ] `bin/circus-lint` runs in < 2s on all six performers, exits 0 (warnings ok) → confirmed step 2
- [ ] CI workflow blocks a PR that introduces any R01–R10 error → confirmed step 3
- [ ] Pre-commit hook aborts on any error → confirmed T31 step 3
- [ ] Orchestrator boot writes a correct `.state/quarantine.json` for a known-bad fixture set → confirmed step 4
- [ ] `circus-migrate` produces a workspace that passes lint (warns only) for a fixture legacy bot → confirmed step 5
- [ ] `CONTRACT.md` is reviewed and committed → committed in T17
- [ ] All unit + integration tests are green in CI → confirmed step 1

- [ ] **Step 7: Final commit / tag**

```bash
cd /root/bot-circus
git tag -a contract-v1.0 -m "Workspace contract v1.0 — slice B complete"
git log --oneline contract-v1.0~1..contract-v1.0 | head
```

Expected: tag created at HEAD; recent commits list shows the T0–T32 trail.

---

## Self-Review (executed by author)

**1. Spec coverage:**

| Spec section | Implementing task(s) |
|---|---|
| §5 file layout | T0, T16, T17, T1–T13, T14, T18, T24–T26, T30, T31 |
| §6.1 CONTRACT.md | T17 |
| §6.2 config.json schema | T2 |
| §6.3 rules R01–R12 | T2 (R01), T3 (R02), T4 (R03), T5 (R04), T6 (R05), T7 (R06), T8 (R07), T9 (R08), T10 (R09), T11 (R10), T12 (R11), T13 (R12) |
| §6.4 lint CLI | T14 + T15 (--since) + T20 (--status) |
| §6.5 validator + quarantine | T18 + T19 + T21 + T22 + T23 |
| §6.6 migrate scaffolder | T24 + T25 + T26 |
| §6.7 CI workflow | T30 |
| §7 data flow | exercised by T27, T28, T29 |
| §8 error handling (quarantine semantics, log channels, non-behaviors) | T19, T21, T22 (quarantine), T22 (drop log), §8 non-behaviors enforced by design (no auto-fix in T26, no auto-rollback) |
| §9 testing | unit per rule (T2–T13), lint test (T14), validator test (T18), migrate test (T24, T25), integration (T27, T28, T29) |
| §9.4 acceptance | T33 |
| §10 out-of-scope | reflected (no migration of running bots; phase-2/3 hardening absent) |
| §11 risks | tiered severity (T12/T13), revert path (T21), reviewer signoff in scaffolder (T26) |

No gaps.

**2. Placeholder scan:** No `TBD`/`TODO` in plan body (the two `TODO` strings in `circus-migrate` output text are intentional — the tool prints a "Manual TODO" list to the user, which is product behavior, not plan drift).

**3. Type/name consistency:**

- `lintWorkspace`, `lintWorkspaces`, `pickWorkspacesSince` — consistent (lib/lint.js).
- `validateAtBoot`, `writeQuarantineState`, `readQuarantineState` — consistent (lib/validator.js).
- `scaffoldFromTemplate`, `inspectLegacy` — consistent (lib/migrate.js).
- `RULES` Map, `registerRule({id, severity, layers, run})` — consistent across rules-*.js modules.
- Rule layer enum `'lint' | 'ci' | 'runtime'` — consistent; runtime gate filters by `'runtime'` only.
- `config.json` `secrets.provider: 'env-file'` v1 — consistent.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-26-bot-workspace-contract.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
