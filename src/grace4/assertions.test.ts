import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { resolveGrace4Paths } from "./project";
import { buildGraphProjection, buildVerificationProjection } from "./projections";
import { runDeclaredCommands } from "./command-runner";
import { evaluateAssertion, extractAssertionsWithIssues, type AssertionContext, type GraceAssertion } from "./assertions";
import type { CommandRunResult } from "./command-runner";

function createProject() {
  const root = path.join(os.tmpdir(), `grace4-assertions-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeProjectionFixture(root: string) {
  writeProjectFile(root, "src/example.ts", "export const marker = 'fresh';\n");
  writeProjectFile(
    root,
    ".grace/graph/index.xml",
    `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-AUTH-SESSION /><M-USER-PROFILE /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
  );
  writeProjectFile(
    root,
    ".grace/graph/main.xml",
    `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-AUTH-SESSION><M-USER-PROFILE /></M-AUTH-SESSION><M-USER-PROFILE /></GD-MAIN></GraceGraphDocument>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/index.xml",
    `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-AUTH-SESSION /><V-M-USER-PROFILE /></Owns></VD-MAIN></VerificationDocuments></GraceVerificationIndex>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/main.xml",
    `<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-AUTH-SESSION><Command>bun test auth</Command></V-M-AUTH-SESSION><V-M-USER-PROFILE><Command>bun test profile</Command></V-M-USER-PROFILE></VD-MAIN></GraceVerificationDocument>`,
  );
}

function assertion(kind: GraceAssertion["kind"], values: string[]): GraceAssertion {
  return { kind, values, file: "plan.xml" };
}

function context(root: string): AssertionContext {
  const paths = resolveGrace4Paths(root);
  const graph = buildGraphProjection(paths);
  return { root, graph, verification: buildVerificationProjection(paths, graph) };
}

