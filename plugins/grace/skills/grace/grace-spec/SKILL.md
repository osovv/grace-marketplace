---
name: grace-spec
description: Interview the user and create an approved GRACE 4 GraceChangeSpec plus optional design-context.xml inside .grace/changes/active/C-*/.
---

<skill>
<change_bundle_contract>
`.grace/changes/active/C-CHANGE-ID/`

- `spec.xml` — normative `GraceChangeSpec`
- `design-context.xml` — optional, explanatory only
- `plan.xml` — created later by `grace-plan`
</change_bundle_contract>

<status_rules>
Create `spec.xml` as `status="draft"`. Set `status="approved"` only after explicit user approval. Rejected or cancelled specs move to archive with terminal status. Do not create or edit `plan.xml` in this skill.
</status_rules>

<strict_contract>
The direct `C-*` wrapper must contain exactly one meaningful `Summary`, `Goals`, `Constraints`, `NonGoals`, `AcceptanceCriteria`, `AffectedAreas`, and `VerificationIntent` section. Empty containers are not approval-ready. Semantic anchors are canonical attribute-free XML tags, never attributes or attribute values.
</strict_contract>

<behavioral_acceptance>
- For changed behavior, put the general rule and a small set of contrasting accepted examples in `AcceptanceCriteria`. Choose examples that distinguish a plausible wrong interpretation; examples complement the rule and do not define its entire input domain.
- State observable input, relevant context/initial state, action and expected outcome. Include changed state, unchanged state and forbidden effects where they matter. Consider boundaries and rejection; add failure, recovery or concurrency cases when the contract and risk require them. Do not manufacture irrelevant fields or a fixed case count.
- Keep accepted expectations in the normative spec. Derive them from agreed rules, not from the current implementation's output; an illustrative value must not silently decide product policy.
- Use ordinary repeated `Criterion` and `Scenario` fields, with `Name`, `Rule`, `Given`, `When`, `Then`, `Unchanged` or `Forbidden` children as useful. Names are plain local labels for review and test mapping, not new semantic anchors or CLI-validated case identities. Never invent unique tags such as `Scenario-ID`.
- A rule/example contradiction blocks approval until resolved. If an expected result or applicable failure policy is unresolved, retain it as an open question and keep the spec draft; do not turn an assumption into an accepted expectation.
- Read [behavioral examples](../grace-explainer/references/behavioral-examples.md) when choosing contrasts, observation boundaries or the later test/evidence mapping.
</behavioral_acceptance>

<workflow>
1. Ask one focused question at a time until goal, scope, constraints, non-goals, acceptance criteria, affected areas, and verification expectations are clear.
2. Propose a concise design summary, general rules, contrasting acceptance examples and explicit assumptions. Resolve rule/example conflicts and ask for approval before writing an approved spec.
3. Create a deterministic uppercase-kebab `C-*` change id.
4. Write `spec.xml` from `references/change-spec-template.xml` with exactly one direct `C-*` wrapper and no empty required section.
5. If rationale, alternatives or explanatory walkthroughs would otherwise bloat the spec, write non-normative `design-context.xml` from its template. Keep accepted rules, scenarios and required external constraints in `spec.xml`.
6. If approval is not explicit, leave `spec.xml` as `status="draft"` and report the approval step needed.
</workflow>

<hard_rules>
- `spec.xml` is the source of truth for `grace-plan`; design context never adds requirements.
- Do not implement code, mutate current graph/verification state, or create retroactive change bundles.
- Recommend `grace lint --path <project-root> --assertions current` as a pre-implementation active-baseline check after writing the bundle; never present it as target or final evidence.
</hard_rules>
</skill>
