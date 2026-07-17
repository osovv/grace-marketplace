import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ADAPTER_BACKED_EXTENSIONS, CODE_EXTENSIONS, LANGUAGE_ADAPTERS } from "./language-registry";
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

const DEFAULT_IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
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

export function collectCodeFiles(root: string, ignoredDirs: string[], currentDir = root): string[] {
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
      language = adapter.analyze(filePath, text);
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
      const symbolName = label.match(/^(?:[-*]\s*)?([A-Za-z_$][\w$]*|default)\b/)?.[1];
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
  const lines = text.split("\n");
  for (let startIndex = 0; startIndex < lines.length; startIndex += 1) {
    const start = stripCommentPrefix(lines[startIndex]!).trim().match(/^START_BLOCK_([A-Z0-9_]+)$/);
    if (!start) {
      continue;
    }
    const name = start[1]!;
    const relativeEnd = lines.slice(startIndex + 1).findIndex((line) => stripCommentPrefix(line).trim() === `END_BLOCK_${name}`);
    if (relativeEnd < 0) {
      continue;
    }
    const endIndex = startIndex + 1 + relativeEnd;
    blocks.push({ name, startLine: startIndex + 1, endLine: endIndex + 1 });
    startIndex = endIndex;
  }
  return blocks;
}

function splitList(text?: string): string[] {
  return (text ?? "").split(",").map((item) => item.trim()).filter((item) => item && item.toLowerCase() !== "none");
}

type MarkerEvent = { direction: "start" | "end"; family: string; name: string; key: string; line: number };

function validateMarkerStructure(file: string, text: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const completed = new Set<string>();
  let open: MarkerEvent | null = null;
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const event = parseMarkerEvent(stripCommentPrefix(lines[index]!).trim(), index + 1);
    if (!event) {
      continue;
    }
    if (event.direction === "start") {
      if (open) {
        issues.push(markupIssue("error", "markup.overlapping-markers", file, event.line, `${event.key} starts before ${open.key} ends.`));
        if (open.key === event.key) {
          issues.push(markupIssue("error", "markup.duplicate-marker", file, event.line, `${event.key} has a duplicate start marker.`));
        }
        continue;
      }
      if (completed.has(event.key)) {
        issues.push(markupIssue("error", "markup.duplicate-marker", file, event.line, `${event.key} is declared more than once.`));
      }
      open = event;
      continue;
    }
    if (!open) {
      issues.push(markupIssue("error", "markup.reversed-marker", file, event.line, `${event.key} ends without a preceding matching start marker.`));
      continue;
    }
    if (open.key !== event.key) {
      issues.push(markupIssue("error", "markup.mismatched-marker", file, event.line, `${event.key} does not match open marker ${open.key}.`));
      open = null;
      continue;
    }
    completed.add(event.key);
    open = null;
  }
  if (open) {
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
