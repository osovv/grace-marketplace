import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function collectFiles(root: string, current = root): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(root, entryPath));
    } else if (entry.isFile()) {
      files.push(path.relative(root, entryPath));
    }
  }
  return files.sort();
}

describe("GRACE lifecycle skill contracts", () => {
  it("documents strict specs and immutable approved plans", () => {
    const spec = read("skills/grace/grace-spec/SKILL.md");
    const specTemplate = read("skills/grace/grace-spec/references/change-spec-template.xml");
    const plan = read("skills/grace/grace-plan/SKILL.md");

    for (const section of ["Summary", "Goals", "Constraints", "NonGoals", "AcceptanceCriteria", "AffectedAreas", "VerificationIntent"]) {
      expect(spec).toContain(section);
    }
    expect(specTemplate).toContain("<Constraints>");
    expect(plan).toContain("<approved_plan_immutability>");
    expect(plan).toContain("Create a new `C-*` bundle");
    expect(plan).toContain("mark the old bundle superseded");
    expect(plan).toContain("as draft unless the user explicitly approves");
    expect(plan).toContain("--assertions current");
    expect(plan).toContain("--parallel-preflight");
  });

  it("defines one recovery table and explicit selected assertion commands", () => {
    const execute = read("skills/grace/grace-execute/SKILL.md");

    expect(execute.match(/<recovery_decision_table>/g)).toHaveLength(1);
    expect(execute.match(/<\/recovery_decision_table>/g)).toHaveLength(1);
    expect(execute).toContain("--change C-ID --assertions baseline");
    expect(execute).toContain("--change C-ID --assertions target --run-commands");
    expect(execute).toContain("--parallel-preflight");
    expect(execute).toContain("explicit apply confirmation");
    expect(execute.toLowerCase()).not.toContain("refresh assertions");
  });

  it("documents fail-closed CLI and derived readiness behavior", () => {
    const cli = read("skills/grace/grace-cli/SKILL.md");
    const status = read("skills/grace/grace-status/SKILL.md");

    expect(cli).toContain('"schemaVersion": "1.0.0"');
    expect(cli).toContain('"ok": false');
    expect(cli).toContain("analysis.runtime-missing");
    expect(read("skills/grace/grace-explainer/references/semantic-markup.md")).toContain("analysis.heuristic-confidence");
    expect(status).toContain("needs-plan-approval");
    expect(status).toContain("stale-plan");
    expect(status).toContain("integrity-issues");
    expect(status).toContain("ready-to-execute");
    expect(status).toContain("mutually exclusive");
  });
});

describe("GRACE migration cleanup contract", () => {
  it("requires backup, validation, coverage, and separate cleanup approval", () => {
    const skill = read("skills/grace/grace-migrate/SKILL.md");
    const checklist = read("skills/grace/grace-migrate/references/migration-checklist.md");
    const report = read("skills/grace/grace-migrate/references/migration-report-template.xml");

    for (const requirement of ["complete inventory", "restorable backup", "successful current lint", "verified generated coverage", "git availability/worktree inspection", "separate explicit cleanup approval", "dirty or non-git risk acknowledgement"]) {
      expect(skill).toContain(requirement);
    }
    expect(skill).toContain("no cleanup");
    expect(skill).toContain("git status --porcelain --untracked-files=all");
    expect(skill).toContain("Legacy GRACE 3 artifacts remain untouched unless the failure output explicitly lists a completed move.");
    expect(skill).toContain("Never retry destructive cleanup automatically");
    expect(checklist).toContain("no broad glob or unreviewed recursive deletion");
    expect(report).toContain('<Backup restorable="false">');
    expect(report).toContain('<Validation successful="false">');
    expect(report).toContain('<GitPreflight available="false" inWorktree="false" dirty="false">');
    expect(report).toContain('<CleanupProposal approved="false">');
    expect(report).toContain('<DirtyOrNonGitRiskAcknowledgement required="false" approved="false">');
    expect(report).toContain('<CleanupResults performed="false">');
  });
});

describe("published skill mirrors", () => {
  it("keeps every published canonical skill byte-identical to its packaged copy", () => {
    const marketplace = JSON.parse(read(".claude-plugin/marketplace.json")) as {
      plugins: Array<{ skills: string[] }>;
    };

    for (const componentPath of marketplace.plugins[0]!.skills) {
      const relativePath = componentPath.replace(/^\.\//, "");
      const canonicalRoot = path.join(repoRoot, relativePath);
      const packagedRoot = path.join(repoRoot, "plugins/grace", relativePath);
      const canonicalFiles = collectFiles(canonicalRoot);
      const packagedFiles = collectFiles(packagedRoot);

      expect(packagedFiles).toEqual(canonicalFiles);
      for (const file of canonicalFiles) {
        expect(readFileSync(path.join(packagedRoot, file))).toEqual(readFileSync(path.join(canonicalRoot, file)));
      }
    }
  });
});
