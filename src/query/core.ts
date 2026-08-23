import { type Dirent, existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { buildGraphProjection, buildVerificationProjection, type GraphAnchorRecord, type VerificationAnchorRecord } from "../grace4/projections";
import { validateGrace4Project } from "../grace4/grammar";
import { detectGraceProjectKind, formatGrace3MigrationGuidance, resolveGrace4Paths } from "../grace4/project";
import { extractAssertionsWithIssues } from "../grace4/assertions";
import { collectActiveChangeScopes } from "../grace4/scope";
import type { Grace4Issue } from "../grace4/types";
import { loadGraceLintConfig } from "../lint/config";
import { collectCodeFiles, describeUnreadableDirectory, hasGraceMarkers, parseGovernedFile, type FileMarkupRecord, type UnreadableDirectoryHandler } from "../project-utils";
import { GraceCommandError } from "./errors";
import type {
  GraceArtifactIndex,
  Grace4ModuleRecord,
  ModuleFindOptions,
  ModuleGraphRecord,
  ModuleInterfaceItem,
  ModuleMatch,
  ModuleRecord,
  ModuleVerificationRecord,
  VerificationFindOptions,
  VerificationMatch,
} from "./types";

function toPosixPath(filePath: string) {
  return filePath.replaceAll(path.sep, "/");
}

function normalizeInputPath(root: string, input: string) {
  const absolutePath = path.isAbsolute(input) ? path.normalize(input) : path.resolve(root, input);
  const relativePath = path.relative(root, absolutePath);
  if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return toPosixPath(relativePath);
  }

  return toPosixPath(input);
}

function loadGovernedFiles(root: string, onUnreadableDirectory?: UnreadableDirectoryHandler) {
  const { config, issues } = loadGraceLintConfig(root);
  const configErrors = issues.filter((issue) => issue.severity === "error");
  if (configErrors.length > 0) {
    throw new GraceCommandError("invalid-project", "GRACE query configuration is invalid. Run `grace lint --path PROJECT` for details.", {
      issues: configErrors.map((issue) => issue.code),
    });
  }

  const files: FileMarkupRecord[] = [];
  for (const filePath of collectCodeFiles(root, config?.ignoredDirs ?? [], root, onUnreadableDirectory)) {
    const text = readFileSync(filePath, "utf8");
    if (hasGraceMarkers(text)) {
      files.push(parseGovernedFile(root, filePath, text));
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function listPlanFiles(directory: string, onUnreadableDirectory?: UnreadableDirectoryHandler): string[] {
  if (!existsSync(directory)) return [];
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    onUnreadableDirectory?.(directory, error);
    return [];
  }
  return entries.flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listPlanFiles(entryPath, onUnreadableDirectory);
    return entry.isFile() && entry.name === "plan.xml" ? [entryPath] : [];
  });
}

function collectOperationalValidationErrors(paths: ReturnType<typeof resolveGrace4Paths>, onUnreadableDirectory?: UnreadableDirectoryHandler) {
  const assertionIssues = [paths.changesActiveDir, paths.changesArchiveDir]
    .flatMap((directory) => listPlanFiles(directory, onUnreadableDirectory))
    .flatMap((planFile) => (["BaselineAssertions", "TargetAssertions"] as const)
      .flatMap((section) => extractAssertionsWithIssues(planFile, section).issues));
  const scopeIssues = collectActiveChangeScopes(paths).flatMap((scope) => scope.issues);
  return [...assertionIssues, ...scopeIssues].filter((issue) => issue.severity === "error");
}

export function getModuleName(moduleRecord: ModuleRecord) {
  return moduleRecord.name ?? moduleRecord.id;
}

export function getModuleType(moduleRecord: ModuleRecord) {
  return moduleRecord.type ?? moduleRecord.graph.kind;
}

export function getModulePath(moduleRecord: ModuleRecord) {
  return moduleRecord.graph.path ?? moduleRecord.localFiles.find((file) => !isLikelyTestPath(file.path))?.path ?? moduleRecord.localFiles[0]?.path;
}

