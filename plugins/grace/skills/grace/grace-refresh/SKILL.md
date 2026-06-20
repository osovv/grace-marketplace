---
name: grace-refresh
description: Detect drift between observed repository state and durable GRACE 4 .grace current state, then help create reconciliation changes.
---

<skill>
<purpose>
Compare code, tests, and file-local markup against `.grace/context`, `.grace/graph`, `.grace/verification`, and active change scopes. This skill reports drift and proposes a normal `GraceChangeSpec`/`GraceChangePlan`; it does not silently mutate current state.
</purpose>

<workflow>
1. Run or request `grace lint --path <project-root>` and `grace status --path <project-root>`.
2. Inspect `.grace/graph/index.xml` and routed graph documents for stale, missing, or orphaned `M-*` and `DF-*` anchors.
3. Inspect `.grace/verification/index.xml` and routed verification documents for missing deterministic `V-M-*` coverage, stale commands, or missing evidence markers.
4. Compare file-local `LINKS:`, module contracts, tests, and log markers against durable anchors.
5. Report drift as findings with proposed reconciliation scope.
6. If changes are needed, route through `grace-spec` and `grace-plan` instead of direct mutation.
</workflow>
</skill>
