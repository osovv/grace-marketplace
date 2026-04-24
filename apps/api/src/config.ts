import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const envFileName = process.env.ENV_FILE ?? ".env";
const envFilePath = path.resolve(currentDir, "../", envFileName);

loadEnv({ path: envFilePath, quiet: true, override: true });

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  JWT_SECRET: z.string().min(24),
  BOT_LOCALE_SHARED_SECRET: z.string().min(24).optional(),
  SUPABASE_URL: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),
  TG_ALERT_BOT_TOKEN: z.string().optional(),
  TG_OPERATOR_CHAT_ID: z.string().optional(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(
    `[CONFIG][env] Invalid environment configuration: ${JSON.stringify(parsedEnv.error.flatten().fieldErrors)}`,
  );
}

export const appConfig = {
  databaseUrl: parsedEnv.data.DATABASE_URL,
  port: parsedEnv.data.PORT,
  nodeEnv: parsedEnv.data.NODE_ENV,
  jwtSecret: parsedEnv.data.JWT_SECRET,
  botLocaleSharedSecret: parsedEnv.data.BOT_LOCALE_SHARED_SECRET,
  supabaseUrl: parsedEnv.data.SUPABASE_URL,
  supabaseAnonKey: parsedEnv.data.SUPABASE_ANON_KEY,
  tgAlertBotToken: parsedEnv.data.TG_ALERT_BOT_TOKEN,
  tgOperatorChatId: parsedEnv.data.TG_OPERATOR_CHAT_ID,
} as const;
