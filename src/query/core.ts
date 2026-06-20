import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { buildGraphProjection, buildVerificationProjection, type GraphAnchorRecord, type VerificationAnchorRecord } from "../grace4/projections";
import { detectGraceProjectKind, formatGrace3MigrationGuidance, resolveGrace4Paths } from "../grace4/project";
import { CODE_EXTENSIONS } from "../language-registry";
import { loadGraceLintConfig } from "../lint/config";
import type {
  FileBlockRecord,
  FileContractRecord,
  FileFieldSection,
  FileListItem,
  FileMarkupRecord,
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

const DEFAULT_IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".turbo", ".cache", ".grace"]);

type MarkupSection = {
  content: string;
  startLine: number;
  endLine: number;
};

function toPosixPath(filePath: string) {
  return filePath.replaceAll(path.sep, "/");
}

function normalizeRelative(root: string, filePath: string) {
  return toPosixPath(path.relative(root, filePath) || ".");
}

function normalizeInputPath(root: string, input: string) {
  const absolutePath = path.isAbsolute(input) ? path.normalize(input) : path.resolve(root, input);
  const relativePath = path.relative(root, absolutePath);
  if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return toPosixPath(relativePath);
  }

  return toPosixPath(input);
}

function lineNumberAt(text: string, index: number) {
  return text.slice(0, index).split("\n").length;
}

function splitList(text?: string) {
  if (!text) {
    return [];
  }

  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.toLowerCase() !== "none");
}

function stripQuotedStrings(text: string) {
  let result = "";
  let quote: '"' | "'" | "`" | null = null;
  let escaped = false;

  for (const char of text) {
    if (!quote) {
      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        result += " ";
        continue;
      }

      result += char;
      continue;
    }

    if (escaped) {
      escaped = false;
      result += char === "\n" ? "\n" : " ";
      continue;
    }

    if (char === "\\") {
      escaped = true;
      result += " ";
      continue;
    }

    if (char === quote) {
      quote = null;
      result += " ";
      continue;
    }

    result += char === "\n" ? "\n" : " ";
  }

  return result;
}

