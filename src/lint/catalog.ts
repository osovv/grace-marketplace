import type { LintIssue } from "./types";

type LintIssueGuide = {
  code: string;
  title: string;
  explanation: string;
  remediation: string[];
};

const EXACT_GUIDES: Record<string, Omit<LintIssueGuide, "code">> = {
  "config.invalid-json": {
    title: "Invalid Lint Config JSON",
    explanation: "The repository-level .grace-lint.json file could not be parsed as JSON.",
    remediation: ["Fix the JSON syntax in .grace-lint.json.", "If the file is accidental, remove it."],
  },
  "config.invalid-shape": {
    title: "Invalid Lint Config Shape",
    explanation: ".grace-lint.json must be a JSON object.",
    remediation: ["Replace the file contents with a JSON object.", "Keep only supported keys like ignoredDirs."],
  },
  "config.unknown-key": {
    title: "Unknown Lint Config Key",
    explanation: ".grace-lint.json contains a key the CLI does not understand.",
    remediation: ["Remove unsupported keys from .grace-lint.json.", "Use only documented keys such as ignoredDirs."],
  },
  "docs.missing-required-artifact": {
    title: "Missing Required GRACE Artifact",
    explanation: "A current GRACE project needs the required shared XML artifacts before the CLI can reason over architecture and verification.",
    remediation: ["Create the missing artifact via $grace-init, $grace-plan, or $grace-verification.", "Use --allow-missing-docs only for partial repositories that are not yet full GRACE projects."],
  },
  "packets.missing-template-section": {
    title: "Incomplete Operational Packets Template",
    explanation: "docs/operational-packets.xml is missing one of the canonical packet template sections.",
    remediation: ["Refresh docs/operational-packets.xml from the current grace-init template.", "Restore the missing template section instead of inventing a custom packet shape."],
  },
  "analysis.adapter-failed": {
    title: "Language Adapter Failed",
    explanation: "The file-level export analysis adapter threw an error, so lint fell back to structural checks only.",
    remediation: ["Inspect the file for unusual syntax or unsupported language features.", "Simplify the export surface or improve the adapter if this language pattern should be supported."],
  },
  "autonomy.missing-operational-packets": {
    title: "Missing Operational Packets Artifact",
    explanation: "Long autonomous execution requires a shared packet contract so workers, reviewers, and fix loops can hand off state safely.",
    remediation: ["Add docs/operational-packets.xml using the current grace-init template.", "Define execution packets, deltas, failure packets, and checkpoint reports before autonomous runs."],
  },
  "autonomy.missing-technology-artifact": {
    title: "Missing Technology Artifact",
    explanation: "Autonomous execution should be anchored to an explicit project stack and execution policy, not inferred ad hoc.",
    remediation: ["Add docs/technology.xml to define runtime, tooling, and project constraints.", "Name the preferred stack before asking agents to execute long trajectories."],
  },
  "autonomy.packets-missing-checkpoint-template": {
    title: "Missing Checkpoint Packet Template",
    explanation: "Autonomous runs should leave behind a canonical checkpoint report so failures and handoffs stay observable.",
    remediation: ["Add CheckpointReportTemplate to docs/operational-packets.xml.", "Refresh the packets artifact from the latest grace-init template if needed."],
  },
  "autonomy.module-missing-verification": {
    title: "Module Missing Verification Entry",
    explanation: "Each shared module needs a matching V-M entry before autonomous execution can treat it as governed and observable.",
    remediation: ["Add a V-M entry for the module in docs/verification-plan.xml.", "Run $grace-verification for the affected module or phase."],
  },
  "autonomy.module-missing-implementation-files": {
    title: "Module Missing Implementation Files",
    explanation: "A module cannot be autonomy-ready if it has no linked non-test governed runtime files.",
    remediation: ["Implement the module via $grace-execute or $grace-multiagent-execute.", "Link the runtime file to the module through LINKS in MODULE_CONTRACT."],
  },
  "autonomy.step-missing-verification": {
    title: "Plan Step Missing Verification Ref",
    explanation: "Execution steps should name the verification gate they depend on so agents do not improvise success criteria.",
    remediation: ["Add verification=\"V-M-...\" to the step in docs/development-plan.xml.", "Make sure the referenced V-M entry exists in docs/verification-plan.xml."],
  },
  "autonomy.verification-missing-test-files": {
    title: "Verification Missing Test Files",
    explanation: "A verification entry without test files is not actionable for worker loops or CI.",
    remediation: ["Add one or more test-files entries to the V-M record.", "Point them at real module-local or module-owned tests."],
  },
  "autonomy.verification-missing-module-checks": {
    title: "Verification Missing Module Checks",
    explanation: "A V-M entry needs executable commands so workers and CI can run the intended checks directly.",
    remediation: ["Add module-checks commands to the V-M entry.", "Prefer narrow module-local commands over whole-repo commands for worker loops."],
  },
  "autonomy.verification-missing-scenarios": {
    title: "Verification Missing Scenarios",
    explanation: "Autonomous execution needs named success and failure behavior, not only file paths or commands.",
    remediation: ["Add success and failure scenarios to the V-M entry.", "Describe what observable behavior proves the module is correct."],
  },
  "autonomy.verification-missing-observable-evidence": {
    title: "Verification Missing Observable Evidence",
    explanation: "A V-M entry should require log markers or trace assertions so failures can be debugged without hidden reasoning.",
    remediation: ["Add required-log-markers or required-trace-assertions to the V-M entry.", "Keep markers stable and map them back to semantic blocks."],
  },
  "autonomy.verification-test-file-missing-on-disk": {
    title: "Verification References Missing Test File",
    explanation: "The verification plan references a test file that does not currently exist on disk.",
    remediation: ["Create the test file or update the V-M entry to the real path.", "Keep docs/verification-plan.xml synchronized with the codebase."],
  },
  "autonomy.verification-test-file-unlinked-module": {
    title: "Verification Test File Not Linked To Module",
    explanation: "A governed test file should belong to the same module it verifies so agents can navigate ownership precisely.",
    remediation: ["Add the module ID to LINKS in the test file MODULE_CONTRACT.", "Or update the V-M entry to point at a test file that belongs to the module."],
  },
  "autonomy.verification-module-check-does-not-reference-test-file": {
    title: "Module Check Does Not Reference Test File",
    explanation: "The verification commands do not clearly mention the declared test file or its containing directory.",
    remediation: ["Make at least one module-check reference the test file path or its directory.", "Keep the commands and declared test-files aligned."],
  },
  "autonomy.required-log-marker-not-found": {
    title: "Required Log Marker Not Found",
    explanation: "The verification plan requires a runtime marker that does not appear in linked implementation code.",
    remediation: ["Emit the marker from the runtime implementation.", "Or update the V-M entry so the required marker matches the real runtime evidence."],
  },
  "autonomy.required-log-marker-block-not-found": {
    title: "Required Marker Does Not Map To Semantic Block",
    explanation: "The required log marker names a BLOCK_* suffix that does not exist in the linked runtime files.",
    remediation: ["Add the matching BLOCK_* anchor to the implementation.", "Or update the marker in docs/verification-plan.xml to the correct block name."],
  },
  "autonomy.failed-to-index-project": {
    title: "Autonomy Gate Could Not Index Project",
    explanation: "The autonomy profile could not build a coherent GRACE artifact index from the project.",
    remediation: ["Fix malformed or missing GRACE artifacts first.", "Run grace lint without the autonomous profile to resolve structural issues before retrying."],
  },
};

