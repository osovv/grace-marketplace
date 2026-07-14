import { expect, test, describe } from "bun:test";
import { checkModuleCheckReferences } from "./check-references.ts";

describe("checkModuleCheckReferences", () => {
  test("returns true when all testFiles are referenced", () => {
    expect(checkModuleCheckReferences(["src/a.test.ts"], ["bun test src/a.test.ts"])).toBe(true);
  });

  test("returns false when a testFile is not found", () => {
    expect(checkModuleCheckReferences(["src/a.test.ts"], ["bun test src/b.test.ts"])).toBe(false);
  });

  test("without cwd, compares testFiles as-is", () => {
    expect(checkModuleCheckReferences(["auth/src/auth.test.ts"], ["bun test auth/src/auth.test.ts"])).toBe(true);
    expect(checkModuleCheckReferences(["auth/src/auth.test.ts"], ["bun test src/b.test.ts"])).toBe(false);
  });

  test("with cwd, strips cwd prefix from testFile", () => {
    expect(checkModuleCheckReferences(["packages/auth/src/auth.test.ts"], ["bun test src/auth.test.ts"], "packages/auth")).toBe(true);
    expect(checkModuleCheckReferences(["packages/auth/src/auth.test.ts"], ["bun test other.test.ts"], "packages/auth")).toBe(false);
  });

  test("normalizes Windows separators before Cwd-relative comparison", () => {
    expect(checkModuleCheckReferences(["packages\\auth\\src\\auth.test.ts"], ["bun test src/auth.test.ts"], "packages\\auth")).toBe(true);
    expect(checkModuleCheckReferences(["packages\\auth\\src\\auth.test.ts"], ["bun test src\\auth.test.ts"], "packages\\auth")).toBe(true);
  });

  test("with cwd that does not match testFile prefix, no stripping", () => {
    expect(checkModuleCheckReferences(["packages/web/src/test.ts"], ["bun test packages/web/src/test.ts"], "packages/auth")).toBe(true);
    expect(checkModuleCheckReferences(["packages/web/src/test.ts"], ["bun test other.test.ts"], "packages/auth")).toBe(false);
  });

  test("with cwd='.' treated as absent — no stripping", () => {
    expect(checkModuleCheckReferences(["src/a.test.ts"], ["bun test src/a.test.ts"], ".")).toBe(true);
    expect(checkModuleCheckReferences(["src/a.test.ts"], ["bun test src/b.test.ts"], ".")).toBe(false);
  });

  test("with cwd='' treated as absent — no stripping", () => {
    expect(checkModuleCheckReferences(["src/a.test.ts"], ["bun test src/a.test.ts"], "")).toBe(true);
  });

  test("returns true when testFiles is empty", () => {
    expect(checkModuleCheckReferences([], ["bun test anything.ts"])).toBe(true);
  });

  test("directory match via dirname", () => {
    expect(checkModuleCheckReferences(["src/auth.test.ts"], ["bun test src/"])).toBe(true);
  });

  test("returns false when at least one testFile is missing from moduleChecks", () => {
    expect(checkModuleCheckReferences(["src/auth.test.ts", "src/session.test.ts"], ["bun test src/auth.test.ts"])).toBe(false);
  });

  test("returns true when all testFiles are referenced across multiple checks", () => {
    expect(checkModuleCheckReferences(["src/auth.test.ts", "src/session.test.ts"], ["bun test src/auth.test.ts src/session.test.ts"])).toBe(true);
  });
});
