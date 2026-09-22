import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** One executed command recorded in meta.json. */
export type RunMetaCommand = {
  index: number;
  assertionId: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  skipped: boolean;
  logFile: string | null;
};

/**
 * Terminal statuses are written when the run ends. `running` is written at run start and is
 * replaced on completion; a `running` meta left behind by a process that no longer exists is
 * reclassified as `killed` by reconcileRunMeta.
 */
export type RunStatus = "running" | "passed" | "failed" | "timeout" | "interrupted" | "killed";

/** VCS identity of the tree a run executed against; all null outside a git repository. */
export type RunVcsIdentity = {
  head: string | null;
  branch: string | null;
  dirty: boolean | null;
};

/**
 * meta.json, written at the start of a lint --run-commands invocation with status `running`
 * and rewritten once the run completes. `finishedAt` is null until then.
 */
export type RunMeta = RunVcsIdentity & {
  schemaVersion: "1.1.0";
  tool: "grace-lint";
  changeId: string | null;
  assertionMode: string;
  projectRoot: string;
  slug: string;
  /** Pid of the process that wrote this meta; the liveness probe behind the `killed` status. */
  pid: number;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  commands: RunMetaCommand[];
};

/** Current meta.json schema; bumped when RunMeta gains fields or statuses. */
export const RUN_META_SCHEMA_VERSION = "1.1.0" as const;

/**
 * How many *prunable* run directories per project survive pruning after each run.
 * The newest passing run of every change is protected and never counted here.
 */
export const RUN_RETENTION = 10;

/** Upper bound on each git probe so a wedged git never stalls a gate run. */
const VCS_PROBE_TIMEOUT_MS = 5000;

/**
 * Resolves the command-run log root: ${XDG_CACHE_HOME:-~/.cache}/grace/run-commands.
 * An empty XDG_CACHE_HOME is ignored per the XDG base directory specification.
 */
export function resolveLogRoot(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && xdg.trim() ? xdg : path.join(homedir(), ".cache");
  return path.join(base, "grace", "run-commands");
}

/**
 * Stable directory key for one project root: sanitized basename plus the first
 * eight hex characters of the sha1 of the absolute root, so same-named projects
 * in different locations never collide.
 */
