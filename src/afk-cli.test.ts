import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, setDefaultTimeout } from "bun:test";

// Each runCli invocation spawns `bun` (~500ms cold-start on Windows) + mkdtemp for an isolated
// $HOME. Tests that chain 3+ invocations approach the default 5s ceiling on slow machines.
// Bump the per-test ceiling so the suite stays deterministic under CI/Windows load.
setDefaultTimeout(15000);

function tmpProject() {
  return mkdtempSync(path.join(os.tmpdir(), "grace-afk-cli-"));
}

const REPO_ROOT = path.resolve(import.meta.dir, "..");
const CLI_ENTRY = path.join(REPO_ROOT, "src", "grace.ts");

// On Windows, `bun` on PATH is typically a `.cmd` shim installed via npm. Node's
// auto-detection for .cmd executables in `spawnSync` is known to return status=null on some
// installations (reported by the Gemini reviewer on the same branch — their local run got
// 12 CLI tests exiting with -1 while ours got 13/13 because of Node version differences).
//
// Defensive fix: resolve the binary name explicitly by platform.
//   - win32  -> `bun.cmd` (the npm-shim wrapper that cmd.exe can locate on PATH without shell)
//   - other  -> `bun`
//
// We deliberately do NOT use `shell: true` — that would force cmd.exe to re-parse our args,
// break string quoting for values with spaces (observed regression: "what next?" became
// "what" + "next?"), and introduce injection surface for user-controlled test inputs. Naming
// the binary directly avoids the shell entirely and lets Node.js do its normal arg-escaping.
const BUN_BIN = process.platform === "win32" ? "bun.cmd" : "bun";

