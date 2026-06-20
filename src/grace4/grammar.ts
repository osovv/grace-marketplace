import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { detectGraceProjectKind, formatGrace3MigrationGuidance, resolveGrace4Paths } from "./project";
import {
  ACTIVE_CHANGE_STATUSES,
  ANCHOR_PATTERNS,
  ARCHIVED_CHANGE_STATUSES,
  CHANGE_STATUSES,
  GRACE4_CONTEXT_ARTIFACTS,
  GRACE4_ROOT_TAGS,
  GRACE4_VERSION,
  type Grace4Issue,
  type Grace4ProjectPaths,
} from "./types";
import { childText, readGraceXmlArtifact, walkNodes, type GraceXmlNode, type ParsedGraceXmlArtifact } from "./xml";

const STANDARD_ROOT_TAGS = new Set<string>(GRACE4_ROOT_TAGS);
const CHANGE_ROOT_TAGS = new Set(["GraceChangeSpec", "GraceChangePlan"]);
const VALID_CHANGE_STATUSES = new Set<string>(CHANGE_STATUSES);
const ROOT_METADATA_ATTRIBUTE = new Set(["graceVersion"]);
const CHANGE_ROOT_METADATA_ATTRIBUTES = new Set(["graceVersion", "status"]);

const CONTEXT_ARTIFACTS = [
  { file: "requirements.xml", rootTag: "GraceRequirements" },
  { file: "technology.xml", rootTag: "GraceTechnology" },
  { file: "principles.xml", rootTag: "GracePrinciples" },
  { file: "deployment.xml", rootTag: "GraceDeployment" },
  { file: "ux-guidelines.xml", rootTag: "GraceUXGuidelines" },
] as const;

/** Result of validating a single GRACE 4 artifact. */
export type ArtifactValidationResult = {
  file: string;
  rootTag?: string;
  graceVersion?: string;
  issues: Grace4Issue[];
};

/** Result of validating all current .grace documents in one project. */
export type Grace4ValidationResult = {
  root: string;
  issues: Grace4Issue[];
  artifacts: ArtifactValidationResult[];
};

/** Validates the root tag, graceVersion, and allowed root attributes for one artifact. */
export function validateArtifactRoot(artifact: ParsedGraceXmlArtifact): ArtifactValidationResult {
  const result: ArtifactValidationResult = {
    file: artifact.file,
    rootTag: artifact.root?.tag,
    graceVersion: artifact.root?.attributes.graceVersion,
    issues: [...artifact.issues],
  };

  if (!artifact.root) {
    return result;
  }

  const root = artifact.root;
  if (!STANDARD_ROOT_TAGS.has(root.tag)) {
    result.issues.push(issue("error", "artifact.invalid-root-tag", artifact.file, `Unsupported GRACE 4 root tag '${root.tag}'.`));
    return result;
  }

  if (!root.attributes.graceVersion) {
    result.issues.push(
      issue("error", "artifact.missing-grace-version", artifact.file, `${root.tag} must declare graceVersion="${GRACE4_VERSION}".`),
    );
  } else if (root.attributes.graceVersion !== GRACE4_VERSION) {
    result.issues.push(
      issue(
        "error",
        "artifact.unsupported-grace-version",
        artifact.file,
        `${root.tag} declares unsupported graceVersion '${root.attributes.graceVersion}'. Expected '${GRACE4_VERSION}'.`,
      ),
    );
  }

  const allowedAttributes = CHANGE_ROOT_TAGS.has(root.tag) ? CHANGE_ROOT_METADATA_ATTRIBUTES : ROOT_METADATA_ATTRIBUTE;
  for (const attribute of Object.keys(root.attributes)) {
    if (allowedAttributes.has(attribute)) {
      continue;
    }

    result.issues.push(
      issue(
        "error",
        attribute === "status" ? "artifact.forbidden-status-attribute" : "artifact.forbidden-root-attribute",
        artifact.file,
        `${attribute} is not an allowed root attribute on ${root.tag}.`,
      ),
    );
  }

  if (CHANGE_ROOT_TAGS.has(root.tag)) {
    validateChangeStatusAttribute(artifact.file, root, result.issues);
  }

  return result;
}

