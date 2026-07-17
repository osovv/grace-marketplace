#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { defineCommand, type CommandDef, runMain } from "citty";

import { lintGraceProject } from "./lint/core";
import type { LintIssue } from "./lint/types";
import { detectGraceProjectKind, formatGrace3MigrationGuidance, resolveGrace4Paths } from "./grace4/project";
import { buildGraphProjection, buildVerificationProjection, type GraphProjection, type VerificationProjection } from "./grace4/projections";
import { collectActiveChangeScopes, createDurableOwnershipIndex, detectScopeOverlaps, detectUnsafeConcurrentExecution, observedWriteScopeContains, type ActiveChangeScope } from "./grace4/scope";
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
  observedDrift: {
    available: boolean;
    changedFiles: string[];
    explainedFiles: string[];
    unexplainedFiles: string[];
  };
  nextAction: string;
  migrationGuidance?: string;
  modules?: ModuleHealthRecord[];
  moduleHealthLoadError?: string;
};

/** Bundle-local facts used to derive mutually safe execution readiness. */
type ChangeBundleFacts = {
  location: "active" | "archive";
  specStatus?: string;
  planStatus?: string;
  integrityErrors: number;
  baselineFailures: number;
};

/** Route ownership needed to explain changed GRACE graph and verification documents exactly. */
type DriftRouteIndex = {
  graphFiles: Map<string, { document: string; anchors: Set<string> }>;
  verificationFiles: Map<string, { document: string; anchors: Set<string> }>;
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
    const bundleLintIssues = lintIssues.filter((issue) => {
      const resolvedIssue = path.resolve(issue.file);
      return resolvedIssue === path.resolve(bundlePath) || resolvedIssue.startsWith(path.resolve(bundlePath) + path.sep);
    });
    const derivedStates = deriveChangeStates({
      location,
      specStatus,
      planStatus,
      integrityErrors: bundleLintIssues.filter((issue) => issue.severity === "error").length,
      baselineFailures: bundleLintIssues.filter((issue) => /^assertion\.(?:Must|command-not-evaluated)/.test(issue.code)).length,
    });

    return { changeId, location, specStatus, planStatus, derivedStates: [...new Set(derivedStates)], path: relativeBundlePath } satisfies ChangeBundleStatus;
  });
}

/** Derives bundle states with readiness last so stale or invalid plans are never ready. */
function deriveChangeStates(facts: ChangeBundleFacts): string[] {
  const states: string[] = [];
  if (!facts.specStatus) {
    states.push("missing-spec-status");
  }
  if (facts.location === "active" && [facts.specStatus, facts.planStatus].some((status) => status && !["draft", "approved"].includes(status))) {
    states.push("invalid-active-status");
  }
  if (facts.location === "archive" && [facts.specStatus, facts.planStatus].some((status) => status && !["applied", "rejected", "cancelled", "superseded"].includes(status))) {
    states.push("invalid-archive-status");
  }
  if (facts.integrityErrors > 0) {
    states.push("integrity-issues");
  }
  if (facts.baselineFailures > 0) {
    states.push("stale-plan");
  }
  if (facts.location === "active" && facts.specStatus === "draft" && !facts.planStatus) {
    states.push("draft-spec");
  } else if (facts.location === "active" && facts.specStatus === "approved" && !facts.planStatus) {
    states.push("needs-plan");
  } else if (facts.location === "active" && facts.specStatus === "approved" && facts.planStatus === "draft") {
    states.push("needs-plan-approval");
  } else if (
    facts.location === "active"
    && facts.specStatus === "approved"
    && facts.planStatus === "approved"
    && facts.integrityErrors === 0
    && facts.baselineFailures === 0
  ) {
    states.push("ready-to-execute");
  }
  return [...new Set(states)];
}

