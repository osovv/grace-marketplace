import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { detectGraceProjectKind, formatGrace3MigrationGuidance, resolveGrace4Paths } from "./project";
import { ANCHOR_PATTERNS } from "./types";

function createProject() {
  const root = path.join(os.tmpdir(), `grace4-project-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeProjectFile(root: string, relativePath: string, contents = "") {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

describe("GRACE 4 project detection", () => {
  it("resolves canonical .grace paths from a project root", () => {
    const root = createProject();
    const paths = resolveGrace4Paths(root);

    expect(paths.root).toBe(path.resolve(root));
    expect(paths.graceDir).toBe(path.join(root, ".grace"));
    expect(paths.contextDir).toBe(path.join(root, ".grace", "context"));
    expect(paths.graphIndex).toBe(path.join(root, ".grace", "graph", "index.xml"));
    expect(paths.verificationIndex).toBe(path.join(root, ".grace", "verification", "index.xml"));
    expect(paths.changesActiveDir).toBe(path.join(root, ".grace", "changes", "active"));
    expect(paths.changesArchiveDir).toBe(path.join(root, ".grace", "changes", "archive"));
  });

  it("detects .grace projects before legacy docs", () => {
    const root = createProject();
    mkdirSync(path.join(root, ".grace"));
    writeProjectFile(root, "docs/development-plan.xml");

    expect(detectGraceProjectKind(root)).toBe("grace4");
  });

  it("detects legacy GRACE 3 docs when .grace is absent", () => {
    for (const legacyDocument of [
      "docs/requirements.xml",
      "docs/technology.xml",
      "docs/development-plan.xml",
      "docs/knowledge-graph.xml",
      "docs/verification-plan.xml",
      "docs/operational-packets.xml",
    ]) {
      const root = createProject();
      writeProjectFile(root, legacyDocument);
      expect(detectGraceProjectKind(root)).toBe("grace3");
    }
  });

  it("detects roots without GRACE artifacts as none", () => {
    expect(detectGraceProjectKind(createProject())).toBe("none");
  });

  it("guides GRACE 3 projects to grace-migrate without claiming CLI migration support", () => {
    const guidance = formatGrace3MigrationGuidance(createProject());

    expect(guidance).toContain("grace-migrate");
    expect(guidance).toContain("CLI does not migrate");
    expect(guidance).not.toContain("grace migrate");
  });
});

describe("GRACE 4 semantic anchor patterns", () => {
  it("accepts canonical uppercase semantic anchors", () => {
    expect(ANCHOR_PATTERNS.graphDocument.test("GD-MAIN")).toBe(true);
    expect(ANCHOR_PATTERNS.verificationDocument.test("VD-MAIN")).toBe(true);
    expect(ANCHOR_PATTERNS.change.test("C-AUTH-SESSION-REFACTOR")).toBe(true);
    expect(ANCHOR_PATTERNS.module.test("M-AUTH-SESSION")).toBe(true);
    expect(ANCHOR_PATTERNS.verification.test("V-M-AUTH-SESSION")).toBe(true);
    expect(ANCHOR_PATTERNS.dataFlow.test("DF-AUTH-TOKEN-FLOW")).toBe(true);
    expect(ANCHOR_PATTERNS.task.test("T-001")).toBe(true);
  });

  it("rejects lowercase anchors and attribute-style identifiers", () => {
    const invalidByPattern = {
      graphDocument: ["gd-main", "GD-main", "GD_MAIN", "owner=GD-MAIN", "id"],
      verificationDocument: ["vd-main", "VD-main", "VD_MAIN", "owner=VD-MAIN", "id"],
      change: ["c-auth", "C-auth", "C_AUTH", "changeId", "id"],
      module: ["m-auth", "M-auth", "M_AUTH", "moduleId", "id"],
      verification: ["v-m-auth", "V-M-auth", "V_M_AUTH", "verificationId", "id"],
      dataFlow: ["df-auth", "DF-auth", "DF_AUTH", "dataFlowId", "id"],
      task: ["t-001", "T-abc", "T_001", "taskId", "id"],
    } as const;

    for (const [patternName, invalidValues] of Object.entries(invalidByPattern)) {
      const pattern = ANCHOR_PATTERNS[patternName as keyof typeof ANCHOR_PATTERNS];
      for (const value of invalidValues) {
        expect(pattern.test(value), `${patternName} should reject ${value}`).toBe(false);
      }
    }
  });
});
