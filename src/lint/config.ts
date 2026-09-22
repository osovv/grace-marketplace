import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { RUN_RETENTION } from "../grace4/run-log-store";
import type { GraceLintConfig, LintIssue } from "./types";

const CONFIG_FILE_NAME = ".grace-lint.json";
const SUPPORTED_KEYS = new Set(["ignoredDirs", "runLogRetention"]);

export function loadGraceLintConfig(projectRoot: string): { config: GraceLintConfig | null; issues: LintIssue[] } {
  const configPath = path.join(projectRoot, CONFIG_FILE_NAME);
  if (!existsSync(configPath)) {
    return { config: null as GraceLintConfig | null, issues: [] as LintIssue[] };
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as GraceLintConfig;
    const issues: LintIssue[] = [];

    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      issues.push({
        severity: "error",
        code: "config.invalid-shape",
        file: CONFIG_FILE_NAME,
        message: `${CONFIG_FILE_NAME} must contain a JSON object.`,
      });
      return { config: parsed, issues };
    }

    for (const key of Object.keys(parsed)) {
      if (SUPPORTED_KEYS.has(key)) {
        continue;
      }

      issues.push({
        severity: "error",
        code: "config.unknown-key",
        file: CONFIG_FILE_NAME,
        message: `Unsupported key \`${key}\` in ${CONFIG_FILE_NAME}. Supported keys: ignoredDirs, runLogRetention.`,
      });
    }

    if (parsed.ignoredDirs && !Array.isArray(parsed.ignoredDirs)) {
      issues.push({
        severity: "error",
        code: "config.invalid-ignored-dirs",
        file: CONFIG_FILE_NAME,
        message: `\`ignoredDirs\` in ${CONFIG_FILE_NAME} must be an array of directory names.`,
      });
    }

    if (parsed.runLogRetention !== undefined && !isRetentionCount(parsed.runLogRetention)) {
      issues.push({
        severity: "error",
        code: "config.invalid-run-log-retention",
        file: CONFIG_FILE_NAME,
        message: `\`runLogRetention\` in ${CONFIG_FILE_NAME} must be a non-negative integer number of run directories.`,
      });
    }

    return { config: parsed, issues };
  } catch (error) {
    return {
      config: null,
      issues: [
        {
          severity: "error",
          code: "config.invalid-json",
          file: CONFIG_FILE_NAME,
          message: `Failed to parse ${CONFIG_FILE_NAME}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

/**
 * Resolves how many non-passing run directories the command-run log keeps: an explicit
 * `--keepRuns` value wins over `.grace-lint.json`'s `runLogRetention`, which wins over
 * RUN_RETENTION. A configured value that is not a non-negative integer is reported as
 * `config.invalid-run-log-retention` and ignored here, so lint keeps the default.
 */
export function resolveRunLogRetention(override: number | undefined, config: GraceLintConfig | null): number {
  if (isRetentionCount(override)) {
    return override;
  }
  const configured = config?.runLogRetention;
  return isRetentionCount(configured) ? configured : RUN_RETENTION;
}

function isRetentionCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
