import { describe, expect, it } from "bun:test";

import { createTypeScriptAdapter } from "./typescript";

describe("TypeScriptAdapter", () => {
  const adapter = createTypeScriptAdapter();

  it("extracts exported object and array binding names exactly", () => {
    const result = adapter.analyze(
      "bindings.ts",
      `const source = { alpha: 1, nested: { beta: 2 } };
export const { alpha, nested: { beta } } = source;
export const [first, , third] = [1, 2, 3];
`,
    );

    expect([...result.exports].sort()).toEqual(["alpha", "beta", "first", "third"]);
    expect([...result.localSymbols].sort()).toEqual(["alpha", "beta", "first", "source", "third"]);
    expect(result.exportConfidence).toBe("exact");
  });

  it("does not claim exact export parity for wildcard re-exports", () => {
    const result = adapter.analyze("barrel.ts", `export * from "./dependency";\n`);
    expect(result.hasWildcardReExport).toBe(true);
    expect(result.exportConfidence).toBe("heuristic");
  });
});
