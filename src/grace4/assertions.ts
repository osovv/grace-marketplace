import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { CommandRunResult } from "./command-runner";
import type { Grace4Issue } from "./types";
import { ProjectPathError, resolveContainedProjectPath } from "./paths";
import type { GraphAnchorRecord, GraphProjection, VerificationProjection } from "./projections";
import { hasForbiddenAttributes, readGraceXmlArtifact, walkNodes, type GraceXmlNode } from "./xml";

/** Supported machine-checkable GRACE 4 assertion kinds. */
export type AssertionKind =
  | "MustExist"
  | "MustNotExist"
  | "MustOwn"
  | "MustLink"
  | "MustVerify"
  | "MustPassCommand"
  | "MustContain"
  | "MustNotContain";

/** Parsed assertion from BaselineAssertions or TargetAssertions. */
export type GraceAssertion = {
  kind: AssertionKind;
  file: string;
  values: string[];
  /** Stamped at extraction: `${planFile}::${section}::${assertionIndex}` — links command results. */
  slotKey?: string;
  /**
   * MustPassCommand only: declared `budgetSeconds` per Command, index-aligned with `values`.
   * `null` means no declared budget, so the global `--command-timeout` applies; `0` disables it.
   */
  commandBudgetsSeconds?: (number | null)[];
};

/** Context required to evaluate a GRACE 4 assertion. */
export type AssertionContext = {
  root: string;
  graph: GraphProjection;
  verification: VerificationProjection;
  /** Commands run only when an explicit target-verification path opts in. */
  runCommands?: boolean;
  /** Pre-computed MustPassCommand results keyed by assertion slotKey, one entry per Command value. */
  commandResults?: Map<string, CommandRunResult[]>;
};

export type AssertionExtractionResult = {
  assertions: GraceAssertion[];
  issues: Grace4Issue[];
};

/** Exact child-field schema for one assertion kind. */
export type AssertionSchema = {
  fields: readonly string[];
  fileField?: string;
  allowManyValues?: boolean;
};

/** Machine-checkable schema for every assertion kind. */
export const ASSERTION_SCHEMAS: Record<AssertionKind, AssertionSchema> = {
  MustExist: { fields: ["Value"], allowManyValues: true },
  MustNotExist: { fields: ["Value"], allowManyValues: true },
  MustOwn: { fields: ["Owner", "Anchor"] },
  MustLink: { fields: ["From", "To"] },
  MustVerify: { fields: ["Module"], allowManyValues: true },
  MustPassCommand: { fields: ["Command"], allowManyValues: true },
  MustContain: { fields: ["File", "Text"], fileField: "File" },
  MustNotContain: { fields: ["File", "Text"], fileField: "File" },
};

/** Optional per-command timeout attribute allowed on MustPassCommand/Command. */
const COMMAND_BUDGET_ATTRIBUTE = "budgetSeconds";
const COMMAND_FIELD_ATTRIBUTES = new Set([COMMAND_BUDGET_ATTRIBUTE]);
const NO_FIELD_ATTRIBUTES = new Set<string>();

export const ASSERTION_KINDS = new Set<AssertionKind>([
  "MustExist",
  "MustNotExist",
  "MustOwn",
  "MustLink",
  "MustVerify",
  "MustPassCommand",
  "MustContain",
  "MustNotContain",
]);

/** Evaluates one assertion and returns current-state issues. */
export function evaluateAssertion(assertion: GraceAssertion, context: AssertionContext): Grace4Issue[] {
  switch (assertion.kind) {
    case "MustExist":
      return assertion.values.flatMap((value) => evaluateExistence(assertion, value, context, true));
    case "MustNotExist":
      return assertion.values.flatMap((value) => evaluateExistence(assertion, value, context, false));
    case "MustOwn":
      return evaluateMustOwn(assertion, context);
    case "MustLink":
      return evaluateMustLink(assertion, context);
    case "MustVerify":
      return evaluateMustVerify(assertion, context);
    case "MustPassCommand":
      return evaluateMustPassCommand(assertion, context);
    case "MustContain":
      return evaluateTextContainment(assertion, context, true);
    case "MustNotContain":
      return evaluateTextContainment(assertion, context, false);
  }
}

/** Extracts assertions from BaselineAssertions or TargetAssertions under a GraceChangePlan. */
export function extractAssertions(planFile: string, section: "BaselineAssertions" | "TargetAssertions"): GraceAssertion[] {
  return extractAssertionsWithIssues(planFile, section).assertions;
}

