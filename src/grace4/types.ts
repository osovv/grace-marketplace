/** Supported GRACE artifact grammar version for this release. */
export const GRACE4_VERSION = "4.0" as const;

/** Standard GRACE 4 root tags accepted by Artifact Grammar. */
export const GRACE4_ROOT_TAGS = [
  "GraceRequirements",
  "GraceTechnology",
  "GracePrinciples",
  "GraceDeployment",
  "GraceUXGuidelines",
  "GraceGraphIndex",
  "GraceGraphDocument",
  "GraceVerificationIndex",
  "GraceVerificationDocument",
  "GraceChangeSpec",
  "GraceChangePlan",
] as const;

/** Change-bundle companion root tags (valid only inside change bundles). */
export const GRACE4_CHANGE_COMPANION_TAGS = [
  "GraceChangeDesignContext",
] as const;

export type Grace4RootTag = (typeof GRACE4_ROOT_TAGS)[number];
export type Grace4ChangeCompanionTag = (typeof GRACE4_CHANGE_COMPANION_TAGS)[number];

/** Lifecycle statuses allowed on GraceChangeSpec and GraceChangePlan roots. */
export const CHANGE_STATUSES = ["draft", "approved", "applied", "rejected", "cancelled", "superseded"] as const;

export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

/** Statuses valid for bundles under .grace/changes/active. */
export const ACTIVE_CHANGE_STATUSES = new Set<ChangeStatus>(["draft", "approved"]);

/** Statuses valid for bundles under .grace/changes/archive. */
export const ARCHIVED_CHANGE_STATUSES = new Set<ChangeStatus>(["applied", "rejected", "cancelled", "superseded"]);

/** Mandatory GRACE 4 context artifact filenames. */
export const GRACE4_CONTEXT_ARTIFACTS = [
  "requirements.xml",
  "technology.xml",
  "principles.xml",
  "deployment.xml",
  "ux-guidelines.xml",
] as const;

export type Grace4ContextArtifact = (typeof GRACE4_CONTEXT_ARTIFACTS)[number];

/** Semantic anchor regexes. Semantic anchors are tags and never attributes. */
export const ANCHOR_PATTERNS = {
  graphDocument: /^GD-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  verificationDocument: /^VD-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  change: /^C-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  module: /^M-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  verification: /^V-M-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  dataFlow: /^DF-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  task: /^T-[0-9]{3}$/,
} as const;

/** Current-state validation issue emitted by GRACE 4 validators. */
export type Grace4Issue = {
  severity: "error" | "warning";
  code: string;
  file: string;
  line?: number;
  message: string;
};

/** Resolved canonical .grace path set for one project root. */
export type Grace4ProjectPaths = {
  root: string;
  graceDir: string;
  contextDir: string;
  graphIndex: string;
  graphDir: string;
  verificationIndex: string;
  verificationDir: string;
  changesActiveDir: string;
  changesArchiveDir: string;
};

/** Kind of GRACE project detected at a filesystem root. */
export type GraceProjectKind = "grace4" | "grace3" | "none";
