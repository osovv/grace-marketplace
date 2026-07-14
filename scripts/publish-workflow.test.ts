import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const workflow = readFileSync(path.resolve(import.meta.dir, "../.github/workflows/publish.yml"), "utf8");

describe("publish workflow release channels", () => {
  it("verifies tag/package identity and runs every release gate", () => {
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("git fetch origin main --tags");
    expect(workflow).toContain('if [ "v${PKG_VERSION}" != "${TAG}" ]');
    expect(workflow).toContain('TAG_COMMIT="$(git rev-parse "${TAG}^{commit}")"');
    expect(workflow).toContain('ORIGIN_MAIN="$(git rev-parse origin/main)"');
    expect(workflow).toContain('if [ "${TAG_COMMIT}" != "${ORIGIN_MAIN}" ]');
    for (const command of ["bun run release:check", "bun run typecheck", "bun run test", "bun run validate:cli", "bun run validate:marketplace", "bun run validate:packed"]) {
      expect(workflow).toContain(command);
    }
  });

  it("publishes prereleases to their identifier tag and stable releases to npm latest", () => {
    expect(workflow).toContain("publish-prerelease:");
    expect(workflow).toContain("if: needs.verify.outputs.prerelease == 'true'");
    expect(workflow).toContain('DIST_TAG="${PRERELEASE_TAG%%.*}"');
    expect(workflow).toContain('npm publish --access public --tag "${DIST_TAG}"');
    expect(workflow).toContain("publish-stable:");
    expect(workflow).toContain("if: needs.verify.outputs.prerelease == 'false'");
    expect(workflow).toContain("environment: stable-release");
    expect(workflow).toContain("run: npm publish --access public");
  });

  it("marks only prerelease tags as GitHub prereleases", () => {
    expect(workflow).toContain("prerelease: true");
    expect(workflow).toContain("prerelease: false");
  });
});
