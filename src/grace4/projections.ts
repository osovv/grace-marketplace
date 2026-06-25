import path from "node:path";

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
  file: string;
  owns: string[];
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

  for (const route of routes) {
    projection.documents.set(route.owner, route.file);
    for (const anchor of route.owns) {
      const previousOwner = expectedAnchors.get(anchor);
      if (previousOwner && previousOwner !== route.owner) {
        projection.issues.push(issue("error", "projection.graph.duplicate-route", paths.graphIndex, `${anchor} is routed by both ${previousOwner} and ${route.owner}.`));
      }
      expectedAnchors.set(anchor, route.owner);
    }

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

  for (const route of routes) {
    projection.documents.set(route.owner, route.file);
    for (const anchor of route.owns) {
      const previousOwner = expectedAnchors.get(anchor);
      if (previousOwner && previousOwner !== route.owner) {
        projection.issues.push(
          issue("error", "projection.verification.duplicate-route", paths.verificationIndex, `${anchor} is routed by both ${previousOwner} and ${route.owner}.`),
        );
      }
      expectedAnchors.set(anchor, route.owner);
    }

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
        commands: collectTextByTag(node, /command/i),
        scenarios: collectTextByTag(node, /scenario/i),
        markers: collectTextByTag(node, /marker/i),
        testFiles: collectTestFiles(node),
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
    .map((node) => routeFromOwnerNode(paths.graceDir, paths.graphIndex, node, (anchor) => isGraphAnchor(anchor), issues));
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
    .map((node) => routeFromOwnerNode(paths.graceDir, paths.verificationIndex, node, (anchor) => ANCHOR_PATTERNS.verification.test(anchor), issues));
}

function routeFromOwnerNode(
  graceDir: string,
  indexFile: string,
  node: GraceXmlNode,
  ownsPredicate: (anchor: string) => boolean,
  issues: Grace4Issue[],
): OwnerRoute {
  const rawPath = childText(node, "Path")?.trim();
  if (!rawPath) {
    issues.push(issue("error", "projection.index.missing-path", indexFile, `${node.tag} route is missing a Path.`));
  }

  const owns = node.children
    .flatMap((child) => (child.tag === "Owns" ? child.children : []))
    .filter((child) => ownsPredicate(child.tag))
    .map((child) => child.tag);

  return {
    owner: node.tag,
    file: rawPath ? resolveArtifactPath(graceDir, rawPath) : path.join(graceDir, "__missing-route__", `${node.tag}.xml`),
    owns,
  };
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

function collectTextByTag(node: GraceXmlNode, tagPattern: RegExp): string[] {
  return [...walkNodes(node)]
    .filter((candidate) => candidate !== node && tagPattern.test(candidate.tag))
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

function collectTestFiles(node: GraceXmlNode): string[] {
  const result: string[] = [];
  for (const tfNode of childNodes(node, "TestFiles")) {
    for (const child of tfNode.children) {
      if (/^file$/i.test(child.tag)) {
        const text = aggregateNodeText(child).trim();
        if (text) result.push(text);
      }
    }
  }
  return result;
}

function resolveArtifactPath(graceDir: string, artifactPath: string) {
  if (path.isAbsolute(artifactPath)) {
    return artifactPath;
  }
  return path.join(graceDir, artifactPath);
}

function issue(severity: Grace4Issue["severity"], code: string, file: string, message: string): Grace4Issue {
  return { severity, code, file, message };
}
