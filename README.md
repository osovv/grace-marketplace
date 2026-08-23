# GRACE Marketplace and CLI

**GRACE** means **Graph-RAG Anchored Code Engineering**: a contract-first AI engineering methodology built around semantic markup, `.grace` XML artifacts, knowledge-graph navigation, assertions, scopes, and log-driven verification.

This repository ships the GRACE skills plus the optional `grace` CLI. It is a packaging and distribution repository, not an end-user application.

Current packaged version: `4.0.5`

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

Verification commands run from the project root by default. A `V-M-*` entry may declare one contained project-relative `<Cwd>packages/example</Cwd>` while keeping `<TestFiles><File>...</File></TestFiles>` paths project-root-relative. Absolute paths, `..` escapes, and symlink escapes fail closed.

TypeScript/JavaScript semantic analysis is bundled and compiler-backed. Governed Python and Dart files require their respective runtimes on `PATH`; Python export analysis is exact when a static `__all__` is present (including Unicode identifiers) and otherwise emits heuristic confidence. A missing runtime fails closed with actionable `analysis.runtime-missing`; an installed adapter that fails emits `analysis.adapter-failed`. Neither failure state is presented as exact `MODULE_MAP` parity.

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

Requires `bun` on `PATH`. GRACE skills invoke the installed stable `grace` binary directly; they do not default to `bunx`, `npx`, or a prerelease dist-tag.

```bash
# Install the current stable release from npm `latest`
bun add -g @osovv/grace-cli
grace --version
grace lint --path /path/to/grace4-project
```

## GRACE 4 Quick Start

For a new GRACE 4 project:

1. Run `$grace-init` to create `.grace`.
2. Fill `.grace/context` artifacts with your agent.
3. Run `$grace-spec` for a change.
4. Run `$grace-plan` after spec approval.
5. Before observed writes begin, run the active-baseline preflight: `grace lint --path /path/to/project --assertions current`.
6. Run `grace lint --path /path/to/project --change C-ID --assertions baseline` before execution; add `--run-commands` when the baseline declares `MustPassCommand`.
7. Run `grace status --path /path/to/project --json`.
8. Run `$grace-execute` and choose sequential or parallel-safe mode. Parallel-safe mode additionally requires `grace lint --path /path/to/project --parallel-preflight`.
9. Before apply/archive, run `grace lint --path /path/to/project --change C-ID --assertions final`; add `--run-commands` when the target declares `MustPassCommand`.

Existing GRACE 3 projects should run `$grace-migrate` and review the migration report before writing `.grace` artifacts.

Migration cleanup is separately gated: successful current lint, fresh status proving GRACE 4 with no integrity errors, git/worktree inspection, exact cleanup paths, and explicit cleanup confirmation are mandatory. Dirty or non-git cleanup requires an additional acknowledgement naming that risk; any cleanup failure stops without automatic destructive retry.

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
| `grace lint --path <root> --assertions current` | Run the pre-implementation full-project check, including baselines of active approved changes; do not use it as post-edit target/final evidence |
| `grace lint --path <root> --change C-ID --assertions baseline [--run-commands]` | Validate the immutable selected baseline before implementation; command assertions run only when explicitly enabled |
| `grace lint --path <root> --change C-ID --assertions target --run-commands` | Validate selected target assertions and explicitly opt into `MustPassCommand` execution |
| `grace lint --path <root> --change C-ID --assertions final [--run-commands]` | Run the final full-project gate, evaluate the selected target, and keep unrelated approved baselines active without re-evaluating the selected baseline |
| `grace lint --path <root> --parallel-preflight` | Run the explicit approved-plan scope coexistence gate required for parallel-safe execution |
| `grace status --path <root>` | Report durable health, stale plans, scope conflicts, and explained/unexplained observed git drift |
| `grace module find <query> --path <root>` | Search graph projection modules by id, path, text, dependency, or verification id |
| `grace module show <id-or-path> --path <root>` | Show graph projection context and linked file-local markup |
| `grace module show <id> --with verification --path <root>` | Include matching deterministic `V-M-*` verification entries |
| `grace verification find <query> --path <root>` | Search verification projection entries |
| `grace verification show <id-or-module> --path <root>` | Show one verification entry and module context |
| `grace file show <path> --path <root>` | Show file-local `MODULE_CONTRACT`, `MODULE_MAP`, and `CHANGE_SUMMARY` |

`MustPassCommand` entries are leaf project evidence such as tests, typecheck, build, format, or package checks. Do not nest `grace lint`, `grace status`, or another GRACE lifecycle command inside plan assertions; selected target/final lint is the external orchestration gate.

Output modes:

