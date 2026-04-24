import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaHarness } from "./helpers/prisma-harness";
import { withTestApp } from "./helpers/http";

const { prismaMock, resetState } = createPrismaHarness();

describe("Campaign replay safety", () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
    vi.doMock("../src/lib/prisma.js", () => ({ prisma: prismaMock }));
  });

  it("handles transition replay race via P2002 as replayed", async () => {
    await withTestApp(async (app) => {
      const originalCreate = prismaMock.campaignEvent.create;
      prismaMock.campaignEvent.create = vi.fn(async () => {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "test",
        });
      });

      const response = await app.inject({
        method: "POST",
        url: "/v1/campaign/advance",
        payload: {
          tgId: "tg-normal",
          campaignKey: "default-conversion",
          nextStep: "nurture",
          transitionKey: "race-key-1",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ advanced: false, replayed: true });

      prismaMock.campaignEvent.create = originalCreate;
    });
  });
});
