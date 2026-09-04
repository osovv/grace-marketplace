// FILE: src/afk/config.ts
// VERSION: 1.1.0
// START_MODULE_CONTRACT
//   PURPOSE: Parse grace-afk.json holding Telegram credentials and autoStop caps for /afk sessions, with a lookup priority that lets one global config serve all projects on the machine.
//   SCOPE: Read-only config loading + accessor helpers. Resolves config path via env override, project-local, then global user-home location. No I/O beyond fs.readFileSync.
//   DEPENDS: node:fs, node:os, node:path
//   LINKS: M-AFK-CONFIG
//   ROLE: RUNTIME
//   MAP_MODE: EXPORTS
// END_MODULE_CONTRACT
//
// START_MODULE_MAP
//   AfkConfig              - Shape of grace-afk.json: telegram credentials + autoStop caps
//   ConfigSource           - Which location on disk the loaded config came from
//   resolveAfkConfigPath   - Apply env/project/global lookup order; returns path + source or null
//   loadAfkConfig          - Read and parse grace-afk.json from the resolved location
//   getTelegram            - Extract botToken/chatId; returns null if either missing
//   getMaxEscalations      - Resolve per-session escalation cap; default 3
// END_MODULE_MAP

import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type AfkConfig = {
  telegram?: {
    botToken: string;
    chatId: string;
  };
  autoStop?: {
    maxEscalationsPerSession?: number;
  };
};

export type ConfigSource = "env" | "project" | "global";

const PROJECT_CONFIG_FILE = ".grace-afk.json";
const GLOBAL_CONFIG_SUBDIR = ".grace";
const GLOBAL_CONFIG_FILE = "afk.json";
const ENV_OVERRIDE = "GRACE_AFK_CONFIG";

// START_CONTRACT: resolveAfkConfigPath
//   PURPOSE: Resolve which grace-afk config path to use for a given project root, by priority: $GRACE_AFK_CONFIG env override, then <projectRoot>/.grace-afk.json, then <home>/.grace/afk.json.
//   INPUTS: { projectRoot: string - absolute path to the project root, env?: NodeJS.ProcessEnv - environment to read (defaults to process.env), home?: string - home directory override for tests }
//   OUTPUTS: { filePath: string, source: ConfigSource } | null - null when no candidate exists
//   SIDE_EFFECTS: reads environment + filesystem existsSync checks only
// END_CONTRACT: resolveAfkConfigPath
export function resolveAfkConfigPath(
  projectRoot: string,
  options: { env?: NodeJS.ProcessEnv; home?: string } = {},
): { filePath: string; source: ConfigSource } | null {
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();

  const envOverride = env[ENV_OVERRIDE];
  if (envOverride && existsSync(envOverride)) {
    return { filePath: envOverride, source: "env" };
  }

  const projectPath = path.join(projectRoot, PROJECT_CONFIG_FILE);
  if (existsSync(projectPath)) {
    return { filePath: projectPath, source: "project" };
  }

  const globalPath = path.join(home, GLOBAL_CONFIG_SUBDIR, GLOBAL_CONFIG_FILE);
  if (existsSync(globalPath)) {
    return { filePath: globalPath, source: "global" };
  }

  return null;
}

// START_CONTRACT: loadAfkConfig
//   PURPOSE: Resolve the grace-afk config path and parse it. Accepts any of: env override, project-local .grace-afk.json, or global ~/.grace/afk.json.
//   INPUTS: { projectRoot: string - absolute path to the project root, options?: { env?: NodeJS.ProcessEnv, home?: string } - test hooks }
//   OUTPUTS: { config: AfkConfig | null, source: ConfigSource | null, error: string | null } - exactly one of (config,source) or error is populated
//   SIDE_EFFECTS: Reads the file system. Never throws; all failures surface in `error`.
// END_CONTRACT: loadAfkConfig
export function loadAfkConfig(
  projectRoot: string,
  options: { env?: NodeJS.ProcessEnv; home?: string } = {},
): { config: AfkConfig | null; source: ConfigSource | null; error: string | null } {
  const resolved = resolveAfkConfigPath(projectRoot, options);
  if (!resolved) {
    return {
      config: null,
      source: null,
      error: `grace-afk config not found. Looked at $${ENV_OVERRIDE}, ${path.join(projectRoot, PROJECT_CONFIG_FILE)}, and ~/${GLOBAL_CONFIG_SUBDIR}/${GLOBAL_CONFIG_FILE}`,
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(resolved.filePath, "utf8")) as AfkConfig;
    return { config: parsed, source: resolved.source, error: null };
  } catch (error) {
    return {
      config: null,
      source: null,
      error: `Failed to parse grace-afk config at ${resolved.filePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// START_CONTRACT: getTelegram
//   PURPOSE: Return Telegram credentials only when both botToken and chatId are present.
//   INPUTS: { config: AfkConfig | null }
//   OUTPUTS: { botToken: string, chatId: string } | null
//   SIDE_EFFECTS: none
// END_CONTRACT: getTelegram
export function getTelegram(config: AfkConfig | null) {
  if (!config?.telegram?.botToken || !config.telegram.chatId) {
    return null;
  }
  return { botToken: config.telegram.botToken, chatId: config.telegram.chatId };
}

// START_CONTRACT: getMaxEscalations
//   PURPOSE: Resolve the per-session Telegram-escalation cap with a safe default.
//   INPUTS: { config: AfkConfig | null, fallback?: number - default 3 }
//   OUTPUTS: number - finite, non-negative
//   SIDE_EFFECTS: none
// END_CONTRACT: getMaxEscalations
export function getMaxEscalations(config: AfkConfig | null, fallback = 3) {
  const value = config?.autoStop?.maxEscalationsPerSession;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return fallback;
}

// START_CHANGE_SUMMARY
//   LAST_CHANGE: [4.0.0-beta.2] Add config lookup priority: $GRACE_AFK_CONFIG env > <project>/.grace-afk.json > ~/.grace/afk.json. Any Claude Code session on the machine can now share one Telegram config without per-project setup. loadAfkConfig now also returns `source` (env/project/global).
// END_CHANGE_SUMMARY
