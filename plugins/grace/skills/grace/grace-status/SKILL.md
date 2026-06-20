---
name: grace-status
description: Show GRACE 4 project health across .grace context, graph, verification, active changes, scopes, and migration boundaries.
---

<skill>
<task>
Produce a human-readable status report for the current project using GRACE 4 artifacts only.
</task>

<must_report>
- Project kind: GRACE 4, legacy GRACE 3 migration candidate, or missing GRACE.
- `.grace/context` completeness for requirements, technology, principles, deployment, and UX guidelines.
- Graph projection summary from `.grace/graph/index.xml` and routed graph documents.
- Verification projection summary from `.grace/verification/index.xml` and routed verification documents.
- Active and archived `.grace/changes/C-*` bundles with XML root statuses and derived states.
- Scope overlaps, unsafe concurrent writes, stale plans, assertion failures, and lint issue totals.
- Next action: `grace lint`, `grace-migrate`, `grace-spec`, `grace-plan`, or `grace-execute` as appropriate.
</must_report>

<hard_rules>
Do not edit XML statuses. Operational states are derived from current files, assertions, scopes, and validation evidence.
</hard_rules>
</skill>
