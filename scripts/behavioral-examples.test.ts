import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { extractAssertionsWithIssues } from "../src/grace4/assertions";
import { validateGrace4Project } from "../src/grace4/grammar";
import { resolveGrace4Paths } from "../src/grace4/project";
import { buildGraphProjection, buildVerificationProjection } from "../src/grace4/projections";
import { writeMinimalGrace4Project } from "../src/grace4/test-fixtures";
import { childText, readGraceXmlArtifact, walkNodes } from "../src/grace4/xml";

const repoRoot = path.resolve(import.meta.dir, "..");
const reference = "skills/grace/grace-explainer/references/behavioral-examples.md";
const command = "bun test tests/reserve-stock.test.ts";
const bundle = ".grace/changes/active/C-RESERVE-STOCK";
const temporaryProjects: string[] = [];

afterEach(() => {
  for (const root of temporaryProjects.splice(0)) rmSync(root, { recursive: true, force: true });
});

function read(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), "utf8");
}

function write(root: string, relative: string, text: string): void {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function example(name: "behavioral-spec" | "behavioral-verification"): string {
  const parts = read(reference).split(`<!-- grace-example: ${name} -->`);
  expect(parts).toHaveLength(2);
  const fence = parts[1]!.match(/^\s*```xml\r?\n([\s\S]*?)\r?\n```/);
  expect(fence).not.toBeNull();
  return fence![1]!;
}

function project(): string {
  // macOS resolves route containment through realpath, but lists files lexically;
  // a symlinked os.tmpdir() (/var -> /private/var) then reads as an unindexed document.
  const root = mkdtempSync(path.join(realpathSync(os.tmpdir()), "grace-behavioral-examples-"));
  temporaryProjects.push(root);
  writeMinimalGrace4Project(root);
  for (const file of ["graph/index.xml", "graph/main.xml", "verification/index.xml", "verification/main.xml"]) {
    const relative = `.grace/${file}`;
    write(root, relative, readFileSync(path.join(root, relative), "utf8").replaceAll("M-EXAMPLE", "M-STOCK"));
  }
  // Only grammar, ownership, and projection are checked here; this file is not a behavioral test.
  write(root, "tests/reserve-stock.test.ts", "// Existing path for the published TestFiles declaration.\n");
  return root;
}

function projectWithExamples(): string {
  const root = project();
  write(root, `${bundle}/spec.xml`, example("behavioral-spec"));
  write(root, ".grace/verification/main.xml", example("behavioral-verification"));
  return root;
}

function verification(root: string) {
  const paths = resolveGrace4Paths(root);
  const graph = buildGraphProjection(paths);
  const result = buildVerificationProjection(paths, graph);
  expect(graph.issues).toEqual([]);
  expect(result.issues).toEqual([]);
  return result.entries.get("V-M-STOCK")!;
}

// Replace only published scalar placeholders and the four documented anchor placeholders.
// Unknown placeholders fail instead of silently receiving generic values.
const templateValues: Record<string, string> = {
  SUMMARY: "Reserve available stock.",
  PROBLEM: "Reservations can overdraw stock.",
  GOAL: "Keep stock non-negative.",
  CONSTRAINT: "Preserve unrelated item quantities.",
  NON_GOAL: "Supplier ordering.",
  CRITERION_LOCAL_NAME: "reserve-without-overdrawing",
  GENERAL_RULE_AND_APPLICABLE_DOMAIN: "Reserve a positive integer quantity only when enough stock is available.",
  SCENARIO_LOCAL_NAME: "reserve-available-stock",
  INPUT_AND_RELEVANT_INITIAL_STATE_OR_CONTEXT: "Stock is 10.",
  ACTION: "Reserve 3 units.",
  OBSERVABLE_RESULT_AND_RELEVANT_STATE_CHANGE: "Return reserved and set stock to 7.",
  RELEVANT_STATE_THAT_MUST_BE_PRESERVED: "Other items retain their quantities.",
  CONTRASTING_SCENARIO_LOCAL_NAME: "reject-insufficient-stock",
  CONTRASTING_INPUT_OR_CONTEXT: "Stock is 2.",
  EXPECTED_BOUNDARY_REJECTION_OR_OTHER_CONTRAST: "Return insufficient-stock.",
  RELEVANT_EFFECT_THAT_MUST_NOT_OCCUR: "No stock quantity changes.",
  EXPECTED_COMMAND: command,
  EXPECTED_EVIDENCE: "Both named scenarios pass.",
  ASSUMPTION: "Quantities are integers.",
  INTENT_SUMMARY: "Implement the approved reservation rule.",
  LEAF_TEST_COMMAND: command,
  TASK_TITLE: "Check accepted and rejected reservations.",
  TASK_ACCEPTANCE: "Available stock decreases by the reserved quantity.",
  CONTRASTING_TASK_ACCEPTANCE: "Insufficient stock is rejected without mutation.",
  TEST_FILE: "tests/reserve-stock.test.ts",
  TEST_SELECTOR_OR_NAME: "reserve-available-stock",
  NAMED_TEST_RESULT_AND_OBSERVATIONS_CHECKED_AGAINST_SPEC: "Pass; reserved result and stock 7.",
  CONTRASTING_TEST_FILE: "tests/reserve-stock.test.ts",
  CONTRASTING_TEST_SELECTOR_OR_NAME: "reject-insufficient-stock",
  CONTRASTING_TEST_RESULT_AND_OBSERVATIONS_CHECKED_AGAINST_SPEC: "Pass; rejected result and stock unchanged.",
};

function instantiateTemplate(relative: string): string {
  let text = read(relative).replace(/\$([A-Z][A-Z0-9_]*)/g, (_match, name: string) => {
    if (!(name in templateValues)) throw new Error(`Unmapped template placeholder: ${name}`);
    return templateValues[name]!;
  });
  for (const [placeholder, value] of Object.entries({
    "C-CHANGE-ID": "C-RESERVE-STOCK",
    "M-AFFECTED-MODULE": "M-STOCK",
    "M-EXISTING-MODULE": "M-STOCK",
    "M-TARGET-MODULE": "M-STOCK",
  })) text = text.replaceAll(placeholder, value);
  return text;
}

describe("published behavioral examples under current GRACE 4.0", () => {
  it("validates the complete published XML and projects both contrasting scenarios and their command", () => {
    const root = projectWithExamples();
    expect(validateGrace4Project(root).issues).toEqual([]);

    const entry = verification(root);
    expect(entry.moduleId).toBe("M-STOCK");
    expect(entry.owner).toBe("VD-MAIN");
    expect(entry.commands).toEqual([command]);
    expect(entry.testFiles).toEqual(["tests/reserve-stock.test.ts"]);
    expect(entry.scenarios).toEqual([
      "Name exact-boundary Given SKU A has 3 units; SKU B has 7 units. When Reserve 3 units of SKU A. Then Return reserved; SKU A has 0 units. Unchanged SKU B still has 7 units. Forbidden Negative stock or creation of another SKU.",
      "Name rejected-overdraw Given SKU A has 3 units; SKU B has 7 units. When Reserve 4 units of SKU A. Then Return insufficient-stock. Unchanged The entire stock state remains A=3, B=7. Forbidden Partial reservation or any stock write.",
    ]);

    const scenarioFields = (file: string) => [...walkNodes(readGraceXmlArtifact(file).root!)]
      .filter(node => node.tag === "Scenario")
      .map(node => Object.fromEntries(node.children.map(field => [field.tag, field.text.trim()])));
    const specScenarios = scenarioFields(path.join(root, bundle, "spec.xml"));
    expect(specScenarios.map(scenario => scenario.Name)).toEqual(["exact-boundary", "rejected-overdraw"]);
    expect(specScenarios).toEqual(scenarioFields(path.join(root, ".grace/verification/main.xml")));
  });

  it("keeps instantiated spec and plan templates valid and preserves their selected leaf command", () => {
    const root = project();
    // A plan requires an approved spec; the shipped template itself remains draft by default.
    const spec = instantiateTemplate("skills/grace/grace-spec/references/change-spec-template.xml").replace('status="draft"', 'status="approved"');
    write(root, `${bundle}/spec.xml`, spec);
    write(root, `${bundle}/plan.xml`, instantiateTemplate("skills/grace/grace-plan/references/change-plan-template.xml"));

    expect(validateGrace4Project(root).issues).toEqual([]);
    const planFile = path.join(root, bundle, "plan.xml");
    const target = extractAssertionsWithIssues(planFile, "TargetAssertions");
    expect(target.issues).toEqual([]);
    expect(target.assertions.map(({ kind, values }) => ({ kind, values }))).toEqual([
      { kind: "MustVerify", values: ["M-STOCK"] },
      { kind: "MustPassCommand", values: [command] },
    ]);
    const taskVerification = [...walkNodes(readGraceXmlArtifact(planFile).root!)].filter(node => node.tag === "Verification");
    expect(taskVerification.map(node => childText(node, "Command"))).toEqual([command]);
  });

  it("rejects an attribute on the published semantic verification anchor", () => {
    const root = projectWithExamples();
    const invalid = example("behavioral-verification").replace("<V-M-STOCK>", '<V-M-STOCK scenario="reserve-available-stock">');
    expect(invalid).not.toBe(example("behavioral-verification"));
    write(root, ".grace/verification/main.xml", invalid);

    expect(validateGrace4Project(root).issues.map(issue => issue.code)).toEqual(["artifact.semantic-anchor-has-attributes"]);
  });
});
