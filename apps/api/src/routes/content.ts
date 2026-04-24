import type { FastifyPluginAsync } from "fastify";
import type { LocaleCode } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const contentRoute: FastifyPluginAsync = async (app) => {
  app.get("/content/exercises", async (request, reply) => {
    const locale: LocaleCode = request.resolvedLocale ?? "ru";
    const localeFilter: LocaleCode[] = locale === "ru" ? ["ru"] : [locale, "ru"];
    const rows = await prisma.exercise.findMany({
      where: { active: true },
      include: {
        translations: {
          where: { locale: { in: localeFilter } },
        },
      },
    });
    return reply.send(
      rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        difficulty: r.difficulty,
        videoUrl: r.videoUrl,
        subtitleMeta: r.subtitleMeta,
        translation: r.translations.find((t) => t.locale === locale) ?? r.translations.find((t) => t.locale === "ru") ?? null,
        locale,
      })),
    );
  });

  app.get("/content/diagnostic-questions", async (request, reply) => {
    const locale: LocaleCode = request.resolvedLocale ?? "ru";
    const localeFilter: LocaleCode[] = locale === "ru" ? ["ru"] : [locale, "ru"];
    const rows = await prisma.diagnosticQuestion.findMany({
      where: { active: true },
      orderBy: { orderNo: "asc" },
      include: {
        translations: { where: { locale: { in: localeFilter } } },
      },
    });
    return reply.send(
      rows.map((r) => ({
        id: r.id,
        code: r.code,
        kind: r.kind,
        orderNo: r.orderNo,
        translation: r.translations.find((t) => t.locale === locale) ?? r.translations.find((t) => t.locale === "ru") ?? null,
        locale,
      })),
    );
  });
};

export default contentRoute;
