# Bot Workspace Isolation Contract — Design

**Slice:** B (of A→B→C→D bot-isolation programme)
**Date:** 2026-05-26
**Status:** Approved for planning
**Owner:** kobie3717
**Scope:** Define + enforce the per-performer workspace contract inside `/root/bot-circus/`. No live bot is migrated by this slice; that is slice C.

---

## 1. Problem

Six Telegram bots (`007-bot`, `claw-bot`, `friday-bot`, `octo-bot`, `wa-drone-bot`, `webbs`) run on the host via PM2. Each runs from a top-level fork directory (`/root/<name>-bot/` or `/root/claude-telegram-bot*/`) containing a copy-pasted `bot.mjs`, duplicated `ARCHITECTURE.md` / `DEPLOYMENT.md`, and `package.json` files whose `name` fields collide (`"claude-telegram-bot"` appears in four bots). The canonical workspaces under `/root/bot-circus/performers/<id>/` exist with the persona files described in `SPEC.md` (SOUL / IDENTITY / USER / MEMORY / config / memory) but are not read by any running process.

This produces five concrete forms of cross-bleed:

- **Character bleed.** Identical persona/architecture files across bots → no real per-bot identity.
- **Memory bleed.** Each bot can `fs.readFile('../other-bot/memory/...')` from sibling workspaces.
- **Runtime/secret bleed.** All bots inherit the same ambient env vars on the VPS; tokens are not scoped per process.
- **Code bleed.** Bug fixes copy-pasted between forks drift; shared logic has no home.
- **Communication bleed.** No mechanism, lint, or convention prevents direct cross-bot calls — the intended "only via circus API" rule is unenforced.

Slice B fixes the rules + enforcement. Slice C applies them to the first bot (`webbs`).

## 2. Goals

1. Define a **workspace contract** that captures the five isolation dimensions in enforceable form.
2. Ship a **three-layer enforcement chain**: pre-commit lint, CI gate, and orchestrator runtime gate, all calling one rule module.
3. Ship a **reference workspace template** so future migrations have a worked example.
4. Ship an **auto-migration scaffolder** (`circus-migrate`) that turns a legacy bot directory into a v1-compliant workspace stub, leaving the legacy directory untouched.

## 3. Non-goals

- Migrating any running PM2 bot (slice C+).
- Filesystem-permission isolation per bot UID (phase-2 hardening).
- Process sandbox (bwrap / firejail / nsjail) per worker (phase-3 hardening).
- Replacing the `bot-circus/troupes/` directory with circus rooms (deferred — see §6).
- Security audit of `.env` handling (phase-2 hardening).
- Load / perf testing of orchestrator dispatch.

## 4. Locked decisions (from brainstorm)

| # | Decision | Choice |
|---|---|---|
| Q1 | Runtime topology | **Hybrid** — shared orchestrator with per-performer escape hatches (custom + sidecar) |
| Q2 | Isolation dimensions enforced | All five: character, memory, runtime/secret, code, communication |
| Q3 | Secret layout | Per-workspace `.env` (v1) with `secrets.provider` field reserved for future swap |
| Q4 | Exception mechanism | `config.json` `runtime` field: `shared` \| `sidecar` \| `custom`; `custom` requires `CUSTOM_RUNTIME.md` |
| Q5 | Enforcement layering | Phase-1: static lint. Phase-2: FS perms. Phase-3: sandbox. Runtime audit always on. (This slice ships phase-1 + runtime audit only.) |
| Q6 | File schema strictness | Tiered: `IDENTITY.md` + `config.json` mandatory; `SOUL.md` + `USER.md` recommended (warn); `MEMORY.md` mandatory only when `troupes[]` non-empty; `CUSTOM_RUNTIME.md` mandatory only when `runtime: "custom"` |
| Q7 | Troupe mechanism | Troupes via **circus rooms only**. No file-share symlinks. `bot-circus/troupes/` deprecated. Cross-bot memory share routes through `/root/circus/` FastAPI. |
| Q8 | Lint enforcement points | Three: pre-commit hook + CI workflow + orchestrator runtime gate. Runtime gate fails closed (quarantine, no auto-unquarantine). |

## 5. Architecture overview

Five artifacts ship under `/root/bot-circus/`:

```
bot-circus/
├── CONTRACT.md
├── templates/performer/
│   ├── IDENTITY.md.tmpl
│   ├── SOUL.md.tmpl
│   ├── USER.md.tmpl
│   ├── MEMORY.md.tmpl
│   ├── config.json.tmpl
│   ├── .env.example
│   └── memory/.gitkeep
├── lib/
│   ├── contract/
│   │   ├── schema.js      # JSON schema for config.json
│   │   ├── frontmatter.js # MD frontmatter schema
│   │   └── rules.js       # 12 rule fns — single source of truth
│   ├── lint.js
│   ├── validator.js
│   └── migrate.js
├── bin/
│   ├── circus-lint
│   └── circus-migrate
└── .github/workflows/contract.yml
```

