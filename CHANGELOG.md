## <small>4.0.0-rc.2 (2026-07-13)</small>

### Summary

This release candidate closes release readiness gaps by hardening GRACE 4 artifact validation, stabilizing CLI subprocess tests, and improving the status and execution workflows. Change bundles are now more strictly validated—with required sections, bundle-identifier matching, and constraints preventing active plans without an approved spec. Graph and verification projections reject nested anchors and unindexed documents, and verification entries support a monorepo-safe Cwd contract for project-relative command paths. The status report now detects stale plans from failed baseline assertions and distinguishes explained from unexplained git drift, giving clearer next-action guidance. Release automation is strengthened with duplicate‑header detection, dedicated CLI validation in the release pipeline, and prerelease tagging in GitHub releases. These changes make the GRACE 4 model more robust for real-world adoption and safer to execute.

* test(cli): stabilize subprocess validation ([0bc8113](https://github.com/osovv/grace-marketplace/commit/0bc8113))
* fix(grace4): close release readiness gaps ([7e4acd9](https://github.com/osovv/grace-marketplace/commit/7e4acd9))
* fix(grace4): reject nested projection anchors ([e53dd61](https://github.com/osovv/grace-marketplace/commit/e53dd61))
* fix(release): mark prerelease github releases ([296842b](https://github.com/osovv/grace-marketplace/commit/296842b))

## <small>4.0.0-rc.1 (2026-06-21)</small>

### Summary

This release candidate stabilizes the release automation pipeline for the GRACE CLI package. The CLI metadata version (shown by `grace --version`) is now automatically kept in sync with the package version during releases, eliminating drift between the reported version and the actual release. Additionally, the npm publish workflow now correctly detects prerelease versions and publishes them with a matching dist-tag (for example, `rc`), so release candidates can be installed without affecting the stable `latest` tag. These changes make the release process more reliable and transparent for users who depend on the CLI or want to test release candidates.

* fix(release): publish prereleases with dist-tag ([e7ab422](https://github.com/osovv/grace-marketplace/commit/e7ab422))
* fix(release): sync cli metadata version ([1acafb8](https://github.com/osovv/grace-marketplace/commit/1acafb8))

## <small>4.0.0-rc.0 (2026-06-21)</small>

### Summary

This release candidate introduces the GRACE 4 artifact model, replacing the legacy shared-doc approach with a `.grace` project structure that uses parser-backed XML validation, deterministic graph and verification projections, a machine-checkable assertion vocabulary, and controlled active/archive change lifecycle bundles with `GraceChangeSpec` and `GraceChangePlan` artifacts. The CLI has been rewritten to validate only the `.grace` current state, with new `grace-spec` and `grace-migrate` skills joining the published surface, while `grace-multiagent-execute` is removed in favor of a unified `grace-execute` that offers both sequential and parallel-safe modes. An automated release workflow with conventional commits, changelog generation, and CI publishing has been added, along with a language-registry module, a Dart language adapter, CWD-aware verification utilities, and comprehensive test coverage across grammar projections, assertions, scope conflicts, and marketplace packaging.

* chore(release): add automated release workflow ([8b036e7](https://github.com/osovv/grace-marketplace/commit/8b036e7))
* fix: address review findings — trailing slash guard, wire check-references utility, Dart adapter thr ([73f2b20](https://github.com/osovv/grace-marketplace/commit/73f2b20))
* fix(grace4): finish release review cleanup ([fd72a91](https://github.com/osovv/grace-marketplace/commit/fd72a91))
* fix(grace4): unblock release candidate validation ([d65388d](https://github.com/osovv/grace-marketplace/commit/d65388d))
* fix(lint): resolve all vv-review findings - archived baseline, superseded ref, priority, packaging,  ([cade053](https://github.com/osovv/grace-marketplace/commit/cade053))
* add specs for grace4 ([582b391](https://github.com/osovv/grace-marketplace/commit/582b391))
* grace4-artifact-model chore(release): document 4.0 surface ([95e5cd2](https://github.com/osovv/grace-marketplace/commit/95e5cd2))
* grace4-artifact-model chore(validation): enforce grace4 surface ([78e4556](https://github.com/osovv/grace-marketplace/commit/78e4556))
* grace4-artifact-model feat(cli): wire grace4 navigation commands ([b8f1dbd](https://github.com/osovv/grace-marketplace/commit/b8f1dbd))
* grace4-artifact-model feat(grace4): add assertions and scope checks ([d99d96a](https://github.com/osovv/grace-marketplace/commit/d99d96a))
* grace4-artifact-model feat(grace4): add core types and project detection ([ee56275](https://github.com/osovv/grace-marketplace/commit/ee56275))
* grace4-artifact-model feat(grace4): build graph and verification projections ([1903134](https://github.com/osovv/grace-marketplace/commit/1903134))
* grace4-artifact-model feat(grace4): create XML parser adapter ([6dab7a3](https://github.com/osovv/grace-marketplace/commit/6dab7a3))
* grace4-artifact-model feat(grace4): implement artifact grammar validation ([7be6cd4](https://github.com/osovv/grace-marketplace/commit/7be6cd4))
* grace4-artifact-model feat(init): bootstrap .grace skeleton ([8483f74](https://github.com/osovv/grace-marketplace/commit/8483f74))
* grace4-artifact-model feat(lint): validate grace4 artifacts ([64ef4f8](https://github.com/osovv/grace-marketplace/commit/64ef4f8))
* grace4-artifact-model feat(query): use grace4 projections ([82bfa69](https://github.com/osovv/grace-marketplace/commit/82bfa69))
* grace4-artifact-model feat(skills): add spec and plan workflows ([1dda7a7](https://github.com/osovv/grace-marketplace/commit/1dda7a7))
* grace4-artifact-model feat(skills): align support workflows ([e26212b](https://github.com/osovv/grace-marketplace/commit/e26212b))
* grace4-artifact-model feat(skills): remove multiagent surface ([e735d6c](https://github.com/osovv/grace-marketplace/commit/e735d6c))
* grace4-artifact-model feat(status): report grace4 health ([dcfe326](https://github.com/osovv/grace-marketplace/commit/dcfe326))
* grace4-artifact-model test(grace4): add fixture builders ([3208c8f](https://github.com/osovv/grace-marketplace/commit/3208c8f))
* grace4-artifact-model test(grace4): expand coverage matrix ([64ae18a](https://github.com/osovv/grace-marketplace/commit/64ae18a))
* feat: add CWD-aware module-check comparison and replace duplicated CODE_EXTENSIONS ([3efc51e](https://github.com/osovv/grace-marketplace/commit/3efc51e))
* feat: add language-registry module, check-references utility, and CWD verification support ([bd3028e](https://github.com/osovv/grace-marketplace/commit/bd3028e))
* feat: create Dart language adapter and wire through language-registry ([643ba63](https://github.com/osovv/grace-marketplace/commit/643ba63))

## <small>3.11.0 (2026-04-19)</small>

### Added

- Added `grace verification find/show` so verification-plan entries are queryable without manual XML scanning.
- Added `grace module health` plus optional module health summaries in `grace status --with modules`.
- Added `grace lint --explain <code>`, remediation-aware text output, and configurable `--fail-on` policies for CI.
- Added release hygiene assets: `RELEASING.md`, `scripts/release-checklist.ts`, `.github/workflows/validate.yml`, and CLI examples under `examples/cli/`.

### Changed

- Strengthened the autonomy gate with technology-artifact checks, packet checkpoint requirements, module-implementation checks, test-file linkage checks, and marker-to-block validation.
- Enriched `grace lint` and `grace status` JSON output with schema/version metadata and summary counts for machine-readable automation.
- Extended marketplace validation to verify `package.json` version sync and require a matching `CHANGELOG.md` entry for the current version.

## <small>3.8.0 (2026-04-19)</small>

### Added

- Added `grace lint --profile autonomous` as a cheap autonomy-readiness gate before long autonomous runs.
- Added `grace status` for project health, autonomy blockers, and next-action guidance.

### Changed

- Reframed the marketplace, CLI docs, and GRACE skills around process-first execution, semantic anchoring, approved stacks, checkpoint reports, and operational packets.
- Updated `grace-init` templates so technology, development-plan, verification-plan, and operational-packets examples explicitly model autonomy policy and checkpoint handoff.

## <small>3.7.0 (2026-04-05)</small>

### Added

- Added `grace-cli`, a dedicated skill for using the optional `grace` binary as a GRACE-aware lint and artifact-query layer.

### Changed

- Updated skill trigger wording to use agent-neutral "Use when you ..." phrasing instead of Claude-specific wording.
- Reworked the README install guidance so GRACE skills are the primary surface, the CLI is a strongly recommended companion, and requirements/technology artifacts are designed together with the agent.

## <small>3.6.0 (2026-04-05)</small>

### Added

- Added a schema-aware GRACE query layer with `grace module find`, `grace module show`, and `grace file show`.
- Added artifact indexing that merges shared XML module records, module verification entries, implementation steps, and linked file-local markup.

### Changed

- Expanded the CLI surface from integrity-only linting into read/query navigation for public shared-doc context and private file-local context.
- Updated the shipped GRACE skills and README so agents know when to use `grace lint`, `grace module find`, `grace module show`, and `grace file show`.

## <small>3.5.0 (2026-04-05)</small>

### Changed

- Clarified across the marketplace skills that `docs/development-plan.xml` and `docs/knowledge-graph.xml` should describe only public module contracts and public module interfaces.
- Kept private helpers, internal types, and implementation-only orchestration details in file-local markup, local contracts, and semantic blocks instead of shared XML artifacts.
- Updated planning, refresh, reviewer, execution, refactor, explainer, init templates, and packaged mirrors to follow that boundary consistently.

## <small>3.4.0 (2026-04-05)</small>

### Changed

- Added a rich Python adapter without `pyright`, while keeping TypeScript/JavaScript on the TypeScript compiler API for exact export analysis.
- Made adapter failures non-fatal so linting can continue with structural checks and warnings.

## <small>3.3.0 (2026-04-05)</small>

### Changed

- Removed profile selection from `grace lint`; it now validates only against the current GRACE artifact set.
- Limited `.grace-lint.json` to the current schema and reject unknown keys instead of carrying compatibility paths for unused legacy config.

## <small>3.2.0 (2026-04-05)</small>

### Changed

- Refactored `grace lint` into a role-aware core plus language-adapter architecture with a JS/TS AST adapter.
- Added `ROLE` and `MAP_MODE` support for governed files so tests, barrels, configs, types, and scripts are linted by semantics instead of filename masks.
- Added `auto/current/legacy` profile support and `.grace-lint.json` repository configuration.

## <small>3.1.1 (2026-04-05)</small>

### Changed

- Documented the optional `grace` CLI inside `grace-explainer`, `grace-reviewer`, `grace-refresh`, and `grace-status` as a fast integrity preflight.
- Updated `CLAUDE.md` so future sessions treat the published `@osovv/grace-cli` package and `grace lint` workflow as part of the repo context.
- Switched the published CLI install example in `README.md` to `bun add -g @osovv/grace-cli`.

## <small>3.1.0 (2026-04-05)</small>

### Added

- Added `grace-refactor` for safe rename, move, split, merge, and extract workflows with synchronized contracts, graph entries, and verification refs.
- Added `docs/operational-packets.xml` templates to `grace-init` so projects get canonical `ExecutionPacket`, `GraphDelta`, `VerificationDelta`, and `FailurePacket` shapes.
- Added a Bun-based `grace` CLI on `citty` with a `lint` subcommand for unique XML tags, graph/plan/verification drift, and semantic markup integrity.

### Changed

- Updated execution, verification, ask, fix, status, and explainer skills to recognize `docs/operational-packets.xml` when present.
- Prepared the published CLI as the scoped npm package `@osovv/grace-cli` with a Bun-powered `grace` binary and prepublish verification checks.

## <small>3.0.4 (2026-04-05)</small>

### Changed

- Improved worker commit message format in `grace-multiagent-execute`: requires concrete file/function/export listing and descriptive body instead of generic "harden X" phrases.
- Improved controller meta-sync commit format: lists which artifacts were updated and per-module delta description instead of bare module list.

## <small>3.0.3 (2026-03-19)</small>

### Fixed

- Replaced the `plugins/grace/skills` symlink with real packaged skill files so OpenPackage can install the plugin for `opencode`.
- Added validator coverage for drift between canonical `skills/grace/*` content and the packaged copy inside `plugins/grace`.

## <small>3.0.2 (2026-03-19)</small>

### Fixed

- Re-aligned the Claude Code marketplace layout with the official docs by serving the `grace` plugin from `./plugins/grace`.
- Restored the plugin manifest to `plugins/grace/.claude-plugin/plugin.json` and removed the unsupported root plugin manifest.
- Updated marketplace validation to enforce relative plugin sources and to verify component paths inside each plugin source directory.

## <small>3.0.1 (2026-03-19)</small>

### Fixed

- Restored Claude Code marketplace packaging to use the repository root as the plugin source so bundled skill paths resolve inside the installed plugin.
- Added a root `.claude-plugin/plugin.json` manifest and removed the broken nested `plugins/grace` packaging layout.
- Updated validation to catch missing component paths inside the declared plugin source before release.

## <small>3.0.0 (2026-03-16)</small>

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

## <small>2.1.0 (2026-03-09)</small>

### Changed

- Workers now commit their implementation immediately after verification passes, rather than waiting for controller.
- Controller commits only shared artifacts (graph, plan), not implementation files.
- Updated `grace-execute` and `grace-multiagent-execute` with explicit commit timing guidance.

## <small>2.0.0 (2026-03-09)</small>

### Changed

- Reorganized skills directory structure: all GRACE skills moved to `skills/grace/` subfolder for better organization and namespacing.

## <small>1.3.0 (2026-03-09)</small>

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