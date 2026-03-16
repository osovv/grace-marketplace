---
name: grace-multiagent-execute
description: "Execute a GRACE development plan in controller-managed parallel waves with selectable safety profiles, verification-plan excerpts, batched shared-artifact sync, and scoped reviews."
---

Execute a GRACE development plan with multiple agents while keeping planning artifacts and shared context consistent.

## Prerequisites
- `docs/development-plan.xml` must exist with module contracts and implementation order
- `docs/knowledge-graph.xml` must exist
- `docs/verification-plan.xml` should exist with module-local verification commands and gate expectations
- If the plan or graph is missing, stop immediately and tell the user to run `$grace-plan` themselves before dispatching a large wave
- If the verification plan is missing or still skeletal, stop immediately and tell the user to run `$grace-verification` themselves before dispatching a large wave
- Prefer this skill only when module-local verification commands already exist or can be defined clearly

## Core Principle

Parallelize **module implementation**, not **architectural truth**.

- One controller owns shared artifacts: `docs/development-plan.xml`, `docs/knowledge-graph.xml`, `docs/verification-plan.xml`, phase status, and execution queue
- Worker agents own only their assigned module files and module-local tests
- Reviewers validate module outputs before the controller merges graph and plan updates
- Speed should come from better context packaging, batched shared-artifact work, and scoped reviews - not from letting workers invent architecture

If multiple agents edit the same module, the same shared XML file, or the same tightly coupled slice, this is not a multi-agent wave. Use `$grace-execute` instead.

## Execution Profiles

Default to `balanced` unless the user asks otherwise.

### `safe`
- Ask for approval on the proposed waves before dispatch
- Run contract review and verification review for every module output
- Run targeted graph sync after each wave and a full refresh at each phase boundary
- Use when modules are novel, risky, or touch poorly understood integration surfaces

### `balanced` (default)
- Parse plan and graph once at the start of the run
- Ask for one approval on the execution schedule up front unless the plan changes mid-run
- Give workers compact execution packets instead of making each worker reread full XML artifacts
- Run module-local verification per worker, scoped gate reviews per module, and batched integrity checks per wave or phase
- Run targeted graph sync after each wave and full refresh only at phase boundaries, when drift is suspected, or at final wrap-up

### `fast`
- Use only for mature codebases with strong verification and stable architecture
- Ask for one approval for the whole run unless a blocker or plan change appears
- Keep worker packets compact and require only the minimum context needed for exact scope execution
- Block only on critical scoped review issues during a wave, then batch the deeper integrity audit at phase end or final wrap-up
- Reserve full refresh for phase completion or final reconciliation

Every module still gets a fresh worker. Do not optimize this workflow by reusing worker sessions across modules.

## Process

### Step 1: Build the Execution Waves Once
Read `docs/development-plan.xml`, `docs/knowledge-graph.xml`, and `docs/verification-plan.xml` once per run, then build the controller view of the execution queue.

1. Parse pending `Phase-N` and `step-N` entries
2. Group steps into **parallel-safe waves**
3. A step is parallel-safe only if:
   - all of its dependencies are already complete
   - it has a disjoint write scope from every other step in the wave
   - it does not require shared edits to the same integration surface
4. Choose the execution profile: `safe`, `balanced`, or `fast`
5. For each wave, prepare a compact **execution packet** for every module containing:
    - module ID and purpose
    - target file paths and exact write scope
    - module contract excerpt from `docs/development-plan.xml`
    - module graph entry excerpt from `docs/knowledge-graph.xml`
    - dependency contract summaries for every module in `DEPENDS`
    - verification excerpt from `docs/verification-plan.xml`, including module-local commands, required scenarios, required log markers, and target test files
    - wave-level integration checks that will run after merge
    - expected graph delta fields: imports, exports, annotations, and CrossLinks
    - expected verification delta fields: test files, commands, markers, and phase follow-up notes

Present the proposed waves, selected profile, and packet scopes to the user. In `safe`, wait for approval before each dispatch. In `balanced` and `fast`, one up-front approval is enough unless the plan changes.

### Step 2: Assign Ownership
Before dispatching, define ownership explicitly:

- **Controller**:
  - owns `docs/development-plan.xml`
  - owns `docs/knowledge-graph.xml`
  - owns `docs/verification-plan.xml`
  - owns wave packets, phase completion, and commits that touch shared artifacts
- **Worker agent**:
  - owns one module or one explicitly bounded slice
  - may edit only that module's source files and module-local tests
  - must not change shared planning artifacts directly
