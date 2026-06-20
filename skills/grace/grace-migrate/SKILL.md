---
name: grace-migrate
description: Agent-applied GRACE 3 to GRACE 4 migration workflow. CLI validates the result but does not convert or delete files.
---

<skill>
<migration_safety>
Read legacy GRACE 3 docs, present a migration draft/report, wait for explicit approval, write `.grace` artifacts, run validation, and delete legacy docs only after valid `.grace` plus explicit cleanup confirmation. Do not create retroactive `C-*` bundles.
</migration_safety>

<workflow>
1. Detect legacy docs and current `.grace` state. If `.grace` already exists, stop and ask whether migration should merge, replace, or abort.
2. Map legacy requirements, technology, graph, plan, verification, and operational packet content into the GRACE 4 layout.
3. Produce a migration report from `references/migration-report-template.xml` and review checklist from `references/migration-checklist.md`.
4. Ask for approval before writing `.grace` artifacts.
5. Run `grace lint --path <project-root>` and `grace status --path <project-root>` after writing.
6. Ask separately before deleting or archiving legacy docs.
</workflow>
</skill>
