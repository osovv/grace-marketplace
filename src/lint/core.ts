import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { loadGraceLintConfig } from "./config";
import { getLanguageAdapter } from "./adapters/base";
import { withLintIssueGuide } from "./catalog";
import { loadGraceArtifactIndex } from "../query/core";
import { checkModuleCheckReferences } from "../verification/check-references";
import {
  collectCodeFiles,
  findSection,
  hasGraceMarkers,
  lineNumberAt,
  normalizeRelative,
  readTextIfExists,
  stripCommentPrefix,
} from "../project-utils";
import type {
  LanguageAnalysis,
  LintIssue,
  LintOptions,
  LintProfile,
  LintResult,
  MapMode,
  MarkupSection,
  ModuleContractInfo,
  ModuleMapItem,
  ModuleRole,
} from "./types";

const REQUIRED_DOCS = ["docs/knowledge-graph.xml", "docs/development-plan.xml", "docs/verification-plan.xml"] as const;

const OPTIONAL_PACKET_DOC = "docs/operational-packets.xml";
const LINT_CONFIG_FILE = ".grace-lint.json";
const MODULE_ID_REGEX = /^M-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const VERIFICATION_ID_REGEX = /^V-M-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const BLOCK_NAME_REGEX = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/;
const MODULE_CONTRACT_FIELDS = new Set(["PURPOSE", "SCOPE", "DEPENDS", "LINKS", "ROLE", "MAP_MODE"]);
const FUNCTION_CONTRACT_FIELDS = new Set(["PURPOSE", "INPUTS", "OUTPUTS", "SIDE_EFFECTS", "LINKS"]);
const ANNOTATION_TAG_PREFIXES = ["fn-", "type-", "class-", "export-", "const-"];

const UNIQUE_TAG_ANTI_PATTERNS = [
  {
    code: "xml.generic-module-tag",
    regex: /<\/?Module(?=[\s>])/g,
    message: 'Use unique module tags like `<M-AUTH>` instead of generic `<Module ID="...">`.',
  },
  {
    code: "xml.generic-phase-tag",
    regex: /<\/?Phase(?=[\s>])/g,
    message: 'Use unique phase tags like `<Phase-1>` instead of generic `<Phase number="...">`.',
  },
  {
    code: "xml.generic-flow-tag",
    regex: /<\/?Flow(?=[\s>])/g,
    message: 'Use unique flow tags like `<DF-LOGIN>` instead of generic `<Flow ID="...">`.',
  },
  {
    code: "xml.generic-use-case-tag",
    regex: /<\/?UseCase(?=[\s>])/g,
    message: 'Use unique use-case tags like `<UC-001>` instead of generic `<UseCase ID="...">`.',
  },
  {
    code: "xml.generic-step-tag",
    regex: /<\/?step(?=[\s>])/g,
    message: 'Use unique step tags like `<step-1>` instead of generic `<step order="...">`.',
  },
  {
    code: "xml.generic-export-tag",
    regex: /<\/?export(?=[\s>])/g,
    message: 'Use unique export tags like `<export-run>` instead of generic `<export name="...">`.',
  },
  {
    code: "xml.generic-function-tag",
    regex: /<\/?function(?=[\s>])/g,
    message: 'Use unique function tags like `<fn-run>` instead of generic `<function name="...">`.',
  },
  {
    code: "xml.generic-type-tag",
    regex: /<\/?type(?=[\s>])/g,
    message: 'Use unique type tags like `<type-Result>` instead of generic `<type name="...">`.',
  },
];

const VALID_ROLES = new Set<ModuleRole>(["RUNTIME", "TEST", "BARREL", "CONFIG", "TYPES", "SCRIPT"]);
const VALID_MAP_MODES = new Set<MapMode>(["EXPORTS", "LOCALS", "SUMMARY", "NONE"]);
const TEXT_FORMAT_OPTIONS = new Set(["text", "json"]);

function addAutonomyIssue(
  result: LintResult,
  severity: LintIssue["severity"],
  code: string,
  file: string,
  message: string,
  line?: number,
) {
  addIssue(result, {
    severity,
    code,
    file,
    line,
    message,
  });
}

function addIssue(result: LintResult, issue: LintIssue) {
  result.issues.push(issue);
}

function ensureSectionPair(
  result: LintResult,
  relativePath: string,
  text: string,
  startMarker: string,
  endMarker: string,
  code: string,
  message: string,
) {
  const startIndex = text.indexOf(startMarker);
  const endIndex = text.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1) {
    addIssue(result, {
      severity: "error",
      code,
      file: relativePath,
      line: startIndex === -1 ? undefined : lineNumberAt(text, startIndex),
      message,
    });
    return null;
  }

  if (startIndex > endIndex) {
    addIssue(result, {
      severity: "error",
      code,
      file: relativePath,
      line: lineNumberAt(text, endIndex),
      message: `${message} Found the end marker before the start marker.`,
    });
    return null;
  }

  return {
    content: text.slice(startIndex + startMarker.length, endIndex),
    startLine: lineNumberAt(text, startIndex),
    endLine: lineNumberAt(text, endIndex),
  } satisfies MarkupSection;
}

