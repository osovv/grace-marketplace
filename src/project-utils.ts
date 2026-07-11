import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { CODE_EXTENSIONS } from "./language-registry";

export type TextSection = {
  content: string;
  startLine: number;
  endLine: number;
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
  return path.relative(root, filePath) || ".";
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
  const startIndex = text.indexOf(startMarker);
  const endIndex = text.indexOf(endMarker);
  if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
    return null;
  }

  return {
    content: text.slice(startIndex + startMarker.length, endIndex),
    startLine: lineNumberAt(text, startIndex),
    endLine: lineNumberAt(text, endIndex),
  } satisfies TextSection;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function looksLikeEvidenceEmission(line: string) {
  return /(console\.|logger\.|tracer\.|trace\(|emit\(|\.(info|warn|error|debug|trace)\s*\()/.test(line);
}

function isEvidenceLine(line: string) {
  return !/^\s*(\/\/|#|--|;+|\*)/.test(line) && looksLikeEvidenceEmission(line);
}

// Finds a same-file identifier assigned exactly the marker string (e.g. `static let x = "[Module][fn][BLOCK_X]"`
// or `const x = "..."`), so a marker interpolated into a log call via that identifier can still be credited as
// real runtime evidence -- not just markers repeated as a literal at the call site.
function findConstantNameForMarker(text: string, marker: string) {
  const pattern = new RegExp(
    `([A-Za-z_$][A-Za-z0-9_$]*)\\s*(?::\\s*[^=\\n]+)?(?<![=!<>])=(?!=)\\s*(['"\`])${escapeRegExp(marker)}\\2`,
  );
  return text.match(pattern)?.[1];
}

// Shared by `grace lint`'s autonomy check and `grace module health`'s verification-entry check -- both decide
// whether a required log marker has genuine runtime evidence. Previously reimplemented independently in each
// caller, which let a fix land in one without the other; keep this as the single source of truth.
export function hasRuntimeMarkerEvidence(text: string, marker: string): boolean {
  const lines = text.split("\n");
  if (lines.some((line) => line.includes(marker) && isEvidenceLine(line))) {
    return true;
  }

  const constantName = findConstantNameForMarker(text, marker);
  if (!constantName) {
    return false;
  }
  const nameBoundary = new RegExp(`\\b${escapeRegExp(constantName)}\\b`);
  return lines.some((line) => nameBoundary.test(line) && isEvidenceLine(line));
}

export function parseMarkerBlockName(marker: string): string | undefined {
  const match = marker.match(/\[([^\]]+)\]\s*$/);
  if (!match) {
    return undefined;
  }

  return match[1].startsWith("BLOCK_") ? match[1].slice("BLOCK_".length) : undefined;
}
