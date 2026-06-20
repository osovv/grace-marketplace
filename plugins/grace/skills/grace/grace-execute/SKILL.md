---
name: grace-execute
description: Execute an approved GRACE 4 GraceChangePlan in sequential or parallel-safe mode with recovery-aware preflight and centralized durable apply.
---

<skill>
<preflight>
Require one active bundle under `.grace/changes/active/C-*` with `spec.xml` status `approved` and `plan.xml` status `approved`. Confirm the same `C-*` wrapper appears in both files. Read `.grace/context`, `.grace/graph`, `.grace/verification`, `BaselineAssertions`, `TargetAssertions`, `DurableScope`, and `ObservedWriteScope` before editing code.
</preflight>

<mode_selection>
Present execution modes and wait for explicit user choice:

- `sequential`: run `T-*` tasks in dependency order in the current session or bounded worker loop.
- `parallel-safe`: group independent `T-*` tasks only when scopes do not overlap and verification can be merged safely.

Durable `.grace` updates are centralized after verified observed changes; workers do not mutate approved plans independently.
</mode_selection>

<recovery_states>
- `clean-to-start`: assertions and scopes match the approved plan.
- `partial-observed-writes`: source files changed but durable state is not updated; inspect and either resume or revert with user approval.
- `durable-state-changed`: graph, verification, or context changed after approval; hard stop and replan or explicitly refresh assertions.
- `target-already-satisfied`: target assertions already pass; ask whether to mark applied or supersede.
- `unsafe-unknown-drift`: drift cannot be explained safely; hard stop and hand off findings.
</recovery_states>

<execution_rules>
1. Run baseline assertions before implementation.
2. Execute one `T-*` task or one parallel-safe batch at a time.
3. Run task verification immediately after changes.
4. Run target assertions before durable apply.
5. Update `.grace/graph` and `.grace/verification` only according to the approved plan, then set spec/plan status to `applied` and archive the bundle after successful validation.
6. Never silently edit approved plans, bypass stale assertions, or continue through unknown drift.
</execution_rules>
</skill>
