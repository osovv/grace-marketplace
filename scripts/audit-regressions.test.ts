import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

type AuditRegressionCase = {
  id: string;
  testFile: string;
  evidence: string;
  platforms: readonly ("linux" | "windows" | "macos")[];
};

const repoRoot = path.resolve(import.meta.dir, "..");
const allPlatforms = ["linux", "windows", "macos"] as const;

const AUDIT_REGRESSION_CASES: readonly AuditRegressionCase[] = [
  { id: "malformed-anchor", testFile: "src/grace4/grammar.test.ts", evidence: "artifact.malformed-semantic-anchor", platforms: allPlatforms },
  { id: "anchor-attributes", testFile: "src/grace4/grammar.test.ts", evidence: "artifact.semantic-anchor-has-attributes", platforms: allPlatforms },
  { id: "empty-change-contract", testFile: "src/grace4/grammar.test.ts", evidence: "change.empty-section", platforms: allPlatforms },
  { id: "invalid-task-dag", testFile: "src/grace4/grammar.test.ts", evidence: "change.task-dependency-cycle", platforms: allPlatforms },
  { id: "path-traversal", testFile: "src/grace4/paths.test.ts", evidence: "path.traversal", platforms: allPlatforms },
  { id: "symlink-escape", testFile: "src/grace4/paths.test.ts", evidence: "path.symlink-escape", platforms: allPlatforms },
  { id: "assertion-arity", testFile: "src/grace4/assertions.test.ts", evidence: "assertion.invalid-shape", platforms: allPlatforms },
  { id: "command-not-evaluated", testFile: "src/grace4/assertions.test.ts", evidence: "assertion.command-not-evaluated", platforms: allPlatforms },
  { id: "final-lifecycle-validation", testFile: "src/grace-lint.test.ts", evidence: "final assertion mode", platforms: allPlatforms },
  { id: "single-quote-approved-status", testFile: "src/grace-lint.test.ts", evidence: "attribute quote style", platforms: allPlatforms },
  { id: "duplicate-owns", testFile: "src/grace4/projections.test.ts", evidence: "projection.graph.duplicate-route", platforms: allPlatforms },
  { id: "exact-evidence-tags", testFile: "src/grace4/projections.test.ts", evidence: "excludes naked <File> siblings", platforms: allPlatforms },
  { id: "document-anchor-overlap", testFile: "src/grace4/scope.test.ts", evidence: "expands durable document ownership", platforms: allPlatforms },
  { id: "known-disjoint-document-anchor", testFile: "src/grace4/scope.test.ts", evidence: "anchors owned by another known document", platforms: allPlatforms },
  { id: "disjoint-extension-globs", testFile: "src/grace4/scope.test.ts", evidence: "differing extension globs disjoint", platforms: allPlatforms },
  { id: "windows-case-collision", testFile: "src/grace4/scope.test.ts", evidence: "case-insensitive collision semantics on Windows", platforms: ["windows"] },
  { id: "invalid-navigation-root", testFile: "src/grace-query.test.ts", evidence: "fails closed before returning records", platforms: allPlatforms },
  { id: "invalid-navigation-operational-contract", testFile: "src/grace-query.test.ts", evidence: "active assertion or scope contracts are invalid", platforms: allPlatforms },
  { id: "structured-json-error", testFile: "src/grace-query.test.ts", evidence: "ok: false", platforms: allPlatforms },
  { id: "structured-lint-error", testFile: "src/grace-lint.test.ts", evidence: "invalid options and missing project paths", platforms: allPlatforms },
  { id: "structured-status-error", testFile: "src/grace-status.test.ts", evidence: "invalid options and missing paths", platforms: allPlatforms },
  { id: "grace3-validation-isolation", testFile: "src/grace-lint.test.ts", evidence: "project.grace3-detected", platforms: allPlatforms },
  { id: "stale-not-ready", testFile: "src/grace-status.test.ts", evidence: "stale-plan", platforms: allPlatforms },
  { id: "route-aware-drift", testFile: "src/grace-status.test.ts", evidence: "exact declared document or owning anchor route", platforms: allPlatforms },
  { id: "index-drift-attribution", testFile: "src/grace-status.test.ts", evidence: "graph index drift", platforms: allPlatforms },
  { id: "approved-contract-drift", testFile: "src/grace-status.test.ts", evidence: "approved contract drift", platforms: allPlatforms },
  { id: "untracked-approved-bundle", testFile: "src/grace-status.test.ts", evidence: "newly created untracked approved bundle", platforms: allPlatforms },
  { id: "empty-context-artifact", testFile: "src/grace4/grammar.test.ts", evidence: "empty context artifacts", platforms: allPlatforms },
  { id: "design-context-identity", testFile: "src/grace4/grammar.test.ts", evidence: "canonical design-context identity", platforms: allPlatforms },
  { id: "python-unicode", testFile: "src/lint/adapters/python.test.ts", evidence: "UTF-8", platforms: allPlatforms },
  { id: "python-unicode-module-map", testFile: "src/project-utils.test.ts", evidence: "Unicode identifiers in exact Python MODULE_MAP parity", platforms: allPlatforms },
  { id: "typescript-namespace-export", testFile: "src/lint/adapters/typescript.test.ts", evidence: "namespace re-export names exactly", platforms: allPlatforms },
  { id: "dart-valid-invocation", testFile: "src/lint/adapters/dart.test.ts", evidence: "temporary analyzer file", platforms: allPlatforms },
  { id: "adapter-runtime-missing", testFile: "src/project-utils.test.ts", evidence: "analysis.runtime-missing", platforms: allPlatforms },
  { id: "approved-plan-immutability", testFile: "scripts/skill-contracts.test.ts", evidence: "approved_plan_immutability", platforms: allPlatforms },
  { id: "migration-cleanup-gates", testFile: "scripts/skill-contracts.test.ts", evidence: "git availability/worktree inspection", platforms: allPlatforms },
  { id: "stable-release-ancestry", testFile: "scripts/release-bump.test.ts", evidence: "release PR branch based on current origin/main", platforms: allPlatforms },
  { id: "stable-release-finalization", testFile: "scripts/release-finalize.test.ts", evidence: "clean synchronized main", platforms: allPlatforms },
  { id: "stable-release-protections", testFile: "scripts/release-check.test.ts", evidence: "protected stable environment, main branch, and v* tags", platforms: allPlatforms },
  { id: "windows-ci", testFile: ".github/workflows/validate.yml", evidence: "windows-compatibility", platforms: ["windows"] },
  { id: "real-dart-ci", testFile: ".github/workflows/validate.yml", evidence: "dart-lang/setup-dart", platforms: ["linux"] },
];

describe("Critical, High, and Medium audit regression matrix", () => {
  for (const regression of AUDIT_REGRESSION_CASES) {
    it(`${regression.id} maps to deterministic regression evidence`, () => {
      const content = readFileSync(path.join(repoRoot, regression.testFile), "utf8");
      expect(content).toContain(regression.evidence);
      expect(regression.platforms.length).toBeGreaterThan(0);
    });
  }

  it("keeps Windows-only coverage conditional while retaining portable case tests", () => {
    const scopeTests = readFileSync(path.join(repoRoot, "src/grace4/scope.test.ts"), "utf8");
    expect(scopeTests).toContain('process.platform === "win32" ? it : it.skip');
    expect(scopeTests).toContain("normalizes backslashes and follows explicit case semantics");
  });
});
