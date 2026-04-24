# Prisma Rollout Runbook (Ops One-Page)

## Scope

Rollout for:

- i18n (`ru`, `en`, `xx`)
- campaign suppression guard
- panic escalation
- MoveCoins `actionId` idempotency

## Flags

- `ff_movecoins_action_idempotency`
- `ff_i18n_resolution`
- `ff_red_flag_suppression_guard`
- `ff_campaign_orchestrator`
- `ff_panic_button`

All start in OFF state.

## Go/No-Go Preconditions

- [ ] Production backup < 24h and restore tested.
- [ ] Staging passed full regression on new schema.
- [ ] On-call assigned (backend + db + product owner).
- [ ] Dashboard panels ready:
  - API error rate
  - DB lock wait / long transactions
  - campaign send success/failure
  - escalation create success/failure
  - MoveCoins duplicate-action rejection count

If any is missing -> NO-GO.

## Execution Steps

1. Apply additive migration only.
2. Run backfill jobs.
3. Enforce constraints (only after backfill success).
4. Deploy code with all flags OFF.
5. Enable flags progressively.

## Commands Template

Use project-specific scripts/commands:

```bash
# 1) Apply migration
npm run prisma:migrate:deploy

# 2) Backfill
npm run db:backfill:i18n
npm run db:backfill:user-locale
npm run db:backfill:medical-status
npm run db:backfill:movecoins-action-id
npm run db:seed:campaign-steps

# 3) Constraint check / validation
npm run db:validate:post-backfill

# 4) Deploy app
npm run deploy:production
```

## Flag Rollout Order

1. `ff_movecoins_action_idempotency`
2. `ff_i18n_resolution`
3. `ff_red_flag_suppression_guard`
4. `ff_campaign_orchestrator`
5. `ff_panic_button`

Per flag rollout:

- 0% -> internal/staff only
- 5% -> 25% -> 50% -> 100%
- observe 15-30 minutes between steps (or one campaign cycle for campaign-related flags)

## Live Checks (Every Step)

- [ ] No spike in 5xx or timeout rate.
- [ ] No prolonged DB locks.
- [ ] MoveCoins: duplicate `actionId` requests are safely rejected/no-op.
- [ ] Suppression: no campaign sends for `medicalStatus in (red_flag, suppressed)`.
- [ ] i18n: locale resolved consistently across bot/TMA/API.
- [ ] Panic: escalation ticket appears and operator alert is delivered within SLA.

## SQL Spot Checks (Template)

```sql
-- Duplicates by actionId
select user_id, action_id, count(*)
from movecoins_transaction
group by user_id, action_id
having count(*) > 1;

-- Suppressed users receiving campaign sends (should be zero)
select ce.user_id, ce.suppressed, ce.suppression_reason, ev.created_at
from campaign_enrollment ce
join campaign_event ev on ev.enrollment_id = ce.id
where ce.suppressed = true
  and ev.event_type = 'notification_sent'
order by ev.created_at desc
limit 50;

-- Panic escalation health
select date_trunc('hour', created_at) as h, count(*)
from panic_event
group by 1
order by 1 desc;
```

## Rollback Triggers

Immediate rollback (flags OFF in reverse order) if:

- 5xx error rate breaches SLO for >5 min.
- campaign sends occur for suppressed users.
- panic escalations are not created or not delivered.
- MoveCoins balance drift or duplicate mutations observed.

## Rollback Procedure

1. Disable flags in reverse order:
   - `ff_panic_button`
   - `ff_campaign_orchestrator`
   - `ff_red_flag_suppression_guard`
   - `ff_i18n_resolution`
   - `ff_movecoins_action_idempotency`
2. Keep schema as-is (no destructive rollback).
3. Run reconciliation:
   - MoveCoins ledger reconciliation
   - Campaign suppression audit
   - Escalation event audit
4. Open incident report with timeline and affected cohorts.

## Success Criteria (Final Go)

- [ ] All flags at 100%.
- [ ] No critical incidents for 24h after full rollout.
- [ ] Data integrity checks return clean.
- [ ] Product owner signs off conversion/safety metrics.