export function getModuleDepends(moduleRecord: ModuleRecord) {
  return moduleRecord.graph.depends;
}

export function getModuleVerificationIds(moduleRecord: ModuleRecord) {
  return moduleRecord.verifications.map((entry) => entry.id).sort();
}

export function getModuleImplementationFiles(moduleRecord: ModuleRecord) {
  return moduleRecord.localFiles.filter((file) => !isLikelyTestPath(file.path));
}

export function loadGraceArtifactIndex(projectRoot: string): GraceArtifactIndex {
  const root = path.resolve(projectRoot);
  const kind = detectGraceProjectKind(root);
  if (kind === "grace3") {
    throw new GraceCommandError("invalid-project", formatGrace3MigrationGuidance(root), { issues: ["project.grace3-detected"] });
  }
  if (kind !== "grace4") {
    throw new GraceCommandError("invalid-project", "No .grace directory found. Run the grace-init skill before querying this project.", { issues: ["project.missing-grace"] });
  }

  const paths = resolveGrace4Paths(root);
  const validation = validateGrace4Project(root);
  const validationErrors = validation.issues.filter((issue) => issue.severity === "error");
  if (validationErrors.length > 0) {
    throw invalidProjectError(validationErrors.map((issue) => issue.code));
  }
  const walkIssues: Grace4Issue[] = [];
  const onUnreadableDirectory: UnreadableDirectoryHandler = (directory, error) => {
    walkIssues.push({ severity: "warning", code: "walk.unreadable-directory", file: directory, message: describeUnreadableDirectory(directory, error) });
  };
  const operationalErrors = collectOperationalValidationErrors(paths, onUnreadableDirectory);
  if (operationalErrors.length > 0) {
    throw invalidProjectError(operationalErrors.map((issue) => issue.code));
  }
  const graph = buildGraphProjection(paths);
  const verification = buildVerificationProjection(paths, graph);
  const projectionErrors = [...graph.issues, ...verification.issues].filter((issue) => issue.severity === "error");
  if (projectionErrors.length > 0) {
    throw invalidProjectError(projectionErrors.map((issue) => issue.code));
  }
  const governedFiles = loadGovernedFiles(root, onUnreadableDirectory);
  const verifications = [...verification.entries.values()].map(toModuleVerificationRecord).sort((left, right) => left.id.localeCompare(right.id));

  const modules = [...graph.modules.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((record) => {
      const graphRecord = toModuleGraphRecord(record);
      const moduleVerifications = verifications.filter((entry) => entry.moduleId === record.id);
      const localFiles = governedFiles.filter((file) => file.linkedModuleIds.includes(record.id)).sort((left, right) => left.path.localeCompare(right.path));
      return {
        id: record.id,
        name: extractNamedField(record.text, "Name"),
        type: graphRecord.kind,
        graph: graphRecord,
        verification: moduleVerifications[0] ?? null,
        verifications: moduleVerifications,
        localFiles,
        plan: null,
        steps: [],
      } satisfies Grace4ModuleRecord;
    });

  return { root, graph, verification, modules, verifications, files: governedFiles, issues: [...validation.issues, ...graph.issues, ...verification.issues, ...walkIssues] };
}

function invalidProjectError(issueCodes: string[]): GraceCommandError {
  return new GraceCommandError(
    "invalid-project",
    "GRACE artifacts are invalid; no navigation records were returned. Run `grace lint --path PROJECT` for details.",
    { issues: [...new Set(issueCodes)].sort() },
  );
}

function toModuleGraphRecord(record: GraphAnchorRecord): ModuleGraphRecord {
  return {
    ...record,
    name: extractNamedField(record.text, "Name"),
    type: record.kind,
    status: extractNamedField(record.text, "Status"),
    purpose: extractNamedField(record.text, "Summary") ?? extractNamedField(record.text, "Purpose"),
    path: extractPath(record.text),
    depends: record.links,
    annotations: [],
  };
}

function toModuleVerificationRecord(record: VerificationAnchorRecord): ModuleVerificationRecord {
  const inferredTestFiles = record.testFiles.length === 0
    ? inferTestFiles(record.commands).map((file) => qualifyVerificationPath(record.cwd, file))
    : [];
  return {
    id: record.id,
    moduleId: record.moduleId,
    priority: record.priority,
    cwd: record.cwd,
    testFiles: [...new Set([...inferredTestFiles, ...record.testFiles])].sort(),
    moduleChecks: record.commands,
    scenarios: record.scenarios.map((text, index) => ({ tag: "Scenario-" + (index + 1), text })),
    requiredLogMarkers: record.markers,
    requiredTraceAssertions: record.traceAssertions,
  };
}

function qualifyVerificationPath(cwd: string | undefined, file: string): string {
  if (!cwd || path.isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file) || file === cwd || file.startsWith(`${cwd}/`)) {
    return file;
  }
  return path.posix.join(cwd, file.replaceAll("\\", "/"));
}

