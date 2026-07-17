import { spawnSync } from "node:child_process";
import path from "node:path";

import { LanguageRuntimeMissingError, type LanguageAdapter, type LanguageAnalysis } from "../types";

const PY_EXTENSIONS = new Set([".py", ".pyi"]);
const PYTHON_BINARIES = ["python3", "python"];

const PYTHON_ANALYZER_SCRIPT = String.raw`
import ast
import json
import os
import sys

source = sys.stdin.buffer.read().decode("utf-8", errors="replace")
file_path = sys.argv[1]
base_name = os.path.basename(file_path)


def is_public(name):
    return isinstance(name, str) and len(name) > 0 and not name.startswith("_")


def extract_target_names(target):
    if isinstance(target, ast.Name):
        return [target.id]
    if isinstance(target, (ast.Tuple, ast.List)):
        names = []
        for item in target.elts:
            names.extend(extract_target_names(item))
        return names
    return []


def extract_string_sequence(node):
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        values = []
        for element in node.elts:
            if not isinstance(element, ast.Constant) or not isinstance(element.value, str):
                return None
            values.append(element.value)
        return values
    return None


def is_main_guard(test):
    if not isinstance(test, ast.Compare):
        return False
    if len(test.ops) != 1 or len(test.comparators) != 1:
        return False
    left = test.left
    comparator = test.comparators[0]
    return (
        isinstance(left, ast.Name)
        and left.id == "__name__"
        and isinstance(test.ops[0], ast.Eq)
        and isinstance(comparator, ast.Constant)
        and comparator.value == "__main__"
    )


def imported_name(alias):
    return alias.asname or alias.name.split(".", 1)[0]


local_public = set()
imported_public = set()
explicit_all = None
has_wildcard_reexport = False
direct_reexport_count = 0
local_implementation_count = 0
uses_test_framework = False
has_main_entrypoint = False

try:
    tree = ast.parse(source, filename=file_path)
except SyntaxError as exc:
    message = f"{exc.msg} at line {exc.lineno}:{exc.offset}" if exc.lineno else exc.msg
    sys.stderr.write(message)
    sys.exit(2)

for node in tree.body:
    if isinstance(node, ast.Import):
        for alias in node.names:
            imported = imported_name(alias)
            if is_public(imported):
                imported_public.add(imported)
            if alias.name == "pytest" or alias.name.startswith("unittest"):
                uses_test_framework = True
        continue

    if isinstance(node, ast.ImportFrom):
        module = node.module or ""
        if module == "pytest" or module.startswith("unittest"):
            uses_test_framework = True
        if any(alias.name == "*" for alias in node.names):
            has_wildcard_reexport = True
            direct_reexport_count += 1
            continue
        public_imports = 0
        for alias in node.names:
            imported = imported_name(alias)
            if is_public(imported):
                imported_public.add(imported)
                public_imports += 1
        if public_imports:
            direct_reexport_count += 1
        continue

    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        local_implementation_count += 1
        if node.name.startswith("test_"):
            uses_test_framework = True
        if is_public(node.name):
            local_public.add(node.name)
        continue

    if isinstance(node, ast.ClassDef):
        local_implementation_count += 1
        if node.name.startswith("Test"):
            uses_test_framework = True
        if is_public(node.name):
            local_public.add(node.name)
        continue

    if isinstance(node, ast.Assign):
        for target in node.targets:
            for name in extract_target_names(target):
                if name == "__all__":
                    sequence = extract_string_sequence(node.value)
                    if sequence is not None:
                        explicit_all = sequence
                    continue
                if is_public(name):
                    local_public.add(name)
                    local_implementation_count += 1
        continue

    if isinstance(node, ast.AnnAssign):
        for name in extract_target_names(node.target):
            if name == "__all__":
                sequence = extract_string_sequence(node.value)
                if sequence is not None:
                    explicit_all = sequence
                continue
            if is_public(name):
                local_public.add(name)
                local_implementation_count += 1
        continue

    if isinstance(node, ast.If) and is_main_guard(node.test):
        has_main_entrypoint = True

if explicit_all is not None:
    export_names = sorted({name for name in explicit_all if isinstance(name, str)})
    export_confidence = "exact"
else:
    export_names = set(local_public)
    if base_name == "__init__.py":
        export_names.update(imported_public)
    export_names = sorted(export_names)
    export_confidence = "heuristic"

local_export_count = sum(1 for name in export_names if name in local_public)

print(json.dumps({
    "exports": export_names,
    "valueExports": export_names,
    "typeExports": [],
    "localSymbols": sorted(local_public),
    "exportConfidence": export_confidence,
    "hasDefaultExport": False,
    "hasWildcardReExport": has_wildcard_reexport,
    "hasMainEntrypoint": has_main_entrypoint,
    "directReExportCount": direct_reexport_count,
    "localExportCount": local_export_count,
    "localImplementationCount": local_implementation_count,
    "usesTestFramework": uses_test_framework,
}))
`;

