import { MedicalStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { auditLog } from "../../lib/audit.js";

export async function blockSuppressedCampaignActionsByTgId(tgId: string): Promise<{
  blocked: boolean;
  reason?: string;
}> {
  const user = await prisma.user.findUnique({
    where: { tgId },
    select: { id: true, medicalStatus: true },
  });
  if (!user) return { blocked: false };

  const blocked = user.medicalStatus !== MedicalStatus.normal;
  const reason = blocked
    ? `medicalStatus=${user.medicalStatus}`
    : undefined;

  auditLog(
    "M-027",
    "blockSuppressedCampaignActionsByTgId",
    "SUPPRESSION",
    blocked ? "Campaign action blocked by suppression guard" : "Campaign action allowed",
    { userId: user.id, reason },
  );

  return { blocked, reason };
}