function inferTestFiles(commands: string[]) {
  return [...new Set(commands
    .flatMap((command) => [...command.matchAll(/\b([^\s]+\.(?:test|spec)\.[A-Za-z0-9]+)\b/g)].map((match) => match[1]!))
    .filter((file) => ![...file].some((character) => "*?[]{}()!".includes(character))))]
    .sort();
}

function extractNamedField(text: string, label: string) {
  const match = text.match(new RegExp(`${label}\\s+([^<]+?)(?=\\s+[A-Z][A-Za-z-]*\\s+|$)`));
  return match?.[1]?.trim();
}

function extractPath(text: string) {
  const match = text.match(/(?:Path|File)\s+([^\s]+)/);
  return match?.[1]?.trim();
}

function isLikelyTestPath(relativePath: string) {
  return /(^|\/)(__tests__|tests)(\/|$)|(^|\/)(test_[^/]+|[^/]+\.(test|spec)\.[^.]+)$/.test(relativePath);
}

function applyTextMatch(matchedBy: Set<string>, label: string, query: string, candidate: string | undefined, exactScore: number, containsScore: number) {
  if (!candidate) {
    return 0;
  }
  const normalizedCandidate = candidate.toLowerCase();
  if (normalizedCandidate === query) {
    matchedBy.add(label);
    return exactScore;
  }
  if (normalizedCandidate.includes(query)) {
    matchedBy.add(label);
    return containsScore;
  }
  return 0;
}

function pathMatchScore(moduleRecord: ModuleRecord, targetPath: string) {
  let bestScore = 0;
  const graphPath = moduleRecord.graph.path;
  if (graphPath) {
    if (graphPath === targetPath) {
      bestScore = Math.max(bestScore, 100000 + graphPath.length);
    } else if (targetPath.startsWith(`${graphPath}/`)) {
      bestScore = Math.max(bestScore, 90000 + graphPath.length);
    }
  }
  if (moduleRecord.graph.text.includes(targetPath)) {
    bestScore = Math.max(bestScore, 80000 + targetPath.length);
  }
  for (const file of moduleRecord.localFiles) {
    if (file.path === targetPath) {
      bestScore = Math.max(bestScore, 85000 + file.path.length);
    } else if (file.path.startsWith(`${targetPath}/`)) {
      bestScore = Math.max(bestScore, 65000 + file.path.length);
    }
  }
  return bestScore;
}

function matchesTypeFilter(moduleRecord: ModuleRecord, type?: string) {
  return !type || (getModuleType(moduleRecord) ?? "").toLowerCase() === type.toLowerCase();
}

function matchesDependencyFilter(moduleRecord: ModuleRecord, dependsOn?: string) {
  return !dependsOn || getModuleDepends(moduleRecord).some((dependency) => dependency.toLowerCase() === dependsOn.toLowerCase());
}

