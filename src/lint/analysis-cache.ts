import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { LanguageAnalysis } from "./types";

/**
 * Bump whenever the cached shape or adapter analysis semantics change.
 * Entries written by a different schema version are treated as cache misses,
 * so logic changes invalidate the whole cache without any cleanup step.
 */
export const ANALYSIS_CACHE_SCHEMA_VERSION = 1;

type CachedAnalysisRecord = {
  schemaVersion: number;
  adapterId: string;
  analysis: {
    adapterId: string;
    exports: string[];
    valueExports: string[];
    typeExports: string[];
    localSymbols: string[];
    exportConfidence: "exact" | "heuristic";
    hasDefaultExport: boolean;
    hasWildcardReExport: boolean;
    hasMainEntrypoint: boolean;
    directReExportCount: number;
    localExportCount: number;
    localImplementationCount: number;
    usesTestFramework: boolean;
  };
};

/**
 * Resolves the analysis cache directory. `GRACE_CACHE_DIR` overrides the base
 * directory; otherwise `$XDG_CACHE_HOME/grace-cli` (falling back to
 * `~/.cache/grace-cli`) is used. Returns null when caching is disabled via
 * `GRACE_NO_CACHE`, which makes every read miss and every write a no-op.
 */
function resolveAnalysisCacheDir(): string | null {
  if (process.env.GRACE_NO_CACHE) {
    return null;
  }
  const override = process.env.GRACE_CACHE_DIR?.trim();
  const base = override && override.length > 0
    ? override
    : path.join(process.env.XDG_CACHE_HOME?.trim() || path.join(os.homedir(), ".cache"), "grace-cli");
  return path.join(base, "analysis");
}

/** Content-addressed key: file content plus extension, independent of path. */
export function analysisCacheKey(filePath: string, text: string): string {
  return createHash("sha256").update(`${path.extname(filePath)}\u0000${text}`).digest("hex");
}

function cacheEntryPath(cacheDir: string, key: string): string {
  return path.join(cacheDir, key.slice(0, 2), `${key}.json`);
}

function toCachedRecord(adapterId: string, analysis: LanguageAnalysis): CachedAnalysisRecord {
  return {
    schemaVersion: ANALYSIS_CACHE_SCHEMA_VERSION,
    adapterId,
    analysis: {
      adapterId: analysis.adapterId,
      exports: [...analysis.exports],
      valueExports: [...analysis.valueExports],
      typeExports: [...analysis.typeExports],
      localSymbols: [...analysis.localSymbols],
      exportConfidence: analysis.exportConfidence,
      hasDefaultExport: analysis.hasDefaultExport,
      hasWildcardReExport: analysis.hasWildcardReExport,
      hasMainEntrypoint: analysis.hasMainEntrypoint,
      directReExportCount: analysis.directReExportCount,
      localExportCount: analysis.localExportCount,
      localImplementationCount: analysis.localImplementationCount,
      usesTestFramework: analysis.usesTestFramework,
    },
  };
}

function fromCachedRecord(record: CachedAnalysisRecord["analysis"]): LanguageAnalysis {
  return {
    adapterId: record.adapterId,
    exports: new Set(record.exports ?? []),
    valueExports: new Set(record.valueExports ?? []),
    typeExports: new Set(record.typeExports ?? []),
    localSymbols: new Set(record.localSymbols ?? []),
    exportConfidence: record.exportConfidence ?? "heuristic",
    hasDefaultExport: Boolean(record.hasDefaultExport),
    hasWildcardReExport: Boolean(record.hasWildcardReExport),
    hasMainEntrypoint: Boolean(record.hasMainEntrypoint),
    directReExportCount: Number(record.directReExportCount ?? 0),
    localExportCount: Number(record.localExportCount ?? 0),
    localImplementationCount: Number(record.localImplementationCount ?? 0),
    usesTestFramework: Boolean(record.usesTestFramework),
  };
}

/**
 * Returns the cached analysis for this adapter/file/content, or null on a miss.
 * Any read, parse, schema, or adapter mismatch is a miss, never an error: the
 * cache is a speedup and must not be able to break linting.
 */
export function readCachedAnalysis(adapterId: string, filePath: string, text: string): LanguageAnalysis | null {
  const cacheDir = resolveAnalysisCacheDir();
  if (!cacheDir) {
    return null;
  }
  try {
    const raw = readFileSync(cacheEntryPath(cacheDir, analysisCacheKey(filePath, text)), "utf8");
    const parsed = JSON.parse(raw) as CachedAnalysisRecord;
    if (parsed.schemaVersion !== ANALYSIS_CACHE_SCHEMA_VERSION || parsed.adapterId !== adapterId) {
      return null;
    }
    return fromCachedRecord(parsed.analysis);
  } catch {
    return null;
  }
}

/**
 * Best-effort write of one successful analysis. Failures (permissions, disk,
 * concurrent runs) are swallowed; atomic rename keeps torn reads impossible.
 * Errors thrown by adapters must never reach this function, so environment
 * failures are not cached.
 */
export function writeCachedAnalysis(adapterId: string, filePath: string, text: string, analysis: LanguageAnalysis): void {
  const cacheDir = resolveAnalysisCacheDir();
  if (!cacheDir) {
    return;
  }
  try {
    const target = cacheEntryPath(cacheDir, analysisCacheKey(filePath, text));
    mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(toCachedRecord(adapterId, analysis)));
    renameSync(temporary, target);
  } catch {
    // The cache is an optimization; never fail linting because of it.
  }
}