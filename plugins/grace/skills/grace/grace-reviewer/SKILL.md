---
name: grace-reviewer
description: Review GRACE 4 integrity across .grace artifacts, active changes, scopes, assertions, code anchors, and verification evidence.
---

<skill>
<review_checklist>
- `.grace/context` artifacts are present and relevant.
- `.grace/graph/index.xml` routes every graph anchor to the correct graph document.
- `.grace/verification/index.xml` routes deterministic `V-M-*` entries and covers current modules.
- Active change specs/plans use valid statuses for their location and exactly one `C-*` wrapper.
- Baseline and target assertions are meaningful and not stale.
- Durable scopes and observed write scopes are explicit; unsafe parallel overlaps are blocked.
- File-local contracts, `LINKS:`, and semantic blocks match durable anchors.
- Verification evidence is fresh and tied to commands or markers.
</review_checklist>

<output>
Return findings with severity, location, why it matters, expected fix direction, and verification target. Do not fix unless explicitly asked.
</output>
</skill>