export function findModules(index: GraceArtifactIndex, options: ModuleFindOptions = {}) {
  const query = options.query?.trim();
  const normalizedQuery = query?.toLowerCase();
  const normalizedPathQuery = query ? normalizeInputPath(index.root, query) : undefined;
  const matches: ModuleMatch[] = [];

  for (const moduleRecord of index.modules) {
    if (!matchesTypeFilter(moduleRecord, options.type) || !matchesDependencyFilter(moduleRecord, options.dependsOn)) {
      continue;
    }
    if (!normalizedQuery) {
      matches.push({ module: moduleRecord, score: 1, matchedBy: ["filters"] });
      continue;
    }

    const matchedBy = new Set<string>();
    let score = 0;
    score = Math.max(score, applyTextMatch(matchedBy, "id", normalizedQuery, moduleRecord.id, 100, 70));
    score = Math.max(score, applyTextMatch(matchedBy, "name", normalizedQuery, getModuleName(moduleRecord), 90, 60));
    score = Math.max(score, applyTextMatch(matchedBy, "type", normalizedQuery, getModuleType(moduleRecord), 80, 45));
    score = Math.max(score, applyTextMatch(matchedBy, "graph-text", normalizedQuery, moduleRecord.graph.text, 55, 30));
    for (const dependency of getModuleDepends(moduleRecord)) {
      score = Math.max(score, applyTextMatch(matchedBy, "dependency", normalizedQuery, dependency, 60, 35));
    }
    for (const verificationId of getModuleVerificationIds(moduleRecord)) {
      score = Math.max(score, applyTextMatch(matchedBy, "verification", normalizedQuery, verificationId, 75, 40));
    }
    for (const file of moduleRecord.localFiles) {
      score = Math.max(score, applyTextMatch(matchedBy, "file-path", normalizedQuery, file.path, 85, 50));
      score = Math.max(score, applyTextMatch(matchedBy, "file-purpose", normalizedQuery, file.moduleContract?.fields.PURPOSE, 40, 20));
      score = Math.max(score, applyTextMatch(matchedBy, "file-scope", normalizedQuery, file.moduleContract?.fields.SCOPE, 35, 20));
    }
    if (normalizedPathQuery) {
      const pathScore = pathMatchScore(moduleRecord, normalizedPathQuery);
      if (pathScore > 0) {
        matchedBy.add("path");
        score = Math.max(score, pathScore / 1000);
      }
    }
    if (score > 0) {
      matches.push({ module: moduleRecord, score, matchedBy: Array.from(matchedBy).sort() });
    }
  }

  return matches.sort((left, right) => right.score - left.score || left.module.id.localeCompare(right.module.id));
}

