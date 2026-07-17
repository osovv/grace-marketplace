import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { detectGraceProjectKind, formatGrace3MigrationGuidance, resolveGrace4Paths } from "./project";
import {
  ACTIVE_CHANGE_STATUSES,
  ANCHOR_PATTERNS,
  ARCHIVED_CHANGE_STATUSES,
  CHANGE_STATUSES,
  GRACE4_CHANGE_COMPANION_TAGS,
  GRACE4_CONTEXT_ARTIFACTS,
  GRACE4_ROOT_TAGS,
  GRACE4_VERSION,
  type Grace4Issue,
  type Grace4ProjectPaths,
  type SemanticAnchorClassification,
  type SemanticAnchorFamily,
} from "./types";
import { childText, readGraceXmlArtifact, walkNodes, type GraceXmlNode, type ParsedGraceXmlArtifact } from "./xml";

const STANDARD_ROOT_TAGS = new Set<string>(GRACE4_ROOT_TAGS);
const CHANGE_ROOT_TAGS = new Set(["GraceChangeSpec", "GraceChangePlan"]);
const COMPANION_ROOT_TAGS = new Set<string>(GRACE4_CHANGE_COMPANION_TAGS);
const VALID_CHANGE_STATUSES = new Set<string>(CHANGE_STATUSES);
const ROOT_METADATA_ATTRIBUTE = new Set(["graceVersion"]);
const CHANGE_ROOT_METADATA_ATTRIBUTES = new Set(["graceVersion", "status"]);
const SPEC_REQUIRED_SECTIONS = [
  "Summary",
  "Goals",
  "Constraints",
  "NonGoals",
  "AcceptanceCriteria",
  "AffectedAreas",
  "VerificationIntent",
] as const;
const PLAN_REQUIRED_SECTIONS = [
  "IntentSummary",
  "BaselineAssertions",
  "TargetAssertions",
  "DurableScope",
  "ObservedWriteScope",
  "ImplementationPlan",
] as const;
const TASK_REQUIRED_SECTIONS = ["Title", "DependsOn", "AcceptanceCriteria", "Verification"] as const;
const ASSERTION_SECTION_TAGS = new Set([
  "MustExist",
  "MustNotExist",
  "MustOwn",
  "MustLink",
  "MustVerify",
  "MustPassCommand",
  "MustContain",
  "MustNotContain",
]);
const DURABLE_SCOPE_DIRECT_TAGS = new Set([
  "GraphAnchors",
  "VerificationAnchors",
  "GraphDocuments",
  "VerificationDocuments",
  "ContextArtifacts",
  "ContextArtifact",
  "Context",
  "Artifact",
  "None",
]);
const OBSERVED_SCOPE_DIRECT_TAGS = new Set(["File", "Path", "Glob", "None"]);

const ANCHOR_FAMILIES: readonly {
  family: SemanticAnchorFamily;
  prefix: string;
  pattern: RegExp;
}[] = [
  { family: "verification", prefix: "V-M-", pattern: ANCHOR_PATTERNS.verification },
  { family: "graph-document", prefix: "GD-", pattern: ANCHOR_PATTERNS.graphDocument },
  { family: "verification-document", prefix: "VD-", pattern: ANCHOR_PATTERNS.verificationDocument },
  { family: "data-flow", prefix: "DF-", pattern: ANCHOR_PATTERNS.dataFlow },
  { family: "change", prefix: "C-", pattern: ANCHOR_PATTERNS.change },
  { family: "module", prefix: "M-", pattern: ANCHOR_PATTERNS.module },
  { family: "task", prefix: "T-", pattern: ANCHOR_PATTERNS.task },
];

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

/** Classifies exact canonical anchors and malformed anchor-like tags. */
export function classifySemanticAnchorTag(tag: string): SemanticAnchorClassification {
  for (const { family, prefix, pattern } of ANCHOR_FAMILIES) {
    if (pattern.test(tag)) {
      return { kind: "canonical", family };
    }
    if (tag.startsWith(prefix)) {
      return { kind: "malformed", family };
    }
  }
  return { kind: "ordinary" };
}

