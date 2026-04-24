import { MedicalStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { auditLog } from "../../lib/audit.js";
import { sendOperatorEscalationAlert } from "../alerts/operator-alert.js";

type EscalationUser = {
  id: string;
  tgId: string;
  age: number | null;
  gender: string | null;
};

type EscalationInput = {
  source: string;
  triggerCode?: string;
  details?: Prisma.InputJsonValue;
};

export async function enforceSafetyLockByTgId(tgId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { tgId },
    select: { id: true, medicalStatus: true },
  });

  if (!user) return false;

  const isBlocked = user.medicalStatus !== MedicalStatus.normal;
  auditLog("M-015", "enforceSafetyLockByTgId", "CHECK", "Safety guard evaluated", {
    userId: user.id,
    medicalStatus: user.medicalStatus,
    blocked: isBlocked,
  });
  return isBlocked;
}

export async function createEscalationInTransaction(
  tx: Prisma.TransactionClient,
  params: EscalationInput & { user: EscalationUser },
): Promise<void> {
  await tx.medicalEscalation.create({
    data: {
      userId: params.user.id,
      source: params.source,
      triggerCode: params.triggerCode,
      details: params.details,
    },
  });

  await tx.user.update({
    where: { id: params.user.id },
    data: { medicalStatus: MedicalStatus.suppressed },
  });
}

export async function notifyEscalationBestEffort(params: EscalationInput & { user: EscalationUser }): Promise<void> {
  await sendOperatorEscalationAlert({
    userId: params.user.id,
    tgId: params.user.tgId,
    reason: params.triggerCode ?? "medical escalation",
    source: params.source,
    triggerCode: params.triggerCode,
    medicalStatus: MedicalStatus.suppressed,
    age: params.user.age,
    gender: params.user.gender,
  });
}

export async function createEscalation(params: {
  tgId: string;
  source: string;
  triggerCode?: string;
  details?: Prisma.InputJsonValue;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { tgId: params.tgId },
    select: {
      id: true,
      tgId: true,
      age: true,
      gender: true,
      medicalStatus: true,
    },
  });
  if (!user) {
    throw new Error("User not found");
  }

  await prisma.$transaction(async (tx) => {
    await createEscalationInTransaction(tx, {
      user,
      source: params.source,
      triggerCode: params.triggerCode,
      details: params.details,
    });
  });

  await notifyEscalationBestEffort({
    user,
    source: params.source,
    triggerCode: params.triggerCode,
    details: params.details,
  });

  auditLog("M-015", "createEscalation", "ESCALATE", "Medical escalation created", {
    userId: user.id,
    source: params.source,
  });
}
