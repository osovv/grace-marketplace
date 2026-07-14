#!/usr/bin/env bun
// FILE: scripts/release-bump.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Execute a fail-closed version bump, changelog generation, validation, release commit, tag, and push workflow.
//   SCOPE: Testable argv/version/preflight/tag/version-surface helpers plus the guarded production release orchestration.
//   DEPENDS: [node:fs, node:child_process, scripts/release-summary.ts]
//   LINKS: [M-RELEASE-AUTOMATION, VF-RELEASE-AUTOMATION]
//   ROLE: SCRIPT
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   parseNpmVersionArgs - Validates the supported version target and optional prerelease identifier.
//   calculateTargetVersion - Resolves the target semver before any repository mutation.
//   isStableReleaseTarget - Classifies the resolved target as stable or prerelease.
//   collectStableReleasePreconditionErrors - Enforces clean synchronized main for stable targets.
//   runReleasePreflight - Verifies tools, worktree, branch, target tag/changelog uniqueness, and current release validation.
//   updateVersionSurfaceFiles - Updates every required version surface or fails closed.
//   prependChangelogEntry - Prepends exactly one target-version changelog block.
//   assertTagDoesNotExist - Rejects an existing local target tag.
//   assertTagTargetsCommit - Verifies a created tag resolves to the release commit.
//   createReleaseCommitAndTag - Creates the local release commit and annotated tag without network access.
//   main - Runs preflight, mutation, validation, local finalization, and ordered branch/tag pushes.
// END_MODULE_MAP

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  collectReleaseCommitMetadata,
  generateReleaseSummaryWithRetries,
  injectSummaryIntoChangelogEntry,
  resolveReleaseSummaryOptions,
  type OpencodeRunRequest,
  type OpencodeRunResult,
} from "./release-summary.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PACKAGE_NAME = "@osovv/grace-cli";
const CAPTURE_MAX_BUFFER = 128 * 1024 * 1024;
const RELEASE_TYPES = new Set(["major", "minor", "patch", "premajor", "preminor", "prepatch", "prerelease"]);
const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const PREID_PATTERN = /^[0-9A-Za-z-]+$/;
const REQUIRED_RELEASE_TOOLS = ["git", "npm", "bun", "opencode"] as const;
const RELEASE_FILES = [
  "package.json",
  "CHANGELOG.md",
  "README.md",
  "openpackage.yml",
  ".claude-plugin/marketplace.json",
  "plugins/grace/.claude-plugin/plugin.json",
  "src/grace.ts",
] as const;
const ALLOWED_RELEASE_FILES = new Set<string>(RELEASE_FILES);

interface PackageJson {
  name?: string;
  version?: string;
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

export interface ReleasePreflightDependencies {
  readCurrentVersion: () => string;
  readChangelog: () => string;
  getStatus: () => string;
  getBranch: () => string;
  tagExists: (tagName: string) => boolean;
  toolExists: (tool: string) => boolean;
  fetchOriginMainAndTags: () => void;
  getHead: () => string;
  getOriginMain: () => string;
  runValidation: () => void;
}

export interface ReleasePreflightResult {
  npmVersionArgs: string[];
  currentVersion: string;
  targetVersion: string;
  branchName: string;
  tagName: string;
  stable: boolean;
}

export interface StableReleaseGitState {
  branch: string;
  head: string;
  originMain: string;
  worktreeStatus: string;
}

function run(command: string, args: string[], failureMessage: string, cwd = REPO_ROOT): void {
  try {
    execFileSync(command, args, { cwd, stdio: "inherit" });
  } catch (error) {
    throw new Error(`${failureMessage} ${String(error)}`);
  }
}

function runCapture(command: string, args: string[], failureMessage: string, cwd = REPO_ROOT): string {
  try {
    return execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer: CAPTURE_MAX_BUFFER });
  } catch (error) {
    throw new Error(`${failureMessage} ${String(error)}`);
  }
}

