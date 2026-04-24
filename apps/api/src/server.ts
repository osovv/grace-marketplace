import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import localeMiddleware from "./plugins/locale-middleware.js";
import movecoinsRoute from "./routes/movecoins.js";
import panicRoute from "./routes/panic.js";
import campaignRoute from "./routes/campaign.js";
import contentRoute from "./routes/content.js";
import botRoute from "./routes/bot.js";
import { appConfig } from "./config.js";

export async function buildServer() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(sensible);

  app.get("/", async () => ({ status: "ok", service: "api" }));
  app.get("/health", async () => ({ status: "ok" }));

  await app.register(localeMiddleware);
  await app.register(contentRoute, { prefix: "/v1" });
  await app.register(movecoinsRoute, { prefix: "/v1" });
  await app.register(panicRoute, { prefix: "/v1" });
  await app.register(campaignRoute, { prefix: "/v1" });
  await app.register(botRoute, { prefix: "/v1" });
  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer();
  await app.listen({ port: appConfig.port, host: "0.0.0.0" });
}
