---
name: grace-init
description: "Bootstrap GRACE framework structure for a new project. Use when starting a new project with GRACE methodology - creates docs/ directory, AGENTS.md, and XML templates for requirements, technology, development plan, verification plan, and knowledge graph."
---

Initialize GRACE framework structure for this project.

## Template Files

All documents MUST be created from template files located in this skill's `assets/` directory.
Read each template file, replace the `$PLACEHOLDER` variables with actual values gathered from the user, and write the result to the target project path.

| Template source                          | Target in project           |
|------------------------------------------|-----------------------------|
| `assets/AGENTS.md.template`              | `AGENTS.md` (project root)  |
| `assets/docs/knowledge-graph.xml.template` | `docs/knowledge-graph.xml`  |
| `assets/docs/requirements.xml.template`    | `docs/requirements.xml`     |
| `assets/docs/technology.xml.template`      | `docs/technology.xml`       |
| `assets/docs/development-plan.xml.template`| `docs/development-plan.xml` |
| `assets/docs/verification-plan.xml.template`| `docs/verification-plan.xml` |

> **Important:** Never hardcode template content inline. Always read from the `.template` files — they are the single source of truth for document structure.

## Steps

1. **Gather project info from the user.** Ask for:
   - Project name and short annotation
   - Main keywords (for domain activation)
   - Primary language, runtime, and framework (with versions)
   - Key libraries/dependencies (if known)
   - Testing stack (test runner, assertion style, mock/fake approach)
   - Observability stack (logger, structured log fields, redaction constraints)
   - High-level module list (if known)
   - 2-5 critical flows or risky surfaces that must be verifiable early

2. **Create `docs/` directory and populate documents from templates:**

    For each `assets/docs/*.xml.template` file:
    - Read the template file
   - Replace `$PLACEHOLDER` variables with user-provided values
   - Write the result to the corresponding `docs/` path

3. **Create or verify `AGENTS.md` at project root:**
    - If `AGENTS.md` does not exist — read `assets/AGENTS.md.template`, fill in `$KEYWORDS` and `$ANNOTATION`, and write to project root
    - If `AGENTS.md` already exists — warn the user and ask whether to overwrite or keep the existing one

4. **Print a summary** of all created files and suggest the next step:
    > "Run `$grace-plan` to design modules, data flows, and verification references. Then use `$grace-verification` to deepen tests, traces, and log-driven evidence before large execution waves."
