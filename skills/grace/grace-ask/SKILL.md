---
name: grace-ask
description: Answer questions about a GRACE 4 project by navigating .grace current-state artifacts and file-local semantic markup.
---

<skill>
<context_order>
1. `.grace/context/*.xml` for requirements, technology, principles, deployment, and UX constraints.
2. `.grace/graph/index.xml` then routed graph documents for `M-*` and `DF-*` ownership.
3. `.grace/verification/index.xml` then routed verification documents for `V-M-*` coverage.
4. `.grace/changes/active/C-*` for in-flight approved or draft work.
5. File-local `MODULE_CONTRACT`, `MODULE_MAP`, `LINKS:`, `START_CONTRACT`, and `START_BLOCK_` anchors.
</context_order>

<answer_rules>
- Cite the artifact or anchor that supports each important claim.
- Distinguish durable current state from active change intent.
- If legacy GRACE 3 docs are present, explain that they require `grace-migrate` and are not GRACE 4 truth.
- Do not invent missing graph or verification facts; report uncertainty and the safest next lookup.
</answer_rules>
</skill>
