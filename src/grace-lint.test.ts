import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { lintGraceProject } from "./grace-lint";
import { getLintIssueGuide } from "./lint/catalog";

function createProject() {
  return mkdtempSync(path.join(os.tmpdir(), "grace-lint-"));
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeMinimalGrace4Project(root: string) {
  writeProjectFile(root, ".grace/context/requirements.xml", `<GraceRequirements graceVersion="4.0"><Summary>Required.</Summary></GraceRequirements>`);
  writeProjectFile(root, ".grace/context/technology.xml", `<GraceTechnology graceVersion="4.0"><Runtime>Bun</Runtime></GraceTechnology>`);
  writeProjectFile(root, ".grace/context/principles.xml", `<GracePrinciples graceVersion="4.0"><Principle>Safe.</Principle></GracePrinciples>`);
  writeProjectFile(root, ".grace/context/deployment.xml", `<GraceDeployment graceVersion="4.0"><Applicability>applicable</Applicability></GraceDeployment>`);
  writeProjectFile(root, ".grace/context/ux-guidelines.xml", `<GraceUXGuidelines graceVersion="4.0"><Applicability>applicable</Applicability></GraceUXGuidelines>`);
  writeProjectFile(
    root,
    ".grace/graph/index.xml",
    `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
  );
  writeProjectFile(
    root,
    ".grace/graph/main.xml",
    `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-EXAMPLE><Summary>Example module.</Summary><Path>src/example.ts</Path></M-EXAMPLE></GD-MAIN></GraceGraphDocument>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/index.xml",
    `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /></Owns></VD-MAIN></VerificationDocuments></GraceVerificationIndex>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/main.xml",
    `<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-EXAMPLE><Command>bun test src/example.test.ts</Command><Scenario>example works</Scenario><Marker>[Example][run][BLOCK_RUN]</Marker></V-M-EXAMPLE></VD-MAIN></GraceVerificationDocument>`,
  );
  mkdirSync(path.join(root, ".grace", "changes", "active"), { recursive: true });
  mkdirSync(path.join(root, ".grace", "changes", "archive"), { recursive: true });
  writeProjectFile(
    root,
    "src/example.ts",
    `// START_MODULE_CONTRACT
//   PURPOSE: Example runtime.
//   SCOPE: Small fixture.
//   LINKS: M-EXAMPLE
// END_MODULE_CONTRACT
export function run() {
  console.info("[Example][run][BLOCK_RUN] run");
  // START_BLOCK_RUN
  return "ok";
  // END_BLOCK_RUN
}
`,
  );
  writeProjectFile(root, "src/example.test.ts", `import { expect, test } from "bun:test";\ntest("example", () => expect(1).toBe(1));\n`);
}

function writeApprovedChange(
  root: string,
  changeId: string,
  baselineAssertions: string,
  targetAssertions: string,
  status: "draft" | "approved" = "approved",
) {
  const bundle = `.grace/changes/active/${changeId}`;
  writeProjectFile(
    root,
    `${bundle}/spec.xml`,
    `<GraceChangeSpec graceVersion="4.0" status="approved"><${changeId}><Summary>Selected change.</Summary><Goals><Goal>Exercise assertions.</Goal></Goals><Constraints><Constraint>Preserve fixture validity.</Constraint></Constraints><NonGoals><NonGoal>Unrelated behavior.</NonGoal></NonGoals><AcceptanceCriteria><Criterion>Assertions are evaluated.</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand></VerificationIntent></${changeId}></GraceChangeSpec>`,
  );
  writeProjectFile(
    root,
    `${bundle}/plan.xml`,
    `<GraceChangePlan graceVersion="4.0" status="${status}"><${changeId}><IntentSummary>Evaluate selected assertions.</IntentSummary><BaselineAssertions>${baselineAssertions}</BaselineAssertions><TargetAssertions>${targetAssertions}</TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope><ImplementationPlan><T-001><Title>Verify assertions</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>Assertions pass.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001></ImplementationPlan></${changeId}></GraceChangePlan>`,
  );
}

describe("lintGraceProject", () => {
  it("passes a valid GRACE 4 .grace project", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);

    const result = lintGraceProject(root);

    expect(result.summary.errors).toBe(0);
    expect(result.tool).toBe("grace-lint");
    expect(result.schemaVersion).toBe("1.0.0");
    expect(result.generatedAt).toBeTruthy();
    expect(result.root).toBe(path.resolve(root));
    expect(result.xmlFilesChecked).toBeGreaterThan(0);
  });

  it("fails with migration guidance when only GRACE 3 docs are present", () => {
    const root = createProject();
    writeProjectFile(root, "docs/development-plan.xml", `<DevelopmentPlan />`);

    const result = lintGraceProject(root);

    expect(result.issues[0]?.code).toBe("project.grace3-detected");
    expect(result.issues[0]?.message).toContain("grace-migrate");
  });

  it("fails with missing .grace guidance when no GRACE artifacts exist", () => {
    const result = lintGraceProject(createProject());

    expect(result.issues[0]?.code).toBe("project.missing-grace");
    expect(result.issues[0]?.message).toContain("No .grace directory");
  });

  it("returns JSON-compatible output shape with issue counts", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, ".grace/context/requirements.xml", `<GraceRequirements><Summary>Missing version.</Summary></GraceRequirements>`);

    const result = lintGraceProject(root);

    expect(JSON.parse(JSON.stringify(result)).tool).toBe("grace-lint");
    expect(result.summary.errors).toBeGreaterThan(0);
    expect(result.issues.map((issue) => issue.code)).toContain("artifact.missing-grace-version");
  });

  it("rejects wrong document roots, unindexed documents, and mismatched executable bundles", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, ".grace/graph/main.xml", `<GraceRequirements graceVersion="4.0"><GD-MAIN><M-EXAMPLE /></GD-MAIN></GraceRequirements>`);
    writeProjectFile(root, ".grace/graph/unindexed.xml", `<GraceGraphDocument graceVersion="4.0"><GD-EXTRA><M-EXTRA /></GD-EXTRA></GraceGraphDocument>`);
    writeProjectFile(root, ".grace/changes/active/C-FOLDER/spec.xml", `<GraceChangeSpec graceVersion="4.0" status="approved"><C-SPEC /></GraceChangeSpec>`);
    writeProjectFile(root, ".grace/changes/active/C-FOLDER/plan.xml", `<GraceChangePlan graceVersion="4.0" status="approved"><C-PLAN /></GraceChangePlan>`);

    const issueCodes = lintGraceProject(root).issues.map((issue) => issue.code);
    expect(issueCodes).toContain("artifact.unexpected-root-tag");
    expect(issueCodes).toContain("projection.graph.unindexed-document");
    expect(issueCodes).toContain("change.bundle-id-mismatch");
    expect(issueCodes).toContain("change.spec-plan-id-mismatch");
    expect(issueCodes).toContain("change.plan-missing-section");
  });

  it("documents GRACE 4 diagnostic prefixes and removes allow-missing-docs CLI exposure", () => {
    expect(getLintIssueGuide("projection.graph.wrapper-mismatch").title).toContain("Projection");
    expect(getLintIssueGuide("assertion.MustExist").title).toContain("Assertion");
    expect(getLintIssueGuide("scope.durable-overlap").title).toContain("Scope");

    const lintSource = readFileSync(path.resolve(import.meta.dir, "grace-lint.ts"), "utf8");
    expect(lintSource).not.toContain("allowMissingDocs");
    expect(lintSource).not.toContain("allow-missing-docs");
  });

  it("wires the lint command through the CLI", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    const repoRoot = path.resolve(import.meta.dir, "..");

    const result = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "lint", "--path", root, "--format", "json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(Buffer.from(result.stdout).toString("utf8"));
    expect(parsed.tool).toBe("grace-lint");
    expect(parsed.summary.errors).toBe(0);
  });
  it("does not evaluate BaselineAssertions for archived plans", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    // Only create archived plan with BaselineAssertions
    writeProjectFile(
      root,
      ".grace/changes/archive/C-DONE/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="applied"><C-DONE><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions></C-DONE></GraceChangePlan>`,
    );
    expect(lintGraceProject(root).issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(0);

    // Remove M-EXAMPLE from graph so the archived baseline would fail if evaluated
    writeProjectFile(
      root,
      ".grace/graph/index.xml",
      `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns /></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
    );
    writeProjectFile(
      root,
      ".grace/graph/main.xml",
      `<GraceGraphDocument graceVersion="4.0"><GD-MAIN /></GraceGraphDocument>`,
    );

    const after = lintGraceProject(root);
    expect(after.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(0);
  });
  it("emits assertion.MustExist for active plans with stale BaselineAssertions but not for archived plans", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);

    // Create an active plan with a MustExist reference to a module that does not exist
    writeProjectFile(
      root,
      ".grace/changes/active/C-REFACTOR/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-REFACTOR><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-REFACTOR></GraceChangePlan>`,
    );

    // Active plan should emit assertion.MustExist for nonexistent module
    const activeResult = lintGraceProject(root);
    expect(activeResult.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(1);

    // Now also add an archived plan with the same stale baseline
    writeProjectFile(
      root,
      ".grace/changes/archive/C-DONE/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="applied"><C-DONE><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-DONE></GraceChangePlan>`,
    );

    // Archived plan should NOT emit additional assertion.MustExist
    const bothResult = lintGraceProject(root);
    const assertionIssues = bothResult.issues.filter((issue) => issue.code === "assertion.MustExist");
    // Only the active plan's assertion should fire
    expect(assertionIssues).toHaveLength(1);
  });

  it("does not evaluate TargetAssertions for active approved plans in general lint", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/active/C-TARGET/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-TARGET><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions><TargetAssertions><MustVerify><Module>M-MISSING</Module></MustVerify></TargetAssertions></C-TARGET></GraceChangePlan>`,
    );
    const result = lintGraceProject(root);
    // TargetAssertion MustVerify for M-MISSING should NOT fire
    expect(result.issues.filter((issue) => issue.code === "assertion.MustVerify")).toHaveLength(0);
  });

  it("requires one approved identity-matched active change for selected assertion modes", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);

    expect(lintGraceProject(root, { assertionMode: "target" }).issues.map((issue) => issue.code)).toContain("assertion.change-required");
    expect(lintGraceProject(root, { assertionMode: "baseline", changeId: "not-a-change" }).issues.map((issue) => issue.code)).toContain("assertion.invalid-change-id");

    writeApprovedChange(
      root,
      "C-DRAFT",
      `<MustExist><Value>M-EXAMPLE</Value></MustExist>`,
      `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`,
      "draft",
    );
    expect(lintGraceProject(root, { assertionMode: "target", changeId: "C-DRAFT" }).issues.map((issue) => issue.code)).toContain("assertion.change-not-approved");
  });

  it("evaluates only the selected baseline or target section", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeApprovedChange(
      root,
      "C-SELECTED",
      `<MustExist><Value>M-EXAMPLE</Value></MustExist>`,
      `<MustVerify><Module>M-MISSING</Module></MustVerify>`,
    );

    const baseline = lintGraceProject(root, { assertionMode: "baseline", changeId: "C-SELECTED" });
    expect(baseline.issues.filter((issue) => issue.code === "assertion.MustVerify")).toHaveLength(0);
    expect(baseline.assertionMode).toBe("baseline");
    expect(baseline.changeId).toBe("C-SELECTED");

    const target = lintGraceProject(root, { assertionMode: "target", changeId: "C-SELECTED" });
    expect(target.issues.filter((issue) => issue.code === "assertion.MustVerify")).toHaveLength(1);
  });

  it("requires explicit command opt-in and exposes selected assertion CLI flags", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeApprovedChange(
      root,
      "C-COMMAND",
      `<MustExist><Value>M-EXAMPLE</Value></MustExist>`,
      `<MustPassCommand><Command>exit 0</Command></MustPassCommand>`,
    );

    const skipped = lintGraceProject(root, { assertionMode: "target", changeId: "C-COMMAND" });
    expect(skipped.issues.map((issue) => issue.code)).toContain("assertion.command-not-evaluated");

    const executed = lintGraceProject(root, { assertionMode: "target", changeId: "C-COMMAND", runCommands: true });
    expect(executed.issues.map((issue) => issue.code)).not.toContain("assertion.command-not-evaluated");
    expect(executed.commandsEnabled).toBe(true);

    const repoRoot = path.resolve(import.meta.dir, "..");
    const cli = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "lint", "--path", root, "--change", "C-COMMAND", "--assertions", "target", "--run-commands", "--format", "json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(cli.exitCode).toBe(0);
    expect(JSON.parse(Buffer.from(cli.stdout).toString("utf8")).assertionMode).toBe("target");
  });

  it("reserves blocking overlap diagnostics for explicit parallel preflight", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeApprovedChange(root, "C-ONE", `<MustExist><Value>M-EXAMPLE</Value></MustExist>`, `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`);
    writeApprovedChange(root, "C-TWO", `<MustExist><Value>M-EXAMPLE</Value></MustExist>`, `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`);

    const ordinaryCodes = lintGraceProject(root).issues.map((issue) => issue.code);
    expect(ordinaryCodes).toContain("scope.durable-overlap");
    expect(ordinaryCodes).not.toContain("scope.parallel-durable-overlap");
    expect(ordinaryCodes).not.toContain("scope.observed-write-overlap");

    const preflightCodes = lintGraceProject(root, { parallelPreflight: true }).issues.map((issue) => issue.code);
    expect(preflightCodes).toContain("scope.parallel-durable-overlap");
    expect(preflightCodes).toContain("scope.observed-write-overlap");
  });

  it("does not evaluate BaselineAssertions for active draft plans", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/active/C-DRAFT/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="draft"><C-DRAFT><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-DRAFT></GraceChangePlan>`,
    );
    // Draft active plan should NOT fire assertion.MustExist
    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(0);
  });

  it("fails active approved plans with failing BaselineAssertions", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/active/C-STALE/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-STALE><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-STALE></GraceChangePlan>`,
    );
    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(1);
  });

  it("accepts a bundle with design-context.xml", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/active/C-DESIGN/design-context.xml",
      `<GraceChangeDesignContext graceVersion="4.0"><Change>C-DESIGN</Change><Rationale>Test.</Rationale></GraceChangeDesignContext>`,
    );
    writeProjectFile(
      root,
      ".grace/changes/active/C-DESIGN/spec.xml",
      `<GraceChangeSpec graceVersion="4.0" status="approved"><C-DESIGN><Summary>Change with design context.</Summary></C-DESIGN></GraceChangeSpec>`,
    );
    writeProjectFile(
      root,
      ".grace/changes/active/C-DESIGN/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-DESIGN><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope></C-DESIGN></GraceChangePlan>`,
    );
    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.code.startsWith("design-context.") || issue.code === "artifact.invalid-root-tag" || issue.code === "change.invalid-root-tag")).toHaveLength(0);
  });
});
