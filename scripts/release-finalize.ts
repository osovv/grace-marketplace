#!/usr/bin/env bun
// FILE: scripts/release-finalize.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Finalize an approved stable release from synchronized protected main by creating and pushing its immutable tag.
//   SCOPE: Stable-version parsing, post-merge preflight, validation, local-tag recovery, annotated tag creation, and tag push.
//   DEPENDS: [node:fs, node:child_process]
//   LINKS: [M-RELEASE-AUTOMATION, VF-RELEASE-AUTOMATION]
//   ROLE: SCRIPT
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   parseStableVersion - Requires one stable semantic version argument.
//   collectStableFinalizePreconditionErrors - Validates clean synchronized main, version surfaces, changelog, and tag absence/recovery.
//   runStableReleaseFinalization - Runs validation, creates or reuses the local tag, verifies it, and pushes it.
//   main - Executes the production stable-finalization dependencies.
// END_MODULE_MAP

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const PACKAGE_NAME = "@osovv/grace-cli";
const STABLE_SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

export type StableFinalizeState = {
  branch: string;
  worktreeStatus: string;
  head: string;
  originMain: string;
  packageVersion: string;
  requestedVersion: string;
  changelog: string;
  localTagCommit?: string;
  localTagType?: string;
  remoteTagExists: boolean;
};

export interface ReleaseFinalizeDependencies {
  getStatus: () => string;
  getBranch: () => string;
  fetchOriginMain: () => void;
  getHead: () => string;
  getOriginMain: () => string;
  readPackageVersion: () => string;
  readChangelog: () => string;
  resolveLocalTagCommit: (tagName: string) => string | undefined;
  resolveLocalTagType: (tagName: string) => string | undefined;
  remoteTagExists: (tagName: string) => boolean;
  runValidation: () => void;
  createAnnotatedTag: (tagName: string) => void;
  pushTag: (tagName: string) => void;
}

export function parseStableVersion(value: string | undefined): string {
  const match = value?.trim().match(STABLE_SEMVER);
  if (!match) throw new Error("Usage: release:finalize <stable-semver>, for example: release:finalize 4.0.0");
  return `${match[1]}.${match[2]}.${match[3]}`;
}

function changelogLatestVersion(changelog: string): string | undefined {
  return changelog.match(/^##\s+<small>([^\s]+)\s+\(/m)?.[1];
}

export function collectStableFinalizePreconditionErrors(state: StableFinalizeState): string[] {
  const errors: string[] = [];
  if (state.branch !== "main") errors.push(`Stable finalization requires branch main, received ${state.branch || "detached HEAD"}.`);
  if (state.worktreeStatus.trim()) errors.push("Stable finalization requires a clean worktree.");
  if (!state.head || !state.originMain || state.head !== state.originMain) errors.push(`Stable finalization requires HEAD (${state.head || "missing"}) to equal origin/main (${state.originMain || "missing"}).`);
  if (state.packageVersion !== state.requestedVersion) errors.push(`package.json version is ${state.packageVersion}, expected ${state.requestedVersion}.`);
  const latestChangelogVersion = changelogLatestVersion(state.changelog);
  if (latestChangelogVersion !== state.requestedVersion) errors.push(`CHANGELOG.md latest version is ${latestChangelogVersion ?? "missing"}, expected ${state.requestedVersion}.`);
  if (state.remoteTagExists) errors.push(`Remote tag v${state.requestedVersion} already exists; use publish workflow recovery instead of finalizing again.`);
  if (state.localTagCommit && state.localTagCommit !== state.head) errors.push(`Local tag v${state.requestedVersion} resolves to ${state.localTagCommit}, expected current main ${state.head}.`);
  if (state.localTagCommit && state.localTagType !== "tag") errors.push(`Local tag v${state.requestedVersion} is not annotated and cannot be reused safely.`);
  return errors;
}

export function runStableReleaseFinalization(
  argv: string[],
  deps: ReleaseFinalizeDependencies,
): { version: string; tagName: string; commitSha: string; reusedLocalTag: boolean } {
  const version = parseStableVersion(argv[0]);
  if (argv.length !== 1) throw new Error("release:finalize accepts exactly one stable semantic version argument.");
  const tagName = `v${version}`;
  const status = deps.getStatus();
  const branch = deps.getBranch().trim();
  deps.fetchOriginMain();
  const head = deps.getHead().trim();
  const localTagCommit = deps.resolveLocalTagCommit(tagName)?.trim();
  const localTagType = deps.resolveLocalTagType(tagName)?.trim();
  const state: StableFinalizeState = {
    branch,
    worktreeStatus: status,
    head,
    originMain: deps.getOriginMain().trim(),
    packageVersion: deps.readPackageVersion().trim(),
    requestedVersion: version,
    changelog: deps.readChangelog(),
    localTagCommit,
    localTagType,
    remoteTagExists: deps.remoteTagExists(tagName),
  };
  const errors = collectStableFinalizePreconditionErrors(state);
  if (errors.length > 0) throw new Error(errors.join("\n"));

  deps.runValidation();
  const reusedLocalTag = Boolean(localTagCommit);
  if (!reusedLocalTag) deps.createAnnotatedTag(tagName);
  const resolvedTag = deps.resolveLocalTagCommit(tagName)?.trim();
  if (resolvedTag !== head) throw new Error(`Tag ${tagName} resolves to ${resolvedTag || "nothing"}, expected ${head}.`);
  deps.pushTag(tagName);
  return { version, tagName, commitSha: head, reusedLocalTag };
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
    return execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`${failureMessage} ${String(error)}`);
  }
}

