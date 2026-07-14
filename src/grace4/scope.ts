import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { ProjectPathError, normalizeProjectRelativePath, resolveContainedProjectPath } from "./paths";
import type { GraphProjection, VerificationProjection } from "./projections";
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

/** Supported segment in the GRACE observed-scope glob grammar. */
export type ScopeGlobSegment =
  | { kind: "globstar" }
  | { kind: "pattern"; source: string; regex: RegExp; literalSuffix?: string };

/** Parsed project-relative glob with deterministic platform case semantics. */
export type ParsedScopeGlob = {
  authoredPattern: string;
  normalizedPattern: string;
  segments: ScopeGlobSegment[];
};

/** Owner routes used to expand document-to-anchor durable conflicts. */
export type DurableOwnershipIndex = {
  graphDocuments: Map<string, Set<string>>;
  verificationDocuments: Map<string, Set<string>>;
};

/** Active change summary used for overlap detection and status reporting. */
export type ActiveChangeScope = {
  changeId: string;
  bundlePath: string;
  specStatus: string;
  planStatus?: string;
  durable: DurableScope;
  observedWrites: ObservedWriteScope;
  issues: Grace4Issue[];
};

const EMPTY_OWNERSHIP: DurableOwnershipIndex = {
  graphDocuments: new Map(),
  verificationDocuments: new Map(),
};

/** Returns whether one project-relative file is covered by an observed write scope. */
export function observedWriteScopeContains(scope: ObservedWriteScope, filePath: string): boolean {
  let normalizedFile: string;
  try {
    normalizedFile = normalizeProjectRelativePath(filePath);
  } catch {
    return false;
  }
  const caseSensitive = defaultCaseSensitivity();
  return scope.files.some((file) => equalPath(file, normalizedFile, caseSensitive))
    || scope.globs.some((glob) => {
      try {
        return globMatchesFile(parseScopeGlob(glob), normalizedFile, caseSensitive);
      } catch {
        return false;
      }
    });
}

/** Parses literals, *, ?, and a whole-segment **. */
export function parseScopeGlob(authoredPattern: string): ParsedScopeGlob {
  if (/[{}\[\]()]/.test(authoredPattern) || authoredPattern.startsWith("!")) {
    throw new Error(`Unsupported GRACE scope glob syntax: ${JSON.stringify(authoredPattern)}.`);
  }

  let normalizedPattern: string;
  try {
    normalizedPattern = normalizeProjectRelativePath(authoredPattern);
  } catch (error) {
    const detail = error instanceof ProjectPathError ? `${error.code}: ${error.message}` : String(error);
    throw new Error(`Invalid GRACE scope glob ${JSON.stringify(authoredPattern)}: ${detail}`);
  }

  const segments = normalizedPattern.split("/").map((source): ScopeGlobSegment => {
    if (source === "**") {
      return { kind: "globstar" };
    }
    if (source.includes("**")) {
      throw new Error(`Globstar must occupy a whole path segment in ${JSON.stringify(authoredPattern)}.`);
    }
    const wildcardIndex = Math.max(source.lastIndexOf("*"), source.lastIndexOf("?"));
    return {
      kind: "pattern",
      source,
      regex: new RegExp(`^${wildcardSegmentRegex(source)}$`),
      literalSuffix: wildcardIndex >= 0 ? source.slice(wildcardIndex + 1) || undefined : source,
    };
  });

  return { authoredPattern, normalizedPattern, segments };
}

