---
name: grace-verification
description: Design and maintain GRACE 4 verification entries, commands, scenarios, markers, and assertion evidence under .grace/verification.
---

<skill>
<purpose>
Strengthen deterministic verification for modules and changes. Verification state lives in `.grace/verification/index.xml` and routed verification documents. Each durable module should have deterministic `V-M-*` coverage unless an explicit exception is planned.
</purpose>

<workflow>
1. Read the approved spec's general rules and named contrasting behavior examples, relevant `.grace/graph` anchors, and current `V-M-*` entries.
2. Bind every accepted example to a test file, named test or selector, and runnable command; identify additional scenarios, required log markers, and trace assertions.
3. Ensure commands are deterministic and runnable from the project root or documented cwd.
4. Update or propose `.grace/verification` changes through the active change plan.
5. Run the commands and record fresh evidence in the response.
</workflow>
<behavioral_verification>
Follow [Behavioral examples](../grace-explainer/references/behavioral-examples.md). Use repeated exact `<Scenario>` elements under the owning `V-M-*` and exact `<Command>` and `<TestFiles><File>...</File></TestFiles>` fields. Preserve local names and an unambiguous mapping to the owning contract's rule and named tests. A shared entry-level file/command may cover several scenarios; make the test-name mapping explicit. These are authoring conventions on grammar 4.0, not a native case registry or result parser. Do not rename evidence fields to unique case tags.

Derive expected values from the approved rule and independently specified fixtures, never by calling production logic to calculate its own expected answer. For stateful cases, assert the result, before/after state, unchanged state, and forbidden effects that the rule requires. Use the real database, transaction, authorization boundary, or other substrate when its semantics determine the result; a mock-only test cannot establish those guarantees.

Select boundary, rejection, fault, concurrency, and property checks according to the rule and risk. Cover plausible incorrect interpretations with contrasting cases; record why relevant checks are excluded and obtain approval for omissions or deferrals. Inspect whether assertions would reject the intended mistake; use a deliberate incorrect result or implementation as a negative control when oracle complexity or risk warrants it. Do not weaken expectations, remove assertions, skip required cases, or replace the relevant substrate merely to get a pass; resolve a disputed rule through the spec/plan lifecycle.
</behavioral_verification>
<cwd_contract>
When verification commands run from a workspace or package directory, add one direct `<Cwd>relative/project/path</Cwd>` child to the owning `V-M-*` entry. Keep declared `<TestFiles><File>...</File></TestFiles>` paths project-root-relative; the CLI uses `Cwd` only to compare them with cwd-relative command arguments.
</cwd_contract>
<evidence_contract>
Use `<Marker>` when module health must prove a runtime log or trace emission from linked implementation code. Use `<TraceAssertion>` for deterministic test or trace evidence that does not require runtime logging, such as pure functions, type-level modules, and core libraries. A non-empty marker or trace assertion satisfies the module-health evidence requirement; only authored markers require matching runtime emission and `BLOCK_*` evidence.

`MustVerify` proves that a verification entry exists; it does not execute that entry's commands or prove its examples. `--run-commands` executes selected `MustPassCommand` assertions, not `Scenario`, `ExpectedCommand`, or task verification text. Inspect actual test results for missing, skipped, or filtered accepted examples and record fresh evidence after changes to implementation, fixtures, or expectations.
</evidence_contract>
<gate_task_contract>
Reference named project tasks in `MustPassCommand` and `ExpectedCommand` (for example `bun run gate:e2e`) instead of inline `;`-chains. Decompose full gates into granular named tasks (`gate:test`, `gate:typecheck`, `gate:build`, `gate:e2e`) so a selective re-run is just running that task, timeouts map to one coherent unit, and `grace lint --run-commands` reports each gate step with its own timing and log.
</gate_task_contract>
<flake_contract>
A flaky gate is a defect of the verification entry, not a reason to re-run blindly. Diagnose from the per-attempt logs under `~/.cache/grace/run-commands/`. Decompose the gate task or add declared runner-level retries inside the task itself (for example playwright `--retries`) while retaining per-attempt failures. Quarantining a mandatory scenario requires an explicitly approved deferral through the spec/plan lifecycle; quarantine alone never satisfies acceptance. Silent manual re-runs are not a fix: grace records every run honestly, and nondeterministic verification undermines assertion evidence.
</flake_contract>
</skill>
