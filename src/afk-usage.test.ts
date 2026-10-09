import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import { readUsage, renderUsageLine } from "./afk/usage";

function tmpFile(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "grace-usage-"));
  return path.join(dir, "statusline-usage-cache.json");
}

describe("readUsage", () => {
  it("returns null when the cache file is missing", () => {
    expect(readUsage("/does/not/exist")).toBeNull();
  });

  it("returns null when the JSON is malformed", () => {
    const file = tmpFile();
    writeFileSync(file, "{ not json");
    expect(readUsage(file)).toBeNull();
  });

  it("parses five_hour / seven_day / extra_usage fields", () => {
    const file = tmpFile();
    writeFileSync(
      file,
      JSON.stringify({
        five_hour: { utilization: 7, resets_at: "2026-04-19T07:00:00+00:00" },
        seven_day: { utilization: 21.4, resets_at: "2026-04-23T18:00:00+00:00" },
        extra_usage: {
          is_enabled: true,
          monthly_limit: 6000,
          used_credits: 1468,
          utilization: 24.47,
          currency: "USD",
        },
      }),
    );

    const snap = readUsage(file)!;
    expect(snap.fiveHourPct).toBe(7);
    expect(snap.sevenDayPct).toBe(21);
    expect(snap.fiveHourResetsAt).toContain("2026-04-19T07");
    expect(snap.extra?.usedCredits).toBeCloseTo(14.68, 2);
    expect(snap.extra?.monthlyLimit).toBeCloseTo(60, 2);
    expect(snap.extra?.currency).toBe("USD");
  });

  it("returns extra=null when extra_usage.is_enabled is false", () => {
    const file = tmpFile();
    writeFileSync(
      file,
      JSON.stringify({
        five_hour: { utilization: 10 },
        seven_day: { utilization: 5 },
        extra_usage: { is_enabled: false },
      }),
    );
    const snap = readUsage(file)!;
    expect(snap.extra).toBeNull();
  });

  it("returns null when neither five_hour nor seven_day utilization is present", () => {
    const file = tmpFile();
    writeFileSync(file, JSON.stringify({ unrelated: 1 }));
    expect(readUsage(file)).toBeNull();
  });
});

describe("renderUsageLine", () => {
  it("emits the fallback when snapshot is null", () => {
    expect(renderUsageLine(null)).toContain("unavailable");
  });

  it("formats 5h/7d and $ line in one line separated by middle dots", () => {
    const line = renderUsageLine({
      fiveHourPct: 7,
      sevenDayPct: 21,
      fiveHourResetsAt: null,
      sevenDayResetsAt: null,
      extra: { usedCredits: 14.68, monthlyLimit: 60, currency: "USD", pct: 24.47 },
      ageSeconds: 5,
      source: "mock",
    });
    expect(line).toContain("5h 7%");
    expect(line).toContain("7d 21%");
    expect(line).toContain("$14.68/60.00");
    expect(line).toContain("cache age 5s");
  });
});
