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
- Check accepted rules and examples for contradictions or unresolved expectations. Return them for spec correction and approval; do not silently choose an interpretation while planning.
- Run `grace lint --path PROJECT --assertions current` before planning and surface stale or invalid active baselines.
</preflight>

<approved_plan_immutability>
- If `plan.xml` already exists with status `approved`, stop before writing.
- Do not refresh `BaselineAssertions`, `TargetAssertions`, `DurableScope`, `ObservedWriteScope`, or tasks in place.
- Create a new `C-*` bundle and mark the old bundle superseded with an explicit replacement reference.
</approved_plan_immutability>

<must_do>
Produce `plan.xml` from `references/change-plan-template.xml` as draft unless the user explicitly approves the completed plan. Require a matching `C-*` wrapper, meaningful intent, non-empty machine-checkable baseline and target assertions, explicit durable and observed scopes, and unique acyclic `T-NNN` tasks. A scope with no writes must use an explicit `<None />` marker; prose such as "none" is invalid. Every task has one `Title`, one `DependsOn` element listing zero or more predecessors as canonical comma-separated `T-NNN` values (for example `<DependsOn>T-001, T-002</DependsOn>`), non-empty acceptance criteria, and non-empty verification commands. Dependencies form a directed acyclic graph: list only true predecessors and never linearize independent tasks into a chain to express ordering. Surface stale-state and coexistence warnings, and reject unsupported scope glob syntax instead of guessing.
</must_do>

<acceptance_mapping>
- Inventory every accepted criterion and behavioral example from the approved spec. Map the full required inventory to tasks, test files, selectors or test names, runnable leaf commands and expected evidence. A compact example selection for a worker's prompt must never reduce the required verification set.
- Keep spec labels as plain text references in task `Criterion` text and ordinary `Scenario`/`Name` fields. Task acceptance must retain non-empty direct `Criterion` text. These mappings are reviewed conventions, not new anchor families or native CLI case accounting.
- Identify the observable boundary and an oracle derived from the accepted rule for each mapped check. Expected evidence should identify the named tests and observations to compare with the spec, not a second source of expectations. Plan a distinguishing negative implementation variant or equivalent check when needed to show that the oracle catches the intended mistake.
- Allocate relevant boundary, rejection, unchanged-state and forbidden-effect checks; include failure/concurrency checks and real substrate where the accepted behavior requires them. Do not replace a required integration check with a mock-only test. State any external blocker instead of silently dropping the criterion.
- Use [behavioral examples](../grace-explainer/references/behavioral-examples.md) for a worked rule-to-task-to-test mapping. Keep the mapping in the existing plan and project verification artifacts; no extra case registry or companion file is required.
</acceptance_mapping>

<command_phase_rules>
- `current` is an active-baseline preflight and is valid only before observed writes begin.
- `baseline` is the selected pre-edit gate, `target` is selected post-edit evidence, and `final` is the outer apply/archive gate owned by `grace-execute`.
- `MustVerify` checks that a module has a verification entry; it does not demonstrate accepted behavior. `MustPassCommand` checks actual command results with explicit execution opt-in; the project's tests must supply the behavioral assertions and report what ran.
- `MustPassCommand` contains leaf project evidence such as tests, typecheck, build, format, or package checks. Never place `grace lint`, `grace status`, or another GRACE lifecycle command inside it.
- Never put `--assertions current` in `TargetAssertions` or in task verification that runs after writes. Use selected target/final lint externally instead.
- A `MustPassCommand` must complete within its declared `budgetSeconds` (absent, the global `--command-timeout` applies) on the reference host; declare the budget you have measured rather than inheriting a default that will kill the command mid-gate.
- A whole-suite command whose runtime is dominated by substrate startup — containers, databases, browsers, emulators — belongs in an acceptance tier, not in the gate; never declare both a whole-suite command and the file-level commands it already re-runs.
</command_phase_rules>

<validation>
- Active-baseline preflight: `grace lint --path PROJECT --assertions current`
- Parallel safety: `grace lint --path PROJECT --parallel-preflight`
- Plan post-edit execution through `grace lint --path PROJECT --change C-ID --assertions target --run-commands`; `grace-execute` owns the corresponding `--assertions final --run-commands` outer gate. These are later execution steps, not evidence collected while planning.
- Before approval, check that every accepted criterion/example has a task and test/evidence mapping, and that required acceptance-tier checks remain scheduled alongside the selected gate.
- Recommend `grace status --path PROJECT --json` after approval.
</validation>

<hard_rules>
Do not implement code, silently approve a plan, overwrite an approved plan, or mutate current graph/verification artifacts while planning. Semantic anchors are canonical XML tags, never attributes.
</hard_rules>
</skill>