/** Validates that semantic anchors appear only as tags and never as attributes. */
export function validateSemanticAnchorDiscipline(file: string, root: GraceXmlNode): Grace4Issue[] {
  const issues: Grace4Issue[] = [];

  for (const node of walkNodes(root)) {
    for (const [attribute, value] of Object.entries(node.attributes)) {
      const anchor = findSemanticAnchorInAttribute(value);
      if (!anchor) {
        continue;
      }

      issues.push(
        issue(
          "error",
          "artifact.semantic-anchor-attribute",
          file,
          `Semantic anchor '${anchor}' appears in attribute '${attribute}' on <${node.tag}>; anchors must be XML tags.`,
        ),
      );
    }
  }

  return issues;
}

/** Validates the five mandatory context artifacts and applicability semantics. */
export function validateContextArtifacts(paths: Grace4ProjectPaths): ArtifactValidationResult[] {
  return CONTEXT_ARTIFACTS.map(({ file, rootTag }) => {
    const artifact = readGraceXmlArtifact(path.join(paths.contextDir, file));
    const result = validateParsedArtifact(artifact);

    if (artifact.root && artifact.root.tag !== rootTag) {
      result.issues.push(issue("error", "context.unexpected-root-tag", artifact.file, `${file} must use root tag ${rootTag}.`));
    }

    if (artifact.root && (artifact.root.tag === "GraceDeployment" || artifact.root.tag === "GraceUXGuidelines")) {
      result.issues.push(...validateOptionalContextApplicability(artifact.file, artifact.root));
    }

    return result;
  });
}

/** Validates GraceChangeSpec and GraceChangePlan root statuses and C-* wrapper shape. */
export function validateChangeArtifact(
  artifact: ParsedGraceXmlArtifact,
  location: "active" | "archive",
): ArtifactValidationResult {
  const result = validateParsedArtifact(artifact);
  const root = artifact.root;

  if (!root) {
    return result;
  }

  if (!CHANGE_ROOT_TAGS.has(root.tag)) {
    result.issues.push(issue("error", "change.invalid-root-tag", artifact.file, `${root.tag} is not a change artifact root.`));
    return result;
  }

  const status = root.attributes.status;
  if (status && location === "active" && !ACTIVE_CHANGE_STATUSES.has(status as never)) {
    result.issues.push(
      issue("error", "change.invalid-active-status", artifact.file, `Active change artifacts cannot use status '${status}'.`),
    );
  }
  if (status && location === "archive" && !ARCHIVED_CHANGE_STATUSES.has(status as never)) {
    result.issues.push(
      issue("error", "change.invalid-archive-status", artifact.file, `Archived change artifacts cannot use status '${status}'.`),
    );
  }

  const wrappers = root.children.filter((child) => ANCHOR_PATTERNS.change.test(child.tag));
  if (wrappers.length !== 1) {
    result.issues.push(
      issue("error", "change.invalid-wrapper", artifact.file, `${root.tag} must contain exactly one direct C-* wrapper tag.`),
    );
  }

  if (status === "superseded" && wrappers.length === 1) {
    const wrapper = wrappers[0];
    const hasReplacement = wrapper.children.some(
      (child) => ANCHOR_PATTERNS.change.test(child.tag) || child.tag === "Replacement" || child.tag === "ReplacementChange",
    );
    if (!hasReplacement) {
      result.issues.push(
        issue(
          "warning",
          "change.superseded-missing-replacement",
          artifact.file,
          "Superseded " + root.tag + " should reference a replacement C-* as a child tag or via <Replacement>/<ReplacementChange> text.",
        ),
      );
    }
  }

  return result;
}

