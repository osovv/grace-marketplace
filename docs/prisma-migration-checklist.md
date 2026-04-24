# Prisma Migration Checklist (Zero/Low Downtime)

## Goal

Safely roll out the new data model for:

- i18n (`ru`, `en`, `xx`)
- Red Flag Suppression
- Panic Button escalation flow
- MoveCoins idempotency (`actionId`)
- Campaign finite-state orchestration

This checklist assumes PostgreSQL + Prisma Migrate and staged rollout with feature flags.

## Preconditions

- Production backup policy verified.
- Staging environment uses production-like data shape.
- Feature flags created:
  - `ff_i18n_resolution`
  - `ff_campaign_orchestrator`
  - `ff_red_flag_suppression_guard`
  - `ff_panic_button`
  - `ff_movecoins_action_idempotency`

## Phase 0: Safety Setup

- Enable migration window with on-call coverage.
- Freeze destructive schema operations during rollout.
- Confirm alerting for:
  - DB lock duration
  - error-rate spikes
  - campaign send failures
  - escalation creation failures

## Phase 1: Additive Schema Migration (No Behavior Switch)

Apply additive changes only (no column drops/renames yet):

- Add enums:
  - `LocaleCode`, `MedicalStatus`, `CampaignStep`, `CampaignEventType`, etc.
- Add new nullable columns with safe defaults:
  - `User.preferredLocale` default `ru`
  - `User.medicalStatus` default `normal`
  - `MoveCoinsTransaction.actionId` nullable initially (if legacy rows exist)
- Create new tables:
  - `ExerciseTranslation`
  - `DiagnosticQuestion`
  - `DiagnosticQuestionTranslation`
  - `MedicalEscalation` (if missing)
  - `PanicEvent`
  - `Campaign`, `CampaignStepDef`, `CampaignEnrollment`, `CampaignEvent`
- Add non-blocking indexes first where possible.

## Phase 2: Backfill Data

Run idempotent backfill jobs:

- i18n:
  - For each `Exercise`, create `ExerciseTranslation(locale=ru)` from existing base content.
  - For each diagnostic question source, create base `DiagnosticQuestion` + `ru` translation.
- Users:
  - Set `preferredLocale` using known Telegram locale where available; fallback `ru`.
  - Set `medicalStatus` from latest diagnostic red-flag state.
- MoveCoins:
  - Backfill `actionId` for legacy rows using deterministic derivation (for example, `legacy-{id}`).
- Campaign:
  - Seed `Campaign` and ordered `CampaignStepDef` rows.

Backfill invariants:

- Unique `(exerciseId, locale)` has no duplicates.
- Unique `(questionId, locale)` has no duplicates.
- No null `actionId` remains before uniqueness enforcement.

## Phase 3: Enforce Constraints

After backfill is complete:

- Make required fields non-null:
  - `MoveCoinsTransaction.actionId`
- Add/enable unique constraints:
  - `@@unique([userId, actionId])`
  - `@@unique([enrollmentId, transitionKey])` (verify transitionKey strategy for non-transition events)
- Ensure supporting indexes exist for hot paths:
  - diagnostics by `(userId, createdAt)`
  - enrollments by `(suppressed, updatedAt)`
  - escalations by `(userId, status, createdAt)`

## Phase 4: Deploy Code Behind Flags

Deploy code with flags OFF by default:

- Backend:
  - i18n resolution service
  - suppression guard middleware/service
  - transactional MoveCoins mutation path using `actionId`
  - panic escalation endpoint
- Bot:
  - `/start` locale detection + persistence
- TMA:
  - i18n UI integration
  - Panic Button component (hidden behind flag)

Smoke checks (flags still OFF):

- API starts and passes health checks.
- DB queries run with new schema present.

## Phase 5: Progressive Flag Rollout

Turn on in this order:

1. `ff_movecoins_action_idempotency`
2. `ff_i18n_resolution`
3. `ff_red_flag_suppression_guard`
4. `ff_campaign_orchestrator`
5. `ff_panic_button`

At each step:

- Start with internal/staff cohort.
- Expand to 5%, 25%, 50%, 100%.
- Observe metrics for at least one full campaign cycle where relevant.

## Phase 6: Verification Gates

Operational checks:

- No duplicate MoveCoins mutations for repeated `actionId`.
- No campaign sends for suppressed/red-flag users.
- Locale consistency across bot, TMA, and API payloads.
- Panic action creates escalation and operator alert within SLA.

Data checks:

- Conversion attribution rows created per campaign transitions.
- Escalation queue receives panic/red-flag events.
- No unexpected nulls in required columns.

## Rollback Plan

If critical issue appears:

- Immediately disable feature flags in reverse order.
- Keep additive schema in place (do not hot-drop tables/columns).
- Route panic/escalation via legacy safe channel if new path fails.
- Re-run reconciliation jobs:
  - MoveCoins ledger consistency
  - campaign event consistency
  - escalation creation audit

## Post-Rollout Cleanup

After stable period:

- Remove dead legacy code paths.
- Tighten nullable columns if still transitional.
- Document final schema contracts in engineering handbook.
- Add permanent runbooks:
  - campaign suppression incident
  - panic escalation incident
  - i18n fallback mismatch incident
