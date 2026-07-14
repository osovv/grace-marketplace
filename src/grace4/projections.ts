import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { ProjectPathError, resolveContainedProjectPath } from "./paths";
import { ANCHOR_PATTERNS, type Grace4Issue, type Grace4ProjectPaths } from "./types";
import { childNodes, childText, readGraceXmlArtifact, walkNodes, type GraceXmlNode } from "./xml";

/** One graph anchor owned by a graph document. */
export type GraphAnchorRecord = {
  id: string;
  kind: "module" | "data-flow";
  owner: string;
  file: string;
  text: string;
  links: string[];
};

/** Unified current graph projection independent of physical segmentation. */
export type GraphProjection = {
  documents: Map<string, string>;
  modules: Map<string, GraphAnchorRecord>;
  dataFlows: Map<string, GraphAnchorRecord>;
  issues: Grace4Issue[];
};

/** One aggregate V-M-* verification contract owned by a verification document. */
export type VerificationAnchorRecord = {
  id: string;
  moduleId: string;
  owner: string;
  file: string;
  priority?: string;
  cwd?: string;
  commands: string[];
  scenarios: string[];
  markers: string[];
  testFiles: string[];
};

/** Unified current verification projection independent of physical segmentation. */
export type VerificationProjection = {
  documents: Map<string, string>;
  entries: Map<string, VerificationAnchorRecord>;
  issues: Grace4Issue[];
};

type OwnerRoute = {
  owner: string;
  authoredPath: string;
  file: string;
  owns: string[];
  valid: boolean;
};

/** Builds and validates the logical graph projection from .grace/graph. */
export function buildGraphProjection(paths: Grace4ProjectPaths): GraphProjection {
  const projection: GraphProjection = {
    documents: new Map(),
    modules: new Map(),
    dataFlows: new Map(),
    issues: [],
  };

  const routes = readGraphRoutes(paths, projection.issues);
  const expectedAnchors = new Map<string, string>();
  const foundAnchors = new Set<string>();
  reportUnindexedDocuments(paths.graphDir, paths.graphIndex, routes, "graph", projection.issues);

  for (const route of routes) {
    if (projection.documents.has(route.owner)) {
      projection.issues.push(issue("error", "projection.graph.duplicate-document-route", paths.graphIndex, `${route.owner} appears more than once in the graph index.`));
    }
    for (const anchor of route.owns) {
      registerOwnedAnchor(expectedAnchors, anchor, route.owner, paths.graphIndex, "graph", projection.issues);
    }
    if (!route.valid) {
      continue;
    }
    projection.documents.set(route.owner, route.file);

    const artifact = readGraceXmlArtifact(route.file);
    projection.issues.push(...artifact.issues);
    if (!artifact.root) {
      continue;
    }

    const wrappers = artifact.root.children.filter((child) => ANCHOR_PATTERNS.graphDocument.test(child.tag));
    const wrapper = wrappers.find((child) => child.tag === route.owner);
    if (!wrapper) {
      projection.issues.push(
        issue("error", "projection.graph.wrapper-mismatch", route.file, `Graph document must contain matching ${route.owner} wrapper.`),
      );
      continue;
    }

    // Detect nested/grouped sections that hide graph anchors below non-anchor grouping tags
    for (const child of wrapper.children) {
      if (!ANCHOR_PATTERNS.module.test(child.tag) && !ANCHOR_PATTERNS.dataFlow.test(child.tag)) {
        const nestedAnchors = [...walkNodes(child)]
          .filter((n) => n !== child)
          .filter((n) => ANCHOR_PATTERNS.module.test(n.tag) || ANCHOR_PATTERNS.dataFlow.test(n.tag))
          .map((n) => n.tag);
        if (nestedAnchors.length > 0) {
          projection.issues.push(
            issue("error", "projection.graph.nested-anchors", route.file,
              route.owner + " contains <" + child.tag + "> with nested graph anchors (" + nestedAnchors.join(", ") + "). Graph anchors must be direct children of " + route.owner + ", not nested inside grouping tags."),
          );
        }
      }
    }

    for (const anchor of graphAnchorsInWrapper(wrapper)) {
      foundAnchors.add(anchor.node.tag);
      const expectedOwner = expectedAnchors.get(anchor.node.tag);
      if (!expectedOwner) {
        projection.issues.push(
          issue("error", "projection.graph.unlisted-anchor", route.file, `${anchor.node.tag} is present but missing from graph index.`),
        );
      } else if (expectedOwner !== route.owner) {
        projection.issues.push(
          issue(
            "error",
            "projection.graph.ownership-mismatch",
            route.file,
            `${anchor.node.tag} is owned by ${expectedOwner} in the index but appears under ${route.owner}.`,
          ),
        );
      }

      const map = anchor.kind === "module" ? projection.modules : projection.dataFlows;
      if (map.has(anchor.node.tag)) {
        projection.issues.push(issue("error", "projection.graph.duplicate-anchor", route.file, `${anchor.node.tag} appears more than once.`));
        continue;
      }

      map.set(anchor.node.tag, {
        id: anchor.node.tag,
        kind: anchor.kind,
        owner: route.owner,
        file: route.file,
        text: aggregateNodeText(anchor.node),
        links: collectGraphLinks(anchor.node),
      });
    }
  }

  for (const [anchor, owner] of expectedAnchors) {
    if (!foundAnchors.has(anchor)) {
      projection.issues.push(
        issue("error", "projection.graph.missing-anchor", paths.graphIndex, `${anchor} is listed under ${owner} but was not found.`),
      );
    }
  }

  validateDanglingGraphLinks(projection);
  return projection;
}