function hasGraceMarkers(text: string) {
  const searchable = stripQuotedStrings(text);
  return searchable.split("\n").some((line) => /^\s*(\/\/|#|--|;+|\*)\s*(START_MODULE_CONTRACT|START_MODULE_MAP|START_CONTRACT:|START_BLOCK_|START_CHANGE_SUMMARY)/.test(line));
}

function collectCodeFiles(root: string, ignoredDirs: string[], currentDir = root): string[] {
  const files: string[] = [];
  const ignoredDirSet = new Set([...DEFAULT_IGNORED_DIRS, ...ignoredDirs]);
  const entries = readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirSet.has(entry.name)) {
        continue;
      }
      files.push(...collectCodeFiles(root, ignoredDirs, path.join(currentDir, entry.name)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const filePath = path.join(currentDir, entry.name);
    if (CODE_EXTENSIONS.has(path.extname(filePath))) {
      files.push(filePath);
    }
  }

  return files;
}

function stripCommentPrefix(line: string) {
  return line.replace(/^\s*(\/\/|#|--|;+|\*)?\s*/, "");
}

function findSection(text: string, startMarker: string, endMarker: string) {
  const startIndex = text.indexOf(startMarker);
  const endIndex = text.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
    return null;
  }

  return {
    content: text.slice(startIndex + startMarker.length, endIndex),
    startLine: lineNumberAt(text, startIndex),
    endLine: lineNumberAt(text, endIndex),
  } satisfies MarkupSection;
}

function parseFieldSection(section: MarkupSection | null): FileFieldSection | null {
  if (!section) {
    return null;
  }

  const fields: Record<string, string> = {};
  for (const line of section.content.split("\n")) {
    const cleaned = stripCommentPrefix(line).trim();
    if (!cleaned) {
      continue;
    }

    const match = cleaned.match(/^([A-Z_]+):\s*(.+)$/);
    if (match) {
      fields[match[1]] = match[2].trim();
    }
  }

  return { fields, startLine: section.startLine, endLine: section.endLine };
}

function parseListSection(section: MarkupSection | null) {
  if (!section) {
    return [] as FileListItem[];
  }

  return section.content
    .split("\n")
    .map((line, index) => ({ label: stripCommentPrefix(line).trim(), line: section.startLine + index }))
    .filter((item) => item.label.length > 0);
}

function parseScopedFieldSections(text: string) {
  const sections: FileContractRecord[] = [];
  for (const match of text.matchAll(/START_CONTRACT:\s*([A-Za-z0-9_$.\-]+)([\s\S]*?)END_CONTRACT:\s*\1/g)) {
    const startIndex = match.index ?? 0;
    const endIndex = startIndex + match[0].length;
    const section = parseFieldSection({
      content: match[2] ?? "",
      startLine: lineNumberAt(text, startIndex),
      endLine: lineNumberAt(text, endIndex),
    });
    sections.push({ name: match[1], fields: section?.fields ?? {}, startLine: lineNumberAt(text, startIndex), endLine: lineNumberAt(text, endIndex) });
  }
  return sections;
}

function parseBlocks(text: string) {
  const blocks: FileBlockRecord[] = [];
  for (const match of text.matchAll(/START_BLOCK_([A-Za-z0-9_]+)([\s\S]*?)END_BLOCK_\1/g)) {
    const startIndex = match.index ?? 0;
    const endIndex = startIndex + match[0].length;
    blocks.push({ name: match[1], startLine: lineNumberAt(text, startIndex), endLine: lineNumberAt(text, endIndex) });
  }
  return blocks;
}

function extractLinkedModuleIds(moduleContract: FileFieldSection | null) {
  return splitList(moduleContract?.fields.LINKS).filter((item) => /^M-[A-Za-z0-9-]+$/.test(item));
}

function parseGovernedFile(root: string, filePath: string): FileMarkupRecord {
  const text = readFileSync(filePath, "utf8");
  const moduleContract = parseFieldSection(findSection(text, "START_MODULE_CONTRACT", "END_MODULE_CONTRACT"));
  return {
    path: normalizeRelative(root, filePath),
    moduleContract,
    moduleMap: parseListSection(findSection(text, "START_MODULE_MAP", "END_MODULE_MAP")),
    changeSummary: parseFieldSection(findSection(text, "START_CHANGE_SUMMARY", "END_CHANGE_SUMMARY")),
    contracts: parseScopedFieldSections(text),
    blocks: parseBlocks(text),
    linkedModuleIds: extractLinkedModuleIds(moduleContract),
  };
}

function loadGovernedFiles(root: string) {
  const { config, issues } = loadGraceLintConfig(root);
  const configErrors = issues.filter((issue) => issue.severity === "error");
  if (configErrors.length > 0) {
    throw new Error(configErrors.map((issue) => issue.message).join("\n"));
  }

  const files: FileMarkupRecord[] = [];
  for (const filePath of collectCodeFiles(root, config?.ignoredDirs ?? [])) {
    const text = readFileSync(filePath, "utf8");
    if (hasGraceMarkers(text)) {
      files.push(parseGovernedFile(root, filePath));
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
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
    throw new Error(formatGrace3MigrationGuidance(root));
  }
  if (kind !== "grace4") {
    throw new Error("No .grace directory found.");
  }

  const paths = resolveGrace4Paths(root);
  const graph = buildGraphProjection(paths);
  const verification = buildVerificationProjection(paths, graph);
  const governedFiles = loadGovernedFiles(root);
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

  return { root, graph, verification, modules, verifications, files: governedFiles, issues: [...graph.issues, ...verification.issues] };
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
  return {
    id: record.id,
    moduleId: record.moduleId,
    priority: record.priority,
    testFiles: inferTestFiles(record.commands),
    moduleChecks: record.commands,
    scenarios: record.scenarios.map((text, index) => ({ tag: "Scenario-" + (index + 1), text })),
    requiredLogMarkers: record.markers,
    requiredTraceAssertions: [],
  };
}

function inferTestFiles(commands: string[]) {
  return [...new Set(commands.flatMap((command) => [...command.matchAll(/\b([^\s]+\.(?:test|spec)\.[A-Za-z0-9]+)\b/g)].map((match) => match[1])))].sort();
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
    throw new Error(`No module found for \`${target}\`. Use \`grace module find ${target}\` to inspect candidates.`);
  }
  const topScore = candidates[0].score;
  const tiedCandidates = candidates.filter((candidate) => candidate.score === topScore);
  if (tiedCandidates.length > 1) {
    throw new Error(`Path \`${target}\` is ambiguous. Matching modules: ${tiedCandidates.map((candidate) => candidate.module.id).join(", ")}.`);
  }
  return candidates[0].module;
}

export function resolveGovernedFile(index: GraceArtifactIndex, target: string) {
  const normalizedTarget = normalizeInputPath(index.root, target.trim());
  const fileRecord = index.files.find((record) => record.path === normalizedTarget);
  if (!fileRecord) {
    throw new Error(`No governed file found for \`${target}\`.`);
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
  const normalizedTarget = target.trim().toLowerCase();
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
      throw new Error(`Module \`${moduleRecord.id}\` has multiple verification entries (${moduleRecord.verifications.map((entry) => entry.id).join(", ")}). Use \`grace verification find ${target}\` to inspect candidates.`);
    }
    throw new Error(`Module \`${moduleRecord.id}\` has no verification entries.`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("No module found for")) {
      throw error;
    }
  }
  throw new Error(`No verification found for \`${target}\`. Use \`grace verification find ${target}\` to inspect candidates.`);
}