/** Validates that semantic anchors are canonical attribute-free tags and never attributes. */
export function validateSemanticAnchorDiscipline(file: string, root: GraceXmlNode): Grace4Issue[] {
  const issues: Grace4Issue[] = [];

  for (const node of walkNodes(root)) {
    const tagClassification = classifySemanticAnchorTag(node.tag);
    if (tagClassification.kind === "malformed") {
      issues.push(
        issue(
          "error",
          "artifact.malformed-semantic-anchor",
          file,
          `<${node.tag}> resembles a ${tagClassification.family} semantic anchor but is not canonical.`,
        ),
      );
    }
    if (tagClassification.kind === "canonical" && Object.keys(node.attributes).length > 0) {
      issues.push(
        issue(
          "error",
          "artifact.semantic-anchor-has-attributes",
          file,
          `Semantic anchor <${node.tag}> must not declare attributes.`,
        ),
      );
    }

    for (const [attribute, value] of Object.entries(node.attributes)) {
      const attributeClassification = classifySemanticAnchorTag(attribute);
      const anchor = attributeClassification.kind === "ordinary" ? findSemanticAnchorInAttribute(value) : attribute;
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

/** Validates canonical change directories before artifact enumeration. */
export function validateGrace4ProjectLayout(paths: Grace4ProjectPaths): Grace4Issue[] {
  const issues: Grace4Issue[] = [];
  for (const directory of [paths.changesActiveDir, paths.changesArchiveDir]) {
    if (!existsSync(directory) || !statSync(directory).isDirectory()) {
      issues.push(
        issue(
          "error",
          "project.missing-change-directory",
          directory,
          `Required GRACE 4 change directory is missing: ${directory}`,
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

  if (wrappers.length === 1) {
    const wrapper = wrappers[0]!;
    if (root.tag === "GraceChangeSpec") {
      validateDirectSectionCardinality(
        artifact.file,
        wrapper,
        SPEC_REQUIRED_SECTIONS,
        "change.spec-missing-section",
        "change.spec-duplicate-section",
        result.issues,
      );
      validateMeaningfulRequiredSections(artifact.file, wrapper, SPEC_REQUIRED_SECTIONS, result.issues);
    } else {
      validateDirectSectionCardinality(
        artifact.file,
        wrapper,
        PLAN_REQUIRED_SECTIONS,
        "change.plan-missing-section",
        "change.plan-duplicate-section",
        result.issues,
      );
      validateMeaningfulRequiredSections(artifact.file, wrapper, PLAN_REQUIRED_SECTIONS, result.issues);
      validateStructuredPlanSections(artifact.file, wrapper, result.issues);
      validateImplementationTasks(artifact.file, wrapper, result.issues);
    }
  }

  if (status === "superseded" && wrappers.length === 1) {
    const wrapper = wrappers[0];
    const replacements = replacementChangeIds(wrapper);
    if (replacements.length === 0) {
      result.issues.push(
        issue(
          "error",
          "change.superseded-missing-replacement",
          artifact.file,
          "Superseded change must reference a replacement C-* as a child tag or via <Replacement>/<ReplacementChange> text.",
        ),
      );
    }
    if (replacements.includes(wrapper.tag)) {
      result.issues.push(
        issue("error", "change.superseded-self-replacement", artifact.file, `Superseded change ${wrapper.tag} must reference a different replacement C-* bundle.`),
      );
    }
  }

  return result;
}

/** Validates a GraceChangeDesignContext artifact found inside a change bundle. */
export function validateChangeDesignContextArtifact(
  artifact: ParsedGraceXmlArtifact,
): ArtifactValidationResult {
  const root = artifact.root;
  const issues: Grace4Issue[] = [...artifact.issues];

  if (!root) {
    return { file: artifact.file, issues };
  }

  if (!COMPANION_ROOT_TAGS.has(root.tag)) {
    issues.push(issue("error", "design-context.invalid-root-tag", artifact.file, `Unsupported design context root tag '${root.tag}'. Expected GraceChangeDesignContext.`));
    return { file: artifact.file, rootTag: root.tag, issues };
  }

  if (!root.attributes.graceVersion) {
    issues.push(
      issue("error", "design-context.missing-grace-version", artifact.file, `GraceChangeDesignContext must declare graceVersion="${GRACE4_VERSION}".`),
    );
  } else if (root.attributes.graceVersion !== GRACE4_VERSION) {
    issues.push(
      issue("error", "design-context.unsupported-grace-version", artifact.file, `GraceChangeDesignContext declares unsupported graceVersion '${root.attributes.graceVersion}'. Expected '${GRACE4_VERSION}'.`),
    );
  }

  if (root.attributes.status) {
    issues.push(issue("error", "design-context.forbidden-status", artifact.file, "GraceChangeDesignContext must not declare a status attribute."));
  }

  for (const attribute of Object.keys(root.attributes)) {
    if (attribute !== "graceVersion" && attribute !== "status") {
      issues.push(issue("error", "design-context.forbidden-root-attribute", artifact.file, `${attribute} is not an allowed root attribute on GraceChangeDesignContext.`));
    }
  }

  issues.push(...validateSemanticAnchorDiscipline(artifact.file, root));

  return { file: artifact.file, rootTag: root.tag, graceVersion: root.attributes.graceVersion, issues };
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
  issues.push(...validateGrace4ProjectLayout(paths));
  artifacts.push(...validateContextArtifacts(paths));
  artifacts.push(...validateRequiredArtifact(paths.graphIndex, "GraceGraphIndex"));
  artifacts.push(...validateXmlFilesInDirectory(paths.graphDir, [paths.graphIndex], "GraceGraphDocument"));
  artifacts.push(...validateRequiredArtifact(paths.verificationIndex, "GraceVerificationIndex"));
  artifacts.push(...validateXmlFilesInDirectory(paths.verificationDir, [paths.verificationIndex], "GraceVerificationDocument"));
  const knownChangeIds = collectChangeBundleIds(paths);
  artifacts.push(...validateChangeBundlesInDirectory(paths.changesActiveDir, "active", knownChangeIds));
  artifacts.push(...validateChangeBundlesInDirectory(paths.changesArchiveDir, "archive", knownChangeIds));

  return {
    root: projectRoot,
    artifacts,
    issues: [...issues, ...artifacts.flatMap((artifact) => artifact.issues)],
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

  if (artifact.root?.tag === "GraceGraphIndex" && artifact.root.children.filter((child) => child.tag === "GraphDocuments").length !== 1) {
    result.issues.push(issue("error", "graph.index-invalid-documents-section", file, "GraceGraphIndex must contain exactly one direct GraphDocuments section."));
  }
  if (artifact.root?.tag === "GraceVerificationIndex" && artifact.root.children.filter((child) => child.tag === "VerificationDocuments").length !== 1) {
    result.issues.push(issue("error", "verification.index-invalid-documents-section", file, "GraceVerificationIndex must contain exactly one direct VerificationDocuments section."));
  }

  return [result];
}

function validateXmlFilesInDirectory(directory: string, excludedFiles: string[], expectedRootTag: "GraceGraphDocument" | "GraceVerificationDocument"): ArtifactValidationResult[] {
  if (!existsSync(directory)) {
    return [];
  }

  const excluded = new Set(excludedFiles.map((file) => path.resolve(file)));
  return listXmlFiles(directory)
    .filter((file) => !excluded.has(path.resolve(file)))
    .map((file) => {
      const artifact = readGraceXmlArtifact(file);
      const result = validateParsedArtifact(artifact);
      if (artifact.root && artifact.root.tag !== expectedRootTag) {
        result.issues.push(issue("error", "artifact.unexpected-root-tag", file, `${path.basename(file)} must use root tag ${expectedRootTag}.`));
        return result;
      }

      if (artifact.root) {
        const wrapperPattern = expectedRootTag === "GraceGraphDocument" ? ANCHOR_PATTERNS.graphDocument : ANCHOR_PATTERNS.verificationDocument;
        const wrappers = artifact.root.children.filter((child) => wrapperPattern.test(child.tag));
        if (wrappers.length !== 1) {
          result.issues.push(issue(
            "error",
            expectedRootTag === "GraceGraphDocument" ? "graph.invalid-document-wrapper" : "verification.invalid-document-wrapper",
            file,
            `${expectedRootTag} must contain exactly one direct ${expectedRootTag === "GraceGraphDocument" ? "GD-*" : "VD-*"} wrapper.`,
          ));
        }
      }
      return result;
    });
}

function validateChangeBundlesInDirectory(
  directory: string,
  location: "active" | "archive",
  knownChangeIds: ReadonlySet<string>,
): ArtifactValidationResult[] {
  if (!existsSync(directory)) {
    return [];
  }

  const results: ArtifactValidationResult[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (!entry.isDirectory()) {
      if (entry.isFile() && entry.name.endsWith(".xml")) {
        results.push({ file: entryPath, issues: [issue("error", "change.unexpected-file", entryPath, "Change XML artifacts must live inside a direct C-* bundle directory.")] });
      }
      continue;
    }

    const bundleId = entry.name;
    const bundleIssues: Grace4Issue[] = [];
    if (!ANCHOR_PATTERNS.change.test(bundleId)) {
      bundleIssues.push(issue("error", "change.invalid-bundle-id", entryPath, `Change bundle directory '${bundleId}' must use a C-* identifier.`));
    }

    const specFile = path.join(entryPath, "spec.xml");
    const planFile = path.join(entryPath, "plan.xml");
    const designFile = path.join(entryPath, "design-context.xml");
    const specArtifact = readGraceXmlArtifact(specFile);
    const specResult = validateChangeArtifact(specArtifact, location);
    validateReplacementTargetExists(specArtifact, knownChangeIds, specResult.issues);
    const specWrapper = directChangeWrapper(specArtifact.root);
    if (specWrapper && specWrapper.tag !== bundleId) {
      specResult.issues.push(issue("error", "change.bundle-id-mismatch", specFile, `spec.xml uses ${specWrapper.tag}, but its bundle directory is ${bundleId}.`));
    }
    results.push(specResult);

    let planArtifact: ParsedGraceXmlArtifact | null = null;
    if (existsSync(planFile)) {
      planArtifact = readGraceXmlArtifact(planFile);
      const planResult = validateChangeArtifact(planArtifact, location);
      validateReplacementTargetExists(planArtifact, knownChangeIds, planResult.issues);
      const planWrapper = directChangeWrapper(planArtifact.root);
      if (planWrapper && planWrapper.tag !== bundleId) {
        planResult.issues.push(issue("error", "change.bundle-id-mismatch", planFile, `plan.xml uses ${planWrapper.tag}, but its bundle directory is ${bundleId}.`));
      }
      if (specWrapper && planWrapper && specWrapper.tag !== planWrapper.tag) {
        planResult.issues.push(issue("error", "change.spec-plan-id-mismatch", planFile, `spec.xml uses ${specWrapper.tag}, but plan.xml uses ${planWrapper.tag}.`));
      }
      results.push(planResult);
    }

    const specStatus = specArtifact.root?.attributes.status;
    const planStatus = planArtifact?.root?.attributes.status;
    if (location === "active" && planArtifact && specStatus !== "approved") {
      bundleIssues.push(issue("error", "change.plan-requires-approved-spec", entryPath, "An active plan may exist only beside an approved spec."));
    }
    if (location === "archive" && planArtifact && specStatus && planStatus && specStatus !== planStatus) {
      bundleIssues.push(issue("error", "change.archive-status-mismatch", entryPath, `Archived spec status '${specStatus}' must match plan status '${planStatus}'.`));
    }
    if (location === "archive" && specStatus === "applied" && (!planArtifact || planStatus !== "applied")) {
      bundleIssues.push(issue("error", "change.applied-plan-missing", entryPath, "An applied archived bundle requires an applied plan.xml."));
    }

    if (existsSync(designFile)) {
      const designArtifact = readGraceXmlArtifact(designFile);
      const designResult = validateChangeDesignContextArtifact(designArtifact);
      const designChange = designArtifact.root ? childText(designArtifact.root, "Change")?.trim() : undefined;
      if (designChange && designChange !== bundleId) {
        designResult.issues.push(issue("error", "design-context.bundle-id-mismatch", designFile, `design-context.xml references ${designChange}, but its bundle directory is ${bundleId}.`));
      }
      results.push(designResult);
    }

    for (const fileEntry of readdirSync(entryPath, { withFileTypes: true })) {
      if (fileEntry.isFile() && fileEntry.name.endsWith(".xml") && !["spec.xml", "plan.xml", "design-context.xml"].includes(fileEntry.name)) {
        const file = path.join(entryPath, fileEntry.name);
        bundleIssues.push(issue("error", "change.unexpected-file", file, `Unsupported XML artifact '${fileEntry.name}' in change bundle ${bundleId}.`));
      }
    }

    if (bundleIssues.length > 0) {
      results.push({ file: entryPath, issues: bundleIssues });
    }
  }
  return results;
}

function directChangeWrapper(root: GraceXmlNode | null): GraceXmlNode | undefined {
  return root?.children.find((child) => ANCHOR_PATTERNS.change.test(child.tag));
}

function collectChangeBundleIds(paths: Grace4ProjectPaths): Set<string> {
  const ids = new Set<string>();
  for (const directory of [paths.changesActiveDir, paths.changesArchiveDir]) {
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ANCHOR_PATTERNS.change.test(entry.name)) ids.add(entry.name);
    }
  }
  return ids;
}

function replacementChangeIds(wrapper: GraceXmlNode): string[] {
  return [...new Set(wrapper.children.flatMap((child) => {
    if (ANCHOR_PATTERNS.change.test(child.tag)) return [child.tag];
    if ((child.tag === "Replacement" || child.tag === "ReplacementChange") && ANCHOR_PATTERNS.change.test(child.text.trim())) {
      return [child.text.trim()];
    }
    return [];
  }))];
}

function validateReplacementTargetExists(
  artifact: ParsedGraceXmlArtifact,
  knownChangeIds: ReadonlySet<string>,
  issues: Grace4Issue[],
): void {
  if (artifact.root?.attributes.status !== "superseded") return;
  const wrapper = directChangeWrapper(artifact.root);
  if (!wrapper) return;
  for (const replacement of replacementChangeIds(wrapper)) {
    if (replacement !== wrapper.tag && !knownChangeIds.has(replacement)) {
      issues.push(issue("error", "change.superseded-replacement-not-found", artifact.file, `Superseded change ${wrapper.tag} references missing replacement bundle ${replacement}.`));
    }
  }
}

function validateDirectSectionCardinality(
  file: string,
  parent: GraceXmlNode,
  sections: readonly string[],
  missingCode: string,
  duplicateCode: string,
  issues: Grace4Issue[],
): void {
  for (const section of sections) {
    const matches = parent.children.filter((child) => child.tag === section);
    if (matches.length === 0) {
      issues.push(issue("error", missingCode, file, `${parent.tag} is missing required direct section <${section}>.`));
    } else if (matches.length > 1) {
      issues.push(issue("error", duplicateCode, file, `${parent.tag} contains duplicate direct <${section}> sections.`));
    }
  }
}

function validateImplementationTasks(file: string, wrapper: GraceXmlNode, issues: Grace4Issue[]): void {
  const implementationPlan = wrapper.children.find((child) => child.tag === "ImplementationPlan");
  if (!implementationPlan) {
    return;
  }

  const tasks = implementationPlan.children.filter((child) => ANCHOR_PATTERNS.task.test(child.tag));
  if (tasks.length === 0) {
    issues.push(issue("error", "change.plan-missing-task", file, "ImplementationPlan must contain at least one direct T-* task."));
    return;
  }

  validateTaskDependencyGraph(file, tasks, issues);
}

function validateMeaningfulRequiredSections(
  file: string,
  parent: GraceXmlNode,
  sections: readonly string[],
  issues: Grace4Issue[],
): void {
  for (const section of sections) {
    for (const node of parent.children.filter((child) => child.tag === section)) {
      validateMeaningfulSection(file, node, issues);
    }
  }
}

function validateStructuredPlanSections(file: string, wrapper: GraceXmlNode, issues: Grace4Issue[]): void {
  for (const sectionName of ["BaselineAssertions", "TargetAssertions"] as const) {
    for (const section of wrapper.children.filter((child) => child.tag === sectionName)) {
      if (section.text.trim() || Object.keys(section.attributes).length > 0) {
        issues.push(issue("error", "change.plan-invalid-section-shape", file, `<${sectionName}> must contain only approved assertion elements.`));
      }
      const approvedChildren = section.children.filter((child) => ASSERTION_SECTION_TAGS.has(child.tag));
      for (const child of section.children) {
        if (!ASSERTION_SECTION_TAGS.has(child.tag)) {
          issues.push(issue("error", "change.plan-invalid-section-shape", file, `<${sectionName}> does not allow child <${child.tag}>.`));
        }
      }
      if (approvedChildren.length === 0) {
        issues.push(issue("error", "change.plan-invalid-section-shape", file, `<${sectionName}> must contain at least one approved assertion element.`));
      }
    }
  }

  for (const section of wrapper.children.filter((child) => child.tag === "DurableScope")) {
    if (section.text.trim() || Object.keys(section.attributes).length > 0) {
      issues.push(issue("error", "change.plan-invalid-section-shape", file, "<DurableScope> must contain only supported durable scope elements."));
    }
    const supported = section.children.filter((child) => isSupportedDurableScopeChild(child.tag));
    for (const child of section.children) {
      if (!isSupportedDurableScopeChild(child.tag)) {
        issues.push(issue("error", "change.plan-invalid-section-shape", file, `<DurableScope> does not allow child <${child.tag}>.`));
      }
    }
    if (supported.length === 0) {
      issues.push(issue("error", "change.plan-invalid-section-shape", file, "<DurableScope> must declare supported scope entries or <None />."));
    }
  }

  for (const section of wrapper.children.filter((child) => child.tag === "ObservedWriteScope")) {
    if (section.text.trim() || Object.keys(section.attributes).length > 0) {
      issues.push(issue("error", "change.plan-invalid-section-shape", file, "<ObservedWriteScope> must contain only File, Path, Glob, or None elements."));
    }
    const supported = section.children.filter((child) => OBSERVED_SCOPE_DIRECT_TAGS.has(child.tag));
    for (const child of section.children) {
      if (!OBSERVED_SCOPE_DIRECT_TAGS.has(child.tag)) {
        issues.push(issue("error", "change.plan-invalid-section-shape", file, `<ObservedWriteScope> does not allow child <${child.tag}>.`));
      }
    }
    if (supported.length === 0) {
      issues.push(issue("error", "change.plan-invalid-section-shape", file, "<ObservedWriteScope> must declare File/Path/Glob entries or <None />."));
    }
  }
}

function isSupportedDurableScopeChild(tag: string): boolean {
  return DURABLE_SCOPE_DIRECT_TAGS.has(tag)
    || ANCHOR_PATTERNS.module.test(tag)
    || ANCHOR_PATTERNS.dataFlow.test(tag)
    || ANCHOR_PATTERNS.verification.test(tag)
    || ANCHOR_PATTERNS.graphDocument.test(tag)
    || ANCHOR_PATTERNS.verificationDocument.test(tag);
}

function validateMeaningfulSection(file: string, section: GraceXmlNode, issues: Grace4Issue[]): void {
  const meaningful = [...walkNodes(section)].some((node) => {
    if ((section.tag === "DurableScope" || section.tag === "ObservedWriteScope") && node !== section && node.tag === "None") {
      return true;
    }
    if (node !== section && classifySemanticAnchorTag(node.tag).kind === "canonical") {
      return true;
    }
    return node.text.trim().length > 0;
  });
  if (!meaningful) {
    issues.push(issue("error", "change.empty-section", file, `<${section.tag}> must contain meaningful content.`));
  }
}

function validatePlanTask(file: string, task: GraceXmlNode, issues: Grace4Issue[]): string[] {
  validateDirectSectionCardinality(
    file,
    task,
    TASK_REQUIRED_SECTIONS,
    "change.task-missing-section",
    "change.task-duplicate-section",
    issues,
  );

  const title = task.children.find((child) => child.tag === "Title");
  if (title && !title.text.trim()) {
    issues.push(issue("error", "change.task-empty-title", file, `${task.tag} must contain a non-empty Title.`));
  }

  const acceptance = task.children.find((child) => child.tag === "AcceptanceCriteria");
  if (acceptance) {
    const criteria = acceptance.children.filter((child) => child.tag === "Criterion" && child.text.trim());
    if (criteria.length === 0) {
      issues.push(issue("error", "change.task-empty-acceptance", file, `${task.tag} must contain at least one non-empty acceptance Criterion.`));
    }
  }

  const verification = task.children.find((child) => child.tag === "Verification");
  if (verification) {
    const commands = verification.children.filter((child) => child.tag === "Command" && child.text.trim());
    if (commands.length === 0) {
      issues.push(issue("error", "change.task-empty-verification", file, `${task.tag} must contain at least one non-empty verification Command.`));
    }
  }

  const dependsOn = task.children.find((child) => child.tag === "DependsOn");
  if (!dependsOn) {
    return [];
  }

  const dependencyValues = [
    ...(dependsOn.text.trim() ? [dependsOn.text.trim()] : []),
    ...dependsOn.children.map((child) => child.text.trim()).filter(Boolean),
  ];
  const dependencies: string[] = [];
  const seen = new Set<string>();
  for (const dependency of dependencyValues) {
    if (!ANCHOR_PATTERNS.task.test(dependency)) {
      issues.push(issue("error", "change.task-invalid-dependency", file, `${task.tag} dependency '${dependency}' must be a canonical T-NNN identifier.`));
      continue;
    }
    if (seen.has(dependency)) {
      issues.push(issue("error", "change.task-duplicate-dependency", file, `${task.tag} repeats dependency ${dependency}.`));
      continue;
    }
    seen.add(dependency);
    dependencies.push(dependency);
  }
  return dependencies;
}

function validateTaskDependencyGraph(file: string, tasks: GraceXmlNode[], issues: Grace4Issue[]): void {
  const taskIds = new Set<string>();
  const dependencies = new Map<string, string[]>();

  for (const task of tasks) {
    if (taskIds.has(task.tag)) {
      issues.push(issue("error", "change.duplicate-task-id", file, `ImplementationPlan contains duplicate task id ${task.tag}.`));
    } else {
      taskIds.add(task.tag);
    }
    if (!dependencies.has(task.tag)) {
      dependencies.set(task.tag, validatePlanTask(file, task, issues));
    } else {
      validatePlanTask(file, task, issues);
    }
  }

  for (const [taskId, taskDependencies] of dependencies) {
    for (const dependency of taskDependencies) {
      if (dependency === taskId) {
        issues.push(issue("error", "change.task-self-dependency", file, `${taskId} cannot depend on itself.`));
      } else if (!taskIds.has(dependency)) {
        issues.push(issue("error", "change.task-unknown-dependency", file, `${taskId} depends on unknown task ${dependency}.`));
      }
    }
  }

  const state = new Map<string, "visiting" | "visited">();
  const cyclicTasks = new Set<string>();
  const visit = (taskId: string, stack: string[]): void => {
    if (state.get(taskId) === "visited") {
      return;
    }
    if (state.get(taskId) === "visiting") {
      for (const cyclicTask of stack.slice(stack.indexOf(taskId))) {
        cyclicTasks.add(cyclicTask);
      }
      return;
    }
    state.set(taskId, "visiting");
    for (const dependency of dependencies.get(taskId) ?? []) {
      if (taskIds.has(dependency) && dependency !== taskId) {
        visit(dependency, [...stack, dependency]);
      }
    }
    state.set(taskId, "visited");
  };

  for (const taskId of taskIds) {
    visit(taskId, [taskId]);
  }
  if (cyclicTasks.size > 0) {
    issues.push(issue("error", "change.task-dependency-cycle", file, `ImplementationPlan contains a dependency cycle involving ${[...cyclicTasks].sort().join(", ")}.`));
  }
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
  if (reason.length === 0) {
    return [issue("error", "context.not-applicable-reason-missing", file, `${root.tag} marked not-applicable requires a reason.`)];
  }

  if (
    root.tag === "GraceUXGuidelines"
    && /^(?:this project is\s+)?(?:not a web app|not web|no web ui|no ui|no frontend)[.!]?$/i.test(reason)
  ) {
    return [issue("error", "context.ux-not-applicable-reason-insufficient", file, "UX applies to CLI, API, documentation, operator, and agent interactions; lack of a web UI alone is not a sufficient reason.")];
  }

  return [];
}

function findSemanticAnchorInAttribute(value: string): string | null {
  const candidates = value.split(/[^A-Za-z0-9-]+/).filter(Boolean);
  for (const candidate of candidates) {
    if (classifySemanticAnchorTag(candidate).kind !== "ordinary") {
      return candidate;
    }
  }
  return null;
}

function issue(severity: Grace4Issue["severity"], code: string, file: string, message: string): Grace4Issue {
  return { severity, code, file, message };
}

export { GRACE4_CONTEXT_ARTIFACTS };
