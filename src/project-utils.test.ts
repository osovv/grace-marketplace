import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, test } from "bun:test";

import { analyzeGovernedFile, collectCodeFiles, describeUnreadableDirectory, hasRuntimeMarkerEvidence, parseGovernedFile } from "./project-utils";

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

  it("accepts bracketed and unbracketed LINKS lists while filtering non-module anchors", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-links-"));
    const file = path.join(root, "src", "example.ts");
    const links = (value: string) => parseGovernedFile(root, file, contract("NONE").replace("LINKS: M-EXAMPLE", `LINKS: ${value}`)).linkedModuleIds;

    expect(links("[M-ONE]")).toEqual(["M-ONE"]);
    expect(links("[M-ONE, M-TWO, V-M-ONE]")).toEqual(["M-ONE", "M-TWO"]);
    expect(links("M-ONE, M-TWO, V-M-ONE")).toEqual(["M-ONE", "M-TWO"]);
    expect(links("[none]")).toEqual([]);
    expect(links("none")).toEqual([]);
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

  it("parses properly nested semantic blocks without reporting overlap", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-nested-blocks-"));
    const file = path.join(root, "nested.ts");
    const text = `// START_BLOCK_OUTER
// START_BLOCK_INNER
export const value = true;
// END_BLOCK_INNER
// END_BLOCK_OUTER
`;

    expect(parseGovernedFile(root, file, text).blocks).toEqual([
      { name: "OUTER", startLine: 1, endLine: 5 },
      { name: "INNER", startLine: 2, endLine: 4 },
    ]);
    expect(analyzeGovernedFile(root, file, text).issues.map((issue) => issue.code)).not.toContain("markup.overlapping-markers");
  });

  it("does not manufacture an outer block from crossed nesting", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-crossed-blocks-"));
    const file = path.join(root, "crossed.ts");
    const text = `// START_BLOCK_OUTER
// START_BLOCK_INNER
// END_BLOCK_OUTER
// END_BLOCK_INNER
`;

    expect(parseGovernedFile(root, file, text).blocks.map((block) => block.name)).toEqual(["INNER"]);
    const codes = analyzeGovernedFile(root, file, text).issues.map((issue) => issue.code);
    expect(codes).toContain("markup.mismatched-marker");
    expect(codes).toContain("markup.missing-end-marker");
  });

  it("credits exact marker constants with identifier-aware boundaries", () => {
    const marker = "[Example][run][BLOCK_RUN]";
    expect(hasRuntimeMarkerEvidence(`console.info("${marker} ok");`, marker)).toBe(true);
    expect(hasRuntimeMarkerEvidence(`const marker$ = "${marker}";\nconsole.info(marker$ + " ok");`, marker)).toBe(true);
    expect(hasRuntimeMarkerEvidence(`static let marker = "${marker}"\nlog.info("\\(marker) ok")`, marker)).toBe(true);
    expect(hasRuntimeMarkerEvidence(`const marker$ = "${marker}";\nconsole.info(marker$Other + " ok");`, marker)).toBe(false);
    expect(hasRuntimeMarkerEvidence(`const marker$ = "${marker}";\nreturn marker$;`, marker)).toBe(false);
    expect(hasRuntimeMarkerEvidence(`// const marker$ = "${marker}";\nconsole.info(marker$ + " ok");`, marker)).toBe(false);
  });

  it("credits capitalised logger methods used by Go, Java, and C#", () => {
    const marker = "[Example][run][BLOCK_RUN]";
    // Go stdlib log
    expect(hasRuntimeMarkerEvidence(`log.Info("${marker} ok")`, marker)).toBe(true);
    expect(hasRuntimeMarkerEvidence(`log.Warn("${marker} ok")`, marker)).toBe(true);
    // Go slog, context-taking variants
    expect(hasRuntimeMarkerEvidence(`d.log.InfoContext(ctx, "${marker} ok")`, marker)).toBe(true);
    expect(hasRuntimeMarkerEvidence(`slog.Error("${marker} failed")`, marker)).toBe(true);
    // Go logrus/zap, printf form
    expect(hasRuntimeMarkerEvidence(`logger.Errorf("${marker} failed: %v", err)`, marker)).toBe(true);
    // java.util.logging - note `severe` is its error level, not a Go/SLF4J name
    expect(hasRuntimeMarkerEvidence(`LOG.info("${marker} ok")`, marker)).toBe(true);
    expect(hasRuntimeMarkerEvidence(`LOG.severe("${marker} failed")`, marker)).toBe(true);
    // Java SLF4J / Log4j, on a receiver not called `logger`
    expect(hasRuntimeMarkerEvidence(`LOG.debug("${marker} ok")`, marker)).toBe(true);
    // C# ILogger. The receiver here is NOT `logger`, so this passes only because
    // the `Log*` method names are matched - not by the bare `logger.` prefix.
    expect(hasRuntimeMarkerEvidence(`_log.LogInformation("${marker} ok")`, marker)).toBe(true);
    expect(hasRuntimeMarkerEvidence(`_log.LogWarning("${marker} ok")`, marker)).toBe(true);
  });

  it("credits the level spellings and suffixes the alternation exists for", () => {
    const marker = "[Example][run][BLOCK_RUN]";
    // java.util.logging: `warn` cannot cover this - the required `(` makes the
    // engine backtrack on "ing(", and `LOG.` is not the bare `logger.` prefix.
    expect(hasRuntimeMarkerEvidence(`LOG.warning("${marker} ok")`, marker)).toBe(true);
    // C# ILogger, same spelling capitalised
    expect(hasRuntimeMarkerEvidence(`LOG.Warning("${marker} ok")`, marker)).toBe(true);
    // Go zap, sugared key/value form
    expect(hasRuntimeMarkerEvidence(`zap.Infow("${marker} ok", "k", v)`, marker)).toBe(true);
    // Go glog, println form
    expect(hasRuntimeMarkerEvidence(`glog.Infoln("${marker} ok")`, marker)).toBe(true);
  });

  it("credits the declaration forms the targeted languages actually use", () => {
    const marker = "[Example][run][BLOCK_RUN]";
    const emit = `\nlog.Info(prefix + "[run][BLOCK_RUN] ok")`;
    // Go short declaration - its primary form, matched only by the `:?=` clause
    expect(hasRuntimeMarkerEvidence(`prefix := "[Example]"${emit}`, marker)).toBe(true);
    // Go const, the idiomatic form for a log prefix
    expect(hasRuntimeMarkerEvidence(`const prefix = "[Example]"${emit}`, marker)).toBe(true);
    // Go untyped var
    expect(hasRuntimeMarkerEvidence(`var prefix = "[Example]"${emit}`, marker)).toBe(true);
    // TypeScript with a type annotation, which `:?=` was written for
    expect(hasRuntimeMarkerEvidence(`const prefix: string = "[Example]";${emit}`, marker)).toBe(true);
    // Go `:=` holding the WHOLE marker. Credited only by the empty-remainder
    // branch of the concatenation path: the identifier path's assignment pattern
    // ends in a bare `=` and rejects `:=`. Restricting concatenation to proper
    // prefixes, on the view that whole markers "belong" to the identifier check,
    // would silently drop Go's primary full-marker form.
    expect(hasRuntimeMarkerEvidence(`marker := "${marker}"\nlog.Info(marker)`, marker)).toBe(true);

    // Go TYPED var - still unsupported, but it must now bind NOTHING rather than
    // bind the type token `string`. The second case is the one that mattered: a
    // line using that token for anything else would otherwise credit the marker.
    expect(hasRuntimeMarkerEvidence(`var prefix string = "[Example]"${emit}`, marker)).toBe(false);
    expect(
      hasRuntimeMarkerEvidence(`var modulePrefix string = "[Example]"\nlog.Info("[run][BLOCK_RUN] " + string(body))`, marker),
    ).toBe(false);
  });

  it("requires the remainder to adjoin the constant, not merely share its line", () => {
    const marker = "[Example][run][BLOCK_RUN]";
    const decl = `const logModule = "[Example]"\n`;
    // Genuine assembly, in the forms real code uses.
    expect(hasRuntimeMarkerEvidence(`${decl}log.Info(logModule+"[run][BLOCK_RUN] ok")`, marker)).toBe(true);
    expect(hasRuntimeMarkerEvidence(`${decl}log.Info(logModule + "[run][BLOCK_RUN] ok")`, marker)).toBe(true);
    expect(hasRuntimeMarkerEvidence(`${decl}logger.info(\`\${logModule}[run][BLOCK_RUN] ok\`)`, marker)).toBe(true);

    // Both halves present, never concatenated: the marker is not emitted here.
    expect(
      hasRuntimeMarkerEvidence(`${decl}logger.Warn("unrelated " + logModule + " text [run][BLOCK_RUN] not the marker")`, marker),
    ).toBe(false);
    expect(hasRuntimeMarkerEvidence(`${decl}log.Info(logModule + "[deploy] then [run][BLOCK_RUN] later")`, marker)).toBe(false);
  });

  it("does not read obj.name as a use of a constant called name", () => {
    const marker = "[Example][run][BLOCK_RUN]";
    // The marker is bound to `logger` but never emitted; `obj.logger.Info(...)`
    // is an unrelated call. Without `.` in the identifier lookbehind this is
    // credited, and a module passes its required-marker check without emitting.
    expect(hasRuntimeMarkerEvidence(`const logger = "${marker}";\nobj.logger.Info("unrelated")`, marker)).toBe(false);
    expect(hasRuntimeMarkerEvidence(`const log = "${marker}";\nobj.log.Warning("unrelated")`, marker)).toBe(false);
  });

  it("credits a marker assembled from a module-prefix constant", () => {
    const marker = "[Example][run][BLOCK_RUN]";
    const emitted = [`const logModule = "[Example]"`, `log.Info(logModule+"[run][BLOCK_RUN] ok")`].join("\n");
    expect(hasRuntimeMarkerEvidence(emitted, marker)).toBe(true);

    // A different block in the same family must not be credited.
    const other = [`const logModule = "[Example]"`, `log.Info(logModule+"[run][BLOCK_OTHER] ok")`].join("\n");
    expect(hasRuntimeMarkerEvidence(other, marker)).toBe(false);

    // An unknown prefix identifier resolves to nothing.
    const unknown = [`const logModule = "[Example]"`, `log.Info(otherModule+"[run][BLOCK_RUN] ok")`].join("\n");
    expect(hasRuntimeMarkerEvidence(unknown, marker)).toBe(false);

    // A property access must not resolve a constant of the same name.
    const shadowed = [`const log = "[Example]"`, `d.log.Info("unrelated")`].join("\n");
    expect(hasRuntimeMarkerEvidence(shadowed, marker)).toBe(false);
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

describe("unreadable directory walking", () => {
  const permissionsUnsupported = process.platform === "win32" || process.getuid?.() === 0;

  it("describes walk failures with the directory and errno code", () => {
    const errno = Object.assign(new Error("EPERM: operation not permitted"), { code: "EACCES" });
    expect(describeUnreadableDirectory("/project/blocked", errno)).toBe(
      "Directory '/project/blocked' could not be listed (EACCES); its contents were not checked.",
    );
    expect(describeUnreadableDirectory("/project/blocked", new Error("boom"))).toBe(
      "Directory '/project/blocked' could not be listed (unknown); its contents were not checked.",
    );
  });

  it.skipIf(permissionsUnsupported)("skips unreadable directories instead of throwing", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-walk-"));
    writeFileSync(path.join(root, "visible.ts"), "export const visible = true;\n");
    mkdirSync(path.join(root, "readable"));
    writeFileSync(path.join(root, "readable", "other.ts"), "export const other = true;\n");
    mkdirSync(path.join(root, "blocked"));
    writeFileSync(path.join(root, "blocked", "hidden.ts"), "export const hidden = true;\n");
    chmodSync(path.join(root, "blocked"), 0o000);

    try {
      const reported: Array<{ directory: string; error: unknown }> = [];
      const files = collectCodeFiles(root, [], root, (directory, error) => reported.push({ directory, error }));

      expect(files.sort()).toEqual([path.join(root, "readable", "other.ts"), path.join(root, "visible.ts")].sort());
      expect(reported).toHaveLength(1);
      expect(reported[0]?.directory).toBe(path.join(root, "blocked"));

      // Without a handler the walk still must not abort.
      expect(collectCodeFiles(root, []).sort()).toEqual([path.join(root, "readable", "other.ts"), path.join(root, "visible.ts")].sort());
    } finally {
      chmodSync(path.join(root, "blocked"), 0o755);
    }
  });

  it.skipIf(permissionsUnsupported)("still throws nothing for readable roots when a handler is attached", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-walk-ok-"));
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, "src", "example.ts"), "export const example = true;\n");

    const reported: string[] = [];
    const files = collectCodeFiles(root, [], root, (directory) => reported.push(directory));

    expect(files).toEqual([path.join(root, "src", "example.ts")]);
    expect(reported).toEqual([]);
  });
});

