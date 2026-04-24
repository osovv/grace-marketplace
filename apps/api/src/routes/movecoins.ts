import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { MoveCoinsActionType } from "@prisma/client";
import { applyMoveCoinsMutation } from "../domain/movecoins/service.js";

const bodySchema = z.object({
  tgId: z.string(),
  actionId: z.string().min(1),
  amount: z.number().int().positive(),
  actionType: z.nativeEnum(MoveCoinsActionType),
  reason: z.string().optional(),
});

const movecoinsRoute: FastifyPluginAsync = async (app) => {
  app.post("/movecoins/mutate", async (request, reply) => {
    const body = bodySchema.parse(request.body);
    try {
      const result = await applyMoveCoinsMutation(body);
      return reply.send(result);
    } catch (error) {
      if (error instanceof Error && error.message === "Insufficient balance") {
        return reply.badRequest("Insufficient balance");
      }
      throw error;
    }
  });
};

export default movecoinsRoute;