export function projectSlug(root: string): string {
  const absolute = path.resolve(root);
  const base = path.basename(absolute).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  const hash = createHash("sha1").update(absolute).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

/**
 * Creates and returns the run directory runs/yyyy-MM-ddTHH-mm-ss[_C-CHANGE] under
 * logRoot/slug. Same-second collisions append a -2, -3, ... suffix.
 */
export function createRunDir(logRoot: string, slug: string, startedAt: Date, changeId?: string): string {
  const stamp = formatStamp(startedAt);
  const suffix = changeId ? `_${changeId}` : "";
  const runsParent = path.join(logRoot, slug, "runs");
  let candidate = path.join(runsParent, `${stamp}${suffix}`);
  let counter = 2;
  while (existsSafe(candidate)) {
    candidate = path.join(runsParent, `${stamp}${suffix}-${counter}`);
    counter += 1;
  }
  mkdirSync(candidate, { recursive: true });
  return candidate;
}

/** Best-effort meta.json write; returns false (never throws) on filesystem errors. */
export function writeRunMeta(runDir: string, meta: RunMeta): boolean {
  try {
    writeFileSync(path.join(runDir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the HEAD sha, the current branch, and whether the worktree carries uncommitted changes,
 * so recorded evidence can be tied to the tree it ran against. A detached HEAD reports a null
 * branch. Every failure mode — no git on PATH, not a repository, no commits yet, a probe that
 * times out — degrades to nulls and never throws, because identity is metadata and must not
 * take a gate run down with it.
 */
export function readVcsIdentity(root: string): RunVcsIdentity {
  const unknown: RunVcsIdentity = { head: null, branch: null, dirty: null };
  try {
    const revision = gitProbe(root, ["rev-parse", "HEAD", "--abbrev-ref", "HEAD"]);
    if (revision === null) {
      return unknown;
    }
    const [head = "", ref = ""] = revision.split("\n").map((line) => line.trim());
    if (!/^[0-9a-f]{7,64}$/.test(head)) {
      return unknown;
    }
    const porcelain = gitProbe(root, ["status", "--porcelain"]);
    return {
      head,
      branch: ref && ref !== "HEAD" ? ref : null,
      dirty: porcelain === null ? null : porcelain.trim().length > 0,
    };
  } catch {
    return unknown;
  }
}

/** True when `pid` names a live process. EPERM counts as alive: it exists, we just cannot signal it. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === "EPERM";
  }
}

/** Parses runDir/meta.json; null when it is missing, unreadable, or not a JSON object. */
export function readRunMeta(runDir: string): RunMeta | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path.join(runDir, "meta.json"), "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as RunMeta) : null;
  } catch {
    return null;
  }
}

/**
 * Distinguishes a run still in flight from one the OS killed. A `running` meta whose writing
 * process is gone can never complete itself, so it is rewritten as `killed` and returned that
 * way; `finishedAt` stays null because the moment of death is unknown. Runs owned by a live
 * process, runs already in a terminal status, and directories without a readable meta.json are
 * returned unchanged. Called for every surviving run directory on prune, so the next run heals
 * the records left by earlier ones.
 */
export function reconcileRunMeta(runDir: string): RunMeta | null {
  const meta = readRunMeta(runDir);
  if (!meta || meta.status !== "running") {
    return meta;
  }
  if (typeof meta.pid !== "number" || meta.pid === process.pid || isProcessAlive(meta.pid)) {
    return meta;
  }
  const killed: RunMeta = { ...meta, status: "killed" };
  writeRunMeta(runDir, killed);
  return killed;
}

/**
 * Removes stale run directories, protecting the evidence an archive can cite: the newest
 * run with `status: "passed"` of every change survives indefinitely. Everything else is
 * prunable — failed, timed out, interrupted and killed runs, a run still recorded as
 * `running` whose writer is gone, passing runs superseded by a newer pass of the same
 * change, passing runs with no `changeId` (unbound lint runs nothing cites), and runs
 * whose meta.json is missing or unparseable (a run killed before it wrote one) — and only
 * the newest `keep` of those survive. Surviving directories are reconciled first, so runs
 * the OS killed stop reading as in flight. Directory names sort lexically, which is
 * chronological for the timestamp format above. Missing or empty parents are a no-op;
 * individual removal failures never throw.
 */
export function pruneRuns(projectRunsParent: string, keep: number = RUN_RETENTION): void {
  let entries: string[];
  try {
    entries = readdirSync(projectRunsParent);
  } catch {
    return;
  }
  const dirs = entries
    .filter((name) => statSafe(path.join(projectRunsParent, name))?.isDirectory() ?? false)
    .sort()
    .reverse();

  const protectedChanges = new Set<string>();
  const prunable: string[] = [];
  for (const name of dirs) {
    const dir = path.join(projectRunsParent, name);
    reconcileRunMeta(dir);
    const meta = readRunMeta(dir);
    const changeId = typeof meta?.changeId === "string" && meta.changeId ? meta.changeId : null;
    if (meta?.status === "passed" && changeId && !protectedChanges.has(changeId)) {
      protectedChanges.add(changeId);
      continue;
    }
    prunable.push(name);
  }

  for (const stale of prunable.slice(Math.max(0, keep))) {
    try {
      rmSync(path.join(projectRunsParent, stale), { recursive: true, force: true });
    } catch {
      // Retention pruning is best-effort; a stale directory is harmless.
    }
  }
}

/**
 * Builds the log file name `${index}-${slug}.log` where slug sanitizes the command
 * to lowercase [a-z0-9-] with at most 40 characters, falling back to "command".
 */
export function commandLogFileName(index: number, command: string): string {
  const slug = command
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `${index}-${slug || "command"}.log`;
}

/** Runs one read-only git command in `root`; null when git is absent or the command fails. */
function gitProbe(root: string, args: string[]): string | null {
  try {
    const result = Bun.spawnSync({
      cmd: ["git", ...args],
      cwd: root,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: VCS_PROBE_TIMEOUT_MS,
    });
    return result.exitCode === 0 ? new TextDecoder().decode(result.stdout) : null;
  } catch {
    return null;
  }
}

function formatStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

function existsSafe(target: string): boolean {
  try {
    return statSync(target).isFile() || statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function statSafe(target: string) {
  try {
    return statSync(target);
  } catch {
    return null;
  }
}
