# GRACE Marketplace and CLI

**GRACE** means **Graph-RAG Anchored Code Engineering**: a contract-first AI engineering methodology built around semantic markup, `.grace` XML artifacts, knowledge-graph navigation, assertions, scopes, and log-driven verification.

This repository ships the GRACE skills plus the optional `grace` CLI. It is a packaging and distribution repository, not an end-user application.

Current packaged version: `4.0.0-rc.2`

## What This Repository Ships

- Canonical GRACE skills in `skills/grace/*`
- Packaged Claude marketplace mirror in `plugins/grace/skills/grace/*`
- Marketplace metadata in `.claude-plugin/marketplace.json`
- Packaged plugin manifest in `plugins/grace/.claude-plugin/plugin.json`
- OpenPackage metadata in `openpackage.yml`
- Optional Bun-powered CLI package `@osovv/grace-cli`

## GRACE 4 Model

GRACE 4 uses `.grace` as the durable project model:

| Area | Purpose |
| --- | --- |
| `.grace/context/*.xml` | Requirements, technology, principles, deployment, and UX constraints |
| `.grace/graph/index.xml` + routed graph docs | Current graph projection source for `GD-*`, `M-*`, and `DF-*` anchors |
| `.grace/verification/index.xml` + routed verification docs | Current verification projection source for deterministic `V-M-*` entries |
| `.grace/changes/active/C-*` | Active `GraceChangeSpec`, optional design context, and `GraceChangePlan` bundles |
| `.grace/changes/archive/C-*` | Applied, rejected, cancelled, or superseded change bundles |
| Source/test files with GRACE markup | File-local contracts, links, and semantic block anchors |

GRACE 4 does not dual-validate legacy GRACE 3 project docs as current state. Existing GRACE 3 projects use `$grace-migrate`; the CLI validates the generated `.grace` result but does not convert legacy docs itself.

Verification commands run from the project root by default. A `V-M-*` entry may declare one project-relative `<Cwd>packages/example</Cwd>` while keeping `<TestFiles><File>...</File></TestFiles>` paths project-root-relative for monorepo-safe validation.

## Install

Install **skills** first. The CLI is optional but recommended once skills are installed.

### OpenPackage

```bash
opkg install gh@osovv/grace-marketplace
opkg install gh@osovv/grace-marketplace -g
opkg install gh@osovv/grace-marketplace --platforms claude-code
```

### Claude Code Marketplace

```bash
/plugin marketplace add osovv/grace-marketplace
/plugin install grace@grace-marketplace
```

### Agent Skills-Compatible Install

```bash
git clone https://github.com/osovv/grace-marketplace
cp -r grace-marketplace/skills/grace/grace-* /path/to/your/agent/skills/
```

### CLI

Requires `bun` on `PATH`.

```bash
# GRACE 4 release candidates while npm `latest` still points to GRACE 3
bun add -g @osovv/grace-cli@rc

# Stable channel after GRACE 4 is promoted to npm `latest`
bun add -g @osovv/grace-cli
grace lint --path /path/to/grace4-project
```

## GRACE 4 Quick Start

For a new GRACE 4 project:

1. Run `$grace-init` to create `.grace`.
2. Fill `.grace/context` artifacts with your agent.
3. Run `$grace-spec` for a change.
4. Run `$grace-plan` after spec approval.
5. Run `grace lint --path /path/to/project`.
6. Run `grace status --path /path/to/project`.
7. Run `$grace-execute` and choose sequential or parallel-safe mode.

Existing GRACE 3 projects should run `$grace-migrate` and review the migration report before writing `.grace` artifacts.

## Skills Overview

