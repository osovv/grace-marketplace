# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog, and this project follows Semantic Versioning.

This changelog currently starts at `1.3.0`. Earlier history is available in the git log.

## [4.0.0] - 2026-06-20

### Added

- Added the GRACE 4 `.grace` artifact model with parser-backed XML validation, artifact grammar checks, graph and verification projections, assertion evaluation, active-change scopes, and overlap detection.
- Added `grace-spec` and `grace-migrate` skills for change specification and agent-applied GRACE 3 to GRACE 4 migration.
- Added GRACE 4 init templates for `.grace/context`, `.grace/graph`, `.grace/verification`, and empty change directories.

### Changed

- Reworked `grace lint`, `grace status`, `grace module`, `grace verification`, and `grace file` around `.grace` current state instead of legacy shared-doc validation.
- Updated skills and README to use `grace-spec`, `grace-plan`, and unified `grace-execute` with sequential or parallel-safe mode selection.
- Synchronized canonical and packaged skill mirrors for the GRACE 4 skill surface.

### Removed

- Removed `grace-multiagent-execute` as a separate published skill; parallel-safe execution is now a mode of `grace-execute`.
- Removed CLI dual-mode behavior for legacy GRACE 3 docs. Legacy projects now receive migration guidance and use `grace-migrate`.
- Removed `grace lint --profile autonomous` / autonomy gate. GRACE 4 uses `.grace` current-state validation, status, assertions, and scopes instead.

## [3.11.0] - 2026-04-19

### Added

- Added `grace verification find/show` so verification-plan entries are queryable without manual XML scanning.
- Added `grace module health` plus optional module health summaries in `grace status --with modules`.
- Added `grace lint --explain <code>`, remediation-aware text output, and configurable `--fail-on` policies for CI.
- Added release hygiene assets: `RELEASING.md`, `scripts/release-checklist.ts`, `.github/workflows/validate.yml`, and CLI examples under `examples/cli/`.

### Changed

- Strengthened the autonomy gate with technology-artifact checks, packet checkpoint requirements, module-implementation checks, test-file linkage checks, and marker-to-block validation.
- Enriched `grace lint` and `grace status` JSON output with schema/version metadata and summary counts for machine-readable automation.
- Extended marketplace validation to verify `package.json` version sync and require a matching `CHANGELOG.md` entry for the current version.

## [3.8.0] - 2026-04-19

### Added

- Added `grace lint --profile autonomous` as a cheap autonomy-readiness gate before long autonomous runs.
- Added `grace status` for project health, autonomy blockers, and next-action guidance.

### Changed

- Reframed the marketplace, CLI docs, and GRACE skills around process-first execution, semantic anchoring, approved stacks, checkpoint reports, and operational packets.
- Updated `grace-init` templates so technology, development-plan, verification-plan, and operational-packets examples explicitly model autonomy policy and checkpoint handoff.

## [3.7.0] - 2026-04-05

### Added

- Added `grace-cli`, a dedicated skill for using the optional `grace` binary as a GRACE-aware lint and artifact-query layer.

### Changed

- Updated skill trigger wording to use agent-neutral `Use when you ...` phrasing instead of Claude-specific wording.
- Reworked the README install guidance so GRACE skills are the primary surface, the CLI is a strongly recommended companion, and requirements/technology artifacts are designed together with the agent.

## [3.6.0] - 2026-04-05

### Added

- Added a schema-aware GRACE query layer with `grace module find`, `grace module show`, and `grace file show`.
- Added artifact indexing that merges shared XML module records, module verification entries, implementation steps, and linked file-local markup.

### Changed

- Expanded the CLI surface from integrity-only linting into read/query navigation for public shared-doc context and private file-local context.
- Updated the shipped GRACE skills and README so agents know when to use `grace lint`, `grace module find`, `grace module show`, and `grace file show`.

## [3.5.0] - 2026-04-05

### Changed

- Clarified across the marketplace skills that `docs/development-plan.xml` and `docs/knowledge-graph.xml` should describe only public module contracts and public module interfaces.
- Kept private helpers, internal types, and implementation-only orchestration details in file-local markup, local contracts, and semantic blocks instead of shared XML artifacts.
- Updated planning, refresh, reviewer, execution, refactor, explainer, init templates, and packaged mirrors to follow that boundary consistently.

## [3.4.0] - 2026-04-05

### Changed

- Added a rich Python adapter without `pyright`, while keeping TypeScript/JavaScript on the TypeScript compiler API for exact export analysis.
- Made adapter failures non-fatal so linting can continue with structural checks and warnings.

## [3.3.0] - 2026-04-05

### Changed

- Removed profile selection from `grace lint`; it now validates only against the current GRACE artifact set.
- Limited `.grace-lint.json` to the current schema and reject unknown keys instead of carrying compatibility paths for unused legacy config.

## [3.2.0] - 2026-04-05

### Changed

- Refactored `grace lint` into a role-aware core plus language-adapter architecture with a JS/TS AST adapter.
- Added `ROLE` and `MAP_MODE` support for governed files so tests, barrels, configs, types, and scripts are linted by semantics instead of filename masks.
- Added `auto/current/legacy` profile support and `.grace-lint.json` repository configuration.

