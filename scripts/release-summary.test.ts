import { describe, expect, it } from "bun:test";
import {
  buildReleaseSummaryAgentConfig,
  buildReleaseSummaryPrompt,
  extractSummaryEnvelope,
  injectSummaryIntoChangelogEntry,
  resolveReleaseSummaryOptions,
  validateLatestChangelogSummary,
  validateReleaseSummary,
} from "./release-summary.ts";

// ---------------------------------------------------------------------------
// extractSummaryEnvelope
// ---------------------------------------------------------------------------
describe("extractSummaryEnvelope", () => {
  it("extracts valid summary", () => {
    const result = extractSummaryEnvelope("<summary>Fixed a bug.</summary>");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toBe("Fixed a bug.");
  });

  it("rejects missing opening tag", () => {
    const result = extractSummaryEnvelope("no summary tag");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("<summary>");
  });

  it("rejects missing closing tag", () => {
    const result = extractSummaryEnvelope("<summary>no close");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("</summary>");
  });

  it("rejects empty envelope", () => {
    const result = extractSummaryEnvelope("<summary></summary>");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("empty");
  });

  it("rejects multiple summary tags", () => {
    const result = extractSummaryEnvelope("<summary>First</summary>\n<summary>Second</summary>");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("Multiple");
  });

  it("handles multi-line content", () => {
    const result = extractSummaryEnvelope("<summary>\n  Line one.\n  Line two.\n</summary>");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toBe("Line one.\n  Line two.");
  });
});

