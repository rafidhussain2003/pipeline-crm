# PostgreSQL Schema & Query Audit

Based on `src/db/schema.ts`, `drizzle/0000_gorgeous_energizer.sql`, `drizzle/meta/_journal.json` + `0000_snapshot.json`, `src/db/index.ts`, and every query call site across `src/lib/*.ts` and `src/app/api/**`. The single migration file and its journal/snapshot are consistent with `schema.ts` — no drift found.

---

## High

### DB-1. `assignment_log` has zero indexes, and is scanned in full on every lead assignment
**Location:** [src/db/schema.ts:345-351](../src/db/schema.ts#L345)
**Root cause:** No index on `lead_id` or `assigned_to`. Directly causes runtime finding **C1** in the runtime report (`assignLead()` scans this whole table, joined to `leads`, on every single assignment).
**Recommended fix:** `index("assignment_log_lead_idx").on(t.leadId)` and `index("assignment_log_assigned_to_idx").on(t.assignedTo)` — but note the real fix for C1 is to stop deriving the cursor from a full scan at all; the index only helps the audit-log/reporting queries, not the hot path.

### DB-2. `leads.disposition` is filtered constantly but never indexed
**Location:** [src/db/schema.ts:219-249](../src/db/schema.ts#L219); filtered in [leads/route.ts:24](../src/app/api/leads/route.ts#L24) and [cron/recycle-leads/route.ts](../src/app/api/cron/recycle-leads/route.ts)
**Root cause:** Existing indexes on `leads` are `companyIdx`, `ownerIdx`, `createdIdx`, `phoneIdx`, `emailIdx` — no composite covering `(company_id, disposition)`, which is exactly what the leads list filter and the recycle cron query on.
**Recommended fix:** `index("leads_disposition_idx").on(t.companyId, t.disposition)`.

### DB-3. `users.email` is globally unique, which is a real architectural constraint worth confirming, not just a schema nit
**Location:** [src/db/schema.ts:58](../src/db/schema.ts#L58) — `email: varchar(...).notNull().unique()`
**Root cause:** This isn't an accidental oversight — `POST /api/auth/login` looks a user up by `email` alone with no company context ([login/route.ts:30](../src/app/api/auth/login/route.ts#L30)), so the *login flow itself* currently requires email to be globally unique across every tenant on the platform. The consequence: the same person cannot be an agent/admin at two different client companies using the same email address, and one company can never register a user whose email happens to already exist at a different company (they'll hit the generic "account already exists" message from signup, which is slightly misleading since it's not *their* account).
**Recommended fix:** This is a product decision, not a bug fix — either (a) keep global uniqueness and document it as intentional ("one person, one account, one company" model), or (b) move to `(company_id, email)` uniqueness and change login to require a company identifier (subdomain, slug, or a company picker) before/with the email. Don't change the schema without also redesigning the login flow — they're coupled.

### DB-4. No per-company uniqueness on disposition/tag/skill labels
**Location:** `dispositionOptions` ([schema.ts:172](../src/db/schema.ts#L172)), `tags` ([schema.ts:191](../src/db/schema.ts#L191)), `skills` ([schema.ts:94](../src/db/schema.ts#L94))
**Root cause:** Only a `companyIdx` exists on each; nothing stops a company from ending up with two `"Qualified"` disposition options (e.g. via a race between two admins, or a future bulk-import feature) — no UI path currently creates duplicates, but nothing at the DB layer prevents it either.
**Recommended fix:** `uniqueIndex(...).on(t.companyId, t.label)` on all three.

### DB-5. All timestamps are stored without timezone
**Location:** every `timestamp(...)` column in [src/db/schema.ts](../src/db/schema.ts) (e.g. lines 44-45, 234) — confirmed in the actual migration SQL as `timestamp` (Postgres's timezone-naive type), not `timestamp with time zone`.
**Root cause:** Drizzle's `timestamp()` defaults to timezone-naive. For a multi-tenant CRM where agents in different timezones set `followUpAt` reminders, this is ambiguous: the stored value has no timezone marker, so correctness depends on every reader/writer agreeing on UTC by convention (they currently do, via `defaultNow()`/`new Date()`, but there's no DB-level guarantee, and any future direct-SQL tooling or timezone-aware client could write local time by mistake).
**Recommended fix:** Switch to `timestamp(..., { withTimezone: true })` for at least `followUpAt` (the one field where a human picks a specific moment across timezones matters most). Requires a migration; existing values would need an explicit `AT TIME ZONE 'UTC'` cast during the `ALTER COLUMN`.

### DB-6. Connection pool has no explicit `max`
**Location:** [src/db/index.ts](../src/db/index.ts)
**Root cause:** `node-postgres` defaults `max` to 10 when unset. At the stated target scale (50 companies × 100 agents), even modest concurrency (a few dozen simultaneous requests during business hours) can saturate 10 connections, and requests will now fail fast after the `connectionTimeoutMillis: 10_000` added in a prior fix, rather than hang — which is the correct failure mode, but 10 is still likely too low for the stated scale.
**Recommended fix:** Set `max` explicitly (e.g. 20) and confirm it against Render Postgres's actual connection ceiling for the plan in use (the `starter` Postgres plan has a fairly low total connection limit — verify the exact number in the Render dashboard before raising `max`, since over-provisioning across future multiple app instances could exhaust the DB's own limit rather than the pool's).

---

## Medium

### DB-7. No transaction around multi-table writes in several routes
Already covered in detail in [01-runtime-bugs.md § H5](./01-runtime-bugs.md) — listed here too because it's as much a data-integrity/schema-usage issue as a runtime one: `leads` create/update, CSV import, and super-admin company creation all perform 2+ related writes without `db.transaction()`.

### DB-8. `audit_log` has no index on `created_at` and no retention policy
**Location:** [src/db/schema.ts:356-372](../src/db/schema.ts#L356)
**Root cause:** Only `companyIdx` and `entityIdx` exist. The audit log UI already limits to the 200 most recent rows per company ([audit-log/route.ts](../src/app/api/audit-log/route.ts)), which Postgres can currently satisfy via `companyIdx` + a sort, but there's no time-range index for any future "audits between date X and Y" reporting feature, and no archival/retention strategy — this table is append-only and grows forever.
**Recommended fix:** `index("audit_log_created_idx").on(t.createdAt)` now; decide on a retention/archive policy before this becomes a real operational concern (years out at current scale, but worth deciding early since audit logs are often subject to compliance retention *minimums*, which conflicts with unbounded growth if not planned for).

### DB-9. Several nullable columns invite null-check bugs downstream
**Location:** `leads.name`, `leads.phone`, `leads.email` all nullable with no CHECK constraint requiring at least one to be present ([schema.ts:227-229](../src/db/schema.ts#L227)) — a lead with all three null is valid at the DB layer, and would render as blank everywhere in the UI.
**Recommended fix:** Add a CHECK constraint (`name IS NOT NULL OR phone IS NOT NULL OR email IS NOT NULL`) or enforce it at the application layer in every lead-creation path (`leads/route.ts`, `leads/import/route.ts`, both webhook handlers) — currently each does its own ad hoc `|| "Unknown"` fallback for `name` only, not phone/email.

---

## Low

### DB-10. `tier` is a string enum (`"1"`/`"2"`/`"3"`) instead of an integer
[src/db/schema.ts:17](../src/db/schema.ts#L17) — works fine as-is (it's used as a lookup key, e.g. `weightByTier[agent.tier]`), but is an unusual modeling choice worth a one-line comment explaining why it's a string (likely: enums must be a fixed string set in Postgres, and this was probably kept as string to match `Record<string, number>` lookups). Not worth a migration on its own.

### DB-11. `leads.phone` capped at `varchar(50)`
[src/db/schema.ts:228](../src/db/schema.ts#L228) — real-world phone data with extensions/formatting notes (`"+1 (555) 123-4567 ext. 890"`) can approach this limit. Low risk, cheap to widen to 100 in the same migration as other schema changes if any are made.

### DB-12. `refresh_tokens.expires_at` has no index
[src/db/schema.ts:75-89](../src/db/schema.ts#L75) — only `userIdx` exists. Irrelevant today since nothing queries/cleans up expired tokens on a schedule, but add `index(...).on(t.expiresAt)` if a cleanup job is ever added (recommended in the production-readiness report).

---

## Migration safety

- **Idempotency:** Confirmed `npm run db:migrate` (`drizzle-kit migrate`) tracks applied migrations in Postgres and only runs new ones — safe to run on every deploy, already wired into `render.yaml`'s `startCommand` from a prior fix.
- **Only one migration exists today** (`0000_gorgeous_energizer.sql`), so there's no live example of a risky forward migration yet. Flagging for future migrations: any `NOT NULL` column added to `leads`, `users`, or `companies` without a `DEFAULT` will fail against existing rows the moment real tenant data exists — make sure future schema changes either provide a default or run as two migrations (add nullable → backfill → add NOT NULL constraint).
- **Single instance, no migration race:** `render.yaml` defines one `starter`-plan web service with no scaling block, so there's no risk of two instances racing to apply the same migration concurrently at boot.