function lintScopedMarkers(
  result: LintResult,
  relativePath: string,
  text: string,
  startRegex: RegExp,
  endRegex: RegExp,
  kind: "block" | "contract",
) {
  const lines = text.split("\n");
  const stack: Array<{ name: string; line: number }> = [];
  const seen = new Set<string>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const startMatch = line.match(startRegex);
    const endMatch = line.match(endRegex);

    if (startMatch?.[1]) {
      const name = startMatch[1];
      if (kind === "block") {
        if (!BLOCK_NAME_REGEX.test(name)) {
          addIssue(result, {
            severity: "error",
            code: "markup.invalid-block-name",
            file: relativePath,
            line: index + 1,
            message: `Semantic block name \`${name}\` must use uppercase snake form after START_BLOCK_.`,
          });
        }

        if (seen.has(name)) {
          addIssue(result, {
            severity: "error",
            code: "markup.duplicate-block-name",
            file: relativePath,
            line: index + 1,
            message: `Semantic block name \`${name}\` is duplicated in this file.`,
          });
        }

        seen.add(name);
      }

      stack.push({ name, line: index + 1 });
    }

    if (endMatch?.[1]) {
      const name = endMatch[1];
      if (kind === "block" && !BLOCK_NAME_REGEX.test(name)) {
        addIssue(result, {
          severity: "error",
          code: "markup.invalid-block-name",
          file: relativePath,
          line: index + 1,
          message: `Semantic block name \`${name}\` must use uppercase snake form after END_BLOCK_.`,
        });
      }

      const active = stack[stack.length - 1];

      if (!active) {
        addIssue(result, {
          severity: "error",
          code: kind === "block" ? "markup.unmatched-block-end" : "markup.unmatched-contract-end",
          file: relativePath,
          line: index + 1,
          message: `Found an unmatched END marker for \`${name}\`.`,
        });
        continue;
      }

      if (active.name !== name) {
        addIssue(result, {
          severity: "error",
          code: kind === "block" ? "markup.mismatched-block-end" : "markup.mismatched-contract-end",
          file: relativePath,
          line: index + 1,
          message: `Expected END marker for \`${active.name}\`, found \`${name}\` instead.`,
        });
        continue;
      }

      stack.pop();
    }
  }

  for (const active of stack) {
    addIssue(result, {
      severity: "error",
      code: kind === "block" ? "markup.missing-block-end" : "markup.missing-contract-end",
      file: relativePath,
      line: active.line,
      message: `Missing END marker for \`${active.name}\`.`,
    });
  }
}

function parseModuleContract(section: MarkupSection) {
  const fields: Record<string, string> = {};

  for (const line of section.content.split("\n")) {
    const cleaned = stripCommentPrefix(line).trim();
    if (!cleaned) {
      continue;
    }

    const match = cleaned.match(/^([A-Z_]+):\s*(.+)$/);
    if (!match) {
      continue;
    }

    fields[match[1]] = match[2].trim();
  }

  const roleValue = fields.ROLE?.toUpperCase() as ModuleRole | undefined;
  const mapModeValue = fields.MAP_MODE?.toUpperCase() as MapMode | undefined;

  return {
    fields,
    purpose: fields.PURPOSE,
    scope: fields.SCOPE,
    depends: fields.DEPENDS,
    links: fields.LINKS,
    role: roleValue && VALID_ROLES.has(roleValue) ? roleValue : undefined,
    mapMode: mapModeValue && VALID_MAP_MODES.has(mapModeValue) ? mapModeValue : undefined,
  } satisfies ModuleContractInfo;
}

function lintContractFieldLabels(
  result: LintResult,
  relativePath: string,
  section: MarkupSection,
  allowedFields: Set<string>,
  code: string,
  label: string,
) {
  const lines = section.content.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const cleaned = stripCommentPrefix(lines[index]).trim();
    if (!cleaned) {
      continue;
    }

    const match = cleaned.match(/^([A-Za-z_]+):\s*/);
    if (!match) {
      continue;
    }

    if (!allowedFields.has(match[1])) {
      addIssue(result, {
        severity: "error",
        code,
        file: relativePath,
        line: section.startLine + index,
        message: `${label} uses non-canonical field \`${match[1]}\`. Use exact GRACE field labels only.`,
      });
    }
  }
}

function collectExactContractSections(text: string) {
  return Array.from(text.matchAll(/START_CONTRACT:\s*([A-Za-z0-9_$.-]+)([\s\S]*?)END_CONTRACT:\s*\1/g)).map((match) => ({
    content: match[2] ?? "",
    startLine: match.index === undefined ? 1 : lineNumberAt(text, match.index),
    endLine: match.index === undefined ? 1 : lineNumberAt(text, match.index + match[0].length),
  })) satisfies MarkupSection[];
}

function toSymbolName(label: string) {
  return /^(?:default|[A-Za-z_$][\w$]*)$/.test(label) ? label : undefined;
}

function parseModuleMapItems(section: MarkupSection) {
  const items: ModuleMapItem[] = [];
  const lines = section.content.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const cleaned = stripCommentPrefix(lines[index]).trim();
    if (!cleaned) {
      continue;
    }

    const match = cleaned.match(/^(.+?)\s+-\s+.+$/);
    const label = (match?.[1] ?? cleaned).trim();
    items.push({
      label,
      symbolName: toSymbolName(label),
      line: section.startLine + index,
    });
  }

  return items;
}

function isBarrelLike(analysis: LanguageAnalysis) {
  return analysis.hasWildcardReExport || (analysis.directReExportCount > 0 && analysis.localImplementationCount <= 2);
}

function isAggregationSurface(analysis: LanguageAnalysis) {
  return isBarrelLike(analysis) || (analysis.directReExportCount >= 2 && analysis.exports.size >= 8);
}

function inferRole(contract: ModuleContractInfo | null, analysis: LanguageAnalysis | null): ModuleRole {
  if (contract?.role) {
    return contract.role;
  }

  if (analysis?.usesTestFramework) {
    return "TEST";
  }

  const contractText = `${contract?.purpose ?? ""} ${contract?.scope ?? ""}`.toLowerCase();
  const mentionsTypes = /\b(type definition|type definitions|interface|interfaces|types?)\b/.test(contractText);
  const mentionsConfig = /\b(config|configure|configuration|settings?)\b/.test(contractText);
  const mentionsBarrel = /\b(barrel|re-export|re-exports|aggregate|entry point|bindings?)\b/.test(contractText);
  const mentionsScript = /\b(script|scripts|cli|command|commands|bootstrap|smoke|runner|execute|execution|setup|check)\b/.test(contractText);

  if (analysis && analysis.valueExports.size === 0 && analysis.typeExports.size > 0) {
    return "TYPES";
  }

  if (analysis && (mentionsBarrel || isBarrelLike(analysis))) {
    return "BARREL";
  }

  if (!analysis && mentionsTypes) {
    return "TYPES";
  }

  if (analysis && mentionsTypes && analysis.valueExports.size === 0) {
    return "TYPES";
  }

  if (analysis && mentionsConfig && analysis.hasDefaultExport && analysis.valueExports.size <= 1) {
    return "CONFIG";
  }

  if (analysis?.hasMainEntrypoint) {
    return "SCRIPT";
  }

  if (analysis && mentionsScript && analysis.exports.size === 0) {
    return "SCRIPT";
  }

  if (mentionsConfig && !analysis) {
    return "CONFIG";
  }

  if (!analysis && mentionsScript) {
    return "SCRIPT";
  }

  return "RUNTIME";
}

