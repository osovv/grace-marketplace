#!/usr/bin/env bun
// FILE: scripts/release-check.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Verify local release consistency plus pure packed-content, channel, tag, and ancestry state contracts.
//   SCOPE: Validates version surfaces and changelog structure; exports read-only release-state and npm-pack manifest validators used by release:checklist.
//   DEPENDS: [node:fs, scripts/release-summary]
//   LINKS: [M-RELEASE-AUTOMATION, VF-RELEASE-AUTOMATION]
//   ROLE: SCRIPT
//   MAP_MODE: LOCALS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   collectReleaseConsistencyErrors - Returns all version and changelog consistency errors for tests and main.
//   expectedNpmDistTag - Resolves latest for stable or the first prerelease identifier.
//   collectPackedContentErrors - Rejects test, fixture, temporary, and unrelated files from npm pack JSON.
//   collectReleaseStateErrors - Validates tag, ancestry, packed files, npm dist-tag, and GitHub Release state.
//   collectReleaseProtectionErrors - Validates the protected stable environment, main branch, and release-tag ruleset.
//   main - Reads release files, prints consistency errors, and exits nonzero on failure.
// END_MODULE_MAP

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateLatestChangelogSummary } from "./release-summary.ts";
import path from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const PKG_PATH = path.join(REPO_ROOT, "package.json");
const README_PATH = path.join(REPO_ROOT, "README.md");
const OPENPACKAGE_PATH = path.join(REPO_ROOT, "openpackage.yml");
const MARKETPLACE_PATH = path.join(REPO_ROOT, ".claude-plugin/marketplace.json");
const PLUGIN_MANIFEST_PATH = path.join(REPO_ROOT, "plugins/grace/.claude-plugin/plugin.json");
const CLI_ENTRY_PATH = path.join(REPO_ROOT, "src/grace.ts");
const CHANGELOG_PATH = path.join(REPO_ROOT, "CHANGELOG.md");