const PREFIX_GUIDES: Array<{ prefix: string; title: string; explanation: string; remediation: string[] }> = [
  {
    prefix: "project.",
    title: "GRACE 4 Project Detection Issue",
    explanation: "The CLI could not identify a valid GRACE 4 .grace project state, or it detected legacy GRACE 3 artifacts instead.",
    remediation: ["Run $grace-init for a new GRACE 4 project or $grace-migrate for legacy GRACE 3 projects.", "Do not rely on dual-mode docs/*.xml validation."],
  },
  {
    prefix: "artifact.",
    title: "GRACE 4 Artifact Grammar Issue",
    explanation: "A .grace XML artifact violates the GRACE 4 root, metadata, version, or semantic-anchor grammar.",
    remediation: ["Use approved GRACE 4 root tags with graceVersion=\"4.0\".", "Keep semantic anchors as XML tags, never attributes."],
  },
  {
    prefix: "change.",
    title: "GRACE 4 Change Lifecycle Issue",
    explanation: "A change spec or plan has an invalid status, wrapper shape, or active/archive location for the GRACE 4 lifecycle.",
    remediation: ["Keep draft and approved bundles under .grace/changes/active.", "Move applied, rejected, cancelled, or superseded bundles to archive with matching statuses."],
  },
  {
    prefix: "context.",
    title: "GRACE 4 Context Artifact Issue",
    explanation: "A required .grace/context artifact is missing, has the wrong root, or has invalid applicability metadata.",
    remediation: ["Create all five context artifacts from the GRACE 4 init template.", "If deployment or UX is not applicable, include a concrete reason."],
  },
  {
    prefix: "projection.",
    title: "GRACE 4 Projection Integrity Issue",
    explanation: "Graph or verification index routes do not match the logical projection built from .grace documents.",
    remediation: ["Synchronize GD-* and VD-* index ownership with document wrappers.", "Ensure every M-* has deterministic V-M-* coverage."],
  },
  {
    prefix: "assertion.",
    title: "GRACE 4 Assertion Failure",
    explanation: "A BaselineAssertions or TargetAssertions entry failed against current graph, verification, or filesystem state.",
    remediation: ["Reconcile the current state with the approved plan assertions.", "If the approved plan is stale, supersede and replan rather than editing it silently."],
  },
  {
    prefix: "scope.",
    title: "GRACE 4 Scope Conflict",
    explanation: "Active change scopes overlap in durable or observed write surfaces.",
    remediation: ["Treat durable overlap as a planning warning.", "Do not run overlapping observed writes in parallel-safe mode."],
  },
  {
    prefix: "xml.generic-",
    title: "Generic XML Tag Used Instead Of Unique GRACE Tag",
    explanation: "GRACE shared artifacts rely on unique ID-based XML tags such as M-*, Phase-*, and step-* so agents can reference them deterministically.",
    remediation: ["Replace the generic XML tag with the corresponding unique GRACE tag.", "Keep the unique tag and any verification-ref/module references synchronized across shared artifacts."],
  },
  {
    prefix: "markup.",
    title: "Semantic Markup Integrity Issue",
    explanation: "The governed file markup is incomplete, mismatched, or out of sync with the intended export or local symbol surface.",
    remediation: ["Repair the MODULE_CONTRACT, MODULE_MAP, CHANGE_SUMMARY, or semantic block markers in the file.", "Keep file-local markup aligned with the actual code surface and semantic block boundaries."],
  },
  {
    prefix: "graph.",
    title: "Knowledge Graph Drift",
    explanation: "The knowledge graph references modules or verification entries that do not align with the development plan or verification plan.",
    remediation: ["Refresh docs/knowledge-graph.xml so shared references match the plan and verification artifacts.", "Run $grace-refresh if the drift came from real code changes."],
  },
  {
    prefix: "plan.",
    title: "Development Plan Drift",
    explanation: "The development plan is missing modules, verification refs, or step metadata needed for governed execution.",
    remediation: ["Update docs/development-plan.xml so module IDs, steps, and verification refs match the project reality.", "Use $grace-plan or $grace-refresh when the architecture changed."],
  },
  {
    prefix: "analysis.",
    title: "Export Surface Analysis Warning",
    explanation: "The language adapter could not prove the exact export surface or detected a shape that weakens precise linting.",
    remediation: ["Prefer clearer export declarations or explicit ROLE/MAP_MODE overrides when necessary.", "Treat heuristic or wildcard-export warnings as cues to simplify or document the file surface."],
  },
  {
    prefix: "autonomy.",
    title: "Autonomy Readiness Gate Failure",
    explanation: "The project is missing one of the packet, verification, or evidence guarantees needed for long autonomous execution.",
    remediation: ["Strengthen docs/verification-plan.xml, docs/technology.xml, or docs/operational-packets.xml.", "Re-run grace lint --profile autonomous after making the project observable and packet-driven."],
  },
];

