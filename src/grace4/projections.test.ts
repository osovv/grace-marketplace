import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { resolveGrace4Paths } from "./project";
import { buildGraphProjection, buildVerificationProjection } from "./projections";

function createProject() {
  const root = path.join(os.tmpdir(), `grace4-projections-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeMonolithicProject(root: string) {
  writeProjectFile(
    root,
    ".grace/graph/index.xml",
    `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-AUTH-SESSION /><M-USER-PROFILE /><DF-AUTH-TOKEN-FLOW /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
  );
  writeProjectFile(
    root,
    ".grace/graph/main.xml",
    `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-AUTH-SESSION><Summary>Authenticate users.</Summary><M-USER-PROFILE /></M-AUTH-SESSION><M-USER-PROFILE><Summary>Profiles.</Summary></M-USER-PROFILE><DF-AUTH-TOKEN-FLOW><Summary>Token flow.</Summary></DF-AUTH-TOKEN-FLOW></GD-MAIN></GraceGraphDocument>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/index.xml",
    `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-AUTH-SESSION /><V-M-USER-PROFILE /></Owns></VD-MAIN></VerificationDocuments></GraceVerificationIndex>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/main.xml",
    `<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-AUTH-SESSION><Command>bun test auth</Command><Scenario>valid login</Scenario><Marker>[Auth]</Marker></V-M-AUTH-SESSION><V-M-USER-PROFILE><Command>bun test profile</Command><Scenario>profile view</Scenario><Marker>[Profile]</Marker></V-M-USER-PROFILE></VD-MAIN></GraceVerificationDocument>`,
  );
}

