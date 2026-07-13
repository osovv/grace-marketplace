import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { resolveGrace4Paths } from "./project";
import {
  validateArtifactRoot,
  validateChangeArtifact,
  validateChangeDesignContextArtifact,
  validateContextArtifacts,
  validateGrace4Project,
  validateSemanticAnchorDiscipline,
} from "./grammar";
import { writeChangeBundleFixture, writeLegacyGrace3Project, writeMinimalGrace4Project, writeSegmentedGrace4Project } from "./test-fixtures";
import { parseGraceXmlArtifact } from "./xml";

function createProject() {
  const root = path.join(os.tmpdir(), `grace4-grammar-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function codes(result: { issues: { code: string }[] }) {
  return result.issues.map((issue) => issue.code);
}

describe("GRACE 4 Artifact Grammar", () => {
  it("fixture builders create required GRACE 4 and legacy project shapes", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeChangeBundleFixture(root, { changeId: "C-FIXTURE", location: "active", specStatus: "approved", planStatus: "approved" });

    for (const relativePath of [
      ".grace/context/requirements.xml",
      ".grace/context/technology.xml",
      ".grace/context/principles.xml",
      ".grace/context/deployment.xml",
      ".grace/context/ux-guidelines.xml",
      ".grace/graph/index.xml",
      ".grace/graph/main.xml",
      ".grace/verification/index.xml",
      ".grace/verification/main.xml",
      ".grace/changes/active/C-FIXTURE/spec.xml",
      ".grace/changes/active/C-FIXTURE/plan.xml",
    ]) {
      expect(existsSync(path.join(root, relativePath))).toBe(true);
    }
    expect(validateGrace4Project(root).issues).toHaveLength(0);

    const segmentedRoot = createProject();
    writeSegmentedGrace4Project(segmentedRoot);
    expect(validateGrace4Project(segmentedRoot).issues).toHaveLength(0);
    expect(existsSync(path.join(segmentedRoot, ".grace/graph/core.xml"))).toBe(true);
    expect(existsSync(path.join(segmentedRoot, ".grace/verification/second.xml"))).toBe(true);

    const legacyRoot = createProject();
    writeLegacyGrace3Project(legacyRoot);
    expect(codes(validateGrace4Project(legacyRoot))).toContain("project.grace3-detected");
  });

  it("validates a minimal current .grace project", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);

    const result = validateGrace4Project(root);

    expect(result.issues).toHaveLength(0);
    expect(result.artifacts.map((artifact) => artifact.rootTag).sort()).toEqual([
      "GraceDeployment",
      "GraceGraphDocument",
      "GraceGraphIndex",
      "GracePrinciples",
      "GraceRequirements",
      "GraceTechnology",
      "GraceUXGuidelines",
      "GraceVerificationDocument",
      "GraceVerificationIndex",
    ]);
  });

  it("rejects graph and verification documents with the wrong artifact root", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/graph/main.xml",
      `<GraceRequirements graceVersion="4.0"><GD-MAIN><M-EXAMPLE /></GD-MAIN></GraceRequirements>`,
    );
    writeProjectFile(
      root,
      ".grace/verification/main.xml",
      `<GracePrinciples graceVersion="4.0"><VD-MAIN><V-M-EXAMPLE /></VD-MAIN></GracePrinciples>`,
    );

    const resultCodes = codes(validateGrace4Project(root));
    expect(resultCodes.filter((code) => code === "artifact.unexpected-root-tag")).toHaveLength(2);
  });

  it("rejects mismatched bundle ids and approved plans without the required executable contract", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/changes/active/C-FOLDER/spec.xml",
      `<GraceChangeSpec graceVersion="4.0" status="approved"><C-SPEC /></GraceChangeSpec>`,
    );
    writeProjectFile(
      root,
      ".grace/changes/active/C-FOLDER/plan.xml",
      `<GraceChangePlan graceVersion="4.0" status="approved"><C-PLAN /></GraceChangePlan>`,
    );

    const resultCodes = codes(validateGrace4Project(root));
    expect(resultCodes).toContain("change.bundle-id-mismatch");
    expect(resultCodes).toContain("change.spec-plan-id-mismatch");
    expect(resultCodes).toContain("change.spec-missing-section");
    expect(resultCodes).toContain("change.plan-missing-section");
  });

  it("rejects active plans created beside non-approved specs", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeChangeBundleFixture(root, { changeId: "C-DRAFT", location: "active", specStatus: "draft", planStatus: "draft" });

    expect(codes(validateGrace4Project(root))).toContain("change.plan-requires-approved-spec");
  });

  it("reports missing graceVersion, unsupported versions, invalid roots, and malformed XML", () => {
    const missing = validateArtifactRoot(parseGraceXmlArtifact("requirements.xml", `<GraceRequirements />`));
    const unsupported = validateArtifactRoot(parseGraceXmlArtifact("requirements.xml", `<GraceRequirements graceVersion="3.11" />`));
    const invalidRoot = validateArtifactRoot(parseGraceXmlArtifact("unknown.xml", `<NotGrace graceVersion="4.0" />`));
    const malformed = validateArtifactRoot(parseGraceXmlArtifact("broken.xml", `<GraceRequirements graceVersion="4.0"><Open></GraceRequirements>`));

    expect(codes(missing)).toContain("artifact.missing-grace-version");
    expect(codes(unsupported)).toContain("artifact.unsupported-grace-version");
    expect(codes(invalidRoot)).toContain("artifact.invalid-root-tag");
    expect(codes(malformed)).toContain("xml.parse");
  });

  it("allows status only on change artifact roots", () => {
    const context = validateArtifactRoot(
      parseGraceXmlArtifact("requirements.xml", `<GraceRequirements graceVersion="4.0" status="approved" />`),
    );
    const change = validateArtifactRoot(
      parseGraceXmlArtifact("spec.xml", `<GraceChangeSpec graceVersion="4.0" status="approved"><C-EXAMPLE /></GraceChangeSpec>`),
    );

    expect(codes(context)).toContain("artifact.forbidden-status-attribute");
    expect(change.issues).toHaveLength(0);
  });

  it("rejects semantic anchors used as attribute values", () => {
    const artifact = parseGraceXmlArtifact(
      "graph.xml",
      `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><Module ref="M-EXAMPLE" /></GD-MAIN></GraceGraphDocument>`,
    );

    expect(codes({ issues: validateSemanticAnchorDiscipline("graph.xml", artifact.root!) })).toContain(
      "artifact.semantic-anchor-attribute",
    );
  });

  it("rejects invalid active and archive change statuses", () => {
    const active = validateChangeArtifact(
      parseGraceXmlArtifact("active/plan.xml", `<GraceChangePlan graceVersion="4.0" status="applied"><C-EXAMPLE /></GraceChangePlan>`),
      "active",
    );
    const archive = validateChangeArtifact(
      parseGraceXmlArtifact("archive/spec.xml", `<GraceChangeSpec graceVersion="4.0" status="draft"><C-EXAMPLE /></GraceChangeSpec>`),
      "archive",
    );

    expect(codes(active)).toContain("change.invalid-active-status");
    expect(codes(archive)).toContain("change.invalid-archive-status");
  });

  it("requires not-applicable deployment and UX context artifacts to include a reason", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/context/deployment.xml",
      `<GraceDeployment graceVersion="4.0"><Applicability>not-applicable</Applicability></GraceDeployment>`,
    );
    writeProjectFile(
      root,
      ".grace/context/ux-guidelines.xml",
      `<GraceUXGuidelines graceVersion="4.0"><Applicability>not-applicable</Applicability></GraceUXGuidelines>`,
    );

    const results = validateContextArtifacts(resolveGrace4Paths(root));
    const allCodes = results.flatMap(codes);

    expect(allCodes.filter((code) => code === "context.not-applicable-reason-missing")).toHaveLength(2);
  });

  it("rejects lack of a web UI as the sole UX not-applicable reason", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeProjectFile(
      root,
      ".grace/context/ux-guidelines.xml",
      `<GraceUXGuidelines graceVersion="4.0"><Applicability>not-applicable</Applicability><Reason>Not a web app</Reason></GraceUXGuidelines>`,
    );

    const allCodes = validateContextArtifacts(resolveGrace4Paths(root)).flatMap(codes);
    expect(allCodes).toContain("context.ux-not-applicable-reason-insufficient");
  });

  it("errors when superseded change does not reference a replacement C-*", () => {
    const noReplacement = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<GraceChangeSpec graceVersion="4.0" status="superseded"><C-SUPERSEDED><Summary>Old change.</Summary></C-SUPERSEDED></GraceChangeSpec>`),
      "archive",
    );
    expect(codes(noReplacement)).toContain("change.superseded-missing-replacement");
    expect(noReplacement.issues.find(i => i.code === "change.superseded-missing-replacement")?.severity).toBe("error");

    const withChildTag = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<GraceChangeSpec graceVersion="4.0" status="superseded"><C-SUPERSEDED><C-REPLACEMENT /><Summary>Old change.</Summary></C-SUPERSEDED></GraceChangeSpec>`),
      "archive",
    );
    expect(codes(withChildTag)).not.toContain("change.superseded-missing-replacement");

    const withReplacementTag = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<GraceChangeSpec graceVersion="4.0" status="superseded"><C-SUPERSEDED><Replacement>C-REPLACEMENT</Replacement><Summary>Old change.</Summary></C-SUPERSEDED></GraceChangeSpec>`),
      "archive",
    );
    expect(codes(withReplacementTag)).not.toContain("change.superseded-missing-replacement");
  });

  it("rejects empty or arbitrary Replacement text and accepts ReplacementChange", () => {
    const emptyReplacement = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<GraceChangeSpec graceVersion="4.0" status="superseded"><C-SUPERSEDED><Replacement></Replacement><Summary>Old change.</Summary></C-SUPERSEDED></GraceChangeSpec>`),
      "archive",
    );
    expect(codes(emptyReplacement)).toContain("change.superseded-missing-replacement");

    const arbitraryReplacement = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<GraceChangeSpec graceVersion="4.0" status="superseded"><C-SUPERSEDED><Replacement>not-a-change</Replacement><Summary>Old change.</Summary></C-SUPERSEDED></GraceChangeSpec>`),
      "archive",
    );
    expect(codes(arbitraryReplacement)).toContain("change.superseded-missing-replacement");

    const replacementChange = validateChangeArtifact(
      parseGraceXmlArtifact(
        "archive/spec.xml",
        `<GraceChangeSpec graceVersion="4.0" status="superseded"><C-SUPERSEDED><ReplacementChange>C-REPLACEMENT</ReplacementChange><Summary>Old change.</Summary></C-SUPERSEDED></GraceChangeSpec>`),
      "archive",
    );
    expect(codes(replacementChange)).not.toContain("change.superseded-missing-replacement");
  });

  it("validates GraceChangeDesignContext inside change bundles", () => {
    const root = createProject();
    writeMinimalGrace4Project(root);
    writeChangeBundleFixture(root, { changeId: "C-DESIGN", location: "active", specStatus: "approved", planStatus: "approved", designContext: "<GraceChangeDesignContext graceVersion=\"4.0\"><Change>C-DESIGN</Change><Rationale>Test.</Rationale></GraceChangeDesignContext>" });
    expect(validateGrace4Project(root).issues).toHaveLength(0);
  });

  it("rejects invalid GraceChangeDesignContext root, missing graceVersion, status attribute", () => {
    const valid = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<GraceChangeDesignContext graceVersion="4.0" />`),
    );
    expect(valid.issues).toHaveLength(0);

    const wrongRoot = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<DesignContext graceVersion="4.0" />`),
    );
    expect(codes(wrongRoot)).toContain("design-context.invalid-root-tag");

    const noVersion = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<GraceChangeDesignContext />`),
    );
    expect(codes(noVersion)).toContain("design-context.missing-grace-version");

    const withStatus = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<GraceChangeDesignContext graceVersion="4.0" status="approved" />`),
    );
    expect(codes(withStatus)).toContain("design-context.forbidden-status");
  });

  it("accepts GraceChangeDesignContext with semantic anchor in child tag", () => {
    const result = validateChangeDesignContextArtifact(
      parseGraceXmlArtifact("design-context.xml", `<GraceChangeDesignContext graceVersion="4.0"><C-DESIGN><Rationale>Test.</Rationale></C-DESIGN></GraceChangeDesignContext>`),
    );
    expect(result.issues).toHaveLength(0);
  });
});
