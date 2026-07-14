import { defineCommand } from "citty";

import { findModules, loadGraceArtifactIndex, resolveModule } from "./query/core";
import { GraceCommandError, runQueryCommand } from "./query/errors";
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
    throw new GraceCommandError("invalid-arguments", `Unsupported format \`${resolved}\`. Use ${allowed.map((value) => `\`${value}\``).join(" or ")}.`);
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
        const errorFormat = Boolean(context.args.json) || context.args.format === "json" ? "json" : "text";
        await runQueryCommand(errorFormat, () => {
          const format = resolveFormat(context.args.format, context.args.json, ["table", "json"], "table");
          const index = loadGrace4IndexOrThrow(String(context.args.path ?? "."));
          const matches = findModules(index, {
            query: context.args.query ? String(context.args.query) : undefined,
            type: context.args.type ? String(context.args.type) : undefined,
            dependsOn: context.args.dependsOn ? String(context.args.dependsOn) : undefined,
          });
          process.stdout.write(format === "json" ? `${JSON.stringify(matches, null, 2)}\n` : `${formatModuleFindTable(matches)}\n`);
        });
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
          required: false,
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
        const errorFormat = Boolean(context.args.json) || context.args.format === "json" ? "json" : "text";
        await runQueryCommand(errorFormat, () => {
          const format = resolveFormat(context.args.format, context.args.json, ["text", "json"], "text");
          const index = loadGrace4IndexOrThrow(String(context.args.path ?? "."));
          const moduleRecord = resolveModule(index, context.args.target == null ? "" : String(context.args.target));
          const withValues = String(context.args.with ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
          const includeVerification = withValues.includes("verification");
          const includeHealth = withValues.includes("health");
          const health = includeHealth ? buildModuleHealth(index, moduleRecord) : null;
          process.stdout.write(format === "json"
            ? `${JSON.stringify(includeHealth ? { module: moduleRecord, health } : moduleRecord, null, 2)}\n`
            : `${formatModuleText(moduleRecord, { withVerification: includeVerification, health })}\n`);
        });
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
          required: false,
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
        const errorFormat = Boolean(context.args.json) || context.args.format === "json" ? "json" : "text";
        await runQueryCommand(errorFormat, () => {
          const format = resolveFormat(context.args.format, context.args.json, ["text", "json"], "text");
          const index = loadGrace4IndexOrThrow(String(context.args.path ?? "."));
          const health = resolveModuleHealth(index, context.args.target == null ? "" : String(context.args.target));
          process.stdout.write(format === "json" ? `${JSON.stringify(health, null, 2)}\n` : `${formatModuleHealthText(health)}\n`);
        });
      },
    }),
  },
});
