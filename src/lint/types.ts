export type LintSeverity = "error" | "warning";

export type LintProfile = "standard";

/** Selected assertion section evaluated by grace lint. */
export type LintAssertionMode = "current" | "baseline" | "target" | "final";

export type ModuleRole = "RUNTIME" | "TEST" | "BARREL" | "CONFIG" | "TYPES" | "SCRIPT";
export type MapMode = "EXPORTS" | "LOCALS" | "SUMMARY" | "NONE";

export type LintIssue = {
  severity: LintSeverity;
  code: string;
  file: string;
  line?: number;
  message: string;
  title?: string;
  explanation?: string;
  remediation?: string[];
};

export type LintResult = {
  schemaVersion: string;
  tool: "grace-lint";
  generatedAt: string;
  root: string;
  profile: LintProfile;
  assertionMode: LintAssertionMode;
  changeId?: string;
  commandsEnabled: boolean;
  filesChecked: number;
  governedFiles: number;
  xmlFilesChecked: number;
  issues: LintIssue[];
  summary: {
    issues: number;
    errors: number;
    warnings: number;
  };
};

export type LintOptions = {
  profile?: LintProfile;
  assertionMode?: LintAssertionMode;
  changeId?: string;
  runCommands?: boolean;
  parallelPreflight?: boolean;
};

export type GraceLintConfig = {
  ignoredDirs?: string[];
};

export type MarkupSection = {
  content: string;
  startLine: number;
  endLine: number;
};

export type ModuleContractInfo = {
  fields: Record<string, string>;
  purpose?: string;
  scope?: string;
  depends?: string;
  links?: string;
  role?: ModuleRole;
  mapMode?: MapMode;
};

export type ModuleMapItem = {
  label: string;
  symbolName?: string;
  line: number;
};

export type LanguageAnalysis = {
  adapterId: string;
  exports: Set<string>;
  valueExports: Set<string>;
  typeExports: Set<string>;
  localSymbols: Set<string>;
  exportConfidence: "exact" | "heuristic";
  hasDefaultExport: boolean;
  hasWildcardReExport: boolean;
  hasMainEntrypoint: boolean;
  directReExportCount: number;
  localExportCount: number;
  localImplementationCount: number;
  usesTestFramework: boolean;
};

export type LanguageAdapter = {
  id: string;
  supports(filePath: string): boolean;
  analyze(filePath: string, text: string): LanguageAnalysis;
};

/** Actionable failure raised when an optional language runtime is unavailable. */
export class LanguageRuntimeMissingError extends Error {
  readonly adapterId: string;
  readonly runtimeCandidates: string[];

  constructor(adapterId: string, runtimeCandidates: string[], message: string) {
    super(message);
    this.name = "LanguageRuntimeMissingError";
    this.adapterId = adapterId;
    this.runtimeCandidates = runtimeCandidates;
  }
}
