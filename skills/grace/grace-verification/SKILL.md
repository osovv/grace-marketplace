---
name: grace-verification
description: "Design and enforce testing, traces, and log-driven verification for a GRACE project. Use when modules need stronger automated tests, execution-trace checks, or a maintained verification-plan.xml that autonomous and multi-agent workflows can trust."
---

Design verification that autonomous agents can trust: deterministic where possible, observable and traceable where equality checks alone are not enough.

## Prerequisites
- `docs/development-plan.xml` must exist with planned modules or module contracts
- `docs/verification-plan.xml` should exist; if it does not, create it from the GRACE init template before proceeding
- Read the relevant `MODULE_CONTRACT`, function contracts, semantic blocks, and existing tests first
- If no contract exists yet, route through `$grace-plan` before building verification

## Goal

Verification in GRACE is not just "did the final value match?"

It must answer:
- did the system produce the correct result?
- did it follow an acceptable execution path?
- can another agent debug the failure from the evidence left behind?

Use contracts for **expected behavior**, semantic blocks for **traceability**, and tests/logs for **evidence**.

`docs/verification-plan.xml` is the canonical place where this evidence model lives.

## Process

### Step 1: Load Verification Context
Read the smallest complete set of artifacts needed for the scope:

- `docs/requirements.xml`
- `docs/technology.xml`
- `docs/development-plan.xml`
- `docs/verification-plan.xml`
- relevant source files and nearby tests

When operating on one module, prefer that module's plan entry, verification entry, and local tests over rereading the whole repository.

### Step 2: Derive Verification Targets from Contracts and Flows
Read the module contracts, function contracts, and linked flows. Extract:

- success scenarios
- failure scenarios
- critical invariants
- side effects
- forbidden behaviors

Turn these into a verification matrix before writing or revising tests. Keep the matrix synced into `docs/verification-plan.xml`.

### Step 3: Design Observability
For each critical path, define the minimum telemetry needed to debug and verify it.

At a minimum:
- important logs must reference `[ModuleName][functionName][BLOCK_NAME]`
- each critical branch should be visible in the trace
- side effects should be logged at a high-signal level
- secrets, credentials, and sensitive payloads must be redacted or omitted

Prefer stable structured logs or stable key fields over prose-heavy log lines.

### Step 4: Build or Refresh `docs/verification-plan.xml`
Update the verification artifact so it becomes execution-ready.

For each relevant module, define or refresh:
- `V-M-xxx` verification entry
- target test files
- module-local verification commands
- success and failure scenarios
- required log markers and trace assertions
- wave-level and phase-level follow-up checks

Also refresh project-wide policy when needed:
- log format
- redaction rules
- deterministic-first policy
- module/wave/phase split

### Step 5: Choose Evidence Types Per Scenario
For each scenario, decide which evidence type to use:

- **Deterministic assertions** for stable outputs, return values, state transitions, and exact invariants
- **Trace assertions** for required execution paths, branch decisions, retries, and failure handling
- **Integration or smoke checks** for end-to-end viability
- **Semantic evaluation of traces** only when domain correctness cannot be expressed reliably with exact asserts alone

If an exact assert works, use it. Do not replace strong deterministic checks with fuzzy evaluation.

### Step 6: Implement AI-Friendly Tests and Evidence Hooks
Write tests and harnesses that:

1. execute the scenario
2. collect the relevant trace, logs, or telemetry
3. verify both:
   - outcome correctness
   - trajectory correctness

Typical trace checks:
- required block markers appeared
- forbidden block markers did not appear
- events occurred in the expected order
- retries stayed within allowed bounds
- failure mode matched the contract

Substantial test files may also use MODULE_CONTRACT, MODULE_MAP, semantic blocks, and CHANGE_SUMMARY if that makes them easier for future agents to navigate.

### Step 7: Use Semantic Verification Carefully
When strict equality is too weak or too brittle, use bounded semantic checks.

Allowed pattern:
- provide the evaluator with:
  - the contract
  - the scenario description
  - the observed trace or structured logs
  - an explicit rubric
- ask whether the evidence satisfies the contract and why

Disallowed pattern:
- asking a model to "judge if this feels correct"
- using raw hidden reasoning as evidence
- relying on unconstrained free-form log dumps without a rubric

### Step 8: Apply Verification Levels
Match the verification depth to the execution stage.

- **Module level**: worker-local typecheck, lint, unit tests, deterministic assertions, and local trace checks
- **Wave level**: integration checks only for the merged surfaces touched in the wave
- **Phase level**: full suite, broad traceability checks, and final confidence checks before marking the phase done

Do not require full-repository verification after every clean module if the wave and phase gates already cover that risk.

Make these levels explicit in `docs/verification-plan.xml` so execution packets can reuse them.

### Step 9: Failure Triage
When verification fails, produce a concise failure packet:

- contract or scenario that failed
- expected evidence
- observed evidence
- first divergent module/function/block
- suggested next action

Use this packet to drive `$grace-fix` or to hand off the issue to another agent without losing context.

## Verification Rules
- Deterministic assertions first, semantic trace evaluation second
- Logs are evidence, not decoration
- Every important log should map back to a semantic block
- Do not log chain-of-thought or hidden reasoning
- Do not assert on unstable wording if stable fields are available
- Prefer high-signal traces over verbose noise
- Keep `docs/verification-plan.xml` synchronized with real test files and commands
- Prefer source-adjacent tests and narrow fakes over giant opaque harnesses
- If verification is weak, improve observability before adding more agents
- Prefer module-level checks during worker execution and reserve broader suites for wave or phase gates

## Deliverables
When using this skill, produce:

1. an updated `docs/verification-plan.xml`
2. a verification matrix for the scoped modules or flows
3. the telemetry/logging requirements
4. the tests or harness changes needed
5. the recommended verification level split across module, wave, and phase
6. a brief assessment of whether the module is safe for autonomous or multi-agent execution

## When to Use It
- Before a first serious `$grace-execute` or `$grace-multiagent-execute` run
- Before enabling autonomous execution for a module
- When multi-agent workflows need trustworthy checks
- When tests are too brittle or too shallow
- When bugs recur and logs are not actionable
- When business logic is hard to verify with plain equality asserts alone
