import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type ChecklistItem = {
  label: string;
  ok: boolean;
  detail: string;
};

const repoRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
  version?: string;
  scripts?: Record<string, string>;
  files?: string[];
};
const version = packageJson.version ?? "unknown";
const changelog = readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
const changelogVersions = [...changelog.matchAll(/^##\s+<small>([^\s]+)\s+\(/gm)].map((match) => match[1]!);
const duplicateChangelogVersions = changelogVersions.filter((entry, index) => changelogVersions.indexOf(entry) !== index);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const checklist: ChecklistItem[] = [
  {
    label: "Current version is documented in CHANGELOG.md",
    ok: new RegExp(`^##\\s+<small>${escapeRegExp(version)}\\s+\\(`, "m").test(changelog),
    detail: `Expected CHANGELOG.md entry for ${version}.`,
  },
  {
    label: "CHANGELOG.md has no duplicate release headers",
    ok: duplicateChangelogVersions.length === 0,
    detail: `Duplicate versions: ${[...new Set(duplicateChangelogVersions)].join(", ") || "none"}.`,
  },
  {
    label: "Validation workflow exists",
    ok: existsSync(path.join(repoRoot, ".github/workflows/validate.yml")),
    detail: "Expected .github/workflows/validate.yml to exist.",
  },
  {
    label: "CI validation script exists",
    ok: Boolean(packageJson.scripts?.["validate:ci"]),
    detail: "Expected package.json script validate:ci.",
  },
  {
    label: "Release validation includes dedicated CLI validation",
    ok: Boolean(packageJson.scripts?.["validate:release"]?.includes("validate:cli")),
    detail: "Expected package.json validate:release to invoke validate:cli.",
  },
  {
    label: "Publish workflow exists",
    ok: existsSync(path.join(repoRoot, ".github/workflows/publish.yml")),
    detail: "Expected .github/workflows/publish.yml to exist.",
  },
  {
    label: "Published CLI excludes test sources and fixtures",
    ok: Boolean(packageJson.files?.includes("!src/**/*.test.ts") && packageJson.files?.includes("!src/grace4/test-fixtures.ts")),
    detail: "Expected package.json files exclusions for test sources and GRACE fixture builders.",
  },
];

console.log("## Release Checklist");
console.log(`**Version**: ${version}`);
for (const item of checklist) {
  console.log(`- [${item.ok ? "x" : " "}] ${item.label}`);
  if (!item.ok) {
    console.log(`  ${item.detail}`);
  }
}

console.log("\n### Recommended Commands");
console.log("- bun run validate:ci");
console.log("- bun run validate:release");
console.log("- bun run release:checklist");

process.exitCode = checklist.every((item) => item.ok) ? 0 : 1;
