import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";

import { createPythonAdapter } from "./python";

const hasPython = ["python3", "python"].some((binary) => {
  const result = spawnSync(binary, ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
});

describe("PythonAdapter", () => {
  const adapter = createPythonAdapter();

  test("supports Python source and stub files", () => {
    expect(adapter.supports("module.py")).toBe(true);
    expect(adapter.supports("module.pyi")).toBe(true);
    expect(adapter.supports("module.ts")).toBe(false);
  });

  test.skipIf(!hasPython)("decodes Bun stdin as UTF-8 even when Python is configured for a legacy locale", () => {
    const previousEncoding = process.env.PYTHONIOENCODING;
    process.env.PYTHONIOENCODING = "cp1251";
    try {
      const result = adapter.analyze(
        "example.py",
        `# Кириллический комментарий\nGREETING = "Привет 🌍"\ndef привет():\n    return GREETING\n`,
      );
      expect(result.exports.has("GREETING")).toBe(true);
      expect(result.exports.has("привет")).toBe(true);
    } finally {
      if (previousEncoding === undefined) delete process.env.PYTHONIOENCODING;
      else process.env.PYTHONIOENCODING = previousEncoding;
    }
  });
});