/** Returns true only when the supported glob languages have at least one common project-relative path. */
export function scopeGlobsOverlap(left: ParsedScopeGlob, right: ParsedScopeGlob, caseSensitive: boolean): boolean {
  const queue: Array<[number, number]> = [[0, 0]];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const [leftIndex, rightIndex] = queue.shift()!;
    const key = `${leftIndex}:${rightIndex}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);

    if (leftIndex === left.segments.length && rightIndex === right.segments.length) {
      return true;
    }

    const leftSegment = left.segments[leftIndex];
    const rightSegment = right.segments[rightIndex];
    if (leftSegment?.kind === "globstar") {
      queue.push([leftIndex + 1, rightIndex]);
    }
    if (rightSegment?.kind === "globstar") {
      queue.push([leftIndex, rightIndex + 1]);
    }
    if (!leftSegment || !rightSegment || !scopeSegmentsCanSharePathSegment(leftSegment, rightSegment, caseSensitive)) {
      continue;
    }

    queue.push([
      leftSegment.kind === "globstar" ? leftIndex : leftIndex + 1,
      rightSegment.kind === "globstar" ? rightIndex : rightIndex + 1,
    ]);
  }

  return false;
}

/** Builds exact document ownership used by durable overlap and drift attribution. */
export function createDurableOwnershipIndex(
  graph: GraphProjection,
  verification: VerificationProjection,
): DurableOwnershipIndex {
  const ownership: DurableOwnershipIndex = {
    graphDocuments: new Map([...graph.documents.keys()].map((document) => [document, new Set<string>()])),
    verificationDocuments: new Map([...verification.documents.keys()].map((document) => [document, new Set<string>()])),
  };
  for (const record of [...graph.modules.values(), ...graph.dataFlows.values()]) {
    addOwnedAnchor(ownership.graphDocuments, record.owner, record.id);
  }
  for (const record of verification.entries.values()) {
    addOwnedAnchor(ownership.verificationDocuments, record.owner, record.id);
  }
  return ownership;
}

/** Reads active change bundles and extracts declared scopes from approved or draft plans. */
export function collectActiveChangeScopes(paths: Grace4ProjectPaths): ActiveChangeScope[] {
  if (!existsSync(paths.changesActiveDir)) {
    return [];
  }

  return readdirSync(paths.changesActiveDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && ANCHOR_PATTERNS.change.test(entry.name))
    .map((entry) => readActiveChangeScope(paths, path.join(paths.changesActiveDir, entry.name), entry.name))
    .filter((scope): scope is ActiveChangeScope => scope !== null);
}

/** Returns warning-only coexistence diagnostics for approved plans. */
export function detectScopeOverlaps(
  changes: ActiveChangeScope[],
  ownership: DurableOwnershipIndex = EMPTY_OWNERSHIP,
): Grace4Issue[] {
  const issues: Grace4Issue[] = [];
  forEachApprovedPair(changes, (left, right) => {
    const overlaps = durableOverlaps(left.durable, right.durable, ownership);
    if (overlaps.length > 0) {
      issues.push(issue("warning", "scope.durable-overlap", left.bundlePath, `${left.changeId} overlaps ${right.changeId} durable scope: ${overlaps.join(", ")}.`));
    }
  });
  return issues;
}

/** Returns blocking diagnostics when either durable or observed scope overlaps during explicit parallel preflight. */
export function detectUnsafeConcurrentExecution(
  changes: ActiveChangeScope[],
  ownership: DurableOwnershipIndex = EMPTY_OWNERSHIP,
): Grace4Issue[] {
  const issues: Grace4Issue[] = [];
  const caseSensitive = detectScopeCaseSensitivity(changes);
  forEachApprovedPair(changes, (left, right) => {
    const durable = durableOverlaps(left.durable, right.durable, ownership);
    if (durable.length > 0) {
      issues.push(issue("error", "scope.parallel-durable-overlap", left.bundlePath, `${left.changeId} and ${right.changeId} cannot run in parallel; overlapping durable scope: ${durable.join(", ")}.`));
    }
    const observed = observedWriteOverlaps(left.observedWrites, right.observedWrites, caseSensitive);
    if (observed.length > 0) {
      issues.push(issue("error", "scope.observed-write-overlap", left.bundlePath, `${left.changeId} and ${right.changeId} cannot run in parallel; overlapping writes: ${observed.join(", ")}.`));
    }
  });
  return issues;
}

/** Returns durable overlap including document-to-anchor ownership. */
export function durableOverlaps(
  left: DurableScope,
  right: DurableScope,
  ownership: DurableOwnershipIndex = EMPTY_OWNERSHIP,
): string[] {
  const overlaps = new Set<string>([
    ...intersection(left.graphAnchors, right.graphAnchors),
    ...intersection(left.verificationAnchors, right.verificationAnchors),
    ...intersection(left.contextArtifacts, right.contextArtifacts),
    ...intersection(left.graphDocuments, right.graphDocuments),
    ...intersection(left.verificationDocuments, right.verificationDocuments),
  ]);
  addDocumentAnchorOverlaps(overlaps, "graph", left.graphDocuments, right.graphAnchors, ownership.graphDocuments);
  addDocumentAnchorOverlaps(overlaps, "graph", right.graphDocuments, left.graphAnchors, ownership.graphDocuments);
  addDocumentAnchorOverlaps(overlaps, "verification", left.verificationDocuments, right.verificationAnchors, ownership.verificationDocuments);
  addDocumentAnchorOverlaps(overlaps, "verification", right.verificationDocuments, left.verificationAnchors, ownership.verificationDocuments);
  return [...overlaps].sort();
}

function readActiveChangeScope(paths: Grace4ProjectPaths, bundlePath: string, changeId: string): ActiveChangeScope | null {
  const spec = readGraceXmlArtifact(path.join(bundlePath, "spec.xml"));
  const planFile = path.join(bundlePath, "plan.xml");
  const plan = readGraceXmlArtifact(planFile);
  const specStatus = spec.root?.attributes.status ?? "missing";
  const planStatus = plan.root?.attributes.status;

  if (!plan.root || !["draft", "approved"].includes(specStatus) || (planStatus && !["draft", "approved"].includes(planStatus))) {
    return null;
  }

  const observed = extractObservedWriteScope(plan.root, paths.root, planFile);
  return {
    changeId,
    bundlePath,
    specStatus,
    planStatus,
    durable: extractDurableScope(plan.root),
    observedWrites: observed.scope,
    issues: observed.issues,
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

function extractObservedWriteScope(
  root: GraceXmlNode,
  projectRoot: string,
  planFile: string,
): { scope: ObservedWriteScope; issues: Grace4Issue[] } {
  const scopeNode = [...walkNodes(root)].find((node) => node.tag === "ObservedWriteScope");
  const scope: ObservedWriteScope = { files: [], globs: [] };
  const issues: Grace4Issue[] = [];
  if (!scopeNode) {
    return { scope, issues };
  }

  for (const authoredFile of textChildren(scopeNode, ["File", "Path"])) {
    try {
      scope.files.push(resolveContainedProjectPath(projectRoot, authoredFile, { mode: "output" }).relativePath);
    } catch (error) {
      const detail = error instanceof ProjectPathError ? `${error.code}: ${error.message}` : String(error);
      issues.push(issue("error", "scope.invalid-path", planFile, `Observed write path ${JSON.stringify(authoredFile)} is invalid: ${detail}`));
    }
  }
  for (const authoredGlob of textChildren(scopeNode, ["Glob"])) {
    try {
      scope.globs.push(parseScopeGlob(authoredGlob).normalizedPattern);
    } catch (error) {
      issues.push(issue("error", "scope.unsupported-glob", planFile, error instanceof Error ? error.message : String(error)));
    }
  }
  scope.files = [...new Set(scope.files)].sort();
  scope.globs = [...new Set(scope.globs)].sort();
  return { scope, issues };
}

function textChildren(node: GraceXmlNode, tags: string[]): string[] {
  const tagSet = new Set(tags);
  return [...walkNodes(node)]
    .filter((child) => child !== node && tagSet.has(child.tag))
    .map((child) => child.text.trim())
    .filter(Boolean);
}

function forEachApprovedPair(changes: ActiveChangeScope[], callback: (left: ActiveChangeScope, right: ActiveChangeScope) => void) {
  const approved = changes.filter((change) => change.specStatus === "approved" && change.planStatus === "approved");
  for (let index = 0; index < approved.length; index += 1) {
    for (let next = index + 1; next < approved.length; next += 1) {
      callback(approved[index]!, approved[next]!);
    }
  }
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return [...new Set(left.filter((value) => rightSet.has(value)))].sort();
}

function observedWriteOverlaps(left: ObservedWriteScope, right: ObservedWriteScope, caseSensitive: boolean): string[] {
  const overlaps = new Set<string>();
  for (const leftFile of left.files) {
    for (const rightFile of right.files) {
      if (equalPath(leftFile, rightFile, caseSensitive)) {
        overlaps.add(leftFile);
      }
    }
  }
  for (const file of left.files) {
    for (const glob of right.globs) {
      if (globMatchesFile(parseScopeGlob(glob), file, caseSensitive)) {
        overlaps.add(`${file} ↔ ${glob}`);
      }
    }
  }
  for (const file of right.files) {
    for (const glob of left.globs) {
      if (globMatchesFile(parseScopeGlob(glob), file, caseSensitive)) {
        overlaps.add(`${file} ↔ ${glob}`);
      }
    }
  }
  for (const leftGlob of left.globs) {
    for (const rightGlob of right.globs) {
      if (scopeGlobsOverlap(parseScopeGlob(leftGlob), parseScopeGlob(rightGlob), caseSensitive)) {
        overlaps.add(`${leftGlob} ↔ ${rightGlob}`);
      }
    }
  }
  return [...overlaps].sort();
}

function globMatchesFile(glob: ParsedScopeGlob, file: string, caseSensitive: boolean): boolean {
  const fileSegments = file.split("/");
  const memo = new Map<string, boolean>();
  const match = (globIndex: number, fileIndex: number): boolean => {
    const key = `${globIndex}:${fileIndex}`;
    if (memo.has(key)) {
      return memo.get(key)!;
    }
    if (globIndex === glob.segments.length) {
      return fileIndex === fileSegments.length;
    }
    const segment = glob.segments[globIndex]!;
    let result: boolean;
    if (segment.kind === "globstar") {
      result = match(globIndex + 1, fileIndex)
        || (fileIndex < fileSegments.length && match(globIndex, fileIndex + 1));
    } else {
      result = fileIndex < fileSegments.length
        && segmentMatches(segment, fileSegments[fileIndex]!, caseSensitive)
        && match(globIndex + 1, fileIndex + 1);
    }
    memo.set(key, result);
    return result;
  };
  return match(0, 0);
}

function scopeSegmentsCanSharePathSegment(left: ScopeGlobSegment, right: ScopeGlobSegment, caseSensitive: boolean): boolean {
  if (left.kind === "globstar" || right.kind === "globstar") {
    return true;
  }
  return segmentPatternsOverlap(left.source, right.source, caseSensitive);
}

function segmentPatternsOverlap(left: string, right: string, caseSensitive: boolean): boolean {
  const leftTokens = Array.from(left);
  const rightTokens = Array.from(right);
  const queue: Array<[number, number]> = [[0, 0]];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const [leftIndex, rightIndex] = queue.shift()!;
    const key = `${leftIndex}:${rightIndex}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    if (leftIndex === leftTokens.length && rightIndex === rightTokens.length) {
      return true;
    }
    const leftToken = leftTokens[leftIndex];
    const rightToken = rightTokens[rightIndex];
    if (leftToken === "*") {
      queue.push([leftIndex + 1, rightIndex]);
    }
    if (rightToken === "*") {
      queue.push([leftIndex, rightIndex + 1]);
    }
    if (!leftToken || !rightToken || !tokensCanShareCharacter(leftToken, rightToken, caseSensitive)) {
      continue;
    }
    queue.push([leftToken === "*" ? leftIndex : leftIndex + 1, rightToken === "*" ? rightIndex : rightIndex + 1]);
  }
  return false;
}

