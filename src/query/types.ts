import type { Grace4Issue } from "../grace4/types";
import type { GraphAnchorRecord, GraphProjection, VerificationProjection } from "../grace4/projections";
import type { FileMarkupRecord } from "../project-utils";

export type { FileBlockRecord, FileContractRecord, FileFieldSection, FileListItem, FileMarkupRecord } from "../project-utils";

export type ModuleInterfaceItem = {
  tag: string;
  purpose?: string;
  text?: string;
};

export type VerificationScenario = {
  tag: string;
  kind?: string;
  text: string;
};

export type ModuleVerificationRecord = {
  id: string;
  moduleId?: string;
  priority?: string;
  cwd?: string;
  testFiles: string[];
  moduleChecks: string[];
  scenarios: VerificationScenario[];
  requiredLogMarkers: string[];
  requiredTraceAssertions: string[];
  waveFollowUp?: string;
  phaseFollowUp?: string;
};

export type ModuleGraphRecord = GraphAnchorRecord & {
  name?: string;
  type?: string;
  status?: string;
  purpose?: string;
  path?: string;
  depends: string[];
  annotations: ModuleInterfaceItem[];
};

export type Grace4ModuleRecord = {
  id: string;
  name?: string;
  type?: string;
  graph: ModuleGraphRecord;
  verification: ModuleVerificationRecord | null;
  verifications: ModuleVerificationRecord[];
  localFiles: FileMarkupRecord[];
  /** GRACE 4 query layer is projection-backed; development-plan records are intentionally absent. */
  plan: null;
  steps: [];
};

export type ModuleRecord = Grace4ModuleRecord;

export type GraceArtifactIndex = {
  root: string;
  graph: GraphProjection;
  verification: VerificationProjection;
  modules: Grace4ModuleRecord[];
  verifications: ModuleVerificationRecord[];
  files: FileMarkupRecord[];
  issues: Grace4Issue[];
};

export type ModuleFindOptions = {
  query?: string;
  type?: string;
  dependsOn?: string;
};

export type ModuleMatch = {
  module: Grace4ModuleRecord;
  score: number;
  matchedBy: string[];
};

export type VerificationFindOptions = {
  query?: string;
  module?: string;
  priority?: string;
};

export type VerificationMatch = {
  verification: ModuleVerificationRecord;
  module: Grace4ModuleRecord | null;
  score: number;
  matchedBy: string[];
};

export type ModuleHealthIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  remediation: string;
};

export type ModuleHealthRecord = {
  moduleId: string;
  name: string;
  type?: string;
  path?: string;
  state: "ready" | "attention" | "blocked";
  verificationIds: string[];
  implementationFiles: string[];
  governedTestFiles: string[];
  verificationTestFiles: string[];
  blockers: ModuleHealthIssue[];
  warnings: ModuleHealthIssue[];
  summary: {
    hasGraph: boolean;
    hasImplementationFiles: boolean;
    hasVerification: boolean;
    hasVerificationTests: boolean;
    autonomyReady: boolean;
  };
  nextAction: string;
};
