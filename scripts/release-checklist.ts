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
};
const version = packageJson.version ?? "unknown";
const changelog = readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");

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
    label: "Release validation script exists",
    ok: Boolean(packageJson.scripts?.["validate:release"]),
    detail: "Expected package.json script validate:release.",
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
console.log("- bun run release:checklist");

process.exitCode = checklist.every((item) => item.ok) ? 0 : 1;
