import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { lintGraceProject } from "./grace-lint";
import { formatLintExplanation, getLintIssueGuide } from "./lint/catalog";

function createProject() {
  const root = mkdtempSync(path.join(os.tmpdir(), "grace-lint-"));
  mkdirSync(path.join(root, "docs"), { recursive: true });
  return root;
}

function writeProjectFile(root: string, relativePath: string, contents: string) {
  const filePath = path.join(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

function writeBaseDocsWithoutVerification(root: string) {
  writeProjectFile(
    root,
    "docs/knowledge-graph.xml",
    `<KnowledgeGraph>
  <Project NAME="Example" VERSION="0.1.0">
    <M-EXAMPLE NAME="Example" TYPE="CORE_LOGIC">
      <purpose>Run the example flow.</purpose>
      <path>src/example.ts</path>
      <depends>none</depends>
    </M-EXAMPLE>
  </Project>
</KnowledgeGraph>`,
  );

  writeProjectFile(
    root,
    "docs/development-plan.xml",
    `<DevelopmentPlan VERSION="0.1.0">
  <Modules>
    <M-EXAMPLE NAME="Example" TYPE="CORE_LOGIC" STATUS="planned">
      <contract>
        <purpose>Run the example flow.</purpose>
      </contract>
    </M-EXAMPLE>
  </Modules>
</DevelopmentPlan>`,
  );
}

function writeCurrentDocs(root: string) {
  writeProjectFile(
    root,
    "docs/technology.xml",
    `<TechnologyStack VERSION="0.2.0">
  <Runtime>bun 1.3.8</Runtime>
  <Language>typescript 6.x</Language>
  <PreferredAgentStack>
    <preferred-runtime-library>bun</preferred-runtime-library>
    <preferred-test-library>bun:test</preferred-test-library>
  </PreferredAgentStack>
  <AutonomyPolicy>
    <default-execution-profile>balanced</default-execution-profile>
    <max-fix-attempts-per-step>2</max-fix-attempts-per-step>
  </AutonomyPolicy>
</TechnologyStack>`,
  );

  writeProjectFile(
    root,
    "docs/knowledge-graph.xml",
    `<KnowledgeGraph>
  <Project NAME="Example" VERSION="0.1.0">
    <M-EXAMPLE NAME="Example" TYPE="CORE_LOGIC">
      <purpose>Run the example flow.</purpose>
      <path>src/example.ts</path>
      <depends>none</depends>
      <verification-ref>V-M-EXAMPLE</verification-ref>
      <annotations>
        <fn-run PURPOSE="Run the example flow" />
        <export-run PURPOSE="Public module entry point" />
      </annotations>
    </M-EXAMPLE>
  </Project>
</KnowledgeGraph>`,
  );

  writeProjectFile(
    root,
    "docs/development-plan.xml",
    `<DevelopmentPlan VERSION="0.1.0">
  <Modules>
    <M-EXAMPLE NAME="Example" TYPE="CORE_LOGIC" STATUS="planned">
      <contract>
        <purpose>Run the example flow.</purpose>
      </contract>
      <verification-ref>V-M-EXAMPLE</verification-ref>
    </M-EXAMPLE>
  </Modules>
  <ImplementationOrder>
    <Phase-1 name="Foundation" status="pending">
      <step-1 module="M-EXAMPLE" status="pending" verification="V-M-EXAMPLE">Implement example.</step-1>
    </Phase-1>
  </ImplementationOrder>
</DevelopmentPlan>`,
  );

  writeProjectFile(
    root,
    "docs/verification-plan.xml",
    `<VerificationPlan VERSION="0.1.0">
  <GlobalPolicy>
    <module-level-focus>Fast deterministic checks close to the module.</module-level-focus>
    <wave-level-focus>Checks only merged surfaces touched by a wave.</wave-level-focus>
    <phase-level-focus>Broader regression confidence.</phase-level-focus>
  </GlobalPolicy>
  <ModuleVerification>
    <V-M-EXAMPLE MODULE="M-EXAMPLE">
      <test-files>
        <file-1>src/example.test.ts</file-1>
      </test-files>
      <module-checks>
        <command-1>bun test src/example.test.ts</command-1>
      </module-checks>
      <scenarios>
        <scenario-1 kind="success">Primary success path returns ok.</scenario-1>
        <scenario-2 kind="failure">Invalid state is rejected before side effects.</scenario-2>
      </scenarios>
      <required-log-markers>
        <marker-1>[ExampleDomain][run][BLOCK_EXECUTE_FLOW]</marker-1>
      </required-log-markers>
      <required-trace-assertions>
        <assertion-1>Failure path must not emit the success marker.</assertion-1>
      </required-trace-assertions>
      <wave-follow-up>Run the merged example integration path.</wave-follow-up>
      <phase-follow-up>Run the full regression suite before phase completion.</phase-follow-up>
    </V-M-EXAMPLE>
  </ModuleVerification>
</VerificationPlan>`,
  );

  writeProjectFile(
    root,
    "docs/operational-packets.xml",
    `<OperationalPackets VERSION="0.1.0">
  <ExecutionPacketTemplate>
    <ExecutionPacket>
      <assumptions />
      <stop-conditions />
      <retry-budget>2</retry-budget>
      <checkpoint-fields />
    </ExecutionPacket>
  </ExecutionPacketTemplate>
  <GraphDeltaTemplate>
    <GraphDelta />
  </GraphDeltaTemplate>
  <VerificationDeltaTemplate>
    <VerificationDelta />
  </VerificationDeltaTemplate>
  <FailurePacketTemplate>
    <FailurePacket />
  </FailurePacketTemplate>
  <CheckpointReportTemplate>
    <CheckpointReport />
  </CheckpointReportTemplate>
</OperationalPackets>`,
  );
}

describe("lintGraceProject", () => {
  it("passes a well-formed current GRACE project", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "src/example.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Run the example flow.
//   SCOPE: Execute the happy path.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   run - Execute the example flow.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added example module]
// END_CHANGE_SUMMARY
//
// START_CONTRACT: run
//   PURPOSE: Run the example flow.
//   INPUTS: { none }
//   OUTPUTS: { string - flow status }
//   SIDE_EFFECTS: none
//   LINKS: M-EXAMPLE
// END_CONTRACT: run
export function run() {
  // START_BLOCK_EXECUTE_FLOW
  return "ok";
  // END_BLOCK_EXECUTE_FLOW
}
`,
    );

    const result = lintGraceProject(root);
    expect(result.issues).toHaveLength(0);
  });

  it("reports generic XML tags and semantic markup problems", () => {
    const root = createProject();

    writeProjectFile(
      root,
      "docs/knowledge-graph.xml",
      `<KnowledgeGraph>
  <Project NAME="Broken" VERSION="0.1.0">
    <Module ID="M-EXAMPLE">
      <verification-ref>V-M-EXAMPLE</verification-ref>
    </Module>
  </Project>
</KnowledgeGraph>`,
    );

    writeProjectFile(
      root,
      "docs/development-plan.xml",
      `<DevelopmentPlan VERSION="0.1.0">
  <Modules>
    <M-EXAMPLE NAME="Example" TYPE="CORE_LOGIC">
      <verification-ref>V-M-MISSING</verification-ref>
    </M-EXAMPLE>
  </Modules>
  <ImplementationOrder>
    <Phase number="1">
      <step order="1" module="M-EXAMPLE" verification="V-M-MISSING">Broken step.</step>
    </Phase>
  </ImplementationOrder>
</DevelopmentPlan>`,
    );

    writeProjectFile(root, "docs/verification-plan.xml", `<VerificationPlan VERSION="0.1.0" />`);

    writeProjectFile(
      root,
      "src/example.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Broken module.
// END_MODULE_CONTRACT
// START_MODULE_MAP
// END_MODULE_MAP
export function run() {
  // START_BLOCK_DUPLICATE
  return "ok";
  // END_BLOCK_OTHER
}
`,
    );

    const result = lintGraceProject(root);
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("xml.generic-module-tag");
    expect(codes).toContain("xml.generic-phase-tag");
    expect(codes).toContain("xml.generic-step-tag");
    expect(codes).toContain("markup.missing-change-summary");
    expect(codes).toContain("markup.empty-module-map");
    expect(codes).toContain("markup.mismatched-block-end");
    expect(codes).toContain("plan.missing-verification-entry");
  });

  it("enforces canonical grep-stable IDs, field labels, and block names", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "docs/knowledge-graph.xml",
      `<KnowledgeGraph>
  <Project NAME="Example" VERSION="0.1.0">
    <M-example NAME="Example" TYPE="CORE_LOGIC">
      <verification-ref>V-M-example</verification-ref>
      <annotations>
        <fn-run PURPOSE="Run the example flow" />
      </annotations>
      <CrossLink source="M-example" target="M-EXAMPLE" relation="reads-config" />
    </M-example>
  </Project>
</KnowledgeGraph>`,
    );

    writeProjectFile(
      root,
      "docs/development-plan.xml",
      `<DevelopmentPlan VERSION="0.1.0">
  <Modules>
    <M-EXAMPLE NAME="Example" TYPE="CORE_LOGIC" STATUS="planned">
      <verification-ref>V-M-EXAMPLE</verification-ref>
    </M-EXAMPLE>
  </Modules>
  <ImplementationOrder>
    <Phase-1 name="Foundation" status="pending">
      <step-1 module="M-example" status="pending" verification="V-M-example">Implement example.</step-1>
    </Phase-1>
  </ImplementationOrder>
</DevelopmentPlan>`,
    );

    writeProjectFile(
      root,
      "src/example.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Run the example flow.
//   SCOPE: Execute the happy path.
//   DEPENDS: none
//   LINKS_TO: M-EXAMPLE
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   run - Execute the example flow.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added example module]
// END_CHANGE_SUMMARY
//
// START_CONTRACT: run
//   PURPOSE: Run the example flow.
//   INPUTS: { none }
//   OUTPUT: { string - flow status }
//   SIDE_EFFECTS: none
//   LINKS: M-EXAMPLE
// END_CONTRACT: run
export function run() {
  // START_BLOCK_execute_flow
  return "ok";
  // END_BLOCK_execute_flow
}
`,
    );

    const result = lintGraceProject(root);
    const codes = result.issues.map((issue) => issue.code);

    expect(codes).toContain("xml.invalid-module-id");
    expect(codes).toContain("xml.invalid-verification-id");
    expect(codes).toContain("xml.invalid-crosslink-shape");
    expect(codes).toContain("plan.invalid-module-id");
    expect(codes).toContain("plan.invalid-verification-id");
    expect(codes).toContain("markup.unknown-module-contract-field");
    expect(codes).toContain("markup.unknown-function-contract-field");
    expect(codes).toContain("markup.invalid-block-name");
  });

  it("allows partial repositories when requested", () => {
    const root = createProject();
    writeProjectFile(root, "src/plain.ts", `export const value = 1;\n`);

    const result = lintGraceProject(root, { allowMissingDocs: true });
    expect(result.issues).toHaveLength(0);
  });

  it("treats test files as local-symbol maps instead of export surfaces", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "src/example.test.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Verify example behavior with deterministic test helpers.
//   SCOPE: Test fixtures and assertions for the example runtime.
//   DEPENDS: bun:test, M-EXAMPLE
//   LINKS: M-EXAMPLE
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   fixture state - In-memory state used across test cases.
//   createExampleContext - Builds a deterministic test context.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added deterministic example tests]
// END_CHANGE_SUMMARY

import { describe, expect, it } from "bun:test";

const fixtureState = { count: 1 };

function createExampleContext() {
  return fixtureState;
}

describe("example", () => {
  it("uses the helper", () => {
    expect(createExampleContext().count).toBe(1);
  });
});
`,
    );

    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.file === "src/example.test.ts")).toHaveLength(0);
  });

  it("treats barrel files as summary maps instead of exact export maps", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "src/barrel.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Barrel export for example runtime surfaces.
//   SCOPE: Re-export stable runtime symbols from child modules.
//   DEPENDS: ./example
//   LINKS: M-EXAMPLE
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   Re-exports all public runtime symbols from child modules.
//   example exports - Stable entry points for external consumers.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added example barrel]
// END_CHANGE_SUMMARY

export * from "./child";
`,
    );

    writeProjectFile(root, "src/child.ts", `export const alpha = 1;\nexport const beta = 2;\n`);

    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.file === "src/barrel.ts")).toHaveLength(0);
  });

  it("treats configure-style default-export files as config modules", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "src/tool.config.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Configure bundling options for the example application.
//   SCOPE: Default export of the build tool configuration.
//   DEPENDS: tool
//   LINKS: M-EXAMPLE
// END_MODULE_CONTRACT
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added config file]
// END_CHANGE_SUMMARY

export default {
  mode: "production",
};
`,
    );

    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.file === "src/tool.config.ts")).toHaveLength(0);
  });

  it("treats script-like files as local-symbol maps instead of export surfaces", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "scripts/smoke-runner.mjs",
      `// START_MODULE_CONTRACT
//   PURPOSE: Execute a smoke runner script for the example workspace.
//   SCOPE: Bootstrap setup, run checks, and print a report.
//   DEPENDS: node:fs
//   LINKS: M-EXAMPLE
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   main - Run the smoke workflow end to end.
//   runChecks - Execute deterministic smoke checks.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added smoke runner]
// END_CHANGE_SUMMARY

function runChecks() {
  return true;
}

async function main() {
  return runChecks();
}

await main();
`,
    );

    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.file === "scripts/smoke-runner.mjs")).toHaveLength(0);
  });

  it("supports explicit ROLE and MAP_MODE overrides", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "src/manual-role.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Manual role override example.
//   SCOPE: Demonstrate explicit local-symbol module map behavior.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
//   ROLE: TEST
//   MAP_MODE: LOCALS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   helper state - Internal helper state for assertions.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added explicit role example]
// END_CHANGE_SUMMARY

const helperState = 1;

export const exportedValue = helperState;
`,
    );

    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.file === "src/manual-role.ts")).toHaveLength(0);
  });

  it("uses the Python adapter to verify exact exports from __all__", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "src/example.py",
      `# START_MODULE_CONTRACT
#   PURPOSE: Python runtime example.
#   SCOPE: Expose explicit public helpers through __all__.
#   DEPENDS: none
#   LINKS: M-EXAMPLE
# END_MODULE_CONTRACT
#
# START_MODULE_MAP
#   run_example - Execute the example workflow.
#   ExampleService - Main example service.
# END_MODULE_MAP
#
# START_CHANGE_SUMMARY
#   LAST_CHANGE: [v0.1.0 - Added Python runtime example]
# END_CHANGE_SUMMARY

__all__ = ["run_example", "ExampleService"]

class ExampleService:
    pass


def run_example():
    return "ok"
`,
    );

    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.file === "src/example.py")).toHaveLength(0);
  });

  it("treats pytest-style Python files as tests with local-symbol maps", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "src/test_example.py",
      `# START_MODULE_CONTRACT
#   PURPOSE: Verify example behavior with pytest fixtures.
#   SCOPE: Test helpers and assertions for the Python runtime.
#   DEPENDS: pytest, M-EXAMPLE
#   LINKS: M-EXAMPLE
# END_MODULE_CONTRACT
#
# START_MODULE_MAP
#   fixture_state - Shared fixture data for tests.
#   build_context - Construct deterministic runtime inputs.
# END_MODULE_MAP
#
# START_CHANGE_SUMMARY
#   LAST_CHANGE: [v0.1.0 - Added Python test example]
# END_CHANGE_SUMMARY

import pytest

fixture_state = {"count": 1}


def build_context():
    return fixture_state


def test_example_flow():
    assert build_context()["count"] == 1
`,
    );

    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.file === "src/test_example.py")).toHaveLength(0);
  });

  it("infers Python __main__ modules as scripts", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "scripts/run_example.py",
      `# START_MODULE_CONTRACT
#   PURPOSE: Execute the Python smoke script.
#   SCOPE: Build inputs and run the example check.
#   DEPENDS: none
#   LINKS: M-EXAMPLE
# END_MODULE_CONTRACT
#
# START_MODULE_MAP
#   main - Run the smoke workflow.
#   build_input - Build deterministic script input.
# END_MODULE_MAP
#
# START_CHANGE_SUMMARY
#   LAST_CHANGE: [v0.1.0 - Added Python smoke script]
# END_CHANGE_SUMMARY

def build_input():
    return "ok"


def main():
    return build_input()


if __name__ == "__main__":
    main()
`,
    );

    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.file === "scripts/run_example.py")).toHaveLength(0);
  });

  it("recognizes Clojure-style semicolon markup comments", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "src/example.clj",
      `; START_MODULE_CONTRACT
;   PURPOSE: Clojure example runtime.
;   SCOPE: Demonstrate semicolon-prefixed GRACE markup.
;   DEPENDS: none
;   LINKS: M-EXAMPLE
; END_MODULE_CONTRACT
;
; START_MODULE_MAP
;   run-example - Execute the example workflow.
; END_MODULE_MAP
;
; START_CHANGE_SUMMARY
;   LAST_CHANGE: [v0.1.0 - Added Clojure example]
; END_CHANGE_SUMMARY
`,
    );

    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.file === "src/example.clj")).toHaveLength(0);
  });

  it("does not misclassify local export lists as barrel re-exports", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "src/local-export-list.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Expose a local export list from a runtime module.
//   SCOPE: Named local exports without barrel semantics.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   run - Execute the local runtime entry point.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added local export list example]
// END_CHANGE_SUMMARY

const run = () => "ok";

export { run };
`,
    );

    const result = lintGraceProject(root);
    expect(result.issues.filter((issue) => issue.file === "src/local-export-list.ts")).toHaveLength(0);
  });

  it("requires verification artifacts even when the repo only has base docs", () => {
    const root = createProject();
    writeBaseDocsWithoutVerification(root);

    writeProjectFile(
      root,
      "src/example.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Run the example flow.
//   SCOPE: Execute the happy path.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   run - Execute the example flow.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added example module]
// END_CHANGE_SUMMARY

export function run() {
  return "ok";
}
`,
    );

    const result = lintGraceProject(root);
    expect(result.issues.map((issue) => issue.code)).toContain("docs.missing-required-artifact");
  });

  it("requires verification artifacts when verification refs are present", () => {
    const root = createProject();

    writeProjectFile(
      root,
      "docs/knowledge-graph.xml",
      `<KnowledgeGraph>
  <Project NAME="Example" VERSION="0.1.0">
    <M-EXAMPLE NAME="Example" TYPE="CORE_LOGIC">
      <verification-ref>V-M-EXAMPLE</verification-ref>
    </M-EXAMPLE>
  </Project>
</KnowledgeGraph>`,
    );
    writeProjectFile(
      root,
      "docs/development-plan.xml",
      `<DevelopmentPlan VERSION="0.1.0">
  <Modules>
    <M-EXAMPLE NAME="Example" TYPE="CORE_LOGIC">
      <verification-ref>V-M-EXAMPLE</verification-ref>
    </M-EXAMPLE>
  </Modules>
</DevelopmentPlan>`,
    );

    const result = lintGraceProject(root);
    expect(result.issues.map((issue) => issue.code)).toContain("docs.missing-required-artifact");
  });

  it("rejects unknown keys in .grace-lint.json", () => {
    const root = createProject();
    writeBaseDocsWithoutVerification(root);
    writeProjectFile(root, ".grace-lint.json", JSON.stringify({ profile: "broken" }, null, 2));

    const result = lintGraceProject(root);
    expect(result.issues.map((issue) => issue.code)).toContain("config.unknown-key");
  });

  it("allows .grace-lint.json with only ignoredDirs", () => {
    const root = createProject();
    writeCurrentDocs(root);
    writeProjectFile(root, ".grace-lint.json", JSON.stringify({ ignoredDirs: ["tmp"] }, null, 2));

    const result = lintGraceProject(root);
    expect(result.issues).toHaveLength(0);
  });

  it("supports the autonomous readiness profile when packets and evidence are complete", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "src/example.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Run the example flow.
//   SCOPE: Execute the happy path.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   run - Execute the example flow.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added example module]
// END_CHANGE_SUMMARY
export function run() {
  console.info("[ExampleDomain][run][BLOCK_EXECUTE_FLOW] ok");
  // START_BLOCK_EXECUTE_FLOW
  return "ok";
  // END_BLOCK_EXECUTE_FLOW
}
`,
    );

    writeProjectFile(
      root,
      "src/example.test.ts",
      `import { expect, test } from "bun:test";
import { run } from "./example";

test("run", () => {
  expect(run()).toBe("ok");
});
`,
    );

    const result = lintGraceProject(root, { profile: "autonomous" });
    expect(result.issues).toHaveLength(0);
  });

  it("reports autonomous readiness gaps when verification metadata is too thin", () => {
    const root = createProject();

    writeProjectFile(
      root,
      "docs/knowledge-graph.xml",
      `<KnowledgeGraph>
  <Project NAME="Example" VERSION="0.1.0">
    <M-EXAMPLE NAME="Example" TYPE="CORE_LOGIC">
      <purpose>Run the example flow.</purpose>
      <path>src/example.ts</path>
    </M-EXAMPLE>
  </Project>
</KnowledgeGraph>`,
    );

    writeProjectFile(
      root,
      "docs/development-plan.xml",
      `<DevelopmentPlan VERSION="0.1.0">
  <Modules>
    <M-EXAMPLE NAME="Example" TYPE="CORE_LOGIC">
      <contract>
        <purpose>Run the example flow.</purpose>
      </contract>
    </M-EXAMPLE>
  </Modules>
  <ImplementationOrder>
    <Phase-1 name="Foundation" status="pending">
      <step-1 module="M-EXAMPLE" status="pending">Implement example.</step-1>
    </Phase-1>
  </ImplementationOrder>
</DevelopmentPlan>`,
    );

    writeProjectFile(
      root,
      "docs/verification-plan.xml",
      `<VerificationPlan VERSION="0.1.0">
  <ModuleVerification>
    <V-M-EXAMPLE MODULE="M-EXAMPLE">
      <test-files>
        <file-1>src/example.test.ts</file-1>
      </test-files>
    </V-M-EXAMPLE>
  </ModuleVerification>
</VerificationPlan>`,
    );

    const result = lintGraceProject(root, { profile: "autonomous" });
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("autonomy.missing-operational-packets");
    expect(codes).toContain("autonomy.missing-technology-artifact");
    expect(codes).toContain("autonomy.module-missing-implementation-files");
    expect(codes).toContain("autonomy.step-missing-verification");
    expect(codes).toContain("autonomy.verification-test-file-missing-on-disk");
    expect(codes).toContain("autonomy.verification-missing-module-checks");
    expect(codes).toContain("autonomy.verification-missing-scenarios");
    expect(codes).toContain("autonomy.verification-missing-observable-evidence");
  });

  it("does not accept required log markers that only appear in tests", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "src/example.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Run the example flow.
//   SCOPE: Execute the happy path.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   run - Execute the example flow.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added example module]
// END_CHANGE_SUMMARY
export function run() {
  // START_BLOCK_EXECUTE_FLOW
  return "ok";
  // END_BLOCK_EXECUTE_FLOW
}
`,
    );

    writeProjectFile(
      root,
      "src/example.test.ts",
      `import { expect, test } from "bun:test";

test("marker expectation only", () => {
  expect("[ExampleDomain][run][BLOCK_EXECUTE_FLOW]").toContain("BLOCK_EXECUTE_FLOW");
});
`,
    );

    const result = lintGraceProject(root, { profile: "autonomous" });
    expect(result.issues.map((issue) => issue.code)).toContain("autonomy.required-log-marker-not-found");
  });

  it("does not accept inert runtime string literals as marker evidence", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "src/example.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Run the example flow.
//   SCOPE: Execute the happy path.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   run - Execute the example flow.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added example module]
// END_CHANGE_SUMMARY
export function run() {
  const marker = "[ExampleDomain][run][BLOCK_EXECUTE_FLOW]";
  // START_BLOCK_EXECUTE_FLOW
  return marker;
  // END_BLOCK_EXECUTE_FLOW
}
`,
    );

    writeProjectFile(
      root,
      "src/example.test.ts",
      `import { expect, test } from "bun:test";
import { run } from "./example";

test("run", () => {
  expect(run()).toContain("BLOCK_EXECUTE_FLOW");
});
`,
    );

    const result = lintGraceProject(root, { profile: "autonomous" });
    expect(result.issues.map((issue) => issue.code)).toContain("autonomy.required-log-marker-not-found");
  });

  it("credits a required log marker referenced via a same-file constant that is actually passed to a logging call", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "src/example.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Run the example flow.
//   SCOPE: Execute the happy path.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   run - Execute the example flow.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added example module]
// END_CHANGE_SUMMARY
const marker = "[ExampleDomain][run][BLOCK_EXECUTE_FLOW]";

export function run() {
  // START_BLOCK_EXECUTE_FLOW
  console.info(marker + " ok");
  return "ok";
  // END_BLOCK_EXECUTE_FLOW
}
`,
    );

    writeProjectFile(
      root,
      "src/example.test.ts",
      `import { expect, test } from "bun:test";
import { run } from "./example";

test("run", () => {
  expect(run()).toBe("ok");
});
`,
    );

    const result = lintGraceProject(root, { profile: "autonomous" });
    expect(result.issues.map((issue) => issue.code)).not.toContain("autonomy.required-log-marker-not-found");
  });

  it("finds a required log-marker block that is nested inside a larger enclosing block", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "src/example.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Run the example flow.
//   SCOPE: Execute the happy path.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   run - Execute the example flow.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added example module]
// END_CHANGE_SUMMARY
export function run() {
  // START_BLOCK_APPLY_STATE
  console.info("[ExampleDomain][run][BLOCK_APPLY_STATE] ok");
  // START_BLOCK_EXECUTE_FLOW
  console.info("[ExampleDomain][run][BLOCK_EXECUTE_FLOW] ok");
  // END_BLOCK_EXECUTE_FLOW
  return "ok";
  // END_BLOCK_APPLY_STATE
}
`,
    );

    writeProjectFile(
      root,
      "src/example.test.ts",
      `import { expect, test } from "bun:test";
import { run } from "./example";

test("run", () => {
  expect(run()).toBe("ok");
});
`,
    );

    const result = lintGraceProject(root, { profile: "autonomous" });
    expect(result.issues.map((issue) => issue.code)).not.toContain("autonomy.required-log-marker-block-not-found");
  });

  it("explains lint issue codes through the CLI", () => {
    const guide = getLintIssueGuide("docs.missing-required-artifact");
    const explanation = formatLintExplanation("docs.missing-required-artifact");

    expect(guide.title).toBe("Missing Required GRACE Artifact");
    expect(guide.remediation.length).toBeGreaterThan(0);
    expect(explanation).toContain("Missing Required GRACE Artifact");
    expect(explanation).toContain("Remediation");
  });

  it("supports fail-on warnings for CI-oriented lint runs", () => {
    const root = createProject();
    writeCurrentDocs(root);

    writeProjectFile(
      root,
      "src/example.ts",
      `// START_MODULE_CONTRACT
//   PURPOSE: Run the example flow.
//   SCOPE: Execute the happy path.
//   DEPENDS: none
//   LINKS: M-EXAMPLE
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   run - Execute the example flow.
// END_MODULE_MAP
//
// START_CHANGE_SUMMARY
//   LAST_CHANGE: [v0.1.0 - Added example module]
// END_CHANGE_SUMMARY
export function run() {
  console.info("[ExampleDomain][run][BLOCK_EXECUTE_FLOW] ok");
  // START_BLOCK_EXECUTE_FLOW
  return "ok";
  // END_BLOCK_EXECUTE_FLOW
}
`,
    );

    writeProjectFile(root, "src/example.test.ts", `export const value = 1;\n`);
    writeProjectFile(
      root,
      "docs/verification-plan.xml",
      `<VerificationPlan VERSION="0.1.0">
  <ModuleVerification>
    <V-M-EXAMPLE MODULE="M-EXAMPLE">
      <test-files>
        <file-1>src/example.test.ts</file-1>
      </test-files>
      <module-checks>
        <command-1>bun test src/example.test.ts</command-1>
      </module-checks>
      <scenarios>
        <scenario-1 kind="success">Primary success path returns ok.</scenario-1>
      </scenarios>
      <required-log-markers>
        <marker-1>[ExampleDomain][run][BLOCK_EXECUTE_FLOW]</marker-1>
      </required-log-markers>
    </V-M-EXAMPLE>
  </ModuleVerification>
</VerificationPlan>`,
    );

    const repoRoot = path.resolve(import.meta.dir, "..");
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", "./src/grace.ts", "lint", "--path", root, "--profile", "autonomous", "--fail-on", "warnings"],
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(1);
    expect(Buffer.from(result.stdout).toString("utf8")).toContain("Warnings:");
  });
});

