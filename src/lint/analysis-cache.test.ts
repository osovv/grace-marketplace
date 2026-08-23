import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { analyzeGovernedFile } from "../project-utils";
import { ANALYSIS_CACHE_SCHEMA_VERSION, analysisCacheKey, readCachedAnalysis, writeCachedAnalysis } from "./analysis-cache";
import type { LanguageAnalysis } from "./types";

function sampleAnalysis(overrides: Partial<LanguageAnalysis> = {}): LanguageAnalysis {
  return {
    adapterId: "typescript",
    exports: new Set(["value", "ExampleType"]),
    valueExports: new Set(["value"]),
    typeExports: new Set(["ExampleType"]),
    localSymbols: new Set(["helper"]),
    exportConfidence: "exact",
    hasDefaultExport: false,
    hasWildcardReExport: false,
    hasMainEntrypoint: false,
    directReExportCount: 1,
    localExportCount: 2,
    localImplementationCount: 3,
    usesTestFramework: false,
    ...overrides,
  };
}

function listFilesRecursively(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
  });
}

describe("analysis cache", () => {
  let cacheDir: string;
  let savedCacheDir: string | undefined;
  let savedNoCache: string | undefined;

  beforeEach(() => {
    cacheDir = mkdtempSync(path.join(os.tmpdir(), "grace-cache-"));
    savedCacheDir = process.env.GRACE_CACHE_DIR;
    savedNoCache = process.env.GRACE_NO_CACHE;
    delete process.env.GRACE_NO_CACHE;
    process.env.GRACE_CACHE_DIR = cacheDir;
  });

  afterEach(() => {
    if (savedCacheDir === undefined) delete process.env.GRACE_CACHE_DIR;
    else process.env.GRACE_CACHE_DIR = savedCacheDir;
    if (savedNoCache === undefined) delete process.env.GRACE_NO_CACHE;
    else process.env.GRACE_NO_CACHE = savedNoCache;
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("round-trips a successful analysis through the cache", () => {
    const file = "/project/src/example.ts";
    const text = "export const value = 1;\n";
    expect(readCachedAnalysis("typescript", file, text)).toBeNull();

    writeCachedAnalysis("typescript", file, text, sampleAnalysis());
    const cached = readCachedAnalysis("typescript", file, text);

    expect(cached).not.toBeNull();
    expect(cached).toEqual(sampleAnalysis());
    expect([...(cached?.exports ?? [])]).toEqual(["value", "ExampleType"]);
  });

  it("keys by content and extension, not by path", () => {
    const text = "export const value = 1;\n";
    expect(analysisCacheKey("/a/src/example.ts", text)).toBe(analysisCacheKey("/b/elsewhere/example.ts", text));
    expect(analysisCacheKey("/a/src/example.ts", text)).not.toBe(analysisCacheKey("/a/src/example.js", text));
    expect(analysisCacheKey("/a/src/example.ts", text)).not.toBe(analysisCacheKey("/a/src/example.ts", `${text}// changed\n`));
  });

  it("treats schema version mismatches as misses", () => {
    const file = "/project/src/schema.ts";
    const text = "export const schema = true;\n";
    writeCachedAnalysis("typescript", file, text, sampleAnalysis());

    const key = analysisCacheKey(file, text);
    const entryPath = path.join(cacheDir, "analysis", key.slice(0, 2), `${key}.json`);
    const stored = JSON.parse(readFileSync(entryPath, "utf8"));
    expect(stored.schemaVersion).toBe(ANALYSIS_CACHE_SCHEMA_VERSION);
    writeFileSync(entryPath, JSON.stringify({ ...stored, schemaVersion: ANALYSIS_CACHE_SCHEMA_VERSION + 1 }));

    expect(readCachedAnalysis("typescript", file, text)).toBeNull();
  });

  it("treats adapter mismatches as misses", () => {
    const file = "/project/src/adapter.ts";
    const text = "export const adapter = true;\n";
    writeCachedAnalysis("typescript", file, text, sampleAnalysis());

    expect(readCachedAnalysis("python", file, text)).toBeNull();
    expect(readCachedAnalysis("typescript", file, text)).not.toBeNull();
  });

  it("treats corrupt entries as misses instead of failing", () => {
    const file = "/project/src/corrupt.ts";
    const text = "export const corrupt = true;\n";
    writeCachedAnalysis("typescript", file, text, sampleAnalysis());

    const key = analysisCacheKey(file, text);
    writeFileSync(path.join(cacheDir, "analysis", key.slice(0, 2), `${key}.json`), "not-json{{{");

    expect(readCachedAnalysis("typescript", file, text)).toBeNull();
  });

  it("does not read or write when GRACE_NO_CACHE is set", () => {
    process.env.GRACE_NO_CACHE = "1";
    const file = "/project/src/disabled.ts";
    const text = "export const disabled = true;\n";

    writeCachedAnalysis("typescript", file, text, sampleAnalysis());
    expect(readCachedAnalysis("typescript", file, text)).toBeNull();
    expect(listFilesRecursively(cacheDir)).toEqual([]);
  });

  it("caches governed-file analysis across repeated runs", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-cache-fixture-"));
    const file = path.join(root, "src", "example.ts");
    const text = `// START_MODULE_CONTRACT
// PURPOSE: Cache fixture.
// SCOPE: Test-only.
// DEPENDS: none
// LINKS: M-CACHE
// ROLE: RUNTIME
// MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
// START_MODULE_MAP
//   value - Runtime value.
// END_MODULE_MAP
export const value = 1;
`;
    try {
      const first = analyzeGovernedFile(root, file, text);
      const entries = listFilesRecursively(path.join(cacheDir, "analysis")).filter((entry) => entry.endsWith(".json"));
      expect(entries).toHaveLength(1);

      const second = analyzeGovernedFile(root, file, text);
      expect(second.language).toEqual(first.language);
      expect(second.language?.exportConfidence).toBe("exact");
      // The hit must not create another entry for the same content.
      expect(listFilesRecursively(path.join(cacheDir, "analysis")).filter((entry) => entry.endsWith(".json"))).toEqual(entries);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps unrelated cache files out of the governed project", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-cache-isolation-"));
    try {
      analyzeGovernedFile(root, path.join(root, "plain.ts"), "export const plain = 1;\n");
      const leftovers = listFilesRecursively(root).filter((entry) => entry.includes("cache"));
      expect(leftovers).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});