function parseSemver(version: string): ParsedSemver {
  const match = version.trim().match(SEMVER_PATTERN);
  if (!match) throw new Error(`Invalid semver version: ${version}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? [],
  };
}

function extractPreid(args: string[]): string | undefined {
  const equalsArg = args.find((arg) => arg.startsWith("--preid="));
  if (equalsArg) return equalsArg.slice("--preid=".length);
  const index = args.indexOf("--preid");
  return index === -1 ? undefined : args[index + 1];
}

function incrementPrerelease(parts: string[]): string[] {
  if (parts.length === 0) return ["0"];
  const result = [...parts];
  for (let index = result.length - 1; index >= 0; index -= 1) {
    if (/^\d+$/.test(result[index]!)) {
      result[index] = String(Number(result[index]) + 1);
      return result;
    }
  }
  result.push("0");
  return result;
}

/** Validates the supported npm-version argv without shell interpolation. */
export function parseNpmVersionArgs(args: string[]): string[] {
  const target = args[0];
  if (!target) {
    throw new Error("Usage: release:bump <patch|minor|major|prerelease|prepatch|preminor|premajor|semver> [--preid <id>]");
  }
  if (!RELEASE_TYPES.has(target) && !SEMVER_PATTERN.test(target)) {
    throw new Error(`Unsupported npm version target: ${target}`);
  }

  let sawPreid = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg.startsWith("--preid=")) {
      if (sawPreid) throw new Error("--preid may be supplied only once.");
      sawPreid = true;
      const value = arg.slice("--preid=".length);
      if (!PREID_PATTERN.test(value)) throw new Error("--preid requires a non-empty alphanumeric or hyphen identifier.");
      continue;
    }
    if (arg === "--preid") {
      if (sawPreid) throw new Error("--preid may be supplied only once.");
      sawPreid = true;
      const value = args[index + 1];
      if (!value || !PREID_PATTERN.test(value)) throw new Error("--preid requires a non-empty alphanumeric or hyphen identifier.");
      index += 1;
      continue;
    }
    throw new Error(`Unsupported npm version option: ${arg}`);
  }

  return [...args];
}

/** Resolves npm's supported semver target forms before mutation. */
export function calculateTargetVersion(currentVersion: string, npmVersionArgs: string[]): string {
  const target = npmVersionArgs[0]!;
  if (!RELEASE_TYPES.has(target)) return target.replace(/^v/, "");

  const current = parseSemver(currentVersion);
  const requestedPreid = extractPreid(npmVersionArgs);
  const format = (major: number, minor: number, patch: number, prerelease: string[] = []) =>
    `${major}.${minor}.${patch}${prerelease.length > 0 ? `-${prerelease.join(".")}` : ""}`;
  const initialPre = () => requestedPreid ? [requestedPreid, "0"] : ["0"];

  switch (target) {
    case "major":
      return current.prerelease.length > 0 && current.minor === 0 && current.patch === 0
        ? format(current.major, 0, 0)
        : format(current.major + 1, 0, 0);
    case "minor":
      return current.prerelease.length > 0 && current.patch === 0
        ? format(current.major, current.minor, 0)
        : format(current.major, current.minor + 1, 0);
    case "patch":
      return current.prerelease.length > 0
        ? format(current.major, current.minor, current.patch)
        : format(current.major, current.minor, current.patch + 1);
    case "premajor":
      return format(current.major + 1, 0, 0, initialPre());
    case "preminor":
      return format(current.major, current.minor + 1, 0, initialPre());
    case "prepatch":
      return format(current.major, current.minor, current.patch + 1, initialPre());
    case "prerelease": {
      if (current.prerelease.length === 0) {
        return format(current.major, current.minor, current.patch + 1, [requestedPreid ?? "0", ...(requestedPreid ? ["0"] : [])]);
      }
      if (requestedPreid && current.prerelease[0] !== requestedPreid) {
        return format(current.major, current.minor, current.patch, [requestedPreid, "0"]);
      }
      return format(current.major, current.minor, current.patch, incrementPrerelease(current.prerelease));
    }
  }
}

/** Returns true when the requested target resolves to a stable, non-prerelease version. */
export function isStableReleaseTarget(currentVersion: string, npmVersionArgs: string[]): boolean {
  return !calculateTargetVersion(currentVersion, npmVersionArgs).includes("-");
}

/** Returns every stable-release git precondition error without mutating repository state. */
export function collectStableReleasePreconditionErrors(state: StableReleaseGitState): string[] {
  const errors: string[] = [];
  if (state.branch !== "main") errors.push(`Stable releases require branch main, received ${state.branch || "detached HEAD"}.`);
  if (state.worktreeStatus.trim()) errors.push("Stable releases require a clean worktree.");
  if (!state.head || !state.originMain) errors.push("Stable releases require resolved HEAD and origin/main commits.");
  else if (state.head !== state.originMain) errors.push(`Stable releases require HEAD (${state.head}) to equal origin/main (${state.originMain}).`);
  return errors;
}

function changelogHasVersion(changelog: string, version: string): boolean {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^##\\s+<small>${escaped}\\s+\\(`, "m").test(changelog);
}