export function extractAssertionsWithIssues(
  planFile: string,
  section: "BaselineAssertions" | "TargetAssertions",
): AssertionExtractionResult {
  const artifact = readGraceXmlArtifact(planFile);
  const issues = [...artifact.issues];
  const assertions: GraceAssertion[] = [];

  if (!artifact.root) {
    return { assertions, issues };
  }

  const sections = [...walkNodes(artifact.root)].filter((node) => node.tag === section);
  for (const sectionNode of sections) {
    const sectionStart = assertions.length;
    let validAssertions = 0;
    if (sectionNode.text.trim() || Object.keys(sectionNode.attributes).length > 0) {
      issues.push(issue("error", "assertion.invalid-section-shape", planFile, `${section} must contain only approved assertion child elements.`));
    }
    for (const node of sectionNode.children) {
      if (!ASSERTION_KINDS.has(node.tag as AssertionKind)) {
        issues.push(issue("error", "assertion.unknown-kind", planFile, `${node.tag} is not an approved GRACE 4 assertion kind.`));
        continue;
      }
      const extraction = extractAssertionNode(planFile, node, node.tag as AssertionKind);
      issues.push(...extraction.issues);
      if (!extraction.assertion) {
        continue;
      }
      const phaseIssues = validateAssertionPhase(planFile, section, extraction.assertion);
      issues.push(...phaseIssues);
      if (phaseIssues.length > 0) {
        validAssertions += 1;
        continue;
      }
      assertions.push({
        ...extraction.assertion,
        file: planFile,
        slotKey: `${planFile}::${section}::${assertions.length}`,
      });
      validAssertions += 1;
    }
    if (validAssertions === 0) {
      issues.push(issue("error", "assertion.empty-section", planFile, `${section} must contain at least one valid machine-checkable assertion.`));
    }
    issues.push(...detectSubsumedCommands(planFile, assertions.slice(sectionStart)));
  }

  return { assertions, issues };
}

/** One declared command split into its non-path head and its path arguments. */
type CommandProfile = {
  command: string;
  /** Leading positional tokens that are not path arguments, joined by single spaces. */
  head: string;
  /** Path arguments, each split into normalized path components. */
  paths: string[][];
};

/**
 * Warns when one declared command in a section already runs everything another one runs, which is
 * how a gate silently doubles its own wall-clock cost. Comparison is deliberately conservative:
 * only commands with an identical head are compared, and path arguments are matched component-wise,
 * so `bun test src` covers `bun test src/grace4` but not `bun test srcfoo`.
 */
function detectSubsumedCommands(planFile: string, assertions: GraceAssertion[]): Grace4Issue[] {
  const root = inferProjectRoot(planFile);
  const profiles = assertions
    .filter((assertion) => assertion.kind === "MustPassCommand")
    .flatMap((assertion) => assertion.values)
    .map((command) => profileCommand(command, root));

  const issues: Grace4Issue[] = [];
  for (let left = 0; left < profiles.length; left++) {
    for (let right = left + 1; right < profiles.length; right++) {
      const first = profiles[left]!;
      const second = profiles[right]!;
      const wider = subsumesCommand(first, second) ? first : subsumesCommand(second, first) ? second : null;
      if (!wider) {
        continue;
      }
      const narrower = wider === first ? second : first;
      issues.push(issue(
        "warning",
        "assertion.command-subsumed",
        planFile,
        `MustPassCommand ${JSON.stringify(narrower.command)} is already covered by ${JSON.stringify(wider.command)} in the same assertion section; the gate runs that work twice.`,
      ));
    }
  }
  return issues;
}

function profileCommand(command: string, root: string): CommandProfile {
  const headTokens: string[] = [];
  const paths: string[][] = [];
  for (const token of command.split(/\s+/).filter((part) => part.length > 0 && !part.startsWith("-"))) {
    if (paths.length === 0 && !isPathArgument(token, root)) {
      headTokens.push(token);
      continue;
    }
    paths.push(pathComponents(token));
  }
  return { command, head: headTokens.join(" "), paths };
}

/**
 * A bare token counts as a path argument only when it carries a separator or actually exists under
 * the project root, so `bun run check` keeps `check` in its head while `bun test src` does not.
 */
function isPathArgument(token: string, root: string): boolean {
  if (/[\\/]/.test(token)) {
    return true;
  }
  try {
    return existsSync(path.join(root, token));
  } catch {
    return false;
  }
}

