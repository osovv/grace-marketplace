import { type Dirent, existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ADAPTER_BACKED_EXTENSIONS, CODE_EXTENSIONS, LANGUAGE_ADAPTERS } from "./language-registry";
import { readCachedAnalysis, writeCachedAnalysis } from "./lint/analysis-cache";
import { LanguageRuntimeMissingError, type LanguageAnalysis, type LintIssue, type MapMode, type ModuleRole } from "./lint/types";

export type TextSection = {
  content: string;
  startLine: number;
  endLine: number;
};

export type FileFieldSection = {
  fields: Record<string, string>;
  startLine: number;
  endLine: number;
};

export type FileListItem = {
  label: string;
  symbolName?: string;
  line: number;
};

export type FileContractRecord = {
  name: string;
  fields: Record<string, string>;
  startLine: number;
  endLine: number;
};

export type FileBlockRecord = {
  name: string;
  startLine: number;
  endLine: number;
};

export type FileMarkupRecord = {
  path: string;
  moduleContract: FileFieldSection | null;
  moduleMap: FileListItem[];
  changeSummary: FileFieldSection | null;
  contracts: FileContractRecord[];
  blocks: FileBlockRecord[];
  linkedModuleIds: string[];
};

/** Parsed markup plus optional language analysis for one governed file. */
export type GovernedFileAnalysis = {
  record: FileMarkupRecord;
  language: LanguageAnalysis | null;
  issues: LintIssue[];
};

/**
 * Directory names pruned from every project walk, matched at any depth.
 * Covers VCS metadata, build output, dependency caches, vendored code,
 * and tool scratch space across the ecosystems GRACE analyzes.
 */
const DEFAULT_IGNORED_DIRS = new Set([
  // VCS metadata
  ".git",
  ".svn",
  ".hg",
  // JavaScript/TypeScript output and caches
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".output",
  "out",
  ".turbo",
  ".vite",
  ".parcel-cache",
  ".svelte-kit",
  ".astro",
  "storybook-static",
  ".cache",
  ".yarn",
  ".nyc_output",
  "bower_components",
  "jspm_packages",
  ".stryker-tmp",
  ".serverless",
  ".docusaurus",
  // Python bytecode, virtualenvs, tool caches, and coverage reports
  "__pycache__",
  "venv",
  ".venv",
  ".tox",
  ".nox",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".pyre",
  ".pytype",
  "htmlcov",
  ".eggs",
  ".hypothesis",
  ".ipynb_checkpoints",
  "__pypackages__",
  ".pixi",
  "cover",
  // Test reports and artifacts (Playwright, Allure, TestNG, Newman, Cucumber,
  // common CI layout)
  "test-results",
  "test-reports",
  "playwright-report",
  "blob-report",
  "allure-results",
  "allure-report",
  "test-output",
  "newman",
  "cucumber-report",
  "cucumber-reports",
  // JVM and Rust build output, Gradle cache, IDE metadata
  "target",
  ".gradle",
  ".idea",
  // Vendored dependencies (Go modules, Ruby bundler, PHP Composer)
  "vendor",
  // Swift/Apple toolchain output and dependencies
  ".build",
  "Pods",
  "Carthage",
  "DerivedData",
  // Dart/Flutter tooling cache
  ".dart_tool",
  // Ruby/general scratch space and bundler config
  "tmp",
  ".bundle",
  // Editor metadata
  ".vscode",
]);


export function normalizeRelative(root: string, filePath: string) {
  return (path.relative(root, filePath) || ".").replaceAll(path.sep, "/");
}

export function lineNumberAt(text: string, index: number) {
  return text.slice(0, index).split("\n").length;
}

export function readTextIfExists(filePath: string) {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
}

