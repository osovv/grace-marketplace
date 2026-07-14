import path from "node:path";
import ts from "typescript";

import type { LanguageAdapter, LanguageAnalysis } from "../types";

const TS_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"]);
const TEST_IMPORTS = new Set(["bun:test", "vitest", "jest", "@jest/globals", "node:test"]);
const TEST_CALLS = new Set(["describe", "it", "test", "beforeEach", "afterEach", "beforeAll", "afterAll", "suite"]);

function getScriptKind(filePath: string) {
  const ext = path.extname(filePath);
  switch (ext) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".tsx":
      return ts.ScriptKind.TSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function hasExportModifier(node: ts.Node) {
  return (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function hasDefaultModifier(node: ts.Node) {
  return (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

function addExport(
  analysis: LanguageAnalysis,
  name: string,
  kind: "value" | "type",
  options: { local?: boolean; defaultExport?: boolean } = {},
) {
  analysis.exports.add(name);
  if (kind === "type") {
    analysis.typeExports.add(name);
  } else {
    analysis.valueExports.add(name);
  }

  if (options.local) {
    analysis.localExportCount += 1;
  }

  if (options.defaultExport) {
    analysis.hasDefaultExport = true;
  }
}

export function createTypeScriptAdapter(): LanguageAdapter {
  return {
    id: "js-ts",
    supports(filePath) {
      return TS_EXTENSIONS.has(path.extname(filePath));
    },
    analyze(filePath, text) {
      const sourceFile = ts.createSourceFile(
        filePath,
        text,
        ts.ScriptTarget.Latest,
        true,
        getScriptKind(filePath),
      );

      const analysis: LanguageAnalysis = {
        adapterId: "js-ts",
        exports: new Set<string>(),
        valueExports: new Set<string>(),
        typeExports: new Set<string>(),
        localSymbols: new Set<string>(),
        exportConfidence: "exact",
        hasDefaultExport: false,
        hasWildcardReExport: false,
        hasMainEntrypoint: false,
        directReExportCount: 0,
        localExportCount: 0,
        localImplementationCount: 0,
        usesTestFramework: false,
      };

      for (const statement of sourceFile.statements) {
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name)) {
              analysis.localSymbols.add(declaration.name.text);
            }
          }
        } else if (
          (ts.isFunctionDeclaration(statement)
            || ts.isClassDeclaration(statement)
            || ts.isInterfaceDeclaration(statement)
            || ts.isTypeAliasDeclaration(statement)
            || ts.isEnumDeclaration(statement))
          && statement.name
        ) {
          analysis.localSymbols.add(statement.name.text);
        } else if (ts.isModuleDeclaration(statement)) {
          analysis.localSymbols.add(statement.name.getText(sourceFile));
        }

        if (ts.isImportDeclaration(statement)) {
          const importSource = ts.isStringLiteral(statement.moduleSpecifier)
            ? statement.moduleSpecifier.text
            : null;
          if (importSource && TEST_IMPORTS.has(importSource)) {
            analysis.usesTestFramework = true;
          }
          continue;
        }

        if (ts.isExpressionStatement(statement)) {
          const expression = statement.expression;
          if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && TEST_CALLS.has(expression.expression.text)) {
            analysis.usesTestFramework = true;
          }
        }

        if (ts.isExportAssignment(statement)) {
          analysis.localImplementationCount += 1;
          addExport(analysis, "default", "value", { local: true, defaultExport: true });
          continue;
        }

        if (ts.isExportDeclaration(statement)) {
          const isReExport = Boolean(statement.moduleSpecifier);
          if (isReExport) {
            analysis.directReExportCount += 1;
          }

          if (!statement.exportClause) {
            analysis.hasWildcardReExport = true;
            continue;
          }

          if (ts.isNamedExports(statement.exportClause)) {
            for (const element of statement.exportClause.elements) {
              const exportName = element.name.text;
              const isTypeOnly = statement.isTypeOnly || element.isTypeOnly;
              addExport(analysis, exportName, isTypeOnly ? "type" : "value", isReExport ? {} : { local: true });
            }
          }
          continue;
        }

        if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
          analysis.localImplementationCount += 1;
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name)) {
              addExport(analysis, declaration.name.text, "value", { local: true });
            }
          }
          continue;
        }

        if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
          analysis.localImplementationCount += 1;
          if (hasDefaultModifier(statement)) {
            addExport(analysis, "default", "value", { local: true, defaultExport: true });
          } else if (statement.name) {
            addExport(analysis, statement.name.text, "value", { local: true });
          }
          continue;
        }

        if (ts.isClassDeclaration(statement) && hasExportModifier(statement)) {
          analysis.localImplementationCount += 1;
          if (hasDefaultModifier(statement)) {
            addExport(analysis, "default", "value", { local: true, defaultExport: true });
          } else if (statement.name) {
            addExport(analysis, statement.name.text, "value", { local: true });
          }
          continue;
        }

        if (ts.isInterfaceDeclaration(statement) && hasExportModifier(statement)) {
          addExport(analysis, statement.name.text, "type", { local: true });
          continue;
        }

        if (ts.isTypeAliasDeclaration(statement) && hasExportModifier(statement)) {
          addExport(analysis, statement.name.text, "type", { local: true });
          continue;
        }

        if (ts.isEnumDeclaration(statement) && hasExportModifier(statement)) {
          analysis.localImplementationCount += 1;
          addExport(analysis, statement.name.text, "value", { local: true });
          continue;
        }

        if (ts.isModuleDeclaration(statement) && hasExportModifier(statement)) {
          analysis.localImplementationCount += 1;
          addExport(analysis, statement.name.getText(sourceFile), "value", { local: true });
          continue;
        }
      }

      return analysis;
    },
  };
}