function pathComponents(token: string): string[] {
  return token.split(/[\\/]+/).filter((part) => part.length > 0 && part !== ".");
}

function subsumesCommand(wider: CommandProfile, narrower: CommandProfile): boolean {
  if (wider.head !== narrower.head || narrower.paths.length === 0) {
    return false;
  }
  if (samePathArguments(wider.paths, narrower.paths)) {
    return false;
  }
  if (wider.paths.length === 0) {
    return true;
  }
  return narrower.paths.every((narrowPath) => wider.paths.some((widePath) => isComponentPrefix(widePath, narrowPath)));
}

function samePathArguments(left: string[][], right: string[][]): boolean {
  const key = (paths: string[][]) => paths.map((parts) => parts.join("/")).sort().join("|");
  return key(left) === key(right);
}

function isComponentPrefix(prefix: string[], candidate: string[]): boolean {
  return prefix.length <= candidate.length && prefix.every((part, index) => part === candidate[index]);
}

function validateAssertionPhase(
  planFile: string,
  section: "BaselineAssertions" | "TargetAssertions",
  assertion: Omit<GraceAssertion, "file">,
): Grace4Issue[] {
  if (section !== "TargetAssertions" || assertion.kind !== "MustPassCommand") {
    return [];
  }

  return assertion.values
    .filter((command) => /(?:^|\s)--assertions(?:\s+|=)(?:current|["']current["'])(?=\s|$|[;&|])/i.test(command))
    .map((command) => issue(
      "error",
      "assertion.phase-incompatible-command",
      planFile,
      `TargetAssertions MustPassCommand must not invoke --assertions current: ${command}. Current mode evaluates active approved baselines and becomes stale after target writes; keep MustPassCommand as leaf project evidence and run selected target/final lint as the outer gate.`,
    ));
}

/** Plan lifecycle: `active` plans follow current execution policy; `archive` plans are immutable history. */
export type AssertionLifecycle = "active" | "archive";

/** Current-phase error diagnostics that never apply retroactively to archived plans. */
const ACTIVE_PHASE_ISSUE_CODES: ReadonlySet<string> = new Set(["assertion.phase-incompatible-command"]);

/** Advisory diagnostics that are unactionable noise for immutable archived plans. */
const ARCHIVE_ADVISORY_ISSUE_CODES: ReadonlySet<string> = new Set(["assertion.command-subsumed"]);

/**
 * Shared lifecycle policy for assertion extraction diagnostics: lint and query navigation both
 * consume this so their active/archived handling cannot drift apart again. Archived plans keep
 * structural errors but drop active-phase errors and advisory noise, and archived commands are
 * never executed because extraction itself never runs commands.
 */
export function filterAssertionIssuesForLifecycle(issues: Grace4Issue[], lifecycle: AssertionLifecycle): Grace4Issue[] {
  if (lifecycle === "active") return issues;
  return issues.filter((item) => !ACTIVE_PHASE_ISSUE_CODES.has(item.code) && !ARCHIVE_ADVISORY_ISSUE_CODES.has(item.code));
}

function evaluateMustOwn(assertion: GraceAssertion, context: AssertionContext): Grace4Issue[] {
  const [owner, anchor] = assertion.values;
  if (!owner || !anchor) {
    return [assertionIssue(assertion, "MustOwn requires owner and anchor values.")];
  }

  if (owner.startsWith("GD-")) {
    const record = graphRecord(anchor, context.graph);
    return record?.owner === owner ? [] : [assertionIssue(assertion, `Expected ${owner} to own ${anchor}.`)];
  }

  if (owner.startsWith("VD-")) {
    const record = context.verification.entries.get(anchor);
    return record?.owner === owner ? [] : [assertionIssue(assertion, `Expected ${owner} to own ${anchor}.`)];
  }

  return [assertionIssue(assertion, `Unsupported owner '${owner}'.`)];
}

function evaluateMustLink(assertion: GraceAssertion, context: AssertionContext): Grace4Issue[] {
  const [from, to] = assertion.values;
  if (!from || !to) {
    return [assertionIssue(assertion, "MustLink requires source and target values.")];
  }

  const fromRecord = graphRecord(from, context.graph);
  if (!fromRecord) {
    return [assertionIssue(assertion, `Link source ${from} does not exist.`)];
  }
  if (!graphRecord(to, context.graph)) {
    return [assertionIssue(assertion, `Link target ${to} does not exist.`)];
  }

  return fromRecord.links.includes(to) ? [] : [assertionIssue(assertion, `Expected ${from} to link to ${to}.`)];
}

function evaluateMustVerify(assertion: GraceAssertion, context: AssertionContext): Grace4Issue[] {
  return assertion.values.flatMap((value) => {
    const verificationId = value.startsWith("V-") ? value : `V-${value}`;
    const record = context.verification.entries.get(verificationId);
    if (!record) {
      return [assertionIssue(assertion, `Expected ${verificationId} verification coverage.`)];
    }
    return [];
  });
}

function evaluateMustPassCommand(assertion: GraceAssertion, context: AssertionContext): Grace4Issue[] {
  if (!context.runCommands) {
    return [issue("error", "assertion.command-not-evaluated", assertion.file, "MustPassCommand requires explicit command execution opt-in.")];
  }

  const results = assertion.slotKey ? context.commandResults?.get(assertion.slotKey) : undefined;
  if (!results) {
    return [assertionIssue(assertion, "Command results unavailable for assertion.")];
  }

  return results
    .filter((result) => !result.skipped)
    .flatMap((result) => {
      const detail = result.outputTail ? `\n${result.outputTail}` : "";
      if (result.timedOut) {
        return [assertionIssue(
          assertion,
          `Command timed out after ${Math.round(result.durationMs / 1000)}s: ${result.command}${detail}`,
        )];
      }
      if (result.exitCode !== 0) {
        return [assertionIssue(
          assertion,
          `Command failed (${result.exitCode}): ${result.command}${detail}`,
        )];
      }
      return [];
    });
}

function evaluateTextContainment(assertion: GraceAssertion, context: AssertionContext, shouldContain: boolean): Grace4Issue[] {
  const [fileValue, expectedText] = assertion.values;
  if (!fileValue || expectedText == null) {
    return [assertionIssue(assertion, `${assertion.kind} requires file and text values.`)];
  }

  let file: string;
  try {
    file = resolveAssertionPath(context.root, fileValue);
  } catch (error) {
    return [invalidPathIssue(assertion, fileValue, error)];
  }
  if (!existsSync(file)) {
    return [assertionIssue(assertion, `${fileValue} does not exist.`)];
  }

  try {
    if (!statSync(file).isFile()) {
      return [assertionIssue(assertion, `${fileValue} must resolve to a regular file.`)];
    }
  } catch (error) {
    return [assertionIssue(assertion, `Unable to inspect ${fileValue}: ${error instanceof Error ? error.message : String(error)}`)];
  }

  let contains: boolean;
  try {
    contains = readFileSync(file, "utf8").includes(expectedText);
  } catch (error) {
    return [assertionIssue(assertion, `Unable to read ${fileValue}: ${error instanceof Error ? error.message : String(error)}`)];
  }
  if (contains === shouldContain) {
    return [];
  }

  return [assertionIssue(assertion, shouldContain ? `${fileValue} must contain requested text.` : `${fileValue} must not contain requested text.`)];
}

function existsInContext(value: string, context: AssertionContext): boolean {
  if (graphRecord(value, context.graph) || context.graph.documents.has(value) || context.verification.documents.has(value)) {
    return true;
  }
  if (context.verification.entries.has(value)) {
    return true;
  }
  if (value.startsWith("M-") && context.verification.entries.has(`V-${value}`)) {
    return true;
  }
  return existsSync(resolveAssertionPath(context.root, value));
}

function graphRecord(value: string, graph: GraphProjection): GraphAnchorRecord | undefined {
  return graph.modules.get(value) ?? graph.dataFlows.get(value);
}

function extractAssertionNode(
  planFile: string,
  node: GraceXmlNode,
  kind: AssertionKind,
): { assertion?: Omit<GraceAssertion, "file">; issues: Grace4Issue[] } {
  const issues: Grace4Issue[] = [];
  const schema = ASSERTION_SCHEMAS[kind];
  const allowedFields = new Set(schema.fields);

  if (node.text.trim() || Object.keys(node.attributes).length > 0) {
    issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind} must contain only its declared child fields.`));
  }

  for (const child of node.children) {
    if (!allowedFields.has(child.tag)) {
      issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind} does not allow child <${child.tag}>.`));
    }
    const allowedAttributes = isCommandField(kind, child.tag) ? COMMAND_FIELD_ATTRIBUTES : NO_FIELD_ATTRIBUTES;
    if (child.children.length > 0 || hasForbiddenAttributes(child, allowedAttributes)) {
      issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind}/${child.tag} must be a plain text field.`));
    }
  }

  const values: string[] = [];
  const budgets: (number | null)[] = [];
  if (schema.allowManyValues) {
    const field = schema.fields[0]!;
    const matches = node.children.filter((child) => child.tag === field);
    if (matches.length === 0) {
      issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind} requires at least one <${field}> field.`));
    }
    for (const match of matches) {
      const value = match.text.trim();
      if (!value) {
        issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind}/${field} must not be empty.`));
      } else {
        values.push(value);
        if (isCommandField(kind, field)) {
          budgets.push(parseCommandBudgetSeconds(planFile, match, issues));
        }
      }
    }
  } else {
    for (const field of schema.fields) {
      const matches = node.children.filter((child) => child.tag === field);
      if (matches.length !== 1) {
        issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind} requires exactly one <${field}> field.`));
        continue;
      }
      const value = matches[0]!.text.trim();
      if (!value) {
        issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind}/${field} must not be empty.`));
      } else {
        values.push(value);
      }
    }
  }

  if (schema.fileField) {
    const fileIndex = schema.fields.indexOf(schema.fileField);
    const fileValue = values[fileIndex];
    if (fileValue) {
      try {
        resolveContainedProjectPath(inferProjectRoot(planFile), fileValue, { mode: "output" });
      } catch (error) {
        issues.push(invalidPathIssue({ kind, file: planFile, values }, fileValue, error));
      }
    }
  }

  if (issues.length > 0) {
    return { issues };
  }
  return {
    assertion: kind === "MustPassCommand" ? { kind, values, commandBudgetsSeconds: budgets } : { kind, values },
    issues,
  };
}

function isCommandField(kind: AssertionKind, tag: string): boolean {
  return kind === "MustPassCommand" && tag === "Command";
}

/**
 * Parses the optional `budgetSeconds` attribute of one MustPassCommand/Command. The accepted
 * grammar mirrors `--command-timeout`: a non-negative integer number of seconds, where `0`
 * disables the timeout for that command. Returns null when the attribute is absent or invalid;
 * an invalid value also records an error, which suppresses the whole assertion.
 */
function parseCommandBudgetSeconds(planFile: string, node: GraceXmlNode, issues: Grace4Issue[]): number | null {
  const raw = node.attributes[COMMAND_BUDGET_ATTRIBUTE];
  if (raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    issues.push(issue(
      "error",
      "assertion.invalid-command-budget",
      planFile,
      `MustPassCommand/Command ${COMMAND_BUDGET_ATTRIBUTE}=${JSON.stringify(raw)} must be a non-negative integer number of seconds; 0 disables the timeout for that command.`,
    ));
    return null;
  }
  return Number(trimmed);
}

function evaluateExistence(
  assertion: GraceAssertion,
  value: string,
  context: AssertionContext,
  shouldExist: boolean,
): Grace4Issue[] {
  let exists: boolean;
  try {
    exists = existsInContext(value, context);
  } catch (error) {
    return [invalidPathIssue(assertion, value, error)];
  }
  if (exists === shouldExist) {
    return [];
  }
  return [assertionIssue(assertion, shouldExist ? `Expected ${value} to exist.` : `Expected ${value} not to exist.`)];
}

function inferProjectRoot(planFile: string): string {
  const resolvedPlan = path.resolve(planFile);
  let current = path.dirname(resolvedPlan);
  while (path.dirname(current) !== current) {
    if (path.basename(current) === ".grace") {
      return path.dirname(current);
    }
    current = path.dirname(current);
  }
  return path.dirname(resolvedPlan);
}

function resolveAssertionPath(root: string, value: string): string {
  return resolveContainedProjectPath(root, value, { mode: "output" }).absolutePath;
}

function invalidPathIssue(assertion: GraceAssertion, value: string, error: unknown): Grace4Issue {
  const detail = error instanceof ProjectPathError ? `${error.code}: ${error.message}` : String(error);
  return issue("error", "assertion.invalid-path", assertion.file, `Invalid assertion path ${JSON.stringify(value)}: ${detail}`);
}

function assertionIssue(assertion: GraceAssertion, message: string): Grace4Issue {
  return issue("error", `assertion.${assertion.kind}`, assertion.file, message);
}

function issue(severity: Grace4Issue["severity"], code: string, file: string, message: string): Grace4Issue {
  return { severity, code, file, message };
}