Three trust gates, all calling `rules.js`:

1. **Pre-commit** — git hook runs `circus-lint --since HEAD`.
2. **CI** — `contract.yml` runs `circus-lint` on PR; branch protection requires it green.
3. **Runtime** — orchestrator calls `validator.checkAll()` on boot and on `SIGUSR2` (PM2 reload). Failing performers are quarantined.

Quarantine = "performer exists, orchestrator refuses to dispatch to it." State stored in `bot-circus/.state/quarantine.json`. No auto-unquarantine. Recovery = fix workspace → `pm2 reload bot-circus`.

## 6. Components

### 6.1 `CONTRACT.md`

Human-readable spec. Sections: workspace shape, `config.json` schema, runtime modes, isolation dimensions, lint rules table, migration recipe (manual + scaffolder), versioning (`contract_version` bumping + deprecation policy).

### 6.2 `config.json` schema

```json
{
  "contract_version": "1.0",
  "id": "webbs",
  "name": "Webbs",
  "telegram_username": "@webbs_bot",
  "runtime": "shared",
  "secrets": { "provider": "env-file", "path": ".env" },
  "troupes": [],
  "sidecars": [],
  "owner": "kobie3717"
}
```

Rules:

- `id` must equal parent directory name (R03).
- `runtime: "custom"` → `CUSTOM_RUNTIME.md` mandatory (R04).
- `runtime: "sidecar"` → `sidecars[]` non-empty; each `{name, script}` must resolve inside the workspace (R05).
- `troupes[]` lists circus room ids the bot auto-joins on boot. Empty = ringfenced.
- `secrets.provider` v1 enum: `"env-file"` only. Reserved future values: `"doppler"`, `"vault"`, `"1password-cli"`.

### 6.3 `lib/contract/rules.js` — 12 rules

| ID  | Rule | Severity | Layer |
|-----|------|----------|-------|
| R01 | `config.json` exists and validates against schema | error | all 3 |
| R02 | `IDENTITY.md` exists with required frontmatter | error | all 3 |
| R03 | `config.id` equals parent directory name | error | all 3 |
| R04 | `runtime: "custom"` → `CUSTOM_RUNTIME.md` present | error | all 3 |
| R05 | `runtime: "sidecar"` → each `sidecars[].script` resolves inside workspace | error | all 3 |
| R06 | No symlink in workspace points outside workspace root (except allowlisted shared `lib/`) | error | all 3 |
| R07 | No source file contains string `performers/<id>/` where `<id>` is not self | error | lint + CI |
| R08 | No `require` / `import` / `fs.readFile` resolves to a sibling performer path | error | lint + CI |
| R09 | `.env` is listed in `.gitignore`; `.env` not present in git index | error | lint + CI |
| R10 | If `package.json` present, its `name` is unique across all performers | error | lint + CI |
| R11 | `SOUL.md` and `USER.md` present | warn | lint + CI |
| R12 | `MEMORY.md` present iff `troupes[]` non-empty | warn | lint + CI |

Runtime gate runs R01–R06 only (cheap, deterministic). Lint + CI run all 12.

Each rule is one exported function `(workspaceDir, ctx) → { id, pass, violations[] }`. Pure — no I/O beyond `workspaceDir` reads, no global state.

### 6.4 `lib/lint.js` + `bin/circus-lint`

```
circus-lint                            # lints all performers under bot-circus/performers/
circus-lint --performer webbs          # one bot
circus-lint --since HEAD~1             # only changed performers (CI speedup)
circus-lint --format json              # machine-readable
circus-lint --status                   # show current quarantine state from .state/quarantine.json
```

Exit 0 if all rules pass (warnings ok). Exit 1 if any error-severity rule fails. Target runtime: < 2s for all six performers.

### 6.5 `lib/validator.js` — runtime gate

Called by orchestrator at boot and on `SIGUSR2`:

```js
const result = await validator.checkAll('/root/bot-circus/performers');
for (const [perfId, violations] of result.failed) {
  logger.error({ perfId, violations }, 'CONTRACT_VIOLATION_REFUSING_DISPATCH');
  orchestrator.quarantine(perfId);
}
```

Writes `bot-circus/.state/quarantine.json`. Performers in the quarantine set are skipped by the dispatch path (§7). Cache invalidates on file mtime change; re-validates the affected performer on the next inbound message.

### 6.6 `lib/migrate.js` + `bin/circus-migrate`

```
circus-migrate <legacy-path> --id <perf-id> [--out <dest>] [--force]
```

Pipeline:

