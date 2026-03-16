# Verification-Driven Development

In GRACE, verification is not an afterthought. It is a maintained architectural artifact.

## Core Idea

`docs/verification-plan.xml` answers the question:

"How will another agent prove that this module or flow is still correct?"

That proof has three layers:

1. deterministic assertions for exact outcomes
2. trace or log assertions for execution trajectory
3. phase-level or integration checks for merged surfaces

## Verification Plan Structure

Typical sections:

- `GlobalPolicy` - project-wide log format, redaction rules, and verification levels
- `CriticalFlows` - the high-risk product paths that must remain observable
- `ModuleVerification` - one `V-M-xxx` entry per important module
- `PhaseGates` - broader checks required before calling a phase done

## Module Verification Entry

Example:

```xml
<V-M-CHATS MODULE="M-CHATS" PRIORITY="high">
  <test-files>
    <file>apps/server/src/chat/index.test.ts</file>
  </test-files>
  <module-checks>
    <check-1>bun test apps/server/src/chat/index.test.ts</check-1>
  </module-checks>
  <scenarios>
    <scenario-1 kind="success">Generated title is assigned only when the chat is still untitled.</scenario-1>
    <scenario-2 kind="failure">Ownership failure rejects the mutation.</scenario-2>
  </scenarios>
  <required-log-markers>
    <marker-1>[ChatDomain][setGeneratedTitleIfEmpty][BLOCK_ASSIGN_GENERATED_TITLE]</marker-1>
  </required-log-markers>
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

## Execution Levels

- **Module level**: fast checks that a worker can run alone
- **Wave level**: checks for only the merged surfaces touched in the wave
- **Phase level**: broader regression and integrity gates

Execution packets in `grace-execute` and `grace-multiagent-execute` should reuse these levels instead of inventing new checks ad hoc.

## Failure Packets

When verification fails, capture:

- scenario that failed
- expected evidence
- observed evidence
- first divergent function or block
- next suggested action

This makes `grace-fix` faster and less lossy.
