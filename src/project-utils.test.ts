import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, test } from "bun:test";

import { analyzeGovernedFile, parseGovernedFile } from "./project-utils";

function contract(mapMode: "EXPORTS" | "LOCALS" | "SUMMARY" | "NONE", moduleMap = ""): string {
  return `// START_MODULE_CONTRACT
// PURPOSE: Exercise semantic markup.
// SCOPE: Test-only fixture.
// DEPENDS: none
// LINKS: M-EXAMPLE
// ROLE: ${mapMode === "LOCALS" ? "SCRIPT" : mapMode === "SUMMARY" ? "BARREL" : mapMode === "NONE" ? "CONFIG" : "RUNTIME"}
// MAP_MODE: ${mapMode}
// END_MODULE_CONTRACT
${moduleMap ? `// START_MODULE_MAP\n${moduleMap}\n// END_MODULE_MAP\n` : ""}`;
}

describe("governed file analysis", () => {
  it("parses the shared markup record and enforces exact TypeScript value/type export parity", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-markup-"));
    const file = path.join(root, "src", "example.ts");
    const text = `${contract("EXPORTS", "// value - Runtime value.\n// ExampleType - Public type.")}export const value = 1;\nexport type ExampleType = string;\n`;

    const record = parseGovernedFile(root, file, text);
    const analysis = analyzeGovernedFile(root, file, text);

    expect(record.path).toBe("src/example.ts");
    expect(record.linkedModuleIds).toEqual(["M-EXAMPLE"]);
    expect(record.moduleMap.map((item) => item.symbolName)).toEqual(["value", "ExampleType"]);
    expect(analysis.language?.exportConfidence).toBe("exact");
    expect(analysis.issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
  });

  it("reports line-addressed missing, reversed, duplicate, mismatched, and overlapping markers", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-markers-"));
    const file = path.join(root, "broken.ts");
    const text = `// END_BLOCK_REVERSED
// START_MODULE_CONTRACT
// START_MODULE_MAP
// END_MODULE_CONTRACT
// START_BLOCK_DUP
// END_BLOCK_DUP
// START_BLOCK_DUP
// END_BLOCK_OTHER
// START_CHANGE_SUMMARY
`;
    const issues = analyzeGovernedFile(root, file, text).issues;
    const codes = issues.map((issue) => issue.code);

    expect(codes).toContain("markup.reversed-marker");
    expect(codes).toContain("markup.overlapping-markers");
    expect(codes).toContain("markup.mismatched-marker");
    expect(codes).toContain("markup.duplicate-marker");
    expect(codes).toContain("markup.missing-end-marker");
    expect(issues.filter((issue) => issue.code.startsWith("markup.")).every((issue) => typeof issue.line === "number")).toBe(true);
  });

  it("emits bounded-confidence diagnostics for heuristic Python analysis", () => {
    const hasPython = ["python3", "python"].some((binary) => {
      const result = spawnSync(binary, ["--version"], { stdio: "ignore" });
      return !result.error && result.status === 0;
    });
    if (!hasPython) {
      return;
    }
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-python-markup-"));
    const file = path.join(root, "example.py");
    const text = `# START_MODULE_CONTRACT
# PURPOSE: Python fixture.
# SCOPE: Export one function.
# DEPENDS: none
# LINKS: M-EXAMPLE
# ROLE: RUNTIME
# MAP_MODE: EXPORTS
# END_MODULE_CONTRACT
# START_MODULE_MAP
# greet - Public greeting.
# END_MODULE_MAP
def greet():
    return "hello"
`;
    const analysis = analyzeGovernedFile(root, file, text);
    expect(analysis.language?.exportConfidence).toBe("heuristic");
    expect(analysis.issues.map((issue) => issue.code)).toContain("analysis.heuristic-confidence");
    expect(analysis.issues.map((issue) => issue.code)).not.toContain("markup.module-map-mismatch");
  });

  it("preserves Unicode identifiers in exact Python MODULE_MAP parity", () => {
    const hasPython = ["python3", "python"].some((binary) => {
      const result = spawnSync(binary, ["--version"], { stdio: "ignore" });
      return !result.error && result.status === 0;
    });
    if (!hasPython) return;

    const root = mkdtempSync(path.join(os.tmpdir(), "grace-python-unicode-map-"));
    const file = path.join(root, "example.py");
    const text = `# START_MODULE_CONTRACT
# PURPOSE: Unicode Python fixture.
# SCOPE: Export one Unicode function.
# DEPENDS: none
# LINKS: M-EXAMPLE
# ROLE: RUNTIME
# MAP_MODE: EXPORTS
# END_MODULE_CONTRACT
# START_MODULE_MAP
# привет - Public greeting.
# END_MODULE_MAP
__all__ = ["привет"]
def привет():
    return "hello"
`;
    const analysis = analyzeGovernedFile(root, file, text);
    expect(analysis.record.moduleMap[0]?.symbolName).toBe("привет");
    expect(analysis.language?.exportConfidence).toBe("exact");
    expect(analysis.issues.map((issue) => issue.code)).not.toContain("markup.module-map-mismatch");
  });

  test("missing required language runtimes surface an actionable dedicated diagnostic without crashing", () => {
    const script = `import { analyzeGovernedFile } from "./src/project-utils.ts";
const text = ${JSON.stringify(`${contract("EXPORTS", "# greet - Greeting.").replaceAll("//", "#")}def greet():\n    return "hi"\n`)};
const result = analyzeGovernedFile(process.cwd(), process.cwd() + "/example.py", text);
console.log(JSON.stringify(result.issues));`;
    const run = Bun.spawnSync({
      cmd: [process.execPath, "-e", script],
      cwd: path.resolve(import.meta.dir, ".."),
      env: { ...process.env, PATH: mkdtempSync(path.join(os.tmpdir(), "grace-empty-path-")) },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.exitCode).toBe(0);
    const issues = JSON.parse(Buffer.from(run.stdout).toString("utf8")) as Array<{ code: string; message: string }>;
    expect(issues.map((issue) => issue.code)).toContain("analysis.runtime-missing");
    expect(issues.find((issue) => issue.code === "analysis.runtime-missing")?.message).toContain("Install Python");
  });

  test("present but failing language runtimes surface analysis.adapter-failed without fallback", () => {
    const runtimeDir = mkdtempSync(path.join(os.tmpdir(), "grace-broken-python-"));
    const python = path.join(runtimeDir, "python3");
    writeFileSync(python, "#!/bin/sh\nexit 17\n");
    chmodSync(python, 0o755);
    const script = `import { analyzeGovernedFile } from "./src/project-utils.ts";
const text = ${JSON.stringify(`${contract("EXPORTS", "# greet - Greeting.").replaceAll("//", "#")}def greet():\n    return "hi"\n`)};
const result = analyzeGovernedFile(process.cwd(), process.cwd() + "/example.py", text);
console.log(JSON.stringify(result.issues));`;
    const run = Bun.spawnSync({
      cmd: [process.execPath, "-e", script],
      cwd: path.resolve(import.meta.dir, ".."),
      env: { ...process.env, PATH: runtimeDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.exitCode).toBe(0);
    const issues = JSON.parse(Buffer.from(run.stdout).toString("utf8")) as Array<{ code: string }>;
    expect(issues.map((issue) => issue.code)).toContain("analysis.adapter-failed");
    expect(issues.map((issue) => issue.code)).not.toContain("analysis.runtime-missing");
  });
});
