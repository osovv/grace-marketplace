import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaHarness } from "./helpers/prisma-harness";
import { withTestApp } from "./helpers/http";

const { state, prismaMock, resetState } = createPrismaHarness();

describe("Phase 2 integration", () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
    vi.doMock("../src/lib/prisma.js", () => ({ prisma: prismaMock }));
  });

  it("V-M-013: enforces MoveCoins idempotency by actionId", async () => {
    await withTestApp(async (app) => {
      const first = await app.inject({
        method: "POST",
        url: "/v1/movecoins/mutate",
        payload: {
          tgId: "tg-normal",
          actionId: "act-1",
          amount: 20,
          actionType: "accrual",
        },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ created: true });

      const second = await app.inject({
        method: "POST",
        url: "/v1/movecoins/mutate",
        payload: {
          tgId: "tg-normal",
          actionId: "act-1",
          amount: 20,
          actionType: "accrual",
        },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ created: false });
      expect(state.transactions).toHaveLength(1);
    });
  });

  it("V-M-015: blocks campaign transition for suppressed user", async () => {
    await withTestApp(async (app) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/campaign/advance",
        payload: {
          tgId: "tg-red",
          campaignKey: "default-conversion",
          nextStep: "nurture",
          transitionKey: "tr-1",
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.advanced).toBe(false);
      expect(body.blocked).toBe(true);
      expect(state.events).toHaveLength(0);
    });
  });
});
