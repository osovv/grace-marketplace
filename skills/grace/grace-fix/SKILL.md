---
name: grace-fix
description: Debug and fix issues in a GRACE 4 project using .grace semantic navigation, assertions, and verification evidence.
---

<skill>
<investigation_path>
1. Start from the failure, pasted error, failing command, or user report.
2. Load relevant `.grace/graph` module anchors and `.grace/verification` entries.
3. Check active `.grace/changes` for overlapping or stale planned work.
4. Inspect file-local contracts and semantic blocks before editing.
5. Identify root cause, present findings, then make the smallest safe fix.
</investigation_path>

<verification>
Run the specific `V-M-*` commands or closest deterministic tests. If verification expectations are stale, update or propose changes through the GRACE 4 change lifecycle.
</verification>
</skill>
