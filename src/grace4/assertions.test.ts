import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { resolveGrace4Paths } from "./project";
import { buildGraphProjection, buildVerificationProjection } from "./projections";
import { evaluateAssertion, extractAssertionsWithIssues, type AssertionContext, type GraceAssertion } from "./assertions";

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
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-EXAMPLE><BaselineAssertions><MustExist><Value>M-AUTH-SESSION</Value></MustExist><MustNotExist><Path>tmp/missing</Path></MustNotExist><MustOwn><Owner>GD-MAIN</Owner><Anchor>M-AUTH-SESSION</Anchor></MustOwn><MustLink><From>M-AUTH-SESSION</From><To>M-USER-PROFILE</To></MustLink><MustVerify><Module>M-AUTH-SESSION</Module></MustVerify><MustPassCommand><Command>bun --version</Command></MustPassCommand><MustContain><File>src/example.ts</File><Text>fresh</Text></MustContain><MustNotContain><File>src/example.ts</File><Text>stale</Text></MustNotContain><UnknownAssertion /></BaselineAssertions></C-EXAMPLE></GraceChangePlan>`,
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
    expect(evaluateAssertion(assertion("MustPassCommand", ["exit 99"]), ctx)).toHaveLength(0);
    expect(evaluateAssertion(assertion("MustPassCommand", ["exit 99"]), { ...ctx, runCommands: true })).toHaveLength(1);
  });

  it("reports failed assertions", () => {
    const root = createProject();
    writeProjectionFixture(root);
    const ctx = context(root);

    expect(evaluateAssertion(assertion("MustExist", ["M-MISSING"]), ctx)[0]?.code).toBe("assertion.MustExist");
    expect(evaluateAssertion(assertion("MustLink", ["M-AUTH-SESSION", "M-MISSING"]), ctx)[0]?.code).toBe("assertion.MustLink");
    expect(evaluateAssertion(assertion("MustVerify", ["M-MISSING"]), ctx)[0]?.code).toBe("assertion.MustVerify");
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
});