function inferMapMode(
  contract: ModuleContractInfo | null,
  role: ModuleRole,
  items: ModuleMapItem[],
  analysis: LanguageAnalysis | null,
) {
  if (contract?.mapMode) {
    return contract.mapMode;
  }

  if (role === "TEST") {
    return "LOCALS" as const;
  }

  if (role === "SCRIPT") {
    return "LOCALS" as const;
  }

  if (role === "BARREL") {
    return "SUMMARY" as const;
  }

  if (role === "CONFIG") {
    return "NONE" as const;
  }

  if (role === "TYPES") {
    return "EXPORTS" as const;
  }

  if (items.some((item) => !item.symbolName)) {
    return "SUMMARY" as const;
  }

  if (analysis && isAggregationSurface(analysis) && items.length > 0 && analysis.exports.size > items.length * 2) {
    return "SUMMARY" as const;
  }

  return "EXPORTS" as const;
}

function lintUniqueTags(result: LintResult, relativePath: string, text: string) {
  for (const antiPattern of UNIQUE_TAG_ANTI_PATTERNS) {
    for (const match of text.matchAll(antiPattern.regex)) {
      addIssue(result, {
        severity: "error",
        code: antiPattern.code,
        file: relativePath,
        line: match.index === undefined ? undefined : lineNumberAt(text, match.index),
        message: antiPattern.message,
      });
    }
  }
}

function extractModuleIds(text: string) {
  return new Set(Array.from(text.matchAll(/<(M-[A-Za-z0-9-]+)(?=[\s>])/g), (match) => match[1]));
}

function extractVerificationIds(text: string) {
  return new Set(Array.from(text.matchAll(/<(V-M-[A-Za-z0-9-]+)(?=[\s>])/g), (match) => match[1]));
}

function extractVerificationRefs(text: string) {
  return Array.from(text.matchAll(/<verification-ref>\s*([^<\s]+)\s*<\/verification-ref>/g)).map((match) => ({
    value: match[1],
    line: match.index === undefined ? undefined : lineNumberAt(text, match.index),
  }));
}

function lintCanonicalXmlAnchors(result: LintResult, relativePath: string, text: string) {
  for (const match of text.matchAll(/<([A-Za-z][A-Za-z0-9-]*)(?=[\s>])/g)) {
    const tagName = match[1];
    const line = match.index === undefined ? undefined : lineNumberAt(text, match.index);

    if (tagName.startsWith("M-") && !MODULE_ID_REGEX.test(tagName)) {
      addIssue(result, {
        severity: "error",
        code: "xml.invalid-module-id",
        file: relativePath,
        line,
        message: `Module tag \`${tagName}\` must use exact M-<UPPER-KEBAB> form.`,
      });
    }

    if (tagName.startsWith("V-M-") && !VERIFICATION_ID_REGEX.test(tagName)) {
      addIssue(result, {
        severity: "error",
        code: "xml.invalid-verification-id",
        file: relativePath,
        line,
        message: `Verification tag \`${tagName}\` must use exact V-M-<UPPER-KEBAB> form.`,
      });
    }

    if (tagName === "CrossLink") {
      const endIndex = match.index === undefined ? -1 : text.indexOf(">", match.index);
      const tagText = endIndex === -1 || match.index === undefined ? "" : text.slice(match.index, endIndex + 1);
      const fromMatch = tagText.match(/\sfrom="([^"]+)"/);
      const toMatch = tagText.match(/\sto="([^"]+)"/);
      const relationMatch = tagText.match(/\srelation="([^"]+)"/);
      const hasAlternateAttrs = /\s(source|target)=/.test(tagText);

      if (!fromMatch || !toMatch || !relationMatch || hasAlternateAttrs) {
        addIssue(result, {
          severity: "error",
          code: "xml.invalid-crosslink-shape",
          file: relativePath,
          line,
          message: "CrossLink tags must use exact `from`, `to`, and `relation` attributes without alternate names.",
        });
      }

      if (fromMatch && !MODULE_ID_REGEX.test(fromMatch[1])) {
        addIssue(result, {
          severity: "error",
          code: "xml.invalid-module-id",
          file: relativePath,
          line,
          message: `CrossLink from=\"${fromMatch[1]}\" must use exact M-<UPPER-KEBAB> form.`,
        });
      }

      if (toMatch && !MODULE_ID_REGEX.test(toMatch[1])) {
        addIssue(result, {
          severity: "error",
          code: "xml.invalid-module-id",
          file: relativePath,
          line,
          message: `CrossLink to=\"${toMatch[1]}\" must use exact M-<UPPER-KEBAB> form.`,
        });
      }
    }

    if (ANNOTATION_TAG_PREFIXES.some((prefix) => tagName.startsWith(prefix))) {
      const prefix = ANNOTATION_TAG_PREFIXES.find((candidate) => tagName.startsWith(candidate));
      const suffix = prefix ? tagName.slice(prefix.length) : "";
      if (!suffix || /\s/.test(suffix)) {
        addIssue(result, {
          severity: "error",
          code: "xml.invalid-annotation-tag",
          file: relativePath,
          line,
          message: `Annotation tag \`${tagName}\` must keep the canonical prefix and a non-empty suffix.`,
        });
      }
    }
  }

  for (const ref of extractVerificationRefs(text)) {
    if (!VERIFICATION_ID_REGEX.test(ref.value)) {
      addIssue(result, {
        severity: "error",
        code: "xml.invalid-verification-id",
        file: relativePath,
        line: ref.line,
        message: `Verification reference \`${ref.value}\` must use exact V-M-<UPPER-KEBAB> form.`,
      });
    }
  }
}

