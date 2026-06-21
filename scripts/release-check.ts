#!/usr/bin/env bun
// FILE: scripts/release-check.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Verify release consistency: package name, semver version, version sync across version surface files, CHANGELOG.md presence and headers, and latest changelog entry summary gate.
//   SCOPE: Reads package.json, README.md, openpackage.yml, .claude-plugin/marketplace.json, plugins/grace/.claude-plugin/plugin.json, src/grace.ts, and CHANGELOG.md; validates package identity/version, that all version surface files are in sync, that CHANGELOG.md exists with valid headers, and that the latest release block has a valid ### Summary section.
//   DEPENDS: [node:fs, scripts/release-summary]
//   LINKS: [M-RELEASE-AUTOMATION, VF-RELEASE-AUTOMATION]
//   ROLE: SCRIPT
//   MAP_MODE: LOCALS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   collectReleaseConsistencyErrors - Returns all version and changelog consistency errors for tests and main.
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
const CLI_META_VERSION = /meta:\s*\{[\s\S]*?version:\s*"([^"]+)"/;
interface PackageJson {
  name?: string;
  version?: string;
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