function chooseNextAction(result: Omit<StatusResult, "nextAction">) {
  if (result.projectKind === "grace3") return "Use $grace-migrate to migrate legacy GRACE 3 docs to .grace artifacts.";
  if (result.projectKind === "none") return "Run $grace-init to create a GRACE 4 .grace skeleton.";
  if (result.derivedStates.includes("stale-plan")) return "Supersede and replan the stale approved change; do not edit the approved plan or continue execution.";
  if (result.integrity.errors > 0) return "Run grace lint --path <project-root> and fix GRACE 4 integrity errors.";
  if (result.derivedStates.includes("unexplained-observed-drift")) return "Use $grace-refresh to reconcile unexplained repository changes through a new GraceChangeSpec and GraceChangePlan.";
  if (result.derivedStates.includes("scope-overlap")) return "Review active change scope overlaps; replan or execute sequentially before parallel-safe work.";
  if (result.changes.some((change) => change.derivedStates.includes("ready-to-execute"))) return "Run $grace-execute for approved active changes.";
  if (result.changes.some((change) => change.derivedStates.includes("needs-plan"))) return "Run $grace-plan for the approved GraceChangeSpec.";
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
    observedDrift: { available: false, changedFiles: [], explainedFiles: [], unexplainedFiles: [] },
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
  // Load index once — reused by module health and status fields
  const graph = buildGraphProjection(paths);
  const verification = buildVerificationProjection(paths, graph);
  const activeScopes = collectActiveChangeScopes(paths);
  const ownership = createDurableOwnershipIndex(graph, verification);
  const overlapIssues = detectScopeOverlaps(activeScopes, ownership);
  const unsafeIssues = detectUnsafeConcurrentExecution(activeScopes, ownership);
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
  const observedDrift = collectObservedDrift(root, activeScopes, buildDriftRouteIndex(root, graph, verification));
  if (observedDrift.explainedFiles.length > 0) derivedStates.add("explained-observed-drift");
  if (observedDrift.unexplainedFiles.length > 0) derivedStates.add("unexplained-observed-drift");

  let modules: ModuleHealthRecord[] | undefined;
  let moduleHealthLoadError: string | undefined;
  try {
    const index = loadGraceArtifactIndex(root);
    if (options.includeModules) {
      modules = collectModuleHealth(index);
    }
  } catch (error) {
    moduleHealthLoadError = error instanceof Error ? error.message : String(error);
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
    observedDrift,
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
  lines.push(
    "",
    "Observed Drift",
    `- Available: ${result.observedDrift.available ? "yes" : "no"}`,
    `- Changed files: ${result.observedDrift.changedFiles.length}`,
    `- Explained by active approved changes: ${result.observedDrift.explainedFiles.length}`,
    `- Unexplained: ${result.observedDrift.unexplainedFiles.length}`,
  );
  for (const file of result.observedDrift.unexplainedFiles.slice(0, 10)) lines.push(`- unexplained: ${file}`);
  if (result.modules && result.modules.length > 0) lines.push("", "Module Health", formatModuleHealthTable(result.modules));
  if (result.moduleHealthLoadError) lines.push("", "Module Health", `- unavailable: ${result.moduleHealthLoadError}`);
  lines.push("", "Suggested Next Action", `- ${result.nextAction}`);
  return lines.join("\n");
}

function collectObservedDrift(root: string, activeScopes: ActiveChangeScope[], routes: DriftRouteIndex): StatusResult["observedDrift"] {
  const gitRootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" });
  if (gitRootResult.status !== 0 || !gitRootResult.stdout.trim()) {
    return { available: false, changedFiles: [], explainedFiles: [], unexplainedFiles: [] };
  }

  const gitRoot = path.resolve(gitRootResult.stdout.trim());
  const rootRelativeToGit = path.relative(gitRoot, root) || ".";
  if (rootRelativeToGit.startsWith("..") || path.isAbsolute(rootRelativeToGit)) {
    return { available: false, changedFiles: [], explainedFiles: [], unexplainedFiles: [] };
  }

  const statusResult = spawnSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", rootRelativeToGit],
    { cwd: gitRoot, encoding: "utf8" },
  );
  if (statusResult.status !== 0) {
    return { available: false, changedFiles: [], explainedFiles: [], unexplainedFiles: [] };
  }

  const changedFiles = parsePorcelainV1ZPaths(statusResult.stdout, gitRoot, root);

  const approvedScopes = activeScopes.filter((scope) => scope.specStatus === "approved" && scope.planStatus === "approved");
  const explainedFiles = changedFiles.filter((file) => approvedScopes.some((scope) => activeScopeExplainsFile(root, scope, file, routes)));
  const explained = new Set(explainedFiles);
  return {
    available: true,
    changedFiles,
    explainedFiles,
    unexplainedFiles: changedFiles.filter((file) => !explained.has(file)),
  };
}

function parsePorcelainV1ZPaths(output: string, gitRoot: string, projectRoot: string): string[] {
  const records = output.split("\0");
  const authoredPaths: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4) continue;
    const status = record.slice(0, 2);
    authoredPaths.push(record.slice(3));
    if (status.includes("R") || status.includes("C")) {
      const sourcePath = records[index + 1];
      if (sourcePath) authoredPaths.push(sourcePath);
      index += 1;
    }
  }

  return [...new Set(authoredPaths
    .map((file) => path.relative(projectRoot, path.resolve(gitRoot, file)).replaceAll(path.sep, "/"))
    .filter((file) => file !== "" && !file.startsWith("../") && file !== ".."))]
    .sort();
}

function activeScopeExplainsFile(root: string, scope: ActiveChangeScope, file: string, routes: DriftRouteIndex): boolean {
  if (observedWriteScopeContains(scope.observedWrites, file)) {
    return true;
  }

  const bundlePath = path.relative(root, scope.bundlePath).replaceAll(path.sep, "/");
  if (file === bundlePath || file.startsWith(`${bundlePath}/`)) {
    return true;
  }

  if (file.startsWith(".grace/context/")) {
    const contextFile = path.basename(file);
    return scope.durable.contextArtifacts.some((artifact) => artifact === contextFile || artifact.endsWith(`/${contextFile}`));
  }
  if (file.startsWith(".grace/graph/")) {
    const route = routes.graphFiles.get(file);
    return Boolean(route && (
      scope.durable.graphDocuments.includes(route.document)
      || scope.durable.graphAnchors.some((anchor) => route.anchors.has(anchor))
    ));
  }
  if (file.startsWith(".grace/verification/")) {
    const route = routes.verificationFiles.get(file);
    return Boolean(route && (
      scope.durable.verificationDocuments.includes(route.document)
      || scope.durable.verificationAnchors.some((anchor) => route.anchors.has(anchor))
    ));
  }
  return false;
}

function buildDriftRouteIndex(root: string, graph: GraphProjection, verification: VerificationProjection): DriftRouteIndex {
  const routes: DriftRouteIndex = { graphFiles: new Map(), verificationFiles: new Map() };
  for (const [document, file] of graph.documents) {
    const relativeFile = path.relative(root, file).replaceAll(path.sep, "/");
    const anchors = new Set(
      [...graph.modules.values(), ...graph.dataFlows.values()]
        .filter((record) => record.owner === document)
        .map((record) => record.id),
    );
    routes.graphFiles.set(relativeFile, { document, anchors });
  }
  for (const [document, file] of verification.documents) {
    const relativeFile = path.relative(root, file).replaceAll(path.sep, "/");
    const anchors = new Set([...verification.entries.values()].filter((record) => record.owner === document).map((record) => record.id));
    routes.verificationFiles.set(relativeFile, { document, anchors });
  }
  return routes;
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