1. Copy `templates/performer/` → `bot-circus/performers/<id>/` (refuse if dest exists unless `--force`).
2. Read legacy `package.json`; populate `IDENTITY.md` (name, owner) and `config.json` (id, telegram_username inferred from env or prompted).
3. Move legacy `.env` → `performers/<id>/.env` with interactive confirmation.
4. Detect sidecar pattern: multiple top-level `*.mjs` entry scripts → suggest `runtime: "sidecar"`, prefill `sidecars[]`.
5. Run `circus-lint --performer <id>`; print all violations.
6. Print manual TODO list: fill SOUL/USER, decide runtime (refactor to shared OR keep as custom with `CUSTOM_RUNTIME.md`), update PM2 ecosystem, delete legacy dir after verification.

The scaffolder never modifies the legacy directory. The scaffolder never touches PM2.

### 6.7 `.github/workflows/contract.yml`

```yaml
name: contract
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: ./bin/circus-lint --format json
```

Branch protection on `main` requires this check green.

## 7. Data flow

### 7.1 Write-time → deploy-time

```
edit performers/webbs/config.json
  → git commit  (pre-commit hook: circus-lint --since HEAD)
      ├─ pass → commit OK
      └─ fail → commit aborted; rule id + file + fix hint to stderr
  → git push   (GitHub Actions: contract.yml runs circus-lint)
      ├─ pass → PR mergeable
      └─ fail → PR blocked; failures grouped by performer in step summary
  → merge to main → manual `pm2 reload bot-circus`
  → orchestrator boots → validator.checkAll()
      ├─ pass → performer active
      └─ fail → performer quarantined, logged, skipped
```

### 7.2 Per-message dispatch

```
Telegram update for token T arrives at orchestrator
  → resolve T → perf_id
  → isQuarantined(perf_id)?
      ├─ yes → drop, log WARN, no reply
      └─ no  → continue
  → load workspace context (cached, mtime-invalidated):
      SOUL.md, IDENTITY.md, USER.md, MEMORY.md (if exists), .env (scoped env map)
  → dispatch by runtime mode:
      shared  → spawn Claude CLI with --cwd=performers/<id>/ + scoped env
      sidecar → same as shared; sidecars run as independent PM2 entries
      custom  → orchestrator skips entirely; bot.mjs handles the message as its own PM2 process
  → Claude streams reply → Telegram → user
  → subprocess exits; env discarded
```

### 7.3 Cross-bot memory share (the only allowed path)

```
Bot A's Claude session calls circus SDK:
  circus.publish(room="customer-support", memory={...})
  → HTTPS POST → /root/circus/ FastAPI :6200
      (W3C VC + trust check + conflict detection + store + SSE notify)
  → Bot B (subscribed to room) calls circus.consume(...)
  → Merges into own ai-iq SQLite (own performers/<B>/memory/)
```

No FS path between A and B is ever traversed. Lint R07/R08 makes this statically checkable; runtime R06 seals symlink escape.

### 7.4 Scaffolder roundtrip

```
$ circus-migrate /root/claude-telegram-bot-friday --id friday
  1. read legacy → package.json, .env, entry scripts
  2. copy template → performers/friday/, fill IDENTITY + config
  3. move .env (confirm)
  4. lint → warns on SOUL/USER stubs (R11)
  5. print manual TODO
  6. legacy dir untouched
```

## 8. Error handling

| Failure | Layer | Behavior |
|---------|-------|----------|
| Lint rule fails on commit | pre-commit | abort commit, exit 1, print rule id + file + fix hint |
| Lint rule fails on PR | CI | block merge, group failures by performer in check summary |
| `config.json` malformed | all 3 | R01 fail; runtime gate quarantines |
| Runtime gate violation at boot | runtime | quarantine performer; orchestrator boots; others unaffected |
| Workspace mtime changes while running | runtime | cache invalidates; re-validate on next message; quarantine on fail |
| Scaffolder cannot infer id/name | scaffolder | exit 1; require `--id` |
| Scaffolder dest exists | scaffolder | refuse without `--force`; print existing contents |
| Telegram message for unknown token | dispatch | drop, log WARN |
| Telegram message for quarantined performer | dispatch | drop, log WARN with failing rule id |
| Sidecar crashes | PM2 | PM2 owns restart; orchestrator unaware |
| Custom-runtime bot crashes | PM2 | PM2 owns restart; orchestrator unaware |
| Circus API down during publish | bot session | SDK retries exponentially; on final fail Claude reports error in reply |

**Quarantine semantics:**

- Performer files are not modified.
- Sidecars (independent PM2 entries) continue running.
- Recovery is manual: fix workspace + `pm2 reload bot-circus`.
- No auto-unquarantine (prevents flapping).
- Visibility via `circus-lint --status`.

**Log channels:**

- `bot-circus/logs/contract-violations.jsonl` — every runtime-gate failure, one line per perf per boot/reload.
- `bot-circus/logs/dispatch.jsonl` — drops + successful routes.
- `bot-circus/.state/quarantine.json` — current quarantine set.