function tokensCanShareCharacter(left: string, right: string, caseSensitive: boolean): boolean {
  if (left === "*" || left === "?" || right === "*" || right === "?") {
    return true;
  }
  return caseSensitive ? left === right : left.toLocaleLowerCase() === right.toLocaleLowerCase();
}

function segmentMatches(segment: Extract<ScopeGlobSegment, { kind: "pattern" }>, value: string, caseSensitive: boolean): boolean {
  return caseSensitive ? segment.regex.test(value) : new RegExp(segment.regex.source, "i").test(value);
}

function wildcardSegmentRegex(source: string): string {
  return Array.from(source).map((character) => {
    if (character === "*") {
      return "[^/]*";
    }
    if (character === "?") {
      return "[^/]";
    }
    return character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }).join("");
}

function addDocumentAnchorOverlaps(
  overlaps: Set<string>,
  kind: "graph" | "verification",
  documents: string[],
  anchors: string[],
  ownership: Map<string, Set<string>>,
): void {
  const anchorSet = new Set(anchors);
  for (const document of documents) {
    for (const anchor of ownership.get(document) ?? []) {
      if (anchorSet.has(anchor)) {
        overlaps.add(`${kind}:${document}↔${anchor}`);
      }
    }
  }
}

function addOwnedAnchor(index: Map<string, Set<string>>, owner: string, anchor: string): void {
  const anchors = index.get(owner) ?? new Set<string>();
  anchors.add(anchor);
  index.set(owner, anchors);
}

function equalPath(left: string, right: string, caseSensitive: boolean): boolean {
  return caseSensitive ? left === right : left.toLocaleLowerCase() === right.toLocaleLowerCase();
}

function detectScopeCaseSensitivity(changes: ActiveChangeScope[]): boolean {
  const bundle = changes[0]?.bundlePath;
  if (!bundle) {
    return defaultCaseSensitivity();
  }
  const marker = `${path.sep}.grace${path.sep}`;
  const markerIndex = bundle.indexOf(marker);
  if (markerIndex < 0) {
    return defaultCaseSensitivity();
  }
  const root = bundle.slice(0, markerIndex);
  const graceDir = path.join(root, ".grace");
  const alternateGraceDir = path.join(root, ".GRACE");
  if (!existsSync(alternateGraceDir)) {
    return true;
  }
  try {
    return realpathSync(graceDir) !== realpathSync(alternateGraceDir);
  } catch {
    return defaultCaseSensitivity();
  }
}

function defaultCaseSensitivity(): boolean {
  return process.platform !== "win32" && process.platform !== "darwin";
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
