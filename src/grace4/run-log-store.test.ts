import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  commandLogFileName,
  createRunDir,
  projectSlug,
  pruneRuns,
  resolveLogRoot,
  writeRunMeta,
  type RunMeta,
} from "./run-log-store";

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), "grace-logstore-"));
}

describe("resolveLogRoot", () => {
  test("uses XDG_CACHE_HOME when set", () => {
    const previous = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = "/tmp/xdg-cache-xyz";
    try {
      expect(resolveLogRoot()).toBe(path.join("/tmp/xdg-cache-xyz", "grace", "run-commands"));
    } finally {
      restore(previous);
    }
  });

  test("falls back to ~/.cache when XDG_CACHE_HOME is empty", () => {
    const previous = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = "";
    try {
      expect(resolveLogRoot()).toContain(path.join(".cache", "grace", "run-commands"));
    } finally {
      restore(previous);
    }
  });
});

describe("projectSlug", () => {
  test("distinct slugs for same-named roots in different locations", () => {
    const a = projectSlug("/srv/work/app");
    const b = projectSlug("/mnt/b/app");
    expect(a.startsWith("app-")).toBe(true);
    expect(b.startsWith("app-")).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("createRunDir", () => {
  test("creates nested runs directory with timestamp and change suffix", () => {
    const root = tempDir();
    try {
      const startedAt = new Date(2026, 7, 29, 12, 20, 7);
      const dir = createRunDir(root, "proj-abcdef12", startedAt, "C-IMAGE");
      expect(dir).toContain(path.join("proj-abcdef12", "runs"));
      expect(path.basename(dir)).toBe("2026-08-29T12-20-07_C-IMAGE");
      expect(statSync(dir).isDirectory()).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("same-second collisions append a counter", () => {
    const root = tempDir();
    try {
      const startedAt = new Date(2026, 7, 29, 12, 20, 7);
      const first = createRunDir(root, "proj", startedAt);
      const second = createRunDir(root, "proj", startedAt);
      expect(second).not.toBe(first);
      expect(path.basename(second).startsWith("2026-08-29T12-20-07-")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("writeRunMeta", () => {
  test("round-trips RunMeta as JSON", async () => {
    const root = tempDir();
    try {
      const meta: RunMeta = {
        schemaVersion: "1.0.0",
        tool: "grace-lint",
        changeId: "C-TEST",
        assertionMode: "target",
        projectRoot: "/proj",
        slug: "proj-abcdef12",
        startedAt: "2026-08-29T10:00:00.000Z",
        finishedAt: "2026-08-29T10:00:05.000Z",
        status: "passed",
        commands: [
          {
            index: 1,
            assertionId: "plan.xml#1",
            command: "echo ok",
            exitCode: 0,
            durationMs: 20,
            timedOut: false,
            skipped: false,
            logFile: "1-echo-ok.log",
          },
        ],
      };
      expect(writeRunMeta(root, meta)).toBe(true);
      expect(JSON.parse(await Bun.file(path.join(root, "meta.json")).text())).toEqual(meta);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns false when the run dir does not exist", () => {
    const meta = {} as RunMeta;
    expect(writeRunMeta(path.join(tempDir(), "missing"), meta)).toBe(false);
  });
});

describe("pruneRuns", () => {
  test("keeps the 10 lexically-newest of 12 run dirs", () => {
    const root = tempDir();
    try {
      for (let i = 1; i <= 12; i++) {
        mkdirSync(path.join(root, `2026-08-${String(i).padStart(2, "0")}T00-00-00`));
      }
      pruneRuns(root);
      const remaining = readdirSync(root).sort();
      expect(remaining).toHaveLength(10);
      expect(remaining[0]).toBe("2026-08-03T00-00-00");
      expect(remaining[9]).toBe("2026-08-12T00-00-00");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("missing or empty parent is a no-op", () => {
    expect(() => pruneRuns(path.join(tempDir(), "nope"))).not.toThrow();
  });
});

describe("commandLogFileName", () => {
  test("sanitizes to [a-z0-9-], starts with index, ends with .log, caps length", () => {
    const name = commandLogFileName(3, "bun run --filter '@vvchat/web' TEST:E2E!!");
    expect(name.startsWith("3-")).toBe(true);
    expect(name.endsWith(".log")).toBe(true);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(name).toMatch(/^[0-9]+-[a-z0-9-]*\.log$/);
  });

  test("falls back to command slug when nothing survives sanitization", () => {
    expect(commandLogFileName(1, "###")).toBe("1-command.log");
  });
});

function restore(previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env.XDG_CACHE_HOME;
  } else {
    process.env.XDG_CACHE_HOME = previous;
  }
}
