// FILE: scripts/release-summary.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Provide deterministic helpers for mandatory release changelog summary generation and validation.
//   SCOPE: Environment option parsing, commit metadata and full per-commit diff formatting, restricted OpenCode config construction, JSONL event parsing, XML-like summary extraction, summary validation, retry orchestration, changelog injection, and latest changelog summary validation.
//   DEPENDS: [node:child_process]
//   LINKS: [M-RELEASE-AUTOMATION, VF-RELEASE-AUTOMATION]
//   ROLE: SCRIPT
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   DEFAULT_RELEASE_SUMMARY_MODEL - Default provider/model for release summary generation.
//   DEFAULT_RELEASE_SUMMARY_TIMEOUT_MS - Default per-attempt OpenCode timeout.
//   RELEASE_SUMMARY_MAX_ATTEMPTS - Total attempts before release:bump aborts.
//   resolveReleaseSummaryOptions - Parses env overrides and returns validated model/timeout settings.
//   collectReleaseCommitMetadata - Reads git metadata and full per-commit diffs from latest reachable tag to HEAD through an injected runner.
//   buildReleaseSummaryPrompt - Builds the stdin prompt payload for the restricted release-summary agent.
//   buildReleaseSummaryAgentConfig - Builds OPENCODE_CONFIG_CONTENT for the restricted primary release-summary agent.
//   parseOpencodeRunJsonOutput - Parses OpenCode JSONL stdout into accumulated model text or a failure.
//   extractSummaryEnvelope - Extracts a single XML-like summary envelope.
//   validateReleaseSummary - Validates the paragraph summary content contract.
//   injectSummaryIntoChangelogEntry - Inserts ### Summary after the release heading.
//   validateLatestChangelogSummary - Validates only the top changelog release block.
//   generateReleaseSummaryWithRetries - Runs the injected OpenCode runner with retry/backoff and returns a valid summary.
//   RELEASE_SUMMARY_AGENT_NAME - Canonical release-summary agent name.
//   ReleaseCommitMetadata - Commit metadata type including full per-commit diff.
//   ReleaseSummaryOptions - Validated runtime options for summary generation.
//   ReleaseSummaryPromptInput - Input used to build the release summary prompt.
//   CaptureCommand - Function used to execute capture-only commands.
//   OpencodeRunRequest - Request passed to the injected OpenCode runner.
//   OpencodeRunResult - Result returned by the injected OpenCode runner.
//   OpencodeRunner - Function used to invoke OpenCode.
//   ReleaseSummaryAttempt - Failure or success for one summary generation attempt.
//   SummaryValidationResult - Parsed latest changelog block validation result.
// END_MODULE_MAP

export const DEFAULT_RELEASE_SUMMARY_MODEL = "deepseek/deepseek-v4-flash";
export const DEFAULT_RELEASE_SUMMARY_TIMEOUT_MS = 120_000;
export const RELEASE_SUMMARY_MAX_ATTEMPTS = 3;
export const RELEASE_SUMMARY_AGENT_NAME = "release-summary";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Commit metadata supplied to the summary prompt. */
export interface ReleaseCommitMetadata {
  /** Short commit hash, used only for traceability in the prompt. */
  hash: string;
  /** Commit subject line. */
  subject: string;
  /** Trimmed commit body, or an empty string when the commit has no body. */
  body: string;
  /** Full textual patch for this commit, or an empty string when no textual diff is available. */
  diff: string;
}

/** Validated runtime options for summary generation. */
export interface ReleaseSummaryOptions {
  /** Provider/model passed to opencode run and embedded in the inline agent config. */
  model: string;
  /** Per-attempt timeout in milliseconds. */
  timeoutMs: number;
}

/** Input used to build the release summary prompt. */
export interface ReleaseSummaryPromptInput {
  /** New package version after npm version runs. */
  version: string;
  /** Conventional changelog entry before summary injection. */
  changelogEntry: string;
  /** Commits included in this release range. */
  commits: ReleaseCommitMetadata[];
}

/** Function used to execute capture-only commands such as git log in tests and production. */
export type CaptureCommand = (command: string, args: string[], failureMessage: string) => string;

/** Request passed to the injected OpenCode runner. */
export interface OpencodeRunRequest {
  /** Environment variables, including OPENCODE_CONFIG_CONTENT. */
  env: NodeJS.ProcessEnv;
  /** Prompt input passed to stdin. */
  input: string;
  /** Per-attempt timeout in milliseconds. */
  timeoutMs: number;
  /** Model argument for opencode run. */
  model: string;
}

