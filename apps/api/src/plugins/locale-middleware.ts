import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { resolveLocale } from "../domain/i18n/resolution-service.js";

const localeMiddleware: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request) => {
    const headerTgId = request.headers["x-telegram-id"];
    const tgId = Array.isArray(headerTgId) ? headerTgId[0] : headerTgId;

    request.tgId = tgId;
    request.resolvedLocale = await resolveLocale({
      tgId,
      acceptLanguage: request.headers["accept-language"],
    });
  });
};

export default fp(localeMiddleware);
