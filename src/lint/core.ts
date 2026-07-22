import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { evaluateAssertion, extractAssertionsWithIssues } from "../grace4/assertions";
import { validateGrace4Project } from "../grace4/grammar";
import { detectGraceProjectKind, formatGrace3MigrationGuidance, resolveGrace4Paths } from "../grace4/project";
import { buildGraphProjection, buildVerificationProjection, type GraphProjection, type VerificationProjection } from "../grace4/projections";
import { collectActiveChangeScopes, createDurableOwnershipIndex, detectScopeOverlaps, detectUnsafeConcurrentExecution } from "../grace4/scope";
import { ANCHOR_PATTERNS, type Grace4Issue, type Grace4ProjectPaths } from "../grace4/types";
import { readGraceXmlArtifact } from "../grace4/xml";
import { analyzeGovernedFile, collectCodeFiles, hasGraceMarkers } from "../project-utils";
import { withLintIssueGuide } from "./catalog";
import { loadGraceLintConfig } from "./config";
import type { LintIssue, LintOptions, LintProfile, LintResult } from "./types";

const TEXT_FORMAT_OPTIONS = new Set(["text", "json"]);

function createResult(root: string, profile: LintProfile, options: LintOptions): LintResult {
  return {
    schemaVersion: "1.0.0",
    tool: "grace-lint",
    generatedAt: new Date().toISOString(),
    root,
    profile,
    assertionMode: options.assertionMode ?? "current",
    changeId: options.changeId,
    commandsEnabled: options.runCommands ?? false,
    filesChecked: 0,
    governedFiles: 0,
    xmlFilesChecked: 0,
    issues: [],
    summary: { issues: 0, errors: 0, warnings: 0 },
  };
}

function addIssue(result: LintResult, issue: LintIssue) {
  result.issues.push(issue);
}

function addGrace4Issue(result: LintResult, issue: Grace4Issue) {
  addIssue(result, {
    severity: issue.severity,
    code: issue.code,
    file: issue.file,
    line: issue.line,
    message: issue.message,
  });
}

function finalizeResult(result: LintResult): LintResult {
  result.issues.sort((left, right) => left.file.localeCompare(right.file) || (left.line ?? 0) - (right.line ?? 0) || left.code.localeCompare(right.code));
  result.summary = {
    issues: result.issues.length,
    errors: result.issues.filter((issue) => issue.severity === "error").length,
    warnings: result.issues.filter((issue) => issue.severity === "warning").length,
  };
  result.issues = result.issues.map(withLintIssueGuide);
  return result;
}

function validateGovernedFiles(result: LintResult, root: string): void {
  const { config, issues } = loadGraceLintConfig(root);
  for (const configIssue of issues) {
    addIssue(result, configIssue);
  }
  if (issues.some((issue) => issue.severity === "error")) {
    return;
  }

  const files = collectCodeFiles(root, [".grace", ...(config?.ignoredDirs ?? [])]);
  result.filesChecked = files.length;
  for (const file of files) {
    const text = readText(file);
    if (!hasGraceMarkers(text)) {
      continue;
    }
    result.governedFiles += 1;
    for (const issue of analyzeGovernedFile(root, file, text).issues) {
      addIssue(result, issue);
    }
  }
}

function readText(file: string) {
  return readFileSync(file, "utf8");
}

function listPlanFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listPlanFiles(entryPath);
    }
    return entry.isFile() && entry.name === "plan.xml" ? [entryPath] : [];
  });
}

function readPlanStatus(planFile: string): string | null {
  const artifact = readGraceXmlArtifact(planFile);
  return artifact.root?.tag === "GraceChangePlan" ? artifact.root.attributes.status ?? null : null;
}

function validateAssertions(
  result: LintResult,
  paths: Grace4ProjectPaths,
  planFilesActive: string[],
  planFilesArchived: string[],
  graph: GraphProjection,
  verification: VerificationProjection,
  root: string,
  options: LintOptions,
) {
  const context = { root, graph, verification, runCommands: options.runCommands };
  const assertionMode = options.assertionMode ?? "current";
  const selectedPlan = assertionMode === "current" ? null : resolveSelectedApprovedPlan(result, paths, options.changeId);

  for (const planFile of planFilesActive) {
    const status = readPlanStatus(planFile);
    const isSelected = selectedPlan !== null && path.resolve(selectedPlan) === path.resolve(planFile);
    const evaluateCurrentBaseline = assertionMode === "current" && status === "approved";
    const evaluateUnrelatedFinalBaseline = assertionMode === "final" && status === "approved" && !isSelected;
    evaluateSection(result, planFile, "BaselineAssertions", context, evaluateCurrentBaseline || evaluateUnrelatedFinalBaseline, true, true);
    evaluateSection(result, planFile, "TargetAssertions", context, false);
  }

  for (const planFile of planFilesArchived) {
    // Archived plans: syntax only, never semantic (baseline may be stale, target may be superseded by later changes)
    evaluateSection(result, planFile, "BaselineAssertions", context, false);
    evaluateSection(result, planFile, "TargetAssertions", context, false);
  }

  if (assertionMode === "current") {
    return;
  }

  if (!selectedPlan) {
    return;
  }
  evaluateSection(
    result,
    selectedPlan,
    assertionMode === "baseline" ? "BaselineAssertions" : "TargetAssertions",
    context,
    true,
    false,
  );
}

