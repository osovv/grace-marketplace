import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { resolveGrace4Paths } from "./project";
import {
  validateArtifactRoot,
  validateChangeArtifact,
  validateContextArtifacts,
  validateGrace4Project,
  validateSemanticAnchorDiscipline,
} from "./grammar";
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
    `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-EXAMPLE><Summary>Example.</Summary></M-EXAMPLE></GD-MAIN></GraceGraphDocument>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/index.xml",
    `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /></Owns></VD-MAIN></VerificationDocuments></GraceVerificationIndex>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/main.xml",
    `<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-EXAMPLE><Command>bun test</Command></V-M-EXAMPLE></VD-MAIN></GraceVerificationDocument>`,
  );
  mkdirSync(path.join(root, ".grace", "changes", "active"), { recursive: true });
  mkdirSync(path.join(root, ".grace", "changes", "archive"), { recursive: true });
}

function codes(result: { issues: { code: string }[] }) {
  return result.issues.map((issue) => issue.code);
}

describe("GRACE 4 Artifact Grammar", () => {
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

  it("reports missing and unsupported graceVersion values", () => {
    const missing = validateArtifactRoot(parseGraceXmlArtifact("requirements.xml", `<GraceRequirements />`));
    const unsupported = validateArtifactRoot(parseGraceXmlArtifact("requirements.xml", `<GraceRequirements graceVersion="3.11" />`));

    expect(codes(missing)).toContain("artifact.missing-grace-version");
    expect(codes(unsupported)).toContain("artifact.unsupported-grace-version");
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
});
