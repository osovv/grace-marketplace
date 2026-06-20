import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Grace4Issue } from "./types";
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
};

/** Context required to evaluate a GRACE 4 assertion. */
export type AssertionContext = {
  root: string;
  graph: GraphProjection;
  verification: VerificationProjection;
  /** Commands run only when an explicit target-verification path opts in. */
  runCommands?: boolean;
};

export type AssertionExtractionResult = {
  assertions: GraceAssertion[];
  issues: Grace4Issue[];
};

const ASSERTION_KINDS = new Set<AssertionKind>([
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
      return assertion.values.flatMap((value) => (existsInContext(value, context) ? [] : [assertionIssue(assertion, `Expected ${value} to exist.`)]));
    case "MustNotExist":
      return assertion.values.flatMap((value) => (!existsInContext(value, context) ? [] : [assertionIssue(assertion, `Expected ${value} not to exist.`)]));
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
    for (const node of sectionNode.children) {
      if (!ASSERTION_KINDS.has(node.tag as AssertionKind)) {
        issues.push(issue("error", "assertion.unknown-kind", planFile, `${node.tag} is not an approved GRACE 4 assertion kind.`));
        continue;
      }
      assertions.push({
        kind: node.tag as AssertionKind,
        file: planFile,
        values: assertionValues(node),
      });
    }
  }

  return { assertions, issues };
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
    return [];
  }

  return assertion.values.flatMap((command) => {
    const result = Bun.spawnSync({
      cmd: ["/bin/sh", "-lc", command],
      cwd: context.root,
      stdout: "pipe",
      stderr: "pipe",
    });

    if (result.exitCode === 0) {
      return [];
    }

    const stderr = new TextDecoder().decode(result.stderr).trim();
    return [assertionIssue(assertion, `Command failed (${result.exitCode}): ${command}${stderr ? `: ${stderr}` : ""}`)];
  });
}

function evaluateTextContainment(assertion: GraceAssertion, context: AssertionContext, shouldContain: boolean): Grace4Issue[] {
  const [fileValue, expectedText] = assertion.values;
  if (!fileValue || expectedText == null) {
    return [assertionIssue(assertion, `${assertion.kind} requires file and text values.`)];
  }

  const file = resolveProjectPath(context.root, fileValue);
  if (!existsSync(file)) {
    return [assertionIssue(assertion, `${fileValue} does not exist.`)];
  }

  const contains = readFileSync(file, "utf8").includes(expectedText);
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
  return existsSync(resolveProjectPath(context.root, value));
}

function graphRecord(value: string, graph: GraphProjection): GraphAnchorRecord | undefined {
  return graph.modules.get(value) ?? graph.dataFlows.get(value);
}

function assertionValues(node: GraceXmlNode): string[] {
  const values: string[] = [];
  if (node.text.trim()) {
    values.push(node.text.trim());
  }

  for (const child of node.children) {
    const text = child.text.trim();
    values.push(text || child.tag);
  }

  return values;
}

function resolveProjectPath(root: string, value: string) {
  return path.isAbsolute(value) ? value : path.join(root, value);
}

function assertionIssue(assertion: GraceAssertion, message: string): Grace4Issue {
  return issue("error", `assertion.${assertion.kind}`, assertion.file, message);
}

function issue(severity: Grace4Issue["severity"], code: string, file: string, message: string): Grace4Issue {
  return { severity, code, file, message };
}
