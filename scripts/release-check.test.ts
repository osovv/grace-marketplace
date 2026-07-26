import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  collectPackedContentErrors,
  collectReleaseConsistencyErrors,
  collectReleaseProtectionErrors,
  collectReleaseStateErrors,
  expectedNpmDistTag,
} from "./release-check.ts";

const EXAMPLE_MARKETPLACE = JSON.stringify(
  {
    metadata: { version: "4.0.0" },
    plugins: [{ name: "grace", version: "4.0.0" }],
  },
  null,
  2,
);

const EXAMPLE_PLUGIN_MANIFEST = JSON.stringify({ name: "grace", version: "4.0.0" }, null, 2);
const EXAMPLE_CLI_ENTRY = `const main = defineCommand({ meta: { name: "grace", version: "4.0.0" } });`;

const EXAMPLE_README = `# GRACE Marketplace\nCurrent packaged version: \`4.0.0\``;

const EXAMPLE_OPENPACKAGE = `name: grace-marketplace\nversion: 4.0.0\n`;

const EXAMPLE_CHANGELOG = `## <small>4.0.0 (2026-06-20)</small>

### Summary

This release introduces features.

### Added

- Feature A

## <small>3.0.0 (2026-01-01)</small>

### Summary

Initial release.
`;

function makePkg(version?: string) {
  return { name: "@osovv/grace-cli", version: version ?? "4.0.0" };
}

