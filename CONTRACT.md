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