describe("GRACE 4 assertions", () => {
  it("extracts all approved assertion kinds and reports unknown assertion tags", () => {
    const root = createProject();
    const planFile = path.join(root, "plan.xml");
    writeFileSync(
      planFile,
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-EXAMPLE><BaselineAssertions><MustExist><Value>M-AUTH-SESSION</Value></MustExist><MustNotExist><Value>tmp/missing</Value></MustNotExist><MustOwn><Owner>GD-MAIN</Owner><Anchor>M-AUTH-SESSION</Anchor></MustOwn><MustLink><From>M-AUTH-SESSION</From><To>M-USER-PROFILE</To></MustLink><MustVerify><Module>M-AUTH-SESSION</Module></MustVerify><MustPassCommand><Command>bun --version</Command></MustPassCommand><MustContain><File>src/example.ts</File><Text>fresh</Text></MustContain><MustNotContain><File>src/example.ts</File><Text>stale</Text></MustNotContain><UnknownAssertion /></BaselineAssertions></C-EXAMPLE></GraceChangePlan>`,
    );

    const result = extractAssertionsWithIssues(planFile, "BaselineAssertions");

    expect(result.assertions.map((item) => item.kind)).toEqual([
      "MustExist",
      "MustNotExist",
      "MustOwn",
      "MustLink",
      "MustVerify",
      "MustPassCommand",
      "MustContain",
      "MustNotContain",
    ]);
    expect(result.issues.map((issue) => issue.code)).toContain("assertion.unknown-kind");
  });

  it("evaluates existence, ownership, links, verification coverage, containment, and commands", () => {
    const root = createProject();
    writeProjectionFixture(root);
    const ctx = context(root);

    expect(evaluateAssertion(assertion("MustExist", ["M-AUTH-SESSION", "src/example.ts"]), ctx)).toHaveLength(0);
    expect(evaluateAssertion(assertion("MustNotExist", ["M-MISSING", "src/missing.ts"]), ctx)).toHaveLength(0);
    expect(evaluateAssertion(assertion("MustOwn", ["GD-MAIN", "M-AUTH-SESSION"]), ctx)).toHaveLength(0);
    expect(evaluateAssertion(assertion("MustOwn", ["VD-MAIN", "V-M-AUTH-SESSION"]), ctx)).toHaveLength(0);
    expect(evaluateAssertion(assertion("MustLink", ["M-AUTH-SESSION", "M-USER-PROFILE"]), ctx)).toHaveLength(0);
    expect(evaluateAssertion(assertion("MustVerify", ["M-AUTH-SESSION"]), ctx)).toHaveLength(0);
    expect(evaluateAssertion(assertion("MustContain", ["src/example.ts", "fresh"]), ctx)).toHaveLength(0);
    expect(evaluateAssertion(assertion("MustNotContain", ["src/example.ts", "stale"]), ctx)).toHaveLength(0);
    expect(evaluateAssertion(assertion("MustPassCommand", ["exit 99"]), ctx)[0]?.code).toBe("assertion.command-not-evaluated");
    expect(evaluateAssertion(assertion("MustPassCommand", ["exit 99"]), { ...ctx, runCommands: true })).toHaveLength(1);
  });

  (process.platform === "win32" ? it : it.skip)("executes command assertions through Windows cmd.exe", async () => {
    const root = createProject();
    writeProjectionFixture(root);
    const summary = await runDeclaredCommands(
      [{ assertionKey: "plan.xml::TargetAssertions::0", assertionId: "plan.xml#1", command: "exit /b 0" }],
      {
        root,
        assertionMode: "target",
        timeoutMs: 10_000,
        verbosity: "compact",
        progress: () => {},
        logRoot: path.join(os.tmpdir(), `grace4-cmdexe-${crypto.randomUUID()}`),
      },
    );
    expect(summary.status).toBe("passed");
    expect(summary.commands[0]?.exitCode).toBe(0);
  });

  it("maps pre-computed command results to assertion issues without spawning", () => {
    const root = createProject();
    writeProjectionFixture(root);
    const slotKey = "plan.xml::TargetAssertions::0";
    const commandAssertion: GraceAssertion = { kind: "MustPassCommand", values: ["bun run gate"], file: "plan.xml", slotKey };
    const result = (overrides: Partial<CommandRunResult>): CommandRunResult => ({
      index: 1,
      assertionKey: slotKey,
      assertionId: "plan.xml#1",
      command: "bun run gate",
      exitCode: 0,
      durationMs: 1000,
      timedOut: false,
      skipped: false,
      logFile: null,
      outputTail: null,
      ...overrides,
    });

    const passing: AssertionContext = {
      ...context(root),
      runCommands: true,
      commandResults: new Map([[slotKey, [result({})]]]),
    };
    expect(evaluateAssertion(commandAssertion, passing)).toHaveLength(0);

    const failing: AssertionContext = {
      ...context(root),
      runCommands: true,
      commandResults: new Map([[slotKey, [result({ exitCode: 3, outputTail: "boom-tail" })]]]),
    };
    const failure = evaluateAssertion(commandAssertion, failing);
    expect(failure).toHaveLength(1);
    expect(failure[0]?.message).toContain("Command failed (3): bun run gate");
    expect(failure[0]?.message).toContain("boom-tail");

    const timedOut: AssertionContext = {
      ...context(root),
      runCommands: true,
      commandResults: new Map([[slotKey, [result({ exitCode: null, timedOut: true, durationMs: 600_000 })]]]),
    };
    const timeoutIssue = evaluateAssertion(commandAssertion, timedOut);
    expect(timeoutIssue).toHaveLength(1);
    expect(timeoutIssue[0]?.message).toContain("Command timed out after 600s: bun run gate");

    const skippedThenFailed: AssertionContext = {
      ...context(root),
      runCommands: true,
      commandResults: new Map([[slotKey, [result({ skipped: true }), result({ exitCode: 1 })]]]),
    };
    expect(evaluateAssertion(commandAssertion, skippedThenFailed)).toHaveLength(1);

    const missing: AssertionContext = { ...context(root), runCommands: true };
    const unavailable = evaluateAssertion(commandAssertion, missing);
    expect(unavailable).toHaveLength(1);
    expect(unavailable[0]?.message).toContain("Command results unavailable");
  });

  it("rejects missing, extra, duplicate, nested, and empty assertion fields", () => {
    const root = createProject();
    const planFile = path.join(root, "plan.xml");
    writeFileSync(
      planFile,
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-EXAMPLE><BaselineAssertions><MustOwn><Owner>GD-MAIN</Owner><Owner>GD-OTHER</Owner><Anchor /></MustOwn><MustLink><From>M-A</From><To>M-B</To><Extra>x</Extra></MustLink><MustVerify><Module><Nested /></Module></MustVerify><MustContain>text<File>src/example.ts</File></MustContain></BaselineAssertions></C-EXAMPLE></GraceChangePlan>`,
    );

    const result = extractAssertionsWithIssues(planFile, "BaselineAssertions");
    expect(result.assertions).toHaveLength(0);
    expect(result.issues.filter((item) => item.code === "assertion.invalid-shape").length).toBeGreaterThanOrEqual(6);
  });

  it("rejects text-only assertion sections with no machine-checkable assertions", () => {
    const root = createProject();
    const planFile = path.join(root, "plan.xml");
    writeFileSync(planFile, `<GraceChangePlan graceVersion="4.0" status="approved"><C-EXAMPLE><BaselineAssertions>assume it works</BaselineAssertions></C-EXAMPLE></GraceChangePlan>`);

    const result = extractAssertionsWithIssues(planFile, "BaselineAssertions");
    expect(result.assertions).toHaveLength(0);
    expect(result.issues.map((item) => item.code)).toContain("assertion.invalid-section-shape");
    expect(result.issues.map((item) => item.code)).toContain("assertion.empty-section");
  });

  it("rejects current-mode lifecycle lint nested inside target command evidence", () => {
    const root = createProject();
    const planFile = path.join(root, "plan.xml");
    writeFileSync(
      planFile,
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-EXAMPLE><TargetAssertions><MustPassCommand><Command>grace lint --path . --assertions current</Command><Command>bun run check</Command></MustPassCommand></TargetAssertions></C-EXAMPLE></GraceChangePlan>`,
    );

    const result = extractAssertionsWithIssues(planFile, "TargetAssertions");
    expect(result.issues.map((item) => item.code)).toContain("assertion.phase-incompatible-command");
    expect(result.assertions).toHaveLength(0);
    expect(result.issues.map((item) => item.code)).not.toContain("assertion.empty-section");
  });

  it("rejects absolute, traversal, and escaping-symlink File fields during extraction", () => {
    const root = createProject();
    const outside = createProject();
    writeFileSync(path.join(outside, "secret.txt"), "secret\n");
    symlinkSync(path.join(outside, "secret.txt"), path.join(root, "escape.txt"));
    const planFile = path.join(root, ".grace", "changes", "active", "C-PATHS", "plan.xml");
    mkdirSync(path.dirname(planFile), { recursive: true });
    writeFileSync(
      planFile,
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-PATHS><TargetAssertions><MustContain><File>/tmp/absolute</File><Text>x</Text></MustContain><MustContain><File>../traversal</File><Text>x</Text></MustContain><MustContain><File>escape.txt</File><Text>secret</Text></MustContain></TargetAssertions></C-PATHS></GraceChangePlan>`,
    );

    const result = extractAssertionsWithIssues(planFile, "TargetAssertions");
    expect(result.assertions).toHaveLength(0);
    expect(result.issues.filter((item) => item.code === "assertion.invalid-path")).toHaveLength(3);
  });

  it("reports failed assertions", () => {
    const root = createProject();
    writeProjectionFixture(root);
    const ctx = context(root);

    expect(evaluateAssertion(assertion("MustExist", ["M-MISSING"]), ctx)[0]?.code).toBe("assertion.MustExist");
    expect(evaluateAssertion(assertion("MustLink", ["M-AUTH-SESSION", "M-MISSING"]), ctx)[0]?.code).toBe("assertion.MustLink");
    expect(evaluateAssertion(assertion("MustVerify", ["M-MISSING"]), ctx)[0]?.code).toBe("assertion.MustVerify");
  });

  it("reports directory containment targets without throwing", () => {
    const root = createProject();
    writeProjectionFixture(root);
    const issues = evaluateAssertion(assertion("MustContain", ["src", "fresh"]), context(root));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("assertion.MustContain");
    expect(issues[0]?.message).toContain("regular file");
  });

  it("fails stale BaselineAssertions after durable graph state changes", () => {
    const root = createProject();
    writeProjectionFixture(root);
    const planFile = path.join(root, ".grace/changes/active/C-STALE/plan.xml");
    writeProjectFile(
      root,
      ".grace/changes/active/C-STALE/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-STALE><BaselineAssertions><MustOwn><Owner>GD-MAIN</Owner><Anchor>M-AUTH-SESSION</Anchor></MustOwn></BaselineAssertions></C-STALE></GraceChangePlan>`,
    );
    const assertionToCheck = extractAssertionsWithIssues(planFile, "BaselineAssertions").assertions[0]!;
    expect(evaluateAssertion(assertionToCheck, context(root))).toHaveLength(0);

    writeProjectFile(
      root,
      ".grace/graph/main.xml",
      `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-USER-PROFILE /></GD-MAIN></GraceGraphDocument>`,
    );

    expect(evaluateAssertion(assertionToCheck, context(root))[0]?.code).toBe("assertion.MustOwn");
  });

  it("extracts TargetAssertions from a plan", () => {
    const root = createProject();
    writeProjectionFixture(root);
    const planFile = path.join(root, "target-plan.xml");
    writeFileSync(
      planFile,
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-EXAMPLE><TargetAssertions><MustVerify><Module>M-AUTH-SESSION</Module></MustVerify></TargetAssertions></C-EXAMPLE></GraceChangePlan>`,
    );
    const result = extractAssertionsWithIssues(planFile, "TargetAssertions");
    expect(result.assertions).toHaveLength(1);
    expect(result.assertions[0]!.kind).toBe("MustVerify");
    expect(result.assertions[0]!.values).toContain("M-AUTH-SESSION");
  });

  it("evaluates TargetAssertions correctly when called directly", () => {
    // TargetAssertion MustVerify for existing module passes
    const root = createProject();
    writeProjectionFixture(root);
    const ctx = context(root);
    const passFile = path.join(root, "pass-plan.xml");
    writeFileSync(passFile, `<GraceChangePlan graceVersion="4.0" status="approved"><C-EX><TargetAssertions><MustVerify><Module>M-AUTH-SESSION</Module></MustVerify></TargetAssertions></C-EX></GraceChangePlan>`);
    const pass = extractAssertionsWithIssues(passFile, "TargetAssertions").assertions;
    if (pass.length > 0) {
      expect(evaluateAssertion(pass[0]!, ctx)).toHaveLength(0);
    }

    // TargetAssertion MustVerify for missing module fails
    const failRoot = createProject();
    writeProjectionFixture(failRoot);
    const failCtx = context(failRoot);
    const failFile = path.join(failRoot, "fail-plan.xml");
    writeFileSync(failFile, `<GraceChangePlan graceVersion="4.0" status="approved"><C-EX><TargetAssertions><MustVerify><Module>M-MISSING</Module></MustVerify></TargetAssertions></C-EX></GraceChangePlan>`);
    const failAssertions = extractAssertionsWithIssues(failFile, "TargetAssertions").assertions;
    if (failAssertions.length > 0) {
      expect(evaluateAssertion(failAssertions[0]!, failCtx)[0]?.code).toBe("assertion.MustVerify");
    }
  });
});