- **Reviewer agent**:
  - read-only validation of contract compliance, GRACE markup, imports, graph delta accuracy, and verification evidence

If a worker discovers that a missing module or new dependency is required, stop that worker and ask the user to revise the plan before proceeding. Do not allow silent architectural drift.

### Step 3: Dispatch Fresh Worker Agents Per Wave
For each approved wave:

1. Dispatch one fresh worker agent per module
2. Give each worker only the execution packet and the files inside its write scope
3. Require the worker to:
   - generate or update code using the module contract and verification excerpt from the packet
   - preserve MODULE_CONTRACT, MODULE_MAP, CHANGE_SUMMARY, function contracts, and semantic blocks
   - add or update module-local tests only
   - preserve or add required stable log markers for critical branches
   - run module-local verification only
   - **commit their work after module-local verification passes** with format:
      ```
      grace(MODULE_ID): short description
      
      Wave N, Phase M
      ```
   - return a result packet with changed files, verification evidence, graph delta proposal, verification delta proposal, commit hash, and any integration assumptions

### Step 4: Review with the Smallest Safe Scope
After each worker finishes:

1. Run a scoped contract review against the changed files and execution packet
2. Run a scoped verification review against the module-local tests and verification evidence
3. Escalate to a full `$grace-reviewer` audit only when:
    - cross-module drift is suspected
    - the graph delta contradicts the packet or actual imports
    - the verification delta contradicts the packet or actual tests/log markers
    - verification is too weak for the chosen profile
    - a phase boundary audit is due
4. If issues are found:
   - send the same worker back to fix them
   - re-run only the affected reviews unless escalation is required
5. Only approved module outputs may move to controller integration

### Step 5: Controller Integration and Batch Graph Sync
After all modules in the wave are approved:

1. Integrate the accepted module outputs
2. Apply graph delta proposals once, centrally, to `docs/knowledge-graph.xml`
3. Apply verification delta proposals once, centrally, to `docs/verification-plan.xml`
4. Update `docs/development-plan.xml` step status once per wave
5. Run targeted `$grace-refresh` against the changed modules and touched dependency surfaces
6. If targeted refresh reports wider drift, escalate to a full refresh before the next wave
7. If the wave reveals weak or missing automated checks, stop the run and tell the user to run `$grace-verification` themselves before continuing

### Step 6: Verify by Level
Run verification at the smallest level that still protects correctness.

- **Worker level**: module-local typecheck, lint, unit tests, and deterministic local assertions
- **Wave level**: integration checks only for the merged surfaces touched by the wave
- **Phase level**: full suite, full integrity audit, and final graph plus verification reconciliation before marking the phase done

Do not run full-repository tests and full-repository graph scans after every successful module unless the risk profile requires it.

### Step 7: Controller Shared-Artifact Commits and Report
After each wave, the controller commits only shared artifacts that changed:

- Update `docs/knowledge-graph.xml`, `docs/verification-plan.xml`, and `docs/development-plan.xml` with wave results
- Commit with format:
  ```
  grace(meta): sync after wave N

  Modules: M-xxx, M-yyy
  ```

Worker implementation commits are already done per module in Step 3. Controller commits are only for shared planning artifacts.

After each wave, report:

```text
=== WAVE COMPLETE ===
Wave: N
Profile: safe / balanced / fast
Modules: M-xxx, M-yyy
Approved: count/count
Graph sync: targeted passed / targeted fixed / escalated to full refresh
Verification: module-local passed / wave checks passed / follow-up required
Remaining waves: count
```

## Dispatch Rules
- Parse shared XML artifacts once per run unless the plan changes
- Prefer controller-built execution packets over repeated raw XML reads by workers
- Parallelize only across independent modules, never across unknown coupling
- Do not let workers invent new architecture
- Do not let workers edit the same shared XML artifacts in parallel
- Do not reuse worker sessions across modules; keep workers fresh and packets compact
- Give every worker exact file ownership and exact success criteria
- **Workers must commit their implementation after verification passes - do not wait for controller**
- Controller commits only shared artifacts (graph, plan, verification), not implementation files
- Prefer targeted refresh and scoped review during active waves
- Reserve full reviewer audits and full refresh scans for phase boundaries, drift suspicion, or critical failures
- If verification is weak, slow down and move to `safe` rather than pretending `fast` is safe

## When NOT to Use
- Only one module remains
- Steps are tightly coupled and share the same files
- The plan is still changing frequently
- The team has not defined reliable module-local verification yet

Use `$grace-execute` for sequential execution when dependency risk is higher than the parallelism gain.
