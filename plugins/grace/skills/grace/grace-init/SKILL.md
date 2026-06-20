---
name: grace-init
description: Bootstrap a Full GRACE 4 project by creating the canonical .grace context, graph, verification, and changes skeleton.
---

<skill>
<task>
Create the canonical GRACE 4 project layout from this skill's `assets/` templates:

- `AGENTS.md`
- `.grace/context/requirements.xml`
- `.grace/context/technology.xml`
- `.grace/context/principles.xml`
- `.grace/context/deployment.xml`
- `.grace/context/ux-guidelines.xml`
- `.grace/graph/index.xml`
- `.grace/graph/main.xml`
- `.grace/verification/index.xml`
- `.grace/verification/main.xml`
- `.grace/changes/active/`
- `.grace/changes/archive/`

Every XML artifact uses `graceVersion="4.0"`. Semantic anchors are XML tags, never attributes. Do not create dummy `C-*` change bundles. Do not overwrite existing `.grace` artifacts without explicit confirmation.
</task>

<template_sources>
| Template source | Target in project |
|---|---|
| `assets/AGENTS.md.template` | `AGENTS.md` |
| `assets/.grace/context/requirements.xml.template` | `.grace/context/requirements.xml` |
| `assets/.grace/context/technology.xml.template` | `.grace/context/technology.xml` |
| `assets/.grace/context/principles.xml.template` | `.grace/context/principles.xml` |
| `assets/.grace/context/deployment.xml.template` | `.grace/context/deployment.xml` |
| `assets/.grace/context/ux-guidelines.xml.template` | `.grace/context/ux-guidelines.xml` |
| `assets/.grace/graph/index.xml.template` | `.grace/graph/index.xml` |
| `assets/.grace/graph/main.xml.template` | `.grace/graph/main.xml` |
| `assets/.grace/verification/index.xml.template` | `.grace/verification/index.xml` |
| `assets/.grace/verification/main.xml.template` | `.grace/verification/main.xml` |
</template_sources>

<steps>
1. Gather project name, annotation, keywords, language/runtime/framework, testing stack, observability constraints, deployment applicability, UX applicability, and any known initial modules.
2. If `.grace` or `AGENTS.md` already exists, stop and ask whether to keep, merge, or overwrite each existing artifact. Never overwrite silently.
3. Create `.grace/context`, `.grace/graph`, `.grace/verification`, `.grace/changes/active`, and `.grace/changes/archive`.
4. Read each `.template` file, replace `$PLACEHOLDER` values with gathered project information, and write the target file.
5. Print created files and recommend the next workflow: use `grace-spec` to create an active `GraceChangeSpec`, then `grace-plan` to produce a `GraceChangePlan` before implementation.
</steps>

<hard_rules>
- GRACE 4 state lives under `.grace`; do not create legacy `docs/*.xml` as the bootstrap surface.
- `GraceChangeSpec` and `GraceChangePlan` are created by later change workflows, not by init.
- If legacy GRACE 3 docs are present, explain that migration is handled only by `grace-migrate`; init must not convert or delete them.
- Validate the resulting project with `grace lint --path <project-root>` when the CLI is available.
</hard_rules>
</skill>
