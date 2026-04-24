import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { persistBotDetectedLocale } from "../domain/i18n/resolution-service.js";
import { appConfig } from "../config.js";

const bodySchema = z.object({
  tgId: z.string(),
  locale: z.string().optional(),
});

const botRoute: FastifyPluginAsync = async (app) => {
  app.post("/bot/locale", async (request, reply) => {
    const expectedSecret = appConfig.botLocaleSharedSecret;
    if (expectedSecret) {
      const incomingSecret = request.headers["x-bot-secret"];
      const value = Array.isArray(incomingSecret) ? incomingSecret[0] : incomingSecret;
      if (value !== expectedSecret) {
        return reply.unauthorized("Invalid bot secret");
      }
    }

    const body = bodySchema.parse(request.body);
    await persistBotDetectedLocale(body.tgId, body.locale);
    return reply.send({ stored: true });
  });
};

export default botRoute;
