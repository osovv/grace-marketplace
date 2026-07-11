import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { getModuleName, getModulePath, getModuleType, resolveModule } from "./core";
import { checkModuleCheckReferences } from "../verification/check-references";
import { hasRuntimeMarkerEvidence, parseMarkerBlockName } from "../project-utils";
import type { GraceArtifactIndex, ModuleHealthIssue, ModuleHealthRecord, ModuleRecord } from "./types";

function isLikelyTestPath(relativePath: string) {
  return /(^|\/)(__tests__|tests)(\/|$)|(^|\/)(test_[^/]+|[^/]+\.(test|spec)\.[^.]+)$/.test(relativePath);
}

function pushIssue(
  issues: ModuleHealthIssue[],
  severity: ModuleHealthIssue["severity"],
  code: string,
  message: string,
  remediation: string,
) {
  issues.push({ severity, code, message, remediation });
}

function implementationTexts(index: GraceArtifactIndex, moduleRecord: ModuleRecord) {
  return moduleRecord.localFiles
    .filter((file) => !isLikelyTestPath(file.path))
    .flatMap((file) => {
      const absolutePath = path.join(index.root, file.path);
      if (!existsSync(absolutePath)) {
        return [];
      }

      return [{
        path: file.path,
        text: readFileSync(absolutePath, "utf8"),
      }];
    });
}

function buildNextAction(moduleRecord: ModuleRecord, blockers: ModuleHealthIssue[], warnings: ModuleHealthIssue[]) {
  if (blockers.some((issue) => issue.code.startsWith("health.missing-plan") || issue.code.startsWith("health.missing-graph"))) {
    return `Run $grace-plan to repair shared artifacts for ${moduleRecord.id}.`;
  }

  if (blockers.some((issue) => issue.code.startsWith("health.missing-verification") || issue.code.startsWith("health.verification-"))) {
    return `Run $grace-verification to strengthen verification for ${moduleRecord.id}.`;
  }

  if (blockers.some((issue) => issue.code.startsWith("health.missing-implementation"))) {
    return `Run $grace-execute or $grace-multiagent-execute for ${moduleRecord.id}.`;
  }

  if (blockers.some((issue) => issue.code.startsWith("health.step-missing-verification"))) {
    return `Add missing verification refs for ${moduleRecord.id} in docs/development-plan.xml.`;
  }

  if (blockers.some((issue) => issue.code.startsWith("health.required-log-marker"))) {
    return `Align runtime evidence and semantic blocks for ${moduleRecord.id} with docs/verification-plan.xml.`;
  }

  if (blockers.length > 0) {
    return `Fix the recorded blockers for ${moduleRecord.id} before calling it healthy.`;
  }

  if (warnings.length > 0) {
    return `Review warnings and tighten follow-up evidence for ${moduleRecord.id}.`;
  }

  return `Module ${moduleRecord.id} is healthy.`;
}

