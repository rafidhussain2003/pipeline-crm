# Ziplod — Deployment

## Prerequisites
- Node 20+, a managed Postgres (Render / Neon / Supabase), and the Postgres client tools (`pg_dump`/`pg_restore`) available where you run backups.

## Environment variables
Validate everything from the app itself: **super-admin → Diagnostics → Config Validator** (`/api/super-admin/config-check`) reports each var as ✓ Healthy / ⚠ Warning / ✗ Missing without exposing values.

Required:
- `DATABASE_URL` — Postgres connection string.
- `JWT_SECRET` — long random string (session signing).
- `ENCRYPTION_KEY` — `openssl rand -base64 32` (encrypts Meta/CAPI tokens).
- `APP_URL` / `NEXT_PUBLIC_APP_URL` — public HTTPS origin (OAuth + email links; never derive from the request behind a proxy).
- `CRON_SECRET` — authenticates the cron backstops.

Integrations (optional per feature):
- Meta: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` (also verifies webhook HMAC + enables Conversions API), `FACEBOOK_VERIFY_TOKEN`.
- Email: `RESEND_API_KEY`.
- Billing: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price ids.
- `AI_PROVIDER` — optional; the deterministic engine works without it.

## Migrations
Schema lives in `src/db/schema.ts`; migrations in `drizzle/`. Generate with `npm run db:generate`. Apply on the target DB (this project applies via SSL-aware `pg` scripts; index migrations on large live tables use `CREATE INDEX CONCURRENTLY`). **Verify with the health endpoint's schema check** (`SELECT 1 FROM users LIMIT 0`).

## Build & run
- `npm run build` (production build must be clean) → `npm start`.
- Single web instance today. Before scaling to multiple instances, provision Redis and swap the in-process cache/queue/rate-limit implementations (interfaces unchanged) — otherwise rate limits and metrics are per-instance (workers are already safe: SKIP LOCKED dedups).

## Cron backstops (external scheduler, `x-cron-secret: $CRON_SECRET`)
- `POST /api/cron/assign-queued` — drains the assignment queue + recovery + SLA escalation (every 1–2 min). When a company has **Progressive Lead Release** enabled (Automation settings), this same tick drives its paced release cycles — the configured release interval (1–10 min) is gated per company in `progressive_release_state`, so keep this cron at 1 min for full resolution. No separate worker.
- `POST /api/cron/capi-worker` — drains the Conversions API queue + reclaim + reconcile.
- `POST /api/cron/callback-worker` — **every 1 min.** Delivers due callback reminders + reclaims stale rows + sweeps overdue callbacks to `missed`. Unlike the others this is the PRIMARY trigger, not a backstop: reminders fire when their time arrives, and nothing else watches the clock.
- `POST /api/cron/recycle-leads`, `POST /api/cron/cleanup-tokens`, `POST /api/cron/resume-imports`.

## Post-deploy checklist
Super-admin → Diagnostics → **Launch Checklist** (`/api/super-admin/checklist`) computes go/no-go from live state: schema migrated, queues running, workers healthy, Meta/CAPI/email/mailbox configured, audit logging active, security verified, backups configured.