/** Builds and validates the logical verification projection from .grace/verification. */
export function buildVerificationProjection(paths: Grace4ProjectPaths, graph: GraphProjection): VerificationProjection {
  const projection: VerificationProjection = {
    documents: new Map(),
    entries: new Map(),
    issues: [],
  };

  const routes = readVerificationRoutes(paths, projection.issues);
  const expectedAnchors = new Map<string, string>();
  const foundAnchors = new Set<string>();
  reportUnindexedDocuments(paths.verificationDir, paths.verificationIndex, routes, "verification", projection.issues);

  for (const route of routes) {
    if (projection.documents.has(route.owner)) {
      projection.issues.push(issue("error", "projection.verification.duplicate-document-route", paths.verificationIndex, `${route.owner} appears more than once in the verification index.`));
    }
    for (const anchor of route.owns) {
      registerOwnedAnchor(expectedAnchors, anchor, route.owner, paths.verificationIndex, "verification", projection.issues);
    }
    if (!route.valid) {
      continue;
    }
    projection.documents.set(route.owner, route.file);

    const artifact = readGraceXmlArtifact(route.file);
    projection.issues.push(...artifact.issues);
    if (!artifact.root) {
      continue;
    }

    const wrappers = artifact.root.children.filter((child) => ANCHOR_PATTERNS.verificationDocument.test(child.tag));
    const wrapper = wrappers.find((child) => child.tag === route.owner);
    if (!wrapper) {
      projection.issues.push(
        issue("error", "projection.verification.wrapper-mismatch", route.file, `Verification document must contain matching ${route.owner} wrapper.`),
      );
      continue;
    }

    // Detect nested/grouped sections that hide verification anchors below non-anchor grouping tags
    for (const child of wrapper.children) {
      if (!ANCHOR_PATTERNS.verification.test(child.tag)) {
        const nestedAnchors = [...walkNodes(child)]
          .filter((n) => n !== child)
          .filter((n) => ANCHOR_PATTERNS.verification.test(n.tag))
          .map((n) => n.tag);
        if (nestedAnchors.length > 0) {
          projection.issues.push(
            issue("error", "projection.verification.nested-anchors", route.file,
              route.owner + " contains <" + child.tag + "> with nested verification anchors (" + nestedAnchors.join(", ") + "). Verification anchors must be direct children of " + route.owner + ", not nested inside grouping tags."),
          );
        }
      }
    }

    for (const node of verificationAnchorsInWrapper(wrapper)) {
      foundAnchors.add(node.tag);
      const expectedOwner = expectedAnchors.get(node.tag);
      if (!expectedOwner) {
        projection.issues.push(
          issue("error", "projection.verification.unlisted-anchor", route.file, `${node.tag} is present but missing from verification index.`),
        );
      } else if (expectedOwner !== route.owner) {
        projection.issues.push(
          issue(
            "error",
            "projection.verification.ownership-mismatch",
            route.file,
            `${node.tag} is owned by ${expectedOwner} in the index but appears under ${route.owner}.`,
          ),
        );
      }

      if (projection.entries.has(node.tag)) {
        projection.issues.push(issue("error", "projection.verification.duplicate-anchor", route.file, `${node.tag} appears more than once.`));
        continue;
      }

      projection.entries.set(node.tag, {
        id: node.tag,
        moduleId: moduleIdForVerification(node.tag),
        owner: route.owner,
        file: route.file,
        priority: collectPriority(node),
        cwd: collectCwd(node, paths.root, route.file, projection.issues),
        commands: collectExactEvidence(node, "Command"),
        scenarios: collectExactEvidence(node, "Scenario"),
        markers: collectExactEvidence(node, "Marker"),
        testFiles: collectTestFiles(node, paths.root, route.file, projection.issues),
      });
    }
  }

  for (const [anchor, owner] of expectedAnchors) {
    if (!foundAnchors.has(anchor)) {
      projection.issues.push(
        issue("error", "projection.verification.missing-anchor", paths.verificationIndex, `${anchor} is listed under ${owner} but was not found.`),
      );
    }
  }

  validateModuleVerificationCoverage(graph, projection);
  return projection;
}

