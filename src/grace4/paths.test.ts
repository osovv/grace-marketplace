import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import {
  normalizeProjectRelativePath,
  ProjectPathError,
  resolveContainedProjectPath,
} from "./paths";

function createDirectory(prefix: string): string {
  const root = path.join(os.tmpdir(), `${prefix}-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

describe("GRACE 4 contained project paths", () => {
  it("rejects portable absolute and traversal forms before filesystem resolution", () => {
    const cases = ["/tmp/x", "C:\\x", "C:x", "\\\\server\\share", "../x", "a/../../x", "a\\..\\x"] as const;
    for (const authoredPath of cases) {
      try {
        normalizeProjectRelativePath(authoredPath);
        throw new Error(`Expected ${authoredPath} to fail.`);
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectPathError);
        const code = (error as ProjectPathError).code;
        if (authoredPath.includes("..")) expect(code).toBe("path.traversal");
        else expect(["path.absolute", "path.invalid-drive"]).toContain(code);
      }
    }
  });

  it("normalizes slash and backslash paths without losing the authored diagnostic value", () => {
    expect(normalizeProjectRelativePath("src\\feature/./index.ts")).toBe("src/feature/index.ts");

    const authoredPath = "a\\..\\secret";
    try {
      normalizeProjectRelativePath(authoredPath);
      throw new Error("Expected traversal to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectPathError);
      expect((error as ProjectPathError).authoredPath).toBe(authoredPath);
    }
  });

  it("resolves an ordinary existing file to a contained absolute path", () => {
    const root = createDirectory("grace4-paths-existing");
    const file = path.join(root, "src", "example.ts");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "export {};\n");

    expect(resolveContainedProjectPath(root, "src\\example.ts")).toEqual({
      authoredPath: "src\\example.ts",
      relativePath: "src/example.ts",
      absolutePath: file,
    });
  });

  it("rejects an existing symlink whose realpath escapes the allowed root", () => {
    const root = createDirectory("grace4-paths-symlink-root");
    const outside = createDirectory("grace4-paths-symlink-outside");
    writeFileSync(path.join(outside, "secret.txt"), "secret\n");
    symlinkSync(path.join(outside, "secret.txt"), path.join(root, "escape.txt"));

    expect(() => resolveContainedProjectPath(root, "escape.txt")).toThrow(
      expect.objectContaining({ code: "path.symlink-escape", authoredPath: "escape.txt" }),
    );
  });

  it("accepts a nonexistent output only when its nearest existing ancestor is contained", () => {
    const root = createDirectory("grace4-paths-output");
    const existingDirectory = path.join(root, "generated");
    mkdirSync(existingDirectory);

    expect(resolveContainedProjectPath(root, "generated/deep/result.xml", { mode: "output", extension: ".xml" })).toEqual({
      authoredPath: "generated/deep/result.xml",
      relativePath: "generated/deep/result.xml",
      absolutePath: path.join(root, "generated", "deep", "result.xml"),
    });
  });

  it("rejects an output whose nearest existing ancestor escapes through a symlink", () => {
    const root = createDirectory("grace4-paths-output-root");
    const outside = createDirectory("grace4-paths-output-outside");
    symlinkSync(outside, path.join(root, "generated"), "dir");

    expect(() => resolveContainedProjectPath(root, "generated/result.xml", { mode: "output" })).toThrow(
      expect.objectContaining({ code: "path.symlink-escape", authoredPath: "generated/result.xml" }),
    );
  });
});