export function resolveModule(index: GraceArtifactIndex, target: string) {
  const normalizedTarget = target.trim();
  if (!normalizedTarget) {
    throw new GraceCommandError("invalid-arguments", "A module id or path target is required.");
  }
  const exactId = index.modules.find((moduleRecord) => moduleRecord.id.toLowerCase() === normalizedTarget.toLowerCase());
  if (exactId) {
    return exactId;
  }

  const normalizedPath = normalizeInputPath(index.root, normalizedTarget);
  const candidates = index.modules
    .map((moduleRecord) => ({ module: moduleRecord, score: pathMatchScore(moduleRecord, normalizedPath) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.module.id.localeCompare(right.module.id));

  if (candidates.length === 0) {
    throw new GraceCommandError("not-found", `No module found for \`${target}\`. Use \`grace module find ${target}\` to inspect candidates.`);
  }
  const topScore = candidates[0].score;
  const tiedCandidates = candidates.filter((candidate) => candidate.score === topScore);
  if (tiedCandidates.length > 1) {
    throw new GraceCommandError("ambiguous-target", `Path \`${target}\` is ambiguous. Matching modules: ${tiedCandidates.map((candidate) => candidate.module.id).join(", ")}.`);
  }
  return candidates[0].module;
}

export function resolveGovernedFile(index: GraceArtifactIndex, target: string) {
  const trimmedTarget = target.trim();
  if (!trimmedTarget) {
    throw new GraceCommandError("invalid-arguments", "A governed file path is required.");
  }
  const normalizedTarget = normalizeInputPath(index.root, trimmedTarget);
  const fileRecord = index.files.find((record) => record.path === normalizedTarget);
  if (!fileRecord) {
    throw new GraceCommandError("not-found", `No governed file found for \`${target}\`.`);
  }
  return fileRecord;
}

function matchesVerificationModuleFilter(moduleRecord: ModuleRecord | null, moduleFilter?: string) {
  if (!moduleFilter) {
    return true;
  }
  const normalizedFilter = moduleFilter.toLowerCase();
  return Boolean(moduleRecord && (moduleRecord.id.toLowerCase() === normalizedFilter || getModuleName(moduleRecord).toLowerCase().includes(normalizedFilter)));
}

export function findVerifications(index: GraceArtifactIndex, options: VerificationFindOptions = {}) {
  const query = options.query?.trim();
  const normalizedQuery = query?.toLowerCase();
  const matches: VerificationMatch[] = [];

  for (const entry of index.verifications) {
    const moduleRecord = entry.moduleId ? index.modules.find((module) => module.id === entry.moduleId) ?? null : null;
    if (!matchesVerificationModuleFilter(moduleRecord, options.module)) {
      continue;
    }
    if (options.priority && (entry.priority ?? "").toLowerCase() !== options.priority.toLowerCase()) {
      continue;
    }
    if (!normalizedQuery) {
      matches.push({ verification: entry, module: moduleRecord, score: 1, matchedBy: ["filters"] });
      continue;
    }

    const matchedBy = new Set<string>();
    let score = 0;
    score = Math.max(score, applyTextMatch(matchedBy, "id", normalizedQuery, entry.id, 100, 70));
    score = Math.max(score, applyTextMatch(matchedBy, "module-id", normalizedQuery, entry.moduleId, 80, 50));
    score = Math.max(score, applyTextMatch(matchedBy, "module-name", normalizedQuery, moduleRecord ? getModuleName(moduleRecord) : undefined, 70, 45));
    for (const command of entry.moduleChecks) {
      score = Math.max(score, applyTextMatch(matchedBy, "command", normalizedQuery, command, 65, 35));
    }
    for (const scenario of entry.scenarios) {
      score = Math.max(score, applyTextMatch(matchedBy, "scenario", normalizedQuery, scenario.text, 55, 25));
    }
    for (const marker of entry.requiredLogMarkers) {
      score = Math.max(score, applyTextMatch(matchedBy, "marker", normalizedQuery, marker, 60, 30));
    }
    if (score > 0) {
      matches.push({ verification: entry, module: moduleRecord, score, matchedBy: Array.from(matchedBy).sort() });
    }
  }
  return matches.sort((left, right) => right.score - left.score || left.verification.id.localeCompare(right.verification.id));
}

export function resolveVerification(index: GraceArtifactIndex, target: string) {
  const trimmedTarget = target.trim();
  if (!trimmedTarget) {
    throw new GraceCommandError("invalid-arguments", "A verification id or module target is required.");
  }
  const normalizedTarget = trimmedTarget.toLowerCase();
  const exact = index.verifications.find((entry) => entry.id.toLowerCase() === normalizedTarget);
  if (exact) {
    return { verification: exact, module: exact.moduleId ? index.modules.find((module) => module.id === exact.moduleId) ?? null : null, score: 100, matchedBy: ["id"] } satisfies VerificationMatch;
  }

  try {
    const moduleRecord = resolveModule(index, target);
    if (moduleRecord.verifications.length === 1) {
      return { verification: moduleRecord.verifications[0], module: moduleRecord, score: 90, matchedBy: ["module"] } satisfies VerificationMatch;
    }
    if (moduleRecord.verifications.length > 1) {
      throw new GraceCommandError("ambiguous-target", `Module \`${moduleRecord.id}\` has multiple verification entries (${moduleRecord.verifications.map((entry) => entry.id).join(", ")}). Use \`grace verification find ${target}\` to inspect candidates.`);
    }
    throw new GraceCommandError("not-found", `Module \`${moduleRecord.id}\` has no verification entries.`);
  } catch (error) {
    if (!(error instanceof GraceCommandError) || error.code !== "not-found") {
      throw error;
    }
  }
  throw new GraceCommandError("not-found", `No verification found for \`${target}\`. Use \`grace verification find ${target}\` to inspect candidates.`);
}
