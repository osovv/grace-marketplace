import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  commandLogFileName,
  createRunDir,
  projectSlug,
  pruneRuns,
  readRunMeta,
  readVcsIdentity,
  reconcileRunMeta,
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
        schemaVersion: "1.1.0",
        tool: "grace-lint",
        changeId: "C-TEST",
        assertionMode: "target",
        projectRoot: "/proj",
        slug: "proj-abcdef12",
        pid: 4242,
        head: "0123456789abcdef0123456789abcdef01234567",
        branch: "feat/example",
        dirty: false,
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

  test("the newest passing run of a change survives later failing runs", () => {
    const root = tempDir();
    try {
      seedRun(root, "2026-08-01T00-00-00_C-ALPHA", { changeId: "C-ALPHA", status: "passed" });
      for (let i = 2; i <= 14; i++) {
        seedRun(root, `2026-08-${String(i).padStart(2, "0")}T00-00-00_C-BETA`, { changeId: "C-BETA", status: "failed" });
      }
      pruneRuns(root);
      const remaining = readdirSync(root).sort();
      expect(remaining).toContain("2026-08-01T00-00-00_C-ALPHA");
      expect(remaining).toHaveLength(11);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("run dirs without a readable meta.json are prunable", () => {
    const root = tempDir();
    try {
      seedRun(root, "2026-08-01T00-00-00_C-ALPHA", { changeId: "C-ALPHA", status: "passed" });
      for (let i = 2; i <= 14; i++) {
        mkdirSync(path.join(root, `2026-08-${String(i).padStart(2, "0")}T00-00-00_C-ALPHA`));
      }
      pruneRuns(root, 2);
      const remaining = readdirSync(root).sort();
      expect(remaining).toEqual([
        "2026-08-01T00-00-00_C-ALPHA",
        "2026-08-13T00-00-00_C-ALPHA",
        "2026-08-14T00-00-00_C-ALPHA",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an older passing run for the same change is superseded and prunable", () => {
    const root = tempDir();
    try {
      seedRun(root, "2026-08-01T00-00-00_C-ALPHA", { changeId: "C-ALPHA", status: "passed" });
      seedRun(root, "2026-08-02T00-00-00_C-ALPHA", { changeId: "C-ALPHA", status: "passed" });
      seedRun(root, "2026-08-03T00-00-00_C-BETA", { changeId: "C-BETA", status: "passed" });
      pruneRuns(root, 0);
      expect(readdirSync(root).sort()).toEqual(["2026-08-02T00-00-00_C-ALPHA", "2026-08-03T00-00-00_C-BETA"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("passing runs without a changeId are not protected", () => {
    const root = tempDir();
    try {
      seedRun(root, "2026-08-01T00-00-00", { changeId: null, status: "passed" });
      seedRun(root, "2026-08-02T00-00-00", { changeId: null, status: "passed" });
      pruneRuns(root, 1);
      expect(readdirSync(root).sort()).toEqual(["2026-08-02T00-00-00"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("timeout and interrupted runs are prunable like failures", () => {
    const root = tempDir();
    try {
      seedRun(root, "2026-08-01T00-00-00_C-ALPHA", { changeId: "C-ALPHA", status: "timeout" });
      seedRun(root, "2026-08-02T00-00-00_C-ALPHA", { changeId: "C-ALPHA", status: "interrupted" });
      pruneRuns(root, 0);
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function seedRun(parent: string, name: string, meta: Partial<RunMeta>): void {
  const dir = path.join(parent, name);
  mkdirSync(dir, { recursive: true });
  writeRunMeta(dir, {
    schemaVersion: "1.1.0",
    tool: "grace-lint",
    changeId: null,
    assertionMode: "target",
    projectRoot: parent,
    slug: "proj-abcdef12",
    pid: process.pid,
    head: null,
    branch: null,
    dirty: null,
    startedAt: "2026-08-01T00:00:00.000Z",
    finishedAt: "2026-08-01T00:00:05.000Z",
    status: "passed",
    commands: [],
    ...meta,
  });
}

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

describe("readVcsIdentity", () => {
  test("records head, branch and a clean worktree for a git repository", () => {
    const root = gitFixture();
    try {
      const identity = readVcsIdentity(root);
      expect(identity.head).toMatch(/^[0-9a-f]{40}$/);
      expect(typeof identity.branch).toBe("string");
      expect(identity.branch).not.toBe("");
      expect(identity.dirty).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports dirty once the worktree carries uncommitted changes", () => {
    const root = gitFixture();
    try {
      const clean = readVcsIdentity(root);
      writeFileSync(path.join(root, "tracked.txt"), "two\n");
      const dirty = readVcsIdentity(root);
      expect(clean.dirty).toBe(false);
      expect(dirty.dirty).toBe(true);
      expect(dirty.head).toBe(clean.head);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("degrades to nulls outside a git repository", () => {
    const root = tempDir();
    try {
      expect(readVcsIdentity(root)).toEqual({ head: null, branch: null, dirty: null });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("reconcileRunMeta", () => {
  test("reclassifies a running meta whose writer process is gone as killed", async () => {
    const root = tempDir();
    try {
      writeRunMeta(root, runningMeta(await deadPid()));
      expect(reconcileRunMeta(root)?.status).toBe("killed");
      expect(readRunMeta(root)?.status).toBe("killed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("leaves a running meta owned by a live process alone", () => {
    const root = tempDir();
    try {
      writeRunMeta(root, runningMeta(process.pid));
      expect(reconcileRunMeta(root)?.status).toBe("running");
      expect(readRunMeta(root)?.status).toBe("running");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a run directory without a readable meta.json reconciles to null", () => {
    const root = tempDir();
    try {
      expect(reconcileRunMeta(root)).toBeNull();
      writeFileSync(path.join(root, "meta.json"), "{ not json");
      expect(reconcileRunMeta(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("pruneRuns reclassifies surviving stale running runs", async () => {
    const root = tempDir();
    try {
      const pid = await deadPid();
      const kept = path.join(root, "2026-08-01T00-00-00");
      mkdirSync(kept);
      writeRunMeta(kept, runningMeta(pid));
      mkdirSync(path.join(root, "2026-08-02T00-00-00"));
      pruneRuns(root);
      expect(readRunMeta(kept)?.status).toBe("killed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function gitFixture(): string {
  const root = tempDir();
  const git = (...args: string[]) => {
    const result = Bun.spawnSync({ cmd: ["git", ...args], cwd: root, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(" ")}: ${new TextDecoder().decode(result.stderr)}`);
    }
  };
  git("init");
  git("config", "core.autocrlf", "false");
  git("config", "user.name", "Grace Fixture");
  git("config", "user.email", "fixture@grace.invalid");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(root, "tracked.txt"), "one\n");
  git("add", "tracked.txt");
  git("commit", "-m", "initial");
  return root;
}

/** A pid that is guaranteed to have exited: spawn a no-op child and reap it. */
async function deadPid(): Promise<number> {
  const child = Bun.spawn({ cmd: [process.execPath, "-e", ""], stdout: "ignore", stderr: "ignore" });
  await child.exited;
  return child.pid;
}

function runningMeta(pid: number): RunMeta {
  return {
    schemaVersion: "1.1.0",
    tool: "grace-lint",
    changeId: "C-TEST",
    assertionMode: "target",
    projectRoot: "/proj",
    slug: "proj-abcdef12",
    pid,
    head: null,
    branch: null,
    dirty: null,
    startedAt: "2026-08-29T10:00:00.000Z",
    finishedAt: null,
    status: "running",
    commands: [],
  };
}
