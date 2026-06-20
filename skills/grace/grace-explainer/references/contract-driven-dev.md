# Contract-Driven Development

In GRACE, the contract is the source of truth. Code implements the contract, not the other way around.

## The Rule

**Never write code without a contract.** Before generating or editing any module, create or update its MODULE_CONTRACT with PURPOSE, SCOPE, INPUTS, OUTPUTS.

## MODULE_CONTRACT

Every file starts with:

```
// START_MODULE_CONTRACT
//   PURPOSE: [What this module does — one sentence]
//   SCOPE: [What operations are included]
//   DEPENDS: [List of module dependencies by M-xxx ID]
//   LINKS: [Knowledge graph node references]
// END_MODULE_CONTRACT
```

The contract is written before the code. It comes from the GraceChangeSpec (`.grace/changes/active/*/spec.xml`), which was approved by the user during the `$grace-spec` phase.

Name things semantically. A contract is much stronger when its module names, PURPOSE text, and block labels already encode the intended transformation instead of forcing the agent to infer it from abstract placeholders.

Important distinction:
- `.grace/graph/` and `.grace/verification/` XML artifacts carry the module's public contract and public interface
- private helpers, internal normalization steps, and implementation-only types stay in the source file header and local contracts

## Function Contracts

Every exported function or component must have a contract placed before function signature and docstrings/comments:

```
// START_CONTRACT: functionName
//   PURPOSE: [What it does — one sentence]
//   INPUTS: { paramName: Type — description }
//   OUTPUTS: { ReturnType — description }
//   SIDE_EFFECTS: [What external state it modifies, or "none"]
//   LINKS: [Related modules/functions via knowledge graph]
// END_CONTRACT: functionName
```

## Development Flow

```
Requirements (.grace/context/requirements.xml)
  -> GraceChangeSpec (.grace/changes/active/*/spec.xml)
    -> GraceChangePlan (.grace/changes/active/*/plan.xml)
      -> Verification entries (.grace/verification/*.xml)
        -> Module Contracts (MODULE_CONTRACT in each file)
          -> Function Contracts (START_CONTRACT in each function)
            -> Code and tests (within semantic blocks)
```

Never jump levels. If requirements are unclear — stop and clarify with the user.

## Governed Autonomy (PCAM)

PCAM = Purpose, Constraints, Autonomy, Metrics.

- **Purpose**: Defined by the contract. You know WHAT to build.
- **Constraints**: Defined by the GraceChangePlan and .grace/graph. You know the BOUNDARIES.
- **Autonomy**: You choose HOW to implement within those boundaries.
- **Metrics**: The contract's OUTPUTS plus the verification evidence tell you if you're done.

You have freedom in HOW to implement, but not in WHAT. The contract and the knowledge graph define WHAT. If a contract seems wrong — propose a change, don't silently deviate.

## Contract Modification Rules

1. **Read before edit** — always read the MODULE_CONTRACT before editing any file
2. **Update MODULE_MAP** — if you change the relevant public or local symbols for that file's lint mode, update MODULE_MAP
3. **Update .grace/graph** — if you add/remove modules or dependencies, update the corresponding GD-* document
4. **Update .grace/verification** — if you change tests, required markers, or verification commands, update the corresponding VD-* document
5. **Track changes** — after fixing bugs, add a CHANGE_SUMMARY entry
6. **Never remove markup** — semantic markup anchors are load-bearing structure
7. **Propose, don't deviate** — if the contract is wrong, propose a change to the user. Don't silently implement something different.
8. **Anchor the intent** — prefer meaningful names and concrete PURPOSE text over generic placeholders or arbitrary IDs.

## Contract in GraceChangeSpec

Modules in the GraceChangeSpec carry their contract in XML:

```xml
<GraceChangeSpec graceVersion="4.0" status="approved">
  <C-ADD-AUTH>
    <Summary>Add authentication module</Summary>
    <DurableScope>
      <GraphAnchors>
        <M-AUTH />
      </GraphAnchors>
    </DurableScope>
  </C-ADD-AUTH>
</GraceChangeSpec>
```

This XML contract is the blueprint for the MODULE_CONTRACT in the source file. The matching verification entry in `.grace/verification/` is the blueprint for how the module proves that it still satisfies the contract.

The shared XML contract should stay at module-boundary level. It should not list every private helper that exists only to support the implementation. Those details belong in the file header and local contracts.
