import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { createEscalationInTransaction, notifyEscalationBestEffort } from "../domain/safety/red-flag-guard.js";
import { auditLog } from "../lib/audit.js";

const panicSchema = z.object({
  tgId: z.string(),
  exerciseId: z.string().optional(),
  sessionRef: z.string().optional(),
});

const panicRoute: FastifyPluginAsync = async (app) => {
  app.post("/safety/panic", async (request, reply) => {
    const body = panicSchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { tgId: body.tgId },
      select: { id: true, tgId: true, age: true, gender: true },
    });
    if (!user) return reply.notFound("User not found");

    await prisma.$transaction(async (tx) => {
      await createEscalationInTransaction(tx, {
        user,
        source: "panic_button",
        triggerCode: "UC-005",
        details: { exerciseId: body.exerciseId, sessionRef: body.sessionRef },
      });

      await tx.panicEvent.create({
        data: {
          userId: user.id,
          exerciseId: body.exerciseId,
          sessionRef: body.sessionRef,
        },
      });
    });

    await notifyEscalationBestEffort({
      user,
      source: "panic_button",
      triggerCode: "UC-005",
      details: { exerciseId: body.exerciseId, sessionRef: body.sessionRef },
    });

    auditLog("M-026", "panicRoute", "PANIC", "Panic escalation dispatched", {
      userId: user.id,
    });

    return reply.send({ escalated: true });
  });
};

export default panicRoute;
