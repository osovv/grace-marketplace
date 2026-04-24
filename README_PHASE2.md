# Phase 2 Runtime Guide

This guide covers runtime setup for:

- Campaign transitions (`M-024`)
- Red-flag suppression guard (`M-027`)
- Panic escalation delivery (`M-026`)
- MoveCoins idempotent mutations (`M-013`)
- i18n locale resolution (`M-025`)

## 1) Environment Variables

### API

- `DATABASE_URL` (required for Prisma migrate/seed against a real DB)
- `TG_ALERT_BOT_TOKEN` (optional but required for real operator Telegram alerts)
- `TG_OPERATOR_CHAT_ID` (optional but required for real operator Telegram alerts)
- `BOT_LOCALE_SHARED_SECRET` (optional but recommended to protect `/v1/bot/locale`)

### Bot

- `BOT_TOKEN` (required)
- `API_BASE_URL` (default: `http://localhost:4000/v1`)
- `BOT_LOCALE_SHARED_SECRET` (optional but recommended; must match API secret when enabled)

### TMA

- `NEXT_PUBLIC_API_URL` (default: `http://localhost:4000/v1`)

### Quick setup from templates

From repo root:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/bot/.env.example apps/bot/.env
cp apps/tma/.env.local.example apps/tma/.env.local
```

For dual DB setup (local + stage):

```bash
cp apps/api/.env.local.example apps/api/.env.local
cp apps/api/.env.stage.example apps/api/.env.stage
```

### Supabase todos bootstrap (for TMA demo)

TMA reads from `public.todos` via Supabase SSR client. To provision the table and demo records:

1) Open Supabase SQL Editor for your project.
2) Run the script from:

`docs/supabase-todos-bootstrap.sql`

## 2) Prisma Setup

From repo root:

```bash
npm --prefix apps/api run prisma:generate
npm --prefix apps/api run prisma:migrate:sql
```

If you have a live database:

```bash
npm --prefix apps/api exec prisma migrate deploy --schema prisma/schema.prisma
```

## 3) Seed Initial Data

If `DATABASE_URL` is configured:

```bash
npm --prefix apps/api run prisma:seed
```

Seed includes:

- localized `DiagnosticQuestion` (RU/EN)
- sample `Exercise` with translations
- default campaign and ordered step definitions

If `DATABASE_URL` is not provided:

- do not run seed command
- use the generated SQL + `apps/api/prisma/seed.ts` as canonical rollout artifacts
- run tests that use mocked Prisma (no DB required)

If you enable bot locale endpoint protection:

- set `BOT_LOCALE_SHARED_SECRET` in both API and Bot environments
- bot sends this value in `x-bot-secret` header to `/v1/bot/locale`

## 4) Run Services

```bash
npm --prefix apps/api run dev
npm --prefix apps/bot run dev
npm --prefix apps/tma run dev
```

## 5) Integration Tests (No DB Required)

Tests use Fastify `inject` + mocked Prisma:

```bash
npm --prefix apps/api run test
```

Current integration coverage:

- `V-M-013` MoveCoins idempotency by `actionId`
- `V-M-015` red-flag suppression blocks campaign transitions

## 6) Audit Log Format

All runtime services use:

`[Module][function][BLOCK_NAME] message`

Example:

`[M-024][advanceCampaignStep][ADVANCE] Campaign transition committed`
