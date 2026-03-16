---
name: grace-refresh
description: "Synchronize GRACE shared artifacts with the actual codebase. Use targeted refresh after controlled waves, or full refresh after refactors and when you suspect wider drift between the graph, verification plan, and code."
---

Synchronize the GRACE shared artifacts with the actual codebase.

## Refresh Modes

Default to the narrowest scope that can still answer the drift question.

### `targeted` (default during active execution)
- scan only changed modules, touched imports, and directly affected dependency surfaces
- use when a controller already has wave results or graph delta proposals
- ideal after a clean multi-agent wave

### `full`
- scan the whole source tree
- use after refactors, manual edits across many modules, phase completion, or when targeted refresh finds suspicious drift

## Process

### Step 1: Choose Scope
Decide whether the refresh should be `targeted` or `full`.

1. If the caller provides changed files, module IDs, or graph delta proposals, start with `targeted`
2. If no reliable scope is available, or the graph may have drifted broadly, use `full`
3. Escalate from `targeted` to `full` when the localized scan reveals wider inconsistency

### Step 2: Scan the Selected Scope
For each file in scope, extract:
- MODULE_CONTRACT (if present)
- MODULE_MAP (if present)
- imports and exports
- CHANGE_SUMMARY (if present)
- nearby module-local test files, required log markers, and verification commands when available

In `targeted` mode, also inspect the immediate dependency surfaces needed to validate CrossLinks accurately.

### Step 3: Compare with Shared Artifacts
Read `docs/knowledge-graph.xml` and, when present, `docs/verification-plan.xml`. Identify:
- **Missing modules**: files with MODULE_CONTRACT that are not in the graph
- **Orphaned modules**: graph entries whose files no longer exist in the scanned scope
- **Stale CrossLinks**: dependencies in the graph that do not match actual imports
- **Missing contracts**: files that should be governed by GRACE but have no MODULE_CONTRACT
- **Missing verification entries**: governed modules or tests with no corresponding `V-M-xxx` entry
- **Stale verification refs**: verification entries whose test files, commands, or required markers no longer match the scoped code
- **Escalation signals**: evidence that the problem extends beyond the scanned scope

### Step 4: Report Drift
Present a structured report:

```text
GRACE Integrity Report
======================
Mode: targeted / full
Scope: [modules or files]
Synced modules: N
Missing from graph: [list files]
Orphaned in graph: [list entries]
Stale CrossLinks: [list]
Files without contracts: [list files]
Missing verification entries: [list modules]
Stale verification refs: [list entries]
Escalation: no / yes - reason
```

### Step 5: Fix (with user approval)
For each issue, propose a fix:
- Missing from graph - add an entry using the unique ID-based tag convention
- Orphaned - remove or repair the stale graph entry
- Stale links - update CrossLinks from actual imports
- No contracts - generate or restore the missing MODULE_CONTRACT from code analysis and plan context
- Missing verification entries - add or repair the matching `V-M-xxx` block in `docs/verification-plan.xml`
- Stale verification refs - update test files, commands, or required log markers from the real scoped code

Ask the user for confirmation before applying fixes.

### Step 6: Update Shared Artifacts
Apply approved fixes to `docs/knowledge-graph.xml` and `docs/verification-plan.xml` as needed. Update versions only after the selected refresh scope is reconciled.

## Rules
- Do not scan the whole repository after every clean wave if a targeted refresh can answer the question
- Prefer controller-supplied graph delta proposals as hints, but validate them against real files
- Prefer controller-supplied verification delta proposals as hints, but validate them against real tests and commands
- Escalate to `full` whenever targeted evidence suggests broader drift