function readGraphRoutes(paths: Grace4ProjectPaths, issues: Grace4Issue[]): OwnerRoute[] {
  const artifact = readGraceXmlArtifact(paths.graphIndex);
  issues.push(...artifact.issues);
  if (!artifact.root) {
    return [];
  }

  return artifact.root.children
    .flatMap((node) => (node.tag === "GraphDocuments" ? node.children : []))
    .filter((node) => ANCHOR_PATTERNS.graphDocument.test(node.tag))
    .map((node) => routeFromOwnerNode(paths.graceDir, paths.graphDir, paths.graphIndex, node, (anchor) => isGraphAnchor(anchor), issues));
}

function readVerificationRoutes(paths: Grace4ProjectPaths, issues: Grace4Issue[]): OwnerRoute[] {
  const artifact = readGraceXmlArtifact(paths.verificationIndex);
  issues.push(...artifact.issues);
  if (!artifact.root) {
    return [];
  }

  return artifact.root.children
    .flatMap((node) => (node.tag === "VerificationDocuments" ? node.children : []))
    .filter((node) => ANCHOR_PATTERNS.verificationDocument.test(node.tag))
    .map((node) => routeFromOwnerNode(paths.graceDir, paths.verificationDir, paths.verificationIndex, node, (anchor) => ANCHOR_PATTERNS.verification.test(anchor), issues));
}