function evaluateSection(
  result: LintResult,
  planFile: string,
  section: "BaselineAssertions" | "TargetAssertions",
  context: { root: string; graph: GraphProjection; verification: VerificationProjection; runCommands?: boolean },
  evaluateSemantically: boolean,
  includeExtractionIssues = true,
  skipUnevaluatedCommands = false,
) {
  const extraction = extractAssertionsWithIssues(planFile, section);
  if (includeExtractionIssues) {
    for (const issue of extraction.issues) {
      addGrace4Issue(result, issue);
    }
  }
  if (evaluateSemantically) {
    for (const assertion of extraction.assertions) {
      if (skipUnevaluatedCommands && assertion.kind === "MustPassCommand" && !context.runCommands) {
        continue;
      }
      for (const issue of evaluateAssertion(assertion, context)) {
        addGrace4Issue(result, issue);
      }
    }
  }
}

function resolveSelectedApprovedPlan(
  result: LintResult,
  paths: Grace4ProjectPaths,
  changeId: string | undefined,
): string | null {
  if (!changeId) {
    addIssue(result, {
      severity: "error",
      code: "assertion.change-required",
      file: paths.changesActiveDir,
      message: "Selected baseline or target assertion evaluation requires one --change C-* identifier.",
    });
    return null;
  }
  if (!ANCHOR_PATTERNS.change.test(changeId)) {
    addIssue(result, {
      severity: "error",
      code: "assertion.invalid-change-id",
      file: paths.changesActiveDir,
      message: `Selected change '${changeId}' must be a canonical C-* identifier.`,
    });
    return null;
  }

  const bundleDir = path.join(paths.changesActiveDir, changeId);
  const specFile = path.join(bundleDir, "spec.xml");
  const planFile = path.join(bundleDir, "plan.xml");
  const spec = readGraceXmlArtifact(specFile);
  const plan = readGraceXmlArtifact(planFile);
  const specWrapper = spec.root?.children.filter((child) => ANCHOR_PATTERNS.change.test(child.tag));
  const planWrapper = plan.root?.children.filter((child) => ANCHOR_PATTERNS.change.test(child.tag));
  const approved = spec.root?.tag === "GraceChangeSpec"
    && spec.root.attributes.status === "approved"
    && specWrapper?.length === 1
    && specWrapper[0]?.tag === changeId
    && plan.root?.tag === "GraceChangePlan"
    && plan.root.attributes.status === "approved"
    && planWrapper?.length === 1
    && planWrapper[0]?.tag === changeId;

  if (!approved) {
    addIssue(result, {
      severity: "error",
      code: "assertion.change-not-approved",
      file: bundleDir,
      message: `Selected change ${changeId} must name one active bundle whose spec.xml and plan.xml are both approved and identity-matched.`,
    });
    return null;
  }
  return planFile;
}
/** Lints the current GRACE 4 .grace document state and file-local semantic markup. */
export function lintGraceProject(projectRoot: string, options: LintOptions = {}): LintResult {
  const root = path.resolve(projectRoot);
  const profile = options.profile ?? "standard";
  const result = createResult(root, profile, options);
  const kind = detectGraceProjectKind(root);

  if (kind === "grace3") {
    addIssue(result, {
      severity: "error",
      code: "project.grace3-detected",
      file: root,
      message: formatGrace3MigrationGuidance(root),
    });
    return finalizeResult(result);
  }

  if (kind === "none") {
    addIssue(result, {
      severity: "error",
      code: "project.missing-grace",
      file: root,
      message: "No .grace directory found.",
    });
    return finalizeResult(result);
  }

  validateGovernedFiles(result, root);

  const paths = resolveGrace4Paths(root);
  const validation = validateGrace4Project(root);
  result.xmlFilesChecked = validation.artifacts.length;
  for (const issue of validation.issues) {
    addGrace4Issue(result, issue);
  }

  const graph = buildGraphProjection(paths);
  const verification = buildVerificationProjection(paths, graph);
  for (const issue of [...graph.issues, ...verification.issues]) {
    addGrace4Issue(result, issue);
  }

  const activeScopes = collectActiveChangeScopes(paths);
  const ownership = createDurableOwnershipIndex(graph, verification);
  const scopeIssues = activeScopes.flatMap((scope) => scope.issues);
  const overlapIssues = detectScopeOverlaps(activeScopes, ownership);
  const parallelIssues = options.parallelPreflight ? detectUnsafeConcurrentExecution(activeScopes, ownership) : [];
  for (const issue of [...scopeIssues, ...overlapIssues, ...parallelIssues]) {
    addGrace4Issue(result, issue);
  }

  const planFilesActive = [...listPlanFiles(paths.changesActiveDir)];
  const planFilesArchived = [...listPlanFiles(paths.changesArchiveDir)];
  validateAssertions(result, paths, planFilesActive, planFilesArchived, graph, verification, root, options);

  return finalizeResult(result);
}

export function isValidTextFormat(format: string) {
  return TEXT_FORMAT_OPTIONS.has(format);
}

export function formatTextReport(result: LintResult, options: { remediate?: boolean } = {}) {
  const lines = [
    "GRACE Lint Report",
    "=================",
    `Root: ${result.root}`,
    `Profile: ${result.profile}`,
    `Files checked: ${result.filesChecked}`,
    `Governed files: ${result.governedFiles}`,
    `XML artifacts checked: ${result.xmlFilesChecked}`,
    `Errors: ${result.summary.errors}`,
    `Warnings: ${result.summary.warnings}`,
  ];

  if (result.issues.length === 0) {
    lines.push("", "No issues found.");
    return lines.join("\n");
  }

  lines.push("", "Issues");
  for (const issue of result.issues) {
    const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
    lines.push(`- [${issue.severity}] ${issue.code} ${location} — ${issue.message}`);
    if (options.remediate && issue.remediation) {
      lines.push(...issue.remediation.map((item) => `  • ${item}`));
    }
  }

  return lines.join("\n");
}
