import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaHarness } from "./helpers/prisma-harness";
import { withTestApp } from "./helpers/http";

const { state, prismaMock, resetState } = createPrismaHarness();

describe("MoveCoins balance guard", () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
    vi.doMock("../src/lib/prisma.js", () => ({ prisma: prismaMock }));
  });

  it("blocks debit when balance would go negative", async () => {
    await withTestApp(async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/movecoins/mutate",
        payload: {
          tgId: "tg-normal",
          actionId: "act-debit-negative",
          amount: 10,
          actionType: "debit",
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain("Insufficient balance");
      expect(state.transactions).toHaveLength(0);
    });
  });
});