function routeFromOwnerNode(
  graceDir: string,
  allowedDir: string,
  indexFile: string,
  node: GraceXmlNode,
  ownsPredicate: (anchor: string) => boolean,
  issues: Grace4Issue[],
): OwnerRoute {
  const pathNodes = childNodes(node, "Path");
  const rawPath = pathNodes[0]?.text.trim();
  if (!rawPath) {
    issues.push(issue("error", "projection.index.missing-path", indexFile, `${node.tag} route is missing a Path.`));
  } else if (pathNodes.length !== 1) {
    issues.push(issue("error", "projection.index.duplicate-path", indexFile, `${node.tag} route must contain exactly one Path.`));
  }

  let resolvedPath: string | null = null;
  if (rawPath) {
    try {
      resolvedPath = resolveContainedProjectPath(graceDir, rawPath, {
        allowedRoot: allowedDir,
        mode: "existing",
        extension: ".xml",
      }).absolutePath;
    } catch (error) {
      const detail = error instanceof ProjectPathError ? `${error.code}: ${error.message}` : String(error);
      issues.push(issue("error", "projection.index.invalid-path", indexFile, `${node.tag} Path ${JSON.stringify(rawPath)} is invalid: ${detail}`));
    }
  }

  const owns = node.children
    .flatMap((child) => (child.tag === "Owns" ? child.children : []))
    .filter((child) => ownsPredicate(child.tag))
    .map((child) => child.tag);

  return {
    owner: node.tag,
    authoredPath: rawPath ?? "",
    file: resolvedPath ?? path.join(graceDir, "__invalid-route__", `${node.tag}.xml`),
    owns,
    valid: resolvedPath !== null,
  };
}

function registerOwnedAnchor(
  expectedAnchors: Map<string, string>,
  anchor: string,
  owner: string,
  indexFile: string,
  kind: "graph" | "verification",
  issues: Grace4Issue[],
): void {
  const previousOwner = expectedAnchors.get(anchor);
  if (previousOwner) {
    issues.push(
      issue(
        "error",
        `projection.${kind}.duplicate-route`,
        indexFile,
        `${anchor} is declared more than once under ${previousOwner === owner ? owner : `${previousOwner} and ${owner}`}.`,
      ),
    );
    return;
  }
  expectedAnchors.set(anchor, owner);
}

function graphAnchorsInWrapper(wrapper: GraceXmlNode): Array<{ node: GraceXmlNode; kind: GraphAnchorRecord["kind"] }> {
  return wrapper.children
    .flatMap((node): Array<{ node: GraceXmlNode; kind: GraphAnchorRecord["kind"] }> => {
      if (ANCHOR_PATTERNS.module.test(node.tag)) {
        return [{ node, kind: "module" as const }];
      }
      if (ANCHOR_PATTERNS.dataFlow.test(node.tag)) {
        return [{ node, kind: "data-flow" as const }];
      }
      return [];
    });
}

function verificationAnchorsInWrapper(wrapper: GraceXmlNode): GraceXmlNode[] {
  return wrapper.children.filter((node) => ANCHOR_PATTERNS.verification.test(node.tag));
}

function collectGraphLinks(node: GraceXmlNode): string[] {
  return [...new Set(
    [...walkNodes(node)]
      .filter((candidate) => candidate !== node)
      .map((candidate) => candidate.tag)
      .filter((tag) => isGraphAnchor(tag)),
  )].sort();
}

function validateDanglingGraphLinks(projection: GraphProjection) {
  const known = new Set([...projection.modules.keys(), ...projection.dataFlows.keys()]);
  for (const record of [...projection.modules.values(), ...projection.dataFlows.values()]) {
    for (const link of record.links) {
      if (!known.has(link)) {
        projection.issues.push(issue("error", "projection.graph.dangling-link", record.file, `${record.id} links to missing ${link}.`));
      }
    }
  }
}

function validateModuleVerificationCoverage(graph: GraphProjection, verification: VerificationProjection) {
  for (const moduleId of graph.modules.keys()) {
    const expectedVerification = `V-${moduleId}`;
    if (!verification.entries.has(expectedVerification)) {
      verification.issues.push(
        issue("error", "projection.verification.missing-module-coverage", "verification", `${moduleId} requires ${expectedVerification}.`),
      );
    }
  }

  for (const entry of verification.entries.values()) {
    if (!graph.modules.has(entry.moduleId)) {
      verification.issues.push(
        issue("error", "projection.verification.dangling-module", entry.file, `${entry.id} references missing ${entry.moduleId}.`),
      );
    }
  }
}

