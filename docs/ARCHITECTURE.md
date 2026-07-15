# Ziplod — Architecture

A multi-tenant lead-distribution platform (Next.js 16 App Router + Drizzle/Postgres). Every table is company-scoped; every query filters by `companyId`. Sensitive tokens are encrypted at rest (AES-256-GCM, `lib/crypto`). Sessions are JWT access + DB-backed revocable refresh tokens.

## Cross-cutting infrastructure (`src/lib/infra`, `src/lib/events`)
- **Event bus** (`lib/events/bus.ts`) — in-process typed pub/sub. Isolated listeners; one failing listener never breaks the emitter. The seam every module hooks to react to "things that happened."
- **Job queue seam** (`lib/infra/queue.ts`), **cache** (`lib/infra/cache.ts`), **metrics + latency timings** (`lib/infra/metrics.ts`) — in-process today, each with a documented Redis/BullMQ swap-seam (call sites unchanged).
- **Standardized API handling** (`lib/api-handler.ts` `withRoute`) — per-request id, structured logs, slow-request/auth/permission/validation metrics, and a catch-all that returns a clean JSON error (400 for bad body, 500 otherwise) — **never a stack trace**. UI errors are caught by `app/error.tsx` / `app/global-error.tsx` (friendly message + digest reference).

## Assignment Engine (`src/lib/assignment`)
The single owner of "who gets this lead." Flow: `assignLead()` → `AssignmentEngine` → 8-step pipeline (load → gates → candidate pool → presence filter → workload cap → strategy → atomic claim → lifecycle+history). Strategies: tier / round-robin / weighted / balanced / **AI** (modular explainable scoring). Durable queue = `assignment_jobs` rows drained by a worker using `FOR UPDATE SKIP LOCKED` (horizontally scalable, zero double-assign), with exponential backoff, dead-letter, and `reclaimStaleJobs` crash recovery. A reactive owner-NULL sweep + cron backstop guarantee **no lead is ever lost**. Assignment is event-kicked (no polling).

## Agent Presence (`src/lib/presence`)
Single-writer presence service; 7 derived states; only `online` is assignment-eligible. Heartbeat-driven with stale-timeout detection. Emits transition events (not every heartbeat).

## Lead Lifecycle & AI Insights (`src/lib/lifecycle`, `src/lib/ai`, `src/lib/insights`)
Lifecycle service is the single writer of `leads.lifecycle_stage` with a timestamped event log. AI scoring/next-best-action/summary are **deterministic + explainable** (no external LLM required; provider seam exists). Insights (score, label, summary, recommendation, follow-up, "why", customer insights) are cached in `lead_insights` and recomputed **asynchronously** off the request path.

## Website Forms (`src/lib/website`)
Per-company public/secret keys, a one-line auto-detecting `/sdk/forms.js`, a hosted-form builder (`/f/[id]`), origin allow-list + replay-nonce anti-spam, honeypot, dual rate limits, optional CAPTCHA. Reuses the shared `ingestInboundLead` pipeline (dedup → assign → delivery log).

## Meta Lead Ads (`src/app/api/webhooks/facebook`, `src/lib/facebook-oauth`)
OAuth (Facebook Login for Business) → per-page tokens; leadgen webhook with **X-Hub-Signature-256 HMAC verification**, at-least-once dedup by `leadgen_id`, full delivery-log pipeline, historical import (Postgres-checkpointed).

## Conversions API (`src/lib/capi`)
Sends CRM conversions back to Meta on the SAME OAuth grant. Pixel selection (Business→Ad Account→Pixel), configurable trigger→event mapping, SHA-256 PII hashing (no raw PII stored), EMQ estimate, durable send queue (`capi_events`, SKIP LOCKED + backoff + dead-letter + dedup by `event_id`), delivery log, diagnostics, historical resend. Fully async — the Assignment Engine never waits for Meta.

## Operations Center (`src/lib/operations`)
Read-only live dashboard: event bus → per-company ring buffer → SSE fan-out (no client polling). Status/feed/health/warnings.

## Platform Owner Mailbox (`src/lib/mailbox`)
Super-admin-only email (Resend). Threading, folders, indexed trigram search, sandboxed-iframe HTML rendering (XSS-safe).

## Monitoring & diagnostics (`src/lib/health`)
Per-subsystem health (`getSystemHealth` → healthy/warning/critical), config validator, launch checklist, job dashboard — surfaced super-admin-only at `/super-admin/diagnostics` and `/api/super-admin/{health,jobs,config-check,checklist}`.

## Tenancy & security
RBAC (super_admin / admin / manager / agent); mailbox + diagnostics are super-admin only; CAPI + Operations are admin/manager. Rate limiting per category + per-account lockout. Cookies `httpOnly`/`secure`/`sameSite=lax` (CSRF). Drizzle parameterizes all queries (SQL-injection safe). Every hot table is indexed for its actual `WHERE`/`ORDER BY`.
