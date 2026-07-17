// FILE: scripts/packed-cli-smoke.test.ts
// Tests for RuntimeState tri-state classification used by the packed CLI smoke verifier.

import { describe, it, expect } from "bun:test";
import type { RuntimeState } from "./packed-cli-smoke.ts";

// We test runtimeState via real spawnSync calls.

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runtimeState } from "./packed-cli-smoke.ts";

describe("runtimeState", () => {
  it('returns "usable" when a candidate returns exit code 0', () => {
    // "true" always returns 0 on all POSIX systems
    expect(runtimeState(["true"])).toBe("usable");
  });

  it('returns "missing" when no candidate exists', () => {
    // This binary should never exist
    expect(runtimeState(["nonexistent-binary-xyz-999"])).toBe("missing");
  });

  it('returns "missing" when all candidates are ENOENT', () => {
    expect(runtimeState(["bogus-a-999", "bogus-b-999"])).toBe("missing");
  });

  it('returns "broken" when a candidate exists but returns non-zero', () => {
    // "false" always returns exit code 1 on all POSIX systems
    expect(runtimeState(["false"])).toBe("broken");
  });

  it("uses the first non-ENOENT candidate state", () => {
    // runtimeState returns first non-ENOENT result: "false" found first, broken
    expect(runtimeState(["false", "true"])).toBe("broken");
    expect(runtimeState(["true", "false"])).toBe("usable");
    expect(runtimeState(["nonexistent-xyz", "true"])).toBe("usable");
    expect(runtimeState(["nonexistent-xyz", "false"])).toBe("broken");
    expect(runtimeState(["nonexistent-xyz", "also-missing-999"])).toBe("missing");
  });
});

describe("runtimeState integration with spawnSync edge cases", () => {
  it("detects ENOENT as missing (no error thrown)", () => {
    // This is the real underlying spawnSync behavior we rely on
    const result = spawnSync("binary-that-definitely-does-not-exist-12345", ["--version"], { stdio: "ignore" });
    // bun spawnSync may return undefined vs null for status on ENOENT
    // The key invariant: error.code is ENOENT
    expect(result.error?.code).toBe("ENOENT");
    // runtimeState should classify this as missing
    expect(runtimeState(["binary-that-definitely-does-not-exist-12345"])).toBe("missing");
  });
});

describe("runtimeState non-ENOENT spawn error", () => {
  it('returns "broken" for a non-executable file (EACCES/EPERM) instead of swallowing the error', () => {
    // Create a non-executable temp file to deterministically trigger a non-ENOENT spawn error
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "grace-runtime-eacces-"));
    try {
      const nonExeFile = path.join(tmpDir, "should-fail");
      writeFileSync(nonExeFile, "#!/bin/sh\nexit 0", "utf8");
      chmodSync(nonExeFile, 0o644); // remove execute permission
      expect(runtimeState([nonExeFile])).toBe("broken");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
