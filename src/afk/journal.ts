// FILE: src/afk/journal.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Append-only writers for /afk session journals (decisions.md + deferred.md).
//   SCOPE: Ensure header on first write, append structured entries, read raw text. No deletion.
//   DEPENDS: node:fs
//   LINKS: M-AFK-JOURNAL
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   DecisionClass     - Closed set of decision-class labels used by grace-afk autonomy matrix
//   DECISION_CLASSES  - Readonly array of all decision classes (for CLI validation)
//   isDecisionClass   - Type guard narrowing string to DecisionClass
//   DecisionEntry     - Shape of a single line in decisions.md
//   DeferredEntry     - Shape of a single line in deferred.md
//   appendDecision    - Append a decision entry (writes header if file is new)
//   appendDeferred    - Append a deferred question (writes header if file is new)
//   readJournal       - Return journal file contents or empty string if missing
// END_MODULE_MAP

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

export type DecisionClass =
  | "reversible-act"
  | "uncertain-deferred"
  | "one-way-door-escalated"
  | "one-way-door-deferred"
  | "scope-creep-deferred"
  | "threshold-yellow-rollback"
  | "threshold-red-escalated"
  | "checkpoint";

export const DECISION_CLASSES: readonly DecisionClass[] = [
  "reversible-act",
  "uncertain-deferred",
  "one-way-door-escalated",
  "one-way-door-deferred",
  "scope-creep-deferred",
  "threshold-yellow-rollback",
  "threshold-red-escalated",
  "checkpoint",
];

export function isDecisionClass(value: string): value is DecisionClass {
  return (DECISION_CLASSES as readonly string[]).includes(value);
}

export type DecisionEntry = {
  timestamp: string;
  klass: DecisionClass;
  title: string;
  context: string;
  optionsConsidered?: string[];
  chosen?: string;
  rationale: string;
  outcome: string;
};

// START_BLOCK_HEADER_ENSURE
function ensureHeader(filePath: string, header: string) {
  if (!existsSync(filePath)) {
    writeFileSync(filePath, header);
  }
}
// END_BLOCK_HEADER_ENSURE

// START_CONTRACT: appendDecision
//   PURPOSE: Append one structured decision entry to `decisions.md`.
//   INPUTS: { filePath: string, entry: DecisionEntry }
//   OUTPUTS: void
//   SIDE_EFFECTS: Writes header if file is new; appends a multi-line markdown block otherwise.
// END_CONTRACT: appendDecision
export function appendDecision(filePath: string, entry: DecisionEntry) {
  ensureHeader(filePath, "# /afk decisions journal\n\n");
  // START_BLOCK_FORMAT_DECISION
  const lines: string[] = [];
  lines.push(`## ${entry.timestamp} — ${entry.title}`);
  lines.push(`- class: \`${entry.klass}\``);
  lines.push(`- context: ${entry.context}`);
  if (entry.optionsConsidered && entry.optionsConsidered.length > 0) {
    lines.push(`- options: ${entry.optionsConsidered.map((option) => `\`${option}\``).join(" | ")}`);
  }
  if (entry.chosen) {
    lines.push(`- chosen: \`${entry.chosen}\``);
  }
  lines.push(`- rationale: ${entry.rationale}`);
  lines.push(`- outcome: ${entry.outcome}`);
  lines.push("");
  appendFileSync(filePath, lines.join("\n") + "\n");
  // END_BLOCK_FORMAT_DECISION
}

export type DeferredEntry = {
  timestamp: string;
  question: string;
  context: string;
  suggestion?: string;
};

// START_CONTRACT: appendDeferred
//   PURPOSE: Append one deferred-question line to `deferred.md`.
//   INPUTS: { filePath: string, entry: DeferredEntry }
//   OUTPUTS: void
//   SIDE_EFFECTS: Writes header if file is new; appends a single line otherwise.
// END_CONTRACT: appendDeferred
export function appendDeferred(filePath: string, entry: DeferredEntry) {
  ensureHeader(filePath, "# /afk deferred for human review\n\nOne line per question. Review on return.\n\n");
  const suggestion = entry.suggestion ? ` (suggestion: ${entry.suggestion})` : "";
  const line = `- [${entry.timestamp}] ${entry.question} — context: ${entry.context}${suggestion}\n`;
  appendFileSync(filePath, line);
}

// START_CONTRACT: readJournal
//   PURPOSE: Return the current contents of a journal file, or empty string if it does not exist.
//   INPUTS: { filePath: string }
//   OUTPUTS: string
//   SIDE_EFFECTS: none
// END_CONTRACT: readJournal
export function readJournal(filePath: string): string {
  if (!existsSync(filePath)) {
    return "";
  }
  return readFileSync(filePath, "utf8");
}

// START_CHANGE_SUMMARY
//   LAST_CHANGE: [3.7.0-grace-afk] Initial module for decisions.md + deferred.md append writers.
//                Added DECISION_CLASSES and isDecisionClass for CLI-side validation of --class arg.
// END_CHANGE_SUMMARY
