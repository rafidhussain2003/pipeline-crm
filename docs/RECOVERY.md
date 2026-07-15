# Ziplod — Disaster Recovery & Reliability

## Backups
Two layers:
1. **Managed Postgres automated backups** (Render/Neon/Supabase keep point-in-time backups) — the primary recovery mechanism. Enable and verify retention in your provider dashboard.
2. **Off-provider logical dumps** — `node scripts/backup.mjs` runs `pg_dump -Fc` to `backups/ziplod-<timestamp>.dump`. Run before risky migrations and/or on a schedule (cron). Set `BACKUP_ENABLED=true` so the Launch Checklist marks backups configured.

### Restore
```
RESTORE_DATABASE_URL=postgres://…  node scripts/restore.mjs backups/ziplod-<ts>.dump --confirm
```
Refuses to run without `--confirm`; refuses to overwrite the production `DATABASE_URL` unless `ALLOW_PROD_RESTORE=true`. Prefer restoring into a fresh database (`RESTORE_DATABASE_URL`) and cutting over.

## Worker & queue recovery (idempotent by design)
Both durable queues (`assignment_jobs`, `capi_events`) survive:
- **Server restart / crash** — work is durable rows, not in-memory. On restart the cron backstop (and the next event kick) resumes draining. `reclaimStaleJobs` / `reclaimStaleCapi` return rows a crashed worker left `processing` (past their reservation timeout) back to the queue.
- **Timeouts / network interruption** — a failed attempt retries with exponential backoff; after `maxAttempts` it dead-letters (never lost — the underlying lead/conversion is preserved and manually retryable from the Jobs dashboard, and re-derivable by the reconcile sweep).
- **Duplicate execution** — `FOR UPDATE SKIP LOCKED` gives concurrent workers disjoint rows; assignment uses an atomic claim; CAPI dedups by a unique `(pixel, event_id)`; leads dedup by phone/email or provider id. Running the same worker twice can never double-process.
- **Database reconnect** — the `pg` pool has connect/statement/query timeouts (no unbounded hangs); a dropped connection fails the current attempt, which retries.

Verify the current state any time at **super-admin → Diagnostics → Jobs** (running/queued/failed/dead-letter per queue) and **retry** dead-lettered jobs there.

## Zero lead loss guarantees
- Inbound (Meta/website/webhook): dedup + delivery log; assignment failure keeps the lead (owner NULL) and the reactive sweep + cron re-assign it.
- Assignment: dead-lettering a *job* never loses the *lead*.
- Conversions: dead-lettering an *event* never loses the *conversion* (row kept, reconcilable).

## Incident runbook (quick)
1. **App down** → check `/api/health` (public liveness: DB + schema). Roll back the last deploy if it's a code regression.
2. **DB unreachable** → check the provider status; the health endpoint reports `database: critical`.
3. **Queue backlog** → Diagnostics → Jobs; hit the cron endpoints manually (with `x-cron-secret`) to force-drain.
4. **Data corruption** → restore the latest backup into a fresh DB (see above) and cut over.
