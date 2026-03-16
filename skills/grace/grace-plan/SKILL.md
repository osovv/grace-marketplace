---
name: grace-plan
description: "Run the GRACE architectural planning phase. Use when you have requirements and technology decisions defined and need to design the module architecture, create contracts, map data flows, and establish verification references. Produces development-plan.xml, verification-plan.xml, and knowledge-graph.xml."
---

Run the GRACE architectural planning phase.

## Prerequisites
- `docs/requirements.xml` must exist and have at least one UseCase
- `docs/technology.xml` must exist with stack decisions
- `docs/verification-plan.xml` should exist as the shared verification artifact template
- If requirements or technology are missing, tell the user to run `$grace-init` first
- If the verification plan template is missing, recreate it before finalizing the planning artifacts

## Architectural Principles

When designing the architecture, apply these principles:

### Contract-First Design
Every module gets a MODULE_CONTRACT before any code is written:
- PURPOSE: one sentence, what it does
- SCOPE: what operations are included
- DEPENDS: list of module dependencies
- LINKS: knowledge graph node references

### Module Taxonomy
Classify each module as one of:
- **ENTRY_POINT** — where execution begins (CLI, HTTP handler, event listener)
- **CORE_LOGIC** — business rules and domain logic
- **DATA_LAYER** — persistence, queries, caching
- **UI_COMPONENT** — user interface elements
- **UTILITY** — shared helpers, configuration, logging
- **INTEGRATION** — external service adapters

### Knowledge Graph Design
Structure `docs/knowledge-graph.xml` for maximum navigability:
- Each module gets a unique ID tag: `M-xxx NAME="..." TYPE="..."`
- Functions annotated as `fn-name`, types as `type-Name`
- CrossLinks connect dependent modules bidirectionally
- Annotations describe what each module exports

### Verification-Aware Planning
Planning is incomplete if modules cannot be verified.

For every significant module, define during planning:
- a `verification-ref` like `V-M-xxx`
- likely source and test file targets
- critical scenarios that must be checked
- the log or trace anchors needed to debug failures later
- which checks stay module-local versus wave-level or phase-level

## Process

### Phase 1: Analyze Requirements
Read `docs/requirements.xml`. For each UseCase, identify:
- What modules/components are needed
- What data flows between them
- What external services or APIs are involved

### Phase 2: Design Module Architecture
Propose a module breakdown. For each module, define:
- Purpose (one sentence)
- Type: ENTRY_POINT / CORE_LOGIC / DATA_LAYER / UI_COMPONENT / UTILITY / INTEGRATION
- Dependencies on other modules
- Key interfaces (what it exposes)
- Tentative source path, test path, and `verification-ref`

Present this to the user as a structured list and **wait for approval** before proceeding.

### Phase 3: Design Verification Surfaces
Before finalizing the plan, derive the first verification draft:
- map critical UseCases to `DF-xxx` data flows
- assign `V-M-xxx` verification entries for important modules
- list the most important success and failure scenarios
- identify required log markers or trace evidence for critical branches
- note module-local checks plus any wave-level or phase-level follow-up

Present this verification draft to the user as part of the same approval checkpoint. If the verification story is weak, revise the architecture before proceeding.

### Phase 4: Mental Walkthroughs
Run "mental tests" for 2-3 key user scenarios step by step:
- Which modules are involved?
- What data flows through them?
- Where could it break?
- Which logs or trace markers would prove the path was correct?
- Are there circular dependencies?

Present the walkthrough to the user. If issues are found — revise the architecture.

### Phase 5: Generate Artifacts
After user approval:

1. Update `docs/development-plan.xml` with the full module breakdown, contracts, target paths, observability notes, data flows, and implementation order. Use unique ID-based tags: `M-xxx` for modules, `Phase-N` for phases, `DF-xxx` for flows, `step-N` for steps, and `V-M-xxx` references for verification.
2. Update `docs/verification-plan.xml` with global verification policy, critical flows, module verification stubs, and phase gates.
3. Update `docs/knowledge-graph.xml` with all modules (as `M-xxx` tags), their annotations (as `fn-name`, `type-Name`, etc.), `verification-ref` links, and CrossLinks between them.
4. Print: "Architecture approved. Run `$grace-verification` to deepen tests and trace expectations, `$grace-execute` for sequential execution, or `$grace-multiagent-execute` for parallel-safe waves."

## Important
- Do NOT generate any code during this phase
- This phase produces ONLY planning documents and verification artifacts
- Every architectural decision must be explicitly approved by the user

## Output Format
Always produce:
1. Module breakdown table (ID, name, type, purpose, dependencies, target paths, verification ref)
2. Data flow diagrams (textual)
3. Verification surface overview (critical flows, module-local checks, log or trace anchors)
4. Implementation order (phased, with dependency justification)
5. Risk assessment (what could go wrong)
