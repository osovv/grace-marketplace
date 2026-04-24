-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LocaleCode" AS ENUM ('ru', 'en', 'xx', 'ky');

-- CreateEnum
CREATE TYPE "SubscriptionStage" AS ENUM ('Trial', 'Active', 'Expired');

-- CreateEnum
CREATE TYPE "MedicalStatus" AS ENUM ('normal', 'red_flag', 'suppressed');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "MoveCoinsActionType" AS ENUM ('accrual', 'debit');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('open', 'in_progress', 'resolved', 'doctor_required');

-- CreateEnum
CREATE TYPE "CampaignStep" AS ENUM ('entry', 'nurture', 'urgency', 'last_call', 'convert');

-- CreateEnum
CREATE TYPE "CampaignEventType" AS ENUM ('enrolled', 'transition', 'suppressed', 'converted', 'notification_sent', 'notification_blocked');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tgId" TEXT NOT NULL,
    "subscriptionStage" "SubscriptionStage" NOT NULL DEFAULT 'Trial',
    "age" INTEGER,
    "gender" TEXT,
    "mobilityIndex" DOUBLE PRECISION,
    "preferredLocale" "LocaleCode" NOT NULL DEFAULT 'ru',
    "medicalStatus" "MedicalStatus" NOT NULL DEFAULT 'normal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Diagnostic" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "vasScore" INTEGER NOT NULL,
    "symptoms" JSONB NOT NULL,
    "redFlag" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Diagnostic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "subtitleMeta" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseTranslation" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "locale" "LocaleCode" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "subtitleText" TEXT,
    "ctaPrimary" TEXT,
    "ctaSecondary" TEXT,

    CONSTRAINT "ExerciseTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticQuestion" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orderNo" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosticQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticQuestionTranslation" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "locale" "LocaleCode" NOT NULL,
    "questionText" TEXT NOT NULL,
    "helperText" TEXT,
    "optionsJson" JSONB,

    CONSTRAINT "DiagnosticQuestionTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoveCoinsTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" "MoveCoinsActionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT,
    "actionId" TEXT NOT NULL,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoveCoinsTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planType" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalEscalation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'diagnostic',
    "triggerCode" TEXT,
    "details" JSONB,
    "status" "EscalationStatus" NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PanicEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT,
    "sessionRef" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PanicEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "locale" "LocaleCode",
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignStepDef" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "step" "CampaignStep" NOT NULL,
    "orderNo" INTEGER NOT NULL,
    "deadlineOffsetMin" INTEGER,
    "templateKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CampaignStepDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignEnrollment" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "segmentKey" TEXT NOT NULL,
    "currentStep" "CampaignStep" NOT NULL DEFAULT 'entry',
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "suppressionReason" TEXT,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignEvent" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "eventType" "CampaignEventType" NOT NULL,
    "step" "CampaignStep",
    "transitionKey" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_tgId_key" ON "User"("tgId");

-- CreateIndex
CREATE INDEX "Diagnostic_userId_createdAt_idx" ON "Diagnostic"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Diagnostic_redFlag_createdAt_idx" ON "Diagnostic"("redFlag", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_slug_key" ON "Exercise"("slug");

-- CreateIndex
CREATE INDEX "ExerciseTranslation_locale_idx" ON "ExerciseTranslation"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseTranslation_exerciseId_locale_key" ON "ExerciseTranslation"("exerciseId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticQuestion_code_key" ON "DiagnosticQuestion"("code");

-- CreateIndex
CREATE INDEX "DiagnosticQuestionTranslation_locale_idx" ON "DiagnosticQuestionTranslation"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticQuestionTranslation_questionId_locale_key" ON "DiagnosticQuestionTranslation"("questionId", "locale");

-- CreateIndex
CREATE INDEX "MoveCoinsTransaction_userId_createdAt_idx" ON "MoveCoinsTransaction"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MoveCoinsTransaction_userId_actionId_key" ON "MoveCoinsTransaction"("userId", "actionId");

-- CreateIndex
CREATE INDEX "Subscription_userId_isActive_idx" ON "Subscription"("userId", "isActive");

-- CreateIndex
CREATE INDEX "Subscription_endedAt_idx" ON "Subscription"("endedAt");

-- CreateIndex
CREATE INDEX "MedicalEscalation_userId_status_createdAt_idx" ON "MedicalEscalation"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PanicEvent_userId_createdAt_idx" ON "PanicEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_key_key" ON "Campaign"("key");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignStepDef_campaignId_step_key" ON "CampaignStepDef"("campaignId", "step");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignStepDef_campaignId_orderNo_key" ON "CampaignStepDef"("campaignId", "orderNo");

-- CreateIndex
CREATE INDEX "CampaignEnrollment_suppressed_updatedAt_idx" ON "CampaignEnrollment"("suppressed", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignEnrollment_campaignId_userId_key" ON "CampaignEnrollment"("campaignId", "userId");

-- CreateIndex
CREATE INDEX "CampaignEvent_eventType_createdAt_idx" ON "CampaignEvent"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignEvent_enrollmentId_transitionKey_key" ON "CampaignEvent"("enrollmentId", "transitionKey");

-- AddForeignKey
ALTER TABLE "Diagnostic" ADD CONSTRAINT "Diagnostic_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseTranslation" ADD CONSTRAINT "ExerciseTranslation_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticQuestionTranslation" ADD CONSTRAINT "DiagnosticQuestionTranslation_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "DiagnosticQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoveCoinsTransaction" ADD CONSTRAINT "MoveCoinsTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalEscalation" ADD CONSTRAINT "MedicalEscalation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PanicEvent" ADD CONSTRAINT "PanicEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignStepDef" ADD CONSTRAINT "CampaignStepDef_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEnrollment" ADD CONSTRAINT "CampaignEnrollment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEnrollment" ADD CONSTRAINT "CampaignEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignEvent" ADD CONSTRAINT "CampaignEvent_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "CampaignEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

