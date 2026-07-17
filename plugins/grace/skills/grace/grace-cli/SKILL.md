---
name: grace-cli
description: Operate the GRACE 4 CLI for .grace linting, status, module navigation, verification navigation, and file-local semantic markup.
---

<skill>
<commands>
- Current lint: `grace lint --path PROJECT --assertions current`
- Selected baseline: `grace lint --path PROJECT --change C-ID --assertions baseline` (add `--run-commands` when the baseline declares `MustPassCommand`)
- Selected target: `grace lint --path PROJECT --change C-ID --assertions target --run-commands`
- Parallel preflight: `grace lint --path PROJECT --parallel-preflight`
- Status: `grace status --path PROJECT --with modules --json`
- Navigation: `grace module find|show`, `grace verification find|show`, and `grace file show`.
</commands>

<failure_contract>
Navigation validates Artifact Grammar and projections before returning records. JSON failures are one `{ "schemaVersion": "1.0.0", "ok": false, "error": { ... } }` object on stdout. Text failures are one concise actionable line with a nonzero exit code and no stack trace.
</failure_contract>

<runtime_contract>
TypeScript/JavaScript analysis is bundled. Python and Dart governed files require their runtimes on PATH; missing runtimes fail closed with actionable `analysis.runtime-missing` diagnostics instead of silently dropping parity checks.
</runtime_contract>

<migration_boundary>GRACE 4 commands do not dual-validate legacy GRACE 3 docs. Use `grace-migrate`.</migration_boundary>
</skill>