function runCli(cwd: string, args: string[], opts: { home?: string } = {}) {
  // Invoke `bun <file>` rather than `bun run <file>`: `bun run` wraps the child and on Windows
  // does not reliably propagate custom exit codes above a single-digit range (observed: any
  // `process.exitCode = 46` became 255 at the parent).
  //
  // Isolate $HOME / $USERPROFILE: since 4.0.0-beta.2 afk config also falls back to a global
  // ~/.grace/afk.json. If tests inherited the real home, presence of a dev machine's global
  // config would flip EXIT_CONFIG_MISSING tests. Every runCli call gets a throwaway home,
  // making tests deterministic regardless of local dev setup.
  const home = opts.home ?? mkdtempSync(path.join(os.tmpdir(), "grace-afk-cli-home-"));
  const result = spawnSync(BUN_BIN, [CLI_ENTRY, "afk", ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      GRACE_AFK_CONFIG: "",
    },
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("grace afk CLI", () => {
  it("start creates state and tick reports remaining time", () => {
    const root = tmpProject();
    const start = runCli(root, ["start", "1", "--path", root]);
    expect(start.code).toBe(0);
    expect(start.stdout).toContain("Started /afk session");

    const tick = runCli(root, ["tick", "--path", root]);
    expect(tick.code).toBe(0);
    expect(tick.stdout).toMatch(/remaining=\d+/);
    expect(tick.stdout).toContain("status=active");
  });

  it("tick returns EXIT_BUDGET_EXHAUSTED once session expired", () => {
    const root = tmpProject();
    runCli(root, ["start", "1", "--path", root]);

    // Force-expire by editing expiresAt to the past.
    const docsDir = path.join(root, "docs", "afk-sessions");
    const sessionDirs = require("node:fs").readdirSync(docsDir);
    const statePath = path.join(docsDir, sessionDirs[0], "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.expiresAt = new Date(Date.now() - 60_000).toISOString();
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const tick = runCli(root, ["tick", "--path", root]);
    expect(tick.code).toBe(42); // EXIT_BUDGET_EXHAUSTED
    expect(tick.stderr).toContain("Budget exhausted");
  });

  it("tick returns EXIT_NO_SESSION when no session has been started", () => {
    const root = tmpProject();
    const tick = runCli(root, ["tick", "--path", root]);
    expect(tick.code).toBe(43); // EXIT_NO_SESSION
    expect(tick.stderr).toContain("no active session");
  });

  it("journal and defer append to files and increment counters", () => {
    const root = tmpProject();
    runCli(root, ["start", "2", "--path", root]);

    const journal = runCli(root, [
      "journal",
      "--path",
      root,
      "--class",
      "reversible-act",
      "--title",
      "Test",
      "--rationale",
      "because",
      "--outcome",
      "ok",
    ]);
    expect(journal.code).toBe(0);

    const defer = runCli(root, [
      "defer",
      "--path",
      root,
      "--question",
      "what next?",
      "--contextLine",
      "step-1",
    ]);
    expect(defer.code).toBe(0);

    const docsDir = path.join(root, "docs", "afk-sessions");
    const sessionId = require("node:fs").readdirSync(docsDir)[0];
    const decisionsPath = path.join(docsDir, sessionId, "decisions.md");
    const deferredPath = path.join(docsDir, sessionId, "deferred.md");
    expect(existsSync(decisionsPath)).toBe(true);
    expect(existsSync(deferredPath)).toBe(true);
    expect(readFileSync(decisionsPath, "utf8")).toContain("reversible-act");
    expect(readFileSync(deferredPath, "utf8")).toContain("what next?");

    const statePath = path.join(docsDir, sessionId, "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.deferred).toBe(1);
  });

  it("stop marks session stopped and subsequent tick exits with EXIT_SESSION_STOPPED", () => {
    const root = tmpProject();
    runCli(root, ["start", "2", "--path", root]);
    const stop = runCli(root, ["stop", "--path", root, "--reason", "test"]);
    expect(stop.code).toBe(0);

    const tick = runCli(root, ["tick", "--path", root]);
    expect(tick.code).toBe(44); // EXIT_SESSION_STOPPED
    expect(tick.stderr).toContain("stopped");
  });

  it("report shows summary and marks completed", () => {
    const root = tmpProject();
    runCli(root, ["start", "1", "--path", root]);
    const report = runCli(root, ["report", "--path", root]);
    expect(report.code).toBe(0);
    expect(report.stdout).toContain("report");
    expect(report.stdout).toContain("Status:");

    // After report, session is completed; tick should exit with no-active-session.
    const tick = runCli(root, ["tick", "--path", root]);
    expect(tick.code).toBe(43);
  });
});

describe("projectNameFromPath (via ask smoke)", () => {
  it("converts kebab-case basename to Title Case", async () => {
    const { projectNameFromPath } = await import("./grace-afk");
    expect(projectNameFromPath("/tmp/grace-marketplace-2")).toBe("Grace Marketplace 2");
    expect(projectNameFromPath("D:/Python/GRACE_2/grace-marketplace-2")).toBe("Grace Marketplace 2");
    expect(projectNameFromPath("/foo/bar_baz-quux")).toBe("Bar Baz Quux");
    expect(projectNameFromPath(".")).not.toBe("");
  });
});

describe("buildAskMessage", () => {
  it("uses the project name as the visible first-line prefix", async () => {
    const { buildAskMessage } = await import("./grace-afk");
    const text = buildAskMessage({
      correlationId: "abc123",
      sessionId: "sess-1",
      projectName: "Grace Marketplace 2",
      title: "pick one",
      context: "situation",
      options: ["A:x"],
      myPick: "A",
      confidence: "80",
    });
    const firstLine = text.split("\n")[0];
    expect(firstLine).toContain("Grace Marketplace 2");
    expect(firstLine).toContain("abc123");
  });
});

describe("buildDoneContext", () => {
  it("formats elapsed time + counters + usage on one line", async () => {
    const { buildDoneContext } = await import("./grace-afk");
    const start = "2026-04-19T04:00:00.000Z";
    const now = new Date("2026-04-19T05:17:00.000Z"); // +1h17m
    const line = buildDoneContext({
      sessionStartIso: start,
      now,
      commits: 3,
      escalations: 1,
      deferred: 2,
      usageLine: "5h 7% · 7d 21%",
    });
    expect(line).toContain("1h 17m");
    expect(line).toContain("3 commits");
    expect(line).toContain("1 escalations");
    expect(line).toContain("2 deferred");
    expect(line).toContain("5h 7%");
  });

  it("omits the usage block when usageLine is null", async () => {
    const { buildDoneContext } = await import("./grace-afk");
    const line = buildDoneContext({
      sessionStartIso: "2026-04-19T04:00:00.000Z",
      now: new Date("2026-04-19T04:05:00.000Z"),
      commits: 0,
      escalations: 0,
      deferred: 0,
      usageLine: null,
    });
    expect(line).toContain("5m");
    expect(line).not.toContain("5h");
  });
});

describe("parseDetailsArg + buildDetailsMessage + buildAskKeyboard(hasDetails)", () => {
  it("parses the 5-field SWOT details arg", async () => {
    const { parseDetailsArg } = await import("./grace-afk");
    const map = parseDetailsArg("A|pros-a|cons-a|opps-a|risks-a;B|pros-b|cons-b|opps-b|risks-b");
    expect(map.size).toBe(2);
    expect(map.get("A")?.pros).toBe("pros-a");
    expect(map.get("B")?.risks).toBe("risks-b");
    expect(map.get("A")?.opportunities).toBe("opps-a");
  });

  it("renders the SWOT message with project name, correlation id, and all four sections per option", async () => {
    const { buildDetailsMessage, parseDetailsArg } = await import("./grace-afk");
    const map = parseDetailsArg("A|p|c|o|r;B|p2|c2|o2|r2");
    const text = buildDetailsMessage({
      projectName: "Grace Marketplace 2",
      correlationId: "abc123",
      options: ["A:first", "B:second"],
      details: map,
    });
    expect(text).toContain("[Grace Marketplace 2] Decision details abc123");
    // The "A:" letter prefix from the raw option is stripped so we don't render "A — A:first".
    expect(text).toContain("A — first");
    expect(text).toContain("B — second");
    expect(text).not.toContain("A — A:first");
    expect(text).toContain("Pros:          p");
    expect(text).toContain("Cons:");
    expect(text).toContain("Opportunities:");
    expect(text).toContain("Risks:");
  });

  it("adds the [Details] row to the keyboard only when hasDetails=true", async () => {
    const { buildAskKeyboard } = await import("./grace-afk");
    const without = buildAskKeyboard("abc", ["A:x", "B:y"], false);
    expect(without).toHaveLength(2);
    const withDetails = buildAskKeyboard("abc", ["A:x", "B:y"], true);
    expect(withDetails).toHaveLength(3);
    expect(withDetails[2]?.[0]?.callbackData).toBe("abc:DETAILS");
  });

  it("classifies the DETAILS callback payload as a recognized non-terminal verb", async () => {
    const { classifyAnswer } = await import("./afk/telegram");
    const result = classifyAnswer("abc123:DETAILS");
    expect(result.recognized).toBe(true);
    expect(result.verb).toBe("DETAILS");
  });
});

describe("grace afk CLI — argument validation and fallbacks", () => {
  it("journal rejects an unknown --class value with EXIT_BAD_ARGS", () => {
    const root = tmpProject();
    runCli(root, ["start", "1", "--path", root]);

    const result = runCli(root, [
      "journal",
      "--path",
      root,
      "--class",
      "not-a-real-class",
      "--title",
      "x",
      "--rationale",
      "x",
      "--outcome",
      "x",
    ]);

    expect(result.code).toBe(2); // EXIT_BAD_ARGS
    expect(result.stderr).toContain("invalid --class");
    expect(result.stderr).toContain("reversible-act"); // lists allowed values
  });

  it("journal accepts --context as the canonical arg name", () => {
    const root = tmpProject();
    runCli(root, ["start", "1", "--path", root]);
    const result = runCli(root, [
      "journal",
      "--path",
      root,
      "--class",
      "reversible-act",
      "--title",
      "t",
      "--context",
      "plan step-1",
      "--rationale",
      "r",
      "--outcome",
      "o",
    ]);
    expect(result.code).toBe(0);

    const docsDir = path.join(root, "docs", "afk-sessions");
    const sessionId = require("node:fs").readdirSync(docsDir)[0];
    const decisions = readFileSync(path.join(docsDir, sessionId, "decisions.md"), "utf8");
    expect(decisions).toContain("plan step-1");
  });

  it("defer requires --context (or --contextLine alias) and fails with EXIT_BAD_ARGS otherwise", () => {
    const root = tmpProject();
    runCli(root, ["start", "1", "--path", root]);

    const noContext = runCli(root, ["defer", "--path", root, "--question", "q"]);
    expect(noContext.code).toBe(2);
    expect(noContext.stderr).toContain("context");

    const withAlias = runCli(root, [
      "defer",
      "--path",
      root,
      "--question",
      "q",
      "--contextLine",
      "ctx-via-alias",
    ]);
    expect(withAlias.code).toBe(0);
  });

  it("ask exits with EXIT_CONFIG_MISSING (46) when .grace-afk.json is absent", () => {
    const root = tmpProject();
    runCli(root, ["start", "1", "--path", root]);

    const result = runCli(root, [
      "ask",
      "--path",
      root,
      "--title",
      "merge to main",
      "--context",
      "plan is complete",
      "--options",
      "A:merge;B:wait",
      "--mypick",
      "A",
      "--confidence",
      "80",
    ]);

    expect(result.code).toBe(46); // EXIT_CONFIG_MISSING
    expect(result.stderr).toContain("Telegram not configured");
    expect(result.stderr).toContain("defer");
  });

  it("check returns {status:pending} when no answer is cached and Telegram is not configured", () => {
    // Post-openAsks redesign: check reads state.answers first. Without a cached answer and
    // without telegram config it simply reports pending (no network, exit 0) — the agent keeps
    // calling `grace afk tick` to drain future taps whenever they arrive.
    const root = tmpProject();
    runCli(root, ["start", "1", "--path", root]);

    const result = runCli(root, [
      "check",
      "--path",
      root,
      "--correlation",
      "abc123",
      "--messageid",
      "42",
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"status":"pending"');
  });

  it("ask refuses after max escalations with EXIT_BAD_ARGS", () => {
    const root = tmpProject();
    runCli(root, ["start", "1", "--path", root]);

    // Drop a config that points at an unreachable telegram API so sendMessage will never be called
    // once the max-escalations gate fires. We bump escalations via direct state.json edits.
    const docsDir = path.join(root, "docs", "afk-sessions");
    const sessionId = require("node:fs").readdirSync(docsDir)[0];
    const statePath = path.join(docsDir, sessionId, "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.escalations = 3;
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    // Minimal config so `getTelegram` returns non-null and the code proceeds to the cap check.
    writeFileSync(
      path.join(root, ".grace-afk.json"),
      JSON.stringify({
        telegram: { botToken: "x", chatId: "y" },
        autoStop: { maxEscalationsPerSession: 3 },
      }),
    );

    const result = runCli(root, [
      "ask",
      "--path",
      root,
      "--title",
      "t",
      "--context",
      "c",
      "--options",
      "A:x;B:y",
    ]);

    expect(result.code).toBe(2); // EXIT_BAD_ARGS per post-review unification
    expect(result.stderr).toContain("max 3 escalations");
    expect(result.stderr).toContain("defer");
  });

  it("ask reads global ~/.grace/afk.json when no project-local config exists", () => {
    const root = tmpProject();
    const home = mkdtempSync(path.join(os.tmpdir(), "grace-afk-cli-home-"));
    // Plant a global config in the fake home. Project root has no .grace-afk.json.
    const globalDir = path.join(home, ".grace");
    require("node:fs").mkdirSync(globalDir, { recursive: true });
    writeFileSync(
      path.join(globalDir, "afk.json"),
      JSON.stringify({
        telegram: { botToken: "global-bot", chatId: "global-chat" },
        autoStop: { maxEscalationsPerSession: 3 },
      }),
    );

    runCli(root, ["start", "1", "--path", root], { home });

    // Bump escalations so we hit the max-escalations guard before touching telegram.
    const docsDir = path.join(root, "docs", "afk-sessions");
    const sessionId = require("node:fs").readdirSync(docsDir)[0];
    const statePath = path.join(docsDir, sessionId, "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.escalations = 3;
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const result = runCli(
      root,
      ["ask", "--path", root, "--title", "t", "--context", "c", "--options", "A:x;B:y"],
      { home },
    );

    // Hitting max-escalations (exit 2) proves the global config was loaded — otherwise we'd
    // have gotten EXIT_CONFIG_MISSING (46) first.
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("max 3 escalations");
  });

  it("tick updates lastTickAt atomically and is safe to call repeatedly", () => {
    const root = tmpProject();
    runCli(root, ["start", "2", "--path", root]);

    // 3 iterations is enough to verify the atomic rename path without blowing the test timeout
    // on Windows where each `bun` spawn is ~500ms. The original 10-loop hit the 5s default.
    for (let index = 0; index < 3; index += 1) {
      const tick = runCli(root, ["tick", "--path", root]);
      expect(tick.code).toBe(0);
    }

    const docsDir = path.join(root, "docs", "afk-sessions");
    const sessionId = require("node:fs").readdirSync(docsDir)[0];
    const statePath = path.join(docsDir, sessionId, "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    expect(state.lastTickAt).toBeTruthy();
    expect(state.status).toBe("active");
  });
});
