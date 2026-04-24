import { MoveCoinsActionType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { auditLog } from "../../lib/audit.js";

type ApplyMoveCoinsInput = {
  tgId: string;
  actionId: string;
  amount: number;
  actionType: MoveCoinsActionType;
  reason?: string;
};

export async function applyMoveCoinsMutation(input: ApplyMoveCoinsInput): Promise<{
  created: boolean;
}> {
  const user = await prisma.user.findUnique({
    where: { tgId: input.tgId },
    select: { id: true, mobilityIndex: true },
  });
  if (!user) throw new Error("User not found");

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.moveCoinsTransaction.findUnique({
        where: { userId_actionId: { userId: user.id, actionId: input.actionId } },
        select: { id: true },
      });

      if (existing) {
        auditLog("M-013", "applyMoveCoinsMutation", "IDEMPOTENCY", "Mutation skipped by actionId", {
          userId: user.id,
          actionId: input.actionId,
        });
        return { created: false };
      }

      const userBalance = await tx.user.findUnique({
        where: { id: user.id },
        select: { mobilityIndex: true },
      });
      const currentBalance = userBalance?.mobilityIndex ?? 0;
      const delta = input.actionType === MoveCoinsActionType.accrual ? input.amount : -input.amount;
      const nextBalance = currentBalance + delta;

      if (nextBalance < 0) {
        auditLog("M-013", "applyMoveCoinsMutation", "BALANCE_GUARD", "Mutation blocked due to negative balance", {
          userId: user.id,
          actionId: input.actionId,
          currentBalance,
          requestedDelta: delta,
        });
        throw new Error("Insufficient balance");
      }

      await tx.moveCoinsTransaction.create({
        data: {
          userId: user.id,
          actionId: input.actionId,
          actionType: input.actionType,
          amount: input.amount,
          reason: input.reason,
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { mobilityIndex: nextBalance },
      });

      auditLog("M-023", "applyMoveCoinsMutation", "LEDGER", "MoveCoins mutation committed", {
        userId: user.id,
        actionId: input.actionId,
        actionType: input.actionType,
        amount: input.amount,
        nextBalance,
      });

      return { created: true };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Handle race condition on unique(userId, actionId) as idempotent replay.
      auditLog("M-013", "applyMoveCoinsMutation", "RACE_REPLAY", "Mutation replay handled by unique key", {
        userId: user.id,
        actionId: input.actionId,
      });
      return { created: false };
    }
    throw error;
  }
}
