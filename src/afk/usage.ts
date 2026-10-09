// FILE: src/afk/usage.ts
// VERSION: 1.0.0
// START_MODULE_CONTRACT
//   PURPOSE: Read Claude Code's cached usage snapshot produced by the statusline ($TMPDIR/claude/statusline-usage-cache.json).
//     Provides 5-hour / 7-day utilization percentages and optional extra-credit (dollar) figures that `grace afk` surfaces in reports and `done` notifications.
//   SCOPE: File read only. No network calls. No refresh. Cache is refreshed by the statusline on its own 60-second cycle; grace afk just consumes it.
//   DEPENDS: node:fs, node:os, node:path
//   LINKS: M-AFK-USAGE, skills/grace/grace-afk/SKILL.md
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   UsageSnapshot    - Typed shape: fiveHourPct, sevenDayPct, extra? { used, limit, currency, pct }, ageSeconds
//   UsageExtra       - Shape: { usedCredits, monthlyLimit, currency, pct }
//   readUsage        - Read and parse the cache; returns null when absent or malformed
//   renderUsageLine  - Human-readable one-line summary (for `grace afk report` and done notifications)
//   cachePath        - Resolve the canonical cache path on the current platform
// END_MODULE_MAP

import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type UsageExtra = {
  usedCredits: number;
  monthlyLimit: number;
  currency: string;
  pct: number;
};

export type UsageSnapshot = {
  fiveHourPct: number;
  sevenDayPct: number;
  fiveHourResetsAt: string | null;
  sevenDayResetsAt: string | null;
  extra: UsageExtra | null;
  ageSeconds: number;
  source: string;
};

// START_CONTRACT: cachePath
//   PURPOSE: Resolve the statusline's usage cache path. Claude Code's statusline writes to
//     `${os.tmpdir()}/claude/statusline-usage-cache.json` on all platforms (Git-Bash /tmp on Windows
//     maps to the same AppData\Local\Temp directory that os.tmpdir() returns).
//   INPUTS: none
//   OUTPUTS: string (absolute path)
//   SIDE_EFFECTS: none
// END_CONTRACT: cachePath
export function cachePath(): string {
  return path.join(os.tmpdir(), "claude", "statusline-usage-cache.json");
}

// START_CONTRACT: readUsage
//   PURPOSE: Return the most recent usage snapshot, or null if the cache is missing/malformed.
//   INPUTS: { filePath?: string - optional override for tests }
//   OUTPUTS: UsageSnapshot | null
//   SIDE_EFFECTS: Reads the file system (single file).
// END_CONTRACT: readUsage
export function readUsage(filePath: string = cachePath()): UsageSnapshot | null {
  if (!existsSync(filePath)) {
    return null;
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }

  const fiveHourPct = pickPct(body?.five_hour?.utilization);
  const sevenDayPct = pickPct(body?.seven_day?.utilization);
  if (fiveHourPct === null && sevenDayPct === null) {
    return null;
  }

  let ageSeconds = 0;
  try {
    ageSeconds = Math.max(0, Math.round((Date.now() - statSync(filePath).mtimeMs) / 1000));
  } catch {
    ageSeconds = 0;
  }

  let extra: UsageExtra | null = null;
  const extraBlock = body?.extra_usage;
  if (extraBlock && extraBlock.is_enabled) {
    // Cents -> dollars (the API returns hundredths of currency units).
    const usedCredits = (Number(extraBlock.used_credits) || 0) / 100;
    const monthlyLimit = (Number(extraBlock.monthly_limit) || 0) / 100;
    const pct = Number(extraBlock.utilization) || 0;
    extra = {
      usedCredits,
      monthlyLimit,
      currency: typeof extraBlock.currency === "string" ? extraBlock.currency : "USD",
      pct,
    };
  }

  return {
    fiveHourPct: fiveHourPct ?? 0,
    sevenDayPct: sevenDayPct ?? 0,
    fiveHourResetsAt: typeof body?.five_hour?.resets_at === "string" ? body.five_hour.resets_at : null,
    sevenDayResetsAt: typeof body?.seven_day?.resets_at === "string" ? body.seven_day.resets_at : null,
    extra,
    ageSeconds,
    source: filePath,
  };
}

function pickPct(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value);
}

// START_CONTRACT: renderUsageLine
//   PURPOSE: Produce a single-line summary suitable for Telegram / reports.
//     Example: "5h 7% · 7d 21% · $14.68/60.00 (24%) · cache age 5s"
//   INPUTS: { snapshot: UsageSnapshot | null, fallback?: string }
//   OUTPUTS: string (one line, no control characters)
//   SIDE_EFFECTS: none
// END_CONTRACT: renderUsageLine
export function renderUsageLine(snapshot: UsageSnapshot | null, fallback = "usage: (statusline cache unavailable)"): string {
  if (!snapshot) {
    return fallback;
  }
  const parts: string[] = [];
  parts.push(`5h ${snapshot.fiveHourPct}%`);
  parts.push(`7d ${snapshot.sevenDayPct}%`);
  if (snapshot.extra) {
    const dollars = snapshot.extra.usedCredits.toFixed(2);
    const limit = snapshot.extra.monthlyLimit.toFixed(2);
    const pct = Math.round(snapshot.extra.pct);
    const sign = snapshot.extra.currency === "USD" ? "$" : snapshot.extra.currency + " ";
    parts.push(`${sign}${dollars}/${limit} (${pct}%)`);
  }
  parts.push(`cache age ${snapshot.ageSeconds}s`);
  return parts.join(" · ");
}

// START_CHANGE_SUMMARY
//   LAST_CHANGE: [3.7.0-grace-evolve] Initial. Read-only consumer of the Claude Code statusline usage cache.
// END_CHANGE_SUMMARY