/** Result returned by the injected OpenCode runner. */
export interface OpencodeRunResult {
  /** Process exit code, or null when terminated by signal. */
  status: number | null;
  /** Optional process signal such as SIGTERM. */
  signal?: NodeJS.Signals | string | null;
  /** Captured stdout JSONL. */
  stdout: string;
  /** Captured stderr for diagnostics. */
  stderr: string;
  /** True when the attempt timed out. */
  timedOut?: boolean;
  /** Error code such as ENOENT when the binary is missing. */
  errorCode?: string;
}

/** Function used to invoke OpenCode; production wraps spawnSync, tests inject deterministic results. */
export type OpencodeRunner = (request: OpencodeRunRequest) => OpencodeRunResult;

/** Failure or success for one summary generation attempt. */
export type ReleaseSummaryAttempt =
  | { ok: true; summary: string; rawText: string }
  | { ok: false; retryable: boolean; reason: string; details?: string };

/** Parsed latest changelog block validation result. */
export type SummaryValidationResult =
  | { ok: true; summary: string }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// resolveReleaseSummaryOptions
// ---------------------------------------------------------------------------

/**
 * Parses GRACE_RELEASE_SUMMARY_MODEL and GRACE_RELEASE_SUMMARY_TIMEOUT_MS
 * for timeout. Throws a configuration error for missing/invalid timeout values
 * and defaults the model when unset.
 * The GRACE_RELEASE_SUMMARY_TIMEOUT_MS env var name is used for the timeout
 * to match the project convention for secret-prefixed configuration variables.
 */
export function resolveReleaseSummaryOptions(env: NodeJS.ProcessEnv): ReleaseSummaryOptions {
  const model = env.GRACE_RELEASE_SUMMARY_MODEL?.trim() || DEFAULT_RELEASE_SUMMARY_MODEL;
  const timeoutRaw = env.GRACE_RELEASE_SUMMARY_TIMEOUT_MS;

  if (timeoutRaw !== undefined && timeoutRaw !== null && timeoutRaw !== "") {
    const timeoutMs = Number(timeoutRaw);
    if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error(
        `Invalid GRACE_RELEASE_SUMMARY_TIMEOUT_MS: "${timeoutRaw}". Must be a positive integer.`,
      );
    }
    return { model, timeoutMs };
  }

  return { model, timeoutMs: DEFAULT_RELEASE_SUMMARY_TIMEOUT_MS };
}

// ---------------------------------------------------------------------------
// collectReleaseCommitMetadata
// ---------------------------------------------------------------------------

/**
 * Finds commits since the latest reachable tag using injected git command output.
 * Uses all reachable history when no tag is available and attaches each commit's full textual patch.
 */
export function collectReleaseCommitMetadata(runCapture: CaptureCommand): ReleaseCommitMetadata[] {
  let range: string;
  try {
    const tag = runCapture("git", ["describe", "--tags", "--abbrev=0"], "git describe failed").trim();
    range = `${tag}..HEAD`;
  } catch {
    // No tag exists — use all reachable history.
    range = "HEAD";
  }

  const output = runCapture(
    "git",
    ["log", range, "--format=%H%s%n%b%n---GITLOG---"],
    "git log failed while collecting commit metadata.",
  );

  const entries = output.split("---GITLOG---\n").filter(Boolean);
  const commits: ReleaseCommitMetadata[] = [];

  for (const entry of entries) {
    const lines = entry.split("\n").filter(Boolean);
    const hashLine = lines[0] ?? "";
    const fullHash = hashLine.slice(0, 40);
    const hash = hashLine.slice(0, 7);
    const subject = hashLine.slice(40).trim();
    const body = lines.slice(1).join("\n").trim();
    const diff = fullHash
      ? runCapture(
        "git",
        ["show", "--format=", "--patch", "--find-renames", fullHash],
        `git show failed while collecting full diff for commit ${hash}.`,
      ).trim()
      : "";
    commits.push({ hash, subject, body, diff });
  }

  return commits;
}

// ---------------------------------------------------------------------------
// buildReleaseSummaryAgentConfig
// ---------------------------------------------------------------------------

/**
 * Builds the restricted primary agent config used as OPENCODE_CONFIG_CONTENT.
 * The agent must deny every permission and perform exactly one model step.
 */
