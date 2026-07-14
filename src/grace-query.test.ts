import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { findModules, findVerifications, loadGraceArtifactIndex, resolveGovernedFile, resolveModule, resolveVerification } from "./query/core";
import { GraceCommandError } from "./query/errors";
import { buildModuleHealth } from "./query/health";

function createProject() {
  const root = mkdtempSync(path.join(os.tmpdir(), "grace-query-"));
  return root;
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeProjectSkeleton(root: string) {
  writeProjectFile(root, ".grace/context/requirements.xml", `<GraceRequirements graceVersion="4.0"><Summary>Required.</Summary></GraceRequirements>`);
  writeProjectFile(root, ".grace/context/technology.xml", `<GraceTechnology graceVersion="4.0"><Runtime>Bun</Runtime></GraceTechnology>`);
  writeProjectFile(root, ".grace/context/principles.xml", `<GracePrinciples graceVersion="4.0"><Principle>Safe.</Principle></GracePrinciples>`);
  writeProjectFile(root, ".grace/context/deployment.xml", `<GraceDeployment graceVersion="4.0"><Applicability>applicable</Applicability></GraceDeployment>`);
  writeProjectFile(root, ".grace/context/ux-guidelines.xml", `<GraceUXGuidelines graceVersion="4.0"><Applicability>applicable</Applicability></GraceUXGuidelines>`);
  mkdirSync(path.join(root, ".grace", "changes", "active"), { recursive: true });
  mkdirSync(path.join(root, ".grace", "changes", "archive"), { recursive: true });
}

function writeGrace4Artifacts(root: string) {
  writeProjectSkeleton(root);
  writeProjectFile(
    root,
    ".grace/graph/index.xml",
    `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-DB /><M-PROVIDER-PERSIST /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
  );
  writeProjectFile(
    root,
    ".grace/graph/main.xml",
    `<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-DB><Summary>Provide a shared database client.</Summary><Path>src/db</Path></M-DB><M-PROVIDER-PERSIST><Summary>Persist provider configuration records.</Summary><Path>src/provider</Path><M-DB /></M-PROVIDER-PERSIST></GD-MAIN></GraceGraphDocument>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/index.xml",
    `<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-DB /><V-M-PROVIDER-PERSIST /></Owns></VD-MAIN></VerificationDocuments></GraceVerificationIndex>`,
  );
  writeProjectFile(
    root,
    ".grace/verification/main.xml",
    `<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-DB><Scenario>Database client is available.</Scenario></V-M-DB><V-M-PROVIDER-PERSIST><Priority>high</Priority><Command>bun test src/provider/config-repo.test.ts</Command><Scenario>Reads and writes provider config records.</Scenario><Marker>[ProviderConfigPersistence][getProviderConfig][BLOCK_GET_PROVIDER_CONFIG]</Marker></V-M-PROVIDER-PERSIST></VD-MAIN></GraceVerificationDocument>`,
  );
}

function writeGovernedFiles(root: string) {
  writeProjectFile(
    root,
    "src/db/index.ts",
    `// START_MODULE_CONTRACT
//   PURPOSE: Expose the shared database surface
//   SCOPE: Provide the shared db client singleton
//   DEPENDS: none
//   LINKS: M-DB
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   db - Shared database client export
// END_MODULE_MAP
export const db = {};
`,
  );
  writeProjectFile(
    root,
    "src/provider/config-repo.ts",
    `// START_MODULE_CONTRACT
//   PURPOSE: Persist and retrieve provider configuration records
//   SCOPE: Read and write singleton provider config rows
//   DEPENDS: M-DB
//   LINKS: M-PROVIDER-PERSIST, M-DB
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   getProviderConfig - Fetch provider configuration
//   providerConfigRepo - Repository API object
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added provider config repository]
// END_CHANGE_SUMMARY
//
// START_CONTRACT: getProviderConfig
//   PURPOSE: Read provider configuration from storage
//   OUTPUTS: { Promise<object> }
// END_CONTRACT: getProviderConfig
export async function getProviderConfig() {
  console.info("[ProviderConfigPersistence][getProviderConfig][BLOCK_GET_PROVIDER_CONFIG] read");
  // START_BLOCK_GET_PROVIDER_CONFIG
  return { ok: true };
  // END_BLOCK_GET_PROVIDER_CONFIG
}
//
// START_CONTRACT: providerConfigRepo
//   PURPOSE: Expose repository operations as a stable API surface
// END_CONTRACT: providerConfigRepo
export const providerConfigRepo = { getProviderConfig };
`,
  );
  writeProjectFile(
    root,
    "src/provider/config-repo.test.ts",
    `// START_MODULE_CONTRACT
//   PURPOSE: Verify provider config repository behavior.
//   SCOPE: Deterministic repository tests and evidence checks.
//   DEPENDS: bun:test, M-PROVIDER-PERSIST
//   LINKS: M-PROVIDER-PERSIST
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   provider config smoke - Confirms provider repository evidence marker.
// END_MODULE_MAP
import { expect, test } from "bun:test";

test("provider config evidence marker", () => {
  expect("[ProviderConfigPersistence][getProviderConfig][BLOCK_GET_PROVIDER_CONFIG]").toContain("BLOCK_GET_PROVIDER_CONFIG");
});
`,
  );
}

function createQueryProject() {
  const root = createProject();
  writeGrace4Artifacts(root);
  writeGovernedFiles(root);
  return root;
}

describe("grace query core", () => {
  it("loads .grace projections and file-local module context into one index", () => {
    const root = createQueryProject();
    const index = loadGraceArtifactIndex(root);

    const providerModule = resolveModule(index, "M-PROVIDER-PERSIST");
    expect(providerModule.graph.path).toBe("src/provider");
    expect(providerModule.verifications.map((entry) => entry.id)).toEqual(["V-M-PROVIDER-PERSIST"]);
    expect(providerModule.localFiles.map((file) => file.path)).toEqual([
      "src/provider/config-repo.test.ts",
      "src/provider/config-repo.ts",
    ]);
    expect(index.issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
  });

  it("finds modules through projection fields, dependencies, verification ids, and file-local paths", () => {
    const root = createQueryProject();
    const index = loadGraceArtifactIndex(root);

    const pathMatches = findModules(index, { query: "src/provider/config-repo.ts" });
    expect(pathMatches[0]?.module.id).toBe("M-PROVIDER-PERSIST");

    const dependencyMatches = findModules(index, { dependsOn: "M-DB" });
    expect(dependencyMatches.map((match) => match.module.id)).toEqual(["M-PROVIDER-PERSIST"]);

    const verificationMatches = findModules(index, { query: "V-M-PROVIDER-PERSIST" });
    expect(verificationMatches[0]?.module.id).toBe("M-PROVIDER-PERSIST");
  });

  it("resolves module show targets by choosing the most specific owning module path", () => {
    const root = createQueryProject();
    const index = loadGraceArtifactIndex(root);

    const providerModule = resolveModule(index, "src/provider/config-repo.ts");
    expect(providerModule.id).toBe("M-PROVIDER-PERSIST");
  });

  it("parses file-local contracts and blocks for file show", () => {
    const root = createQueryProject();
    const index = loadGraceArtifactIndex(root);

    const fileRecord = resolveGovernedFile(index, "src/provider/config-repo.ts");
    expect(fileRecord.linkedModuleIds).toEqual(["M-PROVIDER-PERSIST", "M-DB"]);
    expect(fileRecord.moduleMap.map((item) => item.label)).toEqual([
      "getProviderConfig - Fetch provider configuration",
      "providerConfigRepo - Repository API object",
    ]);
    expect(fileRecord.contracts.map((contract) => contract.name)).toEqual(["getProviderConfig", "providerConfigRepo"]);
    expect(fileRecord.blocks.map((block) => block.name)).toEqual(["GET_PROVIDER_CONFIG"]);
  });

  it("finds verification entries and resolves them by id or module target", () => {
    const root = createQueryProject();
    const index = loadGraceArtifactIndex(root);

    expect(findVerifications(index, { query: "provider config" }).map((match) => match.verification.id)).toEqual(["V-M-PROVIDER-PERSIST"]);
    expect(findVerifications(index, { query: "bun test" }).map((match) => match.verification.id)).toEqual(["V-M-PROVIDER-PERSIST"]);
    expect(findVerifications(index, { query: "BLOCK_GET_PROVIDER_CONFIG" }).map((match) => match.verification.id)).toEqual(["V-M-PROVIDER-PERSIST"]);

    const resolved = resolveVerification(index, "M-PROVIDER-PERSIST");
    expect(resolved.verification.id).toBe("V-M-PROVIDER-PERSIST");
    expect(resolved.module?.id).toBe("M-PROVIDER-PERSIST");
  });

  it("collects explicit TestFiles/File from verification entries into query model", () => {
    const root = createProject();
    writeProjectSkeleton(root);
    writeProjectFile(
      root,
      ".grace/graph/index.xml",
      '<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-EXAMPLE /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>',
    );
    writeProjectFile(
      root,
      ".grace/graph/main.xml",
      '<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-EXAMPLE><Summary>Example module.</Summary></M-EXAMPLE></GD-MAIN></GraceGraphDocument>',
    );
    writeProjectFile(
      root,
      ".grace/verification/index.xml",
      '<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-EXAMPLE /></Owns></VD-MAIN></VerificationDocuments></GraceVerificationIndex>',
    );
    // Verification has both a Command with a test file reference AND explicit TestFiles/File tags
    writeProjectFile(root, "apps/web/src/module-explicit.test.ts", "test\n");
    writeProjectFile(root, "apps/web/src/module-additional.test.ts", "test\n");
    writeProjectFile(
      root,
      ".grace/verification/main.xml",
      '<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-EXAMPLE><Cwd>apps/web</Cwd><Command>bun test src/module.test.ts</Command><TestFiles><File>apps/web/src/module-explicit.test.ts</File><File>apps/web/src/module-additional.test.ts</File></TestFiles><Scenario>example works</Scenario><Marker>[Example]</Marker></V-M-EXAMPLE></VD-MAIN></GraceVerificationDocument>',
    );

    const index = loadGraceArtifactIndex(root);
    const resolved = resolveVerification(index, "V-M-EXAMPLE");
    expect(resolved.verification.cwd).toBe("apps/web");
    // Test files should include both inferred (from command) AND explicit (from TestFiles)
    expect(resolved.verification.testFiles).toContain("apps/web/src/module.test.ts");
    expect(resolved.verification.testFiles).toContain("apps/web/src/module-explicit.test.ts");
    expect(resolved.verification.testFiles).toContain("apps/web/src/module-additional.test.ts");
  });

  it("uses verification Cwd when checking monorepo test command references", () => {
    const root = createProject();
    writeProjectSkeleton(root);
    writeProjectFile(root, ".grace/graph/index.xml", '<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-WEB /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>');
    writeProjectFile(root, ".grace/graph/main.xml", '<GraceGraphDocument graceVersion="4.0"><GD-MAIN><M-WEB><Summary>Web workspace.</Summary></M-WEB></GD-MAIN></GraceGraphDocument>');
    writeProjectFile(root, ".grace/verification/index.xml", '<GraceVerificationIndex graceVersion="4.0"><VerificationDocuments><VD-MAIN><Path>verification/main.xml</Path><Owns><V-M-WEB /></Owns></VD-MAIN></VerificationDocuments></GraceVerificationIndex>');
    writeProjectFile(root, ".grace/verification/main.xml", '<GraceVerificationDocument graceVersion="4.0"><VD-MAIN><V-M-WEB><Cwd>apps/web</Cwd><TestFiles><File>apps/web/src/web.test.ts</File></TestFiles><Command>bun test src/web.test.ts</Command><Scenario>web works</Scenario></V-M-WEB></VD-MAIN></GraceVerificationDocument>');
    writeProjectFile(root, "apps/web/src/web.ts", '// START_MODULE_CONTRACT\n// PURPOSE: Web runtime.\n// LINKS: M-WEB\n// END_MODULE_CONTRACT\nexport const web = true;\n');
    writeProjectFile(root, "apps/web/src/web.test.ts", '// START_MODULE_CONTRACT\n// PURPOSE: Web tests.\n// LINKS: M-WEB\n// END_MODULE_CONTRACT\n');

    const index = loadGraceArtifactIndex(root);
    const health = buildModuleHealth(index, resolveModule(index, "M-WEB"));
    expect(health.warnings.map((warning) => warning.code)).not.toContain("health.verification-command-does-not-reference-test-file");
    expect(health.blockers.map((blocker) => blocker.code)).not.toContain("health.verification-test-file-missing-on-disk");
  });

  it("builds module health from projections and linked files", () => {
    const root = createQueryProject();
    const index = loadGraceArtifactIndex(root);

    const providerModule = resolveModule(index, "M-PROVIDER-PERSIST");
    const health = buildModuleHealth(index, providerModule);
    expect(health.state).toBe("ready");
    expect(health.implementationFiles).toEqual(["src/provider/config-repo.ts"]);
    expect(health.verificationTestFiles).toEqual(["src/provider/config-repo.test.ts"]);

    const dbHealth = buildModuleHealth(index, resolveModule(index, "M-DB"));
    expect(dbHealth.state).toBe("blocked");
    expect(dbHealth.blockers.map((blocker) => blocker.code)).toContain("health.verification-missing-commands");
  });

  it("fails closed before returning records from invalid grammar or projections", () => {
    const wrongRoot = createQueryProject();
    writeProjectFile(wrongRoot, ".grace/graph/main.xml", `<GraceRequirements graceVersion="4.0"><GD-MAIN /></GraceRequirements>`);
    expect(() => loadGraceArtifactIndex(wrongRoot)).toThrow(GraceCommandError);
    try {
      loadGraceArtifactIndex(wrongRoot);
    } catch (error) {
      expect((error as GraceCommandError).code).toBe("invalid-project");
      expect((error as GraceCommandError).issues).toContain("artifact.unexpected-root-tag");
    }

    const duplicateOwns = createQueryProject();
    writeProjectFile(
      duplicateOwns,
      ".grace/graph/index.xml",
      `<GraceGraphIndex graceVersion="4.0"><GraphDocuments><GD-MAIN><Path>graph/main.xml</Path><Owns><M-DB /><M-DB /><M-PROVIDER-PERSIST /></Owns></GD-MAIN></GraphDocuments></GraceGraphIndex>`,
    );
    expect(() => loadGraceArtifactIndex(duplicateOwns)).toThrow(
      expect.objectContaining({ code: "invalid-project", issues: expect.arrayContaining(["projection.graph.duplicate-route"]) }),
    );
  });

  it("returns one structured JSON error and one concise text error without stack traces", () => {
    const root = createQueryProject();
    writeProjectFile(root, ".grace/graph/main.xml", `<GraceRequirements graceVersion="4.0"><GD-MAIN /></GraceRequirements>`);
    const repoRoot = path.resolve(import.meta.dir, "..");

    const jsonResult = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "module", "find", "provider", "--path", root, "--json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(jsonResult.exitCode).not.toBe(0);
    const stdout = Buffer.from(jsonResult.stdout).toString("utf8").trim();
    const envelope = JSON.parse(stdout);
    expect(envelope).toEqual(expect.objectContaining({ schemaVersion: "1.0.0", ok: false }));
    expect(envelope.error.code).toBe("invalid-project");
    expect(stdout.split("\n")).toHaveLength(1);

    const textResult = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "file", "show", "src/provider/config-repo.ts", "--path", root],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(textResult.exitCode).not.toBe(0);
    const textError = Buffer.from(textResult.stderr).toString("utf8").trim();
    expect(textError).toContain("GRACE artifacts are invalid");
    expect(textError).not.toContain("GraceCommandError");
    expect(textError).not.toMatch(/\n\s+at\s/);
  });

  it("uses nonzero typed failures for not-found and invalid-argument query commands", () => {
    const root = createQueryProject();
    const repoRoot = path.resolve(import.meta.dir, "..");
    const notFound = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "verification", "show", "V-M-MISSING", "--path", root, "--json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(notFound.exitCode).not.toBe(0);
    expect(JSON.parse(Buffer.from(notFound.stdout).toString("utf8")).error.code).toBe("not-found");

    const invalidArguments = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "module", "show", "--path", root, "--json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(invalidArguments.exitCode).not.toBe(0);
    expect(JSON.parse(Buffer.from(invalidArguments.stdout).toString("utf8")).error.code).toBe("invalid-arguments");
  });

  it("classifies tied path resolution as an ambiguous-target failure", () => {
    const index = loadGraceArtifactIndex(createQueryProject());
    const provider = resolveModule(index, "M-PROVIDER-PERSIST");
    index.modules.push({
      ...provider,
      id: "M-PROVIDER-DUPLICATE",
      graph: { ...provider.graph, id: "M-PROVIDER-DUPLICATE" },
      localFiles: [],
      verifications: [],
      verification: null,
    });

    expect(() => resolveModule(index, "src/provider/config-repo.ts")).toThrow(
      expect.objectContaining({ code: "ambiguous-target" }),
    );
  });

  it("wires module, verification, health, and file query commands through the CLI", () => {
    const root = createQueryProject();
    const repoRoot = path.resolve(import.meta.dir, "..");

    const moduleResult = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "module", "find", "provider", "--path", root],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(moduleResult.exitCode).toBe(0);
    expect(Buffer.from(moduleResult.stdout).toString("utf8")).toContain("M-PROVIDER-PERSIST");

    const moduleShowResult = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "module", "show", "M-PROVIDER-PERSIST", "--with", "verification", "--path", root],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(moduleShowResult.exitCode).toBe(0);
    const moduleShowOutput = Buffer.from(moduleShowResult.stdout).toString("utf8");
    expect(moduleShowOutput).toContain("Verification V-M-PROVIDER-PERSIST");
    expect(moduleShowOutput).toContain("bun test src/provider/config-repo.test.ts");

    const moduleShowJsonResult = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "module", "show", "src/provider/config-repo.ts", "--path", root, "--json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(moduleShowJsonResult.exitCode).toBe(0);
    const moduleShowJson = JSON.parse(Buffer.from(moduleShowJsonResult.stdout).toString("utf8"));
    expect(moduleShowJson.id).toBe("M-PROVIDER-PERSIST");
    expect(moduleShowJson.verifications[0].id).toBe("V-M-PROVIDER-PERSIST");

    const fileResult = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "file", "show", "src/provider/config-repo.ts", "--path", root, "--contracts"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(fileResult.exitCode).toBe(0);
    expect(Buffer.from(fileResult.stdout).toString("utf8")).toContain("Contract getProviderConfig");

    const fileJsonResult = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "file", "show", "src/provider/config-repo.ts", "--path", root, "--json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(fileJsonResult.exitCode).toBe(0);
    const fileJson = JSON.parse(Buffer.from(fileJsonResult.stdout).toString("utf8"));
    expect(fileJson.linkedModuleIds).toEqual(["M-PROVIDER-PERSIST", "M-DB"]);

    const verificationFindResult = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "verification", "find", "provider", "--path", root, "--json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(verificationFindResult.exitCode).toBe(0);
    const verificationFindJson = JSON.parse(Buffer.from(verificationFindResult.stdout).toString("utf8"));
    expect(verificationFindJson[0].verification.id).toBe("V-M-PROVIDER-PERSIST");

    const priorityFindResult = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "verification", "find", "--priority", "high", "--path", root, "--json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(priorityFindResult.exitCode).toBe(0);
    const priorityFindJson = JSON.parse(Buffer.from(priorityFindResult.stdout).toString("utf8"));
    expect(priorityFindJson.length).toBeGreaterThan(0);
    expect(priorityFindJson[0].verification.id).toBe("V-M-PROVIDER-PERSIST");

    const priorityMismatchResult = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "verification", "find", "--priority", "low", "--path", root, "--json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(priorityMismatchResult.exitCode).toBe(0);
    const priorityMismatchJson = JSON.parse(Buffer.from(priorityMismatchResult.stdout).toString("utf8"));
    expect(priorityMismatchJson).toHaveLength(0);

    const verificationResult = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "verification", "show", "V-M-PROVIDER-PERSIST", "--path", root],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(verificationResult.exitCode).toBe(0);
    expect(Buffer.from(verificationResult.stdout).toString("utf8")).toContain("GRACE Verification");

    const verificationShowByModuleResult = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "verification", "show", "M-PROVIDER-PERSIST", "--path", root, "--json"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(verificationShowByModuleResult.exitCode).toBe(0);
    const verificationShowByModuleJson = JSON.parse(Buffer.from(verificationShowByModuleResult.stdout).toString("utf8"));
    expect(verificationShowByModuleJson.verification.id).toBe("V-M-PROVIDER-PERSIST");

    const healthResult = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "module", "health", "M-PROVIDER-PERSIST", "--path", root],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(healthResult.exitCode).toBe(0);
    expect(Buffer.from(healthResult.stdout).toString("utf8")).toContain("State: ready");
  });

  it("emits migration guidance for GRACE 3 roots instead of falling back to legacy docs", () => {
    const root = createProject();
    writeProjectFile(root, "docs/development-plan.xml", `<DevelopmentPlan />`);
    const repoRoot = path.resolve(import.meta.dir, "..");

    const result = Bun.spawnSync({
      cmd: [process.execPath, "./src/grace.ts", "module", "find", "provider", "--path", root],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).not.toBe(0);
    const combinedOutput = `${Buffer.from(result.stdout).toString("utf8")}\n${Buffer.from(result.stderr).toString("utf8")}`;
    expect(combinedOutput).toContain("Legacy GRACE 3 artifacts");
    expect(combinedOutput).toContain(".grace artifact model");
  });
});
