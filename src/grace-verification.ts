import { defineCommand } from "citty";

import { findVerifications, loadGraceArtifactIndex, resolveVerification } from "./query/core";
import { formatVerificationFindTable, formatVerificationText } from "./query/render";
import type { GraceArtifactIndex } from "./query/types";

/** Loads projection-backed index or throws a user-facing command error. */
function loadGrace4IndexOrThrow(root: string): GraceArtifactIndex {
  return loadGraceArtifactIndex(root);
}

function resolveFormat(format: unknown, json: unknown, allowed: string[], defaultFormat: string) {
  const resolved = Boolean(json) ? "json" : String(format ?? defaultFormat);
  if (!allowed.includes(resolved)) {
    throw new Error(`Unsupported format \`${resolved}\`. Use ${allowed.map((value) => `\`${value}\``).join(" or ")}.`);
  }

  return resolved;
}

export const verificationCommand = defineCommand({
  meta: {
    name: "verification",
    description: "Query GRACE verification entries, scenarios, and evidence requirements.",
  },
  subCommands: {
    find: defineCommand({
      meta: {
        name: "find",
        description: "Find verification entries by id, module, priority, scenarios, markers, or commands.",
      },
      args: {
        query: {
          type: "positional",
          required: false,
          description: "Search query",
        },
        path: {
          type: "string",
          alias: "p",
          description: "Project root to inspect",
          default: ".",
        },
        module: {
          type: "string",
          description: "Filter by module id or module name fragment",
        },
        priority: {
          type: "string",
          description: "Filter by verification priority",
        },
        format: {
          type: "string",
          alias: "f",
          description: "Output format: table or json",
          default: "table",
        },
        json: {
          type: "boolean",
          description: "Shortcut for --format json",
          default: false,
        },
      },
      async run(context) {
        const format = resolveFormat(context.args.format, context.args.json, ["table", "json"], "table");
        const index = loadGrace4IndexOrThrow(String(context.args.path ?? "."));
        const matches = findVerifications(index, {
          query: context.args.query ? String(context.args.query) : undefined,
          module: context.args.module ? String(context.args.module) : undefined,
          priority: context.args.priority ? String(context.args.priority) : undefined,
        });

        if (format === "json") {
          process.stdout.write(`${JSON.stringify(matches, null, 2)}\n`);
          return;
        }

        process.stdout.write(`${formatVerificationFindTable(matches)}\n`);
      },
    }),
    show: defineCommand({
      meta: {
        name: "show",
        description: "Show one verification entry by V-M id or module target.",
      },
      args: {
        target: {
          type: "positional",
          description: "Verification id or module target",
        },
        path: {
          type: "string",
          alias: "p",
          description: "Project root to inspect",
          default: ".",
        },
        format: {
          type: "string",
          alias: "f",
          description: "Output format: text or json",
          default: "text",
        },
        json: {
          type: "boolean",
          description: "Shortcut for --format json",
          default: false,
        },
      },
      async run(context) {
        const format = resolveFormat(context.args.format, context.args.json, ["text", "json"], "text");
        const index = loadGrace4IndexOrThrow(String(context.args.path ?? "."));
        const match = resolveVerification(index, String(context.args.target));

        if (format === "json") {
          process.stdout.write(`${JSON.stringify(match, null, 2)}\n`);
          return;
        }

        process.stdout.write(`${formatVerificationText(match)}\n`);
      },
    }),
  },
});
