---
name: grace-plan
description: Read an approved GRACE 4 GraceChangeSpec and optional design context, then create a GraceChangePlan with assertions, scopes, tasks, and verification gates.
---

<skill>
<purpose>
Convert one approved active `GraceChangeSpec` into a `GraceChangePlan`. The plan is the executable contract for `grace-execute`; this skill does not implement source code.
</purpose>

<inputs>
- Required: `.grace/changes/active/C-CHANGE-ID/spec.xml`
- Optional: `.grace/changes/active/C-CHANGE-ID/design-context.xml`
- Context: `.grace/context/*.xml`, `.grace/graph/index.xml`, `.grace/verification/index.xml`, and routed current-state documents.
</inputs>

<preflight>
- Refuse missing specs.
- Refuse specs whose root is not `GraceChangeSpec`, lacks exactly one direct `C-*` wrapper, or has status other than `approved`.
- Refuse `draft`, `rejected`, `cancelled`, `applied`, or `superseded` specs.
- Treat `spec.xml` as normative. Read `design-context.xml` only as explanatory context; if it conflicts with the spec, the spec wins.
</preflight>

<must_do>
Produce `plan.xml` from `references/change-plan-template.xml` with:

- `GraceChangePlan graceVersion="4.0" status="draft"` unless the user explicitly approves the final plan in the same session.
- the same `C-*` wrapper as the spec.
- `IntentSummary` mapping spec goals to implementation outcomes.
- `BaselineAssertions` for current-state assumptions.
- `TargetAssertions` for required end state.
- `DurableScope` covering graph anchors, verification anchors, context artifacts, and graph/verification documents expected to change.
- `ObservedWriteScope` covering files and globs expected to be edited.
- `ImplementationPlan` with `T-*` tasks, dependencies, per-task acceptance criteria, and verification commands.
- explicit overlap or stale-state warnings surfaced to the user without silently mutating approved artifacts.
</must_do>

<hard_rules>
- Do not implement code.
- Do not silently approve a plan; approval requires explicit user confirmation.
- Do not edit current graph or verification artifacts unless the plan itself is the requested artifact change.
- Semantic anchors are XML tags, never attributes.
- After writing the plan, recommend `grace lint --path <project-root>` and `grace status --path <project-root>`.
</hard_rules>
</skill>
