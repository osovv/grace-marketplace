import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { getModuleImplementationFiles, getModuleName, getModulePath, getModuleType, resolveModule } from "./core";
import { checkModuleCheckReferences } from "../verification/check-references";
import type { GraceArtifactIndex, ModuleHealthIssue, ModuleHealthRecord, ModuleRecord } from "./types";

function isLikelyTestPath(relativePath: string) {
  return /(^|\/)(__tests__|tests)(\/|$)|(^|\/)(test_[^/]+|[^/]+\.(test|spec)\.[^.]+)$/.test(relativePath);
}

function parseMarkerBlockName(marker: string) {
  const match = marker.match(/\[([^\]]+)\]\s*$/);
  return match && match[1].startsWith("BLOCK_") ? match[1].slice("BLOCK_".length) : undefined;
}

function looksLikeEvidenceEmission(line: string) {
  return /(console\.|logger\.|tracer\.|trace\(|emit\(|\.(info|warn|error|debug|trace)\s*\()/.test(line);
}

function pushIssue(issues: ModuleHealthIssue[], severity: ModuleHealthIssue["severity"], code: string, message: string, remediation: string) {
  issues.push({ severity, code, message, remediation });
}

function implementationTexts(index: GraceArtifactIndex, moduleRecord: ModuleRecord) {
  return getModuleImplementationFiles(moduleRecord).flatMap((file) => {
    const absolutePath = path.join(index.root, file.path);
    if (!existsSync(absolutePath)) {
      return [];
    }
    return [{ path: file.path, text: readFileSync(absolutePath, "utf8") }];
  });
}

function buildNextAction(moduleRecord: ModuleRecord, blockers: ModuleHealthIssue[], warnings: ModuleHealthIssue[]) {
  if (blockers.some((issue) => issue.code.startsWith("health.missing-verification"))) {
    return `Run $grace-verification to add or repair ${moduleRecord.id}'s V-M-* entry in .grace/verification.`;
  }
  if (blockers.some((issue) => issue.code.startsWith("health.missing-implementation"))) {
    return `Run $grace-execute for a planned change or link runtime files to ${moduleRecord.id}.`;
  }
  if (blockers.some((issue) => issue.code.startsWith("health.required-log-marker"))) {
    return `Align runtime evidence and semantic blocks for ${moduleRecord.id} with .grace/verification.`;
  }
  if (blockers.length > 0) {
    return `Fix the recorded blockers for ${moduleRecord.id} before calling it healthy.`;
  }
  if (warnings.length > 0) {
    return `Review warnings and tighten verification evidence for ${moduleRecord.id}.`;
  }
  return `Module ${moduleRecord.id} is healthy.`;
}

export function buildModuleHealth(index: GraceArtifactIndex, moduleRecord: ModuleRecord): ModuleHealthRecord {
  const blockers: ModuleHealthIssue[] = [];
  const warnings: ModuleHealthIssue[] = [];
  const runtimeTexts = implementationTexts(index, moduleRecord);
  const implementationFiles = getModuleImplementationFiles(moduleRecord).map((file) => file.path).sort();
  const governedTestFiles = moduleRecord.localFiles.filter((file) => isLikelyTestPath(file.path)).map((file) => file.path).sort();
  const verificationTestFiles = Array.from(new Set(moduleRecord.verifications.flatMap((entry) => entry.testFiles))).sort();

  if (moduleRecord.verifications.length === 0) {
    pushIssue(blockers, "error", "health.missing-verification", `Module ${moduleRecord.id} has no V-M-* verification entry.`, `Add V-${moduleRecord.id} under .grace/verification.`);
  }
  if (implementationFiles.length === 0) {
    pushIssue(blockers, "error", "health.missing-implementation-files", `Module ${moduleRecord.id} has no linked non-test governed files.`, `Implement ${moduleRecord.id} or link runtime files with LINKS in START_MODULE_CONTRACT.`);
  }

  for (const entry of moduleRecord.verifications) {
    if (entry.moduleChecks.length === 0) {
      pushIssue(blockers, "error", "health.verification-missing-commands", `${entry.id} has no command evidence.`, `Add Command entries to ${entry.id} in .grace/verification.`);
    }
    if (entry.scenarios.length === 0) {
      pushIssue(blockers, "error", "health.verification-missing-scenarios", `${entry.id} has no scenarios.`, `Add Scenario entries to ${entry.id} in .grace/verification.`);
    }
    if (entry.requiredLogMarkers.length === 0 && entry.requiredTraceAssertions.length === 0) {
      pushIssue(warnings, "warning", "health.verification-missing-evidence", `${entry.id} has no markers or trace assertions.`, `Add Marker or TraceAssertion entries to ${entry.id}.`);
    }

    const allChecksReferenceTestFiles = checkModuleCheckReferences(entry.testFiles, entry.moduleChecks, entry.cwd);
    for (const testFile of entry.testFiles) {
      const absolutePath = path.isAbsolute(testFile) ? testFile : path.join(index.root, testFile);
      if (!existsSync(absolutePath)) {
        pushIssue(blockers, "error", "health.verification-test-file-missing-on-disk", `${entry.id} references ${testFile}, but that file does not exist.`, `Create ${testFile} or update ${entry.id}.`);
      }
      if (!allChecksReferenceTestFiles) {
        const dir = path.dirname(testFile);
        if (!entry.moduleChecks.some((check) => check.includes(testFile) || check.includes(dir))) {
          pushIssue(warnings, "warning", "health.verification-command-does-not-reference-test-file", `${entry.id} does not have a command that clearly targets ${testFile}.`, `Make at least one command reference ${testFile} or ${dir}.`);
        }
      }
    }

    for (const marker of entry.requiredLogMarkers) {
      if (!runtimeTexts.some(({ text }) => text.split("\n").some((line) => line.includes(marker) && !/^\s*(\/\/|#|--|;+|\*)/.test(line) && looksLikeEvidenceEmission(line)))) {
        pushIssue(blockers, "error", "health.required-log-marker-not-found", `${entry.id} requires marker ${marker}, but it was not found in linked runtime files.`, `Emit ${marker} from ${moduleRecord.id} runtime code or update the verification entry.`);
      }
      const requiredBlock = parseMarkerBlockName(marker);
      if (requiredBlock && !moduleRecord.localFiles.some((file) => !isLikelyTestPath(file.path) && file.blocks.some((block) => block.name === requiredBlock))) {
        pushIssue(blockers, "error", "health.required-log-marker-block-not-found", `${entry.id} requires marker ${marker}, but no linked runtime file exposes BLOCK_${requiredBlock}.`, `Add BLOCK_${requiredBlock} or update the marker.`);
      }
    }
  }

  const state = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "attention" : "ready";
  return {
    moduleId: moduleRecord.id,
    name: getModuleName(moduleRecord),
    type: getModuleType(moduleRecord),
    path: getModulePath(moduleRecord),
    state,
    verificationIds: moduleRecord.verifications.map((entry) => entry.id).sort(),
    implementationFiles,
    governedTestFiles,
    verificationTestFiles,
    blockers,
    warnings,
    summary: {
      hasGraph: Boolean(moduleRecord.graph),
      hasImplementationFiles: implementationFiles.length > 0,
      hasVerification: moduleRecord.verifications.length > 0,
      hasVerificationTests: verificationTestFiles.length > 0,
      autonomyReady: blockers.length === 0,
    },
    nextAction: buildNextAction(moduleRecord, blockers, warnings),
  };
}

export function collectModuleHealth(index: GraceArtifactIndex) {
  return index.modules.map((moduleRecord) => buildModuleHealth(index, moduleRecord)).sort((left, right) => left.moduleId.localeCompare(right.moduleId));
}

export function resolveModuleHealth(index: GraceArtifactIndex, target: string) {
  return buildModuleHealth(index, resolveModule(index, target));
}
