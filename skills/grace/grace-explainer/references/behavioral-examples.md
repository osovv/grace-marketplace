# Behavioral Examples

Use a small set of contrasting examples to make a general behavior rule precise before implementation. An example should rule out a plausible wrong implementation: an off-by-one boundary, an unauthorized effect, loss of unrelated state, or an incorrect failure outcome. Several ordinary happy paths that make the same distinction add little.

This is a skill workflow using GRACE 4.0 fields and project tests. Local names link prose to test names for the author and reviewer. The CLI does not provide a typed case registry, evaluate natural-language expectations, or verify case-to-test coverage.

## From requirement to evidence

| Stage | Required work |
| --- | --- |
| Spec | State the general rule and accepted examples under `AcceptanceCriteria`. Include initial state/context, input, observable outcome, and relevant changed, unchanged, and forbidden effects. Resolve rule/example contradictions before approval. |
| Plan | Map every accepted criterion and example to an owning task, test file, selector or test name, command, and expected evidence. Keep unresolved expectations in the draft spec. |
| Execution | Give the worker the applicable rule, contrasting examples, dependencies, and test mapping. Run the declared gates even if only a few examples fit in the worker packet. |
| Verification | Exercise the public operation, observe the required result and effects, and compare them with independently specified expectations. Record which required cases ran, failed, or were skipped. |
| Review and apply | Check the complete mapping and fresh evidence. At centralized apply, maintain current rules in the owning graph contract and accepted scenarios/bindings in its verification entry, preserving unaffected obligations. Archive the change only through the existing final gate. |

Examples in an approved spec are obligations. A fixture or test binding must not introduce a new product requirement. `design-context.xml` may explain rationale and alternatives; accepted outcomes stay in `spec.xml`. If a rule and example conflict, stop and resolve the contract through the approval lifecycle. Do not silently prefer either. An approved plan is replaced through supersession when its obligations change.

Use the dimensions that distinguish the behavior: positive/boundary/rejection for bounded decisions; failure/recovery for effects that can partially complete; concurrency for shared-state operations; properties or metamorphic checks for broad input spaces. For each relevant risk, add an example or point to an existing check. Omit inapplicable dimensions with a short reason instead of filling a fixed form with empty fields.

## Worked spec

This synthetic example isolates one stock rule for a single call with a positive integer quantity. A real reservation service also needs its applicable validation, authorization, concurrency, and persistence-failure contracts. These two examples do not establish those properties. The command and paths below belong to the example project, not this marketplace repository.

<!-- grace-example: behavioral-spec -->
```xml
<GraceChangeSpec graceVersion="4.0" status="draft">
  <C-RESERVE-STOCK>
    <Summary>Define the stock reservation boundary.</Summary>
    <Goals><Goal>Accept an exact reservation and reject an overdraw.</Goal></Goals>
    <Constraints>
      <Constraint>This rule covers one call with a positive integer quantity and nonnegative starting stock.</Constraint>
    </Constraints>
    <NonGoals><NonGoal>Specify concurrent execution, request validation, or payment behavior in this example.</NonGoal></NonGoals>
    <AcceptanceCriteria>
      <Criterion>
        <Name>bounded-reservation</Name>
        <Rule>When quantity is at most available stock, return reserved and subtract quantity from the selected SKU. Otherwise return insufficient-stock and perform no stock write. Other SKUs remain unchanged in either outcome; never create or remove SKUs.</Rule>
        <Scenario>
          <Name>exact-boundary</Name>
          <Given>SKU A has 3 units; SKU B has 7 units.</Given>
          <When>Reserve 3 units of SKU A.</When>
          <Then>Return reserved; SKU A has 0 units.</Then>
          <Unchanged>SKU B still has 7 units.</Unchanged>
          <Forbidden>Negative stock or creation of another SKU.</Forbidden>
        </Scenario>
        <Scenario>
          <Name>rejected-overdraw</Name>
          <Given>SKU A has 3 units; SKU B has 7 units.</Given>
          <When>Reserve 4 units of SKU A.</When>
          <Then>Return insufficient-stock.</Then>
          <Unchanged>The entire stock state remains A=3, B=7.</Unchanged>
          <Forbidden>Partial reservation or any stock write.</Forbidden>
        </Scenario>
      </Criterion>
    </AcceptanceCriteria>
    <AffectedAreas><M-STOCK /></AffectedAreas>
    <VerificationIntent>
      <ExpectedCommand>bun test tests/reserve-stock.test.ts</ExpectedCommand>
      <ExpectedEvidence>Both named cases execute; response, final stock, and forbidden effects match the approved expectations.</ExpectedEvidence>
    </VerificationIntent>
  </C-RESERVE-STOCK>
</GraceChangeSpec>
```

