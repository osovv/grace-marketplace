import { getModuleDepends, getModuleName, getModulePath, getModuleType, getModuleVerificationIds } from "./core";
import type { FileMarkupRecord, ModuleHealthRecord, ModuleMatch, ModuleRecord, ModuleVerificationRecord, VerificationMatch } from "./types";

function formatList(label: string, items: string[]) {
  return items.length === 0 ? [`${label}: none`] : [label, ...items.map((item) => `- ${item}`)];
}

function formatFieldMap(fields: Record<string, string>) {
  const entries = Object.entries(fields);
  return entries.length === 0 ? ["- none"] : entries.map(([key, value]) => `- ${key}: ${value}`);
}

function renderTable(rows: string[][], headers: string[]) {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)));
  const formatRow = (row: string[]) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  return [formatRow(headers), widths.map((width) => "-".repeat(width)).join("  "), ...rows.map((row) => formatRow(row))].join("\n");
}

function formatVerificationDetails(entry: ModuleVerificationRecord) {
  const lines = [`Verification ${entry.id}`, `- Module: ${entry.moduleId ?? "unknown"}`, `- Priority: ${entry.priority ?? "n/a"}`];
  lines.push(...formatList("Test Files", entry.testFiles));
  lines.push(...formatList("Commands", entry.moduleChecks));
  if (entry.scenarios.length > 0) {
    lines.push("Scenarios", ...entry.scenarios.map((scenario) => `- ${scenario.tag}: ${scenario.text}`));
  }
  lines.push(...formatList("Required Log Markers", entry.requiredLogMarkers));
  lines.push(...formatList("Required Trace Assertions", entry.requiredTraceAssertions));
  return lines;
}

function formatModuleHealthIssues(label: string, issues: ModuleHealthRecord["blockers"]) {
  return issues.length === 0 ? [label, "- none"] : [label, ...issues.map((issue) => `- ${issue.code}: ${issue.message} Fix: ${issue.remediation}`)];
}

export function formatModuleFindTable(matches: ModuleMatch[]) {
  if (matches.length === 0) {
    return "No modules found.";
  }
  const rows = matches.map(({ module }) => [module.id, getModuleName(module), getModuleType(module) ?? "-", getModulePath(module) ?? "-", getModuleVerificationIds(module).join(", ") || "-"]);
  return renderTable(rows, ["ID", "NAME", "TYPE", "PATH", "VERIFICATION"]);
}

export function formatVerificationFindTable(matches: VerificationMatch[]) {
  if (matches.length === 0) {
    return "No verification entries found.";
  }
  const rows = matches.map(({ verification, module }) => [verification.id, verification.moduleId ?? "-", module ? getModuleName(module) : "-", String(verification.testFiles.length), String(verification.scenarios.length)]);
  return renderTable(rows, ["ID", "MODULE", "MODULE_NAME", "TESTS", "SCENARIOS"]);
}

export function formatModuleHealthTable(records: ModuleHealthRecord[]) {
  if (records.length === 0) {
    return "No module health records available.";
  }
  const rows = records.map((record) => [record.moduleId, record.state, record.implementationFiles.length.toString(), record.verificationIds.length.toString(), record.verificationTestFiles.length.toString(), record.summary.autonomyReady ? "yes" : "no"]);
  return renderTable(rows, ["ID", "STATE", "IMPL", "VERIFY", "TESTS", "AUTO_READY"]);
}

export function formatVerificationText(match: VerificationMatch) {
  const lines = ["GRACE Verification", "==================", `ID: ${match.verification.id}`, `Module: ${match.verification.moduleId ?? "unknown"}`, `Module Name: ${match.module ? getModuleName(match.module) : "unknown"}`];
  if (match.module) {
    lines.push(`Module Path: ${getModulePath(match.module) ?? "n/a"}`);
  }
  lines.push(...formatVerificationDetails(match.verification));
  return lines.join("\n");
}

