---
name: grace-cli
description: Operate the GRACE 4 CLI for .grace linting, status, module navigation, verification navigation, and file-local semantic markup.
---

<skill>
<commands>
- `grace lint --path <project-root>` validates `.grace` grammar, projections, assertions, lifecycle locations, and scope overlap.
- `grace status --path <project-root> --with modules` summarizes health and next action.
- `grace module find|show` navigates `.grace/graph` projection records and linked files.
- `grace verification find|show` navigates `.grace/verification` projection records.
- `grace file show` reads file-local/private semantic markup.
</commands>

<migration_boundary>
If the CLI reports legacy GRACE 3 docs, use `grace-migrate`. GRACE 4 commands do not dual-validate legacy docs as current state.
</migration_boundary>
</skill>