## [3.1.1] - 2026-04-05

### Changed

- Documented the optional `grace` CLI inside `grace-explainer`, `grace-reviewer`, `grace-refresh`, and `grace-status` as a fast integrity preflight.
- Updated `CLAUDE.md` so future sessions treat the published `@osovv/grace-cli` package and `grace lint` workflow as part of the repo context.
- Switched the published CLI install example in `README.md` to `bun add -g @osovv/grace-cli`.

## [3.1.0] - 2026-04-05

### Added

- Added `grace-refactor` for safe rename, move, split, merge, and extract workflows with synchronized contracts, graph entries, and verification refs.
- Added `docs/operational-packets.xml` templates to `grace-init` so projects get canonical `ExecutionPacket`, `GraphDelta`, `VerificationDelta`, and `FailurePacket` shapes.
- Added a Bun-based `grace` CLI on `citty` with a `lint` subcommand for unique XML tags, graph/plan/verification drift, and semantic markup integrity.

### Changed

- Updated execution, verification, ask, fix, status, and explainer skills to recognize `docs/operational-packets.xml` when present.
- Prepared the published CLI as the scoped npm package `@osovv/grace-cli` with a Bun-powered `grace` binary and prepublish verification checks.

## [3.0.4] - 2026-04-05

### Changed

- Improved worker commit message format in `grace-multiagent-execute`: requires concrete file/function/export listing and descriptive body instead of generic "harden X" phrases.
- Improved controller meta-sync commit format: lists which artifacts were updated and per-module delta description instead of bare module list.

## [3.0.3] - 2026-03-19

### Fixed

- Replaced the `plugins/grace/skills` symlink with real packaged skill files so OpenPackage can install the plugin for `opencode`.
- Added validator coverage for drift between canonical `skills/grace/*` content and the packaged copy inside `plugins/grace`.

## [3.0.2] - 2026-03-19

### Fixed

- Re-aligned the Claude Code marketplace layout with the official docs by serving the `grace` plugin from `./plugins/grace`.
- Restored the plugin manifest to `plugins/grace/.claude-plugin/plugin.json` and removed the unsupported root plugin manifest.
- Updated marketplace validation to enforce relative plugin sources and to verify component paths inside each plugin source directory.

## [3.0.1] - 2026-03-19

### Fixed

- Restored Claude Code marketplace packaging to use the repository root as the plugin source so bundled skill paths resolve inside the installed plugin.
- Added a root `.claude-plugin/plugin.json` manifest and removed the broken nested `plugins/grace` packaging layout.
- Updated validation to catch missing component paths inside the declared plugin source before release.

## [3.0.0] - 2026-03-16

### Added

- Added `docs/verification-plan.xml` as a first-class GRACE artifact template.
- Added richer `grace-init` templates for requirements, technology, development plan, and knowledge graph.
- Added GRACE explainer reference material for verification-driven and log-driven development.

### Changed

- Reframed `grace-verification` around maintained testing, traces, and log-driven evidence.
- Updated `grace-plan` to produce verification references and populate `verification-plan.xml`.
- Updated `grace-execute` and `grace-multiagent-execute` to consume verification-plan excerpts in execution packets and sync verification deltas centrally.
- Updated `grace-reviewer`, `grace-status`, `grace-refresh`, `grace-ask`, and `grace-fix` to treat verification as part of GRACE integrity.
- Refreshed README, packaging metadata, and installation paths for the nested `skills/grace/*` layout.

### Removed

- Removed `grace-generate` from the public skill set in favor of the execution-centric workflow through `grace-execute` and `grace-multiagent-execute`.

## [2.1.0] - 2026-03-09

### Changed

- Workers now commit their implementation immediately after verification passes, rather than waiting for controller.
- Controller commits only shared artifacts (graph, plan), not implementation files.
- Updated `grace-execute` and `grace-multiagent-execute` with explicit commit timing guidance.

## [2.0.0] - 2026-03-09

### Changed

- Reorganized skills directory structure: all GRACE skills moved to `skills/grace/` subfolder for better organization and namespacing.

## [1.3.0] - 2026-03-09

### Added

- Added `safe`, `balanced`, and `fast` execution profiles to `grace-multiagent-execute`.
- Added controller-built execution packets to reduce repeated plan and graph reads during execution.
- Added targeted graph refresh guidance for wave-level reconciliation.
- Added explicit verification levels for module, wave, and phase checks.
- Added this `CHANGELOG.md` file.

### Changed

- Aligned `grace-execute` with the newer packet-driven, controller-managed execution model.
- Updated `grace-generate` to support controller-friendly graph delta proposals in multi-agent workflows.
- Updated `grace-reviewer` to support `scoped-gate`, `wave-audit`, and `full-integrity` review modes.
- Updated `grace-refresh` to distinguish between `targeted` and `full` refresh modes.
- Updated GRACE subagent role prompts to match scoped reviews, controller-owned shared artifact updates, and level-based verification.
- Updated `README.md` and package metadata for the `1.3.0` release.

### Fixed

- Resolved the workflow conflict where `grace-generate` previously implied direct `knowledge-graph.xml` edits even when `grace-multiagent-execute` required controller-owned graph synchronization.
