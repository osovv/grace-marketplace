import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertTagTargetsCommit,
  calculateTargetVersion,
  collectStableReleasePreconditionErrors,
  isStableReleaseTarget,
  main,
  parseNpmVersionArgs,
  prependChangelogEntry,
  runReleasePreflight,
  updateVersionSurfaceFiles,
  type ReleasePreflightDependencies,
} from "./release-bump.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "grace-release-bump-"));
  tempRoots.push(root);
  return root;
}

function dependencies(overrides: Partial<ReleasePreflightDependencies> = {}): ReleasePreflightDependencies {
  return {
    readCurrentVersion: () => "4.0.0-rc.2",
    readChangelog: () => "## <small>4.0.0-rc.2 (2026-07-13)</small>\n",
    getStatus: () => "",
    getBranch: () => "main\n",
    tagExists: () => false,
    toolExists: () => true,
    fetchOriginMainAndTags: () => undefined,
    getHead: () => "abc123\n",
    getOriginMain: () => "abc123\n",
    runValidation: () => undefined,
    ...overrides,
  };
}

function write(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function writeReleaseFixture(root: string, version: string): void {
  write(root, "package.json", `${JSON.stringify({ name: "@osovv/grace-cli", version }, null, 2)}\n`);
  write(root, "README.md", `Current packaged version: \`${version}\`\n`);
  write(root, "openpackage.yml", `name: grace-marketplace\nversion: ${version}\n`);
  write(root, ".claude-plugin/marketplace.json", `${JSON.stringify({ metadata: { version }, plugins: [{ version }] }, null, 2)}\n`);
  write(root, "plugins/grace/.claude-plugin/plugin.json", `${JSON.stringify({ version }, null, 2)}\n`);
  write(root, "src/grace.ts", `const main = { meta: { name: "grace", version: "${version}" } };\n`);
  write(root, "CHANGELOG.md", `## <small>${version} (2026-07-13)</small>\n\n### Summary\n\nRelease ${version}.\n`);
}

describe("release argv and version resolution", () => {
  it("rejects invalid argv and returns nonzero through the script entrypoint", () => {
    expect(() => parseNpmVersionArgs([])).toThrow("Usage");
    expect(() => parseNpmVersionArgs(["patch", "--unknown"])).toThrow("Unsupported npm version option");
    expect(() => parseNpmVersionArgs(["prepatch", "--preid", ""])).toThrow("--preid requires");
    expect(main(["not-a-version"], tempRoot())).toBe(1);
  });

  it("predicts stable promotion and supported npm increments", () => {
    expect(calculateTargetVersion("4.0.0-rc.2", ["4.0.0"])).toBe("4.0.0");
    expect(calculateTargetVersion("1.2.3", ["patch"])).toBe("1.2.4");
    expect(calculateTargetVersion("1.2.3-rc.2", ["patch"])).toBe("1.2.3");
    expect(calculateTargetVersion("1.2.3", ["prepatch", "--preid", "rc"])).toBe("1.2.4-rc.0");
    expect(calculateTargetVersion("1.2.3-rc.2", ["prerelease"])).toBe("1.2.3-rc.3");
    expect(calculateTargetVersion("1.2.3-rc.2", ["premajor"])).toBe("2.0.0-0");
    expect(isStableReleaseTarget("4.0.0-rc.2", ["4.0.0"])).toBe(true);
    expect(isStableReleaseTarget("4.0.0-rc.2", ["prerelease"])).toBe(false);
  });
});

describe("release preflight", () => {
  it("rejects a dirty worktree before validation", () => {
    let validationRan = false;
    const deps = dependencies({
      getStatus: () => " M README.md\n",
      runValidation: () => { validationRan = true; },
    });
    expect(() => runReleasePreflight(["4.0.0"], deps)).toThrow("Worktree is dirty");
    expect(main(["4.0.0"], tempRoot(), deps)).toBe(1);
    expect(validationRan).toBe(false);
  });

  it("rejects an existing target tag", () => {
    const deps = dependencies({ tagExists: (tag) => tag === "v4.0.0" });
    expect(() => runReleasePreflight(["4.0.0"], deps)).toThrow("already exists");
    expect(main(["4.0.0"], tempRoot(), deps)).toBe(1);
  });

  it("rejects a missing release tool", () => {
    const deps = dependencies({ toolExists: (tool) => tool !== "opencode" });
    expect(() => runReleasePreflight(["4.0.0"], deps)).toThrow("opencode");
    expect(main(["4.0.0"], tempRoot(), deps)).toBe(1);
  });

  it("propagates validation failure without calling any mutating helper", () => {
    const root = tempRoot();
    const marker = path.join(root, "marker.txt");
    writeFileSync(marker, "unchanged");
    const deps = dependencies({
      runValidation: () => { throw new Error("preflight validation failed"); },
    });
    expect(() => runReleasePreflight(["4.0.0"], deps)).toThrow("preflight validation failed");
    expect(main(["4.0.0"], root, deps)).toBe(1);
    expect(readFileSync(marker, "utf8")).toBe("unchanged");
  });

  it("returns stable promotion metadata after all gates pass", () => {
    expect(runReleasePreflight(["4.0.0"], dependencies())).toEqual({
      npmVersionArgs: ["4.0.0"],
      currentVersion: "4.0.0-rc.2",
      targetVersion: "4.0.0",
      branchName: "main",
      tagName: "v4.0.0",
      stable: true,
    });
  });

  it("requires stable releases to use clean synchronized main", () => {
    expect(collectStableReleasePreconditionErrors({ branch: "feature", head: "a", originMain: "a", worktreeStatus: "" })).toContain(
      "Stable releases require branch main, received feature.",
    );
    expect(collectStableReleasePreconditionErrors({ branch: "main", head: "ahead", originMain: "remote", worktreeStatus: "" })[0]).toContain(
      "to equal origin/main",
    );

    const offMain = dependencies({ getBranch: () => "feature\n" });
    expect(main(["4.0.0"], tempRoot(), offMain)).toBe(1);
    const divergent = dependencies({ getHead: () => "ahead", getOriginMain: () => "remote" });
    expect(main(["4.0.0"], tempRoot(), divergent)).toBe(1);
  });

  it("does not impose stable-main ancestry on prerelease targets", () => {
    let fetched = false;
    const result = runReleasePreflight(["prerelease"], dependencies({
      getBranch: () => "feature\n",
      fetchOriginMainAndTags: () => { fetched = true; },
    }));
    expect(result.stable).toBe(false);
    expect(fetched).toBe(false);
  });

  it("verifies tag targets through an injected read-only resolver", () => {
    expect(() => assertTagTargetsCommit("v4.0.0", "abc123", () => "wrong")).toThrow("expected abc123");
    expect(() => assertTagTargetsCommit("v4.0.0", "abc123", () => "abc123\n")).not.toThrow();
  });
});

describe("stable release finalization", () => {
  it("prepends one stable changelog block and rejects duplicate promotion", () => {
    const existing = "## <small>4.0.0-rc.2 (2026-07-13)</small>\n\n### Summary\n\nRC.\n";
    const stableEntry = "## <small>4.0.0 (2026-07-14)</small>\n\n### Summary\n\nStable release.\n";
    const result = prependChangelogEntry(existing, stableEntry, "4.0.0");
    expect(result.match(/^## <small>4\.0\.0 \(/gm)).toHaveLength(1);
    expect(() => prependChangelogEntry(result, stableEntry, "4.0.0")).toThrow("already contains");

    const conventional = prependChangelogEntry(
      existing,
      "## [4.0.0](https://example.test/compare/v4.0.0-rc.2...v4.0.0) (2026-07-14)\n\n* fix: stable\n",
      "4.0.0",
    );
    const today = new Date().toISOString().slice(0, 10);
    expect(conventional).toContain(`## <small>4.0.0 (${today})</small>`);
  });

  it("updates every version surface fail-closed", () => {
    const root = tempRoot();
    writeReleaseFixture(root, "4.0.0-rc.2");
    updateVersionSurfaceFiles(root, "4.0.0");
    expect(readFileSync(path.join(root, "README.md"), "utf8")).toContain("`4.0.0`");
    expect(readFileSync(path.join(root, "openpackage.yml"), "utf8")).toContain("version: 4.0.0");
    expect(JSON.parse(readFileSync(path.join(root, ".claude-plugin/marketplace.json"), "utf8")).metadata.version).toBe("4.0.0");
    expect(JSON.parse(readFileSync(path.join(root, "plugins/grace/.claude-plugin/plugin.json"), "utf8")).version).toBe("4.0.0");
    expect(readFileSync(path.join(root, "src/grace.ts"), "utf8")).toContain('version: "4.0.0"');
  });

});
