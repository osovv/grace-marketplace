// FILE: src/afk/session.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Session state store + budget enforcement for /afk. CLI, not the LLM, decides when the session is over.
//   SCOPE: Create / read / write state.json atomically; expire check; counters; exit-code constants.
//   DEPENDS: node:fs, node:crypto, node:path
//   LINKS: M-AFK-SESSION
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   SessionStatus         - "active" | "expired" | "stopped" | "completed"
//   SessionState          - Shape of state.json
//   ActiveSessionCheck    - Discriminated result of checkActive (ok | expired | stopped | no-session)
//   newSessionId          - Compact ISO-ish id + 4-hex suffix (collision-safe within ms)
//   createSession         - Validate args, create docs/afk-sessions/<id>/, write state.json
//   listSessions          - List session ids in docs/afk-sessions
//   findActiveSession     - Return the most recent still-active session
//   readSession           - Read a session's state.json or null if missing
//   writeSession          - Atomic write of state.json via .tmp + renameSync
//   checkActive           - Discriminated check used by CLI to enforce budget
//   markStopped           - Transition session to stopped status
//   markCompleted         - Transition session to completed status
//   incrementCounter      - Atomic increment of commits / escalations / deferred
//   updateLastTick        - Stamp the last tick time
//   formatRemaining       - Human-readable "Xh Ym" for reports
//   resolveSessionPaths   - Resolve decisions.md / deferred.md / dashboard.md paths
//   EXIT_BUDGET_EXHAUSTED - Numeric exit code 42
//   EXIT_NO_SESSION       - Numeric exit code 43
//   EXIT_SESSION_STOPPED  - Numeric exit code 44
//   OpenAsk               - Shape: { correlationId, messageId, sentAt, title? }
//   AnswerRecord          - Shape: { verb, raw, source, recognized, receivedAt }
//   addOpenAsk            - Register an outstanding ask and clear any stale answer for it
//   recordAnswer          - Persist an answer and remove its ask from openAsks
//   getAnswer             - Look up a recorded answer without a network call
//   listOpenAsks          - Return currently outstanding asks
// END_MODULE_MAP

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

export type SessionStatus = "active" | "expired" | "stopped" | "completed";

export type OpenAsk = {
  correlationId: string;
  messageId: number | null;
  sentAt: string;
  title?: string;
};

export type AnswerRecord = {
  verb: string;
  raw: string;
  source: "button" | "text";
  recognized: boolean;
  receivedAt: string;
};

export type SessionState = {
  version: 1;
  id: string;
  createdAt: string;
  expiresAt: string;
  hours: number;
  budgetPercent: number | null;
  checkpointMinutes: number;
  status: SessionStatus;
  commits: number;
  escalations: number;
  deferred: number;
  lastTickAt: string | null;
  stopReason: string | null;
  openAsks?: OpenAsk[];
  answers?: Record<string, AnswerRecord>;
};

const STATE_FILENAME = "state.json";

function toIso(date: Date) {
  return date.toISOString();
}

function sessionsRoot(projectRoot: string) {
  return path.join(projectRoot, "docs", "afk-sessions");
}

function sessionDir(projectRoot: string, sessionId: string) {
  return path.join(sessionsRoot(projectRoot), sessionId);
}

function statePath(projectRoot: string, sessionId: string) {
  return path.join(sessionDir(projectRoot, sessionId), STATE_FILENAME);
}

