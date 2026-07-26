// FILE: scripts/packed-cli-smoke.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Prove the npm tarball installs and executes the GRACE CLI against valid and adversarial temporary projects.
//   SCOPE: Dry-run package creation, temporary Bun installation, CLI navigation, structured errors, and optional Python/Dart adapter behavior.
//   DEPENDS: [node:fs, node:child_process, src/grace4/test-fixtures.ts]
//   LINKS: [M-RELEASE-AUTOMATION, VF-RELEASE-AUTOMATION]
//   ROLE: SCRIPT
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   runPackedCliSmoke - Creates, installs, and exercises one package tarball without publishing.
// END_MODULE_MAP

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeMinimalGrace4Project } from "../src/grace4/test-fixtures.ts";

type PackedSmokeCase = {
  name: string;
  args: string[];
  expectedExitCode: number;
  assertStdout?: (stdout: string) => void;
  assertStderr?: (stderr: string) => void;
};

function write(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function run(command: string, args: string[], cwd: string, label: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${(result.stderr || result.stdout || result.error?.message || "unknown error").trim()}`);
  }
  return result.stdout ?? "";
}

export type RuntimeState = "usable" | "missing" | "broken";

export function runtimeState(candidates: string[]): RuntimeState {
  for (const binary of candidates) {
    const result = spawnSync(binary, ["--version"], { stdio: "ignore" });
    if (result.error?.code === "ENOENT") continue;
    if (result.status === 0) return "usable";
    return "broken";
  }
  return "missing";
}

function writeBaseProject(root: string): void {
  writeMinimalGrace4Project(root);
  write(root, "src/example.ts", `// START_MODULE_CONTRACT
//   PURPOSE: Provide the packed smoke example module.
//   SCOPE: Expose one deterministic example function.
//   DEPENDS: none
//   LINKS: M-EXAMPLE, V-M-EXAMPLE
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   runExample - Return the packed smoke result.
// END_MODULE_MAP
//
// START_CONTRACT: runExample
//   PURPOSE: Return the packed smoke result.
//   INPUTS: none
//   OUTPUTS: { string }
//   SIDE_EFFECTS: none
//   LINKS: M-EXAMPLE
// END_CONTRACT: runExample
export function runExample() {
  console.info("[Example][run][BLOCK_RUN] packed smoke");
  // START_BLOCK_RUN
  return "ok";
  // END_BLOCK_RUN
}
`);
  write(root, "src/example.test.ts", `import { expect, test } from "bun:test";
import { runExample } from "./example";

test("packed smoke example", () => {
  expect(runExample()).toBe("ok");
});
`);
}

function writePythonProject(root: string): void {
  writeBaseProject(root);
  write(root, "src/unicode.py", `# START_MODULE_CONTRACT
#   PURPOSE: Exercise UTF-8 Python analysis from the packed CLI.
#   SCOPE: Define Unicode source without export-map enforcement.
#   DEPENDS: none
#   LINKS: M-EXAMPLE
#   ROLE: CONFIG
#   MAP_MODE: NONE
# END_MODULE_CONTRACT
GREETING = "Привет 🌍"
def привет():
    return GREETING
`);
}

function writeDartProject(root: string): void {
  writeBaseProject(root);
  write(root, "src/unicode.dart", `// START_MODULE_CONTRACT
//   PURPOSE: Exercise Dart analyzer invocation from the packed CLI.
//   SCOPE: Define valid Unicode Dart source without export-map enforcement.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
//   ROLE: CONFIG
//   MAP_MODE: NONE
// END_MODULE_CONTRACT
const greeting = 'Привет 🌍';
void main() { print(greeting); }
`);
}

/** Creates an npm tarball, installs it in a temporary Bun project, and exercises the packed CLI. */
export async function runPackedCliSmoke(repoRoot: string): Promise<void> {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "grace-packed-smoke-"));
  try {
    const packDir = path.join(tempRoot, "pack");
    const consumer = path.join(tempRoot, "consumer");
    mkdirSync(packDir, { recursive: true });
    mkdirSync(consumer, { recursive: true });
    write(consumer, "package.json", `${JSON.stringify({ name: "grace-packed-smoke", private: true }, null, 2)}\n`);

    const packJson = run("npm", ["pack", "--json", "--pack-destination", packDir], repoRoot, "npm pack");
    const packed = JSON.parse(packJson) as Array<{ filename?: string }>;
    const filename = packed[0]?.filename;
    if (!filename) throw new Error("npm pack returned no tarball filename.");
    const tarball = path.join(packDir, filename);
    run("bun", ["add", tarball], consumer, "temporary packed-package install");

    const cliEntry = path.join(consumer, "node_modules", "@osovv", "grace-cli", "src", "grace.ts");
    readFileSync(cliEntry, "utf8");
    const project = path.join(tempRoot, "project");
    writeBaseProject(project);

    const execute = (testCase: PackedSmokeCase): void => {
      const result = spawnSync(process.execPath, [cliEntry, ...testCase.args], {
        cwd: consumer,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
      if (result.status !== testCase.expectedExitCode) {
        throw new Error(`${testCase.name}: expected exit ${testCase.expectedExitCode}, received ${result.status}. stdout=${result.stdout} stderr=${result.stderr}`);
      }
      testCase.assertStdout?.(result.stdout ?? "");
      testCase.assertStderr?.(result.stderr ?? "");
    };

    const jsonObject = (stdout: string) => JSON.parse(stdout.trim()) as Record<string, unknown>;
    const cases: PackedSmokeCase[] = [
      { name: "lint", args: ["lint", "--path", project, "--assertions", "current", "--format", "json"], expectedExitCode: 0, assertStdout: (out) => { if (!jsonObject(out).summary) throw new Error("lint JSON has no summary"); } },
      { name: "status", args: ["status", "--path", project, "--json", "--fail-on", "errors"], expectedExitCode: 0, assertStdout: (out) => { if (jsonObject(out).projectKind !== "grace4") throw new Error("status projectKind mismatch"); } },
      { name: "module find", args: ["module", "find", "example", "--path", project, "--json"], expectedExitCode: 0, assertStdout: (out) => { if (!out.includes("M-EXAMPLE")) throw new Error("module find missed M-EXAMPLE"); } },
      { name: "module show", args: ["module", "show", "M-EXAMPLE", "--path", project, "--json"], expectedExitCode: 0, assertStdout: (out) => { if (!out.includes("runExample")) throw new Error("module show missed file-local symbol"); } },
      { name: "verification show", args: ["verification", "show", "V-M-EXAMPLE", "--path", project, "--json"], expectedExitCode: 0, assertStdout: (out) => { if (!out.includes("V-M-EXAMPLE")) throw new Error("verification show missed entry"); } },
      { name: "file show", args: ["file", "show", "src/example.ts", "--path", project, "--json"], expectedExitCode: 0, assertStdout: (out) => { if (!out.includes("runExample")) throw new Error("file show missed module map"); } },
      { name: "structured error", args: ["module", "show", "M-MISSING", "--path", project, "--json"], expectedExitCode: 1, assertStdout: (out) => { const value = jsonObject(out); if (value.ok !== false) throw new Error("structured error did not set ok=false"); } },
    ];
    for (const testCase of cases) execute(testCase);

    const runtimeCheck = (name: string, runtimeProject: string, state: RuntimeState): void => {
      const result = spawnSync(process.execPath, [cliEntry, "lint", "--path", runtimeProject, "--assertions", "current", "--format", "json"], {
        cwd: consumer,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      });
      const output = result.stdout ?? "";
      if (state === "usable") {
        if (result.status !== 0 || output.includes("analysis.adapter-failed") || output.includes("analysis.runtime-missing")) {
          throw new Error(`${name} runtime is usable but packed analysis failed: ${output} ${result.stderr}`);
        }
      } else if (state === "missing") {
        if (result.status === 0 || !output.includes("analysis.runtime-missing")) {
          throw new Error(`${name} runtime is missing without explicit analysis.runtime-missing failure: ${output} ${result.stderr}`);
        }
      } else {
        // state === "broken" - the adapter should emit analysis.adapter-failed
        if (result.status === 0 || !output.includes("analysis.adapter-failed")) {
          throw new Error(`${name} runtime is broken without explicit analysis.adapter-failed failure: ${output} ${result.stderr}`);
        }
      }
    };

    const pythonProject = path.join(tempRoot, "python-project");
    writePythonProject(pythonProject);
    runtimeCheck("Python", pythonProject, runtimeState(["python3", "python"]));

    const dartProject = path.join(tempRoot, "dart-project");
    writeDartProject(dartProject);
    runtimeCheck("Dart", dartProject, runtimeState(["dart"]));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  runPackedCliSmoke(path.resolve(import.meta.dir, ".."))
    .then(() => console.log("✓ Packed CLI smoke passed."))
    .catch((error) => {
      console.error(`✗ Packed CLI smoke failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
