---
description: 
alwaysApply: true
---

---
description: 
alwaysApply: true
---

# Repository Context

This repository is the GRACE marketplace package, not an end-user application.

GRACE means Graph-RAG Anchored Code Engineering: a contract-first AI engineering methodology built around semantic markup, XML planning artifacts, knowledge-graph navigation, and verification/log-driven execution.

## What This Repo Contains

- `skills/grace/*` contains the canonical skill sources.
- `plugins/grace/skills/grace/*` contains the packaged mirror used for Claude marketplace/plugin distribution.
- `.claude-plugin/marketplace.json` defines the marketplace entry.
- `plugins/grace/.claude-plugin/plugin.json` defines the packaged plugin manifest.
- `openpackage.yml` defines OpenPackage metadata.
- `README.md` is the user-facing overview and install guide.
- `package.json`, `src/grace.ts`, and `src/grace-lint.ts` define the published Bun-powered CLI package `@osovv/grace-cli` and the `grace lint` command.
- `scripts/validate-marketplace.ts` validates packaging, path safety, version sync, and packaged-vs-canonical drift.

## Core Purpose

The repository packages and distributes GRACE skills so coding agents can:

- initialize GRACE project artifacts
- plan module architecture and contracts
- design verification and log evidence
- execute plans sequentially or in parallel-safe waves
- inspect project health, refresh drift, review integrity, explain GRACE, and answer project questions

This repo is mainly about methodology content, skill instructions, and marketplace packaging.

## Important Working Rules

- Treat `skills/grace/*` as the main source of truth unless a task is explicitly about packaged output.
- Keep `plugins/grace/skills/grace/*` synchronized with the canonical `skills/grace/*` copies when published skills change.
- Keep versions synchronized across `README.md`, `openpackage.yml`, `.claude-plugin/marketplace.json`, and `plugins/grace/.claude-plugin/plugin.json`.
- Validate repo integrity with `bun run ./scripts/validate-marketplace.ts` after packaging or metadata changes.
- For CLI changes or when checking the public lint workflow, also use `bun run grace lint --path . --allow-missing-docs`.
- Do not assume every directory under `skills/grace/` is published; the actual shipped set is declared in `.claude-plugin/marketplace.json`.

## How To Think About Changes

- Skill text changes are product changes.
- Packaging/manifests/metadata changes are release-surface changes.
- Validation changes protect against drift between canonical skills and packaged copies.
- README and changelog updates are part of release hygiene, not optional polish.

## Default Mental Model For Future Sessions

If a request is ambiguous, assume the user is working on one of these areas:

- refining GRACE methodology instructions
- adding or updating a skill
- fixing packaging/marketplace installation
- maintaining the published `grace` CLI and its lint workflow
- keeping canonical and packaged skill trees in sync
- tightening verification around releases