// ---------------------------------------------------------------------------
// Basic passing case
// ---------------------------------------------------------------------------
describe("collectReleaseConsistencyErrors", () => {
  it("passes with valid consistent files", () => {
    const errors = collectReleaseConsistencyErrors(
      makePkg(),
      EXAMPLE_README,
      EXAMPLE_OPENPACKAGE,
      EXAMPLE_MARKETPLACE,
      EXAMPLE_PLUGIN_MANIFEST,
      EXAMPLE_CHANGELOG,
    );
    expect(errors).toEqual([]);
  });

  it("passes when version surface files have version=4.0.0", () => {
    const errors = collectReleaseConsistencyErrors(
      makePkg("4.0.0"),
      EXAMPLE_README,
      EXAMPLE_OPENPACKAGE,
      EXAMPLE_MARKETPLACE,
      EXAMPLE_PLUGIN_MANIFEST,
      EXAMPLE_CHANGELOG,
    );
    expect(errors).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Package name / version
  // ---------------------------------------------------------------------------
  it("fails on wrong package name", () => {
    const errors = collectReleaseConsistencyErrors(
      { name: "wrong-name", version: "4.0.0" },
      EXAMPLE_README,
      EXAMPLE_OPENPACKAGE,
      EXAMPLE_MARKETPLACE,
      EXAMPLE_PLUGIN_MANIFEST,
      EXAMPLE_CHANGELOG,
    );
    expect(errors.some((e) => e.includes("package.json name"))).toBe(true);
  });

  it("fails on missing version", () => {
    const errors = collectReleaseConsistencyErrors(
      { name: "@osovv/grace-cli" },
      EXAMPLE_README,
      EXAMPLE_OPENPACKAGE,
      EXAMPLE_MARKETPLACE,
      EXAMPLE_PLUGIN_MANIFEST,
      EXAMPLE_CHANGELOG,
    );
    expect(errors.some((e) => e.includes("version is missing"))).toBe(true);
  });

  it("fails on invalid semver", () => {
    const errors = collectReleaseConsistencyErrors(
      makePkg("not-semver"),
      EXAMPLE_README,
      EXAMPLE_OPENPACKAGE,
      EXAMPLE_MARKETPLACE,
      EXAMPLE_PLUGIN_MANIFEST,
      EXAMPLE_CHANGELOG,
    );
    expect(errors.some((e) => e.includes("not a valid semver"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // README
  // ---------------------------------------------------------------------------
  it("fails on missing README", () => {
    const errors = collectReleaseConsistencyErrors(makePkg(), null, EXAMPLE_OPENPACKAGE, EXAMPLE_MARKETPLACE, EXAMPLE_PLUGIN_MANIFEST, EXAMPLE_CHANGELOG);
    expect(errors.some((e) => e.includes("README.md"))).toBe(true);
  });

  it("fails on README version mismatch", () => {
    const readme = `# GRACE\nCurrent packaged version: \`1.0.0\``;
    const errors = collectReleaseConsistencyErrors(
      makePkg("4.0.0"),
      readme,
      EXAMPLE_OPENPACKAGE,
      EXAMPLE_MARKETPLACE,
      EXAMPLE_PLUGIN_MANIFEST,
      EXAMPLE_CHANGELOG,
    );
    expect(errors.some((e) => e.includes("README.md version marker"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // openpackage.yml
  // ---------------------------------------------------------------------------
  it("fails on missing openpackage", () => {
    const errors = collectReleaseConsistencyErrors(makePkg(), EXAMPLE_README, null, EXAMPLE_MARKETPLACE, EXAMPLE_PLUGIN_MANIFEST, EXAMPLE_CHANGELOG);
    expect(errors.some((e) => e.includes("openpackage.yml"))).toBe(true);
  });

  it("fails on openpackage version mismatch", () => {
    const op = "name: test\nversion: 1.0.0\n";
    const errors = collectReleaseConsistencyErrors(makePkg("4.0.0"), EXAMPLE_README, op, EXAMPLE_MARKETPLACE, EXAMPLE_PLUGIN_MANIFEST, EXAMPLE_CHANGELOG);
    expect(errors.some((e) => e.includes("openpackage.yml version"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // marketplace.json
  // ---------------------------------------------------------------------------
  it("fails on missing marketplace", () => {
    const errors = collectReleaseConsistencyErrors(makePkg(), EXAMPLE_README, EXAMPLE_OPENPACKAGE, null, EXAMPLE_PLUGIN_MANIFEST, EXAMPLE_CHANGELOG);
    expect(errors.some((e) => e.includes("marketplace.json"))).toBe(true);
  });

  it("fails on marketplace metadata.version mismatch", () => {
    const mp = JSON.stringify({ metadata: { version: "1.0.0" }, plugins: [{ version: "4.0.0" }] });
    const errors = collectReleaseConsistencyErrors(makePkg("4.0.0"), EXAMPLE_README, EXAMPLE_OPENPACKAGE, mp, EXAMPLE_PLUGIN_MANIFEST, EXAMPLE_CHANGELOG);
    expect(errors.some((e) => e.includes("marketplace.json metadata.version"))).toBe(true);
  });

  it("fails on marketplace plugin.version mismatch", () => {
    const mp = JSON.stringify({ metadata: { version: "4.0.0" }, plugins: [{ version: "1.0.0" }] });
    const errors = collectReleaseConsistencyErrors(makePkg("4.0.0"), EXAMPLE_README, EXAMPLE_OPENPACKAGE, mp, EXAMPLE_PLUGIN_MANIFEST, EXAMPLE_CHANGELOG);
    expect(errors.some((e) => e.includes("marketplace.json plugin[0].version"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // plugin manifest
  // ---------------------------------------------------------------------------
  it("fails on missing plugin manifest", () => {
    const errors = collectReleaseConsistencyErrors(makePkg(), EXAMPLE_README, EXAMPLE_OPENPACKAGE, EXAMPLE_MARKETPLACE, null, EXAMPLE_CHANGELOG);
    expect(errors.some((e) => e.includes("plugin.json"))).toBe(true);
  });

  it("fails on plugin manifest version mismatch", () => {
    const pm = JSON.stringify({ name: "grace", version: "1.0.0" });
    const errors = collectReleaseConsistencyErrors(makePkg("4.0.0"), EXAMPLE_README, EXAMPLE_OPENPACKAGE, EXAMPLE_MARKETPLACE, pm, EXAMPLE_CHANGELOG);
    expect(errors.some((e) => e.includes("plugin.json version"))).toBe(true);
  });

  it("fails on CLI metadata version mismatch when provided", () => {
    const cliEntry = `const main = defineCommand({ meta: { name: "grace", version: "1.0.0" } });`;
    const errors = collectReleaseConsistencyErrors(
      makePkg("4.0.0"),
      EXAMPLE_README,
      EXAMPLE_OPENPACKAGE,
      EXAMPLE_MARKETPLACE,
      EXAMPLE_PLUGIN_MANIFEST,
      EXAMPLE_CHANGELOG,
      cliEntry,
    );
    expect(errors.some((e) => e.includes("src/grace.ts CLI metadata version"))).toBe(true);
  });

  it("passes when CLI metadata version matches package version", () => {
    const errors = collectReleaseConsistencyErrors(
      makePkg("4.0.0"),
      EXAMPLE_README,
      EXAMPLE_OPENPACKAGE,
      EXAMPLE_MARKETPLACE,
      EXAMPLE_PLUGIN_MANIFEST,
      EXAMPLE_CHANGELOG,
      EXAMPLE_CLI_ENTRY,
    );
    expect(errors).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // CHANGELOG (including the new latest-header version check)
  // ---------------------------------------------------------------------------
  it("fails on missing CHANGELOG", () => {
    const errors = collectReleaseConsistencyErrors(makePkg(), EXAMPLE_README, EXAMPLE_OPENPACKAGE, EXAMPLE_MARKETPLACE, EXAMPLE_PLUGIN_MANIFEST, null);
    expect(errors.some((e) => e.includes("CHANGELOG.md is missing"))).toBe(true);
  });

  it("fails on no version headers in CHANGELOG", () => {
    const errors = collectReleaseConsistencyErrors(makePkg(), EXAMPLE_README, EXAMPLE_OPENPACKAGE, EXAMPLE_MARKETPLACE, EXAMPLE_PLUGIN_MANIFEST, "Plain text\nno headers");
    expect(errors.some((e) => e.includes("no version headers"))).toBe(true);
  });

  it("fails when CHANGELOG latest header version does not match package version", () => {
    const cl = `## <small>3.0.0 (2026-01-01)</small>

### Summary

Stale version entry.

* stuff
`;
    const errors = collectReleaseConsistencyErrors(
      makePkg("4.0.0"),
      EXAMPLE_README,
      EXAMPLE_OPENPACKAGE,
      EXAMPLE_MARKETPLACE,
      EXAMPLE_PLUGIN_MANIFEST,
      cl,
    );
    const headerErrors = errors.filter((e) => e.includes("latest header version"));
    expect(headerErrors.length).toBe(1);
    expect(headerErrors[0]).toContain("3.0.0");
    expect(headerErrors[0]).toContain("4.0.0");
  });

  it("fails when CHANGELOG contains duplicate release version headers", () => {
    const duplicate = `${EXAMPLE_CHANGELOG}\n\n${EXAMPLE_CHANGELOG}`;
    const errors = collectReleaseConsistencyErrors(
      makePkg("4.0.0"),
      EXAMPLE_README,
      EXAMPLE_OPENPACKAGE,
      EXAMPLE_MARKETPLACE,
      EXAMPLE_PLUGIN_MANIFEST,
      duplicate,
      EXAMPLE_CLI_ENTRY,
    );
    expect(errors.some((error) => error.includes("duplicate release headers"))).toBe(true);
  });

  it("fails when CHANGELOG latest header uses non-vv format", () => {
    // E.g., conventional-changelog default style with brackets
    const cl = `## [4.0.0](https://github.com) (2026-06-20)

### Summary

Valid but wrong format.

* stuff
`;
    const errors = collectReleaseConsistencyErrors(
      makePkg("4.0.0"),
      EXAMPLE_README,
      EXAMPLE_OPENPACKAGE,
      EXAMPLE_MARKETPLACE,
      EXAMPLE_PLUGIN_MANIFEST,
      cl,
    );
    const formatErrors = errors.filter((e) => e.includes("does not match expected format"));
    // This should fail on header format, not version (since version is 4.0.0 in both)
    // The LATEST_HEADER_VERSION regex won't match ## [4.0.0](...) format
    expect(formatErrors.length).toBeGreaterThan(0);
  });

  it("passes when latest header matches package version in vv-style", () => {
    const cl = `## <small>4.0.0 (2026-06-20)</small>

### Summary

Valid summary.

* details
`;
    const errors = collectReleaseConsistencyErrors(
      makePkg("4.0.0"),
      EXAMPLE_README,
      EXAMPLE_OPENPACKAGE,
      EXAMPLE_MARKETPLACE,
      EXAMPLE_PLUGIN_MANIFEST,
      cl,
    );
    expect(errors.filter((e) => e.includes("latest header version")).length).toBe(0);
  });

  it("fails when latest block has no ### Summary", () => {
    const cl = `## <small>4.0.0 (2026-06-20)</small>

### Added

- Something
`;
    const errors = collectReleaseConsistencyErrors(
      makePkg("4.0.0"),
      EXAMPLE_README,
      EXAMPLE_OPENPACKAGE,
      EXAMPLE_MARKETPLACE,
      EXAMPLE_PLUGIN_MANIFEST,
      cl,
    );
    expect(errors.some((e) => e.includes("no ### Summary"))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Multiple errors at once
  // ---------------------------------------------------------------------------
  it("collects multiple errors", () => {
    const errors = collectReleaseConsistencyErrors(
      makePkg("4.0.0"),
      null, // missing README
      null, // missing openpackage
      null, // missing marketplace
      null, // missing plugin manifest
      null, // missing changelog
    );
    expect(errors.length).toBeGreaterThanOrEqual(5);
  });
});

describe("release state and packed content", () => {
  it("requires the protected environment, main CI gates, and v* tags without requiring PR approvals", () => {
    expect(collectReleaseProtectionErrors({
      stableEnvironmentExists: true,
      stableEnvironmentRequiredReviewers: 1,
      stableEnvironmentUsesCustomPolicies: true,
      stableEnvironmentAllowsMain: true,
      stableEnvironmentAllowsReleaseTags: true,
      mainBranchProtected: true,
      mainRequiredStatusChecks: ["validate", "windows-compatibility", "dart-adapter"],
      mainEnforceAdmins: true,
      mainAllowsForcePushes: false,
      mainAllowsDeletions: false,
      releaseTagRulesetActive: true,
    })).toEqual([]);

    const errors = collectReleaseProtectionErrors({
      stableEnvironmentExists: false,
      stableEnvironmentRequiredReviewers: 0,
      stableEnvironmentUsesCustomPolicies: false,
      stableEnvironmentAllowsMain: false,
      stableEnvironmentAllowsReleaseTags: false,
      mainBranchProtected: false,
      mainRequiredStatusChecks: [],
      mainEnforceAdmins: false,
      mainAllowsForcePushes: true,
      mainAllowsDeletions: true,
      releaseTagRulesetActive: false,
    });
    expect(errors).toHaveLength(13);
    expect(errors.join(" ")).toContain("stable-release");
    expect(errors.join(" ")).toContain("validate");
    expect(errors.join(" ")).toContain("v*");
  });

  it("resolves stable and prerelease npm channels", () => {
    expect(expectedNpmDistTag("4.0.0")).toBe("latest");
    expect(expectedNpmDistTag("4.0.0-rc.2")).toBe("rc");
    expect(expectedNpmDistTag("4.0.0-beta.1")).toBe("beta");
  });

  it("accepts valid prerelease and stable release states", () => {
    expect(collectReleaseStateErrors({
      version: "4.0.0-rc.2",
      expectedTag: "v4.0.0-rc.2",
      branch: "grace-v4",
      head: "published-rc",
      originMain: "published-main",
      tagCommit: "published-rc",
      packedFiles: ["package.json", "README.md", "LICENSE", "src/grace.ts", "src/grace4/paths.ts"],
      localPackShasum: "rc-shasum",
      npmPackageShasum: "rc-shasum",
      npmDistTags: { latest: "3.11.0", rc: "4.0.0-rc.2" },
      githubRelease: { tagName: "v4.0.0-rc.2", isPrerelease: true },
    })).toEqual([]);

    expect(collectReleaseStateErrors({
      version: "4.0.0",
      expectedTag: "v4.0.0",
      branch: "main",
      head: "stable-commit",
      originMain: "stable-commit",
      tagCommit: "stable-commit",
      packedFiles: ["package.json", "README.md", "LICENSE", "src/grace.ts", "src/query/index.ts"],
      localPackShasum: "stable-shasum",
      npmPackageShasum: "stable-shasum",
      npmDistTags: { latest: "4.0.0", rc: "4.0.0-rc.2" },
      githubRelease: { tagName: "v4.0.0", isPrerelease: false },
    })).toEqual([]);
  });

  it("rejects unreleased prerelease HEAD or tarball content under an already published version", () => {
    const errors = collectReleaseStateErrors({
      version: "4.0.0-rc.2",
      expectedTag: "v4.0.0-rc.2",
      branch: "grace-v4",
      head: "new-work",
      originMain: "published-main",
      tagCommit: "published-rc",
      packedFiles: ["package.json", "README.md", "LICENSE", "src/grace.ts"],
      localPackShasum: "local-new-work",
      npmPackageShasum: "published-rc-tarball",
      npmDistTags: { latest: "3.11.0", rc: "4.0.0-rc.2" },
      githubRelease: { tagName: "v4.0.0-rc.2", isPrerelease: true },
    });

    expect(errors.some((error) => error.includes("workspace contains unreleased code"))).toBe(true);
    expect(errors.some((error) => error.includes("does not match published"))).toBe(true);
  });

  it("rejects off-main or mismatched stable state and wrong publication channels", () => {
    const errors = collectReleaseStateErrors({
      version: "4.0.0",
      expectedTag: "vwrong",
      branch: "feature",
      head: "head",
      originMain: "main",
      tagCommit: "tag",
      packedFiles: ["scripts/release-bump.ts", "src/grace-lint.test.ts", "src/grace4/test-fixtures.ts"],
      localPackShasum: "local",
      npmPackageShasum: "published",
      npmDistTags: { latest: "3.11.0" },
      githubRelease: { tagName: "vwrong", isPrerelease: true },
    });
    expect(errors.some((error) => error.includes("does not match package version"))).toBe(true);
    expect(errors.some((error) => error.includes("collected from main"))).toBe(true);
    expect(errors.some((error) => error.includes("does not equal origin/main"))).toBe(true);
    expect(errors.some((error) => error.includes("does not equal release tag"))).toBe(true);
    expect(errors.some((error) => error.includes("does not match published"))).toBe(true);
    expect(errors.some((error) => error.includes("npm dist-tag latest"))).toBe(true);
    expect(errors.some((error) => error.includes("prerelease flag"))).toBe(true);
    expect(errors.some((error) => error.includes("forbidden"))).toBe(true);
    expect(errors.some((error) => error.includes("unrelated"))).toBe(true);
  });

  it("parses actual npm pack JSON shape and rejects tests, fixtures, temporary files, and unrelated files", () => {
    const valid = JSON.stringify([{ files: [
      { path: "package.json" },
      { path: "README.md" },
      { path: "LICENSE" },
      { path: "src/grace.ts" },
      { path: "src/grace4/paths.ts" },
    ] }]);
    expect(collectPackedContentErrors(valid)).toEqual([]);

    const invalid = JSON.stringify([{ files: [
      { path: "src/grace-lint.test.ts" },
      { path: "src/grace4/test-fixtures.ts" },
      { path: "src/lint/temporary-analyzer.dart" },
      { path: "tmp-project/.grace/context.xml" },
      { path: "scripts/release-bump.ts" },
    ] }]);
    const errors = collectPackedContentErrors(invalid);
    expect(errors.filter((error) => error.includes("forbidden"))).toHaveLength(4);
    expect(errors.filter((error) => error.includes("unrelated"))).toHaveLength(1);
  });

  it("records rc.0 as an unpublished historical candidate without removing its changelog block", () => {
    const changelog = readFileSync(path.resolve(import.meta.dir, "../CHANGELOG.md"), "utf8");
    expect(changelog).toContain("## <small>4.0.0-rc.0");
    expect(changelog).toContain("v4.0.0-rc.0 was not published to npm");
    expect(changelog).toContain("tag is retained");
  });
});
