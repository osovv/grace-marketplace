---
name: grace-plan
description: Read an approved GRACE 4 GraceChangeSpec and optional design context, then create a GraceChangePlan with assertions, scopes, tasks, and verification gates.
---

<skill>
<purpose>Convert one approved active `GraceChangeSpec` into the executable `GraceChangePlan`; do not implement source code.</purpose>

<inputs>
- Required: `.grace/changes/active/C-CHANGE-ID/spec.xml`
- Optional: sibling `design-context.xml`
- Current state: `.grace/context`, graph and verification indexes, and their routed documents
</inputs>

<preflight>
- Require `.grace/changes/active/C-CHANGE-ID/spec.xml` with `GraceChangeSpec`, status `approved`, and exactly one matching direct `C-*` wrapper.
- Refuse draft, rejected, cancelled, applied, or superseded specs.
- Treat optional `design-context.xml` as explanatory; `spec.xml` wins on conflict.
- Run `grace lint --path PROJECT --assertions current` before planning and surface stale or invalid active baselines.
</preflight>

<approved_plan_immutability>
- If `plan.xml` already exists with status `approved`, stop before writing.
- Do not refresh `BaselineAssertions`, `TargetAssertions`, `DurableScope`, `ObservedWriteScope`, or tasks in place.
- Create a new `C-*` bundle and mark the old bundle superseded with an explicit replacement reference.
</approved_plan_immutability>

<must_do>
Produce `plan.xml` from `references/change-plan-template.xml` as draft unless the user explicitly approves the completed plan. Require a matching `C-*` wrapper, meaningful intent, non-empty machine-checkable baseline and target assertions, explicit durable and observed scopes, and unique acyclic `T-NNN` tasks. A scope with no writes must use an explicit `<None />` marker; prose such as "none" is invalid. Every task has one `Title`, one `DependsOn`, non-empty acceptance criteria, and non-empty verification commands. Surface stale-state and coexistence warnings, and reject unsupported scope glob syntax instead of guessing.
</must_do>

<command_phase_rules>
- `current` is an active-baseline preflight and is valid only before observed writes begin.
- `baseline` is the selected pre-edit gate, `target` is selected post-edit evidence, and `final` is the outer apply/archive gate owned by `grace-execute`.
- `MustPassCommand` contains leaf project evidence such as tests, typecheck, build, format, or package checks. Never place `grace lint`, `grace status`, or another GRACE lifecycle command inside it.
- Never put `--assertions current` in `TargetAssertions` or in task verification that runs after writes. Use selected target/final lint externally instead.
</command_phase_rules>

<validation>
- Active-baseline preflight: `grace lint --path PROJECT --assertions current`
- Parallel safety: `grace lint --path PROJECT --parallel-preflight`
- Recommend `grace status --path PROJECT --json` after approval.
</validation>

<hard_rules>
Do not implement code, silently approve a plan, overwrite an approved plan, or mutate current graph/verification artifacts while planning. Semantic anchors are canonical XML tags, never attributes.
</hard_rules>
</skill>
