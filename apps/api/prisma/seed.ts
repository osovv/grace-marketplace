import {
  CampaignStep,
  LocaleCode,
  PrismaClient,
} from "@prisma/client";

const prisma = new PrismaClient();

async function seedDiagnosticQuestions() {
  const base = await prisma.diagnosticQuestion.upsert({
    where: { code: "pain_zone" },
    update: { kind: "single_choice", orderNo: 1, active: true },
    create: { code: "pain_zone", kind: "single_choice", orderNo: 1, active: true },
  });
  await prisma.diagnosticQuestionTranslation.upsert({
    where: { questionId_locale: { questionId: base.id, locale: LocaleCode.ru } },
    update: { questionText: "Где вы ощущаете боль?", helperText: "Выберите основную зону", optionsJson: ["Шея", "Поясница", "Плечо"] },
    create: {
      questionId: base.id,
      locale: LocaleCode.ru,
      questionText: "Где вы ощущаете боль?",
      helperText: "Выберите основную зону",
      optionsJson: ["Шея", "Поясница", "Плечо"],
    },
  });
  await prisma.diagnosticQuestionTranslation.upsert({
    where: { questionId_locale: { questionId: base.id, locale: LocaleCode.en } },
    update: { questionText: "Where do you feel pain?", helperText: "Choose the main area", optionsJson: ["Neck", "Lower back", "Shoulder"] },
    create: {
      questionId: base.id,
      locale: LocaleCode.en,
      questionText: "Where do you feel pain?",
      helperText: "Choose the main area",
      optionsJson: ["Neck", "Lower back", "Shoulder"],
    },
  });
  await prisma.diagnosticQuestionTranslation.upsert({
    where: { questionId_locale: { questionId: base.id, locale: LocaleCode.ky } },
    update: {
      questionText: "Placeholder: where is your pain?",
      helperText: "Placeholder language",
      optionsJson: ["Option A", "Option B", "Option C"],
    },
    create: {
      questionId: base.id,
      locale: LocaleCode.ky,
      questionText: "Placeholder: where is your pain?",
      helperText: "Placeholder language",
      optionsJson: ["Option A", "Option B", "Option C"],
    },
  });
}

async function seedExercises() {
  const exercise = await prisma.exercise.upsert({
    where: { slug: "neck-mobility-1" },
    update: {
      difficulty: "easy",
      videoUrl: "https://cdn.example.com/video/neck-mobility-1.mp4",
      active: true,
    },
    create: {
      slug: "neck-mobility-1",
      difficulty: "easy",
      videoUrl: "https://cdn.example.com/video/neck-mobility-1.mp4",
      active: true,
    },
  });

  await prisma.exerciseTranslation.upsert({
    where: { exerciseId_locale: { exerciseId: exercise.id, locale: LocaleCode.ru } },
    update: {
      title: "Мобилизация шеи",
      description: "Мягкая тренировка для снятия скованности",
      ctaPrimary: "Начать",
      ctaSecondary: "Позже",
    },
    create: {
      exerciseId: exercise.id,
      locale: LocaleCode.ru,
      title: "Мобилизация шеи",
      description: "Мягкая тренировка для снятия скованности",
      ctaPrimary: "Начать",
      ctaSecondary: "Позже",
    },
  });

  await prisma.exerciseTranslation.upsert({
    where: { exerciseId_locale: { exerciseId: exercise.id, locale: LocaleCode.en } },
    update: {
      title: "Neck mobility",
      description: "Gentle training to reduce stiffness",
      ctaPrimary: "Start",
      ctaSecondary: "Later",
    },
    create: {
      exerciseId: exercise.id,
      locale: LocaleCode.en,
      title: "Neck mobility",
      description: "Gentle training to reduce stiffness",
      ctaPrimary: "Start",
      ctaSecondary: "Later",
    },
  });
  await prisma.exerciseTranslation.upsert({
    where: { exerciseId_locale: { exerciseId: exercise.id, locale: LocaleCode.ky } },
    update: {
      title: "Placeholder mobility",
      description: "Placeholder description",
      ctaPrimary: "Go",
      ctaSecondary: "Later",
    },
    create: {
      exerciseId: exercise.id,
      locale: LocaleCode.ky,
      title: "Placeholder mobility",
      description: "Placeholder description",
      ctaPrimary: "Go",
      ctaSecondary: "Later",
    },
  });
}

async function seedCampaign() {
  const campaign = await prisma.campaign.upsert({
    where: { key: "default-conversion" },
    update: { active: true, name: "Default Conversion Campaign" },
    create: { key: "default-conversion", name: "Default Conversion Campaign", active: true },
  });

  const steps: Array<{ step: CampaignStep; orderNo: number; templateKey: string }> = [
    { step: CampaignStep.entry, orderNo: 1, templateKey: "entry_message" },
    { step: CampaignStep.nurture, orderNo: 2, templateKey: "nurture_social_proof" },
    { step: CampaignStep.urgency, orderNo: 3, templateKey: "urgency_deadline" },
    { step: CampaignStep.last_call, orderNo: 4, templateKey: "last_call_offer" },
    { step: CampaignStep.convert, orderNo: 5, templateKey: "convert_confirmation" },
  ];

  for (const s of steps) {
    await prisma.campaignStepDef.upsert({
      where: { campaignId_step: { campaignId: campaign.id, step: s.step } },
      update: { orderNo: s.orderNo, templateKey: s.templateKey, active: true },
      create: {
        campaignId: campaign.id,
        step: s.step,
        orderNo: s.orderNo,
        templateKey: s.templateKey,
        active: true,
      },
    });
  }
}

async function main() {
  await seedDiagnosticQuestions();
  await seedExercises();
  await seedCampaign();
  console.log("Seed completed");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