function extractStepRefs(text: string) {
  return Array.from(text.matchAll(/<(step-[A-Za-z0-9-]+)([^>]*)>/g), (match) => {
    const attrs = match[2] ?? "";
    const moduleMatch = attrs.match(/module="([^"]+)"/);
    const verificationMatch = attrs.match(/verification="([^"]+)"/);
    return {
      stepTag: match[1],
      moduleId: moduleMatch?.[1] ?? null,
      verificationId: verificationMatch?.[1] ?? null,
      line: match.index === undefined ? undefined : lineNumberAt(text, match.index),
    };
  });
}

function lintRequiredPacketSections(result: LintResult, relativePath: string, text: string) {
  const requiredTags = [
    "ExecutionPacketTemplate",
    "GraphDeltaTemplate",
    "VerificationDeltaTemplate",
    "FailurePacketTemplate",
  ];

  for (const tagName of requiredTags) {
    const pattern = new RegExp(`<${tagName}(?=[\\s>])`);
    if (!pattern.test(text)) {
      addIssue(result, {
        severity: "error",
        code: "packets.missing-template-section",
        file: relativePath,
        message: `Operational packet reference is missing <${tagName}>.`,
      });
    }
  }
}

function lintAutonomousReadiness(
  result: LintResult,
  root: string,
  docs: Record<string, string | null>,
  operationalPackets: string | null,
  ignoredDirs: string[],
) {
  const isLikelyTestPath = (relativePath: string) => /(^|\/)(__tests__|tests)(\/|$)|(^|\/)(test_[^/]+|[^/]+\.(test|spec)\.[^.]+)$/.test(relativePath);
  const looksLikeEvidenceEmission = (line: string) => /(console\.|logger\.|tracer\.|trace\(|emit\(|\.(info|warn|error|debug|trace)\s*\()/.test(line);
  const isEvidenceLine = (line: string) => !/^\s*(\/\/|#|--|;+|\*)/.test(line) && looksLikeEvidenceEmission(line);
  const parseMarkerBlockName = (marker: string) => {
    const match = marker.match(/\[([^\]]+)\]\s*$/);
    if (!match) {
      return undefined;
    }

    return match[1].startsWith("BLOCK_") ? match[1].slice("BLOCK_".length) : undefined;
  };
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Finds a same-file identifier assigned exactly the marker string (e.g. `static let x = "[Module][fn][BLOCK_X]"`
  // or `const x = "..."`), so a marker interpolated into a log call via that identifier can still be credited as
  // real runtime evidence — not just markers repeated as a literal at the call site.
  const findConstantNameForMarker = (text: string, marker: string) => {
    const pattern = new RegExp(
      `([A-Za-z_$][A-Za-z0-9_$]*)\\s*(?::\\s*[^=\\n]+)?(?<![=!<>])=(?!=)\\s*(['"\`])${escapeRegExp(marker)}\\2`,
    );
    return text.match(pattern)?.[1];
  };
  const lineHasRuntimeMarker = (text: string, marker: string) => {
    const lines = text.split("\n");
    if (lines.some((line) => line.includes(marker) && isEvidenceLine(line))) {
      return true;
    }

    // Fall back to a same-file constant that is genuinely referenced from an emission-shaped line — this is
    // what lets `log.info("\(markerConstant) ...")`-style call sites count, without crediting a constant that
    // is merely declared (or returned/compared) but never actually passed to anything log-shaped.
    const constantName = findConstantNameForMarker(text, marker);
    if (!constantName) {
      return false;
    }
    const nameBoundary = new RegExp(`\\b${escapeRegExp(constantName)}\\b`);
    return lines.some((line) => nameBoundary.test(line) && isEvidenceLine(line));
  };

  if (!operationalPackets) {
    addAutonomyIssue(
      result,
      "error",
      "autonomy.missing-operational-packets",
      OPTIONAL_PACKET_DOC,
      "Autonomous execution requires docs/operational-packets.xml so controller, worker, and failure handoffs have a shared packet shape.",
    );
  } else {
    const packetRequirements = [
      {
        pattern: /<CheckpointReportTemplate(?=[\s>])/, code: "autonomy.packets-missing-checkpoint-template",
        message: "Autonomous execution packets should include a CheckpointReportTemplate for visible step handoff.",
      },
      {
        pattern: /<assumptions(?=[\s>])/, code: "autonomy.packets-missing-assumptions",
        message: "Execution packets should record assumptions so future agents know what was accepted as stable context.",
      },
      {
        pattern: /<stop-conditions(?=[\s>])/, code: "autonomy.packets-missing-stop-conditions",
        message: "Execution packets should define stop-conditions so long runs halt instead of drifting silently.",
      },
      {
        pattern: /<retry-budget(?=[\s>])/, code: "autonomy.packets-missing-retry-budget",
        message: "Execution packets should define a retry-budget for bounded fix loops.",
      },
      {
        pattern: /<checkpoint-fields(?=[\s>])/, code: "autonomy.packets-missing-checkpoint-fields",
        message: "Execution packets should define checkpoint-fields for assumptions, commands, evidence, and next action.",
      },
    ];

    for (const requirement of packetRequirements) {
      if (!requirement.pattern.test(operationalPackets)) {
        addAutonomyIssue(result, "error", requirement.code, OPTIONAL_PACKET_DOC, requirement.message);
      }
    }
  }

  if (!docs["docs/technology.xml"]) {
    addAutonomyIssue(
      result,
      "error",
      "autonomy.missing-technology-artifact",
      "docs/technology.xml",
      "Autonomous execution should be anchored to docs/technology.xml so the preferred stack and autonomy policy are explicit.",
    );
  } else {
    const technologyDoc = docs["docs/technology.xml"];
    if (!/<PreferredAgentStack(?=[\s>])/.test(technologyDoc)) {
      addAutonomyIssue(
        result,
        "warning",
        "autonomy.technology-missing-preferred-agent-stack",
        "docs/technology.xml",
        "Technology guidance should include PreferredAgentStack so workers know which runtime, test, and observability surfaces are preferred.",
      );
    }

    if (!/<AutonomyPolicy(?=[\s>])/.test(technologyDoc)) {
      addAutonomyIssue(
        result,
        "warning",
        "autonomy.technology-missing-autonomy-policy",
        "docs/technology.xml",
        "Technology guidance should include AutonomyPolicy so retry budgets and replan triggers are explicit.",
      );
    }
  }

  if (!docs["docs/knowledge-graph.xml"] || !docs["docs/development-plan.xml"] || !docs["docs/verification-plan.xml"]) {
    return;
  }

  let index;
  try {
    index = loadGraceArtifactIndex(root);
  } catch (error) {
    addAutonomyIssue(
      result,
      "error",
      "autonomy.failed-to-index-project",
      root,
      `Autonomous readiness checks could not index the GRACE project: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  const sharedModules = index.modules.filter((moduleRecord) => moduleRecord.plan || moduleRecord.graph);
  const implementationFiles = collectCodeFiles(root, ignoredDirs)
    .map((filePath) => ({
      path: normalizeRelative(root, filePath),
      text: readFileSync(filePath, "utf8"),
    }))
    .filter((file) => !isLikelyTestPath(file.path));

  for (const moduleRecord of sharedModules) {
    const moduleImplementationFiles = moduleRecord.localFiles.filter((file) => !isLikelyTestPath(file.path));
    if (moduleRecord.verifications.length === 0) {
      addAutonomyIssue(
        result,
        "error",
        "autonomy.module-missing-verification",
        "docs/verification-plan.xml",
        `Module \`${moduleRecord.id}\` has shared planning or graph context but no matching verification entry. Autonomous runs require a V-M entry per shared module.`,
      );
    }

    if (moduleImplementationFiles.length === 0) {
      addAutonomyIssue(
        result,
        "error",
        "autonomy.module-missing-implementation-files",
        "docs/knowledge-graph.xml",
        `Module \`${moduleRecord.id}\` has no linked non-test governed files. Autonomous execution needs a real implementation surface, not only tests or shared-doc declarations.`,
      );
    }

    for (const step of moduleRecord.steps) {
      if (!step.verificationId) {
        addAutonomyIssue(
          result,
          "error",
          "autonomy.step-missing-verification",
          "docs/development-plan.xml",
          `${step.phaseTag} / ${step.stepTag} for module \`${moduleRecord.id}\` is missing an explicit verification reference. Autonomous packets should name the verification gate they rely on.`,
        );
      }
    }
  }

  for (const entry of index.verifications) {
    if (entry.testFiles.length === 0) {
      addAutonomyIssue(
        result,
        "error",
        "autonomy.verification-missing-test-files",
        "docs/verification-plan.xml",
        `Verification entry \`${entry.id}\` must list at least one test file for autonomous execution.`,
      );
    }

    if (entry.moduleChecks.length === 0) {
      addAutonomyIssue(
        result,
        "error",
        "autonomy.verification-missing-module-checks",
        "docs/verification-plan.xml",
        `Verification entry \`${entry.id}\` must define at least one module-local command for autonomous execution.`,
      );
    }

    if (entry.scenarios.length === 0) {
      addAutonomyIssue(
        result,
        "error",
        "autonomy.verification-missing-scenarios",
        "docs/verification-plan.xml",
        `Verification entry \`${entry.id}\` must define success or failure scenarios before it can gate autonomous execution.`,
      );
    }

    if (entry.requiredLogMarkers.length === 0 && entry.requiredTraceAssertions.length === 0) {
      addAutonomyIssue(
        result,
        "error",
        "autonomy.verification-missing-observable-evidence",
        "docs/verification-plan.xml",
        `Verification entry \`${entry.id}\` must define required log markers or trace assertions so failures are observable without hidden model reasoning.`,
      );
    }

    // Fast-path: use shared utility for batch check — skip per-file comparison when all pass
    const allChecksReferenceTestFiles = checkModuleCheckReferences(entry.testFiles, entry.moduleChecks, entry.cwd);

    for (const testFile of entry.testFiles) {
      const absolutePath = path.isAbsolute(testFile) ? testFile : path.join(root, testFile);
      if (!existsSync(absolutePath)) {
        addAutonomyIssue(
          result,
          "error",
          "autonomy.verification-test-file-missing-on-disk",
          "docs/verification-plan.xml",
          `Verification entry \`${entry.id}\` references test file \`${testFile}\`, but that file does not exist on disk.`,
        );
      }

      const governedTestRecord = index.files.find((file) => file.path === testFile);
      if (governedTestRecord && entry.moduleId && !governedTestRecord.linkedModuleIds.includes(entry.moduleId)) {
        addAutonomyIssue(
          result,
          "error",
          "autonomy.verification-test-file-unlinked-module",
          "docs/verification-plan.xml",
          `Verification entry \`${entry.id}\` references governed test file \`${testFile}\`, but that file is not linked to module \`${entry.moduleId}\`.`,
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
          addAutonomyIssue(
            result,
            "warning",
            "autonomy.verification-module-check-does-not-reference-test-file",
            "docs/verification-plan.xml",
            `Verification entry \`${entry.id}\` does not have a module-check that clearly targets \`${testFile}\` or its containing directory.`,
          );
        }
      }
    }

    for (const marker of entry.requiredLogMarkers) {
      const scopedImplementationFiles = entry.moduleId
        ? implementationFiles.filter((file) => {
            const moduleRecord = index.modules.find((module) => module.id === entry.moduleId);
            return moduleRecord?.localFiles.some((moduleFile) => moduleFile.path === file.path && !isLikelyTestPath(moduleFile.path));
          })
        : implementationFiles;

      if (!scopedImplementationFiles.some((file) => lineHasRuntimeMarker(file.text, marker))) {
        addAutonomyIssue(
          result,
          "error",
          "autonomy.required-log-marker-not-found",
          "docs/verification-plan.xml",
          `Verification entry \`${entry.id}\` requires log marker \`${marker}\`, but that marker was not found in the current codebase.`,
        );
      }

      const requiredBlock = parseMarkerBlockName(marker);
      if (requiredBlock && entry.moduleId) {
        const moduleRecord = index.modules.find((module) => module.id === entry.moduleId);
        if (moduleRecord && !moduleRecord.localFiles.some((file) => !isLikelyTestPath(file.path) && file.blocks.some((block) => block.name === requiredBlock))) {
          addAutonomyIssue(
            result,
            "error",
            "autonomy.required-log-marker-block-not-found",
            "docs/verification-plan.xml",
            `Verification entry \`${entry.id}\` requires log marker \`${marker}\`, but no linked runtime file exposes BLOCK_${requiredBlock}.`,
          );
        }
      }
    }

    if (!entry.waveFollowUp) {
      addAutonomyIssue(
        result,
        "warning",
        "autonomy.verification-missing-wave-follow-up",
        "docs/verification-plan.xml",
        `Verification entry \`${entry.id}\` does not define a wave-level follow-up check. Long autonomous runs are safer when merged surfaces have an explicit post-merge gate.`,
      );
    }

    if (!entry.phaseFollowUp) {
      addAutonomyIssue(
        result,
        "warning",
        "autonomy.verification-missing-phase-follow-up",
        "docs/verification-plan.xml",
        `Verification entry \`${entry.id}\` does not define a phase-level follow-up check. Autonomous execution benefits from an explicit broader gate before phase completion.`,
      );
    }
  }
}

function lintExportMapParity(
  result: LintResult,
  relativePath: string,
  items: ModuleMapItem[],
  analysis: LanguageAnalysis,
  role: ModuleRole,
  mapMode: MapMode,
) {
  if (mapMode !== "EXPORTS") {
    return;
  }

  const exportSeverity = analysis.exportConfidence === "exact" ? "error" : "warning";

  if (analysis.exportConfidence === "heuristic") {
    addIssue(result, {
      severity: "warning",
      code: "analysis.heuristic-export-surface",
      file: relativePath,
      message: `The ${analysis.adapterId} adapter inferred exports heuristically for this file. Exact MODULE_MAP parity may require explicit file ROLE/MAP_MODE or stronger language-specific export declarations.`,
    });
  }

  if (analysis.hasWildcardReExport) {
    addIssue(result, {
      severity: "warning",
      code: "analysis.wildcard-reexport-surface",
      file: relativePath,
      message: "This file uses wildcard re-exports. Exact export parity is skipped unless you use a more specific MAP_MODE or explicit barrel structure.",
    });
    return;
  }

  const mappedSymbols = new Set(items.flatMap((item) => (item.symbolName ? [item.symbolName] : [])));
  if (mappedSymbols.size === 0 && analysis.exports.size > 0) {
    addIssue(result, {
      severity: exportSeverity,
      code: "markup.module-map-missing-symbol-entries",
      file: relativePath,
      message: "MODULE_MAP should list concrete symbol names when MAP_MODE resolves to EXPORTS.",
    });
    return;
  }

  for (const exportName of analysis.exports) {
    if (!mappedSymbols.has(exportName)) {
      addIssue(result, {
        severity: exportSeverity,
        code: "markup.module-map-missing-export",
        file: relativePath,
        message: `MODULE_MAP is missing the exported symbol \`${exportName}\`.`,
      });
    }
  }

  for (const item of items) {
    if (!item.symbolName) {
      continue;
    }

    if (!analysis.exports.has(item.symbolName)) {
      addIssue(result, {
        severity: role === "RUNTIME" || role === "TYPES" ? "warning" : "warning",
        code: "markup.module-map-extra-export",
        file: relativePath,
        line: item.line,
        message: `MODULE_MAP lists \`${item.symbolName}\`, but no matching export was found by the ${analysis.adapterId} adapter.`,
      });
    }
  }
}

function lintGovernedFile(result: LintResult, root: string, filePath: string, text: string) {
  const relativePath = normalizeRelative(root, filePath);
  result.governedFiles += 1;

  const moduleContractSection = ensureSectionPair(
    result,
    relativePath,
    text,
    "START_MODULE_CONTRACT",
    "END_MODULE_CONTRACT",
    "markup.missing-module-contract",
    "Governed files must include a paired MODULE_CONTRACT section.",
  );
  const moduleMapSection = findSection(text, "START_MODULE_MAP", "END_MODULE_MAP");
  const changeSummarySection = ensureSectionPair(
    result,
    relativePath,
    text,
    "START_CHANGE_SUMMARY",
    "END_CHANGE_SUMMARY",
    "markup.missing-change-summary",
    "Governed files must include a paired CHANGE_SUMMARY section.",
  );

  lintScopedMarkers(
    result,
    relativePath,
    text,
    /START_CONTRACT:\s*([A-Za-z0-9_$.\-]+)/,
    /END_CONTRACT:\s*([A-Za-z0-9_$.\-]+)/,
    "contract",
  );
  lintScopedMarkers(
    result,
    relativePath,
    text,
    /START_BLOCK_([A-Za-z0-9_]+)/,
    /END_BLOCK_([A-Za-z0-9_]+)/,
    "block",
  );

  const contract = moduleContractSection ? parseModuleContract(moduleContractSection) : null;
  const mapItems = moduleMapSection ? parseModuleMapItems(moduleMapSection) : [];
  const functionContractSections = collectExactContractSections(text);
  const adapter = getLanguageAdapter(filePath);
  let analysis: LanguageAnalysis | null = null;
  if (adapter) {
    try {
      analysis = adapter.analyze(filePath, text);
    } catch (error) {
      addIssue(result, {
        severity: "warning",
        code: "analysis.adapter-failed",
        file: relativePath,
        message: `${adapter.id} adapter failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  const role = inferRole(contract, analysis);
  const mapMode = inferMapMode(contract, role, mapItems, analysis);

  if (moduleContractSection && contract) {
    lintContractFieldLabels(
      result,
      relativePath,
      moduleContractSection,
      MODULE_CONTRACT_FIELDS,
      "markup.unknown-module-contract-field",
      "MODULE_CONTRACT",
    );

    const missingContractFields = ["PURPOSE", "SCOPE", "DEPENDS", "LINKS"].filter((field) => !contract.fields[field]);
    if (missingContractFields.length > 0) {
      addIssue(result, {
        severity: "error",
        code: "markup.incomplete-module-contract",
        file: relativePath,
        message: `MODULE_CONTRACT should include PURPOSE, SCOPE, DEPENDS, and LINKS fields. Missing: ${missingContractFields.join(", ")}.`,
      });
    }
  }

  for (const contractSection of functionContractSections) {
    lintContractFieldLabels(
      result,
      relativePath,
      contractSection,
      FUNCTION_CONTRACT_FIELDS,
      "markup.unknown-function-contract-field",
      "START_CONTRACT section",
    );
  }

  if (moduleContractSection && contract?.fields.ROLE && !contract.role) {
    addIssue(result, {
      severity: "error",
      code: "markup.invalid-role",
      file: relativePath,
      message: `Unsupported ROLE \`${contract.fields.ROLE}\`. Use RUNTIME, TEST, BARREL, CONFIG, TYPES, or SCRIPT.`,
    });
  }

  if (moduleContractSection && contract?.fields.MAP_MODE && !contract.mapMode) {
    addIssue(result, {
      severity: "error",
      code: "markup.invalid-map-mode",
      file: relativePath,
      message: `Unsupported MAP_MODE \`${contract.fields.MAP_MODE}\`. Use EXPORTS, LOCALS, SUMMARY, or NONE.`,
    });
  }

  if (!moduleMapSection && mapMode !== "NONE") {
    addIssue(result, {
      severity: "error",
      code: "markup.missing-module-map",
      file: relativePath,
      message: `Governed files with ROLE ${role} and MAP_MODE ${mapMode} must include a paired MODULE_MAP section.`,
    });
  }

  if (moduleMapSection && mapMode !== "NONE" && mapItems.length === 0) {
    addIssue(result, {
      severity: "error",
      code: "markup.empty-module-map",
      file: relativePath,
      message: `MODULE_MAP must include at least one item when MAP_MODE resolves to ${mapMode}.`,
    });
  }

  if (changeSummarySection && !/LAST_CHANGE:/s.test(changeSummarySection.content)) {
    addIssue(result, {
      severity: "error",
      code: "markup.empty-change-summary",
      file: relativePath,
      message: "CHANGE_SUMMARY must contain at least one LAST_CHANGE entry.",
    });
  }

  if (analysis) {
    lintExportMapParity(result, relativePath, mapItems, analysis, role, mapMode);
  }
}

export function lintGraceProject(projectRoot: string, options: LintOptions = {}): LintResult {
  const root = path.resolve(projectRoot);
  const { config, issues: configIssues } = loadGraceLintConfig(root);
  const profile: LintProfile = options.profile ?? "standard";

  const docs = {
    "docs/technology.xml": readTextIfExists(path.join(root, "docs/technology.xml")),
    "docs/knowledge-graph.xml": readTextIfExists(path.join(root, "docs/knowledge-graph.xml")),
    "docs/development-plan.xml": readTextIfExists(path.join(root, "docs/development-plan.xml")),
    "docs/verification-plan.xml": readTextIfExists(path.join(root, "docs/verification-plan.xml")),
  } satisfies Record<string, string | null>;

  const result: LintResult = {
    schemaVersion: "1.0.0",
    tool: "grace-lint",
    generatedAt: new Date().toISOString(),
    root,
    profile,
    filesChecked: 0,
    governedFiles: 0,
    xmlFilesChecked: 0,
    issues: [...configIssues],
    summary: {
      issues: 0,
      errors: 0,
      warnings: 0,
    },
  };

  if (configIssues.some((issue) => issue.severity === "error" && issue.file === LINT_CONFIG_FILE)) {
    result.issues = result.issues.map((issue) => withLintIssueGuide(issue));
    result.summary = {
      issues: result.issues.length,
      errors: result.issues.filter((issue) => issue.severity === "error").length,
      warnings: result.issues.filter((issue) => issue.severity === "warning").length,
    };
    return result;
  }

  if (!options.allowMissingDocs) {
    for (const relativePath of REQUIRED_DOCS) {
      if (!docs[relativePath]) {
        addIssue(result, {
          severity: "error",
          code: "docs.missing-required-artifact",
          file: relativePath,
          message: `Missing required current GRACE artifact \`${relativePath}\`.`,
        });
      }
    }
  }

  for (const [relativePath, contents] of Object.entries(docs)) {
    if (!contents) {
      continue;
    }

    result.xmlFilesChecked += 1;
    lintUniqueTags(result, relativePath, contents);
    lintCanonicalXmlAnchors(result, relativePath, contents);
  }

  const operationalPackets = readTextIfExists(path.join(root, OPTIONAL_PACKET_DOC));
  if (operationalPackets) {
    result.xmlFilesChecked += 1;
    lintRequiredPacketSections(result, OPTIONAL_PACKET_DOC, operationalPackets);
  }

  if (profile === "autonomous") {
    lintAutonomousReadiness(result, root, docs, operationalPackets, config?.ignoredDirs ?? []);
  }

  const knowledgeGraph = docs["docs/knowledge-graph.xml"];
  const developmentPlan = docs["docs/development-plan.xml"];
  const verificationPlan = docs["docs/verification-plan.xml"];

  const graphModuleIds = knowledgeGraph ? extractModuleIds(knowledgeGraph) : new Set<string>();
  const planModuleIds = developmentPlan ? extractModuleIds(developmentPlan) : new Set<string>();
  const verificationIds = verificationPlan ? extractVerificationIds(verificationPlan) : new Set<string>();

  if (knowledgeGraph && verificationPlan) {
    for (const ref of extractVerificationRefs(knowledgeGraph)) {
      if (!verificationIds.has(ref.value)) {
        addIssue(result, {
          severity: "error",
          code: "graph.missing-verification-entry",
          file: "docs/knowledge-graph.xml",
          line: ref.line,
          message: `Knowledge graph references \`${ref.value}\`, but no matching verification entry exists.`,
        });
      }
    }
  }

  if (developmentPlan && verificationPlan) {
    for (const ref of extractVerificationRefs(developmentPlan)) {
      if (!verificationIds.has(ref.value)) {
        addIssue(result, {
          severity: "error",
          code: "plan.missing-verification-entry",
          file: "docs/development-plan.xml",
          line: ref.line,
          message: `Development plan references \`${ref.value}\`, but no matching verification entry exists.`,
        });
      }
    }

    for (const step of extractStepRefs(developmentPlan)) {
      if (step.moduleId && !MODULE_ID_REGEX.test(step.moduleId)) {
        addIssue(result, {
          severity: "error",
          code: "plan.invalid-module-id",
          file: "docs/development-plan.xml",
          line: step.line,
          message: `${step.stepTag} uses non-canonical module ID \`${step.moduleId}\`. Use exact M-<UPPER-KEBAB> form.`,
        });
      }

      if (step.verificationId && !VERIFICATION_ID_REGEX.test(step.verificationId)) {
        addIssue(result, {
          severity: "error",
          code: "plan.invalid-verification-id",
          file: "docs/development-plan.xml",
          line: step.line,
          message: `${step.stepTag} uses non-canonical verification ID \`${step.verificationId}\`. Use exact V-M-<UPPER-KEBAB> form.`,
        });
      }

      if (step.moduleId && !planModuleIds.has(step.moduleId)) {
        addIssue(result, {
          severity: "error",
          code: "plan.step-missing-module",
          file: "docs/development-plan.xml",
          line: step.line,
          message: `${step.stepTag} references module \`${step.moduleId}\`, but no matching module tag exists in the plan.`,
        });
      }

      if (step.verificationId && verificationPlan && !verificationIds.has(step.verificationId)) {
        addIssue(result, {
          severity: "error",
          code: "plan.step-missing-verification",
          file: "docs/development-plan.xml",
          line: step.line,
          message: `${step.stepTag} references verification entry \`${step.verificationId}\`, but no matching tag exists in verification-plan.xml.`,
        });
      }
    }
  }

  if (knowledgeGraph && developmentPlan) {
    for (const moduleId of graphModuleIds) {
      if (!planModuleIds.has(moduleId)) {
        addIssue(result, {
          severity: "error",
          code: "graph.module-missing-from-plan",
          file: "docs/knowledge-graph.xml",
          message: `Module \`${moduleId}\` exists in the knowledge graph but not in the development plan.`,
        });
      }
    }

    for (const moduleId of planModuleIds) {
      if (!graphModuleIds.has(moduleId)) {
        addIssue(result, {
          severity: "error",
          code: "plan.module-missing-from-graph",
          file: "docs/development-plan.xml",
          message: `Module \`${moduleId}\` exists in the development plan but not in the knowledge graph.`,
        });
      }
    }
  }

  for (const filePath of collectCodeFiles(root, config?.ignoredDirs ?? [])) {
    result.filesChecked += 1;
    const text = readFileSync(filePath, "utf8");
    if (!hasGraceMarkers(text)) {
      continue;
    }

    lintGovernedFile(result, root, filePath, text);
  }

  result.issues = result.issues.map((issue) => withLintIssueGuide(issue));
  result.summary = {
    issues: result.issues.length,
    errors: result.issues.filter((issue) => issue.severity === "error").length,
    warnings: result.issues.filter((issue) => issue.severity === "warning").length,
  };

  return result;
}

export function formatTextReport(result: LintResult, options: { remediate?: boolean } = {}) {
  const errors = result.issues.filter((issue) => issue.severity === "error");
  const warnings = result.issues.filter((issue) => issue.severity === "warning");
  const lines = [
    "GRACE Lint Report",
    "=================",
    `Root: ${result.root}`,
    `Profile: ${result.profile}`,
    `Code files checked: ${result.filesChecked}`,
    `Governed files checked: ${result.governedFiles}`,
    `XML files checked: ${result.xmlFilesChecked}`,
    `Issues: ${result.summary.issues} (errors: ${result.summary.errors}, warnings: ${result.summary.warnings})`,
  ];

  if (errors.length > 0) {
    lines.push("", "Errors:");
    for (const issue of errors) {
      lines.push(`- [${issue.code}] ${issue.file}${issue.line ? `:${issue.line}` : ""} ${issue.message}`);
      if (options.remediate) {
        lines.push(`  Explanation: ${issue.explanation ?? "n/a"}`);
        for (const step of issue.remediation ?? []) {
          lines.push(`  Fix: ${step}`);
        }
      }
    }
  }

  if (warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const issue of warnings) {
      lines.push(`- [${issue.code}] ${issue.file}${issue.line ? `:${issue.line}` : ""} ${issue.message}`);
      if (options.remediate) {
        lines.push(`  Explanation: ${issue.explanation ?? "n/a"}`);
        for (const step of issue.remediation ?? []) {
          lines.push(`  Fix: ${step}`);
        }
      }
    }
  }

  if (result.issues.length === 0) {
    lines.push("", "No GRACE integrity issues found.");
  }

  return lines.join("\n");
}

export function isValidTextFormat(format: string) {
  return TEXT_FORMAT_OPTIONS.has(format);
}