export function stripQuotedStrings(text: string) {
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

export function hasGraceMarkers(text: string) {
  const searchable = stripQuotedStrings(text);
  return searchable
    .split("\n")
    .some((line) => /^(\s*)(\/\/|#|--|;+|\*)\s*(START_MODULE_CONTRACT|START_MODULE_MAP|START_CONTRACT:|START_BLOCK_|START_CHANGE_SUMMARY)/.test(line));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCommentOnlyLine(line: string) {
  return /^\s*(\/\/|#|--|;+|\*)/.test(line);
}

/**
 * Case-insensitive, with the printf/context suffixes those ecosystems use,
 * because Go, Java, and C# capitalise logger methods: `.Info(`, `.InfoContext(`,
 * `.Errorf(`. A lowercase-only pattern recognises no emission there at all.
 *
 * `severe` is java.util.logging's error level, and the `log*` names are C#
 * ILogger's (`LogWarning`, `LogInformation`). Without them those two only match
 * when the receiver happens to be called `logger`, which is not a guarantee.
 */
function looksLikeEvidenceEmission(line: string) {
  return /(console\.|logger\.|tracer\.|trace\s*\(|emit\s*\(|\.(?:info|warn(?:ing)?|error|debug|trace|severe|log(?:information|warning|error|debug|trace|critical))(?:f|w|ln)?(?:context)?\s*\()/i.test(
    line,
  );
}

/** Extracts the semantic block name encoded at the end of a required log marker. */
export function parseMarkerBlockName(marker: string) {
  const match = marker.match(/\[([^\]]+)\]\s*$/);
  return match?.[1]?.startsWith("BLOCK_") ? match[1].slice("BLOCK_".length) : undefined;
}

/**
 * Returns true when a required marker is emitted directly, through a same-file
 * identifier assigned to that exact marker, or assembled from an identifier
 * holding a PREFIX of it concatenated with the remainder. Identifier-aware
 * boundaries keep names such as marker$ distinct from marker$Other.
 */
export function hasRuntimeMarkerEvidence(text: string, marker: string) {
  const lines = text.split("\n");
  if (lines.some((line) => !isCommentOnlyLine(line) && line.includes(marker) && looksLikeEvidenceEmission(line))) {
    return true;
  }

  const identifiers = new Set<string>();
  for (const line of lines) {
    if (isCommentOnlyLine(line)) {
      continue;
    }
    for (const quote of ['"', "'", "`"]) {
      const assignmentPattern = new RegExp(
        `([A-Za-z_$][A-Za-z0-9_$]*)\\s*(?::[^=\\n]+)?=\\s*${escapeRegExp(`${quote}${marker}${quote}`)}`,
        "g",
      );
      for (const match of line.matchAll(assignmentPattern)) {
        identifiers.add(match[1]!);
      }
    }
  }

  if (
    [...identifiers].some((identifier) => {
      // `.` is in the lookbehind so `obj.logger` is not read as a use of a
      // constant named `logger`. Broadening the emission match to capitalised
      // methods makes that reachable: `const logger = "<marker>"` plus an
      // unrelated `obj.logger.Info(...)` would otherwise credit the marker.
      const identifierUse = new RegExp(`(?<![A-Za-z0-9_$.])${escapeRegExp(identifier)}(?![A-Za-z0-9_$])`);
      return lines.some((line) => !isCommentOnlyLine(line) && looksLikeEvidenceEmission(line) && identifierUse.test(line));
    })
  ) {
    return true;
  }

  return hasConcatenatedMarkerEvidence(lines, marker);
}

/**
 * Credits `logModule+"[fn][BLOCK_X]"`, where the whole marker is neither on the
 * line nor bound to an identifier. Each binding gives one way the marker could
 * split: its value must prefix the marker, the remainder must be on the line.
 */
function hasConcatenatedMarkerEvidence(lines: string[], marker: string) {
  const constants = new Map<string, Set<string>>();
  // The name must open the line, follow a declaration keyword, or follow `( , ;`.
  // Allowing any whitespace before it let Go's `var prefix string = "..."` bind
  // the TYPE token: `:?=` fails at `string`, the engine re-scans, and `string`
  // becomes the name. A line using that token for anything else - `string(body)` -
  // then credits a marker nothing emitted.
  const binding =
    /(?:^\s*|[(,;]\s*|\b(?:const|let|var|final|static)\s+)([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::[^=\n]+?)?:?=\s*(["'`])((?:\\.|(?!\2)[^\\])*)\2/g;

  for (const line of lines) {
    if (isCommentOnlyLine(line)) {
      continue;
    }
    for (const match of line.matchAll(binding)) {
      const name = match[1]!;
      if (!constants.has(name)) {
        constants.set(name, new Set());
      }
      constants.get(name)!.add(match[3]!);
    }
  }

  // The lookbehind on `.` keeps `d.log` from counting as a use of `log`.
  const boundary = (name: string) => `(?<![A-Za-z0-9_$.])${escapeRegExp(name)}(?![A-Za-z0-9_$])`;

  const splits: RegExp[] = [];
  for (const [name, values] of constants) {
    for (const value of values) {
      if (!marker.startsWith(value)) {
        continue;
      }
      const remainder = marker.slice(value.length);
      if (remainder === "") {
        // The binding already holds the whole marker; using it is the emission.
        splits.push(new RegExp(boundary(name)));
        continue;
      }
      // The remainder must ADJOIN the identifier, not merely share the line with
      // it. Checking both appear anywhere credits `log("… " + p + " … <tail>")`,
      // where nothing ever assembles the marker - a false pass on a gate whose
      // whole job is to prove the marker is emitted.
      splits.push(
        new RegExp(`(?:${boundary(name)}\\s*\\+\\s*["'\`]|\\$\\{\\s*${escapeRegExp(name)}\\s*\\})${escapeRegExp(remainder)}`),
      );
    }
  }

  if (splits.length === 0) {
    return false;
  }

  return lines.some(
    (line) => !isCommentOnlyLine(line) && looksLikeEvidenceEmission(line) && splits.some((split) => split.test(line)),
  );
}

/** Notified when a directory cannot be listed during a project walk. */
export type UnreadableDirectoryHandler = (directory: string, error: unknown) => void;

/** Stable, diagnosable message for a directory that could not be listed. */
export function describeUnreadableDirectory(directory: string, error: unknown): string {
  const code = error !== null && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : "unknown";
  return `Directory '${directory}' could not be listed (${code}); its contents were not checked.`;
}

export function collectCodeFiles(
  root: string,
  ignoredDirs: string[],
  currentDir = root,
  onUnreadableDirectory?: UnreadableDirectoryHandler,
): string[] {
  const files: string[] = [];
  const ignoredDirSet = new Set([...DEFAULT_IGNORED_DIRS, ...ignoredDirs]);
  let entries: Dirent[];
  try {
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch (error) {
    // An unreadable directory (EACCES/EPERM, sandbox leftovers, chmod 000) must
    // not abort the whole walk: skip it and let the caller surface a warning.
    onUnreadableDirectory?.(currentDir, error);
    return files;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirSet.has(entry.name)) {
        continue;
      }

      files.push(...collectCodeFiles(root, ignoredDirs, path.join(currentDir, entry.name), onUnreadableDirectory));
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

export function stripCommentPrefix(line: string) {
  return line.replace(/^\s*(\/\/|#|--|;+|\*)?\s*/, "");
}

export function findSection(text: string, startMarker: string, endMarker: string) {
  const lines = text.split("\n");
  const startIndex = lines.findIndex((line) => stripCommentPrefix(line).trim() === startMarker);
  if (startIndex < 0) {
    return null;
  }
  const relativeEnd = lines.slice(startIndex + 1).findIndex((line) => stripCommentPrefix(line).trim() === endMarker);
  if (relativeEnd < 0) {
    return null;
  }
  const endIndex = startIndex + 1 + relativeEnd;

  return {
    content: lines.slice(startIndex + 1, endIndex).join("\n"),
    startLine: startIndex + 1,
    endLine: endIndex + 1,
  } satisfies TextSection;
}

/** Parses MODULE_CONTRACT, MODULE_MAP, CHANGE_SUMMARY, scoped contracts, and semantic blocks. */
export function parseGovernedFile(root: string, filePath: string, text: string): FileMarkupRecord {
  const moduleContract = parseFieldSection(findSection(text, "START_MODULE_CONTRACT", "END_MODULE_CONTRACT"));
  return {
    path: normalizeRelative(root, filePath),
    moduleContract,
    moduleMap: parseListSection(findSection(text, "START_MODULE_MAP", "END_MODULE_MAP")),
    changeSummary: parseFieldSection(findSection(text, "START_CHANGE_SUMMARY", "END_CHANGE_SUMMARY")),
    contracts: parseScopedFieldSections(text),
    blocks: parseBlocks(text),
    linkedModuleIds: splitList(moduleContract?.fields.LINKS).filter((item) => /^M-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(item)),
  };
}

/** Validates structural markup, module-map semantics, and adapter-backed language analysis. */
export function analyzeGovernedFile(root: string, filePath: string, text: string): GovernedFileAnalysis {
  const record = parseGovernedFile(root, filePath, text);
  const issues = validateMarkerStructure(filePath, text);
  const contract = record.moduleContract;
  if (!contract) {
    issues.push(markupIssue("error", "markup.missing-module-contract", filePath, 1, "Governed files require one MODULE_CONTRACT section."));
  } else {
    for (const field of ["PURPOSE", "SCOPE", "DEPENDS", "LINKS"]) {
      if (!contract.fields[field]?.trim()) {
        issues.push(markupIssue("error", "markup.missing-contract-field", filePath, contract.startLine, `MODULE_CONTRACT requires non-empty ${field}.`));
      }
    }
    issues.push(...validateDuplicateContractFields(filePath, text, contract.startLine));
  }

  const role = parseRole(contract?.fields.ROLE);
  const mapMode = parseMapMode(contract?.fields.MAP_MODE);
  if (contract?.fields.ROLE && !role) {
    issues.push(markupIssue("error", "markup.invalid-role", filePath, contract.startLine, `Unsupported ROLE '${contract.fields.ROLE}'.`));
  }
  if (contract?.fields.MAP_MODE && !mapMode) {
    issues.push(markupIssue("error", "markup.invalid-map-mode", filePath, contract.startLine, `Unsupported MAP_MODE '${contract.fields.MAP_MODE}'.`));
  }

  const effectiveRole = role ?? inferRole(filePath);
  const effectiveMapMode = mapMode ?? defaultMapMode(effectiveRole);
  if (role && mapMode && defaultMapMode(role) !== mapMode) {
    issues.push(markupIssue("error", "markup.role-map-mode-mismatch", filePath, contract?.startLine ?? 1, `${role} files require MAP_MODE ${defaultMapMode(role)}, not ${mapMode}.`));
  }
  validateMapShape(filePath, record, effectiveMapMode, issues);

  const adapter = ADAPTER_BACKED_EXTENSIONS.has(path.extname(filePath))
    ? LANGUAGE_ADAPTERS.find((candidate) => candidate.supports(filePath))
    : undefined;
  let language: LanguageAnalysis | null = null;
  if (adapter) {
    try {
      // Successful analyses are content-cached across runs; failures stay
      // uncached so environment fixes take effect immediately.
      const cached = readCachedAnalysis(adapter.id, filePath, text);
      if (cached) {
        language = cached;
      } else {
        language = adapter.analyze(filePath, text);
        writeCachedAnalysis(adapter.id, filePath, text, language);
      }
    } catch (error) {
      issues.push(markupIssue(
        "error",
        error instanceof LanguageRuntimeMissingError ? "analysis.runtime-missing" : "analysis.adapter-failed",
        filePath,
        1,
        error instanceof Error ? error.message : String(error),
      ));
    }
  }

  if (language) {
    if (language.exportConfidence === "heuristic") {
      issues.push(markupIssue("warning", "analysis.heuristic-confidence", filePath, contract?.startLine ?? 1, `${language.adapterId} analysis is heuristic and cannot prove exact MODULE_MAP parity.`));
    }
    validateMapParity(filePath, record, effectiveMapMode, language, issues);
  }

  return { record, language, issues };
}

function parseFieldSection(section: TextSection | null): FileFieldSection | null {
  if (!section) {
    return null;
  }
  const fields: Record<string, string> = {};
  for (const line of section.content.split("\n")) {
    const match = stripCommentPrefix(line).trim().match(/^([A-Z_]+):\s*(.*)$/);
    if (match) {
      fields[match[1]!] = match[2]!.trim();
    }
  }
  return { fields, startLine: section.startLine, endLine: section.endLine };
}

function parseListSection(section: TextSection | null): FileListItem[] {
  if (!section) {
    return [];
  }
  return section.content.split("\n")
    .map((line, index) => {
      const label = stripCommentPrefix(line).trim();
      const symbolName = label.match(/^(?:[-*]\s*)?((?:[$_]|\p{ID_Start})(?:[$_]|\p{ID_Continue})*|default)(?=\s|$)/u)?.[1];
      return { label, symbolName, line: section.startLine + index };
    })
    .filter((item) => item.label.length > 0);
}

function parseScopedFieldSections(text: string): FileContractRecord[] {
  const sections: FileContractRecord[] = [];
  const lines = text.split("\n");
  for (let startIndex = 0; startIndex < lines.length; startIndex += 1) {
    const start = stripCommentPrefix(lines[startIndex]!).trim().match(/^START_CONTRACT:\s*([A-Za-z0-9_$.-]+)$/);
    if (!start) {
      continue;
    }
    const name = start[1]!;
    const relativeEnd = lines.slice(startIndex + 1).findIndex((line) => stripCommentPrefix(line).trim() === `END_CONTRACT: ${name}`);
    if (relativeEnd < 0) {
      continue;
    }
    const endIndex = startIndex + 1 + relativeEnd;
    const parsed = parseFieldSection({
      content: lines.slice(startIndex + 1, endIndex).join("\n"),
      startLine: startIndex + 1,
      endLine: endIndex + 1,
    });
    sections.push({
      name,
      fields: parsed?.fields ?? {},
      startLine: startIndex + 1,
      endLine: endIndex + 1,
    });
    startIndex = endIndex;
  }
  return sections;
}

function parseBlocks(text: string): FileBlockRecord[] {
  const blocks: FileBlockRecord[] = [];
  const openBlocks: Array<{ name: string; startLine: number }> = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const marker = stripCommentPrefix(lines[index]!).trim();
    const start = marker.match(/^START_BLOCK_([A-Z0-9_]+)$/);
    if (start?.[1]) {
      openBlocks.push({ name: start[1], startLine: index + 1 });
      continue;
    }

    const end = marker.match(/^END_BLOCK_([A-Z0-9_]+)$/);
    const open = openBlocks.at(-1);
    if (!end?.[1] || !open || open.name !== end[1]) {
      continue;
    }

    openBlocks.pop();
    blocks.push({ name: open.name, startLine: open.startLine, endLine: index + 1 });
  }
  return blocks.sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
}

function splitList(text?: string): string[] {
  const authored = (text ?? "").trim();
  const normalized = authored.startsWith("[") && authored.endsWith("]")
    ? authored.slice(1, -1).trim()
    : authored;
  return normalized.split(",").map((item) => item.trim()).filter((item) => item && item.toLowerCase() !== "none");
}

type MarkerEvent = { direction: "start" | "end"; family: string; name: string; key: string; line: number };

function validateMarkerStructure(file: string, text: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const completed = new Set<string>();
  const openMarkers: MarkerEvent[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const event = parseMarkerEvent(stripCommentPrefix(lines[index]!).trim(), index + 1);
    if (!event) {
      continue;
    }
    if (event.direction === "start") {
      const open = openMarkers.at(-1);
      if (openMarkers.some((marker) => marker.key === event.key)) {
        if (open) {
          issues.push(markupIssue("error", "markup.overlapping-markers", file, event.line, `${event.key} starts before ${open.key} ends.`));
        }
        issues.push(markupIssue("error", "markup.duplicate-marker", file, event.line, `${event.key} has a duplicate start marker.`));
        continue;
      }
      if (open && !(open.family === "block" && event.family === "block")) {
        issues.push(markupIssue("error", "markup.overlapping-markers", file, event.line, `${event.key} starts before ${open.key} ends.`));
        if (open.key === event.key) {
          issues.push(markupIssue("error", "markup.duplicate-marker", file, event.line, `${event.key} has a duplicate start marker.`));
        }
        continue;
      }
      if (completed.has(event.key)) {
        issues.push(markupIssue("error", "markup.duplicate-marker", file, event.line, `${event.key} is declared more than once.`));
      }
      openMarkers.push(event);
      continue;
    }
    const open = openMarkers.at(-1);
    if (!open) {
      issues.push(markupIssue("error", "markup.reversed-marker", file, event.line, `${event.key} ends without a preceding matching start marker.`));
      continue;
    }
    if (open.key !== event.key) {
      issues.push(markupIssue("error", "markup.mismatched-marker", file, event.line, `${event.key} does not match open marker ${open.key}.`));
      continue;
    }
    completed.add(event.key);
    openMarkers.pop();
  }
  for (const open of openMarkers) {
    issues.push(markupIssue("error", "markup.missing-end-marker", file, open.line, `${open.key} is missing its end marker.`));
  }
  return issues;
}

function parseMarkerEvent(line: string, lineNumber: number): MarkerEvent | null {
  const fixed = [
    ["START_MODULE_CONTRACT", "start", "module-contract"],
    ["END_MODULE_CONTRACT", "end", "module-contract"],
    ["START_MODULE_MAP", "start", "module-map"],
    ["END_MODULE_MAP", "end", "module-map"],
    ["START_CHANGE_SUMMARY", "start", "change-summary"],
    ["END_CHANGE_SUMMARY", "end", "change-summary"],
  ] as const;
  for (const [marker, direction, family] of fixed) {
    if (line === marker) {
      return { direction, family, name: family, key: family, line: lineNumber };
    }
  }
  const contract = line.match(/^(START|END)_CONTRACT:\s*([A-Za-z0-9_$.-]+)$/);
  if (contract) {
    return { direction: contract[1] === "START" ? "start" : "end", family: "contract", name: contract[2]!, key: `contract:${contract[2]}`, line: lineNumber };
  }
  const block = line.match(/^(START|END)_BLOCK_([A-Z0-9_]+)$/);
  if (block) {
    return { direction: block[1] === "START" ? "start" : "end", family: "block", name: block[2]!, key: `block:${block[2]}`, line: lineNumber };
  }
  return null;
}

function validateDuplicateContractFields(file: string, text: string, startLine: number): LintIssue[] {
  const section = findSection(text, "START_MODULE_CONTRACT", "END_MODULE_CONTRACT");
  if (!section) {
    return [];
  }
  const seen = new Set<string>();
  const issues: LintIssue[] = [];
  section.content.split("\n").forEach((line, index) => {
    const field = stripCommentPrefix(line).trim().match(/^([A-Z_]+):/)?.[1];
    if (!field) {
      return;
    }
    if (seen.has(field)) {
      issues.push(markupIssue("error", "markup.duplicate-contract-field", file, startLine + index, `MODULE_CONTRACT repeats ${field}.`));
    }
    seen.add(field);
  });
  return issues;
}

function parseRole(value?: string): ModuleRole | undefined {
  return (["RUNTIME", "TEST", "BARREL", "CONFIG", "TYPES", "SCRIPT"] as const).find((role) => role === value?.trim().toUpperCase());
}

function parseMapMode(value?: string): MapMode | undefined {
  return (["EXPORTS", "LOCALS", "SUMMARY", "NONE"] as const).find((mode) => mode === value?.trim().toUpperCase());
}

function inferRole(filePath: string): ModuleRole {
  const normalized = filePath.replaceAll("\\", "/");
  if (/(^|\/)(?:__tests__|tests)(\/|$)|\.(?:test|spec)\.[^.]+$/.test(normalized)) {
    return "TEST";
  }
  return "RUNTIME";
}

function defaultMapMode(role: ModuleRole): MapMode {
  return ({ RUNTIME: "EXPORTS", TEST: "LOCALS", BARREL: "SUMMARY", CONFIG: "NONE", TYPES: "EXPORTS", SCRIPT: "LOCALS" } as const)[role];
}

function validateMapShape(file: string, record: FileMarkupRecord, mapMode: MapMode, issues: LintIssue[]): void {
  if (mapMode === "NONE" && record.moduleMap.length > 0) {
    issues.push(markupIssue("error", "markup.module-map-forbidden", file, record.moduleMap[0]!.line, "MAP_MODE NONE requires an empty or omitted MODULE_MAP."));
  } else if (mapMode !== "NONE" && record.moduleMap.length === 0) {
    issues.push(markupIssue("error", "markup.module-map-missing", file, record.moduleContract?.startLine ?? 1, `MAP_MODE ${mapMode} requires a non-empty MODULE_MAP.`));
  }
  if (mapMode === "SUMMARY") {
    for (const item of record.moduleMap) {
      if (!/(?:\s+-\s+|:\s+)\S/.test(item.label)) {
        issues.push(markupIssue("error", "markup.summary-item-undescribed", file, item.line, `SUMMARY item '${item.label}' requires a description.`));
      }
    }
  }
}

function validateMapParity(file: string, record: FileMarkupRecord, mapMode: MapMode, language: LanguageAnalysis, issues: LintIssue[]): void {
  if (mapMode !== "EXPORTS" && mapMode !== "LOCALS") {
    return;
  }
  const expected = mapMode === "EXPORTS" ? language.exports : language.localSymbols;
  const listed = new Set(record.moduleMap.map((item) => item.symbolName).filter((symbol): symbol is string => Boolean(symbol)));
  const missing = [...expected].filter((symbol) => !listed.has(symbol)).sort();
  const extra = [...listed].filter((symbol) => !expected.has(symbol)).sort();
  if (missing.length === 0 && extra.length === 0) {
    return;
  }
  const severity = language.exportConfidence === "exact" ? "error" : "warning";
  issues.push(markupIssue(
    severity,
    language.exportConfidence === "exact" ? "markup.module-map-mismatch" : "analysis.heuristic-map-mismatch",
    file,
    record.moduleMap[0]?.line ?? record.moduleContract?.startLine ?? 1,
    `MODULE_MAP ${mapMode} mismatch. Missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}.`,
  ));
}

function markupIssue(severity: LintIssue["severity"], code: string, file: string, line: number, message: string): LintIssue {
  return { severity, code, file, line, message };
}
