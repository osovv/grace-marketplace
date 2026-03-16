---
name: grace-status
description: "Show the current health status of a GRACE project. Use to get an overview of project artifacts, codebase metrics, knowledge graph health, verification coverage, and suggested next actions."
---

Show the current state of the GRACE project.

## Report Contents

### 1. Artifacts Status
Check existence and version of:
- [ ] `AGENTS.md` — GRACE principles
- [ ] `docs/knowledge-graph.xml` — version and module count
- [ ] `docs/requirements.xml` — version and UseCase count
- [ ] `docs/technology.xml` — version and stack summary
- [ ] `docs/development-plan.xml` — version and module count
- [ ] `docs/verification-plan.xml` — version and verification entry count

### 2. Codebase Metrics
Scan source files and report:
- Total source files
- Files WITH MODULE_CONTRACT
- Files WITHOUT MODULE_CONTRACT (warning)
- Total test files
- Test files WITH MODULE_CONTRACT
- Total semantic blocks (START_BLOCK / END_BLOCK pairs)
- Unpaired blocks (integrity violation)
- Files with stable log markers
- Test files that assert log markers or traces when relevant

### 3. Knowledge Graph and Verification Health
Quick check:
- Modules in graph vs modules in codebase
- Any orphaned or missing entries
- Modules in verification plan vs modules in development plan
- Missing or stale verification refs

### 4. Recent Changes
List the 5 most recent CHANGE_SUMMARY entries across source and substantive test files.

### 5. Suggested Next Action
Based on the status, suggest what to do next:
- If no requirements — "Define requirements in docs/requirements.xml"
- If requirements but no plan — "Run `$grace-plan`"
- If plan exists but verification is still thin — "Run `$grace-verification`"
- If plan and verification are ready but modules are missing — "Run `$grace-execute` or `$grace-multiagent-execute`"
- If drift detected — "Run `$grace-refresh`"
- If tests or logs are too weak for autonomous work — "Run `$grace-verification`"
- If everything synced — "Project is healthy"