const EXPECTED_PACKAGE_NAME = "@osovv/grace-cli";
const PACKAGE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CHANGELOG_VERSION_HEADER = /^##\s+/m;
const README_VERSION_MARKER = /Current packaged version:\s*`([^`]+)`/;
const OPENPACKAGE_VERSION = /^version:\s*([^\s]+)\s*$/m;
const LATEST_HEADER_VERSION = /^##\s+<small>([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\s+/m;
const ALL_HEADER_VERSIONS = /^##\s+<small>([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\s+/gm;
const CLI_META_VERSION = /meta:\s*\{[\s\S]*?version:\s*"([^"]+)"/;
interface PackageJson {
  name?: string;
  version?: string;
}

export type ReleaseState = {
  version: string;
  expectedTag: string;
  branch: string;
  head: string;
  originMain: string;
  tagCommit?: string;
  packedFiles: string[];
  localPackShasum: string;
  npmPackageShasum: string;
  npmDistTags: Record<string, string>;
  githubRelease?: { tagName: string; isPrerelease: boolean };
};

export type ReleaseProtectionState = {
  stableEnvironmentExists: boolean;
  stableEnvironmentRequiredReviewers: number;
  stableEnvironmentUsesCustomPolicies: boolean;
  stableEnvironmentAllowsMain: boolean;
  stableEnvironmentAllowsReleaseTags: boolean;
  mainBranchProtected: boolean;
  mainRequiredStatusChecks: string[];
  mainEnforceAdmins: boolean;
  mainAllowsForcePushes: boolean;
  mainAllowsDeletions: boolean;
  releaseTagRulesetActive: boolean;
};

const PACK_ALLOWED_EXACT = new Set([
  "package.json",
  "README.md",
  "LICENSE",
  "src/grace-file.ts",
  "src/project-utils.ts",
  "src/grace.ts",
  "src/grace-lint.ts",
  "src/grace-module.ts",
  "src/grace-status.ts",
  "src/grace-verification.ts",
  "src/language-registry.ts",
]);
const PACK_ALLOWED_PREFIXES = ["src/grace4/", "src/lint/", "src/query/", "src/verification/"];
const PACK_FORBIDDEN = [
  /(^|\/)__tests__(\/|$)/i,
  /(^|\/)tests?(\/|$)/i,
  /\.test\.[^/]+$/i,
  /test-fixtures?/i,
  /temporary[-_.]?(?:analy|project|file)/i,
  /(^|\/)tmp[-_.]/i,
];

/** Expected npm channel for one package version. */
export function expectedNpmDistTag(version: string): string {
  const prerelease = version.match(/^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/)?.[1];
  return prerelease ?? "latest";
}

function collectPackedFileErrors(files: string[]): string[] {
  const errors: string[] = [];
  for (const file of files) {
    const normalized = file.replace(/^package\//, "").replaceAll("\\", "/");
    if (PACK_FORBIDDEN.some((pattern) => pattern.test(normalized))) {
      errors.push(`Packed content includes forbidden test, fixture, or temporary file: ${normalized}`);
      continue;
    }
    if (!PACK_ALLOWED_EXACT.has(normalized) && !PACK_ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
      errors.push(`Packed content includes unrelated file: ${normalized}`);
    }
  }
  return errors;
}

/** Parses npm pack --dry-run --json output and validates its actual file list. */
export function collectPackedContentErrors(packJson: string): string[] {
  try {
    const parsed = JSON.parse(packJson) as Array<{ files?: Array<{ path?: string }> }>;
    if (!Array.isArray(parsed) || !parsed[0] || !Array.isArray(parsed[0].files)) {
      return ["npm pack JSON has no files array."];
    }
    const files = parsed[0].files.map((entry) => entry.path).filter((entry): entry is string => typeof entry === "string");
    if (files.length === 0) return ["npm pack JSON contains an empty file list."];
    return collectPackedFileErrors(files);
  } catch (error) {
    return [`npm pack output is not valid JSON: ${String(error)}`];
  }
}

/** Validates one collected candidate/stable release state without performing mutations. */
export function collectReleaseStateErrors(state: ReleaseState): string[] {
  const errors: string[] = [];
  const stable = !state.version.includes("-");
  const canonicalTag = `v${state.version}`;
  const distTag = expectedNpmDistTag(state.version);

  if (state.expectedTag !== canonicalTag) errors.push(`Expected tag ${state.expectedTag} does not match package version ${canonicalTag}.`);
  if (!state.tagCommit) errors.push(`Release tag ${canonicalTag} is missing or cannot be resolved.`);
  else if (state.head !== state.tagCommit) {
    errors.push(`Current HEAD ${state.head} does not equal release tag ${canonicalTag} commit ${state.tagCommit}; the workspace contains unreleased code under an already published version.`);
  }
  if (stable) {
    if (state.branch !== "main") errors.push(`Stable release state must be collected from main, received ${state.branch}.`);
    if (state.head !== state.originMain) errors.push(`Stable HEAD ${state.head} does not equal origin/main ${state.originMain}.`);
    if (state.tagCommit && state.tagCommit !== state.originMain) {
      errors.push(`Stable tag commit ${state.tagCommit} does not equal origin/main ${state.originMain}.`);
    }
  }

  if (state.npmDistTags[distTag] !== state.version) {
    errors.push(`npm dist-tag ${distTag} points to ${state.npmDistTags[distTag] ?? "nothing"}, expected ${state.version}.`);
  }

  if (!state.localPackShasum || !state.npmPackageShasum) {
    errors.push("Local or published npm package shasum is missing.");
  } else if (state.localPackShasum !== state.npmPackageShasum) {
    errors.push(`Local npm pack shasum ${state.localPackShasum} does not match published ${state.version} shasum ${state.npmPackageShasum}.`);
  }

  if (!state.githubRelease) {
    errors.push(`GitHub Release ${canonicalTag} is missing.`);
  } else {
    if (state.githubRelease.tagName !== canonicalTag) {
      errors.push(`GitHub Release tag is ${state.githubRelease.tagName}, expected ${canonicalTag}.`);
    }
    if (state.githubRelease.isPrerelease === stable) {
      errors.push(`GitHub Release prerelease flag is ${state.githubRelease.isPrerelease}, expected ${!stable}.`);
    }
  }

  errors.push(...collectPackedFileErrors(state.packedFiles));
  return errors;
}

/** Validates GitHub repository controls required before stable publication. */
export function collectReleaseProtectionErrors(state: ReleaseProtectionState): string[] {
  const errors: string[] = [];
  if (!state.stableEnvironmentExists) errors.push("GitHub environment stable-release does not exist.");
  if (state.stableEnvironmentRequiredReviewers < 1) errors.push("GitHub environment stable-release requires at least one reviewer.");
  if (!state.stableEnvironmentUsesCustomPolicies) errors.push("GitHub environment stable-release does not use explicit branch and tag deployment policies.");
  if (!state.stableEnvironmentAllowsMain) errors.push("GitHub environment stable-release does not allow the main branch.");
  if (!state.stableEnvironmentAllowsReleaseTags) errors.push("GitHub environment stable-release does not allow v* release tags.");
  if (!state.mainBranchProtected) errors.push("GitHub branch main is not protected.");
  for (const requiredCheck of ["validate", "windows-compatibility", "dart-adapter"]) {
    if (!state.mainRequiredStatusChecks.includes(requiredCheck)) errors.push(`GitHub branch main does not require the ${requiredCheck} status check.`);
  }
  if (!state.mainEnforceAdmins) errors.push("GitHub branch main protection does not include administrators.");
  if (state.mainAllowsForcePushes) errors.push("GitHub branch main allows force pushes.");
  if (state.mainAllowsDeletions) errors.push("GitHub branch main allows deletion.");
  if (!state.releaseTagRulesetActive) errors.push("No active GitHub ruleset protects v* release tags from deletion and non-fast-forward updates.");
  return errors;
}

/**
 * All version-consistency errors without exiting the process.
 * Validates package identity/version, version sync across surface files,
 * changelog presence, changelog headers, and latest changelog summary.
 */
export function collectReleaseConsistencyErrors(
  pkg: PackageJson,
  readmeText: string | null,
  openpackageText: string | null,
  marketplaceText: string | null,
  pluginManifestText: string | null,
  changelogText: string | null,
  cliEntryText?: string | null,
): string[] {
  const errors: string[] = [];

  // Validate package name
  if (pkg.name !== EXPECTED_PACKAGE_NAME) {
    errors.push(
      `package.json name is "${pkg.name ?? ""}", expected "${EXPECTED_PACKAGE_NAME}"`,
    );
  }

  // Validate package version
  if (!pkg.version || typeof pkg.version !== "string" || !pkg.version.trim()) {
    errors.push(`package.json version is missing or invalid: "${pkg.version ?? ""}"`);
  } else if (!PACKAGE_VERSION_PATTERN.test(pkg.version.trim())) {
    errors.push(`package.json version is not a valid semver string: "${pkg.version}"`);
  }

  const version = pkg.version?.trim() ?? "";

  // Validate README version marker
  if (!readmeText) {
    errors.push("README.md is missing or unreadable");
  } else {
    const readmeMatch = readmeText.match(README_VERSION_MARKER);
    if (!readmeMatch) {
      errors.push('README.md: missing "Current packaged version: `x.y.z`" marker');
    } else if (readmeMatch[1] !== version) {
      errors.push(`README.md version marker is "${readmeMatch[1]}", expected "${version}"`);
    }
  }

  // Validate openpackage.yml version
  if (!openpackageText) {
    errors.push("openpackage.yml is missing or unreadable");
  } else {
    const openpkgMatch = openpackageText.match(OPENPACKAGE_VERSION);
    if (!openpkgMatch) {
      errors.push("openpackage.yml: missing version");
    } else if (openpkgMatch[1] !== version) {
      errors.push(`openpackage.yml version is "${openpkgMatch[1]}", expected "${version}"`);
    }
  }

  // Validate marketplace.json version
  if (!marketplaceText) {
    errors.push(".claude-plugin/marketplace.json is missing or unreadable");
  } else {
    try {
      const marketplace = JSON.parse(marketplaceText) as {
        metadata?: { version?: string };
        plugins?: Array<{ version?: string }>;
      };
      const metaVersion = marketplace.metadata?.version;
      const pluginVersion = marketplace.plugins?.[0]?.version;
      if (metaVersion && metaVersion !== version) {
        errors.push(`marketplace.json metadata.version is "${metaVersion}", expected "${version}"`);
      }
      if (pluginVersion && pluginVersion !== version) {
        errors.push(`marketplace.json plugin[0].version is "${pluginVersion}", expected "${version}"`);
      }
    } catch {
      errors.push(".claude-plugin/marketplace.json is not valid JSON");
    }
  }

  // Validate plugins/grace/.claude-plugin/plugin.json version
  if (!pluginManifestText) {
    errors.push("plugins/grace/.claude-plugin/plugin.json is missing or unreadable");
  } else {
    try {
      const manifest = JSON.parse(pluginManifestText) as { version?: string };
      if (manifest.version && manifest.version !== version) {
        errors.push(`plugins/grace/.claude-plugin/plugin.json version is "${manifest.version}", expected "${version}"`);
      }
    } catch {
      errors.push("plugins/grace/.claude-plugin/plugin.json is not valid JSON");
    }
  }

  // Validate src/grace.ts CLI metadata version when provided by the CLI entrypoint caller.
  if (cliEntryText !== undefined) {
    if (!cliEntryText) {
      errors.push("src/grace.ts is missing or unreadable");
    } else {
      const cliVersionMatch = cliEntryText.match(CLI_META_VERSION);
      if (!cliVersionMatch) {
        errors.push("src/grace.ts: missing CLI metadata version");
      } else if (cliVersionMatch[1] !== version) {
        errors.push(`src/grace.ts CLI metadata version is "${cliVersionMatch[1]}", expected "${version}"`);
      }
    }
  }

  // Validate CHANGELOG.md
  if (!changelogText) {
    errors.push("CHANGELOG.md is missing or empty");
  } else if (!CHANGELOG_VERSION_HEADER.test(changelogText)) {
    errors.push("CHANGELOG.md contains no version headers (expected ## <small>X.Y.Z ... format)");
  } else {
    // Strict: latest/top release header version must match package.json version
    const headerMatch = changelogText.match(LATEST_HEADER_VERSION);
    if (!headerMatch) {
      errors.push(`CHANGELOG.md latest header does not match expected format "## <small>X.Y.Z ..."`);
    } else if (headerMatch[1] !== version) {
      errors.push(`CHANGELOG.md latest header version is "${headerMatch[1]}", expected "${version}"`);
    }

    const seenVersions = new Set<string>();
    const duplicateVersions = new Set<string>();
    for (const match of changelogText.matchAll(ALL_HEADER_VERSIONS)) {
      const headerVersion = match[1]!;
      if (seenVersions.has(headerVersion)) duplicateVersions.add(headerVersion);
      seenVersions.add(headerVersion);
    }
    if (duplicateVersions.size > 0) {
      errors.push(`CHANGELOG.md contains duplicate release headers: ${[...duplicateVersions].sort().join(", ")}`);
    }

    const summary = validateLatestChangelogSummary(changelogText);
    if (!summary.ok) {
      errors.push(`CHANGELOG.md latest release summary is invalid: ${summary.reason}`);
    }
  }

  return errors;
}

function readTextOrNull(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function exitWithErrors(errors: string[]): void {
  console.error("\nRelease consistency check FAILED:\n");
  for (const err of errors) {
    console.error(`  ✗ ${err}`);
  }
  process.exit(1);
}

/** Runs the release consistency check as a CLI command. */
function main(): void {
  const pkg = (() => {
    try {
      return JSON.parse(readFileSync(PKG_PATH, "utf8")) as PackageJson;
    } catch (err) {
      console.error(`✗ Failed to read or parse package.json: ${err}`);
      process.exit(1);
    }
  })();

  const readmeText = readTextOrNull(README_PATH);
  const openpackageText = readTextOrNull(OPENPACKAGE_PATH);
  const marketplaceText = readTextOrNull(MARKETPLACE_PATH);
  const pluginManifestText = readTextOrNull(PLUGIN_MANIFEST_PATH);
  const cliEntryText = readTextOrNull(CLI_ENTRY_PATH);
  const changelogText = readTextOrNull(CHANGELOG_PATH);

  const errors = collectReleaseConsistencyErrors(
    pkg,
    readmeText,
    openpackageText,
    marketplaceText,
    pluginManifestText,
    changelogText,
    cliEntryText,
  );

  if (errors.length > 0) exitWithErrors(errors);

  console.log(`\n✓ Release consistency check passed: ${EXPECTED_PACKAGE_NAME}@${pkg.version?.trim() ?? ""}\n`);
}

if (import.meta.main) main();
