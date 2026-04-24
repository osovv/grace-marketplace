import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { CampaignStep } from "@prisma/client";
import { canRunCampaignStep, advanceCampaignStep } from "../domain/campaigns/orchestrator.js";

const bodySchema = z.object({ tgId: z.string() });
const advanceSchema = z.object({
  tgId: z.string(),
  campaignKey: z.string(),
  nextStep: z.nativeEnum(CampaignStep),
  transitionKey: z.string().min(1),
  payload: z.record(z.any()).optional(),
});

const campaignRoute: FastifyPluginAsync = async (app) => {
  app.post("/campaign/can-send", async (request, reply) => {
    const body = bodySchema.parse(request.body);
    const result = await canRunCampaignStep(body.tgId);
    return reply.send({ canSend: result.allowed, reason: result.reason });
  });

  app.post("/campaign/advance", async (request, reply) => {
    const body = advanceSchema.parse(request.body);
    const result = await advanceCampaignStep(body);
    return reply.send(result);
  });
};

export default campaignRoute;
