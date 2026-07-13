import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { collectProjectStatus, formatStatusText } from "./grace-status";

function createProject() {
  return mkdtempSync(path.join(os.tmpdir(), "grace-status-"));
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

function writeChange(root: string, changeId: string, options: { location?: "active" | "archive"; specStatus: string; planStatus: string; file?: string; baselineAssertion?: string }) {
  const location = options.location ?? "active";
  const bundle = `.grace/changes/${location}/${changeId}`;
  writeProjectFile(root, `${bundle}/spec.xml`, `<GraceChangeSpec graceVersion="4.0" status="${options.specStatus}"><${changeId}><Summary>Change.</Summary><Goals><Goal>Apply the change.</Goal></Goals><NonGoals><NonGoal>Unrelated work.</NonGoal></NonGoals><AcceptanceCriteria><Criterion>The change is verified.</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand><ExpectedEvidence>Passing tests.</ExpectedEvidence></VerificationIntent></${changeId}></GraceChangeSpec>`);
  writeProjectFile(
    root,
    `${bundle}/plan.xml`,
    `<GraceChangePlan graceVersion="4.0" status="${options.planStatus}"><${changeId}><IntentSummary>Apply the change.</IntentSummary><BaselineAssertions>${options.baselineAssertion ?? ""}</BaselineAssertions><TargetAssertions></TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>${options.file ?? "src/example.ts"}</File></ObservedWriteScope><ImplementationPlan><T-001><Title>Apply change</Title><AcceptanceCriteria><Criterion>The change is complete.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001></ImplementationPlan></${changeId}></GraceChangePlan>`,
  );
}

function runGit(root: string, args: string[]) {
  const result = Bun.spawnSync({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(Buffer.from(result.stderr).toString("utf8"));
  }
}

describe("grace status", () => {
  it("summarizes durable GRACE 4 health and next action", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);

    const result = collectProjectStatus(root, { includeModules: true });

    expect(result.projectKind).toBe("grace4");
    expect(result.summary.contextArtifacts).toBe(5);
    expect(result.summary.graphModules).toBe(1);
    expect(result.summary.verificationEntries).toBe(1);
    expect(result.summary.readyModules).toBe(1);
    expect(result.nextAction).toContain("$grace-spec");
  });

  it("lists active and archived change bundles with statuses in JSON shape", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeChange(root, "C-ACTIVE", { specStatus: "approved", planStatus: "approved" });
    writeChange(root, "C-ARCHIVED", { location: "archive", specStatus: "applied", planStatus: "applied" });

    const result = collectProjectStatus(root);

    expect(result.summary.activeChanges).toBe(1);
    expect(result.summary.archivedChanges).toBe(1);
    expect(result.changes.find((change) => change.changeId === "C-ACTIVE")?.planStatus).toBe("approved");
    expect(result.changes.find((change) => change.changeId === "C-ARCHIVED")?.specStatus).toBe("applied");
    expect(result.nextAction).toContain("grace-execute");
  });

  it("surfaces overlapping approved changes as derived state, not XML status", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeChange(root, "C-ONE", { specStatus: "approved", planStatus: "approved", file: "src/example.ts" });
    writeChange(root, "C-TWO", { specStatus: "approved", planStatus: "approved", file: "src/example.ts" });

    const result = collectProjectStatus(root);
    const text = formatStatusText(result);

    expect(result.derivedStates).toContain("scope-overlap");
    expect(result.changes.every((change) => change.specStatus === "approved" && change.planStatus === "approved")).toBe(true);
    expect(text).toContain("scope-overlap");
  });

  it("reports invalid active/archive statuses from lint diagnostics", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeChange(root, "C-BAD-ACTIVE", { specStatus: "applied", planStatus: "applied" });

    const result = collectProjectStatus(root);

    expect(result.changes.find((change) => change.changeId === "C-BAD-ACTIVE")?.derivedStates).toContain("invalid-active-status");
    expect(result.integrity.topIssues.some((issue) => issue.includes("change.invalid-active-status"))).toBe(true);
    expect(result.nextAction).toContain("grace lint");
  });

  it("recommends review or replan when the spec is approved but the plan is still draft", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeChange(root, "C-NEEDS-PLAN", { specStatus: "approved", planStatus: "draft" });

    const result = collectProjectStatus(root);

    expect(result.changes.find((change) => change.changeId === "C-NEEDS-PLAN")?.derivedStates).toContain("needs-plan-approval");
    expect(result.nextAction).toContain("GraceChangePlan");
  });

  it("marks approved changes with failed baseline assertions as stale plans", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeChange(root, "C-STALE", {
      specStatus: "approved",
      planStatus: "approved",
      baselineAssertion: "<MustExist><Value>M-MISSING</Value></MustExist>",
    });

    const result = collectProjectStatus(root);
    expect(result.changes.find((change) => change.changeId === "C-STALE")?.derivedStates).toContain("stale-plan");
    expect(result.derivedStates).toContain("stale-plan");
    expect(result.nextAction).toContain("Supersede and replan");
  });

  it("distinguishes observed writes explained by approved scopes from unexplained git drift", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeChange(root, "C-DRIFT", { specStatus: "approved", planStatus: "approved", file: "src/example.ts" });
    runGit(root, ["init"]);
    runGit(root, ["config", "user.email", "grace@example.test"]);
    runGit(root, ["config", "user.name", "GRACE Test"]);
    runGit(root, ["config", "commit.gpgsign", "false"]);
    runGit(root, ["config", "core.hooksPath", "/dev/null"]);
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "test: baseline"]);
    writeProjectFile(root, "src/example.ts", "// planned change\n");
    writeProjectFile(root, "unplanned.txt", "unexpected\n");

    const result = collectProjectStatus(root);
    expect(result.observedDrift.available).toBe(true);
    expect(result.observedDrift.explainedFiles).toContain("src/example.ts");
    expect(result.observedDrift.unexplainedFiles).toContain("unplanned.txt");
    expect(result.derivedStates).toContain("explained-observed-drift");
    expect(result.derivedStates).toContain("unexplained-observed-drift");
  });

  it("reports GRACE 3 projects as migration candidates without loading docs as healthy", () => {
    const root = createProject();
    writeProjectFile(root, "docs/development-plan.xml", `<DevelopmentPlan />`);

    const result = collectProjectStatus(root);

    expect(result.projectKind).toBe("grace3");
    expect(result.derivedStates).toContain("migration-candidate");
    expect(result.summary.graphModules).toBe(0);
    expect(result.nextAction).toContain("grace-migrate");
  });

  it("wires the status command through the CLI", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    const repoRoot = path.resolve(import.meta.dir, "..");

    const statusResult = Bun.spawnSync({
      cmd: [process.execPath, "run", "./src/grace.ts", "status", "--path", root, "--json", "--fail-on", "never"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(statusResult.exitCode).toBe(0);
    const parsed = JSON.parse(Buffer.from(statusResult.stdout).toString("utf8"));
    expect(parsed.tool).toBe("grace-status");
    expect(parsed.summary.graphModules).toBe(1);
  });
});
