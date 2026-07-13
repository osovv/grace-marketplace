import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { resolveGrace4Paths } from "./project";
import { collectActiveChangeScopes, detectScopeOverlaps, detectUnsafeConcurrentExecution } from "./scope";

function createProject() {
  const root = path.join(os.tmpdir(), `grace4-scope-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeChange(root: string, changeId: string, options: { graphAnchor: string; file: string; glob?: string; status?: string }) {
  const status = options.status ?? "approved";
  const bundle = `.grace/changes/active/${changeId}`;
  writeProjectFile(root, `${bundle}/spec.xml`, `<GraceChangeSpec graceVersion="4.0" status="${status}"><${changeId} /></GraceChangeSpec>`);
  writeProjectFile(
    root,
    `${bundle}/plan.xml`,
    `<GraceChangePlan graceVersion="4.0" status="${status}"><${changeId}><DurableScope><GraphAnchors><${options.graphAnchor} /></GraphAnchors><ContextArtifact>requirements.xml</ContextArtifact></DurableScope><ObservedWriteScope><File>${options.file}</File>${options.glob ? `<Glob>${options.glob}</Glob>` : ""}</ObservedWriteScope></${changeId}></GraceChangePlan>`,
  );
}

describe("GRACE 4 scope detector", () => {
  it("collects active change scopes from approved and draft plans", () => {
    const root = createProject();
    writeChange(root, "C-ONE", { graphAnchor: "M-AUTH-SESSION", file: "src/auth.ts" });
    writeChange(root, "C-TWO", { graphAnchor: "M-PROFILE", file: "src/profile.ts", status: "draft" });

    const scopes = collectActiveChangeScopes(resolveGrace4Paths(root));
    const one = scopes.find((scope) => scope.changeId === "C-ONE");

    expect(scopes.map((scope) => scope.changeId).sort()).toEqual(["C-ONE", "C-TWO"]);
    expect(one?.durable.contextArtifacts).toContain("requirements.xml");
    expect(one?.observedWrites.files).toContain("src/auth.ts");
  });

  it("reports durable overlap as warnings and observed write overlap as blockers", () => {
    const root = createProject();
    writeChange(root, "C-ONE", { graphAnchor: "M-AUTH-SESSION", file: "src/auth.ts", glob: "src/**/*.ts" });
    writeChange(root, "C-TWO", { graphAnchor: "M-AUTH-SESSION", file: "src/auth.ts", glob: "src/**/*.ts" });

    const scopes = collectActiveChangeScopes(resolveGrace4Paths(root));
    const durableIssues = detectScopeOverlaps(scopes);
    const concurrentIssues = detectUnsafeConcurrentExecution(scopes);

    expect(durableIssues[0]?.severity).toBe("warning");
    expect(durableIssues[0]?.code).toBe("scope.durable-overlap");
    expect(concurrentIssues[0]?.severity).toBe("error");
    expect(concurrentIssues[0]?.code).toBe("scope.observed-write-overlap");
  });

  it("blocks file-to-glob and nested glob overlaps while allowing disjoint areas", () => {
    const root = createProject();
    writeChange(root, "C-FILE", { graphAnchor: "M-FILE", file: "src/auth/session.ts" });
    writeChange(root, "C-GLOB", { graphAnchor: "M-GLOB", file: "other.txt", glob: "src/**" });
    writeChange(root, "C-NESTED", { graphAnchor: "M-NESTED", file: "nested.txt", glob: "src/auth/**" });
    writeChange(root, "C-DISJOINT", { graphAnchor: "M-DISJOINT", file: "docs/readme.md", glob: "tests/**" });

    const scopes = collectActiveChangeScopes(resolveGrace4Paths(root));
    const issues = detectUnsafeConcurrentExecution(scopes);
    const messages = issues.map((entry) => entry.message);

    expect(messages.some((message) => message.includes("C-FILE") && message.includes("C-GLOB"))).toBe(true);
    expect(messages.some((message) => message.includes("C-GLOB") && message.includes("C-NESTED"))).toBe(true);
    expect(messages.some((message) => message.includes("C-DISJOINT"))).toBe(false);
  });
});
