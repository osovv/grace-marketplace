import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { CommandRunResult } from "./command-runner";
import type { Grace4Issue } from "./types";
import { ProjectPathError, resolveContainedProjectPath } from "./paths";
import type { GraphAnchorRecord, GraphProjection, VerificationProjection } from "./projections";
import { readGraceXmlArtifact, walkNodes, type GraceXmlNode } from "./xml";

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
  }

  return { assertions, issues };
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
    if (child.children.length > 0 || Object.keys(child.attributes).length > 0) {
      issues.push(issue("error", "assertion.invalid-shape", planFile, `${kind}/${child.tag} must be a plain text field.`));
    }
  }

  const values: string[] = [];
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

  return issues.length > 0 ? { issues } : { assertion: { kind, values }, issues };
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
