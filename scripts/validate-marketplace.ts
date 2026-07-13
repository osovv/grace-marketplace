import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type JsonObject = Record<string, unknown>;

type ValidationResult = {
  scopeLabel: string;
  checkedPlugins: string[];
  errors: string[];
  warnings: string[];
  hardcodedPathWarnings: string[];
};

const repoRoot = process.cwd();
const marketplaceDir = path.join(repoRoot, ".claude-plugin");
const marketplacePath = path.join(marketplaceDir, "marketplace.json");
const readmePath = path.join(repoRoot, "README.md");
const packagePath = path.join(repoRoot, "package.json");
const openPackagePath = path.join(repoRoot, "openpackage.yml");
const changelogPath = path.join(repoRoot, "CHANGELOG.md");
const componentFields = ["skills", "agents", "commands"] as const;
const pluginComponentFields = ["commands", "agents", "hooks", "mcpServers", "lspServers", "outputStyles"] as const;

/** Required published GRACE 4 skill directory names. */
const REQUIRED_GRACE4_SKILLS = new Set([
  "grace-init",
  "grace-spec",
  "grace-plan",
  "grace-execute",
  "grace-refactor",
  "grace-setup-subagents",
  "grace-fix",
  "grace-refresh",
  "grace-status",
  "grace-ask",
  "grace-cli",
  "grace-explainer",
  "grace-verification",
  "grace-reviewer",
  "grace-migrate",
]);

/** Skill names that must not be published in the GRACE 4 marketplace manifest. */
const FORBIDDEN_GRACE4_SKILLS = new Set(["grace-multiagent-execute"]);

function readJson(filePath: string): JsonObject {
  return JSON.parse(readFileSync(filePath, "utf8")) as JsonObject;
}

function pathExists(targetPath: string): boolean {
  return existsSync(targetPath);
}

function isDirectory(targetPath: string): boolean {
  return pathExists(targetPath) && lstatSync(targetPath).isDirectory();
}

function getChangedFiles(): string[] | null {
  const result = spawnSync("git", ["diff", "--name-only", "origin/main...HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    return null;
  }

  const files = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return files.length > 0 ? files : null;
}

function getReadmeVersion(): string | null {
  const readme = readFileSync(readmePath, "utf8");
  const match = readme.match(/Current packaged version:\s*`([^`]+)`/);
  return match?.[1] ?? null;
}

function getOpenPackageVersion(): string | null {
  const openPackage = readFileSync(openPackagePath, "utf8");
  const match = openPackage.match(/^version:\s*([^\s]+)\s*$/m);
  return match?.[1] ?? null;
}

function getPackageVersion(): string | null {
  const packageJson = readJson(packagePath);
  return typeof packageJson.version === "string" ? packageJson.version : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Checks that CHANGELOG.md contains a strict vv-style header for the given version. */
function changelogHasVersion(version: string) {
  const changelog = readFileSync(changelogPath, "utf8");
  const escaped = escapeRegExp(version);
  return new RegExp(`^##\\s+<small>${escaped}\\s+\\(`, "m").test(changelog);
}

function normalizeComparableValue(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function validateRequiredFields(
  objectName: string,
  sourceName: string,
  source: JsonObject,
  fields: string[],
  errors: string[],
) {
  for (const field of fields) {
    const value = source[field];
    if (typeof value !== "string" || value.trim() === "") {
      errors.push(`${objectName}: missing required field "${field}" in ${sourceName}`);
    }
  }
}

function compareSharedFields(
  objectName: string,
  leftName: string,
  left: JsonObject,
  rightName: string,
  right: JsonObject,
  fields: string[],
  errors: string[],
) {
  for (const field of fields) {
    if (normalizeComparableValue(left[field]) !== normalizeComparableValue(right[field])) {
      errors.push(
        `${objectName}: ${field} mismatch between ${leftName} (${JSON.stringify(left[field] ?? null)}) and ${rightName} (${JSON.stringify(right[field] ?? null)})`,
      );
    }
  }
}

function collectHardcodedPathWarnings(dirPath: string, warnings: string[]) {
  const entries = readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(repoRoot, entryPath);

    if (entry.isDirectory()) {
      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }

      collectHardcodedPathWarnings(entryPath, warnings);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!relativePath.endsWith(".sh") && !relativePath.endsWith(".ts")) {
      continue;
    }

    const lines = readFileSync(entryPath, "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (/\/home\/[A-Za-z]/.test(lines[index]) || /\/Users\/[A-Za-z]/.test(lines[index])) {
        warnings.push(`${relativePath}:${index + 1}: ${lines[index].trim()}`);
      }
    }
  }
}

