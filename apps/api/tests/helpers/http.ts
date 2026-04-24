import type { FastifyInstance } from "fastify";

export async function withTestApp<T>(runner: (app: FastifyInstance) => Promise<T>): Promise<T> {
  const { buildServer } = await import("../../src/server.js");
  const app = await buildServer();
  try {
    return await runner(app);
  } finally {
    await app.close();
  }
}
