import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { formatTextReport, lintGraceProject, parseCommandTimeoutMs, resolveCommandVerbosity } from "./grace-lint";
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
//   DEPENDS: none
//   LINKS: M-EXAMPLE
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
//   run - Execute the example runtime.
// END_MODULE_MAP
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


/** Isolated command log root per test invocation; never touches the real XDG cache. */
function testCommandLogRoot(): string {
  const dir = path.join(os.tmpdir(), `grace-lint-cmdlogs-${crypto.randomUUID()}`);
  return dir;
}

describe("lintGraceProject", () => {
  it("passes a valid GRACE 4 .grace project", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);

    const result = await lintGraceProject(root);

    expect(result.summary.errors).toBe(0);
    expect(result.tool).toBe("grace-lint");
    expect(result.schemaVersion).toBe("1.0.0");
    expect(result.generatedAt).toBeTruthy();
    expect(result.root).toBe(path.resolve(root));
    expect(result.xmlFilesChecked).toBeGreaterThan(0);
  });

  it("counts adapter-less C sources among governed files", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      "src/driver.c",
      `// START_MODULE_CONTRACT
//   PURPOSE: Bring up the example driver.
//   SCOPE: C fixture without a language adapter.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
//   MAP_MODE: SUMMARY
// END_MODULE_CONTRACT
// START_MODULE_MAP
//   driver_init - Initialize the driver.
// END_MODULE_MAP
void driver_init(void) {}
`,
    );
    const result = await lintGraceProject(root);

    expect(result.summary.errors).toBe(0);
    expect(result.governedFiles).toBe(2);
  });

  it("counts adapter-less C# and PowerShell sources among governed files", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      "src/SessionStore.cs",
      `// START_MODULE_CONTRACT
//   PURPOSE: Persist operator sessions.
//   SCOPE: C# fixture without a language adapter.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
//   MAP_MODE: SUMMARY
// END_MODULE_CONTRACT
// START_MODULE_MAP
//   SessionStore - Store and retrieve sessions.
// END_MODULE_MAP
namespace Example;

public sealed class SessionStore
{
    public void Clear() { }
}
`,
    );
    writeProjectFile(
      root,
      "scripts/Publish.ps1",
      `# START_MODULE_CONTRACT
#   PURPOSE: Publish the release artifacts.
#   SCOPE: PowerShell fixture without a language adapter.
#   DEPENDS: none
#   LINKS: M-EXAMPLE
#   ROLE: SCRIPT
#   MAP_MODE: LOCALS
# END_MODULE_CONTRACT
# START_MODULE_MAP
#   Publish-Artifacts - Copy artifacts to the release share.
# END_MODULE_MAP
function Publish-Artifacts {
  Write-Output 'published'
}
`,
    );
    const result = await lintGraceProject(root);

    expect(result.summary.errors).toBe(0);
    expect(result.governedFiles).toBe(3);
  });

  it("fails with migration guidance when only GRACE 3 docs are present", async () => {
    const root = createProject();
    writeProjectFile(root, "docs/development-plan.xml", `<DevelopmentPlan />`);

    const result = await lintGraceProject(root);

    expect(result.issues[0]?.code).toBe("project.grace3-detected");
    expect(result.issues[0]?.message).toContain("grace-migrate");
    expect(result.issues.map((issue) => issue.code)).toEqual(["project.grace3-detected"]);
  });

  it("fails with missing .grace guidance when no GRACE artifacts exist", async () => {
    const result = await lintGraceProject(createProject());

    expect(result.issues[0]?.code).toBe("project.missing-grace");
    expect(result.issues[0]?.message).toContain("No .grace directory");
  });

  it("returns JSON-compatible output shape with issue counts", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, ".grace/context/requirements.xml", `<GraceRequirements><Summary>Missing version.</Summary></GraceRequirements>`);

    const result = await lintGraceProject(root);

    expect(JSON.parse(JSON.stringify(result)).tool).toBe("grace-lint");
    expect(result.summary.errors).toBeGreaterThan(0);
    expect(result.issues.map((issue) => issue.code)).toContain("artifact.missing-grace-version");
  });

  it("rejects wrong document roots, unindexed documents, and mismatched executable bundles", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, ".grace/graph/main.xml", `<GraceRequirements graceVersion="4.0"><GD-MAIN><M-EXAMPLE /></GD-MAIN></GraceRequirements>`);
    writeProjectFile(root, ".grace/graph/unindexed.xml", `<GraceGraphDocument graceVersion="4.0"><GD-EXTRA><M-EXTRA /></GD-EXTRA></GraceGraphDocument>`);
    writeProjectFile(root, ".grace/changes/active/C-FOLDER/spec.xml", `<GraceChangeSpec graceVersion="4.0" status="approved"><C-SPEC /></GraceChangeSpec>`);
    writeProjectFile(root, ".grace/changes/active/C-FOLDER/plan.xml", `<GraceChangePlan graceVersion="4.0" status="approved"><C-PLAN /></GraceChangePlan>`);

    const issueCodes = (await lintGraceProject(root)).issues.map((issue) => issue.code);
    expect(issueCodes).toContain("artifact.unexpected-root-tag");
    expect(issueCodes).toContain("projection.graph.unindexed-document");
    expect(issueCodes).toContain("change.bundle-id-mismatch");
    expect(issueCodes).toContain("change.spec-plan-id-mismatch");
    expect(issueCodes).toContain("change.plan-missing-section");
  });

  it("documents GRACE 4 diagnostic prefixes and removes allow-missing-docs CLI exposure", async () => {
    expect(getLintIssueGuide("projection.graph.wrapper-mismatch").title).toContain("Projection");
    expect(getLintIssueGuide("assertion.MustExist").title).toContain("Assertion");
    expect(getLintIssueGuide("scope.durable-overlap").title).toContain("Scope");

    const lintSource = readFileSync(path.resolve(import.meta.dir, "grace-lint.ts"), "utf8");
    expect(lintSource).not.toContain("allowMissingDocs");
    expect(lintSource).not.toContain("allow-missing-docs");
  });

  it("wires the lint command through the CLI", async () => {
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

  it("returns structured JSON for invalid options and missing project paths without stack traces", async () => {
    const repoRoot = path.resolve(import.meta.dir, "..");
    const invalid = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "lint", "--profile", "unsupported", "--format", "json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(invalid.exitCode).not.toBe(0);
    expect(Buffer.from(invalid.stderr).toString("utf8")).toBe("");
    expect(JSON.parse(Buffer.from(invalid.stdout).toString("utf8"))).toEqual(expect.objectContaining({
      schemaVersion: "1.0.0",
      ok: false,
      error: expect.objectContaining({ code: "invalid-arguments" }),
    }));

    const missingRoot = path.join(os.tmpdir(), `grace-missing-${crypto.randomUUID()}`);
    const missing = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "lint", "--path", missingRoot, "--format", "json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(missing.exitCode).not.toBe(0);
    expect(Buffer.from(missing.stderr).toString("utf8")).toBe("");
    const missingResult = JSON.parse(Buffer.from(missing.stdout).toString("utf8"));
    expect(missingResult.tool).toBe("grace-lint");
    expect(missingResult.issues.map((issue: { code: string }) => issue.code)).toContain("project.missing-grace");
  });
  it("does not evaluate BaselineAssertions for archived plans", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    // Only create archived plan with BaselineAssertions
    writeProjectFile(
      root,
      ".grace/changes/archive/C-DONE/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="applied"><C-DONE><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions></C-DONE></GraceChangePlan>`,
    );
    expect((await lintGraceProject(root)).issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(0);

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

    const after = await lintGraceProject(root);
    expect(after.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(0);
  });
  it("emits assertion.MustExist for active plans with stale BaselineAssertions but not for archived plans", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);

    // Create an active plan with a MustExist reference to a module that does not exist
    writeProjectFile(
      root,
      ".grace/changes/active/C-REFACTOR/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-REFACTOR><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-REFACTOR></GraceChangePlan>`,
    );

    // Active plan should emit assertion.MustExist for nonexistent module
    const activeResult = await lintGraceProject(root);
    expect(activeResult.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(1);

    // Now also add an archived plan with the same stale baseline
    writeProjectFile(
      root,
      ".grace/changes/archive/C-DONE/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="applied"><C-DONE><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-DONE></GraceChangePlan>`,
    );

    // Archived plan should NOT emit additional assertion.MustExist
    const bothResult = await lintGraceProject(root);
    const assertionIssues = bothResult.issues.filter((issue) => issue.code === "assertion.MustExist");
    // Only the active plan's assertion should fire
    expect(assertionIssues).toHaveLength(1);
  });

  it("does not evaluate TargetAssertions for active approved plans in general lint", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/active/C-TARGET/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-TARGET><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions><TargetAssertions><MustVerify><Module>M-MISSING</Module></MustVerify></TargetAssertions></C-TARGET></GraceChangePlan>`,
    );
    const result = await lintGraceProject(root);
    // TargetAssertion MustVerify for M-MISSING should NOT fire
    expect(result.issues.filter((issue) => issue.code === "assertion.MustVerify")).toHaveLength(0);
  });

  it("requires one approved identity-matched active change for selected assertion modes", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);

    expect((await lintGraceProject(root, { assertionMode: "target" })).issues.map((issue) => issue.code)).toContain("assertion.change-required");
    expect((await lintGraceProject(root, { assertionMode: "baseline", changeId: "not-a-change" })).issues.map((issue) => issue.code)).toContain("assertion.invalid-change-id");

    writeApprovedChange(
      root,
      "C-DRAFT",
      `<MustExist><Value>M-EXAMPLE</Value></MustExist>`,
      `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`,
      "draft",
    );
    expect((await lintGraceProject(root, { assertionMode: "target", changeId: "C-DRAFT" })).issues.map((issue) => issue.code)).toContain("assertion.change-not-approved");
  });

  it("evaluates only the selected baseline or target section", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeApprovedChange(
      root,
      "C-SELECTED",
      `<MustExist><Value>M-EXAMPLE</Value></MustExist>`,
      `<MustVerify><Module>M-MISSING</Module></MustVerify>`,
    );

    const baseline = await lintGraceProject(root, { assertionMode: "baseline", changeId: "C-SELECTED" });
    expect(baseline.issues.filter((issue) => issue.code === "assertion.MustVerify")).toHaveLength(0);
    expect(baseline.assertionMode).toBe("baseline");
    expect(baseline.changeId).toBe("C-SELECTED");

    const target = await lintGraceProject(root, { assertionMode: "target", changeId: "C-SELECTED" });
    expect(target.issues.filter((issue) => issue.code === "assertion.MustVerify")).toHaveLength(1);
  });

  it("requires explicit command opt-in and exposes selected assertion CLI flags", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeApprovedChange(
      root,
      "C-COMMAND",
      `<MustPassCommand><Command>exit 99</Command></MustPassCommand>`,
      `<MustPassCommand><Command>${process.platform === "win32" ? "exit /b 0" : "exit 0"}</Command></MustPassCommand>`,
    );

    const current = await lintGraceProject(root);
    expect(current.issues.map((issue) => issue.code)).not.toContain("assertion.command-not-evaluated");
    expect(current.issues.some((issue) => issue.message.includes("exit 99"))).toBe(false);

    const skipped = await lintGraceProject(root, { assertionMode: "target", changeId: "C-COMMAND" });
    expect(skipped.issues.map((issue) => issue.code)).toContain("assertion.command-not-evaluated");

    const executed = await lintGraceProject(root, { assertionMode: "target", changeId: "C-COMMAND", runCommands: true, commandLogRoot: testCommandLogRoot(), commandProgress: () => {} });
    expect(executed.issues.map((issue) => issue.code)).not.toContain("assertion.command-not-evaluated");
    expect(executed.commandsEnabled).toBe(true);

    const repoRoot = path.resolve(import.meta.dir, "..");
    const cliCache = path.join(os.tmpdir(), `grace-cli-cache-${crypto.randomUUID()}`);
    const cli = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "lint", "--path", root, "--change", "C-COMMAND", "--assertions", "target", "--run-commands", "--format", "json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, XDG_CACHE_HOME: cliCache },
    });
    expect(cli.exitCode).toBe(0);
    const cliPayload = JSON.parse(Buffer.from(cli.stdout).toString("utf8"));
    expect(cliPayload.assertionMode).toBe("target");
    expect(cliPayload.commands).toHaveLength(1);
    expect(cliPayload.commands[0].exitCode).toBe(0);
  });

  it("run-commands gate: passing command yields evidence, compact progress, and meta.json", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, "gate-ok.js", `console.log("gate-ok");\n`);
    writeApprovedChange(root, "C-GATE-PASS", `<MustExist><Value>M-EXAMPLE</Value></MustExist>`, `<MustPassCommand><Command>${process.execPath} gate-ok.js</Command></MustPassCommand>`);

    const lines: string[] = [];
    const logRoot = testCommandLogRoot();
    const result = await lintGraceProject(root, {
      assertionMode: "target",
      changeId: "C-GATE-PASS",
      runCommands: true,
      commandVerbosity: "compact",
      commandProgress: (line) => lines.push(line),
      commandLogRoot: logRoot,
    });

    expect(result.summary.errors).toBe(0);
    expect(result.commands).toHaveLength(1);
    expect(result.commands?.[0]).toMatchObject({ exitCode: 0, timedOut: false, skipped: false });
    const progress = lines.join("\n");
    expect(progress).toContain("run-commands: change C-GATE-PASS (target)");
    expect(progress).toMatch(/✔ \[1\/1\] .+gate-ok\.js/);

    const runDirs = readdirSync(path.join(logRoot));
    expect(runDirs).toHaveLength(1);
    const meta = JSON.parse(await Bun.file(path.join(logRoot, runDirs[0], "runs", readdirSync(path.join(logRoot, runDirs[0], "runs"))[0], "meta.json")).text());
    expect(meta.status).toBe("passed");
    expect(meta.changeId).toBe("C-GATE-PASS");
  });

  it("run-commands gate: failing command yields Command failed issue and report line", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, "boom-gate.js", `console.error("boom-gate"); process.exit(3);\n`);
    writeApprovedChange(root, "C-GATE-FAIL", `<MustExist><Value>M-EXAMPLE</Value></MustExist>`, `<MustPassCommand><Command>${process.execPath} boom-gate.js</Command></MustPassCommand>`);

    const result = await lintGraceProject(root, {
      assertionMode: "target",
      changeId: "C-GATE-FAIL",
      runCommands: true,
      commandProgress: () => {},
      commandLogRoot: testCommandLogRoot(),
    });

    const failure = result.issues.find((issue) => issue.message.includes("Command failed (3)"));
    expect(failure?.message).toContain("boom-gate");
    const report = formatTextReport(result);
    expect(report).toContain("Commands");
    expect(report).toMatch(/✖ \[1\/1\] .+boom-gate\.js \(.*exit 3\)/);
    expect(report).toContain("Errors: 1");
  });

  it("run-commands gate: slow command times out with dedicated issue text", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, "hang-forever.js", `setInterval(() => {}, 60000);\n`);
    writeApprovedChange(root, "C-GATE-SLOW", `<MustExist><Value>M-EXAMPLE</Value></MustExist>`, `<MustPassCommand><Command>${process.execPath} hang-forever.js</Command></MustPassCommand>`);

    const result = await lintGraceProject(root, {
      assertionMode: "target",
      changeId: "C-GATE-SLOW",
      runCommands: true,
      commandTimeoutMs: 500,
      commandProgress: () => {},
      commandLogRoot: testCommandLogRoot(),
    });

    const timeoutIssue = result.issues.find((issue) => issue.message.includes("Command timed out after"));
    expect(timeoutIssue?.message).toContain("hang-forever.js");
    expect(result.commands?.[0]).toMatchObject({ timedOut: true, exitCode: null });
  });

  it("rejects target command evidence that recursively invokes current baseline lint", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeApprovedChange(
      root,
      "C-PHASE-CONFLICT",
      `<MustExist><Value>M-EXAMPLE</Value></MustExist>`,
      `<MustPassCommand><Command>grace lint --path . --assertions current</Command></MustPassCommand>`,
    );

    const current = await lintGraceProject(root);
    const issue = current.issues.find((item) => item.code === "assertion.phase-incompatible-command");
    expect(issue?.message).toContain("leaf project evidence");
    expect(issue?.title).toContain("Phase-Incompatible");

    const final = await lintGraceProject(root, { assertionMode: "final", changeId: "C-PHASE-CONFLICT", runCommands: true, commandLogRoot: testCommandLogRoot(), commandProgress: () => {} });
    expect(final.issues.map((item) => item.code)).toContain("assertion.phase-incompatible-command");
    expect(final.issues.map((item) => item.code)).not.toContain("assertion.MustPassCommand");
  });

  it("does not apply new phase policy retroactively to archived plans", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/archive/C-HISTORICAL/spec.xml",
      `<GraceChangeSpec graceVersion="4.0" status="applied"><C-HISTORICAL><Summary>Historical change.</Summary><Goals><Goal>Preserve history.</Goal></Goals><Constraints><Constraint>Do not rewrite archives.</Constraint></Constraints><NonGoals><NonGoal>New behavior.</NonGoal></NonGoals><AcceptanceCriteria><Criterion>History remains readable.</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand></VerificationIntent></C-HISTORICAL></GraceChangeSpec>`,
    );
    writeProjectFile(
      root,
      ".grace/changes/archive/C-HISTORICAL/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="applied"><C-HISTORICAL><IntentSummary>Historical plan.</IntentSummary><BaselineAssertions><MustExist><Value>M-EXAMPLE</Value></MustExist></BaselineAssertions><TargetAssertions><MustPassCommand><Command>grace lint --path . --assertions current</Command></MustPassCommand></TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope><ImplementationPlan><T-001><Title>Historical task</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>Done.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001></ImplementationPlan></C-HISTORICAL></GraceChangePlan>`,
    );

    expect((await lintGraceProject(root)).issues.map((item) => item.code)).not.toContain("assertion.phase-incompatible-command");
  });

  it("reserves blocking overlap diagnostics for explicit parallel preflight", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeApprovedChange(root, "C-ONE", `<MustExist><Value>M-EXAMPLE</Value></MustExist>`, `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`);
    writeApprovedChange(root, "C-TWO", `<MustExist><Value>M-EXAMPLE</Value></MustExist>`, `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`);

    const ordinaryCodes = (await lintGraceProject(root)).issues.map((issue) => issue.code);
    expect(ordinaryCodes).toContain("scope.durable-overlap");
    expect(ordinaryCodes).not.toContain("scope.parallel-durable-overlap");
    expect(ordinaryCodes).not.toContain("scope.observed-write-overlap");

    const preflightCodes = (await lintGraceProject(root, { parallelPreflight: true })).issues.map((issue) => issue.code);
    expect(preflightCodes).toContain("scope.parallel-durable-overlap");
    expect(preflightCodes).toContain("scope.observed-write-overlap");
  });

  it("does not evaluate BaselineAssertions for active draft plans", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/active/C-DRAFT/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="draft"><C-DRAFT><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-DRAFT></GraceChangePlan>`,
    );
    // Draft active plan should NOT fire assertion.MustExist
    const result = await lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(0);
  });

  it("fails active approved plans with failing BaselineAssertions", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/active/C-STALE/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-STALE><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-STALE></GraceChangePlan>`,
    );
    const result = await lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.code === "assertion.MustExist")).toHaveLength(1);
  });

  it("parses approved plan status through XML regardless of attribute quote style", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeApprovedChange(
      root,
      "C-SINGLE-QUOTE",
      `<MustExist><Value>M-MISSING</Value></MustExist>`,
      `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`,
    );
    const planFile = path.join(root, ".grace/changes/active/C-SINGLE-QUOTE/plan.xml");
    writeFileSync(planFile, readFileSync(planFile, "utf8").replace('status="approved"', "status='approved'"));

    expect((await lintGraceProject(root)).issues.map((issue) => issue.code)).toContain("assertion.MustExist");
  });

  it("uses final assertion mode for full end-state validation without re-evaluating the selected baseline", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeApprovedChange(
      root,
      "C-CREATE",
      `<MustNotExist><Value>M-NEW</Value></MustNotExist>`,
      `<MustVerify><Module>M-NEW</Module></MustVerify>`,
    );
    expect((await lintGraceProject(root)).summary.errors).toBe(0);

    writeProjectFile(root, ".grace/graph/index.xml", `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /><M-NEW /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`);
    writeProjectFile(root, ".grace/graph/main.xml", `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-EXAMPLE><Summary>Example module.</Summary></M-EXAMPLE><M-NEW><Summary>New module.</Summary></M-NEW></GD-MAIN></GraceGraphDocument>`);
    writeProjectFile(root, ".grace/verification/index.xml", `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /><V-M-NEW /></Owns></VD-MAIN></VerificationDocuments></GraceVerificationIndex>`);
    writeProjectFile(root, ".grace/verification/main.xml", `<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-EXAMPLE><Scenario>Example works.</Scenario></V-M-EXAMPLE><V-M-NEW><Scenario>New module works.</Scenario></V-M-NEW></VD-MAIN></GraceVerificationDocument>`);

    const current = await lintGraceProject(root);
    expect(current.issues.map((issue) => issue.code)).toContain("assertion.MustNotExist");

    const final = await lintGraceProject(root, { assertionMode: "final", changeId: "C-CREATE" });
    expect(final.summary.errors).toBe(0);
    expect(final.assertionMode).toBe("final");
  });

  it("keeps unrelated approved baselines active during selected final validation", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeApprovedChange(root, "C-SELECTED-FINAL", `<MustExist><Value>M-EXAMPLE</Value></MustExist>`, `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`);
    writeApprovedChange(root, "C-UNRELATED-STALE", `<MustExist><Value>M-MISSING</Value></MustExist>`, `<MustVerify><Module>M-EXAMPLE</Module></MustVerify>`);

    const final = await lintGraceProject(root, { assertionMode: "final", changeId: "C-SELECTED-FINAL" });
    expect(final.issues.map((issue) => issue.code)).toContain("assertion.MustExist");
  });

  it("accepts a bundle with design-context.xml", async () => {
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
    const result = await lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.code.startsWith("design-context.") || issue.code === "artifact.invalid-root-tag" || issue.code === "change.invalid-root-tag")).toHaveLength(0);
  });
});

