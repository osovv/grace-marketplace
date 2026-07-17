import { existsSync } from "node:fs";
import path from "node:path";

import type { Grace4ProjectPaths, GraceProjectKind } from "./types";

const LEGACY_GRACE3_DOCUMENTS = [
  "docs/requirements.xml",
  "docs/technology.xml",
  "docs/development-plan.xml",
  "docs/knowledge-graph.xml",
  "docs/verification-plan.xml",
  "docs/operational-packets.xml",
] as const;

/** Resolves canonical GRACE 4 project paths from a repository root. */
export function resolveGrace4Paths(root: string): Grace4ProjectPaths {
  const resolvedRoot = path.resolve(root);
  const graceDir = path.join(resolvedRoot, ".grace");
  const graphDir = path.join(graceDir, "graph");
  const verificationDir = path.join(graceDir, "verification");
  const changesDir = path.join(graceDir, "changes");

  return {
    root: resolvedRoot,
    graceDir,
    contextDir: path.join(graceDir, "context"),
    graphIndex: path.join(graphDir, "index.xml"),
    graphDir,
    verificationIndex: path.join(verificationDir, "index.xml"),
    verificationDir,
    changesActiveDir: path.join(changesDir, "active"),
    changesArchiveDir: path.join(changesDir, "archive"),
  };
}

/** Detects whether a root contains .grace, legacy docs, or no GRACE artifacts. */
export function detectGraceProjectKind(root: string): GraceProjectKind {
  const resolvedRoot = path.resolve(root);

  if (existsSync(path.join(resolvedRoot, ".grace"))) {
    return "grace4";
  }

  if (LEGACY_GRACE3_DOCUMENTS.some((documentPath) => existsSync(path.join(resolvedRoot, documentPath)))) {
    return "grace3";
  }

  return "none";
}

/** Returns a user-facing message for legacy GRACE 3 projects without validating them. */
export function formatGrace3MigrationGuidance(root: string): string {
  return [
    `Legacy GRACE 3 artifacts were detected at ${path.resolve(root)}.`,
    "GRACE 4 tooling validates only the .grace artifact model.",
    "Use the grace-migrate skill to review and agent-apply a migration to .grace artifacts.",
    "The CLI does not migrate, convert, or validate GRACE 3 docs as GRACE 4 state.",
  ].join(" ");
}