export function formatModuleHealthText(record: ModuleHealthRecord) {
  const lines = [
    "GRACE Module Health",
    "===================",
    `ID: ${record.moduleId}`,
    `Name: ${record.name}`,
    `Type: ${record.type ?? "unknown"}`,
    `Path: ${record.path ?? "n/a"}`,
    `State: ${record.state}`,
    `Verification IDs: ${record.verificationIds.join(", ") || "none"}`,
    `Implementation Files: ${record.implementationFiles.join(", ") || "none"}`,
    `Governed Test Files: ${record.governedTestFiles.join(", ") || "none"}`,
    `Verification Test Files: ${record.verificationTestFiles.join(", ") || "none"}`,
    "",
    "Summary",
    `- Graph Record: ${record.summary.hasGraph ? "yes" : "no"}`,
    `- Implementation Files: ${record.summary.hasImplementationFiles ? "yes" : "no"}`,
    `- Verification Entry: ${record.summary.hasVerification ? "yes" : "no"}`,
    `- Verification Tests: ${record.summary.hasVerificationTests ? "yes" : "no"}`,
    `- Autonomy Ready: ${record.summary.autonomyReady ? "yes" : "no"}`,
    "",
  ];
  lines.push(...formatModuleHealthIssues("Blockers", record.blockers), "", ...formatModuleHealthIssues("Warnings", record.warnings), "", "Suggested Next Action", `- ${record.nextAction}`);
  return lines.join("\n");
}

export function formatModuleText(moduleRecord: ModuleRecord, options: { withVerification: boolean; health?: ModuleHealthRecord | null }) {
  const lines = ["GRACE Module", "============", `ID: ${moduleRecord.id}`, `Name: ${getModuleName(moduleRecord)}`, `Type: ${getModuleType(moduleRecord) ?? "unknown"}`, `Graph Path: ${getModulePath(moduleRecord) ?? "n/a"}`, `Verification: ${getModuleVerificationIds(moduleRecord).join(", ") || "none"}`, `Dependencies: ${getModuleDepends(moduleRecord).join(", ") || "none"}`, "", "Graph Projection", `- Owner: ${moduleRecord.graph.owner}`, `- Text: ${moduleRecord.graph.text || "n/a"}`];
  lines.push("", "Linked Files", ...(moduleRecord.localFiles.length > 0 ? moduleRecord.localFiles.map((file) => `- ${file.path}`) : ["- none"]));
  if (options.withVerification) {
    lines.push("", "Verification");
    if (moduleRecord.verifications.length === 0) {
      lines.push("- none");
    } else {
      for (const entry of moduleRecord.verifications) {
        lines.push(...formatVerificationDetails(entry), "");
      }
      if (lines.at(-1) === "") lines.pop();
    }
  }
  if (options.health) {
    lines.push("", "Health", `- State: ${options.health.state}`, `- Implementation Files: ${options.health.implementationFiles.join(", ") || "none"}`, `- Verification Test Files: ${options.health.verificationTestFiles.join(", ") || "none"}`, `- Blockers: ${options.health.blockers.length}`, `- Warnings: ${options.health.warnings.length}`, `- Next Action: ${options.health.nextAction}`);
  }
  return lines.join("\n");
}

export function formatFileText(fileRecord: FileMarkupRecord, options: { includeContracts: boolean; includeBlocks: boolean }) {
  const lines = ["GRACE File", "==========", `Path: ${fileRecord.path}`, `Linked Modules: ${fileRecord.linkedModuleIds.join(", ") || "none"}`, `Contracts: ${fileRecord.contracts.length}`, `Blocks: ${fileRecord.blocks.length}`, "", "MODULE_CONTRACT", ...formatFieldMap(fileRecord.moduleContract?.fields ?? {}), "", "MODULE_MAP", ...(fileRecord.moduleMap.length > 0 ? fileRecord.moduleMap.map((item) => `- ${item.label}`) : ["- none"]), "", "CHANGE_SUMMARY", ...formatFieldMap(fileRecord.changeSummary?.fields ?? {})];
  if (options.includeContracts) {
    lines.push("", "Contracts");
    if (fileRecord.contracts.length === 0) lines.push("- none");
    for (const contract of fileRecord.contracts) {
      lines.push(`Contract ${contract.name} (lines ${contract.startLine}-${contract.endLine})`, ...formatFieldMap(contract.fields));
    }
  }
  if (options.includeBlocks) {
    lines.push("", "Blocks", ...(fileRecord.blocks.length > 0 ? fileRecord.blocks.map((block) => `- ${block.name} (lines ${block.startLine}-${block.endLine})`) : ["- none"]));
  }
  return lines.join("\n");
}
