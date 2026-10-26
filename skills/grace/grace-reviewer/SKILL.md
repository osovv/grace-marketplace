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

<behavioral_review>
Apply [Behavioral examples](../grace-explainer/references/behavioral-examples.md) to the actual spec, tests, and results, not only the implementer's summary.

- General rules and named contrasting examples agree; examples illustrate the rule without silently narrowing it or introducing an unapproved requirement.
- Every accepted example has an identifiable test binding in exact `Scenario`, `Command`, and `TestFiles/File` fields. Expected results come from the approved contract, not production helpers. Stateful checks cover required before/after state, unchanged state, and forbidden effects.
- Boundary, rejection, fault, concurrency, and property checks match the risk; relevant real-substrate behavior is not inferred solely from mocks. Any exclusion or deferral is explicitly approved in the spec/plan and reported separately from passes.
- Missing, skipped, filtered, or weakened mandatory cases block acceptance. A worker's few-shot subset does not reduce the full required gate. Inspect whether the independent oracle detects the intended mistake, and require a negative control when its complexity or risk warrants it.
- Target/final evidence reflects the current implementation, fixtures, expectations, and relevant dependencies. `MustVerify` is existence evidence; `--run-commands` runs selected `MustPassCommand` assertions. Inspect actual test results and the overall final verdict; neither nonempty `TraceAssertion` text nor command exit 0 alone proves case completeness.
</behavioral_review>

<output>
Return findings with severity, location, why it matters, expected fix direction, and verification target. Do not fix unless explicitly asked.
</output>
</skill>