**Explicit non-behaviors:**

- No auto-fix anywhere. Lint never edits files.
- No automatic rollback on bad deploy. Recovery is `git revert` + reload.
- No timer-based re-validation. Boot + `SIGUSR2` only.
- Rule severity is binary: error fails, warn doesn't. No advisory middle tier.

## 9. Testing

### 9.1 Unit tests — `bot-circus/tests/contract/`

One file per rule plus shared infrastructure. Each rule is a pure function tested with fixture directories under `tests/contract/fixtures/`:

- `valid-shared/` — minimal passing shared performer
- `valid-sidecar/` — claw-like sidecar setup
- `valid-custom/` — custom + `CUSTOM_RUNTIME.md`
- `invalid-missing-identity/` — R02 fail
- `invalid-id-mismatch/` — R03 fail
- `invalid-cross-symlink/` — R06 fail
- `invalid-sibling-import/` — R08 fail
- `invalid-malformed-config/` — R01 fail
- `invalid-no-gitignore-env/` — R09 fail
- one fixture per remaining rule

Coverage target: every rule has at least one passing and one failing fixture.

### 9.2 Integration tests — `bot-circus/tests/integration/`

- `contract-flow.test.js` — orchestrator boot with 3-performer tmpdir (1 valid, 2 invalid); assert quarantine state is correct.
- `reload.test.js` — boot valid → break on disk → `SIGUSR2` → assert quarantined → fix → reload → unquarantined.
- `scaffolder-roundtrip.test.js` — run `circus-migrate` against fixture legacy dirs; assert output passes lint (warnings only).

### 9.3 Manual smoke test (pre-merge)

- [ ] `circus-lint` on all 6 canonical performers → warnings allowed, errors zero
- [ ] Trip R03 by renaming `webbs/` → `wbs/`; revert
- [ ] `circus-migrate /root/webbs --id webbs --out /tmp/scaffold-test`; diff against canonical
- [ ] Draft PR with intentional R02 break; assert CI fails with R02 visible in check summary

### 9.4 Acceptance criteria

Slice B is done when:

1. `bin/circus-lint` runs in < 2s on all six performers and exits 0 (warnings ok).
2. The CI workflow blocks a PR that introduces any R01–R10 error.
3. The pre-commit hook aborts on any error.
4. Orchestrator boot writes a correct `.state/quarantine.json` for a known-bad fixture set.
5. `circus-migrate` produces a workspace that passes lint (warns only) for a fixture legacy bot.
6. `CONTRACT.md` is reviewed and committed.
7. All unit + integration tests are green in CI.

## 10. Out-of-scope follow-ups (separate slices)

- **Slice C** — apply contract to `webbs`: migrate runtime into `performers/webbs/`, repoint PM2 cwd, retire `/root/webbs/`. First real migration; codify recipe.
- **Slice D** — migrate remaining five bots (`007`, `friday`, `octo`, `wa-drone`, `claw`). `claw` requires sidecar handling for email/whatsapp/monitor processes.
- **Phase-2 hardening** — per-bot UID + FS permissions (`circus-<id>` users, chmod 0700 on workspaces).
- **Phase-3 hardening** — process sandbox (bwrap / firejail / nsjail) on Claude CLI workers.
- **Troupe replacement** — implement `troupes[]` join as circus room subscription; deprecate and remove `bot-circus/troupes/`.
- **Hydrabot disposition** — extract anything still useful from `/root/hydrabot/`, archive the rest.
- **Fork cleanup** — delete `/root/claude-telegram-bot*`, `/root/007-bot`, `/root/webbs`, `/root/octo-bot`, `/root/wa-drone-bot`, `/root/bot-circus-smoketest/` after migrations complete and verify period passes.

## 11. Risks + mitigations

| Risk | Mitigation |
|------|------------|
| Lint rules are wrong / too strict; existing perfs fail | Tiered severity (warn vs error); R11/R12 are warn-only. Canonical performers already meet R01–R10 by construction; verify in manual smoke. |
| Runtime gate quarantines a bot accidentally during a deploy | Gate runs R01–R06 only (deterministic, cheap, well-tested). Recovery is `git revert` + reload (~30s). Quarantine logs make root cause obvious. |
| Scaffolder writes wrong content to new workspace | Scaffolder leaves legacy dir untouched; reviewer signs off on the generated workspace before any PM2 change. |
| Contract version bumps break existing performers | `contract_version` field in `config.json`; lint reads version and applies the matching rule set. Deprecation policy in `CONTRACT.md` §versioning. |
| Circus API dependency newly mandatory for any cross-bot share | Bots default to `troupes: []` (ringfenced); circus dependency only activates when a bot explicitly opts in to a room. Single-bot operations unaffected. |