export function newSessionId(now = new Date()) {
  // Compact ISO-ish id, safe for paths across Windows/Linux, with a 4-hex-char suffix to
  // prevent collision when two sessions happen to be created in the same millisecond (or
  // when a test fakes `now` to a constant value, which is common).
  const stamp = now
    .toISOString()
    .replace(/[:.]/g, "")
    .replace(/Z$/, "Z")
    .slice(0, 17);
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

export function createSession(
  projectRoot: string,
  args: { hours: number; budgetPercent?: number | null; checkpointMinutes?: number },
  now: Date = new Date(),
): SessionState {
  const hours = Number(args.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    throw new Error(`hours must be in (0, 24], got ${args.hours}`);
  }

  const checkpointMinutes = args.checkpointMinutes ?? 30;
  if (!Number.isFinite(checkpointMinutes) || checkpointMinutes < 5 || checkpointMinutes > 180) {
    throw new Error(`--checkpoint must be in [5, 180] minutes, got ${checkpointMinutes}`);
  }

  const expiresAt = new Date(now.getTime() + hours * 3600 * 1000);
  const id = newSessionId(now);
  const state: SessionState = {
    version: 1,
    id,
    createdAt: toIso(now),
    expiresAt: toIso(expiresAt),
    hours,
    budgetPercent: args.budgetPercent ?? null,
    checkpointMinutes,
    status: "active",
    commits: 0,
    escalations: 0,
    deferred: 0,
    lastTickAt: null,
    stopReason: null,
    openAsks: [],
    answers: {},
  };

  const dir = sessionDir(projectRoot, id);
  mkdirSync(dir, { recursive: true });
  writeSession(projectRoot, state);
  return state;
}

export function listSessions(projectRoot: string): string[] {
  const root = sessionsRoot(projectRoot);
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root)
    .filter((name) => statSync(path.join(root, name)).isDirectory())
    .sort();
}

export function findActiveSession(projectRoot: string, now: Date = new Date()): SessionState | null {
  const ids = listSessions(projectRoot);
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    const id = ids[index]!;
    const state = readSession(projectRoot, id);
    if (!state) {
      continue;
    }
    if (state.status === "active" && new Date(state.expiresAt).getTime() > now.getTime()) {
      return state;
    }
  }
  return null;
}

export function readSession(projectRoot: string, sessionId: string): SessionState | null {
  const file = statePath(projectRoot, sessionId);
  if (!existsSync(file)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(file, "utf8")) as SessionState;
  } catch {
    return null;
  }
}

