import { defineCommand } from "citty";

import { findModules, loadGraceArtifactIndex, resolveModule } from "./query/core";
import { buildModuleHealth, resolveModuleHealth } from "./query/health";
import { formatModuleFindTable, formatModuleHealthText, formatModuleText } from "./query/render";
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

export const moduleCommand = defineCommand({
  meta: {
    name: "module",
    description: "Query shared GRACE module artifacts.",
  },
  subCommands: {
    find: defineCommand({
      meta: {
        name: "find",
        description: "Find GRACE modules by id, name, path, purpose, annotations, verification, or dependencies.",
      },
      args: {
        query: {
          type: "positional",
          required: false,
          description: "Search query or path",
        },
        path: {
          type: "string",
          alias: "p",
          description: "Project root to inspect",
          default: ".",
        },
        type: {
          type: "string",
          description: "Filter by module type",
        },
        dependsOn: {
          type: "string",
          description: "Filter by dependency id",
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
        const matches = findModules(index, {
          query: context.args.query ? String(context.args.query) : undefined,
          type: context.args.type ? String(context.args.type) : undefined,
          dependsOn: context.args.dependsOn ? String(context.args.dependsOn) : undefined,
        });

        if (format === "json") {
          process.stdout.write(`${JSON.stringify(matches, null, 2)}\n`);
          return;
        }

        process.stdout.write(`${formatModuleFindTable(matches)}\n`);
      },
    }),
    show: defineCommand({
      meta: {
        name: "show",
        description: "Show the shared/public GRACE record for a module id or path.",
      },
      args: {
        target: {
          type: "positional",
          description: "Module id or file/path target",
        },
        path: {
          type: "string",
          alias: "p",
          description: "Project root to inspect",
          default: ".",
        },
        with: {
          type: "string",
          description: "Optional extras, currently supports: verification",
          default: "",
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
        const moduleRecord = resolveModule(index, String(context.args.target));
        const withValues = String(context.args.with ?? "")
          .split(",")
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean);
        const includeVerification = withValues.includes("verification");
        const includeHealth = withValues.includes("health");
        const health = includeHealth ? buildModuleHealth(index, moduleRecord) : null;

        if (format === "json") {
          process.stdout.write(`${JSON.stringify(includeHealth ? { module: moduleRecord, health } : moduleRecord, null, 2)}\n`);
          return;
        }

        process.stdout.write(`${formatModuleText(moduleRecord, { withVerification: includeVerification, health })}\n`);
      },
    }),
    health: defineCommand({
      meta: {
        name: "health",
        description: "Show health, autonomy readiness, and remediation hints for one module.",
      },
      args: {
        target: {
          type: "positional",
          description: "Module id or file/path target",
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
        const health = resolveModuleHealth(index, String(context.args.target));

        if (format === "json") {
          process.stdout.write(`${JSON.stringify(health, null, 2)}\n`);
          return;
        }

        process.stdout.write(`${formatModuleHealthText(health)}\n`);
      },
    }),
  },
});