function productionDependencies(repoRoot: string): ReleaseFinalizeDependencies {
  return {
    getStatus: () => runCapture("git", ["status", "--porcelain"], "Failed to inspect git status.", repoRoot),
    getBranch: () => runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"], "Failed to detect the current branch.", repoRoot),
    fetchOriginMain: () => run("git", ["fetch", "--no-tags", "origin", "main:refs/remotes/origin/main"], "Failed to fetch origin/main.", repoRoot),
    getHead: () => runCapture("git", ["rev-parse", "HEAD"], "Failed to resolve HEAD.", repoRoot),
    getOriginMain: () => runCapture("git", ["rev-parse", "origin/main"], "Failed to resolve origin/main.", repoRoot),
    readPackageVersion: () => {
      const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { name?: string; version?: string };
      if (pkg.name !== PACKAGE_NAME || !pkg.version) throw new Error(`package.json must declare ${PACKAGE_NAME} and a version.`);
      return pkg.version;
    },
    readChangelog: () => readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8"),
    resolveLocalTagCommit: (tagName) => {
      const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${tagName}^{commit}`], { cwd: repoRoot, encoding: "utf8" });
      return result.status === 0 ? result.stdout.trim() : undefined;
    },
    resolveLocalTagType: (tagName) => {
      const result = spawnSync("git", ["cat-file", "-t", `refs/tags/${tagName}`], { cwd: repoRoot, encoding: "utf8" });
      return result.status === 0 ? result.stdout.trim() : undefined;
    },
    remoteTagExists: (tagName) => {
      const result = spawnSync("git", ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tagName}`], { cwd: repoRoot, stdio: "ignore" });
      if (result.status === 0) return true;
      if (result.status === 2) return false;
      throw result.error ?? new Error(`Failed to inspect remote tag ${tagName}.`);
    },
    runValidation: () => run("bun", ["run", "validate:release"], "Stable release validation failed; no tag was pushed.", repoRoot),
    createAnnotatedTag: (tagName) => run("git", ["tag", "-a", tagName, "-m", tagName], `Failed to create ${tagName}.`, repoRoot),
    pushTag: (tagName) => run("git", ["push", "origin", tagName], `Failed to push ${tagName}; the verified local tag remains for recovery.`, repoRoot),
  };
}

export function main(argv = process.argv.slice(2), repoRoot = REPO_ROOT): number {
  try {
    const result = runStableReleaseFinalization(argv, productionDependencies(repoRoot));
    console.log(`\n✓ Stable release ${result.tagName} finalized and pushed.`);
    console.log(`  Git SHA: ${result.commitSha}`);
    console.log("  The tag-triggered publish workflow now owns npm and GitHub Release publication.");
    return 0;
  } catch (error) {
    console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = main();