export function writeSession(projectRoot: string, state: SessionState) {
  const dir = sessionDir(projectRoot, state.id);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  // Atomic write: serialize to a sibling .tmp file, then rename.
  // rename(2) is atomic on POSIX and NTFS when source and target are on the same filesystem.
  // Protects against concurrent `grace afk tick` / `grace afk journal` / `grace afk increment`
  // calls from the agent clobbering each other's updates.
  const targetPath = statePath(projectRoot, state.id);
  const tmpPath = `${targetPath}.${randomBytes(3).toString("hex")}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  renameSync(tmpPath, targetPath);
}

export type ActiveSessionCheck =
  | { ok: true; session: SessionState; remainingMs: number }
  | { ok: false; reason: "no-active-session" | "expired" | "stopped"; session: SessionState | null; remainingMs: number };

export function checkActive(projectRoot: string, now: Date = new Date()): ActiveSessionCheck {
  const session = findActiveSession(projectRoot, now);
  if (!session) {
    const latestId = listSessions(projectRoot).slice(-1)[0];
    const latest = latestId ? readSession(projectRoot, latestId) : null;
    if (latest && latest.status === "stopped") {
      return { ok: false, reason: "stopped", session: latest, remainingMs: 0 };
    }
    if (latest && new Date(latest.expiresAt).getTime() <= now.getTime()) {
      return { ok: false, reason: "expired", session: latest, remainingMs: 0 };
    }
    return { ok: false, reason: "no-active-session", session: latest, remainingMs: 0 };
  }

  const remainingMs = new Date(session.expiresAt).getTime() - now.getTime();
  return { ok: true, session, remainingMs };
}

export function markStopped(
  projectRoot: string,
  sessionId: string,
  reason: string,
  now: Date = new Date(),
): SessionState | null {
  const state = readSession(projectRoot, sessionId);
  if (!state) {
    return null;
  }
  state.status = "stopped";
  state.stopReason = reason;
  state.lastTickAt = toIso(now);
  writeSession(projectRoot, state);
  return state;
}

export function markCompleted(projectRoot: string, sessionId: string, now: Date = new Date()): SessionState | null {
  const state = readSession(projectRoot, sessionId);
  if (!state) {
    return null;
  }
  state.status = "completed";
  state.lastTickAt = toIso(now);
  writeSession(projectRoot, state);
  return state;
}

export function incrementCounter(
  projectRoot: string,
  sessionId: string,
  field: "commits" | "escalations" | "deferred",
  now: Date = new Date(),
): SessionState | null {
  const state = readSession(projectRoot, sessionId);
  if (!state) {
    return null;
  }
  state[field] += 1;
  state.lastTickAt = toIso(now);
  writeSession(projectRoot, state);
  return state;
}

export function updateLastTick(projectRoot: string, sessionId: string, now: Date = new Date()): SessionState | null {
  const state = readSession(projectRoot, sessionId);
  if (!state) {
    return null;
  }
  state.lastTickAt = toIso(now);
  writeSession(projectRoot, state);
  return state;
}

// START_CONTRACT: addOpenAsk
//   PURPOSE: Register a new outstanding ask on the session. Removes any stale answer for the same correlationId.
//   INPUTS: { projectRoot, sessionId, ask: OpenAsk }
//   OUTPUTS: SessionState | null
//   SIDE_EFFECTS: Atomic write of state.json.
// END_CONTRACT: addOpenAsk
export function addOpenAsk(projectRoot: string, sessionId: string, ask: OpenAsk): SessionState | null {
  const state = readSession(projectRoot, sessionId);
  if (!state) {
    return null;
  }
  state.openAsks = state.openAsks ?? [];
  state.answers = state.answers ?? {};
  state.openAsks = state.openAsks.filter((item) => item.correlationId !== ask.correlationId);
  state.openAsks.push(ask);
  delete state.answers[ask.correlationId];
  writeSession(projectRoot, state);
  return state;
}

// START_CONTRACT: recordAnswer
//   PURPOSE: Persist an answer for an outstanding ask, removing it from openAsks.
//   INPUTS: { projectRoot, sessionId, correlationId, answer: AnswerRecord }
//   OUTPUTS: SessionState | null
//   SIDE_EFFECTS: Atomic write of state.json.
// END_CONTRACT: recordAnswer
export function recordAnswer(
  projectRoot: string,
  sessionId: string,
  correlationId: string,
  answer: AnswerRecord,
): SessionState | null {
  const state = readSession(projectRoot, sessionId);
  if (!state) {
    return null;
  }
  state.openAsks = (state.openAsks ?? []).filter((item) => item.correlationId !== correlationId);
  state.answers = state.answers ?? {};
  state.answers[correlationId] = answer;
  writeSession(projectRoot, state);
  return state;
}

// START_CONTRACT: getAnswer
//   PURPOSE: Look up a previously recorded answer without a network call.
//   INPUTS: { projectRoot, sessionId, correlationId }
//   OUTPUTS: AnswerRecord | null
//   SIDE_EFFECTS: none (single file read)
// END_CONTRACT: getAnswer
export function getAnswer(
  projectRoot: string,
  sessionId: string,
  correlationId: string,
): AnswerRecord | null {
  const state = readSession(projectRoot, sessionId);
  if (!state || !state.answers) {
    return null;
  }
  return state.answers[correlationId] ?? null;
}

// START_CONTRACT: listOpenAsks
//   PURPOSE: Return the current list of outstanding asks for the session.
//   INPUTS: { projectRoot, sessionId }
//   OUTPUTS: OpenAsk[]
//   SIDE_EFFECTS: none
// END_CONTRACT: listOpenAsks
export function listOpenAsks(projectRoot: string, sessionId: string): OpenAsk[] {
  const state = readSession(projectRoot, sessionId);
  return state?.openAsks ?? [];
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) {
    return "0m";
  }
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

export const EXIT_BUDGET_EXHAUSTED = 42;
export const EXIT_NO_SESSION = 43;
export const EXIT_SESSION_STOPPED = 44;

export function resolveSessionPaths(projectRoot: string, sessionId: string) {
  const dir = sessionDir(projectRoot, sessionId);
  return {
    dir,
    statePath: statePath(projectRoot, sessionId),
    decisionsPath: path.join(dir, "decisions.md"),
    deferredPath: path.join(dir, "deferred.md"),
    dashboardPath: path.join(dir, "dashboard.md"),
  };
}

// START_CHANGE_SUMMARY
//   LAST_CHANGE: [3.7.0-grace-afk] Initial module. writeSession uses atomic rename to protect
//                concurrent tick/journal/increment updates. newSessionId now includes 4 hex
//                chars of randomness to avoid same-millisecond collisions.
// END_CHANGE_SUMMARY