describe("default ignored directories", () => {
  const defaultIgnored = [
    ".git", ".svn", ".hg",
    "node_modules", "dist", "build", "coverage", ".next", ".nuxt", ".output", "out", ".turbo",
    ".vite", ".parcel-cache", ".svelte-kit", ".astro", "storybook-static", ".cache", ".yarn",
    ".nyc_output", "bower_components", "jspm_packages",
    "__pycache__", "venv", ".venv", ".tox", ".nox", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    ".pyre", ".pytype", "htmlcov", ".eggs", ".hypothesis", ".ipynb_checkpoints", "__pypackages__",
    ".pixi", "cover",
    "test-results", "test-reports", "playwright-report", "blob-report", "allure-results",
    "allure-report", "test-output",
    "target", ".gradle", ".idea",
    "vendor",
    ".build", "Pods", "Carthage", "DerivedData",
    ".dart_tool",
    "tmp", ".bundle",
    ".vscode",
  ];

  it("prunes well-known ecosystem directories by default", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-ignore-"));
    for (const dir of defaultIgnored) {
      mkdirSync(path.join(root, dir));
      writeFileSync(path.join(root, dir, "generated.ts"), "export const generated = true;\n");
    }
    writeFileSync(path.join(root, "source.ts"), "export const source = true;\n");

    expect(collectCodeFiles(root, [])).toEqual([path.join(root, "source.ts")]);
  });

  it("prunes default-ignored names at any depth", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "grace-ignore-depth-"));
    mkdirSync(path.join(root, "src", "__pycache__"), { recursive: true });
    writeFileSync(path.join(root, "src", "__pycache__", "cached.ts"), "export const cached = true;\n");
    writeFileSync(path.join(root, "src", "main.ts"), "export const main = true;\n");

    expect(collectCodeFiles(root, [])).toEqual([path.join(root, "src", "main.ts")]);
  });
});
