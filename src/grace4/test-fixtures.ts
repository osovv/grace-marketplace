import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function ensureChangeDirectories(root: string) {
  mkdirSync(path.join(root, ".grace", "changes", "active"), { recursive: true });
  mkdirSync(path.join(root, ".grace", "changes", "archive"), { recursive: true });
}

function writeContextArtifacts(root: string) {
  writeProjectFile(root, ".grace/context/requirements.xml", `<GraceRequirements graceVersion="4.0"><Summary>Required behavior.</Summary></GraceRequirements>`);
  writeProjectFile(root, ".grace/context/technology.xml", `<GraceTechnology graceVersion="4.0"><Runtime>Bun</Runtime></GraceTechnology>`);
  writeProjectFile(root, ".grace/context/principles.xml", `<GracePrinciples graceVersion="4.0"><Principle>Prefer evidence.</Principle></GracePrinciples>`);
  writeProjectFile(root, ".grace/context/deployment.xml", `<GraceDeployment graceVersion="4.0"><Applicability>applicable</Applicability></GraceDeployment>`);
  writeProjectFile(root, ".grace/context/ux-guidelines.xml", `<GraceUXGuidelines graceVersion="4.0"><Applicability>applicable</Applicability></GraceUXGuidelines>`);
}

/** Writes a minimal valid GRACE 4 project to a temporary directory. */
export function writeMinimalGrace4Project(root: string): void {
  writeContextArtifacts(root);
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
    `<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-EXAMPLE><Command>bun test src/example.test.ts</Command><Scenario>Example works.</Scenario><Marker>[Example][run][BLOCK_RUN]</Marker></V-M-EXAMPLE></VD-MAIN></GraceVerificationDocument>`,
  );
  ensureChangeDirectories(root);
}

/** Writes a GRACE 4 project with segmented graph and verification documents. */
export function writeSegmentedGrace4Project(root: string): void {
  writeContextArtifacts(root);
  writeProjectFile(
    root,
    ".grace/graph/index.xml",
    `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-CORE><Path>graph/core.xml</Path><Owns><M-EXAMPLE /><M-SECOND /></Owns></GD-CORE><GD-FLOWS><Path>graph/flows.xml</Path><Owns><DF-EXAMPLE-FLOW /></Owns></GD-FLOWS></GraphDocuments></GraceGraphIndex>`,
  );
  writeProjectFile(
    root,
    ".grace/graph/core.xml",
    `<GraceGraphDocument graceVersion="4.0"><GD-CORE><M-EXAMPLE><Summary>Example module.</Summary><Path>src/example.ts</Path><M-SECOND /></M-EXAMPLE><M-SECOND><Summary>Second module.</Summary><Path>src/second.ts</Path></M-SECOND></GD-CORE></GraceGraphDocument>`,
  );
  writeProjectFile(
    root,
    ".grace/graph/flows.xml",
    `<GraceGraphDocument graceVersion="4.0"><GD-FLOWS><DF-EXAMPLE-FLOW><Summary>Example flow.</Summary><M-EXAMPLE /><M-SECOND /></DF-EXAMPLE-FLOW></GD-FLOWS></GraceGraphDocument>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/index.xml",
    `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-CORE><Path>verification/core.xml</Path><Owns><V-M-EXAMPLE /></Owns></VD-CORE><VD-SECOND><Path>verification/second.xml</Path><Owns><V-M-SECOND /></Owns></VD-SECOND></VerificationDocuments></GraceVerificationIndex>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/core.xml",
    `<GraceVerificationDocument graceVersion="4.0"><VD-CORE><V-M-EXAMPLE><Command>bun test src/example.test.ts</Command><Scenario>Example works.</Scenario><Marker>[Example][run][BLOCK_RUN]</Marker></V-M-EXAMPLE></VD-CORE></GraceVerificationDocument>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/second.xml",
    `<GraceVerificationDocument graceVersion="4.0"><VD-SECOND><V-M-SECOND><Command>bun test src/second.test.ts</Command><Scenario>Second module works.</Scenario><Marker>[Second][run][BLOCK_RUN]</Marker></V-M-SECOND></VD-SECOND></GraceVerificationDocument>`,
  );
  ensureChangeDirectories(root);
}

/** Writes one active or archived change bundle fixture. */
export function writeChangeBundleFixture(root: string, options: {
  changeId: string;
  location: "active" | "archive";
  specStatus: string;
  planStatus?: string;
  planBody?: string;
  planBaselineAssertions?: string;
  planTargetAssertions?: string;
  designContext?: string;
}): void {
  const bundleRoot = `.grace/changes/${options.location}/${options.changeId}`;
  writeProjectFile(
    root,
    `${bundleRoot}/spec.xml`,
    `<GraceChangeSpec graceVersion="4.0" status="${options.specStatus}"><${options.changeId}><Summary>Fixture change.</Summary><Problem>Fixture problem.</Problem><Goals><Goal>Exercise the change lifecycle.</Goal></Goals><Constraints><Constraint>Preserve fixture validity.</Constraint></Constraints><NonGoals><NonGoal>Unrelated behavior.</NonGoal></NonGoals><AcceptanceCriteria><Criterion>The fixture remains valid.</Criterion></AcceptanceCriteria><AffectedAreas><M-EXAMPLE /></AffectedAreas><VerificationIntent><ExpectedCommand>bun test</ExpectedCommand><ExpectedEvidence>Passing tests.</ExpectedEvidence></VerificationIntent><Assumptions><Assumption>The fixture project exists.</Assumption></Assumptions></${options.changeId}></GraceChangeSpec>`,
  );

  if (options.planStatus) {
    const planBody = `<IntentSummary>Apply the fixture change.</IntentSummary><BaselineAssertions>${options.planBaselineAssertions ?? "<MustExist><Value>M-EXAMPLE</Value></MustExist>"}</BaselineAssertions><TargetAssertions>${options.planTargetAssertions ?? "<MustVerify><Module>M-EXAMPLE</Module></MustVerify>"}</TargetAssertions><DurableScope><GraphAnchors><M-EXAMPLE /></GraphAnchors></DurableScope><ObservedWriteScope><File>src/example.ts</File></ObservedWriteScope>${options.planBody ?? ""}<ImplementationPlan><T-001><Title>Apply fixture change</Title><DependsOn></DependsOn><AcceptanceCriteria><Criterion>The fixture remains valid.</Criterion></AcceptanceCriteria><Verification><Command>bun test</Command></Verification></T-001></ImplementationPlan>`;
    writeProjectFile(
      root,
      `${bundleRoot}/plan.xml`,
      `<GraceChangePlan graceVersion="4.0" status="${options.planStatus}"><${options.changeId}>${planBody}</${options.changeId}></GraceChangePlan>`,
    );
  }

  if (options.designContext) {
    writeProjectFile(
      root,
      `${bundleRoot}/design-context.xml`,
      options.designContext,
    );
  }
}

/** Writes a legacy GRACE 3 docs fixture used only for migration guidance tests. */
export function writeLegacyGrace3Project(root: string): void {
  writeProjectFile(root, "docs/development-plan.xml", `<DevelopmentPlan VERSION="0.2.0" />`);
  writeProjectFile(root, "docs/knowledge-graph.xml", `<KnowledgeGraph />`);
  writeProjectFile(root, "docs/verification-plan.xml", `<VerificationPlan VERSION="0.2.0" />`);
}