function toTitleFromCode(code: string) {
  return code
    .split(/[.-]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getLintIssueGuide(code: string): LintIssueGuide {
  const exact = EXACT_GUIDES[code];
  if (exact) {
    return { code, ...exact };
  }

  const prefixGuide = PREFIX_GUIDES.find((guide) => code.startsWith(guide.prefix));
  if (prefixGuide) {
    return { code, ...prefixGuide };
  }

  return {
    code,
    title: toTitleFromCode(code),
    explanation: "This issue code does not yet have a dedicated explanation entry, but it still signals drift or missing governance metadata.",
    remediation: ["Inspect the issue message and the referenced file.", "Repair the smallest relevant GRACE artifact or governed file section before rerunning lint."],
  };
}

export function withLintIssueGuide(issue: LintIssue): LintIssue {
  const guide = getLintIssueGuide(issue.code);
  return {
    ...issue,
    title: guide.title,
    explanation: guide.explanation,
    remediation: guide.remediation,
  };
}

export function formatLintExplanation(code: string) {
  const guide = getLintIssueGuide(code);
  return [
    "GRACE Lint Issue Guide",
    "======================",
    `Code: ${guide.code}`,
    `Title: ${guide.title}`,
    "",
    "Explanation",
    guide.explanation,
    "",
    "Remediation",
    ...guide.remediation.map((item) => `- ${item}`),
  ].join("\n");
}
