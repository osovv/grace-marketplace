import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const workflow = readFileSync(path.resolve(import.meta.dir, "../.github/workflows/publish.yml"), "utf8");

describe("publish workflow release channels", () => {
  it("verifies tag/package identity and runs every release gate", () => {
    expect(workflow).toContain('if [ "v${PKG_VERSION}" != "${TAG}" ]');
    for (const command of ["bun run release:check", "bun run typecheck", "bun run test", "bun run validate:cli", "bun run validate:marketplace"]) {
      expect(workflow).toContain(command);
    }
  });

  it("publishes prereleases to their identifier tag and stable releases to npm latest", () => {
    expect(workflow).toContain('if [[ "${PKG_VERSION}" == *-* ]]');
    expect(workflow).toContain('DIST_TAG="${PRERELEASE_TAG%%.*}"');
    expect(workflow).toContain('npm publish --access public --tag "${DIST_TAG}"');
    expect(workflow).toContain("npm publish --access public\n");
  });

  it("marks only prerelease tags as GitHub prereleases", () => {
    expect(workflow).toContain("prerelease: ${{ contains(github.ref_name, '-') }}");
  });
});
