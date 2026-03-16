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

The contract is written before the code. It comes from the development plan (`docs/development-plan.xml`), which was approved by the user during the `$grace-plan` phase.

## Function Contracts

Every exported function or component must have:

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
Requirements (docs/requirements.xml)
  -> Architecture (docs/development-plan.xml)
    -> Verification plan (docs/verification-plan.xml)
      -> Module Contracts (MODULE_CONTRACT in each file)
        -> Function Contracts (START_CONTRACT in each function)
          -> Code and tests (within semantic blocks)
```

Never jump levels. If requirements are unclear — stop and clarify with the user.

## Governed Autonomy (PCAM)

PCAM = Purpose, Constraints, Autonomy, Metrics.

- **Purpose**: Defined by the contract. You know WHAT to build.
- **Constraints**: Defined by the development plan and knowledge graph. You know the BOUNDARIES.
- **Autonomy**: You choose HOW to implement within those boundaries.
- **Metrics**: The contract's OUTPUTS plus the verification evidence tell you if you're done.

You have freedom in HOW to implement, but not in WHAT. The contract and the knowledge graph define WHAT. If a contract seems wrong — propose a change, don't silently deviate.

## Contract Modification Rules

1. **Read before edit** — always read the MODULE_CONTRACT before editing any file
2. **Update MODULE_MAP** — if you change function signatures, update MODULE_MAP
3. **Update knowledge graph** — if you add/remove modules, update `docs/knowledge-graph.xml`
4. **Update verification plan** — if you change tests, required markers, or verification commands, update `docs/verification-plan.xml`
5. **Track changes** — after fixing bugs, add a CHANGE_SUMMARY entry
6. **Never remove markup** — semantic markup anchors are load-bearing structure
7. **Propose, don't deviate** — if the contract is wrong, propose a change to the user. Don't silently implement something different.

## Contract in development-plan.xml

Modules in the development plan carry their contract in XML:

```xml
<M-AUTH NAME="Authentication" TYPE="CORE_LOGIC" LAYER="2" ORDER="1">
  <contract>
    <purpose>Handle user authentication and session management</purpose>
    <inputs>
      <param name="credentials" type="Credentials" />
    </inputs>
    <outputs>
      <param name="session" type="Session" />
    </outputs>
    <errors>
      <error code="AUTH_FAILED" />
      <error code="SESSION_EXPIRED" />
    </errors>
  </contract>
  <interface>
    <export-authenticate PURPOSE="Verify credentials and create session" />
    <export-validateSession PURPOSE="Check if session is still valid" />
    <export-logout PURPOSE="Destroy active session" />
  </interface>
  <depends>M-CONFIG, M-DB</depends>
</M-AUTH>
```

This XML contract is the blueprint for the MODULE_CONTRACT in the source file. The matching verification entry in `docs/verification-plan.xml` is the blueprint for how the module proves that it still satisfies the contract.