// ---------------------------------------------------------------------------
// validateReleaseSummary
// ---------------------------------------------------------------------------
describe("validateReleaseSummary", () => {
  it("accepts valid summary", () => {
    const result = validateReleaseSummary("Fixed a critical bug in the parser.");
    expect(result.ok).toBe(true);
  });

  it("rejects empty text", () => {
    const result = validateReleaseSummary("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("empty");
  });

  it("rejects fenced code blocks", () => {
    const result = validateReleaseSummary("Some text with ```code``` inside.");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("code");
  });

  it("rejects markdown headings", () => {
    const result = validateReleaseSummary("# Heading\nSome text.");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("headings");
  });

  it("rejects excessive length", () => {
    const result = validateReleaseSummary("x".repeat(2001));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("2000");
  });

  it("rejects AI-generation language", () => {
    const result = validateReleaseSummary("This AI-generated summary describes...");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("AI");
  });
});

// ---------------------------------------------------------------------------
// injectSummaryIntoChangelogEntry
// ---------------------------------------------------------------------------
describe("injectSummaryIntoChangelogEntry", () => {
  it("injects summary after release header", () => {
    const entry = "## <small>1.0.0 (2026-01-01)</small>\n\n* feat: add feature";
    const result = injectSummaryIntoChangelogEntry(entry, "A new feature.");
    expect(result).toContain("### Summary");
    expect(result).toContain("A new feature.");
    expect(result).toContain("* feat: add feature");
  });

  it("preserves entry when no header found", () => {
    const entry = "No header here";
    const result = injectSummaryIntoChangelogEntry(entry, "Summary.");
    expect(result).toBe(entry);
  });

  it("positions summary before body content", () => {
    const entry = "## <small>2.0.0 (2026-06-01)</small>\n\n### Added\n\n- New thing\n\n### Fixed\n\n- Bug fix";
    const result = injectSummaryIntoChangelogEntry(entry, "Major release.");
    const summaryIdx = result.indexOf("### Summary");
    const addedIdx = result.indexOf("### Added");
    expect(summaryIdx).toBeGreaterThan(0);
    expect(addedIdx).toBeGreaterThan(summaryIdx);
  });
});

// ---------------------------------------------------------------------------
// validateLatestChangelogSummary
// ---------------------------------------------------------------------------
describe("validateLatestChangelogSummary", () => {
  it("validates the top release block summary", () => {
    const changelog = `## <small>1.0.0 (2026-01-01)</small>

### Summary

Fixed a bug.

* details
`;
    const result = validateLatestChangelogSummary(changelog);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toBe("Fixed a bug.");
  });

  it("rejects changelog with no release header", () => {
    const result = validateLatestChangelogSummary("No headers here");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("No release header");
  });

  it("rejects changelog with no summary section", () => {
    const changelog = `## <small>1.0.0 (2026-01-01)</small>

### Added

- Something
`;
    const result = validateLatestChangelogSummary(changelog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no ### Summary");
  });

  it("rejects empty summary text", () => {
    const changelog = `## <small>1.0.0 (2026-01-01)</small>

### Summary
`;
    const result = validateLatestChangelogSummary(changelog);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("empty");
  });

  it("validates only the latest block and ignores older entries", () => {
    const changelog = `## <small>2.0.0 (2026-06-01)</small>

### Summary

Second release.

* more

## <small>1.0.0 (2026-01-01)</small>

### Summary

First release.

* initial
`;
    const result = validateLatestChangelogSummary(changelog);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toBe("Second release.");
  });
});

// ---------------------------------------------------------------------------
// buildReleaseSummaryAgentConfig
// ---------------------------------------------------------------------------
describe("buildReleaseSummaryAgentConfig", () => {
  it("returns valid JSON config with the given model", () => {
    const config = buildReleaseSummaryAgentConfig("test-model");
    const parsed = JSON.parse(config);
    expect(parsed.agent["release-summary"]).toBeDefined();
    expect(parsed.agent["release-summary"].model).toBe("test-model");
    expect(parsed.agent["release-summary"].steps).toBe(1);
    expect(parsed.agent["release-summary"].permission).toEqual({ "*": "deny" });
  });
});

// ---------------------------------------------------------------------------
// buildReleaseSummaryPrompt
// ---------------------------------------------------------------------------
describe("buildReleaseSummaryPrompt", () => {
  it("includes version and changelog entry in output", () => {
    const result = buildReleaseSummaryPrompt({
      version: "1.0.0",
      changelogEntry: "## <small>1.0.0</small>\n\n- something",
      commits: [],
    });
    expect(result).toContain("1.0.0");
    expect(result).toContain("## <small>1.0.0</small>");
  });
});

// ---------------------------------------------------------------------------
// resolveReleaseSummaryOptions
// ---------------------------------------------------------------------------
describe("resolveReleaseSummaryOptions", () => {
  it("returns defaults when no env vars set", () => {
    const opts = resolveReleaseSummaryOptions({});
    expect(opts.model).toBe("deepseek/deepseek-v4-flash");
    expect(opts.timeoutMs).toBe(120_000);
  });

  it("parses GRACE_RELEASE_SUMMARY_MODEL", () => {
    const opts = resolveReleaseSummaryOptions({ GRACE_RELEASE_SUMMARY_MODEL: "custom-model" });
    expect(opts.model).toBe("custom-model");
  });

  it("parses GRACE_RELEASE_SUMMARY_TIMEOUT_MS as integer", () => {
    const opts = resolveReleaseSummaryOptions({ GRACE_RELEASE_SUMMARY_TIMEOUT_MS: "30000" });
    expect(opts.timeoutMs).toBe(30000);
  });

  it("throws on invalid GRACE_RELEASE_SUMMARY_TIMEOUT_MS", () => {
    expect(() => resolveReleaseSummaryOptions({ GRACE_RELEASE_SUMMARY_TIMEOUT_MS: "not-a-number" })).toThrow(
      "positive integer",
    );
  });

  it("ignores empty GRACE_RELEASE_SUMMARY_TIMEOUT_MS", () => {
    const opts = resolveReleaseSummaryOptions({ GRACE_RELEASE_SUMMARY_TIMEOUT_MS: "" });
    expect(opts.timeoutMs).toBe(120_000);
  });
});
