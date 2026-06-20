import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { evaluateAssertion, extractAssertionsWithIssues } from "../grace4/assertions";
import { validateGrace4Project } from "../grace4/grammar";
import { detectGraceProjectKind, formatGrace3MigrationGuidance, resolveGrace4Paths } from "../grace4/project";
import { buildGraphProjection, buildVerificationProjection } from "../grace4/projections";
import { collectActiveChangeScopes, detectScopeOverlaps, detectUnsafeConcurrentExecution } from "../grace4/scope";
import type { Grace4Issue } from "../grace4/types";
import { collectCodeFiles, hasGraceMarkers } from "../project-utils";
import { withLintIssueGuide } from "./catalog";
import { loadGraceLintConfig } from "./config";
import type { LintIssue, LintOptions, LintProfile, LintResult } from "./types";

const TEXT_FORMAT_OPTIONS = new Set(["text", "json"]);

function createResult(root: string, profile: LintProfile): LintResult {
  return {
    schemaVersion: "1.0.0",
    tool: "grace-lint",
    generatedAt: new Date().toISOString(),
    root,
    profile,
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

function countGovernedFiles(root: string) {
  const { config, issues } = loadGraceLintConfig(root);
  if (issues.some((issue) => issue.severity === "error")) {
    return { filesChecked: 0, governedFiles: 0, configIssues: issues };
  }

  const files = collectCodeFiles(root, [".grace", ...(config?.ignoredDirs ?? [])]);
  return {
    filesChecked: files.length,
    governedFiles: files.filter((file) => hasGraceMarkers(readText(file))).length,
    configIssues: issues,
  };
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

function validateAssertions(result: LintResult, planFilesActive: string[], planFilesArchived: string[], graph: GraphProjection, verification: VerificationProjection, root: string) {
  const context = { root, graph, verification };

  // Active plans: evaluate both BaselineAssertions and TargetAssertions
  for (const planFile of planFilesActive) {
    evaluateSection(result, planFile, "BaselineAssertions", context);
    evaluateSection(result, planFile, "TargetAssertions", context);
  }

  // Archived plans: evaluate only TargetAssertions (BaselineAssertions are execution preconditions that may legitimately fail after application)
  for (const planFile of planFilesArchived) {
    evaluateSection(result, planFile, "TargetAssertions", context);
  }
}

function evaluateSection(result: LintResult, planFile: string, section: "BaselineAssertions" | "TargetAssertions", context: { root: string; graph: GraphProjection; verification: VerificationProjection }) {
  const extraction = extractAssertionsWithIssues(planFile, section);
  for (const issue of extraction.issues) {
    addGrace4Issue(result, issue);
  }
  for (const assertion of extraction.assertions) {
    for (const issue of evaluateAssertion(assertion, context)) {
      addGrace4Issue(result, issue);
    }
  }
}
/** Lints the current GRACE 4 .grace document state and file-local semantic markup. */
export function lintGraceProject(projectRoot: string, options: LintOptions = {}): LintResult {
  const root = path.resolve(projectRoot);
  const profile = options.profile ?? "standard";
  const result = createResult(root, profile);
  const kind = detectGraceProjectKind(root);

  const fileCounts = countGovernedFiles(root);
  result.filesChecked = fileCounts.filesChecked;
  result.governedFiles = fileCounts.governedFiles;
  for (const configIssue of fileCounts.configIssues) {
    addIssue(result, configIssue);
  }

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
  for (const issue of [...detectScopeOverlaps(activeScopes), ...detectUnsafeConcurrentExecution(activeScopes)]) {
    addGrace4Issue(result, issue);
  }

  const planFilesActive = [...listPlanFiles(paths.changesActiveDir)];
  const planFilesArchived = [...listPlanFiles(paths.changesArchiveDir)];
  validateAssertions(result, planFilesActive, planFilesArchived, graph, verification, root);

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