export function buildReleaseSummaryAgentConfig(model: string): string {
  const config = {
    agent: {
      [RELEASE_SUMMARY_AGENT_NAME]: {
        description: "Generate concise release changelog summaries from provided text only.",
        mode: "primary" as const,
        model,
        steps: 1,
        permission: { "*": "deny" as const },
        prompt: [
          "You generate concise release changelog summaries.",
          "Return only a single <summary>...</summary> envelope.",
          "Do not call tools. Do not ask questions.",
        ].join("\n"),
      },
    },
  };
  return JSON.stringify(config);
}

// ---------------------------------------------------------------------------
// buildReleaseSummaryPrompt
// ---------------------------------------------------------------------------

/**
 * Builds a deterministic prompt payload for stdin.
 * The prompt includes full commit diff context and instructs the model to return only a single <summary> envelope in English.
 */
export function buildReleaseSummaryPrompt(input: ReleaseSummaryPromptInput): string {
  const commitList = input.commits.map((c) => {
    let line = `  ${c.hash}: ${c.subject}`;
    if (c.body) line += `\n    ${c.body.split("\n").join("\n    ")}`;
    line += `\n    Full diff:`;
    line += c.diff
      ? `\n${c.diff.split("\n").map((diffLine) => `      ${diffLine}`).join("\n")}`
      : "\n      (no textual diff captured)";
    return line;
  }).join("\n\n");

  return [
    `You are generating the required release changelog summary for version ${input.version}.`,
    "",
    "Your ENTIRE response must be exactly:",
    "<summary>",
    "One paragraph in English explaining what changed and why it matters to users.",
    "</summary>",
    "",
    "Rules:",
    "- Write ONLY the <summary> envelope. No other text before or after.",
    "- The summary must be one concise paragraph in English.",
    "- Do NOT include markdown headings, code fences, or bullet points.",
    "- Do NOT mention AI, LLMs, language models, or generated-by-AI phrasing in the summary text.",
    "- If commit text mentions AI-generated summaries, describe the user value as release summaries or changelog summaries without the AI label.",
    "- Use only the changelog entry, commit metadata, and full commit diffs below as factual source material.",
    "- Do NOT invent status names, workflow states, commands, files, config keys, or user-facing behavior that are not present in the provided changelog, commit metadata, or diffs.",
    "- Focus on user-facing impact: what changed, why it matters.",
    "",
    "Changelog entry for this release:",
    input.changelogEntry,
    "",
    "Commits and full diffs in this release:",
    commitList,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// parseOpencodeRunJsonOutput
// ---------------------------------------------------------------------------

interface OpencodeJsonEvent {
  type: string;
  part?: { type?: string; text?: string; tool?: string };
}

/**
 * Parses OpenCode JSONL stdout and accumulates assistant text events.
 * Returns retryable failures for invalid JSONL, error events, tool_use events, or empty text.
 */
export function parseOpencodeRunJsonOutput(stdout: string): ReleaseSummaryAttempt {
  if (!stdout.trim()) {
    return { ok: false, retryable: true, reason: "OpenCode produced no output." };
  }

  const lines = stdout.split("\n").filter((l) => l.trim());
  let text = "";
  let hadTextEvent = false;

  for (const line of lines) {
    let event: OpencodeJsonEvent;
    try {
      event = JSON.parse(line) as OpencodeJsonEvent;
    } catch {
      return {
        ok: false,
        retryable: true,
        reason: `Invalid JSONL line: ${line.slice(0, 120)}`,
      };
    }

    if (event.type === "error") {
      return {
        ok: false,
        retryable: true,
        reason: "OpenCode reported an error event.",
        details: JSON.stringify(event),
      };
    }

    if (event.part?.type === "tool_use") {
      return {
        ok: false,
        retryable: true,
        reason: `OpenCode attempted to use a tool (${event.part.tool ?? "unknown"}), which is not allowed.`,
      };
    }

    if (event.type === "text" && event.part?.text) {
      text += event.part.text;
      hadTextEvent = true;
    }
  }

  if (!hadTextEvent || !text.trim()) {
    return { ok: false, retryable: true, reason: "OpenCode produced no text content." };
  }

  const trimmed = text.trim();
  const summaryResult = extractSummaryEnvelope(trimmed);

  if (!summaryResult.ok) {
    return {
      ok: false,
      retryable: true,
      reason: `Summary envelope is invalid: ${summaryResult.reason}`,
      details: trimmed.slice(0, 500),
    };
  }

  const proseResult = validateReleaseSummary(summaryResult.summary);
  if (!proseResult.ok) {
    return {
      ok: false,
      retryable: true,
      reason: `Summary prose is invalid: ${proseResult.reason}`,
      details: trimmed.slice(0, 500),
    };
  }

  return { ok: true, summary: summaryResult.summary, rawText: trimmed };
}

// ---------------------------------------------------------------------------
// extractSummaryEnvelope
// ---------------------------------------------------------------------------

const SUMMARY_ENVELOPE_RE = /^<summary>\s*([\s\S]*?)\s*<\/summary>$/;

/**
 * Extracts and validates the single XML-like <summary>...</summary> envelope.
 * Rejects extra useful text before or after the envelope.
 */
export function extractSummaryEnvelope(rawText: string): SummaryValidationResult {
  const trimmed = rawText.trim();

  if (!trimmed.startsWith("<summary>")) {
    return { ok: false, reason: "Response does not start with <summary>." };
  }

  if (!trimmed.endsWith("</summary>")) {
    return { ok: false, reason: "Response does not end with </summary>." };
  }

  const match = trimmed.match(SUMMARY_ENVELOPE_RE);
  if (!match) {
    return { ok: false, reason: "Could not extract summary from envelope." };
  }

  const innerText = match[1]!.trim();
  if (!innerText) {
    return { ok: false, reason: "Summary envelope is empty." };
  }

  // Check for more than one <summary> tag.
  const summaryCount = (trimmed.match(/<summary>/g) ?? []).length;
  if (summaryCount > 1) {
    return { ok: false, reason: "Multiple <summary> tags found." };
  }

  return { ok: true, summary: innerText };
}

// ---------------------------------------------------------------------------
// validateReleaseSummary
// ---------------------------------------------------------------------------

const AI_GENERATION_PATTERN = /\b(AI-generated|AI\s+generated|generated by (?:an?\s+)?(?:AI|artificial intelligence|LLM|language model|the model)|artificial intelligence generated|LLM[-\s]+generated|language model|written by AI)\b/i;
const FENCED_CODE_PATTERN = /```/;
const MARKDOWN_HEADING_PATTERN = /^#{1,6}\s/m;
const MAX_SUMMARY_LENGTH = 2000;

/**
 * Validates summary prose after envelope extraction.
 * Rejects empty text, fenced code, markdown headings, AI-generation mentions, and excessive length.
 */
export function validateReleaseSummary(summary: string): SummaryValidationResult {
  const trimmed = summary.trim();

  if (!trimmed) {
    return { ok: false, reason: "Summary is empty." };
  }

  if (trimmed.length > MAX_SUMMARY_LENGTH) {
    return { ok: false, reason: `Summary exceeds ${MAX_SUMMARY_LENGTH} characters (${trimmed.length}).` };
  }

  if (FENCED_CODE_PATTERN.test(trimmed)) {
    return { ok: false, reason: "Summary must not contain fenced code blocks." };
  }

  if (MARKDOWN_HEADING_PATTERN.test(trimmed)) {
    return { ok: false, reason: "Summary must not contain markdown headings." };
  }

  if (AI_GENERATION_PATTERN.test(trimmed)) {
    return { ok: false, reason: "Summary must not mention AI generation." };
  }

  return { ok: true, summary: trimmed };
}

// ---------------------------------------------------------------------------
// injectSummaryIntoChangelogEntry
// ---------------------------------------------------------------------------

/**
 * Inserts a validated summary under a ### Summary heading after the first release header.
 * Preserves all conventional commit details below the inserted section.
 */
export function injectSummaryIntoChangelogEntry(changelogEntry: string, summary: string): string {
  const lines = changelogEntry.split("\n");
  const headerIndex = lines.findIndex((l) => l.startsWith("##"));

  if (headerIndex === -1) {
    return changelogEntry;
  }

  const before = lines.slice(0, headerIndex + 1);
  const after = lines.slice(headerIndex + 1);

  let bodyStart = 0;
  while (bodyStart < after.length && after[bodyStart]!.trim() === "") {
    bodyStart++;
  }

  const body = after.slice(bodyStart);

  return [
    ...before,
    "",
    "### Summary",
    "",
    summary,
    "",
    ...body,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// validateLatestChangelogSummary
// ---------------------------------------------------------------------------

/**
 * Validates the latest/top release block in CHANGELOG.md and ignores older entries.
 */
export function validateLatestChangelogSummary(changelogText: string): SummaryValidationResult {
  const firstHeaderMatch = changelogText.match(/^##\s+[^\n]+/m);
  if (!firstHeaderMatch) {
    return { ok: false, reason: "No release header found in CHANGELOG.md." };
  }

  const firstHeaderStart = firstHeaderMatch.index!;
  const secondHeaderMatch = changelogText.slice(firstHeaderStart + 1).match(/^##\s+[^\n]+/m);

  const latestBlockEnd = secondHeaderMatch
    ? firstHeaderStart + 1 + secondHeaderMatch.index!
    : changelogText.length;

  const latestBlock = changelogText.slice(firstHeaderStart, latestBlockEnd);

  // Find the ### Summary heading in the latest block.
  const summaryHeadingIndex = latestBlock.indexOf("### Summary");
  if (summaryHeadingIndex === -1) {
    return { ok: false, reason: "Latest release block has no ### Summary section." };
  }

  // Extract text after the ### Summary line until the next commit line or end.
  const afterSummary = latestBlock.slice(summaryHeadingIndex + "### Summary".length);
  const nextCommitOrHeader = afterSummary.search(/\n\*|\n##/);
  const summaryText = (nextCommitOrHeader === -1 ? afterSummary : afterSummary.slice(0, nextCommitOrHeader)).trim();

  if (!summaryText) {
    return { ok: false, reason: "Latest release summary section is empty." };
  }

  return validateReleaseSummary(summaryText);
}

// ---------------------------------------------------------------------------
// generateReleaseSummaryWithRetries
// ---------------------------------------------------------------------------

/**
 * Runs OpenCode with retryable failure handling and returns a valid summary string.
 * Throws non-retryable configuration errors immediately and retry exhaustion errors after three attempts.
 */
export function generateReleaseSummaryWithRetries(
  runner: OpencodeRunner,
  input: ReleaseSummaryPromptInput,
  options: ReleaseSummaryOptions,
  sleepMs: (ms: number) => void,
): string {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= RELEASE_SUMMARY_MAX_ATTEMPTS; attempt++) {
    const prompt = buildReleaseSummaryPrompt(input);
    const agentConfig = buildReleaseSummaryAgentConfig(options.model);

    const request: OpencodeRunRequest = {
      env: { ...process.env, OPENCODE_CONFIG_CONTENT: agentConfig },
      input: prompt,
      model: options.model,
      timeoutMs: options.timeoutMs,
    };

    const result = runner(request);

    // Non-retryable errors: binary not found.
    if (result.errorCode === "ENOENT") {
      throw new Error("opencode binary not found in PATH. Ensure opencode is installed.");
    }

    // Non-retryable errors: killed by signal (not timeout)
    if (result.signal && result.signal !== "SIGTERM" && !result.timedOut) {
      throw new Error(`OpenCode was killed by signal ${result.signal}. Release summary aborted.`);
    }

    if (result.timedOut) {
      lastError = `Attempt ${attempt}/${RELEASE_SUMMARY_MAX_ATTEMPTS}: OpenCode timed out.`;
      if (attempt < RELEASE_SUMMARY_MAX_ATTEMPTS) {
        sleepMs(2_000);
      }
      continue;
    }

    if (result.status !== 0) {
      lastError = `Attempt ${attempt}/${RELEASE_SUMMARY_MAX_ATTEMPTS}: OpenCode exited with code ${result.status}. stderr: ${result.stderr.slice(0, 300)}`;
      if (attempt < RELEASE_SUMMARY_MAX_ATTEMPTS) {
        sleepMs(2_000);
      }
      continue;
    }

    const parsed = parseOpencodeRunJsonOutput(result.stdout);

    if (parsed.ok) {
      return parsed.summary;
    }

    if (!parsed.retryable) {
      throw new Error(`Release summary generation failed: ${parsed.reason}`);
    }

    lastError = `Attempt ${attempt}/${RELEASE_SUMMARY_MAX_ATTEMPTS}: ${parsed.reason}`;
    if (parsed.details) {
      lastError += `\n  Details: ${parsed.details}`;
    }

    if (attempt < RELEASE_SUMMARY_MAX_ATTEMPTS) {
      sleepMs(2_000);
    }
  }

  throw new Error(
    `Release summary generation failed after ${RELEASE_SUMMARY_MAX_ATTEMPTS} attempts.\n` +
    `Last error: ${lastError}\n` +
    "The npm version step may have already changed package.json or npm-managed lockfiles; revert those local changes before retrying if needed.",
  );
}
