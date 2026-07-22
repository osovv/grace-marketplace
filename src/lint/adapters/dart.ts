import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LanguageRuntimeMissingError, type LanguageAdapter, type LanguageAnalysis } from "../types";

const DART_EXTENSIONS = new Set([".dart"]);
const DART_BINARIES = ["dart"];

const DART_ANALYZER_SCRIPT = String.raw`
import 'dart:io';
import 'dart:convert';

Future<void> main(List<String> args) async {
  final source = await stdin.transform(utf8.decoder).join();
  final filePath = args.isNotEmpty ? args[0] : '';

  final publicSymbols = <String>{};
  final exportTargets = <String>{};
  bool isPartOf = false;
  bool hasWildcardReexport = false;
  int directReexportCount = 0;
  int localImplementationCount = 0;
  bool usesTestFramework = false;

  for (final rawLine in source.split('\n')) {
    final line = rawLine.trim();

    // Detect test framework: import 'package:test/test.dart';
    if (line.contains("package:test")) {
      usesTestFramework = true;
    }

    // Detect part of (file is not a standalone library)
    if (line.startsWith(RegExp(r"part\s+of\s"))) {
      isPartOf = true;
    }

    // Detect barrel re-export: export 'foo.dart';
    if (line.startsWith("export ") && line.contains("'")) {
      hasWildcardReexport = true;
      directReexportCount++;
      continue;
    }

    // Detect part directive (includes another source file)
    if (line.startsWith("part ") && line.contains("'")) {
      directReexportCount++;
      continue;
    }

    // Detect import for re-export tracking
    if (line.startsWith("import ") && line.contains("'")) {
      directReexportCount++;
      continue;
    }

    // Detect top-level public declarations (class, mixin, typedef, function, variable, enum, extension)
    final publicMatch = RegExp(
      r'^(?:class|mixin|enum|extension)\s+(?!_)(\w+)'
    ).firstMatch(line);
    if (publicMatch != null) {
      publicSymbols.add(publicMatch.group(1)!);
      localImplementationCount++;
      continue;
    }

    // Top-level functions: returnType name(...) or void name(...)
    final funcMatch = RegExp(
      r'^\s*(?:\w+(?:\s*[<].*[>])?\s+)?(?!_)(\w+)\s*[(]'
    ).firstMatch(line);
    if (funcMatch != null) {
      final name = funcMatch.group(1)!;
      if (!RegExp(r'^(if|while|for|switch|return|catch)$').hasMatch(name)) {
        publicSymbols.add(name);
        localImplementationCount++;
      }
      continue;
    }

    // Top-level variables: Type name = ... or final/const name = ... or var name =
    final varMatch = RegExp(
      r'^\s*(?:final|const|var|late)?\s*(?:\w+(?:\s*[<].*[>])?\s+)?(?!_)(\w+)\s*='
    ).firstMatch(line);
    if (varMatch != null) {
      final name = varMatch.group(1)!;
      if (RegExp(r'^[A-Za-z]').hasMatch(name)) {
        publicSymbols.add(name);
        localImplementationCount++;
      }
      continue;
    }

    // Typedefs
    final typedefMatch = RegExp(
      r'^typedef\s+(?!_)(\w+)'
    ).firstMatch(line);
    if (typedefMatch != null) {
      publicSymbols.add(typedefMatch.group(1)!);
      localImplementationCount++;
      continue;
    }
  }

  final exports = publicSymbols.toList()..sort();
  final confidence = 'heuristic';

  stdout.write(jsonEncode({
    'exports': exports,
    'valueExports': exports,
    'typeExports': <String>[],
    'localSymbols': exports,
    'exportConfidence': confidence,
    'hasDefaultExport': false,
    'hasWildcardReExport': hasWildcardReexport,
    'hasMainEntrypoint': false,
    'directReExportCount': directReexportCount,
    'localExportCount': exports.length,
    'localImplementationCount': localImplementationCount,
    'usesTestFramework': usesTestFramework,
  }));
}
`;

function createEmptyAnalysis(): LanguageAnalysis {
  return {
    adapterId: "dart",
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

function normalizeResult(output: string): LanguageAnalysis {
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

function runDartAnalyzer(filePath: string, text: string): LanguageAnalysis {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "grace-dart-analyzer-"));
  const analyzerFile = path.join(temporaryDirectory, "analyzer.dart");
  writeFileSync(analyzerFile, DART_ANALYZER_SCRIPT, "utf8");
  try {
    for (const binary of DART_BINARIES) {
      const run = spawnSync(binary, ["run", analyzerFile, filePath], {
        input: Buffer.from(text, "utf8"),
        encoding: "utf8",
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
      throw new Error(run.stderr.trim() || run.stdout.trim() || `Dart analyzer failed via ${binary}.`);
    }
    throw new LanguageRuntimeMissingError(
      "dart",
      [...DART_BINARIES],
      "Dart analysis requires `dart` on PATH. Install the Dart SDK or exclude the governed Dart files until the runtime is available.",
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function createDartAdapter(): LanguageAdapter {
  return {
    id: "dart",
    supports(filePath) {
      return DART_EXTENSIONS.has(path.extname(filePath));
    },
    analyze(filePath, text) {
      return runDartAnalyzer(filePath, text);
    },
  };
}