function writeSegmentedProject(root: string) {
  writeProjectFile(
    root,
    ".grace/graph/index.xml",
    `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-AUTH><Path>graph/auth.xml</Path><Owns><M-AUTH-SESSION /><DF-AUTH-TOKEN-FLOW /></Owns></GD-AUTH><GD-PROFILE><Path>graph/profile.xml</Path><Owns><M-USER-PROFILE /></Owns></GD-PROFILE></GraphDocuments></GraceGraphIndex>`,
  );
  writeProjectFile(
    root,
    ".grace/graph/auth.xml",
    `<GraceGraphDocument graceVersion="4.0"><GD-AUTH><M-AUTH-SESSION><Summary>Authenticate users.</Summary><M-USER-PROFILE /></M-AUTH-SESSION><DF-AUTH-TOKEN-FLOW><Summary>Token flow.</Summary></DF-AUTH-TOKEN-FLOW></GD-AUTH></GraceGraphDocument>`,
  );
  writeProjectFile(
    root,
    ".grace/graph/profile.xml",
    `<GraceGraphDocument graceVersion="4.0"><GD-PROFILE><M-USER-PROFILE><Summary>Profiles.</Summary></M-USER-PROFILE></GD-PROFILE></GraceGraphDocument>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/index.xml",
    `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-AUTH><Path>verification/auth.xml</Path><Owns><V-M-AUTH-SESSION /></Owns></VD-AUTH><VD-PROFILE><Path>verification/profile.xml</Path><Owns><V-M-USER-PROFILE /></Owns></VD-PROFILE></VerificationDocuments></GraceVerificationIndex>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/auth.xml",
    `<GraceVerificationDocument graceVersion="4.0"><VD-AUTH><V-M-AUTH-SESSION><Command>bun test auth</Command><Scenario>valid login</Scenario><Marker>[Auth]</Marker></V-M-AUTH-SESSION></VD-AUTH></GraceVerificationDocument>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/profile.xml",
    `<GraceVerificationDocument graceVersion="4.0"><VD-PROFILE><V-M-USER-PROFILE><Command>bun test profile</Command><Scenario>profile view</Scenario><Marker>[Profile]</Marker></V-M-USER-PROFILE></VD-PROFILE></GraceVerificationDocument>`,
  );
}

function issueCodes(issues: { code: string }[]) {
  return issues.map((issue) => issue.code);
}

describe("GRACE 4 graph and verification projections", () => {
  it("routes graph anchors and verification entries through their indexes", () => {
    const root = createProject();
    writeMonolithicProject(root);
    const paths = resolveGrace4Paths(root);

    const graph = buildGraphProjection(paths);
    const verification = buildVerificationProjection(paths, graph);

    expect(graph.issues).toHaveLength(0);
    expect(verification.issues).toHaveLength(0);
    expect([...graph.modules.keys()].sort()).toEqual(["M-AUTH-SESSION", "M-USER-PROFILE"]);
    expect(graph.dataFlows.has("DF-AUTH-TOKEN-FLOW")).toBe(true);
    expect(graph.modules.get("M-AUTH-SESSION")?.owner).toBe("GD-MAIN");
    expect(graph.modules.get("M-AUTH-SESSION")?.links).toEqual(["M-USER-PROFILE"]);
    expect(verification.entries.get("V-M-AUTH-SESSION")?.commands).toEqual(["bun test auth"]);
  });

  it("reports wrapper mismatch, unlisted anchors, duplicate anchors, and missing verification coverage", () => {
    const root = createProject();
    writeProjectFile(
      root,
      ".grace/graph/index.xml",
      `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-AUTH-SESSION /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
    );
    writeProjectFile(
      root,
      ".grace/graph/main.xml",
      `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-AUTH-SESSION /><M-AUTH-SESSION /><M-UNLISTED /></GD-MAIN></GraceGraphDocument>`,
    );
    writeProjectFile(
      root,
      ".grace/verification/index.xml",
      `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns></Owns></VD-MAIN></VerificationDocuments></GraceVerificationIndex>`,
    );
    writeProjectFile(root, ".grace/verification/main.xml", `<GraceVerificationDocument graceVersion="4.0"><VD-OTHER /></GraceVerificationDocument>`);

    const paths = resolveGrace4Paths(root);
    const graph = buildGraphProjection(paths);
    const verification = buildVerificationProjection(paths, graph);

    expect(issueCodes(graph.issues)).toContain("projection.graph.duplicate-anchor");
    expect(issueCodes(graph.issues)).toContain("projection.graph.unlisted-anchor");
    expect(issueCodes(verification.issues)).toContain("projection.verification.wrapper-mismatch");
    expect(issueCodes(verification.issues)).toContain("projection.verification.missing-module-coverage");
  });

  it("reports graph wrapper mismatches", () => {
    const root = createProject();
    writeProjectFile(
      root,
      ".grace/graph/index.xml",
      `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-AUTH-SESSION /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
    );
    writeProjectFile(root, ".grace/graph/main.xml", `<GraceGraphDocument graceVersion="4.0"><GD-OTHER><M-AUTH-SESSION /></GD-OTHER></GraceGraphDocument>`);

    const graph = buildGraphProjection(resolveGrace4Paths(root));

    expect(issueCodes(graph.issues)).toContain("projection.graph.wrapper-mismatch");
  });

  it("reports missing routes and dangling graph links", () => {
    const root = createProject();
    writeProjectFile(
      root,
      ".grace/graph/index.xml",
      `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MISSING-PATH><Owns><M-IGNORED /></Owns></GD-MISSING-PATH><GD-MAIN><Path>graph/main.xml</Path><Owns><M-AUTH-SESSION /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
    );
    writeProjectFile(
      root,
      ".grace/graph/main.xml",
      `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-AUTH-SESSION><M-MISSING /></M-AUTH-SESSION></GD-MAIN></GraceGraphDocument>`,
    );

    const graph = buildGraphProjection(resolveGrace4Paths(root));

    expect(issueCodes(graph.issues)).toContain("projection.index.missing-path");
    expect(issueCodes(graph.issues)).toContain("projection.graph.dangling-link");
  });

  it("reports graph and verification XML documents that are not routed by their indexes", () => {
    const root = createProject();
    writeProjectFile(root, ".grace/graph/index.xml", `<GraceGraphIndex graceVersion="4.0"><GraphDocuments /></GraceGraphIndex>`);
    writeProjectFile(root, ".grace/graph/main.xml", `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-EXAMPLE /></GD-MAIN></GraceGraphDocument>`);
    writeProjectFile(root, ".grace/verification/index.xml", `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments /></GraceVerificationIndex>`);
    writeProjectFile(root, ".grace/verification/main.xml", `<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-EXAMPLE /></VD-MAIN></GraceVerificationDocument>`);

    const paths = resolveGrace4Paths(root);
    const graph = buildGraphProjection(paths);
    const verification = buildVerificationProjection(paths, graph);

    expect(issueCodes(graph.issues)).toContain("projection.graph.unindexed-document");
    expect(issueCodes(verification.issues)).toContain("projection.verification.unindexed-document");
  });

  it("rejects absolute and escaping projection paths without reading them", () => {
    const root = createProject();
    writeProjectFile(
      root,
      ".grace/graph/index.xml",
      `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-ESCAPE><Path>../outside.xml</Path><Owns /></GD-ESCAPE><GD-ABS><Path>/tmp/outside.xml</Path><Owns /></GD-ABS><GD-WINDOWS><Path>C:\\outside.xml</Path><Owns /></GD-WINDOWS></GraphDocuments></GraceGraphIndex>`,
    );

    const graph = buildGraphProjection(resolveGrace4Paths(root));
    expect(issueCodes(graph.issues).filter((code) => code === "projection.index.path-outside-area")).toHaveLength(3);
  });

  it("produces equivalent projections for monolithic and segmented storage", () => {
    const monolithicRoot = createProject();
    const segmentedRoot = createProject();
    writeMonolithicProject(monolithicRoot);
    writeSegmentedProject(segmentedRoot);

    const monolithicGraph = buildGraphProjection(resolveGrace4Paths(monolithicRoot));
    const segmentedGraph = buildGraphProjection(resolveGrace4Paths(segmentedRoot));
    const monolithicVerification = buildVerificationProjection(resolveGrace4Paths(monolithicRoot), monolithicGraph);
    const segmentedVerification = buildVerificationProjection(resolveGrace4Paths(segmentedRoot), segmentedGraph);

    expect(monolithicGraph.issues).toHaveLength(0);
    expect(segmentedGraph.issues).toHaveLength(0);
    expect([...monolithicGraph.modules.keys()].sort()).toEqual([...segmentedGraph.modules.keys()].sort());
    expect([...monolithicGraph.dataFlows.keys()].sort()).toEqual([...segmentedGraph.dataFlows.keys()].sort());
    expect([...monolithicVerification.entries.keys()].sort()).toEqual([...segmentedVerification.entries.keys()].sort());
  });

  it("detects nested graph anchors inside grouping tags", () => {
    const root = createProject();
    writeProjectFile(
      root,
      ".grace/graph/index.xml",
      `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-AUTH-SESSION /><M-USER-PROFILE /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
    );
    writeProjectFile(
      root,
      ".grace/graph/main.xml",
      `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-AUTH-SESSION /><M-USER-PROFILE /><ModuleAnchors><M-AUTH-SESSION><Summary>Authenticate users.</Summary></M-AUTH-SESSION></ModuleAnchors></GD-MAIN></GraceGraphDocument>`,
    );

    const graph = buildGraphProjection(resolveGrace4Paths(root));
    expect(issueCodes(graph.issues)).toContain("projection.graph.nested-anchors");
    // Empty direct anchor is still found, but nested content is NOT projected
    expect(graph.modules.has("M-AUTH-SESSION")).toBe(true);
    expect(graph.modules.get("M-AUTH-SESSION")?.text).not.toContain("Authenticate");
  });

  it("detects nested verification anchors inside grouping tags", () => {
    const root = createProject();
    writeProjectFile(
      root,
      ".grace/graph/index.xml",
      `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
    );
    writeProjectFile(
      root,
      ".grace/graph/main.xml",
      `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-EXAMPLE><Summary>Example module.</Summary></M-EXAMPLE></GD-MAIN></GraceGraphDocument>`,
    );
    writeProjectFile(
      root,
      ".grace/verification/index.xml",
      `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /></Owns></VD-MAIN></VerificationDocuments></GraceVerificationIndex>`,
    );
    writeProjectFile(
      root,
      ".grace/verification/main.xml",
      `<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-EXAMPLE /><ModuleVerification><V-M-EXAMPLE><Command>bun test example</Command></V-M-EXAMPLE></ModuleVerification></VD-MAIN></GraceVerificationDocument>`,
    );

    const paths = resolveGrace4Paths(root);
    const graph = buildGraphProjection(paths);
    const verification = buildVerificationProjection(paths, graph);
    expect(issueCodes(verification.issues)).toContain("projection.verification.nested-anchors");
    // Empty direct anchor is still found, but nested content is NOT projected
    expect(verification.entries.has("V-M-EXAMPLE")).toBe(true);
    expect(verification.entries.get("V-M-EXAMPLE")?.commands).toEqual([]);
  });

  it("reports nested anchors when populated grouped section shadows empty direct anchor", () => {
    const root = createProject();
    writeProjectFile(
      root,
      ".grace/graph/index.xml",
      `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-AUTH-SESSION /><M-USER-PROFILE /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
    );
    writeProjectFile(
      root,
      ".grace/graph/main.xml",
      `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-AUTH-SESSION /><M-USER-PROFILE /><Modules><M-AUTH-SESSION><Summary>Nested auth session.</Summary></M-AUTH-SESSION></Modules></GD-MAIN></GraceGraphDocument>`,
    );
    writeProjectFile(
      root,
      ".grace/verification/index.xml",
      `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-AUTH-SESSION /></Owns></VD-MAIN></VerificationDocuments></GraceVerificationIndex>`,
    );
    writeProjectFile(
      root,
      ".grace/verification/main.xml",
      `<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-AUTH-SESSION /><VerificationAnchors><V-M-AUTH-SESSION><Command>bun test auth</Command></V-M-AUTH-SESSION></VerificationAnchors></VD-MAIN></GraceVerificationDocument>`,
    );

    const paths = resolveGrace4Paths(root);
    const graph = buildGraphProjection(paths);
    const verification = buildVerificationProjection(paths, graph);
    expect(issueCodes(graph.issues)).toContain("projection.graph.nested-anchors");
    expect(issueCodes(verification.issues)).toContain("projection.verification.nested-anchors");
    // Empty direct anchors are still found
    expect(graph.modules.has("M-AUTH-SESSION")).toBe(true);
    expect(verification.entries.has("V-M-AUTH-SESSION")).toBe(true);
    // Nested content NOT projected into records
    expect(verification.entries.get("V-M-AUTH-SESSION")?.commands).toEqual([]);
  });

  it("collects testFiles only from <TestFiles><File> and excludes naked <File> siblings", () => {
    const root = createProject();
    writeProjectFile(
      root,
      ".grace/graph/index.xml",
      `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`
    );
    writeProjectFile(
      root,
      ".grace/graph/main.xml",
      `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-EXAMPLE><Summary>Example module.</Summary></M-EXAMPLE></GD-MAIN></GraceGraphDocument>`
    );
    writeProjectFile(
      root,
      ".grace/verification/index.xml",
      `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /></Owns></VD-MAIN></VerificationDocuments></GraceVerificationIndex>`
    );
    writeProjectFile(
      root,
      ".grace/verification/main.xml",
      `<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-EXAMPLE><Cwd>apps/web</Cwd><TestFiles><File>src/example.test.ts</File></TestFiles><File>src/metadata.ts</File><Command>bun test example</Command></V-M-EXAMPLE></VD-MAIN></GraceVerificationDocument>`
    );

    const paths = resolveGrace4Paths(root);
    const graph = buildGraphProjection(paths);
    const verification = buildVerificationProjection(paths, graph);

    expect(verification.issues).toHaveLength(0);
    const entry = verification.entries.get("V-M-EXAMPLE")!;
    expect(entry.cwd).toBe("apps/web");
    expect(entry.testFiles).toEqual(["src/example.test.ts"]);
    // src/metadata.ts under a naked <File> (outside <TestFiles>) must NOT appear
    expect(entry.testFiles).not.toContain("src/metadata.ts");
  });

  it("rejects verification cwd values that escape the project root", () => {
    const root = createProject();
    writeMonolithicProject(root);
    writeProjectFile(
      root,
      ".grace/verification/main.xml",
      `<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-AUTH-SESSION><Cwd>../../outside</Cwd></V-M-AUTH-SESSION><V-M-USER-PROFILE><Cwd>C:\\outside</Cwd></V-M-USER-PROFILE></VD-MAIN></GraceVerificationDocument>`,
    );

    const paths = resolveGrace4Paths(root);
    const graph = buildGraphProjection(paths);
    const verification = buildVerificationProjection(paths, graph);
    expect(issueCodes(verification.issues).filter((code) => code === "projection.verification.invalid-cwd")).toHaveLength(2);
    expect(verification.entries.get("V-M-AUTH-SESSION")?.cwd).toBeUndefined();
  });
});