function collectExactEvidence(node: GraceXmlNode, tag: "Command" | "Scenario" | "Marker"): string[] {
  return [...walkNodes(node)]
    .filter((candidate) => candidate !== node && candidate.tag === tag)
    .map((candidate) => aggregateNodeText(candidate).trim())
    .filter(Boolean);
}

function aggregateNodeText(node: GraceXmlNode): string {
  return [node.text, ...node.children.map((child) => `${child.tag} ${aggregateNodeText(child)}`)].join(" ").replace(/\s+/g, " ").trim();
}

function moduleIdForVerification(verificationId: string) {
  return verificationId.startsWith("V-") ? verificationId.slice(2) : verificationId;
}

function isGraphAnchor(anchor: string) {
  return ANCHOR_PATTERNS.module.test(anchor) || ANCHOR_PATTERNS.dataFlow.test(anchor);
}

function collectPriority(node: GraceXmlNode): string | undefined {
  const priority = childText(node, "Priority")?.trim();
  return priority || undefined;
}

function collectCwd(node: GraceXmlNode, projectRoot: string, file: string, issues: Grace4Issue[]): string | undefined {
  const cwdNodes = childNodes(node, "Cwd");
  if (cwdNodes.length > 1) {
    issues.push(issue("error", "projection.verification.duplicate-cwd", file, `${node.tag} must contain at most one direct Cwd.`));
  }
  const authoredCwd = cwdNodes[0]?.text.trim();
  if (!authoredCwd || authoredCwd === ".") {
    return undefined;
  }
  try {
    const cwd = resolveContainedProjectPath(projectRoot, authoredCwd, { mode: "existing" });
    if (!statSync(cwd.absolutePath).isDirectory()) {
      issues.push(issue("error", "projection.verification.invalid-cwd", file, `${node.tag} Cwd ${JSON.stringify(authoredCwd)} must resolve to a directory.`));
      return undefined;
    }
    return cwd.relativePath;
  } catch (error) {
    const detail = error instanceof ProjectPathError ? `${error.code}: ${error.message}` : String(error);
    issues.push(issue("error", "projection.verification.invalid-cwd", file, `${node.tag} Cwd ${JSON.stringify(authoredCwd)} is invalid: ${detail}`));
    return undefined;
  }
}

function collectTestFiles(node: GraceXmlNode, projectRoot: string, file: string, issues: Grace4Issue[]): string[] {
  const result: string[] = [];
  for (const tfNode of childNodes(node, "TestFiles")) {
    for (const child of tfNode.children) {
      if (child.tag === "File") {
        const text = aggregateNodeText(child).trim();
        if (!text) {
          continue;
        }
        try {
          result.push(resolveContainedProjectPath(projectRoot, text, { mode: "existing" }).relativePath);
        } catch (error) {
          const detail = error instanceof ProjectPathError ? `${error.code}: ${error.message}` : String(error);
          issues.push(issue("error", "projection.verification.invalid-test-file", file, `${node.tag} TestFiles/File ${JSON.stringify(text)} is invalid: ${detail}`));
        }
      }
    }
  }
  return result;
}

function reportUnindexedDocuments(
  directory: string,
  indexFile: string,
  routes: OwnerRoute[],
  kind: "graph" | "verification",
  issues: Grace4Issue[],
): void {
  const routedFiles = new Set(routes.filter((route) => route.valid).map((route) => path.resolve(route.file)));
  for (const file of listXmlFiles(directory)) {
    if (path.resolve(file) === path.resolve(indexFile) || routedFiles.has(path.resolve(file))) {
      continue;
    }
    issues.push(issue(
      "error",
      kind === "graph" ? "projection.graph.unindexed-document" : "projection.verification.unindexed-document",
      file,
      `${path.relative(path.dirname(indexFile), file)} exists but is not routed by ${path.basename(indexFile)}.`,
    ));
  }
}

function listXmlFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return listXmlFiles(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".xml") ? [entryPath] : [];
  }).sort();
}

function issue(severity: Grace4Issue["severity"], code: string, file: string, message: string): Grace4Issue {
  return { severity, code, file, message };
}