/** Runs every deterministic safety gate before npm version can mutate files. */
export function runReleasePreflight(args: string[], deps: ReleasePreflightDependencies): ReleasePreflightResult {
  const npmVersionArgs = parseNpmVersionArgs(args);
  const currentVersion = deps.readCurrentVersion().trim();
  const targetVersion = calculateTargetVersion(currentVersion, npmVersionArgs);
  const tagName = `v${targetVersion}`;
  const stable = isStableReleaseTarget(currentVersion, npmVersionArgs);

  const missingTools = REQUIRED_RELEASE_TOOLS.filter((tool) => !deps.toolExists(tool));
  if (missingTools.length > 0) throw new Error(`Missing required release tool(s): ${missingTools.join(", ")}`);

  const status = deps.getStatus();
  if (status.trim()) throw new Error(`Worktree is dirty. Commit or stash changes before release.\n${status.trimEnd()}`);

  const branchName = deps.getBranch().trim();
  if (!branchName || branchName === "HEAD") throw new Error("release:bump requires a checked-out branch; detached HEAD is unsupported.");

  if (stable) {
    deps.fetchOriginMainAndTags();
    const stableErrors = collectStableReleasePreconditionErrors({
      branch: branchName,
      head: deps.getHead().trim(),
      originMain: deps.getOriginMain().trim(),
      worktreeStatus: status,
    });
    if (stableErrors.length > 0) throw new Error(stableErrors.join("\n"));
  }

  if (deps.tagExists(tagName)) throw new Error(`Tag ${tagName} already exists.`);
  if (changelogHasVersion(deps.readChangelog(), targetVersion)) {
    throw new Error(`CHANGELOG.md already contains a ${targetVersion} release block.`);
  }

  deps.runValidation();
  return { npmVersionArgs, currentVersion, targetVersion, branchName, tagName, stable };
}

function readRequired(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`Required release file is missing or unreadable: ${filePath}. ${String(error)}`);
  }
}

function replaceRequired(source: string, pattern: RegExp, replacement: string, label: string): string {
  if (!pattern.test(source)) throw new Error(`${label} does not contain the required version marker.`);
  return source.replace(pattern, replacement);
}

