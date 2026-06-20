#!/usr/bin/env bun

import { defineCommand, type CommandDef, runMain } from "citty";

import { formatLintExplanation, getLintIssueGuide } from "./lint/catalog";
import { formatTextReport, isValidTextFormat, lintGraceProject } from "./lint/core";
import type { LintOptions, LintResult } from "./lint/types";

export type {
  GraceLintConfig,
  LanguageAdapter,
  LanguageAnalysis,
  LintIssue,
  LintOptions,
  LintProfile,
  LintResult,
  LintSeverity,
  MapMode,
  ModuleRole,
} from "./lint/types";

export { formatTextReport, lintGraceProject } from "./lint/core";

function writeResult(format: string, result: LintResult) {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatTextReport(result)}\n`);
}

function resolveProfile(value: unknown) {
  const profile = String(value ?? "standard");
  if (profile !== "standard" && profile !== "autonomous") {
    throw new Error(`Unsupported profile \`${profile}\`. Use \`standard\` or \`autonomous\`.`);
  }

  return profile;
}

function resolveFailOn(value: unknown) {
  const failOn = String(value ?? "errors");
  if (failOn !== "errors" && failOn !== "warnings" && failOn !== "never") {
    throw new Error(`Unsupported fail-on policy \`${failOn}\`. Use \`errors\`, \`warnings\`, or \`never\`.`);
  }

  return failOn;
}

function shouldFail(result: LintResult, failOn: string) {
  if (failOn === "never") {
    return false;
  }

  if (failOn === "warnings") {
    return result.summary.issues > 0;
  }

  return result.summary.errors > 0;
}

export const lintCommand = defineCommand({
  meta: {
    name: "lint",
    description: "Lint GRACE artifacts, XML tag conventions, semantic markup, role-aware module maps, and optional autonomy readiness.",
  },
  args: {
    path: {
      type: "string",
      alias: "p",
      description: "Project root to lint",
      default: ".",
    },
    format: {
      type: "string",
      alias: "f",
      description: "Output format: text or json",
      default: "text",
    },
    profile: {
      type: "string",
      description: "Lint profile: standard or autonomous",
      default: "standard",
    },
    explain: {
      type: "string",
      description: "Explain one lint issue code instead of linting a project",
    },
    remediate: {
      type: "boolean",
      description: "Include explanation and remediation hints in text output",
      default: false,
    },
    failOn: {
      type: "string",
      description: "Exit policy: errors, warnings, or never",
      default: "errors",
    },
  },
  async run(context) {
    const format = String(context.args.format ?? "text");
    const profile = resolveProfile(context.args.profile);
    const failOn = resolveFailOn(context.args.failOn);
    if (!isValidTextFormat(format)) {
      throw new Error(`Unsupported format \`${format}\`. Use \`text\` or \`json\`.`);
    }

    if (context.args.explain) {
      const code = String(context.args.explain);
      if (format === "json") {
        process.stdout.write(`${JSON.stringify({ schemaVersion: "1.0.0", tool: "grace-lint", guide: getLintIssueGuide(code) }, null, 2)}\n`);
        return;
      }

      process.stdout.write(`${formatLintExplanation(code)}\n`);
      return;
    }

    const result = lintGraceProject(String(context.args.path ?? "."), {
      profile,
    });

    if (format === "json") {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`${formatTextReport(result, { remediate: Boolean(context.args.remediate) })}\n`);
    }
    process.exitCode = shouldFail(result, failOn) ? 1 : 0;
  },
});

if (import.meta.main) {
  await runMain(lintCommand as CommandDef);
}