function createEmptyAnalysis(): LanguageAnalysis {
  return {
    adapterId: "python",
    exports: new Set<string>(),
    valueExports: new Set<string>(),
    typeExports: new Set<string>(),
    localSymbols: new Set<string>(),
    exportConfidence: "heuristic",
    hasDefaultExport: false,
    hasWildcardReExport: false,
    hasMainEntrypoint: false,
    directReExportCount: 0,
    localExportCount: 0,
    localImplementationCount: 0,
    usesTestFramework: false,
  };
}

function normalizeResult(output: string) {
  const parsed = JSON.parse(output) as {
    exports: string[];
    valueExports: string[];
    typeExports: string[];
    localSymbols: string[];
    exportConfidence: "exact" | "heuristic";
    hasDefaultExport: boolean;
    hasWildcardReExport: boolean;
    hasMainEntrypoint: boolean;
    directReExportCount: number;
    localExportCount: number;
    localImplementationCount: number;
    usesTestFramework: boolean;
  };

  const analysis = createEmptyAnalysis();
  analysis.exports = new Set(parsed.exports ?? []);
  analysis.valueExports = new Set(parsed.valueExports ?? []);
  analysis.typeExports = new Set(parsed.typeExports ?? []);
  analysis.localSymbols = new Set(parsed.localSymbols ?? []);
  analysis.exportConfidence = parsed.exportConfidence ?? "heuristic";
  analysis.hasDefaultExport = Boolean(parsed.hasDefaultExport);
  analysis.hasWildcardReExport = Boolean(parsed.hasWildcardReExport);
  analysis.hasMainEntrypoint = Boolean(parsed.hasMainEntrypoint);
  analysis.directReExportCount = Number(parsed.directReExportCount ?? 0);
  analysis.localExportCount = Number(parsed.localExportCount ?? 0);
  analysis.localImplementationCount = Number(parsed.localImplementationCount ?? 0);
  analysis.usesTestFramework = Boolean(parsed.usesTestFramework);
  return analysis;
}

function runPythonAnalyzer(filePath: string, text: string) {
  for (const binary of PYTHON_BINARIES) {
    const run = spawnSync(binary, ["-c", PYTHON_ANALYZER_SCRIPT, filePath], {
      input: Buffer.from(text, "utf8"),
      encoding: "utf8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      maxBuffer: 1024 * 1024,
    });

    if (run.error) {
      const code = (run.error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        continue;
      }
      throw run.error;
    }

    if (run.status === 0) {
      return normalizeResult(run.stdout);
    }

    throw new Error(run.stderr.trim() || run.stdout.trim() || `Python analyzer failed via ${binary}.`);
  }

  throw new LanguageRuntimeMissingError(
    "python",
    [...PYTHON_BINARIES],
    "Python analysis requires `python3` or `python` on PATH. Install Python or exclude the governed Python files until the runtime is available.",
  );
}

export function createPythonAdapter(): LanguageAdapter {
  return {
    id: "python",
    supports(filePath) {
      return PY_EXTENSIONS.has(path.extname(filePath));
    },
    analyze(filePath, text) {
      return runPythonAnalyzer(filePath, text);
    },
  };
}
