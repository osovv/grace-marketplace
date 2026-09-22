// FILE: scripts/documented-flags.test.ts
// Asserts that every `grace <subcommand> --flag` spelling documented in the canonical
// skills and in README.md is a flag the citty CLI definitions actually accept.
//
// The accepted-flag set is derived from the live `defineCommand` definitions in src/,
// never from a hand-maintained list, so this guards documentation against CLI drift
// without introducing a second list that can drift on its own.

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ArgDef, CommandDef, Resolvable } from "citty";

import { fileCommand } from "../src/grace-file.ts";
import { lintCommand } from "../src/grace-lint.ts";
import { moduleCommand } from "../src/grace-module.ts";
import { statusCommand } from "../src/grace-status.ts";
import { verificationCommand } from "../src/grace-verification.ts";

const repoRoot = path.resolve(import.meta.dir, "..");

/** Subcommands registered on the `grace` binary in src/grace.ts. */
const rootSubCommands: Record<string, CommandDef> = {
  file: fileCommand as CommandDef,
  lint: lintCommand as CommandDef,
  module: moduleCommand as CommandDef,
  status: statusCommand as CommandDef,
  verification: verificationCommand as CommandDef,
};

/** The root `grace` command carries no args of its own, only citty's built-ins. */
const rootCommand: CommandDef = { subCommands: rootSubCommands };

/** citty injects these on every command. */
const builtinFlags = ["help", "version"];

async function resolveValue<T>(value: Resolvable<T> | undefined): Promise<T | undefined> {
  if (typeof value === "function") {
    return await (value as () => T | Promise<T>)();
  }
  return await value;
}

/**
 * While building its parse options, citty registers both the camelCase and the kebab-case
 * spelling of every arg name as aliases, so `--run-commands` and `--runCommands` are the
 * same flag. Folding every spelling to camelCase makes the two indistinguishable here too.
 */
function toCamelCase(name: string): string {
  return name.replace(/[-_]+([a-zA-Z0-9])/g, (_match, char: string) => char.toUpperCase());
}

type AcceptedFlags = {
  all: Set<string>;
  booleans: Set<string>;
};

async function acceptedFlags(command: CommandDef): Promise<AcceptedFlags> {
  const all = new Set<string>(builtinFlags);
  const booleans = new Set<string>();
  const args = ((await resolveValue(command.args)) ?? {}) as Record<string, ArgDef>;

  for (const [name, definition] of Object.entries(args)) {
    if (definition?.type === "positional") {
      continue;
    }
    const canonical = toCamelCase(name);
    all.add(canonical);
    if (definition?.type === "boolean") {
      booleans.add(canonical);
    }
  }

  return { all, booleans };
}

function markdownFiles(): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        files.push(entryPath);
      }
    }
  };

  walk(path.join(repoRoot, "skills", "grace"));
  files.push(path.join(repoRoot, "README.md"));
  return files.map((file) => path.relative(repoRoot, file).split(path.sep).join("/")).sort();
}

type Candidate = {
  file: string;
  line: number;
  text: string;
};

/**
 * A documented invocation is a fenced code-block line or an inline code span whose content
 * starts with the literal word `grace`. Markdown table rows are single physical lines in the
 * source, so a table cell never wraps and needs no continuation handling; the only table
 * artefact that reaches us is the `\|` pipe escape, which `cleanToken` strips.
 */
function extractCandidates(file: string, markdown: string): Candidate[] {
  const candidates: Candidate[] = [];
  let inFence = false;

  markdown.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }

    if (inFence) {
      candidates.push({ file, line: index + 1, text: line });
      return;
    }

    for (const match of rawLine.matchAll(/`([^`]+)`/g)) {
      candidates.push({ file, line: index + 1, text: match[1]!.trim() });
    }
  });

  return candidates.filter((candidate) => /^grace(\s|$)/.test(candidate.text));
}

/** Strips markdown escaping and optional-argument punctuation from one shell-ish token. */
function cleanToken(token: string): string {
  return token
    .replace(/\\/g, "")
    .replace(/^[[({'"]+/, "")
    .replace(/[\])}'"`.,;:]+$/, "");
}

type ResolvedInvocation = {
  label: string;
  commands: CommandDef[];
  tokens: string[];
};

/**
 * Walks the subcommand path of one invocation. Returns `null` when the path cannot be
 * resolved to real commands, because an unrecognised word is prose, not a documented flag
 * contract, and failing on it would make this test cry wolf.
 */
async function resolveInvocation(text: string): Promise<ResolvedInvocation | null> {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens[0] !== "grace") {
    return null;
  }

  let commands: CommandDef[] = [rootCommand];
  const labels = ["grace"];
  let index = 1;

  while (index < tokens.length) {
    const token = cleanToken(tokens[index]!);
    if (token === "" || token.startsWith("-")) {
      break;
    }

    const subCommandSets = await Promise.all(commands.map((command) => resolveValue(command.subCommands)));
    if (subCommandSets.some((set) => !set)) {
      // A leaf command was reached: this token is a positional such as `<id>` or `<query>`.
      break;
    }

    // Docs abbreviate sibling commands as `find|show`; every alternative must be real.
    const alternatives = token.split("|").map((part) => part.trim()).filter(Boolean);
    const next: CommandDef[] = [];
    for (const set of subCommandSets) {
      for (const alternative of alternatives) {
        const sub = set![alternative];
        if (!sub) {
          return null;
        }
        next.push((await resolveValue(sub)) as CommandDef);
      }
    }

    commands = next;
    labels.push(token);
    index += 1;
  }

  return { label: labels.join(" "), commands, tokens: tokens.slice(index) };
}

