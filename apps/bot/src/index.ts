import { Telegraf } from "telegraf";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
loadEnv({ path: path.resolve(currentDir, "../.env"), quiet: true });

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is required");

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000/v1";
const sharedSecret = process.env.BOT_LOCALE_SHARED_SECRET;
const tmaBaseUrl = process.env.TMA_BASE_URL ?? "http://localhost:3000";
const bot = new Telegraf(token);

function normalizeLocale(value?: string): "ru" | "en" | "ky" {
  const normalized = value?.slice(0, 2).toLowerCase();
  if (normalized === "en") return "en";
  if (normalized === "ky") return "ky";
  return "ru";
}

function normalizeStartapp(value?: string): "diagnostic" | "player" | "sos" {
  if (value === "player") return "player";
  if (value === "sos") return "sos";
  return "diagnostic";
}

function buildMiniAppLink(locale: "ru" | "en" | "ky", startapp: "diagnostic" | "player" | "sos"): string {
  const cleanBase = tmaBaseUrl.replace(/\/+$/, "");
  return `${cleanBase}/${locale}?startapp=${startapp}`;
}

bot.start(async (ctx) => {
  const tgId = String(ctx.from.id);
  const locale = ctx.from.language_code;
  const resolvedLocale = normalizeLocale(locale);
  const rawPayload = ctx.message?.text?.split(" ").slice(1).join(" ");
  const startapp = normalizeStartapp(rawPayload);

  try {
    const response = await fetch(`${apiBaseUrl}/bot/locale`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(sharedSecret ? { "x-bot-secret": sharedSecret } : {}),
      },
      body: JSON.stringify({ tgId, locale: resolvedLocale }),
    });

    if (!response.ok) {
      throw new Error(`Locale sync failed with status ${response.status}`);
    }

    const launchLink = buildMiniAppLink(resolvedLocale, startapp);
    await ctx.reply(`Welcome! Locale synced. Open FreeMove: ${launchLink}`);
  } catch (error) {
    console.error("[BOT][start] locale sync failed", { tgId, error });
    await ctx.reply("Welcome! We could not sync your locale yet, but you can continue.");
  }
});

bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));