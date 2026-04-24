import { vi } from "vitest";

type UserRecord = {
  id: string;
  tgId: string;
  mobilityIndex: number;
  preferredLocale: "ru" | "en" | "ky";
  medicalStatus: "normal" | "red_flag" | "suppressed";
  age?: number;
  gender?: string;
};

export function createPrismaHarness() {
  const state = {
    users: [] as UserRecord[],
    transactions: [] as Array<{ id: string; userId: string; actionId: string; amount: number; actionType: string }>,
    escalations: [] as Array<{ id: string; userId: string; source: string }>,
    panicEvents: [] as Array<{ id: string; userId: string }>,
    campaigns: [{ id: "c1", key: "default-conversion", active: true }],
    enrollments: [] as Array<{ id: string; userId: string; campaignId: string; currentStep: string; suppressed: boolean }>,
    events: [] as Array<{ id: string; enrollmentId: string; transitionKey?: string; step?: string }>,
    stepDefs: [
      { campaignId: "c1", step: "entry", orderNo: 1, active: true },
      { campaignId: "c1", step: "nurture", orderNo: 2, active: true },
      { campaignId: "c1", step: "urgency", orderNo: 3, active: true },
      { campaignId: "c1", step: "last_call", orderNo: 4, active: true },
      { campaignId: "c1", step: "convert", orderNo: 5, active: true },
    ],
  };

  const prismaMock = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.tgId) return state.users.find((u) => u.tgId === where.tgId) ?? null;
        if (where.id) return state.users.find((u) => u.id === where.id) ?? null;
        return null;
      }),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async ({ where, data }: any) => {
        const user = state.users.find((u) => u.id === where.id);
        if (!user) throw new Error("user not found");
        Object.assign(user, data);
        return user;
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        let user = state.users.find((u) => u.tgId === where.tgId);
        if (!user) {
          const created: UserRecord = {
            id: `u${state.users.length + 1}`,
            mobilityIndex: 0,
            medicalStatus: "normal",
            preferredLocale: "ru",
            ...create,
          };
          state.users.push(created);
          user = created;
        } else {
          Object.assign(user, update);
        }
        return user;
      }),
    },
    moveCoinsTransaction: {
      findUnique: vi.fn(async ({ where }: any) =>
        state.transactions.find((t) => t.userId === where.userId_actionId.userId && t.actionId === where.userId_actionId.actionId) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `tx${state.transactions.length + 1}`, ...data };
        state.transactions.push(row);
        return row;
      }),
    },
    medicalEscalation: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `es${state.escalations.length + 1}`, ...data };
        state.escalations.push(row);
        return row;
      }),
    },
    panicEvent: {
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `pe${state.panicEvents.length + 1}`, ...data };
        state.panicEvents.push(row);
        return row;
      }),
    },
    campaignEnrollment: {
      findFirst: vi.fn(async ({ where }: any) => {
        const campaign = state.campaigns.find((c) => c.key === where.campaign.key && c.active === where.campaign.active);
        if (!campaign) return null;
        const enrollment = state.enrollments.find((e) => e.userId === where.userId && e.campaignId === campaign.id);
        return enrollment ? { ...enrollment, campaign } : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const enrollment = state.enrollments.find((e) => e.id === where.id);
        if (!enrollment) throw new Error("enrollment not found");
        Object.assign(enrollment, data);
        return enrollment;
      }),
    },
    campaignEvent: {
      findUnique: vi.fn(async ({ where }: any) =>
        state.events.find(
          (e) =>
            e.enrollmentId === where.enrollmentId_transitionKey.enrollmentId &&
            e.transitionKey === where.enrollmentId_transitionKey.transitionKey,
        ) ?? null,
      ),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `ev${state.events.length + 1}`, ...data };
        state.events.push(row);
        return row;
      }),
    },
    campaignStepDef: {
      findMany: vi.fn(async ({ where }: any) => state.stepDefs.filter((s) => s.campaignId === where.campaignId && s.active)),
    },
    exercise: { findMany: vi.fn(async () => []) },
    diagnosticQuestion: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (cb: any) => cb(prismaMock)),
  };

  function resetState() {
    state.users = [
      { id: "u1", tgId: "tg-normal", mobilityIndex: 0, preferredLocale: "ru", medicalStatus: "normal" },
      { id: "u2", tgId: "tg-red", mobilityIndex: 0, preferredLocale: "ru", medicalStatus: "suppressed" },
    ];
    state.transactions = [];
    state.escalations = [];
    state.panicEvents = [];
    state.enrollments = [
      { id: "en1", userId: "u1", campaignId: "c1", currentStep: "entry", suppressed: false },
      { id: "en2", userId: "u2", campaignId: "c1", currentStep: "entry", suppressed: true },
    ];
    state.events = [];
  }

  return { state, prismaMock, resetState };
}
