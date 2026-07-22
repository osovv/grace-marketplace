# CLI Examples

## Explain a Lint Code

```bash
grace lint --explain scope.observed-write-overlap
```

Use this when a CI run or reviewer mentions a specific lint code and you want the built-in explanation plus remediation path.

## Validate Current State and a Selected Change

```bash
grace lint --path /path/to/project --assertions current --remediate --fail-on warnings
grace lint --path /path/to/project --change C-ADD-AUTH --assertions baseline --run-commands
grace lint --path /path/to/project --change C-ADD-AUTH --assertions target --run-commands
grace lint --path /path/to/project --change C-ADD-AUTH --assertions final --run-commands
```

Current mode validates durable state. Baseline, target, and final modes require one approved identity-matched active change. Final mode is the apply/archive gate: it performs full project validation, evaluates the selected target, preserves unrelated approved baseline checks, and skips only the selected plan's superseded baseline. `MustPassCommand` remains unevaluated unless `--run-commands` is supplied.

## Parallel-Safe Preflight

```bash
grace lint --path /path/to/project --parallel-preflight
```

Use this explicit gate before parallel-safe execution. It rejects unsupported scope syntax and conflicting approved-plan durable or observed scopes; ordinary lint still reports coexistence diagnostics without pretending that parallel execution was requested.

## Project Health With Module Summaries

```bash
grace status --path /path/to/project --with modules --json --fail-on errors
```

This gives you a CI-friendly JSON snapshot of project health, scope conflicts, and per-module health states.

## Module and Verification Navigation

```bash
grace module health M-AUTH --path /path/to/project
grace verification find auth --path /path/to/project
grace verification show V-M-AUTH --path /path/to/project
```

Use these commands when you want to narrow from project-level health to one module or one verification entry.

Lint, status, and navigation validate their inputs before returning records. JSON command failures are a single stable error envelope on stdout; text failures are concise, actionable, stack-free messages with a nonzero exit code.
