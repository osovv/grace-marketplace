---
name: grace-status
description: Show GRACE 4 project health across .grace context, graph, verification, active changes, scopes, and migration boundaries.
---

<skill>
<task>Run `grace status --path PROJECT --json` (add `--with modules` when module health is needed) and report current GRACE 4 state without mutating artifacts.</task>

<must_report>
- Project kind: GRACE 4, legacy GRACE 3 migration candidate, or missing GRACE; plus context completeness.
- Graph/verification projection integrity, routed coverage, and module counts.
- Active/archive bundle statuses and derived states.
- `needs-plan`, `needs-plan-approval`, `stale-plan`, `integrity-issues`, and `ready-to-execute` with readiness mutually exclusive from stale/integrity states.
- Route-aware explained/unexplained drift, scope coexistence warnings, and parallel blockers.
- Module-health load failure as integrity/degraded status rather than a crash.
- The next safe action: lint, migrate, specify, plan, or execute.
</must_report>

<commands>
- Current integrity: `grace lint --path PROJECT --assertions current`
- Parallel decision: `grace lint --path PROJECT --parallel-preflight`
- Status snapshot: `grace status --path PROJECT --with modules --json --fail-on errors`
</commands>

<hard_rules>Do not edit XML statuses. A draft spec without a plan is normal; an approved spec without a plan needs planning. A stale or integrity-invalid approved plan is never ready.</hard_rules>
</skill>
