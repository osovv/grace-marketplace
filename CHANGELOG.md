# Changelog

All notable changes to this project will be documented in this file.

The format is inspired by Keep a Changelog, and this project follows Semantic Versioning.

This changelog currently starts at `1.3.0`. Earlier history is available in the git log.

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