/** Validates current-state .grace artifact grammar and lifecycle location invariants. */
export function validateGrace4Project(root: string): Grace4ValidationResult {
  const projectRoot = path.resolve(root);
  const projectKind = detectGraceProjectKind(projectRoot);
  const artifacts: ArtifactValidationResult[] = [];
  const issues: Grace4Issue[] = [];

  if (projectKind === "grace3") {
    issues.push(issue("error", "project.grace3-detected", projectRoot, formatGrace3MigrationGuidance(projectRoot)));
    return { root: projectRoot, issues, artifacts };
  }

  if (projectKind === "none") {
    issues.push(issue("error", "project.missing-grace", projectRoot, "No .grace directory found."));
    return { root: projectRoot, issues, artifacts };
  }

  const paths = resolveGrace4Paths(projectRoot);
  artifacts.push(...validateContextArtifacts(paths));
  artifacts.push(...validateRequiredArtifact(paths.graphIndex, "GraceGraphIndex"));
  artifacts.push(...validateXmlFilesInDirectory(paths.graphDir, [paths.graphIndex]));
  artifacts.push(...validateRequiredArtifact(paths.verificationIndex, "GraceVerificationIndex"));
  artifacts.push(...validateXmlFilesInDirectory(paths.verificationDir, [paths.verificationIndex]));
  artifacts.push(...validateChangeArtifactsInDirectory(paths.changesActiveDir, "active"));
  artifacts.push(...validateChangeArtifactsInDirectory(paths.changesArchiveDir, "archive"));

  return {
    root: projectRoot,
    artifacts,
    issues: artifacts.flatMap((artifact) => artifact.issues),
  };
}

function validateParsedArtifact(artifact: ParsedGraceXmlArtifact): ArtifactValidationResult {
  const result = validateArtifactRoot(artifact);
  if (artifact.root) {
    result.issues.push(...validateSemanticAnchorDiscipline(artifact.file, artifact.root));
  }
  return result;
}

function validateRequiredArtifact(file: string, expectedRootTag: string): ArtifactValidationResult[] {
  const artifact = readGraceXmlArtifact(file);
  const result = validateParsedArtifact(artifact);

  if (artifact.root && artifact.root.tag !== expectedRootTag) {
    result.issues.push(
      issue("error", "artifact.unexpected-root-tag", file, `${path.basename(file)} must use root tag ${expectedRootTag}.`),
    );
  }

  return [result];
}

function validateXmlFilesInDirectory(directory: string, excludedFiles: string[]): ArtifactValidationResult[] {
  if (!existsSync(directory)) {
    return [];
  }

  const excluded = new Set(excludedFiles.map((file) => path.resolve(file)));
  return listXmlFiles(directory)
    .filter((file) => !excluded.has(path.resolve(file)))
    .map((file) => validateParsedArtifact(readGraceXmlArtifact(file)));
}

function validateChangeArtifactsInDirectory(
  directory: string,
  location: "active" | "archive",
): ArtifactValidationResult[] {
  if (!existsSync(directory)) {
    return [];
  }

  return listXmlFiles(directory).map((file) => validateChangeArtifact(readGraceXmlArtifact(file), location));
}

function listXmlFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listXmlFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".xml")) {
      files.push(entryPath);
    }
  }

  return files.sort();
}

function validateChangeStatusAttribute(file: string, root: GraceXmlNode, issues: Grace4Issue[]) {
  const status = root.attributes.status;
  if (!status) {
    issues.push(issue("error", "change.missing-status", file, `${root.tag} must declare a lifecycle status.`));
    return;
  }

  if (!VALID_CHANGE_STATUSES.has(status)) {
    issues.push(issue("error", "change.invalid-status", file, `${root.tag} declares unsupported status '${status}'.`));
  }
}

function validateOptionalContextApplicability(file: string, root: GraceXmlNode): Grace4Issue[] {
  const applicability = (childText(root, "Applicability") ?? childText(root, "Status") ?? "").trim().toLowerCase();
  if (applicability !== "not-applicable") {
    return [];
  }

  const reason = (childText(root, "Reason") ?? childText(root, "NotApplicableReason") ?? childText(root, "Rationale") ?? "").trim();
  if (reason.length > 0) {
    return [];
  }

  return [issue("error", "context.not-applicable-reason-missing", file, `${root.tag} marked not-applicable requires a reason.`)];
}

function findSemanticAnchorInAttribute(value: string): string | null {
  const candidates = value.split(/[^A-Za-z0-9-]+/).filter(Boolean);
  for (const candidate of candidates) {
    if (Object.values(ANCHOR_PATTERNS).some((pattern) => pattern.test(candidate))) {
      return candidate;
    }
  }
  return null;
}

function issue(severity: Grace4Issue["severity"], code: string, file: string, message: string): Grace4Issue {
  return { severity, code, file, message };
}

export { GRACE4_CONTEXT_ARTIFACTS };
