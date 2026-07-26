import { describe, expect, it } from "bun:test";

import {
  collectStableFinalizePreconditionErrors,
  parseStableVersion,
  runStableReleaseFinalization,
  type ReleaseFinalizeDependencies,
} from "./release-finalize.ts";

function dependencies(overrides: Partial<ReleaseFinalizeDependencies> = {}): ReleaseFinalizeDependencies {
  let localTagCommit: string | undefined;
  return {
    getStatus: () => "",
    getBranch: () => "main\n",
    fetchOriginMain: () => undefined,
    getHead: () => "release-sha\n",
    getOriginMain: () => "release-sha\n",
    readPackageVersion: () => "4.0.0",
    readChangelog: () => "## <small>4.0.0 (2026-07-26)</small>\n\n### Summary\n\nStable.\n",
    resolveLocalTagCommit: () => localTagCommit,
    resolveLocalTagType: () => localTagCommit ? "tag" : undefined,
    remoteTagExists: () => false,
    runValidation: () => undefined,
    createAnnotatedTag: () => { localTagCommit = "release-sha"; },
    pushTag: () => undefined,
    ...overrides,
  };
}

describe("stable release finalization", () => {
  it("accepts only one stable semantic version", () => {
    expect(parseStableVersion("v4.0.0")).toBe("4.0.0");
    expect(() => parseStableVersion("4.0.0-rc.3")).toThrow("Usage");
    expect(() => parseStableVersion(undefined)).toThrow("Usage");
  });

  it("requires clean synchronized main and exact stable release surfaces", () => {
    const errors = collectStableFinalizePreconditionErrors({
      branch: "release/v4.0.0",
      worktreeStatus: " M package.json",
      head: "local",
      originMain: "remote",
      packageVersion: "4.0.0-rc.3",
      requestedVersion: "4.0.0",
      changelog: "## <small>4.0.0-rc.3 (2026-07-22)</small>",
      localTagCommit: "wrong",
      localTagType: "commit",
      remoteTagExists: true,
    });
    expect(errors).toHaveLength(8);
    expect(errors.join(" ")).toContain("branch main");
    expect(errors.join(" ")).toContain("clean worktree");
    expect(errors.join(" ")).toContain("Remote tag v4.0.0 already exists");
  });

  it("validates, creates, verifies, and pushes a new stable tag", () => {
    const events: string[] = [];
    let localTagCommit: string | undefined;
    const result = runStableReleaseFinalization(["4.0.0"], dependencies({
      fetchOriginMain: () => { events.push("fetch"); },
      resolveLocalTagCommit: () => localTagCommit,
      runValidation: () => { events.push("validate"); },
      createAnnotatedTag: () => { events.push("tag"); localTagCommit = "release-sha"; },
      pushTag: () => { events.push("push"); },
    }));
    expect(result).toEqual({ version: "4.0.0", tagName: "v4.0.0", commitSha: "release-sha", reusedLocalTag: false });
    expect(events).toEqual(["fetch", "validate", "tag", "push"]);
  });

  it("reuses a verified local tag after a prior push failure", () => {
    const events: string[] = [];
    const result = runStableReleaseFinalization(["4.0.0"], dependencies({
      resolveLocalTagCommit: () => "release-sha",
      resolveLocalTagType: () => "tag",
      createAnnotatedTag: () => { events.push("unexpected-tag"); },
      pushTag: () => { events.push("push"); },
    }));
    expect(result.reusedLocalTag).toBe(true);
    expect(events).toEqual(["push"]);
  });
});
