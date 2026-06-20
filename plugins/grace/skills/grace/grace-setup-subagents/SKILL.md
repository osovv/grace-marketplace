---
name: grace-setup-subagents
description: Create GRACE 4 worker and reviewer subagent presets that understand .grace artifacts, scopes, assertions, and verification evidence.
---

<skill>
<subagent_requirements>
Generated subagents must be told to:

- read `.grace/context`, `.grace/graph`, `.grace/verification`, and relevant `.grace/changes` packets explicitly;
- treat `spec.xml` as normative and design context as non-normative;
- respect `DurableScope`, `ObservedWriteScope`, `BaselineAssertions`, and `TargetAssertions`;
- never mutate approved plans or XML statuses without controller approval;
- return verification evidence and scoped graph/verification deltas.
</subagent_requirements>
</skill>
