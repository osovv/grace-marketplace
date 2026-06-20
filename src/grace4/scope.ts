import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { ANCHOR_PATTERNS, type Grace4Issue, type Grace4ProjectPaths } from "./types";
import { readGraceXmlArtifact, walkNodes, type GraceXmlNode } from "./xml";

/** Durable semantic scope declared by a GraceChangePlan. */
export type DurableScope = {
  graphAnchors: string[];
  verificationAnchors: string[];
  contextArtifacts: string[];
  graphDocuments: string[];
  verificationDocuments: string[];
};

/** Observed repository write scope declared by a GraceChangePlan. */
export type ObservedWriteScope = {
  files: string[];
  globs: string[];
};

/** Active change summary used for overlap detection and status reporting. */
export type ActiveChangeScope = {
  changeId: string;
  bundlePath: string;
  specStatus: string;
  planStatus?: string;
  durable: DurableScope;
  observedWrites: ObservedWriteScope;
};

/** Reads active change bundles and extracts declared scopes from approved or draft plans. */
export function collectActiveChangeScopes(paths: Grace4ProjectPaths): ActiveChangeScope[] {
  if (!existsSync(paths.changesActiveDir)) {
    return [];
  }

  return readdirSync(paths.changesActiveDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && ANCHOR_PATTERNS.change.test(entry.name))
    .map((entry) => readActiveChangeScope(path.join(paths.changesActiveDir, entry.name), entry.name))
    .filter((scope): scope is ActiveChangeScope => scope !== null);
}

/** Returns overlap diagnostics without blocking coexistence of approved plans. */
export function detectScopeOverlaps(changes: ActiveChangeScope[]): Grace4Issue[] {
  const issues: Grace4Issue[] = [];
  forEachApprovedPair(changes, (left, right) => {
    const overlaps = durableOverlaps(left.durable, right.durable);
    if (overlaps.length > 0) {
      issues.push(
        issue(
          "warning",
          "scope.durable-overlap",
          left.bundlePath,
          `${left.changeId} overlaps ${right.changeId} durable scope: ${overlaps.join(", ")}.`,
        ),
      );
    }
  });
  return issues;
}

/** Returns blocking diagnostics for attempted concurrent or parallel-safe execution. */
export function detectUnsafeConcurrentExecution(changes: ActiveChangeScope[]): Grace4Issue[] {
  const issues: Grace4Issue[] = [];
  forEachApprovedPair(changes, (left, right) => {
    const fileOverlaps = intersection(left.observedWrites.files, right.observedWrites.files);
    const globOverlaps = intersection(left.observedWrites.globs, right.observedWrites.globs);
    if (fileOverlaps.length > 0 || globOverlaps.length > 0) {
      issues.push(
        issue(
          "error",
          "scope.observed-write-overlap",
          left.bundlePath,
          `${left.changeId} and ${right.changeId} cannot run in parallel; overlapping writes: ${[
            ...fileOverlaps,
            ...globOverlaps,
          ].join(", ")}.`,
        ),
      );
    }
  });
  return issues;
}

function readActiveChangeScope(bundlePath: string, changeId: string): ActiveChangeScope | null {
  const spec = readGraceXmlArtifact(path.join(bundlePath, "spec.xml"));
  const plan = readGraceXmlArtifact(path.join(bundlePath, "plan.xml"));
  const specStatus = spec.root?.attributes.status ?? "missing";
  const planStatus = plan.root?.attributes.status;

  if (!plan.root || !["draft", "approved"].includes(specStatus) || (planStatus && !["draft", "approved"].includes(planStatus))) {
    return null;
  }

  return {
    changeId,
    bundlePath,
    specStatus,
    planStatus,
    durable: extractDurableScope(plan.root),
    observedWrites: extractObservedWriteScope(plan.root),
  };
}

function extractDurableScope(root: GraceXmlNode): DurableScope {
  const scopeNode = [...walkNodes(root)].find((node) => node.tag === "DurableScope");
  const scope: DurableScope = {
    graphAnchors: [],
    verificationAnchors: [],
    contextArtifacts: [],
    graphDocuments: [],
    verificationDocuments: [],
  };
  if (!scopeNode) {
    return scope;
  }

  for (const node of walkNodes(scopeNode)) {
    if (ANCHOR_PATTERNS.module.test(node.tag) || ANCHOR_PATTERNS.dataFlow.test(node.tag)) {
      scope.graphAnchors.push(node.tag);
    } else if (ANCHOR_PATTERNS.verification.test(node.tag)) {
      scope.verificationAnchors.push(node.tag);
    } else if (ANCHOR_PATTERNS.graphDocument.test(node.tag)) {
      scope.graphDocuments.push(node.tag);
    } else if (ANCHOR_PATTERNS.verificationDocument.test(node.tag)) {
      scope.verificationDocuments.push(node.tag);
    }
  }

  scope.contextArtifacts.push(...textChildren(scopeNode, ["ContextArtifact", "Context", "Artifact"]));
  return dedupeDurableScope(scope);
}

function extractObservedWriteScope(root: GraceXmlNode): ObservedWriteScope {
  const scopeNode = [...walkNodes(root)].find((node) => node.tag === "ObservedWriteScope");
  if (!scopeNode) {
    return { files: [], globs: [] };
  }

  return {
    files: [...new Set(textChildren(scopeNode, ["File", "Path"]))],
    globs: [...new Set(textChildren(scopeNode, ["Glob"]))],
  };
}

function textChildren(node: GraceXmlNode, tags: string[]): string[] {
  const tagSet = new Set(tags);
  return [...walkNodes(node)]
    .filter((child) => child !== node && tagSet.has(child.tag))
    .map((child) => child.text.trim())
    .filter(Boolean);
}

function durableOverlaps(left: DurableScope, right: DurableScope): string[] {
  return [
    ...intersection(left.graphAnchors, right.graphAnchors),
    ...intersection(left.verificationAnchors, right.verificationAnchors),
    ...intersection(left.contextArtifacts, right.contextArtifacts),
    ...intersection(left.graphDocuments, right.graphDocuments),
    ...intersection(left.verificationDocuments, right.verificationDocuments),
  ];
}

function forEachApprovedPair(changes: ActiveChangeScope[], callback: (left: ActiveChangeScope, right: ActiveChangeScope) => void) {
  const approved = changes.filter((change) => change.specStatus === "approved" && change.planStatus === "approved");
  for (let index = 0; index < approved.length; index += 1) {
    for (let next = index + 1; next < approved.length; next += 1) {
      callback(approved[index]!, approved[next]!);
    }
  }
}

function intersection(left: string[], right: string[]) {
  const rightSet = new Set(right);
  return [...new Set(left.filter((value) => rightSet.has(value)))].sort();
}

function dedupeDurableScope(scope: DurableScope): DurableScope {
  return {
    graphAnchors: [...new Set(scope.graphAnchors)].sort(),
    verificationAnchors: [...new Set(scope.verificationAnchors)].sort(),
    contextArtifacts: [...new Set(scope.contextArtifacts)].sort(),
    graphDocuments: [...new Set(scope.graphDocuments)].sort(),
    verificationDocuments: [...new Set(scope.verificationDocuments)].sort(),
  };
}

function issue(severity: Grace4Issue["severity"], code: string, file: string, message: string): Grace4Issue {
  return { severity, code, file, message };
}
