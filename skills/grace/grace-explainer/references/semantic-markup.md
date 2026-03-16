# Semantic Markup Convention

Semantic markup in GRACE serves dual purpose: navigation anchors for RAG agents and attention anchors for LLM context management. Markers are not comments - they are load-bearing structure.

## Module Level (top of each file)

Every important source file must begin with:

```
// FILE: path/to/file.ext
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: [What this module does - one sentence]
//   SCOPE: [What operations are included]
//   DEPENDS: [List of module dependencies]
//   LINKS: [References to knowledge graph nodes]
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   exportedSymbol - one-line description
// END_MODULE_MAP
```

Adapt comment syntax to the project language (`#` for Python, `//` for Go/TS/Java, `--` for SQL).

Substantial test files should use the same structure when tests are the fastest way for future agents to understand behavior, fixtures, and expected evidence.

## Function or Component Level

Every exported function or component must have a contract:

```
// START_CONTRACT: functionName
//   PURPOSE: [What it does]
//   INPUTS: { paramName: Type - description }
//   OUTPUTS: { ReturnType - description }
//   SIDE_EFFECTS: [What external state it modifies]
//   LINKS: [Related modules/functions via knowledge graph]
// END_CONTRACT: functionName
```

## Code Block Level (inside functions)

```
// START_BLOCK_VALIDATE_INPUT
// ... code ...
// END_BLOCK_VALIDATE_INPUT
```

## Change Tracking

```
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v1.2.0 - What changed and why]
// END_CHANGE_SUMMARY
```

## Granularity Rules

1. Around 500 tokens per block. Too large and the model loses locality. Too small and the markup becomes noise.
2. Block names must be unique inside the file.
3. Every `START_BLOCK_X` must have a matching `END_BLOCK_X`.
4. Block names describe WHAT, not HOW.

## Logging Convention

All important logs should reference semantic blocks for traceability:

```
logger.info(`[ModuleName][functionName][BLOCK_NAME] message`, {
  correlationId,
  stableField: value,
});
```

This creates a direct link from runtime logs to source code blocks.

## Test and Trace Guidance

When a path is critical enough to verify, make the test and the logs meet in the middle:

- production code emits stable `[Module][function][BLOCK_NAME]` markers
- tests assert deterministic outcomes first
- tests assert markers or trace order when trajectory matters
- verification docs record which markers are required

Example:

```ts
expect(hasLogMarker("info", "[ChatDomain][createChat][BLOCK_INSERT_CHAT]")).toBe(true);
```

## Rules

1. Never remove semantic markup anchors casually.
2. When editing code, preserve block boundaries unless the edit truly requires restructuring.
3. If a block grows beyond the working window, split it into sub-blocks.
4. If you rename a block, update all log references and related verification entries.
5. `MODULE_MAP` must reflect the current exports of the file.
