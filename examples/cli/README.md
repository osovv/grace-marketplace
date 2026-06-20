# CLI Examples

## Explain a Lint Code

```bash
grace lint --explain scope.observed-write-overlap
```

Use this when a CI run or reviewer mentions a specific lint code and you want the built-in explanation plus remediation path.

## Validate a Project With Remediation Output

```bash
grace lint --path /path/to/project --remediate --fail-on warnings
```

This is the fast preflight before parallel-safe execution. The `--remediate` flag expands each issue with explanation and fix hints.

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
