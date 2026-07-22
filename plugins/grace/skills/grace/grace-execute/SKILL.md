---
name: grace-execute
description: Execute an approved GRACE 4 GraceChangePlan in sequential or parallel-safe mode with recovery-aware preflight and centralized durable apply.
---

<skill>
<preflight>
Require one active bundle with approved, identity-matched `spec.xml` and `plan.xml`. Approved plans are immutable. Read context, projections, assertions, scopes, task dependencies, and verification before editing.
</preflight>

<assertion_commands>
- Current validation: `grace lint --path PROJECT --assertions current`
- Selected baseline: `grace lint --path PROJECT --change C-ID --assertions baseline` (add `--run-commands` when the baseline declares `MustPassCommand`)
- Selected target without commands: `grace lint --path PROJECT --change C-ID --assertions target`
- Selected target with command evidence: `grace lint --path PROJECT --change C-ID --assertions target --run-commands`
- Final end-state validation: `grace lint --path PROJECT --change C-ID --assertions final` (add `--run-commands` when the target declares `MustPassCommand`)
- Parallel preflight: `grace lint --path PROJECT --parallel-preflight`
</assertion_commands>

<mode_selection>
Wait for explicit `sequential` or `parallel-safe` choice. Parallel-safe requires the explicit preflight to pass. Workers never mutate approved plans; durable `.grace` changes are applied centrally after observed work verifies.
</mode_selection>

<recovery_decision_table>
| state | required action |
| clean-to-start | Run selected baseline, then execute tasks. |
| partial-observed-writes | Inspect the declared observed scope and ask whether to resume or revert. |
| durable-state-changed | Hard stop; supersede and replan. Approved assertions are immutable. |
| target-already-satisfied | Run final end-state validation, opted-in command evidence when declared, durable reconciliation, and ask for explicit apply confirmation. |
| unsafe-unknown-drift | Hard stop and report unexplained files. |
</recovery_decision_table>

<execution_rules>
1. Run the selected baseline before implementation, including explicit `--run-commands` when its assertions declare `MustPassCommand`.
2. Execute one dependency-ready task or one verified parallel-safe batch at a time.
3. Run each task's acceptance and verification immediately.
4. Apply approved durable context, graph, and verification changes centrally.
5. Reconcile durable state, run plan gates, then run selected `--assertions final`, including `--run-commands` when `MustPassCommand` is declared. Final mode performs full project lint, evaluates the selected target, keeps unrelated approved baselines active, and does not re-evaluate the selected plan's superseded baseline.
6. Ask for explicit apply confirmation after fresh end-state evidence passes.
7. Only then set spec and plan to `applied` and archive the complete bundle.
8. Never edit approved assertions/scopes/tasks in place, bypass stale evidence, or continue through unknown drift.
</execution_rules>
</skill>