function isInsideDir(parentDir: string, targetPath: string): boolean {
  const relative = path.relative(parentDir, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function getScopedEntries(pluginEntries: JsonObject[], changedFiles: string[] | null): JsonObject[] {
  if (!changedFiles) {
    return pluginEntries;
  }

  const matchedEntries = pluginEntries.filter((entry) => {
    const source = String(entry.source ?? "");
    if (!source) {
      return false;
    }

    const sourceDir = path.resolve(repoRoot, source);
    return changedFiles.some((file) => isInsideDir(sourceDir, path.resolve(repoRoot, file)));
  });

  return matchedEntries.length > 0 ? matchedEntries : pluginEntries;
}

function validateComponentPaths(
  pluginName: string,
  sourceDir: string,
  entry: JsonObject,
  errors: string[],
) {
  for (const field of componentFields) {
    const value = entry[field];
    if (!Array.isArray(value)) {
      continue;
    }

    for (const componentPath of value) {
      if (typeof componentPath !== "string" || componentPath.trim() === "") {
        errors.push(`${pluginName}: ${field} contains a non-string path`);
        continue;
      }

      const resolvedPath = path.resolve(sourceDir, componentPath);
      if (!isInsideDir(sourceDir, resolvedPath)) {
        errors.push(`${pluginName}: ${field} path escapes source root (${componentPath})`);
        continue;
      }

      if (!pathExists(resolvedPath)) {
        errors.push(`${pluginName}: missing ${field} path inside source (${componentPath})`);
      }
    }
  }
}

function validatePackagedMirror(
  pluginName: string,
  sourceDir: string,
  entry: JsonObject,
  errors: string[],
) {
  if (sourceDir === repoRoot) {
    return;
  }

  for (const field of componentFields) {
    const value = entry[field];
    if (!Array.isArray(value)) {
      continue;
    }

    for (const componentPath of value) {
      if (typeof componentPath !== "string" || componentPath.trim() === "") {
        continue;
      }

      const packagedPath = path.resolve(sourceDir, componentPath);
      const canonicalPath = path.resolve(repoRoot, componentPath);

      if (!pathExists(canonicalPath)) {
        errors.push(`${pluginName}: canonical ${field} path missing in repository root (${componentPath})`);
        continue;
      }

      const diff = spawnSync("git", ["diff", "--no-index", "--quiet", "--", canonicalPath, packagedPath], {
        cwd: repoRoot,
        encoding: "utf8",
      });

      if (diff.status === 1) {
        errors.push(`${pluginName}: packaged ${field} content is out of sync with repository root (${componentPath})`);
      } else if (diff.status && diff.status > 1) {
        errors.push(`${pluginName}: failed to compare packaged and canonical ${field} paths (${componentPath})`);
      }
    }
  }
}

function skillNamesFromEntry(entry: JsonObject): Set<string> {
  const skills = Array.isArray(entry.skills) ? entry.skills : [];
  return new Set(
    skills
      .filter((skill): skill is string => typeof skill === "string")
      .map((skill) => path.basename(skill.replace(/\/+$/, "")))
      .filter(Boolean),
  );
}

/** Validates that the marketplace skills array matches the GRACE 4 release surface. */
function validateGrace4SkillSurface(entry: JsonObject, errors: string[]): void {
  if (String(entry.name ?? "") !== "grace") {
    return;
  }

  const publishedSkills = skillNamesFromEntry(entry);
  for (const requiredSkill of REQUIRED_GRACE4_SKILLS) {
    if (!publishedSkills.has(requiredSkill)) {
      errors.push(`grace: missing required GRACE 4 skill in marketplace skills array (${requiredSkill})`);
    }
  }

  for (const forbiddenSkill of FORBIDDEN_GRACE4_SKILLS) {
    if (publishedSkills.has(forbiddenSkill)) {
      errors.push(`grace: forbidden GRACE 4 skill is still published (${forbiddenSkill})`);
    }
  }
}

/** Validates that package.json declares fast-xml-parser as a runtime dependency. */
function validateGrace4Dependencies(errors: string[]): void {
  const packageJson = readJson(packagePath);
  const dependencies = typeof packageJson.dependencies === "object" && packageJson.dependencies
    ? packageJson.dependencies as JsonObject
    : {};

  if (typeof dependencies["fast-xml-parser"] !== "string") {
    errors.push("package.json: missing runtime dependency fast-xml-parser required by GRACE 4 XML parsing");
  }

  const publishedFiles = Array.isArray(packageJson.files)
    ? packageJson.files.filter((entry): entry is string => typeof entry === "string")
    : [];
  for (const exclusion of ["!src/**/*.test.ts", "!src/grace4/test-fixtures.ts"]) {
    if (!publishedFiles.includes(exclusion)) {
      errors.push(`package.json: missing published-files exclusion ${exclusion}`);
    }
  }

  const scripts = typeof packageJson.scripts === "object" && packageJson.scripts
    ? packageJson.scripts as JsonObject
    : {};
  if (typeof scripts["validate:release"] !== "string" || !scripts["validate:release"].includes("validate:cli")) {
    errors.push("package.json: validate:release must invoke validate:cli");
  }
}

function validate(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const hardcodedPathWarnings: string[] = [];

  const marketplace = readJson(marketplacePath);
  const pluginEntries = Array.isArray(marketplace.plugins) ? (marketplace.plugins as JsonObject[]) : [];
  const changedFiles = getChangedFiles();
  const scopedEntries = getScopedEntries(pluginEntries, changedFiles);
  const readmeVersion = getReadmeVersion();
  const openPackageVersion = getOpenPackageVersion();
  const packageVersion = getPackageVersion();
  const marketplaceVersion = typeof marketplace.metadata === "object" && marketplace.metadata
    ? String((marketplace.metadata as JsonObject).version ?? "")
    : "";

  if (pluginEntries.length === 0) {
    errors.push("marketplace.json: no plugins declared");
  }

  if (!readmeVersion) {
    errors.push('README.md: missing "Current packaged version: `x.y.z`" marker');
  }

  if (!openPackageVersion) {
    errors.push("openpackage.yml: missing version");
  }

  if (!packageVersion) {
    errors.push("package.json: missing version");
  }

  validateGrace4Dependencies(errors);

  const rootManifestFiles = readdirSync(marketplaceDir);
  const extraRootManifestFiles = rootManifestFiles.filter((fileName) => fileName !== "marketplace.json");
  if (extraRootManifestFiles.length > 0) {
    errors.push(`marketplace root: extra files in .claude-plugin (${extraRootManifestFiles.join(", ")})`);
  }

  for (const entry of scopedEntries) {
    const pluginName = String(entry.name ?? "");
    const source = String(entry.source ?? "");

    if (!pluginName) {
      errors.push("marketplace.json: plugin entry missing name");
      continue;
    }

    if (!source) {
      errors.push(`${pluginName}: marketplace entry missing source`);
      continue;
    }

    if (!source.startsWith("./")) {
      errors.push(`${pluginName}: relative source must start with ./ (${source})`);
      continue;
    }

    const sourceDir = path.resolve(repoRoot, source);
    const pluginManifestDir = path.join(sourceDir, ".claude-plugin");
    const pluginManifestPath = path.join(pluginManifestDir, "plugin.json");

    validateRequiredFields(pluginName, "marketplace.json", entry, ["name", "version", "description"], errors);
    validateGrace4SkillSurface(entry, errors);

    if (!isDirectory(sourceDir)) {
      errors.push(`${pluginName}: source directory not found (${path.relative(repoRoot, sourceDir)})`);
      continue;
    }

    if (!pathExists(pluginManifestPath)) {
      errors.push(`${pluginName}: missing plugin manifest at ${path.relative(repoRoot, pluginManifestPath)}`);
      continue;
    }

    const pluginManifest = readJson(pluginManifestPath);
    validateRequiredFields(pluginName, ".claude-plugin/plugin.json", pluginManifest, ["name", "version", "description"], errors);

    compareSharedFields(
      pluginName,
      "marketplace.json",
      entry,
      ".claude-plugin/plugin.json",
      pluginManifest,
      ["name", "version", "description", "license", "author"],
      errors,
    );

    const hasMarketplaceDefinedComponents = componentFields.some(
      (field) => Array.isArray(entry[field]) && (entry[field] as unknown[]).length > 0,
    );
    const pluginDefinesComponents = pluginComponentFields.some((field) => pluginManifest[field] !== undefined);

    if (hasMarketplaceDefinedComponents && entry.strict !== true) {
      errors.push(`${pluginName}: marketplace entry defines components and must set strict: true`);
    }

    if (entry.strict === false && pluginDefinesComponents) {
      errors.push(`${pluginName}: strict: false conflicts with component fields declared in plugin manifest`);
    }

    validateComponentPaths(pluginName, sourceDir, entry, errors);
    validatePackagedMirror(pluginName, sourceDir, entry, errors);

    if (readmeVersion && String(entry.version ?? "") !== readmeVersion) {
      errors.push(`${pluginName}: version mismatch between marketplace.json (${entry.version}) and README.md (${readmeVersion})`);
    }

    if (openPackageVersion && String(entry.version ?? "") !== openPackageVersion) {
      errors.push(
        `${pluginName}: version mismatch between marketplace.json (${entry.version}) and openpackage.yml (${openPackageVersion})`,
      );
    }

    if (packageVersion && String(entry.version ?? "") !== packageVersion) {
      errors.push(`${pluginName}: version mismatch between marketplace.json (${entry.version}) and package.json (${packageVersion})`);
    }

    if (marketplaceVersion && String(entry.version ?? "") !== marketplaceVersion) {
      errors.push(
        `${pluginName}: version mismatch between marketplace metadata (${marketplaceVersion}) and plugin entry (${entry.version})`,
      );
    }

    if (String(entry.version ?? "") && !changelogHasVersion(String(entry.version))) {
      errors.push(`${pluginName}: CHANGELOG.md is missing an entry for version ${entry.version}`);
    }

    const pluginManifestFiles = readdirSync(pluginManifestDir);
    const extraPluginManifestFiles = pluginManifestFiles.filter((fileName) => fileName !== "plugin.json");
    if (extraPluginManifestFiles.length > 0) {
      errors.push(
        `${pluginName}: extra files in ${path.relative(repoRoot, pluginManifestDir)} (${extraPluginManifestFiles.join(", ")})`,
      );
    }
  }

  collectHardcodedPathWarnings(repoRoot, hardcodedPathWarnings);

  return {
    scopeLabel: scopedEntries.length === pluginEntries.length
      ? "all"
      : scopedEntries.map((entry) => String(entry.name ?? "")).filter(Boolean).join(", "),
    checkedPlugins: scopedEntries.map((entry) => String(entry.name ?? "")).filter(Boolean),
    errors,
    warnings,
    hardcodedPathWarnings,
  };
}

function printResult(result: ValidationResult) {
  const hasFailures = result.errors.length > 0;
  const hasHardcodedPathWarnings = result.hardcodedPathWarnings.length > 0;
  const marketplaceSyncFailed = result.errors.some(
    (error) =>
      error.includes("mismatch") ||
      error.includes("source directory not found") ||
      error.includes("missing plugin manifest") ||
      error.includes("missing skills path") ||
      error.includes("missing agents path") ||
      error.includes("missing commands path") ||
      error.includes("escapes source root") ||
      error.includes("must set strict: true") ||
      error.includes("relative source must start with ./"),
  );
  const versionFailed = result.errors.some((error) => error.includes("version mismatch") || error.includes("missing version"));
  const fieldsFailed = result.errors.some((error) => error.includes('missing required field') || error.includes('plugin entry missing'));
  const structureFailed = result.errors.some((error) => error.includes("extra files in"));

  console.log("## Validation Result");
  console.log(`**Status**: ${hasFailures ? "FAIL" : "PASS"}`);
  console.log(`**Scope**: ${result.scopeLabel}`);
  console.log("### Checks");
  console.log(`- [${marketplaceSyncFailed ? " " : "x"}] Marketplace sync`);
  console.log(`- [${versionFailed ? " " : "x"}] Version consistency`);
  console.log(`- [${fieldsFailed ? " " : "x"}] Required fields`);
  console.log(`- [${structureFailed ? " " : "x"}] Structure (single plugin.json)`);
  console.log(`- [${hasHardcodedPathWarnings ? " " : "x"}] No hardcoded paths`);

  if (result.errors.length > 0) {
    console.log("### Errors");
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
  }

  if (result.hardcodedPathWarnings.length > 0 || result.warnings.length > 0) {
    console.log("### Warnings");
    for (const warning of result.hardcodedPathWarnings) {
      console.log(`- ${warning}`);
    }
    for (const warning of result.warnings) {
      console.log(`- ${warning}`);
    }
  }

  process.exitCode = hasFailures ? 1 : 0;
}

printResult(validate());
