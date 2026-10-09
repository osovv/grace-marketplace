import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";

import {
  getMaxEscalations,
  getTelegram,
  loadAfkConfig,
  resolveAfkConfigPath,
} from "./afk/config";

function tmpProject() {
  return mkdtempSync(path.join(os.tmpdir(), "grace-afk-config-"));
}

function tmpHome() {
  return mkdtempSync(path.join(os.tmpdir(), "grace-afk-home-"));
}

function writeGlobalConfig(home: string, body: unknown) {
  const dir = path.join(home, ".grace");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "afk.json"), JSON.stringify(body));
}

describe("resolveAfkConfigPath", () => {
  it("returns null when no candidate exists", () => {
    const root = tmpProject();
    const home = tmpHome();
    expect(resolveAfkConfigPath(root, { env: {}, home })).toBeNull();
  });

  it("uses $GRACE_AFK_CONFIG when it points to an existing file", () => {
    const root = tmpProject();
    const home = tmpHome();
    const envPath = path.join(tmpProject(), "custom.json");
    writeFileSync(envPath, "{}");

    const resolved = resolveAfkConfigPath(root, {
      env: { GRACE_AFK_CONFIG: envPath },
      home,
    });
    expect(resolved?.source).toBe("env");
    expect(resolved?.filePath).toBe(envPath);
  });

  it("prefers project-local over global", () => {
    const root = tmpProject();
    const home = tmpHome();
    writeFileSync(path.join(root, ".grace-afk.json"), "{}");
    writeGlobalConfig(home, { telegram: { botToken: "g", chatId: "g" } });

    const resolved = resolveAfkConfigPath(root, { env: {}, home });
    expect(resolved?.source).toBe("project");
    expect(resolved?.filePath).toBe(path.join(root, ".grace-afk.json"));
  });

  it("falls back to global when project-local is absent", () => {
    const root = tmpProject();
    const home = tmpHome();
    writeGlobalConfig(home, { telegram: { botToken: "g", chatId: "g" } });

    const resolved = resolveAfkConfigPath(root, { env: {}, home });
    expect(resolved?.source).toBe("global");
    expect(resolved?.filePath).toBe(path.join(home, ".grace", "afk.json"));
  });

  it("ignores $GRACE_AFK_CONFIG when the referenced file is missing", () => {
    const root = tmpProject();
    const home = tmpHome();
    writeGlobalConfig(home, {});

    const resolved = resolveAfkConfigPath(root, {
      env: { GRACE_AFK_CONFIG: "/path/that/does/not/exist.json" },
      home,
    });
    expect(resolved?.source).toBe("global");
  });
});

describe("loadAfkConfig", () => {
  it("returns null + descriptive error when no config exists anywhere", () => {
    const root = tmpProject();
    const home = tmpHome();
    const { config, source, error } = loadAfkConfig(root, { env: {}, home });

    expect(config).toBeNull();
    expect(source).toBeNull();
    expect(error).toContain("grace-afk config not found");
  });

  it("parses a valid project-local config and reports source=project", () => {
    const root = tmpProject();
    const home = tmpHome();
    writeFileSync(
      path.join(root, ".grace-afk.json"),
      JSON.stringify({
        telegram: { botToken: "abc", chatId: "123" },
        autoStop: { maxEscalationsPerSession: 5 },
      }),
    );

    const { config, source, error } = loadAfkConfig(root, { env: {}, home });

    expect(error).toBeNull();
    expect(source).toBe("project");
    expect(config?.telegram?.botToken).toBe("abc");
    expect(config?.telegram?.chatId).toBe("123");
    expect(config?.autoStop?.maxEscalationsPerSession).toBe(5);
  });

  it("parses a global config when no project-local override exists", () => {
    const root = tmpProject();
    const home = tmpHome();
    writeGlobalConfig(home, {
      telegram: { botToken: "global-token", chatId: "global-chat" },
    });

    const { config, source, error } = loadAfkConfig(root, { env: {}, home });

    expect(error).toBeNull();
    expect(source).toBe("global");
    expect(config?.telegram?.botToken).toBe("global-token");
  });

  it("returns null + error on invalid JSON at the resolved path", () => {
    const root = tmpProject();
    const home = tmpHome();
    writeFileSync(path.join(root, ".grace-afk.json"), "{ not valid json");

    const { config, source, error } = loadAfkConfig(root, { env: {}, home });

    expect(config).toBeNull();
    expect(source).toBeNull();
    expect(error).toContain("Failed to parse");
  });
});

describe("getTelegram", () => {
  it("returns null if config is null", () => {
    expect(getTelegram(null)).toBeNull();
  });

  it("returns null if botToken is missing", () => {
    expect(getTelegram({ telegram: { botToken: "", chatId: "1" } })).toBeNull();
  });

  it("returns null if chatId is missing", () => {
    expect(getTelegram({ telegram: { botToken: "1", chatId: "" } })).toBeNull();
  });

  it("returns the credentials when both are present", () => {
    const result = getTelegram({ telegram: { botToken: "token", chatId: "chat" } });
    expect(result).toEqual({ botToken: "token", chatId: "chat" });
  });
});

describe("getMaxEscalations", () => {
  it("defaults to 3 when config is null", () => {
    expect(getMaxEscalations(null)).toBe(3);
  });

  it("defaults to 3 when autoStop is not set", () => {
    expect(getMaxEscalations({})).toBe(3);
  });

  it("honors a configured value", () => {
    expect(getMaxEscalations({ autoStop: { maxEscalationsPerSession: 7 } })).toBe(7);
  });

  it("falls back when configured value is negative or non-finite", () => {
    expect(getMaxEscalations({ autoStop: { maxEscalationsPerSession: -1 } })).toBe(3);
    expect(getMaxEscalations({ autoStop: { maxEscalationsPerSession: Number.NaN } })).toBe(3);
  });

  it("accepts a custom fallback", () => {
    expect(getMaxEscalations(null, 10)).toBe(10);
  });
});
