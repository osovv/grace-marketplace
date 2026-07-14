---
name: grace-migrate
description: Agent-applied GRACE 3 to GRACE 4 migration workflow. CLI validates the result but does not convert or delete files.
---

<skill>
<migration_safety>
Migration is copy-and-validate, not destructive conversion. Before writing `.grace`, inventory every legacy source, record a restorable backup path outside the proposed cleanup set, present the migration report, and wait for explicit write approval. Never create retroactive `C-*` bundles.
</migration_safety>

<workflow>
1. Detect legacy docs and current `.grace` state. If `.grace` already exists, stop and ask whether migration should merge, replace, or abort.
2. Inventory legacy source paths and create or verify a restorable backup. Record source coverage and backup evidence in the report.
3. Map legacy requirements, technology, graph, verification, and operational content into the GRACE 4 layout. List ambiguities and unsupported structures rather than guessing.
4. Produce `references/migration-report-template.xml`, review `references/migration-checklist.md`, and ask for explicit approval before writing `.grace`.
5. Write `.grace`, then run `grace lint --path <project-root> --assertions current` and `grace status --path <project-root> --json`. Record commands, exit states, and findings.
6. If validation is not successful or generated coverage is incomplete, retain all legacy sources and stop.
7. Present an exact cleanup proposal containing only inventoried legacy paths. Ask for a separate explicit cleanup approval.
8. Archive or delete only the approved paths, record each result, and leave the backup intact. Do not use broad globs, hidden shell cleanup, or unreviewed recursive deletion.
</workflow>

<cleanup_preconditions>
Cleanup requires all of: complete inventory, restorable backup, explicit write approval, successful current lint, reviewed status output, verified generated coverage, exact proposed paths, and separate explicit cleanup approval. A missing gate means no cleanup.
</cleanup_preconditions>
</skill>
