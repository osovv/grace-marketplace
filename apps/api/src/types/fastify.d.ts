import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    resolvedLocale?: "ru" | "en" | "xx" | "ky";
    tgId?: string;
  }
}