/** Only `--foo` tokens count; single-dash aliases and bare values are ignored. */
function flagsOf(tokens: string[]): string[] {
  const flags: string[] = [];
  for (const rawToken of tokens) {
    if (!rawToken.startsWith("--") && !rawToken.startsWith("[--") && !rawToken.startsWith("(--")) {
      continue;
    }
    const token = cleanToken(rawToken);
    if (!token.startsWith("--")) {
      continue;
    }
    const name = token.slice(2).split("=")[0]!;
    if (name === "") {
      continue;
    }
    flags.push(name);
  }
  return flags;
}

type Extraction = {
  invocations: number;
  unknown: string[];
  flagsByCommand: Map<string, Set<string>>;
  allFlags: Set<string>;
};

async function extractDocumentedFlags(): Promise<Extraction> {
  const unknown: string[] = [];
  const flagsByCommand = new Map<string, Set<string>>();
  const allFlags = new Set<string>();
  const acceptedCache = new Map<CommandDef, AcceptedFlags>();
  let invocations = 0;

  for (const file of markdownFiles()) {
    const markdown = readFileSync(path.join(repoRoot, file), "utf8");
    for (const candidate of extractCandidates(file, markdown)) {
      const invocation = await resolveInvocation(candidate.text);
      if (!invocation) {
        continue;
      }

      invocations += 1;
      const recorded = flagsByCommand.get(invocation.label) ?? new Set<string>();
      flagsByCommand.set(invocation.label, recorded);

      const accepted: AcceptedFlags = { all: new Set(), booleans: new Set() };
      for (const command of invocation.commands) {
        let entry = acceptedCache.get(command);
        if (!entry) {
          entry = await acceptedFlags(command);
          acceptedCache.set(command, entry);
        }
        for (const name of entry.all) accepted.all.add(name);
        for (const name of entry.booleans) accepted.booleans.add(name);
      }

      for (const flag of flagsOf(invocation.tokens)) {
        const canonical = toCamelCase(flag);
        recorded.add(canonical);
        allFlags.add(canonical);

        if (accepted.all.has(canonical)) {
          continue;
        }
        // citty also accepts `--no-<flag>` for boolean args.
        const negated = toCamelCase(flag.replace(/^no-/, ""));
        if (canonical !== negated && accepted.booleans.has(negated)) {
          continue;
        }

        unknown.push(`${candidate.file}:${candidate.line}: \`${candidate.text}\` documents --${flag}, which \`${invocation.label}\` does not accept`);
      }
    }
  }

  return { invocations, unknown, flagsByCommand, allFlags };
}

describe("documented CLI flags", () => {
  it("registers exactly the subcommands src/grace.ts wires onto the grace binary", () => {
    const source = readFileSync(path.join(repoRoot, "src", "grace.ts"), "utf8");
    const block = source.match(/subCommands:\s*\{([\s\S]*?)\n {2}\}/);
    expect(block).not.toBeNull();
    const registered = [...block![1]!.matchAll(/^\s*([A-Za-z][\w-]*)\s*:/gm)].map((match) => match[1]!).sort();
    expect(registered).toEqual(Object.keys(rootSubCommands).sort());
  });

  it("accepts every flag the skills and README document", async () => {
    const { unknown } = await extractDocumentedFlags();
    expect(unknown).toEqual([]);
  });

  it("actually reaches the documented invocations it is meant to guard", async () => {
    const { invocations, flagsByCommand, allFlags } = await extractDocumentedFlags();

    // Floor guards against an extractor that silently stops matching anything.
    expect(invocations).toBeGreaterThanOrEqual(30);

    // Every subcommand root must be reached. This is a floor on what the extractor sees,
    // not an exhaustive list, so documenting a further command cannot turn the test red.
    const reached = [...flagsByCommand.keys()];
    for (const label of ["grace", "grace file show", "grace lint", "grace module find", "grace module show", "grace status", "grace verification find", "grace verification show"]) {
      expect(reached).toContain(label);
    }

    // `--run-commands` in the docs must fold onto the CLI's `runCommands` arg.
    const lintFlags = [...(flagsByCommand.get("grace lint") ?? [])];
    for (const flag of ["path", "change", "assertions", "runCommands", "parallelPreflight", "explain"]) {
      expect(lintFlags).toContain(flag);
    }
    const statusFlags = [...(flagsByCommand.get("grace status") ?? [])];
    for (const flag of ["path", "json", "with", "failOn"]) {
      expect(statusFlags).toContain(flag);
    }
    expect([...allFlags]).toContain("runCommands");
    expect([...allFlags]).toContain("version");
  });
});
