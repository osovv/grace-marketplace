#!/usr/bin/env bun

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { defineCommand, type CommandDef, runMain } from "citty";

import { lintGraceProject } from "./lint/core";
import type { LintIssue } from "./lint/types";
import { detectGraceProjectKind, formatGrace3MigrationGuidance, resolveGrace4Paths } from "./grace4/project";
import { buildGraphProjection, buildVerificationProjection } from "./grace4/projections";
import { collectActiveChangeScopes, detectScopeOverlaps, detectUnsafeConcurrentExecution } from "./grace4/scope";
import { readGraceXmlArtifact } from "./grace4/xml";
import { collectModuleHealth } from "./query/health";
import { loadGraceArtifactIndex } from "./query/core";
import { formatModuleHealthTable } from "./query/render";
import type { ModuleHealthRecord } from "./query/types";

/** Current state of one GRACE 4 change bundle. */
export type ChangeBundleStatus = {
  changeId: string;
  location: "active" | "archive";
  specStatus?: string;
  planStatus?: string;
  derivedStates: string[];
  path: string;
};

/** GRACE 4 status result for text or JSON output. */
export type StatusResult = {
  schemaVersion: string;
  tool: "grace-status";
  generatedAt: string;
  root: string;
  projectKind: "grace4" | "grace3" | "none";
  summary: {
    graceVersion?: string;
    contextArtifacts: number;
    graphModules: number;
    verificationEntries: number;
    activeChanges: number;
    archivedChanges: number;
    integrityErrors: number;
    integrityWarnings: number;
    readyModules: number;
    attentionModules: number;
    blockedModules: number;
  };
  changes: ChangeBundleStatus[];
  derivedStates: string[];
  integrity: {
    errors: number;
    warnings: number;
    topIssues: string[];
  };
  nextAction: string;
  migrationGuidance?: string;
  modules?: ModuleHealthRecord[];
  moduleHealthLoadError?: string;
};

function topIssues(issues: LintIssue[]) {
  return issues.slice(0, 5).map((issue) => `${issue.code}: ${issue.file}${issue.line ? `:${issue.line}` : ""} ${issue.message}`);
}

