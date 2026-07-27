#!/usr/bin/env bun

import { defineCommand, type CommandDef, runMain } from "citty";

import { formatLintExplanation, getLintIssueGuide } from "./lint/catalog";
import { formatTextReport, isValidTextFormat, lintGraceProject } from "./lint/core";
import type { LintAssertionMode, LintOptions, LintProfile, LintResult } from "./lint/types";
import { GraceCommandError, runGraceCommand } from "./query/errors";

export type {
  GraceLintConfig,
  LanguageAdapter,
  LanguageAnalysis,
  LintIssue,
  LintAssertionMode,
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

function resolveProfile(value: unknown): LintProfile {
  const profile = String(value ?? "standard");
  if (profile !== "standard") {
    throw new GraceCommandError("invalid-arguments", `Unsupported profile \`${profile}\`. Use \`standard\`.`);
  }

  return "standard";
}

function resolveFailOn(value: unknown) {
  const failOn = String(value ?? "errors");
  if (failOn !== "errors" && failOn !== "warnings" && failOn !== "never") {
    throw new GraceCommandError("invalid-arguments", `Unsupported fail-on policy \`${failOn}\`. Use \`errors\`, \`warnings\`, or \`never\`.`);
  }

  return failOn;
}

function resolveAssertionMode(value: unknown): LintAssertionMode {
  const mode = String(value ?? "current");
  if (mode !== "current" && mode !== "baseline" && mode !== "target" && mode !== "final") {
    throw new GraceCommandError("invalid-arguments", `Unsupported assertion mode \`${mode}\`. Use \`current\`, \`baseline\`, \`target\`, or \`final\`.`);
  }
  return mode;
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
    description: "Lint GRACE artifacts, XML tag conventions, semantic markup, and role-aware module maps.",
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
      description: "Lint profile (currently only \`standard\` is supported)",
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
    change: {
      type: "string",
      description: "Active C-* bundle selected for baseline or target assertion evaluation",
    },
    assertions: {
      type: "string",
      description: "Assertion mode: current (pre-write active baselines), baseline, target, or final",
      default: "current",
    },
    runCommands: {
      type: "boolean",
      description: "Execute MustPassCommand assertions for the selected change",
      default: false,
    },
    parallelPreflight: {
      type: "boolean",
      description: "Treat active-plan scope overlap as a parallel-execution blocker",
      default: false,
    },
  },
  async run(context) {
    const errorFormat = context.args.format === "json" ? "json" : "text";
    await runGraceCommand(errorFormat, () => {
      const format = String(context.args.format ?? "text");
      const profile = resolveProfile(context.args.profile);
      const failOn = resolveFailOn(context.args.failOn);
      const assertionMode = resolveAssertionMode(context.args.assertions);
      if (!isValidTextFormat(format)) {
        throw new GraceCommandError("invalid-arguments", `Unsupported format \`${format}\`. Use \`text\` or \`json\`.`);
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
        assertionMode,
        changeId: context.args.change ? String(context.args.change) : undefined,
        runCommands: Boolean(context.args.runCommands),
        parallelPreflight: Boolean(context.args.parallelPreflight),
      });

      if (format === "json") {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`${formatTextReport(result, { remediate: Boolean(context.args.remediate) })}\n`);
      }
      process.exitCode = shouldFail(result, failOn) ? 1 : 0;
    }, "Unable to complete GRACE lint. Check the project path and run again.");
  },
});

if (import.meta.main) {
  await runMain(lintCommand as CommandDef);
}
