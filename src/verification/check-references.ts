import path from "node:path";

/**
 * Checks whether module-check command strings reference declared test files.
 *
 * When cwd is provided and a testFile starts with "cwd/", the cwd prefix is
 * stripped before comparison. This allows monorepo authors to write testFiles
 * as repo-root-relative paths while moduleChecks use package-root-relative paths.
 *
 * @param testFiles - repo-root-relative test file paths (e.g., "packages/auth/src/auth.test.ts")
 * @param moduleChecks - command strings from module-checks block (e.g., "bun test src/auth.test.ts")
 * @param cwd - optional working directory for commands, relative to project root (e.g., "packages/auth")
 * @returns false if any testFile is not referenced by any moduleCheck; true otherwise
 */
export function checkModuleCheckReferences(
  testFiles: string[],
  moduleChecks: string[],
  cwd?: string,
): boolean {
  // Normalize CWD: strip trailing slashes to avoid silent false positives
  const normalizedCwd = cwd ? cwd.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "") : cwd;
  if (testFiles.length === 0) {
    return true;
  }

  for (const testFile of testFiles) {
    let normalized = testFile.replaceAll("\\", "/").replace(/^\.\//, "");

    // If cwd is provided and testFile starts with "cwd/", strip the prefix.
    // cwd="" or cwd="." are treated as absent (no normalization).
    if (normalizedCwd && normalizedCwd !== "." && normalizedCwd !== "" && normalized.startsWith(normalizedCwd + "/")) {
      normalized = normalized.slice(normalizedCwd.length + 1);
    }

    const dir = path.dirname(normalized);
    const found = moduleChecks.some((check) => {
      const normalizedCheck = check.replaceAll("\\", "/");
      // Full path match: the check string contains the test file path
      if (normalizedCheck.includes(normalized)) {
        return true;
      }

      // Directory match: check if any whitespace-separated token references
      // the directory as a test target (e.g., "bun test src/").
      // Skip bare "." dirnames since they match everything.
      if (dir === ".") {
        return false;
      }
      const tokens = normalizedCheck.split(/\s+/);
      return tokens.some(
        (token) => token === dir || token === dir + "/",
      );
    });

    if (!found) {
      return false;
    }
  }

  return true;
}
