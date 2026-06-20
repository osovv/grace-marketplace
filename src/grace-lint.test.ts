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
      cmd: [process.execPath, "run", "./src/grace.ts", "lint", "--path", root, "--format", "json"],
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
      `<GraceChangePlan graceVersion="4.0" status="draft"><C-REFACTOR><BaselineAssertions><MustExist><Value>M-NONEXISTENT</Value></MustExist></BaselineAssertions></C-REFACTOR></GraceChangePlan>`,
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
});