- `grace lint`: `text`, `json`
- `grace status`: `text`, `json`
- `grace module find`: `table`, `json`
- `grace module show`: `text`, `json`
- `grace verification find`: `table`, `json`
- `grace verification show`: `text`, `json`
- `grace file show`: `text`, `json`

Lint, status, and projection-backed navigation fail closed: invalid options, invalid grammar, malformed active assertions/scopes, duplicate ownership, missing routed files, or ambiguous targets produce structured results or a nonzero error envelope. JSON command failures emit one stable `{ "schemaVersion": "1.0.0", "ok": false, "error": { ... } }` envelope on stdout; text failures emit one concise actionable line without a stack trace.

### Lint Configuration

An optional `.grace-lint.json` file at the project root (next to `.grace`) controls how `grace lint` and the query commands collect code files:

```json
{
  "ignoredDirs": ["generated", "fixtures-output"]
}
```

- `ignoredDirs` lists directory names to prune from file collection, on top of the built-in set below. Names match at any depth; globs and paths are not supported.
- The file must be a JSON object with supported keys only. Broken JSON, a non-object shape, an unknown key, or a non-array `ignoredDirs` is a `config.*` lint error, and query commands refuse to run until the file is fixed.
- A directory that cannot be listed (restrictive permissions, sandbox leftovers) is skipped with a `walk.unreadable-directory` warning instead of aborting the run; add its name to `ignoredDirs` to prune it silently. Explain any of these codes with `grace lint --explain <code>`.

Built-in ignored directories:

- VCS metadata: `.git`, `.svn`, `.hg`
- JavaScript/TypeScript output and caches: `node_modules`, `dist`, `build`, `coverage`, `.next`, `.nuxt`, `.output`, `out`, `.turbo`, `.vite`, `.parcel-cache`, `.svelte-kit`, `.astro`, `storybook-static`, `.cache`, `.yarn`, `.nyc_output`, `bower_components`, `jspm_packages`, `.stryker-tmp`, `.serverless`, `.docusaurus`
- Python bytecode, virtualenvs, and tool caches: `__pycache__`, `venv`, `.venv`, `.tox`, `.nox`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.pyre`, `.pytype`, `htmlcov`, `.eggs`, `.hypothesis`, `.ipynb_checkpoints`, `__pypackages__`, `.pixi`, `cover`
- Test reports and artifacts: `test-results`, `test-reports`, `playwright-report`, `blob-report`, `allure-results`, `allure-report`, `test-output`, `newman`, `cucumber-report`, `cucumber-reports`
- JVM and Rust build output: `target`, `.gradle`, `.idea`
- Vendored dependencies (Go modules, Ruby bundler, PHP Composer): `vendor`
- Swift/Apple toolchain output and dependencies: `.build`, `Pods`, `Carthage`, `DerivedData`
- Dart/Flutter tooling cache: `.dart_tool`
- Ruby/general scratch space: `tmp`, `.bundle`
- Editor metadata: `.vscode`

### Analysis Cache

Successful per-file language analyses are cached across runs, so unchanged governed files are not re-analyzed. Entries are keyed by file content and extension plus a schema version: any file edit or analyzer logic change invalidates the entry automatically, and failed analyses are never cached, so fixing a missing runtime takes effect immediately.

- Location: `$XDG_CACHE_HOME/grace-cli/analysis`, falling back to `~/.cache/grace-cli/analysis`. Override the base directory with `GRACE_CACHE_DIR`.
- Disable caching with `GRACE_NO_CACHE=1`.
- The cache lives outside the project: it never touches `.grace` and produces no drift noise.

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
bun run validate:packed
bun run validate:release
```

For CLI changes, keep tests in `src/grace-lint.test.ts`, `src/grace-status.test.ts`, and `src/grace-query.test.ts` aligned with the GRACE 4 `.grace` fixture model.

Stable releases use a protected-main two-stage flow. `release:bump` runs on a clean release branch that contains current `origin/main`, updates and validates the version surfaces, commits them, pushes the branch, and finds or creates the release PR without creating a tag. After its required checks pass and the PR is merged, `release:finalize X.Y.Z` runs from clean synchronized `main`, revalidates the exact stable state, creates the annotated tag, and pushes only that tag. CI independently requires the stable tag commit to equal fetched `origin/main` and gates npm `latest` publication through the reviewer-protected `stable-release` environment, whose explicit deployment policies allow only branch `main` and tags `v*`. Protected `main` requires Linux, Windows, and real-Dart checks without requiring a separate PR approval, while an active ruleset keeps `v*` tags immutable. `bun run release:checklist` verifies those controls and, after publication from the exact release tag commit, verifies `HEAD == tag`, npm/GitHub channel metadata, and that the local `npm pack` shasum matches the immutable published tarball.