export function buildModuleHealth(index: GraceArtifactIndex, moduleRecord: ModuleRecord): ModuleHealthRecord {
  const blockers: ModuleHealthIssue[] = [];
  const warnings: ModuleHealthIssue[] = [];
  const runtimeTexts = implementationTexts(index, moduleRecord);
  const implementationFiles = moduleRecord.localFiles.filter((file) => !isLikelyTestPath(file.path)).map((file) => file.path);
  const governedTestFiles = moduleRecord.localFiles.filter((file) => isLikelyTestPath(file.path)).map((file) => file.path);
  const verificationTestFiles = Array.from(new Set(moduleRecord.verifications.flatMap((entry) => entry.testFiles))).sort();

  if (!moduleRecord.plan) {
    pushIssue(
      blockers,
      "error",
      "health.missing-plan-record",
      `Module ${moduleRecord.id} is missing a development-plan entry.`,
      `Add or refresh ${moduleRecord.id} in docs/development-plan.xml via $grace-plan or $grace-refresh.`,
    );
  }

  if (!moduleRecord.graph) {
    pushIssue(
      blockers,
      "error",
      "health.missing-graph-record",
      `Module ${moduleRecord.id} is missing a knowledge-graph entry.`,
      `Add or refresh ${moduleRecord.id} in docs/knowledge-graph.xml via $grace-plan or $grace-refresh.`,
    );
  }

  if (moduleRecord.verifications.length === 0) {
    pushIssue(
      blockers,
      "error",
      "health.missing-verification",
      `Module ${moduleRecord.id} has no V-M verification entry.`,
      `Run $grace-verification and add a V-M entry for ${moduleRecord.id}.`,
    );
  }

  if (implementationFiles.length === 0) {
    pushIssue(
      blockers,
      "error",
      "health.missing-implementation-files",
      `Module ${moduleRecord.id} has no linked non-test governed files.`,
      `Implement ${moduleRecord.id} through $grace-execute or link its runtime files with LINKS in MODULE_CONTRACT.`,
    );
  }

  if (moduleRecord.steps.some((step) => !step.verificationId)) {
    pushIssue(
      blockers,
      "error",
      "health.step-missing-verification",
      `At least one plan step for ${moduleRecord.id} is missing an explicit verification reference.`,
      `Add verification="V-M-..." to each step for ${moduleRecord.id} in docs/development-plan.xml.`,
    );
  }

  if (moduleRecord.steps.length === 0) {
    pushIssue(
      warnings,
      "warning",
      "health.missing-plan-steps",
      `Module ${moduleRecord.id} has no implementation-order step.`,
      `Add ${moduleRecord.id} to docs/development-plan.xml implementation order so execution can schedule it explicitly.`,
    );
  }

  if (verificationTestFiles.length === 0) {
    pushIssue(
      blockers,
      "error",
      "health.verification-missing-test-files",
      `Verification for ${moduleRecord.id} does not list any test files.`,
      `Add test-files entries for ${moduleRecord.id} in docs/verification-plan.xml.`,
    );
  }

  for (const entry of moduleRecord.verifications) {
    if (entry.moduleChecks.length === 0) {
      pushIssue(
        blockers,
        "error",
        "health.verification-missing-module-checks",
        `${entry.id} has no module-local verification commands.`,
        `Add module-checks for ${entry.id} in docs/verification-plan.xml.`,
      );
    }

    if (entry.scenarios.length === 0) {
      pushIssue(
        blockers,
        "error",
        "health.verification-missing-scenarios",
        `${entry.id} has no success or failure scenarios.`,
        `Add scenarios to ${entry.id} in docs/verification-plan.xml.`,
      );
    }

    if (entry.requiredLogMarkers.length === 0 && entry.requiredTraceAssertions.length === 0) {
      pushIssue(
        blockers,
        "error",
        "health.verification-missing-evidence",
        `${entry.id} has no required log markers or trace assertions.`,
        `Add observable evidence requirements to ${entry.id} in docs/verification-plan.xml.`,
      );
    }

    // Fast-path: use shared utility for batch check — skip per-file comparison when all pass
    const allChecksReferenceTestFiles = checkModuleCheckReferences(entry.testFiles, entry.moduleChecks, entry.cwd);

    for (const testFile of entry.testFiles) {
      const absolutePath = path.isAbsolute(testFile) ? testFile : path.join(index.root, testFile);
      if (!existsSync(absolutePath)) {
        pushIssue(
          blockers,
          "error",
          "health.verification-test-file-missing-on-disk",
          `${entry.id} references ${testFile}, but that file does not exist.`,
          `Create ${testFile} or update ${entry.id} to point at the real test file.`,
        );
      }

      const governedTestRecord = index.files.find((file) => file.path === testFile);
      if (governedTestRecord && !governedTestRecord.linkedModuleIds.includes(moduleRecord.id)) {
        pushIssue(
          blockers,
          "error",
          "health.verification-test-file-unlinked-module",
          `${entry.id} references governed test file ${testFile}, but that file is not linked to ${moduleRecord.id}.`,
          `Add ${moduleRecord.id} to LINKS in ${testFile} or point ${entry.id} at a test file that belongs to the module.`,
        );
      }

      // CWD-aware normalization (per-file warning only when batch check failed)
      if (!allChecksReferenceTestFiles) {
        let normalized = testFile;
        const normalizedCwd = entry.cwd ? entry.cwd.replace(/\/+$/, "") : entry.cwd;
        if (normalizedCwd && normalizedCwd !== "." && normalizedCwd !== "" && testFile.startsWith(normalizedCwd + "/")) {
          normalized = testFile.slice(normalizedCwd.length + 1);
        }
        const dir = path.dirname(normalized);
        if (!entry.moduleChecks.some((check) => check.includes(normalized) || check.includes(dir))) {
          pushIssue(
            warnings,
            "warning",
            "health.verification-module-check-does-not-reference-test-file",
            `${entry.id} does not have a module-check that clearly targets ${testFile}.`,
            `Make at least one module-check reference ${testFile} or its containing directory.`,
          );
        }
      }
    }

    for (const marker of entry.requiredLogMarkers) {
      if (!runtimeTexts.some(({ text }) => hasRuntimeMarkerEvidence(text, marker))) {
        pushIssue(
          blockers,
          "error",
          "health.required-log-marker-not-found",
          `${entry.id} requires marker ${marker}, but it was not found in linked runtime files.`,
          `Emit ${marker} from the runtime implementation for ${moduleRecord.id} or update the verification entry.`,
        );
      }

      const requiredBlock = parseMarkerBlockName(marker);
      if (requiredBlock && !moduleRecord.localFiles.some((file) => !isLikelyTestPath(file.path) && file.blocks.some((block) => block.name === requiredBlock))) {
        pushIssue(
          blockers,
          "error",
          "health.required-log-marker-block-not-found",
          `${entry.id} requires marker ${marker}, but no linked runtime file exposes BLOCK_${requiredBlock}.`,
          `Add BLOCK_${requiredBlock} to the runtime implementation or update the required marker to match the real semantic block.`,
        );
      }
    }

    if (!entry.waveFollowUp) {
      pushIssue(
        warnings,
        "warning",
        "health.verification-missing-wave-follow-up",
        `${entry.id} has no wave-level follow-up check.`,
        `Add wave-follow-up to ${entry.id} when module-local checks are not enough after merge.`,
      );
    }

    if (!entry.phaseFollowUp) {
      pushIssue(
        warnings,
        "warning",
        "health.verification-missing-phase-follow-up",
        `${entry.id} has no phase-level follow-up check.`,
        `Add phase-follow-up to ${entry.id} before calling the wider phase complete.`,
      );
    }
  }

  const pendingSteps = moduleRecord.steps.filter((step) => step.stepStatus !== "done").length;
  const completedSteps = moduleRecord.steps.filter((step) => step.stepStatus === "done").length;
  const state = blockers.length > 0 ? "blocked" : warnings.length > 0 ? "attention" : "ready";

  return {
    moduleId: moduleRecord.id,
    name: getModuleName(moduleRecord),
    type: getModuleType(moduleRecord),
    path: getModulePath(moduleRecord),
    state,
    verificationIds: moduleRecord.verifications.map((entry) => entry.id).sort(),
    implementationFiles: implementationFiles.sort(),
    governedTestFiles: governedTestFiles.sort(),
    verificationTestFiles,
    blockers,
    warnings,
    summary: {
      hasPlan: Boolean(moduleRecord.plan),
      hasGraph: Boolean(moduleRecord.graph),
      hasImplementationFiles: implementationFiles.length > 0,
      hasVerification: moduleRecord.verifications.length > 0,
      hasVerificationTests: verificationTestFiles.length > 0,
      pendingSteps,
      completedSteps,
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