describe("lintGraceProject unreadable directories", () => {
  const permissionsUnsupported = process.platform === "win32" || process.getuid?.() === 0;

  it.skipIf(permissionsUnsupported)("warns walk.unreadable-directory and continues instead of aborting", async () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(root, "blocked/hidden.ts", "export const hidden = true;\n");
    const baseline = await lintGraceProject(root);

    const blockedDir = path.join(root, "blocked");
    chmodSync(blockedDir, 0o000);

    try {
      const result = await lintGraceProject(root);
      const walkIssues = result.issues.filter((issue) => issue.code === "walk.unreadable-directory");
      expect(walkIssues).toHaveLength(1);
      expect(walkIssues[0]?.severity).toBe("warning");
      expect(walkIssues[0]?.file).toBe(blockedDir);
      expect(walkIssues[0]?.message).toContain(blockedDir);
      // The unreadable subtree drops out of the checked set; nothing else changes.
      expect(result.filesChecked).toBe(baseline.filesChecked - 1);
      expect(result.summary.errors).toBe(baseline.summary.errors);
    } finally {
      chmodSync(blockedDir, 0o755);
    }
  });
});

describe("run-commands CLI flag resolution", () => {
  it("parses command timeouts as non-negative integer seconds", () => {
    expect(parseCommandTimeoutMs("600")).toBe(600_000);
    expect(parseCommandTimeoutMs("0")).toBe(0);
    expect(parseCommandTimeoutMs(undefined)).toBe(600_000);
    expect(() => parseCommandTimeoutMs("-5")).toThrow();
    expect(() => parseCommandTimeoutMs("1.5")).toThrow();
    expect(() => parseCommandTimeoutMs("soon")).toThrow();
  });

  it("resolves verbosity: json and quiet force compact, verbose and interactive force live", () => {
    const base = { verbose: false, quiet: false, interactive: false };
    expect(resolveCommandVerbosity({ ...base, format: "json" })).toBe("compact");
    expect(resolveCommandVerbosity({ ...base, format: "json", verbose: true })).toBe("compact");
    expect(resolveCommandVerbosity({ ...base, format: "text", verbose: true })).toBe("live");
    expect(resolveCommandVerbosity({ ...base, format: "text", quiet: true })).toBe("compact");
    expect(resolveCommandVerbosity({ ...base, format: "text", interactive: true })).toBe("live");
    expect(resolveCommandVerbosity({ ...base, format: "text" })).toBe("compact");
    expect(() => resolveCommandVerbosity({ format: "text", verbose: true, quiet: true, interactive: false })).toThrow();
  });
});