`Criterion`, `Scenario`, `Name`, `Given`, `When`, `Then`, `Unchanged`, and `Forbidden` are ordinary fields here. Repeat `Scenario`; do not invent `Scenario-exact-boundary` tags or attributes on `M-*` / `V-M-*` anchors. A local name is unique within its criterion/verification entry for review and test mapping, not a global GRACE anchor. The draft becomes normative only after the existing explicit approval step.

## Plan the tests

Use the [change plan template](../../grace-plan/references/change-plan-template.xml). For this example, the task's acceptance criteria preserve the general `bounded-reservation` rule and both named cases. The verification mapping is:

| Accepted case | Test file and test name | Required observation |
| --- | --- | --- |
| `exact-boundary` | `tests/reserve-stock.test.ts` / `exact-boundary` | `reserved`, A=0, B=7, no extra SKU and no negative stock |
| `rejected-overdraw` | `tests/reserve-stock.test.ts` / `rejected-overdraw` | `insufficient-stock`, A=3, B=7, and no stock write |

`bun test tests/reserve-stock.test.ts` runs both tests. Their expected values are authored from the rule; calling the production reservation calculation to compute the expected result would repeat the same defect. Observe the public result and resulting state. Final-state equality alone does not prove the absence of a forbidden write: inspect the relevant write boundary or transaction evidence. Use the real persistence boundary when the approved rule depends on persistence or transactional behavior.

The examples distinguish important mistakes but do not exhaust the general rule. Check the remaining input classes and existing regression obligations; add broader checks when needed. For a high-risk oracle, a deliberate incorrect result or removed effect check can serve as a negative control to show that verification detects the fault.

## Maintain current verification

At centralized apply, the approved scenarios and test binding become current verification state. Both cases below belong to the `bounded-reservation` rule maintained in the public contract of `M-STOCK`; their `Name` values are also their test names, and the shared file/command runs both. A routed document uses the existing form below, with its module and ownership routes declared in the graph/verification indexes. Preserve unaffected current cases and review any changed or retired obligation explicitly; do not replace an entire inventory with only the two examples selected for a worker.

<!-- grace-example: behavioral-verification -->
```xml
<GraceVerificationDocument graceVersion="4.0">
  <VD-MAIN>
    <V-M-STOCK>
      <TestFiles><File>tests/reserve-stock.test.ts</File></TestFiles>
      <Command>bun test tests/reserve-stock.test.ts</Command>
      <TraceAssertion>Named tests check the response, changed and unchanged stock, and forbidden writes.</TraceAssertion>
      <Scenario>
        <Name>exact-boundary</Name>
        <Given>SKU A has 3 units; SKU B has 7 units.</Given>
        <When>Reserve 3 units of SKU A.</When>
        <Then>Return reserved; SKU A has 0 units.</Then>
        <Unchanged>SKU B still has 7 units.</Unchanged>
        <Forbidden>Negative stock or creation of another SKU.</Forbidden>
      </Scenario>
      <Scenario>
        <Name>rejected-overdraw</Name>
        <Given>SKU A has 3 units; SKU B has 7 units.</Given>
        <When>Reserve 4 units of SKU A.</When>
        <Then>Return insufficient-stock.</Then>
        <Unchanged>The entire stock state remains A=3, B=7.</Unchanged>
        <Forbidden>Partial reservation or any stock write.</Forbidden>
      </Scenario>
    </V-M-STOCK>
  </VD-MAIN>
</GraceVerificationDocument>
```

The CLI projects each nested `Scenario` as text. Test code supplies the executable assertions. Adding the `Command` above does not cause `MustVerify` to run it: `MustVerify` checks entry existence. Include the required command in the plan's `TargetAssertions`, for example this fragment:

```xml
<TargetAssertions>
  <MustVerify><Module>M-STOCK</Module></MustVerify>
  <MustPassCommand><Command>bun test tests/reserve-stock.test.ts</Command></MustPassCommand>
</TargetAssertions>
```

Run task verification during implementation. Once approved durable graph/verification changes have been reconciled centrally, the selected target can be checked with `grace lint --path PROJECT --change C-RESERVE-STOCK --assertions target --run-commands`. The corresponding fresh `final --run-commands` gate evaluates the target plus full project lint before archive; a new verification entry must exist before its `MustVerify` target can pass. Commands must fit the plan's measured budgets. Keep slow substrate acceptance checks in the existing acceptance tier and inspect their evidence too; do not duplicate a whole suite and its component commands in the gate.

## Review evidence

Review the general rule as well as the examples. Confirm each accepted case has a test, that the expected result is independent of the production result, and that the run exercised all required cases. Missing, skipped, manual, or unsupported required checks remain incomplete; a zero exit code or an old passing log does not convert them to passes. A deliberate deferral changes the approved obligations through the normal lifecycle.

Run selected checks again after relevant code, contract, fixture, or binding changes. Existing run metadata records command outcomes and starting Git identity; it does not attest every dirty file or provide native per-case coverage. Keep runner output and observations sufficient for a reviewer to establish what actually ran.
