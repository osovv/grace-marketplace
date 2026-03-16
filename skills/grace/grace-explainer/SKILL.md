---
name: grace-explainer
description: "Complete GRACE methodology reference. Use when explaining GRACE to users, onboarding new projects, or when you need to understand the GRACE framework - its principles, semantic markup, knowledge graphs, contracts, testing, and unique tag conventions."
---

# GRACE — Graph-RAG Anchored Code Engineering

GRACE is a methodology for AI-driven code generation that makes codebases **navigable by LLMs**. It solves the core problem of AI coding assistants: they generate code but can't reliably navigate, maintain, or evolve it across sessions.

## The Problem GRACE Solves

LLMs lose context between sessions. Without structure:
- They don't know what modules exist or how they connect
- They generate code that duplicates or contradicts existing code
- They can't trace bugs through the codebase
- They drift from the original architecture over time

GRACE provides four interlocking systems that fix this:

```
Knowledge Graph (docs/knowledge-graph.xml)
    maps modules, dependencies, exports
Module Contracts (MODULE_CONTRACT in each file)
    defines WHAT each module does
Semantic Markup (START_BLOCK / END_BLOCK in code)
    makes code navigable at ~500 token granularity
Verification Plan (docs/verification-plan.xml)
    defines HOW correctness, traces, and logs are proven
```

## Six Core Principles

### 1. Never Write Code Without a Contract
Before generating any module, create its MODULE_CONTRACT with PURPOSE, SCOPE, INPUTS, OUTPUTS. The contract is the source of truth — code implements the contract, not the other way around.

### 2. Semantic Markup Is Not Comments
Markers like `// START_BLOCK_NAME` and `// END_BLOCK_NAME` are **navigation anchors**, not documentation. They serve as attention anchors for LLM context management and retrieval points for RAG systems.

### 3. Knowledge Graph Is Always Current
`docs/knowledge-graph.xml` is the single map of the entire project. When you add a module — add it to the graph. When you add a dependency — add a CrossLink. The graph never drifts from reality.

### 4. Top-Down Synthesis
Code generation follows a strict pipeline:
```
Requirements -> Technology -> Development Plan -> Verification Plan -> Module Contracts -> Code + Tests
```
Never jump to code. If requirements are unclear — stop and clarify.

### 5. Verification Is Architecture
Testing, traces, and log markers are not cleanup work. They are part of the architectural blueprint. If another agent cannot verify or debug a module from the evidence left behind, the module is not fully done.

### 6. Governed Autonomy (PCAM)
- **Purpose**: defined by the contract (WHAT to build)
- **Constraints**: defined by the development plan (BOUNDARIES)
- **Autonomy**: you choose HOW to implement
- **Metrics**: the contract plus verification evidence tell you if you're done

You have freedom in HOW, not in WHAT. If a contract seems wrong — propose a change, don't silently deviate.

## How the Elements Connect

```
docs/requirements.xml          — WHAT the user needs (use cases, AAG notation)
        |
docs/technology.xml            — WHAT tools we use (runtime, language, versions)
        |
docs/development-plan.xml      — HOW we structure it (modules, phases, contracts)
        |
docs/verification-plan.xml     — HOW we prove it works (tests, traces, log markers)
        |
docs/knowledge-graph.xml       — MAP of everything (modules, dependencies, exports, verification refs)
        |
src/**/* + tests/**/*          — CODE and TESTS with GRACE markup and evidence hooks
```

Each layer feeds the next. The knowledge graph and verification plan are both outputs of planning and inputs for execution.

## Development Workflow

1. `$grace-init` — create docs/ structure and AGENTS.md
2. Fill in `requirements.xml` with use cases
3. Fill in `technology.xml` with stack decisions
4. `$grace-plan` — architect modules, data flows, and verification refs
5. `$grace-verification` — design and maintain tests, traces, and log-driven evidence
6. `$grace-execute` — generate all modules sequentially with review and commits
7. `$grace-multiagent-execute` — generate parallel-safe modules in controller-managed waves
8. `$grace-refresh` — sync graph and verification refs after manual changes
9. `$grace-fix error-description` — debug via semantic navigation
10. `$grace-status` — health report
11. `$grace-ask` — grounded Q&A over the project artifacts

## Detailed References

For in-depth documentation on each GRACE component, see the reference files in this skill's `references/` directory:

- `references/semantic-markup.md` — Block conventions, granularity rules, logging
- `references/knowledge-graph.md` — Graph structure, module types, CrossLinks, maintenance
- `references/contract-driven-dev.md` — MODULE_CONTRACT, function contracts, PCAM
- `references/verification-driven-dev.md` — Verification plans, test design, traces, and log-driven development
- `references/unique-tag-convention.md` — Unique ID-based XML tags, why they work, full naming table