function listBundleDirs(directory: string) {
  if (!existsSync(directory)) {
    return [] as string[];
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function readRootStatus(file: string) {
  const artifact = readGraceXmlArtifact(file);
  return artifact.root?.attributes.status;
}

function collectChangeBundleStatuses(root: string, location: "active" | "archive", directory: string, lintIssues: LintIssue[]) {
  return listBundleDirs(directory).map((bundlePath) => {
    const changeId = path.basename(bundlePath);
    const specFile = path.join(bundlePath, "spec.xml");
    const planFile = path.join(bundlePath, "plan.xml");
    const specStatus = existsSync(specFile) ? readRootStatus(specFile) : undefined;
    const planStatus = existsSync(planFile) ? readRootStatus(planFile) : undefined;
    const relativeBundlePath = path.relative(root, bundlePath) || ".";
    const derivedStates: string[] = [];

    if (!specStatus) derivedStates.push("missing-spec-status");
    if (!planStatus) derivedStates.push("missing-plan-status");
    if (location === "active" && [specStatus, planStatus].some((status) => status && !["draft", "approved"].includes(status))) {
      derivedStates.push("invalid-active-status");
    }
    if (location === "archive" && [specStatus, planStatus].some((status) => status && !["applied", "rejected", "cancelled", "superseded"].includes(status))) {
      derivedStates.push("invalid-archive-status");
    }
    if (specStatus === "approved" && planStatus === "draft") derivedStates.push("needs-plan-approval");
    if (specStatus === "approved" && planStatus === "approved") derivedStates.push("ready-to-execute");

    const bundleLintIssues = lintIssues.filter((issue) => issue.file.includes(bundlePath) || issue.file.includes(relativeBundlePath));
    if (bundleLintIssues.length > 0) derivedStates.push("integrity-issues");

    return { changeId, location, specStatus, planStatus, derivedStates: [...new Set(derivedStates)], path: relativeBundlePath } satisfies ChangeBundleStatus;
  });
}

function chooseNextAction(result: Omit<StatusResult, "nextAction">) {
  if (result.projectKind === "grace3") return "Use $grace-migrate to migrate legacy GRACE 3 docs to .grace artifacts.";
  if (result.projectKind === "none") return "Run $grace-init to create a GRACE 4 .grace skeleton.";
  if (result.integrity.errors > 0) return "Run grace lint --path <project-root> and fix GRACE 4 integrity errors.";
  if (result.derivedStates.includes("scope-overlap")) return "Review active change scope overlaps; replan or execute sequentially before parallel-safe work.";
  if (result.changes.some((change) => change.derivedStates.includes("ready-to-execute"))) return "Run $grace-execute for approved active changes.";
  if (result.changes.some((change) => change.derivedStates.includes("needs-plan-approval"))) return "Review and approve the draft GraceChangePlan, or replan if stale.";
  if (result.summary.activeChanges === 0) return "Create a change with $grace-spec, then plan it with $grace-plan.";
  return "Project is healthy. Continue with the next approved GRACE 4 workflow step.";
}

function emptyStatus(root: string, projectKind: StatusResult["projectKind"], migrationGuidance?: string): StatusResult {
  const lint = lintGraceProject(root);
  const integrityErrors = lint.issues.filter((issue) => issue.severity === "error");
  const integrityWarnings = lint.issues.filter((issue) => issue.severity === "warning");
  const partial: Omit<StatusResult, "nextAction"> = {
    schemaVersion: "1.0.0",
    tool: "grace-status",
    generatedAt: new Date().toISOString(),
    root,
    projectKind,
    summary: {
      contextArtifacts: 0,
      graphModules: 0,
      verificationEntries: 0,
      activeChanges: 0,
      archivedChanges: 0,
      integrityErrors: integrityErrors.length,
      integrityWarnings: integrityWarnings.length,
      readyModules: 0,
      attentionModules: 0,
      blockedModules: 0,
    },
    changes: [],
    derivedStates: projectKind === "grace3" ? ["migration-candidate"] : ["missing-grace"],
    integrity: { errors: integrityErrors.length, warnings: integrityWarnings.length, topIssues: topIssues([...integrityErrors, ...integrityWarnings]) },
    migrationGuidance,
  };
  return { ...partial, nextAction: chooseNextAction(partial) };
}

/** Collects status without mutating any .grace artifact. */
export function collectProjectStatus(projectRoot: string, options: { includeModules?: boolean } = {}): StatusResult {
  const root = path.resolve(projectRoot);
  const kind = detectGraceProjectKind(root);
  if (kind === "grace3") return emptyStatus(root, "grace3", formatGrace3MigrationGuidance(root));
  if (kind === "none") return emptyStatus(root, "none");

  const paths = resolveGrace4Paths(root);
  const lint = lintGraceProject(root, { profile: "standard" });
  const integrityErrors = lint.issues.filter((issue) => issue.severity === "error");
  const integrityWarnings = lint.issues.filter((issue) => issue.severity === "warning");
  const graph = buildGraphProjection(paths);
  const verification = buildVerificationProjection(paths, graph);
  const activeScopes = collectActiveChangeScopes(paths);
  const overlapIssues = detectScopeOverlaps(activeScopes);
  const unsafeIssues = detectUnsafeConcurrentExecution(activeScopes);
  const changes = [
    ...collectChangeBundleStatuses(root, "active", paths.changesActiveDir, lint.issues),
    ...collectChangeBundleStatuses(root, "archive", paths.changesArchiveDir, lint.issues),
  ];
  const derivedStates = new Set<string>();
  if (overlapIssues.length > 0) derivedStates.add("scope-overlap");
  if (unsafeIssues.length > 0) derivedStates.add("unsafe-parallel-overlap");
  for (const change of changes) {
    for (const state of change.derivedStates) derivedStates.add(state);
  }

  let modules: ModuleHealthRecord[] | undefined;
  let moduleHealthLoadError: string | undefined;
  if (options.includeModules) {
    try {
      modules = collectModuleHealth(loadGraceArtifactIndex(root));
    } catch (error) {
      moduleHealthLoadError = error instanceof Error ? error.message : String(error);
    }
  }

  const contextArtifacts = [
    "requirements.xml",
    "technology.xml",
    "principles.xml",
    "deployment.xml",
    "ux-guidelines.xml",
  ].filter((file) => existsSync(path.join(paths.contextDir, file))).length;

  const partial: Omit<StatusResult, "nextAction"> = {
    schemaVersion: "1.0.0",
    tool: "grace-status",
    generatedAt: new Date().toISOString(),
    root,
    projectKind: "grace4",
    summary: {
      graceVersion: "4.0",
      contextArtifacts,
      graphModules: graph.modules.size,
      verificationEntries: verification.entries.size,
      activeChanges: changes.filter((change) => change.location === "active").length,
      archivedChanges: changes.filter((change) => change.location === "archive").length,
      integrityErrors: integrityErrors.length,
      integrityWarnings: integrityWarnings.length,
      readyModules: modules?.filter((module) => module.state === "ready").length ?? 0,
      attentionModules: modules?.filter((module) => module.state === "attention").length ?? 0,
      blockedModules: modules?.filter((module) => module.state === "blocked").length ?? 0,
    },
    changes,
    derivedStates: [...derivedStates].sort(),
    integrity: { errors: integrityErrors.length, warnings: integrityWarnings.length, topIssues: topIssues([...integrityErrors, ...integrityWarnings]) },
    modules,
    moduleHealthLoadError,
  };
  return { ...partial, nextAction: chooseNextAction(partial) };
}

export function formatStatusText(result: StatusResult) {
  const lines = [
    "GRACE Status",
    "============",
    `Root: ${result.root}`,
    `Project Kind: ${result.projectKind}`,
    "",
    "Summary",
    `- Context artifacts: ${result.summary.contextArtifacts}`,
    `- Graph modules: ${result.summary.graphModules}`,
    `- Verification entries: ${result.summary.verificationEntries}`,
    `- Active changes: ${result.summary.activeChanges}`,
    `- Archived changes: ${result.summary.archivedChanges}`,
    `- Integrity: ${result.summary.integrityErrors} errors, ${result.summary.integrityWarnings} warnings`,
    `- Derived states: ${result.derivedStates.join(", ") || "none"}`,
  ];

  if (result.migrationGuidance) lines.push("", "Migration Guidance", `- ${result.migrationGuidance}`);

  lines.push("", "Changes");
  if (result.changes.length === 0) {
    lines.push("- none");
  } else {
    for (const change of result.changes) {
      lines.push(`- ${change.changeId} [${change.location}] spec=${change.specStatus ?? "missing"} plan=${change.planStatus ?? "missing"} states=${change.derivedStates.join(",") || "none"}`);
    }
  }

  lines.push("", "Integrity Snapshot", `- Errors: ${result.integrity.errors}`, `- Warnings: ${result.integrity.warnings}`);
  for (const issue of result.integrity.topIssues) lines.push(`- ${issue}`);
  if (result.modules && result.modules.length > 0) lines.push("", "Module Health", formatModuleHealthTable(result.modules));
  if (result.moduleHealthLoadError) lines.push("", "Module Health", `- unavailable: ${result.moduleHealthLoadError}`);
  lines.push("", "Suggested Next Action", `- ${result.nextAction}`);
  return lines.join("\n");
}

function resolveFormat(format: unknown, json: unknown) {
  const resolved = Boolean(json) ? "json" : String(format ?? "text");
  if (resolved !== "text" && resolved !== "json") throw new Error(`Unsupported format \`${resolved}\`. Use \`text\` or \`json\`.`);
  return resolved;
}

function resolveWithList(value: unknown) {
  return String(value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function resolveFailOn(value: unknown) {
  const failOn = String(value ?? "never");
  if (failOn !== "never" && failOn !== "errors" && failOn !== "warnings") throw new Error(`Unsupported fail-on policy \`${failOn}\`. Use \`never\`, \`errors\`, or \`warnings\`.`);
  return failOn;
}

function shouldFail(result: StatusResult, failOn: string) {
  const errorCount = result.summary.integrityErrors + result.summary.blockedModules;
  const warningCount = result.summary.integrityWarnings + result.summary.attentionModules;
  if (failOn === "never") return false;
  if (failOn === "warnings") return errorCount + warningCount > 0;
  return errorCount > 0;
}

export const statusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show GRACE 4 durable health, active/archive changes, derived states, and next action.",
  },
  args: {
    path: { type: "string", alias: "p", description: "Project root to inspect", default: "." },
    format: { type: "string", alias: "f", description: "Output format: text or json", default: "text" },
    json: { type: "boolean", description: "Shortcut for --format json", default: false },
    with: { type: "string", description: "Optional extras, currently supports: modules", default: "" },
    failOn: { type: "string", description: "Exit policy: never, errors, or warnings", default: "never" },
  },
  async run(context) {
    const format = resolveFormat(context.args.format, context.args.json);
    const withValues = resolveWithList(context.args.with);
    const failOn = resolveFailOn(context.args.failOn);
    const result = collectProjectStatus(String(context.args.path ?? "."), { includeModules: withValues.includes("modules") });

    if (format === "json") process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(`${formatStatusText(result)}\n`);
    process.exitCode = shouldFail(result, failOn) ? 1 : 0;
  },
});

if (import.meta.main) {
  await runMain(statusCommand as CommandDef);
}
