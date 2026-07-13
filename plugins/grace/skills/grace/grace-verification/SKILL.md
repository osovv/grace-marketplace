---
name: grace-verification
description: Design and maintain GRACE 4 verification entries, commands, scenarios, markers, and assertion evidence under .grace/verification.
---

<skill>
<purpose>
Strengthen deterministic verification for modules and changes. Verification state lives in `.grace/verification/index.xml` and routed verification documents. Each durable module should have deterministic `V-M-*` coverage unless an explicit exception is planned.
</purpose>

<workflow>
1. Read relevant `.grace/graph` anchors and current `V-M-*` entries.
2. Identify scenarios, commands, test files, required log markers, and trace assertions.
3. Ensure commands are deterministic and runnable from the project root or documented cwd.
4. Update or propose `.grace/verification` changes through the active change plan.
5. Run the commands and record fresh evidence in the response.
</workflow>
<cwd_contract>
When verification commands run from a workspace or package directory, add one direct `<Cwd>relative/project/path</Cwd>` child to the owning `V-M-*` entry. Keep declared `<TestFiles><File>...</File></TestFiles>` paths project-root-relative; the CLI uses `Cwd` only to compare them with cwd-relative command arguments.
</cwd_contract>
</skill>
