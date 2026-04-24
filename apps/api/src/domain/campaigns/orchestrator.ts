import { CampaignStep, CampaignEventType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { auditLog } from "../../lib/audit.js";
import { blockSuppressedCampaignActionsByTgId } from "./red-flag-suppression-guard.js";

export async function canRunCampaignStep(tgId: string): Promise<{ allowed: boolean; reason?: string }> {
  const suppression = await blockSuppressedCampaignActionsByTgId(tgId);
  if (suppression.blocked) {
    auditLog("M-024", "canRunCampaignStep", "BLOCK", "Campaign step blocked by suppression", {
      tgId,
      reason: suppression.reason,
    });
    return { allowed: false, reason: suppression.reason };
  }
  auditLog("M-024", "canRunCampaignStep", "ALLOW", "Campaign step allowed", { tgId });
  return { allowed: true };
}

type AdvanceCampaignStepInput = {
  tgId: string;
  campaignKey: string;
  nextStep: CampaignStep;
  transitionKey: string;
  payload?: Prisma.InputJsonValue;
};

export async function advanceCampaignStep(input: AdvanceCampaignStepInput): Promise<{
  advanced: boolean;
  replayed?: boolean;
  blocked?: boolean;
  reason?: string;
}> {
  const suppression = await blockSuppressedCampaignActionsByTgId(input.tgId);
  if (suppression.blocked) {
    auditLog("M-024", "advanceCampaignStep", "SUPPRESSED", "Transition blocked by medical suppression", {
      tgId: input.tgId,
      reason: suppression.reason,
    });
    return { advanced: false, blocked: true, reason: suppression.reason };
  }

  const user = await prisma.user.findUnique({
    where: { tgId: input.tgId },
    select: { id: true },
  });
  if (!user) return { advanced: false, reason: "User not found" };

  const enrollment = await prisma.campaignEnrollment.findFirst({
    where: {
      userId: user.id,
      campaign: { key: input.campaignKey, active: true },
    },
    include: { campaign: true },
  });
  if (!enrollment) return { advanced: false, reason: "Enrollment not found" };

  const replayEvent = await prisma.campaignEvent.findUnique({
    where: {
      enrollmentId_transitionKey: {
        enrollmentId: enrollment.id,
        transitionKey: input.transitionKey,
      },
    },
    select: { id: true },
  });
  if (replayEvent) {
    auditLog("M-024", "advanceCampaignStep", "REPLAY", "Transition replay skipped", {
      enrollmentId: enrollment.id,
      transitionKey: input.transitionKey,
    });
    return { advanced: false, replayed: true };
  }

  const defs = await prisma.campaignStepDef.findMany({
    where: { campaignId: enrollment.campaignId, active: true },
    orderBy: { orderNo: "asc" },
  });
  const currentDef = defs.find((d) => d.step === enrollment.currentStep);
  const nextDef = defs.find((d) => d.step === input.nextStep);
  if (!currentDef || !nextDef) {
    return { advanced: false, reason: "Step definition missing" };
  }
  if (nextDef.orderNo <= currentDef.orderNo) {
    return { advanced: false, reason: "Invalid transition order" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.campaignEnrollment.update({
        where: { id: enrollment.id },
        data: { currentStep: input.nextStep },
      });

      await tx.campaignEvent.create({
        data: {
          enrollmentId: enrollment.id,
          eventType: CampaignEventType.transition,
          step: input.nextStep,
          transitionKey: input.transitionKey,
          payload: input.payload,
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      auditLog("M-024", "advanceCampaignStep", "RACE_REPLAY", "Transition replay handled by unique key", {
        enrollmentId: enrollment.id,
        transitionKey: input.transitionKey,
      });
      return { advanced: false, replayed: true };
    }
    throw error;
  }

  auditLog("M-024", "advanceCampaignStep", "ADVANCE", "Campaign transition committed", {
    enrollmentId: enrollment.id,
    from: enrollment.currentStep,
    to: input.nextStep,
    transitionKey: input.transitionKey,
  });

  return { advanced: true };
}
