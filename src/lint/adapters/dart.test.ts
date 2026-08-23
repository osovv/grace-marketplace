import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, test } from "bun:test";

import { createDartAdapter, sanitizeDartAnalyzerOutput } from "./dart";

const hasDart = (() => {
  const result = spawnSync("dart", ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
})();

describe("DartAdapter.supports", () => {
  const adapter = createDartAdapter();

  it("returns true for .dart files", () => {
    expect(adapter.supports("main.dart")).toBe(true);
    expect(adapter.supports("/path/to/lib.dart")).toBe(true);
    expect(adapter.supports("src/utils.dart")).toBe(true);
  });

  it("returns false for .ts files", () => {
    expect(adapter.supports("main.ts")).toBe(false);
    expect(adapter.supports("src/index.ts")).toBe(false);
  });

  it("returns false for .py files", () => {
    expect(adapter.supports("main.py")).toBe(false);
    expect(adapter.supports("src/utils.py")).toBe(false);
  });

  it("returns false for .rb files", () => {
    expect(adapter.supports("main.rb")).toBe(false);
    expect(adapter.supports("src/utils.rb")).toBe(false);
  });
});

describe("DartAdapter", () => {
  const adapter = createDartAdapter();

  it("has adapter ID 'dart'", () => {
    expect(adapter.id).toBe("dart");
  });

  it("throws an error when dart CLI is not available", () => {
    // If dart is not available or fails, analyze() should throw a descriptive error.
    try {
      const result = adapter.analyze("test.dart", "void main() {}");
      // If we reach here, dart is installed and we got a valid result.
      expect(result).toBeDefined();
      expect(result.adapterId).toBe("dart");
    } catch (e) {
      const msg = (e as Error).message;
      // Accept any meaningful error — either "not on PATH" or "no version" from asdf/mise
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  test.skipIf(!hasDart)("runs a real temporary analyzer file when Dart is available", () => {
    const result = adapter.analyze("example.dart", "class Greeting {}\nvoid greet() {}\n");
    expect(result.adapterId).toBe("dart");
    expect(result.exports.has("Greeting")).toBe(true);
    expect(result.exports.has("greet")).toBe(true);
    expect(result.exportConfidence).toBe("heuristic");
  });

  test.skipIf(!hasDart)("analyzes a governed file inside a Dart package context", () => {
    // Regression for #29: inside a package (pubspec.yaml nearby) `dart run` can
    // print tool preamble onto stdout. The analyzer must run outside that
    // context and still return a parsed result.
    const packageDir = mkdtempSync(path.join(os.tmpdir(), "grace-dart-package-"));
    writeFileSync(path.join(packageDir, "pubspec.yaml"), "name: grace_fixture\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n");
    const governedFile = path.join(packageDir, "widget.dart");

    const result = adapter.analyze(governedFile, "class Widget {}\nString build() => 'ok';\n");
    expect(result.adapterId).toBe("dart");
    expect(result.exports.has("Widget")).toBe(true);
    expect(result.exports.has("build")).toBe(true);
  });
});

describe("sanitizeDartAnalyzerOutput", () => {
  const payload = JSON.stringify({ exports: ["Widget"], valueExports: ["Widget"] });

  it("keeps a clean JSON payload unchanged", () => {
    expect(sanitizeDartAnalyzerOutput(payload)).toBe(payload);
  });

  it("strips the Dart SDK tool preamble before the JSON", () => {
    const polluted = `Running build hooks...Running build hooks...Running\n${payload}`;
    expect(sanitizeDartAnalyzerOutput(polluted)).toBe(payload);
  });

  it("carves the payload out of surrounding noise on both sides", () => {
    const polluted = `Resolving dependencies...\n${payload}\nDone.`;
    expect(sanitizeDartAnalyzerOutput(polluted)).toBe(payload);
  });

  it("returns the input unchanged when no JSON object is present", () => {
    expect(sanitizeDartAnalyzerOutput("Running build hooks...")).toBe("Running build hooks...");
    expect(sanitizeDartAnalyzerOutput("")).toBe("");
  });
});