describe("monorepo CWD support", () => {
  it("autonomous profile does not produce false positive with CWD attribute", () => {
    const root = createProject();
    writeProjectFile(root, "AGENTS.md", "## AGENTS.md\n");
    writeProjectFile(root, "docs/technology.xml", "<Technology><stack>Bun</stack></Technology>");
    writeProjectFile(root, "docs/knowledge-graph.xml",
      `<KnowledgeGraph><ModuleMap><M-AUTH name='Auth' path='packages/auth' type='RUNTIME'/></ModuleMap></KnowledgeGraph>`);
    writeProjectFile(root, "docs/development-plan.xml",
      `<DevelopmentPlan><ImplementationOrder><Phase-1 name='Core'><step-1 module='M-AUTH'>Test</step-1></Phase-1></ImplementationOrder></DevelopmentPlan>`);
    writeProjectFile(root, "docs/verification-plan.xml",
      `<VerificationPlan VERSION="0.1.0">
  <ModuleVerification>
    <V-M-AUTH MODULE="M-AUTH" CWD="packages/auth">
      <test-files>
        <file-1>packages/auth/src/auth_test.dart</file-1>
      </test-files>
      <module-checks>
        <command-1>dart test src/auth_test.dart</command-1>
      </module-checks>
      <scenarios>
        <scenario-1 kind="success">Auth works.</scenario-1>
      </scenarios>
    </V-M-AUTH>
  </ModuleVerification>
</VerificationPlan>`);

    writeProjectFile(root, "packages/auth/src/auth_test.dart",
      "import 'package:test/test.dart';\nvoid main() { test('works', () {}); }");

    const result = lintGraceProject(root, { profile: "autonomous" });

    const falsePositives = result.issues.filter(
      (i) => i.code === "autonomy.verification-module-check-does-not-reference-test-file"
    );
    expect(falsePositives).toHaveLength(0);
  });

  it("produces warning when CWD is absent (proving CWD stripping is necessary)", () => {
    const root = createProject();
    writeProjectFile(root, "AGENTS.md", "## AGENTS.md\n");
    writeProjectFile(root, "docs/technology.xml", "<Technology><stack>Bun</stack></Technology>");
    writeProjectFile(root, "docs/knowledge-graph.xml",
      `<KnowledgeGraph><ModuleMap><M-AUTH name='Auth' path='packages/auth' type='RUNTIME'/></ModuleMap></KnowledgeGraph>`);
    writeProjectFile(root, "docs/development-plan.xml",
      `<DevelopmentPlan><ImplementationOrder><Phase-1 name='Core'><step-1 module='M-AUTH'>Test</step-1></Phase-1></ImplementationOrder></DevelopmentPlan>`);
    // Same fixture but WITHOUT CWD attribute
    writeProjectFile(root, "docs/verification-plan.xml",
      `<VerificationPlan VERSION="0.1.0">
  <ModuleVerification>
    <V-M-AUTH MODULE="M-AUTH">
      <test-files>
        <file-1>packages/auth/src/auth_test.dart</file-1>
      </test-files>
      <module-checks>
        <command-1>dart test src/auth_test.dart</command-1>
      </module-checks>
      <scenarios>
        <scenario-1 kind="success">Auth works.</scenario-1>
      </scenarios>
    </V-M-AUTH>
  </ModuleVerification>
</VerificationPlan>`);

    writeProjectFile(root, "packages/auth/src/auth_test.dart",
      "import 'package:test/test.dart';\nvoid main() { test('works', () {}); }");

    const result = lintGraceProject(root, { profile: "autonomous" });

    const falsePositives = result.issues.filter(
      (i) => i.code === "autonomy.verification-module-check-does-not-reference-test-file"
    );
    // Without CWD stripping, the full path does not match the module check
    expect(falsePositives.length).toBeGreaterThan(0);
  });

  it("handles CWD with trailing slash", () => {
    const root = createProject();
    writeProjectFile(root, "AGENTS.md", "## AGENTS.md\n");
    writeProjectFile(root, "docs/technology.xml", "<Technology><stack>Bun</stack></Technology>");
    writeProjectFile(root, "docs/knowledge-graph.xml",
      `<KnowledgeGraph><ModuleMap><M-AUTH name='Auth' path='packages/auth' type='RUNTIME'/></ModuleMap></KnowledgeGraph>`);
    writeProjectFile(root, "docs/development-plan.xml",
      `<DevelopmentPlan><ImplementationOrder><Phase-1 name='Core'><step-1 module='M-AUTH'>Test</step-1></Phase-1></ImplementationOrder></DevelopmentPlan>`);
    // CWD with trailing slash
    writeProjectFile(root, "docs/verification-plan.xml",
      `<VerificationPlan VERSION="0.1.0">
  <ModuleVerification>
    <V-M-AUTH MODULE="M-AUTH" CWD="packages/auth/">
      <test-files>
        <file-1>packages/auth/src/auth_test.dart</file-1>
      </test-files>
      <module-checks>
        <command-1>dart test src/auth_test.dart</command-1>
      </module-checks>
      <scenarios>
        <scenario-1 kind="success">Auth works.</scenario-1>
      </scenarios>
    </V-M-AUTH>
  </ModuleVerification>
</VerificationPlan>`);

    writeProjectFile(root, "packages/auth/src/auth_test.dart",
      "import 'package:test/test.dart';\nvoid main() { test('works', () {}); }");

    const result = lintGraceProject(root, { profile: "autonomous" });

    const falsePositives = result.issues.filter(
      (i) => i.code === "autonomy.verification-module-check-does-not-reference-test-file"
    );
    // Trailing slash should be normalized; CWD stripping still works
    expect(falsePositives).toHaveLength(0);
  });
});
