# Verification-Driven Development

In GRACE, verification is not an afterthought. It is a maintained architectural artifact.

## Core Idea

`.grace/verification/` answers the question:

"How will another agent prove that this module or flow is still correct?"

That proof has three layers:

1. deterministic assertions for exact outcomes
2. trace or log assertions for execution trajectory
3. phase-level or integration checks for merged surfaces

For longer autonomous runs, verification is also an autonomy gate. It must prove that another agent can continue or debug from the visible evidence instead of from hidden reasoning.

## Verification Plan Structure

The `.grace/verification/` directory holds one or more VD-* verification documents. Each VD-* document wraps V-M-* entries. The `index.xml` maps VD-* routes to their document paths.

Each `V-M-*` entry may contain:

- `<Cwd>` - one contained project-relative command working directory
- `<TestFiles><File>...</File></TestFiles>` - exact project-root-relative test paths
- `<Command>` - module-local verification command
- `<Scenario>` - named success or failure behavior
- `<Marker>` - required log markers for trace assertions

## Module Verification Entry

Example:

```xml
<V-M-CHATS>
  <Cwd>apps/server</Cwd>
  <TestFiles>
    <File>apps/server/src/chat/index.test.ts</File>
  </TestFiles>
  <Command>bun test src/chat/index.test.ts</Command>
  <Scenario>Generated title is assigned only when the chat is still untitled.</Scenario>
  <Scenario>Ownership failure rejects the mutation.</Scenario>
  <Marker>[ChatDomain][setGeneratedTitleIfEmpty][BLOCK_ASSIGN_GENERATED_TITLE]</Marker>
</V-M-CHATS>
```

## Log-Driven Development

Logs are evidence, not decoration.

Good GRACE logs are:

- tied to semantic blocks
- structured with stable fields
- safe to retain and inspect
- precise enough that a future agent can navigate back to the source block or the failing scenario

Example:

```ts
logger.info("[ChatDomain][createChat][BLOCK_INSERT_CHAT] Chat created", {
  chatId,
  userId,
  correlationId,
});
```

## Test Design Rules

1. Deterministic assertions first.
2. Add trace or log assertions when a plain return-value check is not enough.
3. Keep module-local tests close to the module when practical.
4. Use narrow fakes and stubs rather than giant opaque mocks.
5. If a bug escaped, strengthen the nearby verification entry and tests before closing the loop.
6. Map every accepted behavioral example to a named test and executable command. Use expectations derived from the approved contract, not the production calculation being tested. For stateful operations, observe persisted changes, unchanged state, and forbidden effects as required by the contract.
7. Treat missing, skipped, or unsupported mandatory cases as incomplete evidence. A compact set of examples in a worker packet does not reduce the approved test obligations. See [Behavioral Examples](behavioral-examples.md) for the complete workflow.

## Execution Levels

- **Module level**: fast checks that a worker can run alone
- **Wave level**: checks for only the merged surfaces touched in the wave
- **Phase level**: broader regression and integrity gates

Execution packets in `grace-execute` should reuse these levels instead of inventing new checks ad hoc.

Plan assertions use distinct evidence moments: `current` is the active-baseline preflight and is expected only before observed writes, selected `baseline` must pass immediately before edits, selected `target` proves the post-edit state, and selected `final` is the outer apply/archive gate. `MustPassCommand` is deliberately opt-in through `--run-commands` and contains leaf project evidence only; nesting `grace lint`, `grace status`, or another GRACE lifecycle command inside it is invalid.

`MustVerify` checks that a verification entry exists; it does not execute that entry's `Command` or evaluate its scenarios. Put required executable gates in the selected plan's `MustPassCommand` assertions and run them with `--run-commands`. Confirm the test runner actually exercised the required cases; a zero exit code alone does not establish case coverage.

## Autonomy Gate

Before sending a module to a longer autonomous run, check:

1. a `V-M-xxx` entry exists for the module
2. at least one module-local command exists
3. success and failure scenarios are named
4. required log markers or trace assertions make divergence observable
5. wave-level or phase-level follow-up is named when module-local checks are not enough
6. the GraceChangePlan scope defines DurableScope and ObservedWriteScope

## Failure Packets

When verification fails, capture:

- scenario that failed
- expected evidence
- observed evidence
- first divergent function or block
- next suggested action

This makes `grace-fix` faster and less lossy.