/** Updates all required package, marketplace, plugin, README, OpenPackage, and CLI version surfaces. */
export function updateVersionSurfaceFiles(repoRoot: string, newVersion: string): void {
  const readmePath = path.join(repoRoot, "README.md");
  const openpackagePath = path.join(repoRoot, "openpackage.yml");
  const marketplacePath = path.join(repoRoot, ".claude-plugin/marketplace.json");
  const pluginPath = path.join(repoRoot, "plugins/grace/.claude-plugin/plugin.json");
  const cliPath = path.join(repoRoot, "src/grace.ts");

  writeFileSync(readmePath, replaceRequired(readRequired(readmePath), /(Current packaged version:\s*`)([^`]+)(`)/, `$1${newVersion}$3`, "README.md"));
  writeFileSync(openpackagePath, replaceRequired(readRequired(openpackagePath), /^(version:\s*).+$/m, `$1${newVersion}`, "openpackage.yml"));

  const marketplace = JSON.parse(readRequired(marketplacePath)) as { metadata?: { version?: string }; plugins?: Array<{ version?: string }> };
  if (!marketplace.metadata || typeof marketplace.metadata.version !== "string" || !marketplace.plugins?.[0] || typeof marketplace.plugins[0].version !== "string") {
    throw new Error("marketplace.json is missing required version surfaces.");
  }
  marketplace.metadata.version = newVersion;
  marketplace.plugins[0].version = newVersion;
  writeFileSync(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`);

  const plugin = JSON.parse(readRequired(pluginPath)) as { version?: string };
  if (typeof plugin.version !== "string") throw new Error("plugin.json is missing its version surface.");
  plugin.version = newVersion;
  writeFileSync(pluginPath, `${JSON.stringify(plugin, null, 2)}\n`);

  writeFileSync(cliPath, replaceRequired(readRequired(cliPath), /(meta:\s*\{[\s\S]*?version:\s*")([^"]+)(")/, `$1${newVersion}$3`, "src/grace.ts"));
}

function normalizeChangelogHeader(entry: string, newVersion: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const traditionalHeader = /^##\s+\[?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\]?(?:\([^\n]*\))?\s*\(?\d{4}-\d{2}-\d{2}\)?/m;
  return traditionalHeader.test(entry)
    ? entry.replace(traditionalHeader, `## <small>${newVersion} (${today})</small>`)
    : entry;
}

/** Returns changelog text with exactly one new target-version block prepended. */
export function prependChangelogEntry(existing: string, entry: string, newVersion: string): string {
  if (changelogHasVersion(existing, newVersion)) throw new Error(`CHANGELOG.md already contains a ${newVersion} release block.`);
  const normalized = normalizeChangelogHeader(entry.trim(), newVersion);
  if (!changelogHasVersion(normalized, newVersion)) throw new Error(`Generated changelog entry has no ${newVersion} vv-style header.`);
  return existing.trim() ? `${normalized}\n\n${existing.trim()}\n` : `${normalized}\n`;
}

function generateChangelog(repoRoot: string): string {
  return runCapture(
    "bun",
    ["x", "conventional-changelog", "-p", "conventionalcommits", "-r", "1"],
    "conventional-changelog failed; release aborted.",
    repoRoot,
  ).trim();
}

function runOpencodeSummary(request: OpencodeRunRequest): OpencodeRunResult {
  const result = spawnSync(
    "opencode",
    ["--pure", "run", "--format", "json", "--agent", "release-summary", "--model", request.model, "Generate the required release changelog summary from stdin. Return only the <summary> envelope."],
    { encoding: "utf8", input: request.input, env: request.env, timeout: request.timeoutMs, maxBuffer: 1024 * 1024 },
  );
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: typeof result.error === "object" && result.error !== null && "code" in result.error && result.error.code === "ETIMEDOUT",
    errorCode: typeof result.error === "object" && result.error && "code" in result.error ? String(result.error.code) : undefined,
  };
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function changedReleaseFiles(repoRoot: string): string[] {
  return runCapture("git", ["status", "--porcelain"], "Failed to inspect release changes.", repoRoot)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3));
}

function assertOnlyReleaseFilesChanged(repoRoot: string): void {
  const unexpected = changedReleaseFiles(repoRoot).filter((file) => !ALLOWED_RELEASE_FILES.has(file));
  if (unexpected.length > 0) throw new Error(`release:bump produced unexpected changes: ${unexpected.join(", ")}`);
}

function tagExists(repoRoot: string, tagName: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tagName}`], { cwd: repoRoot, stdio: "ignore" });
  return result.status === 0;
}

/** Rejects an existing local target tag. */
export function assertTagDoesNotExist(repoRoot: string, tagName: string): void {
  if (tagExists(repoRoot, tagName)) throw new Error(`Tag ${tagName} already exists.`);
}

/** Verifies that an annotated or lightweight tag resolves to the expected release commit. */
export function assertTagTargetsCommit(
  tagName: string,
  expectedCommit: string,
  resolveTagCommit: (tag: string) => string,
): void {
  const actualCommit = resolveTagCommit(tagName).trim();
  if (actualCommit !== expectedCommit) {
    throw new Error(`Tag ${tagName} resolves to ${actualCommit || "nothing"}, expected ${expectedCommit}.`);
  }
}

/** Creates the release commit and annotated tag locally; it performs no push. */
export function createReleaseCommitAndTag(options: {
  repoRoot: string;
  currentVersion: string;
  newVersion: string;
  tagName?: string;
}): { commitSha: string; tagName: string } {
  const tagName = options.tagName ?? `v${options.newVersion}`;
  assertOnlyReleaseFilesChanged(options.repoRoot);
  assertTagDoesNotExist(options.repoRoot, tagName);
  run("git", ["add", ...RELEASE_FILES], "git add failed.", options.repoRoot);
  run(
    "git",
    ["commit", "-m", `chore: bump version from ${options.currentVersion} to ${options.newVersion} with changelog`],
    "git commit failed; release files remain staged for inspection.",
    options.repoRoot,
  );
  run("git", ["tag", "-a", tagName, "-m", tagName], "git tag failed; the release commit exists without a tag.", options.repoRoot);
  return {
    commitSha: runCapture("git", ["rev-parse", "HEAD"], "git rev-parse failed.", options.repoRoot).trim(),
    tagName,
  };
}

function readPackageVersion(repoRoot: string): string {
  const pkg = JSON.parse(readRequired(path.join(repoRoot, "package.json"))) as PackageJson;
  if (pkg.name !== PACKAGE_NAME) throw new Error(`package.json name must be ${PACKAGE_NAME}.`);
  if (!pkg.version) throw new Error("package.json version is missing.");
  parseSemver(pkg.version);
  return pkg.version;
}

function productionPreflightDependencies(repoRoot: string): ReleasePreflightDependencies {
  return {
    readCurrentVersion: () => readPackageVersion(repoRoot),
    readChangelog: () => readRequired(path.join(repoRoot, "CHANGELOG.md")),
    getStatus: () => runCapture("git", ["status", "--porcelain"], "Failed to inspect git status.", repoRoot),
    getBranch: () => runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"], "Failed to detect current branch.", repoRoot),
    tagExists: (tagName) => tagExists(repoRoot, tagName),
    toolExists: (tool) => spawnSync(tool, ["--version"], { cwd: repoRoot, stdio: "ignore" }).status === 0,
    fetchOriginMainAndTags: () => run("git", ["fetch", "origin", "main", "--tags"], "Failed to fetch origin/main and tags before stable release.", repoRoot),
    getHead: () => runCapture("git", ["rev-parse", "HEAD"], "Failed to resolve HEAD.", repoRoot),
    getOriginMain: () => runCapture("git", ["rev-parse", "origin/main"], "Failed to resolve origin/main.", repoRoot),
    runValidation: () => run("bun", ["run", "validate:release"], "Pre-bump validate:release failed; no release files were mutated.", repoRoot),
  };
}

/** Runs the guarded production release workflow and returns a process exit code. */
export function main(
  argv = process.argv.slice(2),
  repoRoot = REPO_ROOT,
  preflightDependencies = productionPreflightDependencies(repoRoot),
): number {
  try {
    const preflight = runReleasePreflight(argv, preflightDependencies);
    console.log(`Current version: ${preflight.currentVersion}`);
    console.log(`Target version: ${preflight.targetVersion}`);

    run("npm", ["version", "--no-git-tag-version", ...preflight.npmVersionArgs], "npm version failed; release aborted.", repoRoot);
    const newVersion = readPackageVersion(repoRoot);
    if (newVersion !== preflight.targetVersion) {
      throw new Error(`npm version produced ${newVersion}, but preflight predicted ${preflight.targetVersion}.`);
    }

    let changelogEntry = generateChangelog(repoRoot);
    if (!changelogEntry) {
      const today = new Date().toISOString().slice(0, 10);
      changelogEntry = `## <small>${newVersion} (${today})</small>\n\n_No user-facing changes._`;
    } else {
      changelogEntry = normalizeChangelogHeader(changelogEntry, newVersion);
    }

    const summary = generateReleaseSummaryWithRetries(
      runOpencodeSummary,
      {
        version: newVersion,
        changelogEntry,
        commits: collectReleaseCommitMetadata((command, args, failureMessage) => runCapture(command, args, failureMessage, repoRoot)),
      },
      resolveReleaseSummaryOptions(process.env),
      sleepMs,
    );
    changelogEntry = injectSummaryIntoChangelogEntry(changelogEntry, summary);
    const changelogPath = path.join(repoRoot, "CHANGELOG.md");
    writeFileSync(changelogPath, prependChangelogEntry(readRequired(changelogPath), changelogEntry, newVersion));
    updateVersionSurfaceFiles(repoRoot, newVersion);

    run("bun", ["run", "validate:release"], "Post-bump validate:release failed; release files remain uncommitted for inspection.", repoRoot);
    const localRelease = createReleaseCommitAndTag({
      repoRoot,
      currentVersion: preflight.currentVersion,
      newVersion,
      tagName: preflight.tagName,
    });

    assertTagTargetsCommit(
      localRelease.tagName,
      localRelease.commitSha,
      (tagName) => runCapture("git", ["rev-parse", `${tagName}^{commit}`], `Failed to resolve ${tagName}.`, repoRoot),
    );

    run("git", ["push", "origin", preflight.branchName], `Branch push failed; local commit ${localRelease.commitSha} and ${localRelease.tagName} remain.`, repoRoot);
    if (preflight.stable) {
      run("git", ["fetch", "origin", "main"], "Stable branch push completed but origin/main confirmation fetch failed.", repoRoot);
      const pushedMain = runCapture("git", ["rev-parse", "origin/main"], "Failed to resolve origin/main after stable branch push.", repoRoot).trim();
      if (pushedMain !== localRelease.commitSha) {
        throw new Error(`Stable branch push did not place release commit on origin/main: ${pushedMain} != ${localRelease.commitSha}.`);
      }
    }
    run("git", ["push", "origin", localRelease.tagName], `Tag push failed after branch push; push ${localRelease.tagName} manually after inspection.`, repoRoot);

    console.log(`\n✓ Release ${localRelease.tagName} committed, tagged, and pushed.`);
    console.log(`  Git SHA: ${localRelease.commitSha}`);
    console.log(`  Branch: ${preflight.branchName}`);
    return 0;
  } catch (error) {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = main();
}
