import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import {
  checkActive,
  createSession,
  findActiveSession,
  incrementCounter,
  listSessions,
  markCompleted,
  markStopped,
  readSession,
  resolveSessionPaths,
} from "./afk/session";
import { appendDecision, appendDeferred, readJournal } from "./afk/journal";

function tmpProject() {
  return mkdtempSync(path.join(os.tmpdir(), "grace-afk-"));
}

describe("afk session create + read", () => {
  it("creates session directory and state.json under docs/afk-sessions/<id>/", () => {
    const root = tmpProject();
    const now = new Date("2026-04-18T10:00:00Z");
    const state = createSession(root, { hours: 2 }, now);

    expect(state.status).toBe("active");
    expect(state.hours).toBe(2);
    expect(new Date(state.expiresAt).getTime() - now.getTime()).toBe(2 * 3600 * 1000);

    const paths = resolveSessionPaths(root, state.id);
    expect(existsSync(paths.statePath)).toBe(true);
    expect(existsSync(paths.dir)).toBe(true);

    const fromDisk = readSession(root, state.id);
    expect(fromDisk?.id).toBe(state.id);
    expect(listSessions(root)).toEqual([state.id]);
  });

  it("validates hours range (0 < h <= 24)", () => {
    const root = tmpProject();
    expect(() => createSession(root, { hours: 0 })).toThrow();
    expect(() => createSession(root, { hours: 25 })).toThrow();
    expect(() => createSession(root, { hours: -1 })).toThrow();
  });

  it("validates checkpoint range", () => {
    const root = tmpProject();
    expect(() => createSession(root, { hours: 1, checkpointMinutes: 2 })).toThrow();
    expect(() => createSession(root, { hours: 1, checkpointMinutes: 500 })).toThrow();
  });
});

describe("afk session active check", () => {
  it("returns ok for a fresh session", () => {
    const root = tmpProject();
    const start = new Date("2026-04-18T10:00:00Z");
    createSession(root, { hours: 2 }, start);

    const check = checkActive(root, new Date("2026-04-18T10:30:00Z"));
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.remainingMs).toBe(90 * 60 * 1000);
    }
  });

  it("returns expired once past expiresAt", () => {
    const root = tmpProject();
    const start = new Date("2026-04-18T10:00:00Z");
    createSession(root, { hours: 1 }, start);

    const check = checkActive(root, new Date("2026-04-18T11:30:00Z"));
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe("expired");
    }
  });

  it("returns stopped after markStopped", () => {
    const root = tmpProject();
    const state = createSession(root, { hours: 2 });
    markStopped(root, state.id, "user-requested");

    const check = checkActive(root);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe("stopped");
    }
  });

  it("returns no-active-session for empty project", () => {
    const root = tmpProject();
    const check = checkActive(root);
    expect(check.ok).toBe(false);
    if (!check.ok) {
      expect(check.reason).toBe("no-active-session");
    }
  });
});

describe("afk counters", () => {
  it("increments commits / escalations / deferred independently", () => {
    const root = tmpProject();
    const state = createSession(root, { hours: 2 });

    incrementCounter(root, state.id, "commits");
    incrementCounter(root, state.id, "commits");
    incrementCounter(root, state.id, "escalations");
    incrementCounter(root, state.id, "deferred");
    incrementCounter(root, state.id, "deferred");
    incrementCounter(root, state.id, "deferred");

    const fromDisk = readSession(root, state.id)!;
    expect(fromDisk.commits).toBe(2);
    expect(fromDisk.escalations).toBe(1);
    expect(fromDisk.deferred).toBe(3);
  });
});

describe("afk completed state", () => {
  it("markCompleted makes the session not-active", () => {
    const root = tmpProject();
    const state = createSession(root, { hours: 2 });
    markCompleted(root, state.id);

    expect(findActiveSession(root)).toBeNull();
    const fromDisk = readSession(root, state.id)!;
    expect(fromDisk.status).toBe("completed");
  });
});

describe("afk journal", () => {
  it("appends decisions with a header and an entry", () => {
    const root = tmpProject();
    const state = createSession(root, { hours: 2 });
    const paths = resolveSessionPaths(root, state.id);

    appendDecision(paths.decisionsPath, {
      timestamp: "2026-04-18T11:00:00Z",
      klass: "reversible-act",
      title: "Refactor helper",
      context: "Phase-4 step-3",
      rationale: "Test coverage was 60%, needed factoring out.",
      outcome: "commit abc1234",
    });

    const text = readFileSync(paths.decisionsPath, "utf8");
    expect(text).toContain("# /afk decisions journal");
    expect(text).toContain("Refactor helper");
    expect(text).toContain("reversible-act");
    expect(text).toContain("commit abc1234");
  });

  it("appends deferred questions as single lines", () => {
    const root = tmpProject();
    const state = createSession(root, { hours: 2 });
    const paths = resolveSessionPaths(root, state.id);

    appendDeferred(paths.deferredPath, {
      timestamp: "2026-04-18T11:05:00Z",
      question: "Merge strategy for M-FOO?",
      context: "Phase-5 gate",
      suggestion: "squash",
    });
    appendDeferred(paths.deferredPath, {
      timestamp: "2026-04-18T11:15:00Z",
      question: "Release version?",
      context: "main branch",
    });

    const text = readJournal(paths.deferredPath);
    const dataLines = text.split("\n").filter((line) => line.startsWith("- ["));
    expect(dataLines).toHaveLength(2);
    expect(dataLines[0]).toContain("Merge strategy");
    expect(dataLines[0]).toContain("squash");
  });
});