| Skill | Purpose |
| --- | --- |
| `grace-init` | Bootstrap the `.grace` skeleton, templates, and agent guidance |
| `grace-spec` | Create an approved GRACE 4 change spec and optional design context |
| `grace-plan` | Design assertions, scopes, tasks, and verification gates from an approved spec |
| `grace-execute` | Execute the approved plan in sequential or parallel-safe mode |
| `grace-refactor` | Rename, move, split, merge, and extract modules without artifact drift |
| `grace-setup-subagents` | Scaffold GRACE worker and reviewer presets |
| `grace-fix` | Debug issues from graph, contracts, tests, traces, and semantic blocks |
| `grace-refresh` | Detect drift and propose reconciliation changes |
| `grace-status` | Report `.grace` health and suggest the next safe action |
| `grace-ask` | Answer architecture and implementation questions from `.grace` artifacts |
| `grace-cli` | Use the optional `grace` binary as a fast lint and artifact-query layer |
| `grace-explainer` | Explain the GRACE methodology itself |
| `grace-verification` | Build and maintain `.grace/verification` entries and evidence |
| `grace-reviewer` | Review semantic integrity, projections, scopes, and verification quality |
| `grace-migrate` | Agent-applied GRACE 3 to GRACE 4 migration with CLI validation |

## CLI Overview

| Command | What It Does |
| --- | --- |
| `grace lint --path <root>` | Validate `.grace` grammar, routed document coverage, change-bundle contracts, assertions, lifecycle locations, and scope overlap |
| `grace status --path <root>` | Report durable health, stale plans, scope conflicts, and explained/unexplained observed git drift |
| `grace module find <query> --path <root>` | Search graph projection modules by id, path, text, dependency, or verification id |
| `grace module show <id-or-path> --path <root>` | Show graph projection context and linked file-local markup |
| `grace module show <id> --with verification --path <root>` | Include matching deterministic `V-M-*` verification entries |
| `grace verification find <query> --path <root>` | Search verification projection entries |
| `grace verification show <id-or-module> --path <root>` | Show one verification entry and module context |
| `grace file show <path> --path <root>` | Show file-local `MODULE_CONTRACT`, `MODULE_MAP`, and `CHANGE_SUMMARY` |

Output modes:

- `grace lint`: `text`, `json`
- `grace status`: `text`, `json`
- `grace module find`: `table`, `json`
- `grace module show`: `text`, `json`
- `grace verification find`: `table`, `json`
- `grace verification show`: `text`, `json`
- `grace file show`: `text`, `json`

## Grep-First Navigation

Prefer this order when narrowing scope:

1. Search `.grace/graph/index.xml` for graph document routing.
2. Open routed graph documents for `M-*` and `DF-*` anchors.
3. Search `.grace/verification/index.xml` for verification routing.
4. Open routed verification documents for `V-M-*` entries.
5. Search `.grace/changes/active/C-*` for in-flight specs and plans.
6. Search source/test files for `LINKS:`, `START_MODULE_CONTRACT`, `START_CONTRACT:`, and `START_BLOCK_`.

Common anchors:

- `GD-*` graph document wrappers
- `M-*` module IDs
- `DF-*` data-flow IDs
- `VD-*` verification document wrappers
- `V-M-*` verification IDs
- `C-*` change bundles
- `T-*` implementation plan tasks

## Repository Layout

| Path | Purpose |
| --- | --- |
| `skills/grace/*` | Canonical skill sources |
| `plugins/grace/skills/grace/*` | Packaged mirror used for marketplace distribution |
| `.claude-plugin/marketplace.json` | Marketplace entry and published skill set |
| `plugins/grace/.claude-plugin/plugin.json` | Packaged plugin manifest |
| `src/grace.ts` | CLI entrypoint |
| `src/grace4/*` | GRACE 4 project detection, XML parsing, grammar, projections, assertions, and scopes |
| `src/lint/*` | `grace lint` implementation |
| `src/query/*` | Projection-backed query layer for CLI navigation |
| `scripts/validate-marketplace.ts` | Packaging, version, path, and mirror validation |
| `RELEASING.md` | Manual release checklist and validation commands |

## Development

```bash
bun test
bun run ./scripts/validate-marketplace.ts
bun run validate:release
```

For CLI changes, keep tests in `src/grace-lint.test.ts`, `src/grace-status.test.ts`, and `src/grace-query.test.ts` aligned with the GRACE 4 `.grace` fixture model.
