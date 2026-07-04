# Runtime Bug Audit

Method: every file under `src/app/api/**/route.ts`, `src/app/**/*.tsx`, `src/lib/*.ts`, `src/db/*.ts` was read. Findings below were cross-checked against the actual source after initial research passes — a few candidate findings from the research pass were **retracted** after re-reading the code and are listed at the bottom so they aren't re-flagged later.

No live server/DB was available in this environment, so nothing here was reproduced by executing the app — every "Repro" is a traced code path, not an observed failure.

---

## Critical

### C1. Lead assignment does an unbounded full-history scan on every single assignment
**Location:** [src/lib/assignment.ts:81-87](../src/lib/assignment.ts#L81)
**Root cause:** To pick a round-robin cursor, `assignLead()` runs `SELECT ... FROM assignment_log INNER JOIN leads ... WHERE leads.company_id = ?` with **no limit, no index on `assignment_log.lead_id`** (confirmed absent in schema.ts), and takes `.length % cycle.length`. This table only grows — it's every lead ever assigned, forever. `assignLead()` is called from lead creation, CSV import (once per row), every Facebook/generic webhook lead, and the recycle cron.
**How to reproduce:** Run the app for a few months of normal volume (thousands of leads/day per company per the code's own comment at assignment.ts:18). Each new assignment scans an ever-growing table with no supporting index — latency increases monotonically over the company's lifetime.
**Compounding factor:** [src/db/index.ts](../src/db/index.ts) now enforces a 20s `statement_timeout` (added in a prior fix). Once this scan exceeds 20s, `assignLead()` starts throwing on every call — and **no caller wraps `assignLead()` in try/catch** (see H4), so lead creation itself starts failing.
**Recommended fix:** Don't derive the cursor from history length. Store a `lastAssignedIndex`/`lastAssignedAgentId` on `automation_settings` (or a small per-company counter row) and increment it directly. Add `index("assignment_log_lead_idx").on(assignmentLog.leadId)` regardless, for the audit-log UI's own lookups.

### C2. Facebook webhook's `req.json()` runs outside the try/catch it depends on
**Location:** [src/app/api/webhooks/facebook/route.ts:27-29](../src/app/api/webhooks/facebook/route.ts#L27)
**Root cause:** The code's own comment says "Log but still return 200 — Facebook retries aggressively on non-200s." But `const body = await req.json();` is on line 27, **before** the `try {` on line 29. A malformed body throws before the safety net exists, producing Next's default 500 instead of the intended always-200 behavior — triggering exactly the retry storm the code is trying to avoid.
**How to reproduce:** POST malformed JSON to `/api/webhooks/facebook`.
**Recommended fix:** Move the `try` up to wrap `req.json()` too.

### C3. Super-admin "create company" duplicates the pre-fix signup bug
**Location:** [src/app/api/super-admin/companies/route.ts:32-91](../src/app/api/super-admin/companies/route.ts#L32)
**Root cause:** This route creates a company + admin user + 3 seed inserts exactly like `/api/auth/signup` did before it was hardened — but this copy still has **no try/catch, no transaction, and no logging**. `req.json()` (line 36) is unguarded, and the 5 sequential inserts (lines 41-80) aren't atomic: a failure after the company insert leaves an orphaned company with no admin user and no default data, and any thrown error here returns Next's default 500 with no diagnostic trail.
**How to reproduce:** Any DB error between the company insert and the automation_settings insert (line 74) leaves a permanently broken company record only a super-admin can find and would have to manually clean up.
**Recommended fix:** Apply the same fix already applied to `/api/auth/signup` — wrap in `db.transaction()`, wrap the handler in try/catch, add step logging.

---

## High

### H1. CSV import is fully sequential — one row = up to 3 DB round-trips, compounding with C1
**Location:** [src/app/api/leads/import/route.ts:30-57](../src/app/api/leads/import/route.ts#L30)
**Root cause:** The `for` loop calls `findDuplicateLead()`, `db.insert()`, and `assignLead()` sequentially per CSV row with no batching. Each `assignLead()` call also re-runs the C1 full-table scan, so import time grows non-linearly as both the row count *and* the company's historical assignment log grow.
**How to reproduce:** Import a 1,000-row CSV for a company with a large assignment history; watch the request approach/exceed the 20s statement timeout on later rows.
**Recommended fix:** Batch-insert leads, batch-check duplicates with a single query per unique phone/email set, and fix C1 first — that alone removes most of the compounding cost.

### H2. Check-then-insert race on duplicate lead detection
**Location:** [src/lib/duplicates.ts](../src/lib/duplicates.ts), called from [src/app/api/leads/route.ts:65-78](../src/app/api/leads/route.ts#L65) and [leads/import/route.ts:40](../src/app/api/leads/import/route.ts#L40)
**Root cause:** `findDuplicateLead()` (a SELECT) and the subsequent `db.insert(leads)` are two separate statements, not a transaction, and there's no unique constraint on `(company_id, phone)` or `(company_id, email)` to catch a race at the DB level.
**How to reproduce:** Fire two concurrent `POST /api/leads` requests with the same phone number for the same company — both can pass the duplicate check before either commits, producing two leads where neither is flagged `isDuplicate`.
**Recommended fix:** Either accept this as a soft/best-effort check (document it), or add a partial unique index and catch the constraint violation to mark the second insert as a duplicate.

### H3. Unbounded outbound fetch to the Facebook Graph API
**Location:** [src/app/api/lead-sources/route.ts:70-75](../src/app/api/lead-sources/route.ts#L70)
**Root cause:** `fetch()` to `graph.facebook.com` has no `AbortController`/timeout, same class of bug as the original signup hang (an external dependency stalling with nothing bounding the wait). Node's default socket timeout is much longer than users will wait for a UI response.
**How to reproduce:** Simulate a slow/hanging response from the Graph API while connecting a lead source — the request hangs until the OS-level socket timeout, with no user feedback.
**Recommended fix:** Add an `AbortSignal.timeout(10_000)` (or manual `AbortController`) to this fetch and every other outbound Facebook Graph call in `src/lib/facebook.ts` / `src/lib/facebook-oauth.ts`.

### H4. `assignLead()` is called with no try/catch anywhere
**Location:** [src/app/api/leads/route.ts:80](../src/app/api/leads/route.ts#L80), [leads/import/route.ts:56](../src/app/api/leads/import/route.ts#L56), [webhooks/facebook/route.ts:62](../src/app/api/webhooks/facebook/route.ts#L62) (covered by its own outer catch, see C2), [webhooks/generic/[sourceId]/route.ts:74](../src/app/api/webhooks/generic/%5BsourceId%5D/route.ts#L74), [cron/recycle-leads/route.ts:49](../src/app/api/cron/recycle-leads/route.ts#L49)
**Root cause:** If `assignLead()` throws (increasingly likely per C1), `POST /api/leads` returns an unhandled 500 even though the lead itself was already successfully inserted — the client has no way to know the lead exists but is unassigned.
**Recommended fix:** Wrap the `assignLead()` call specifically so a failure to *assign* doesn't fail the whole request — log it and return the lead as created-but-unassigned.

### H5. Missing transactions around multi-step writes
**Location:**
- [src/app/api/leads/route.ts:67-88](../src/app/api/leads/route.ts#L67) — insert lead, assign, audit as 3 separate statements
- [src/app/api/leads/[id]/route.ts](../src/app/api/leads/%5Bid%5D/route.ts) — update lead, then conditionally audit disposition/owner changes separately
- [src/app/api/leads/import/route.ts:43-57](../src/app/api/leads/import/route.ts#L43) — insert + assign per row
- [src/app/api/super-admin/companies/route.ts](../src/app/api/super-admin/companies/route.ts) — see C3
**Root cause:** None of these wrap related writes in `db.transaction()`, unlike the already-fixed `/api/auth/signup`. Partial failure leaves inconsistent rows (lead exists but unassigned/unaudited).
**Recommended fix:** Apply the same `db.transaction()` pattern used in the fixed signup route.

### H6. `req.json()` unguarded across ~20 route handlers
**Location:** [auth/login/route.ts:23](../src/app/api/auth/login/route.ts#L23), [leads/route.ts:63](../src/app/api/leads/route.ts#L63), [leads/[id]/route.ts:14](../src/app/api/leads/%5Bid%5D/route.ts#L14), [leads/[id]/notes/route.ts:27](../src/app/api/leads/%5Bid%5D/notes/route.ts#L27), [lead-sources/route.ts:41](../src/app/api/lead-sources/route.ts#L41), [lead-sources/facebook/finalize/route.ts:14](../src/app/api/lead-sources/facebook/finalize/route.ts#L14), [users/route.ts:25](../src/app/api/users/route.ts#L25), [users/[id]/route.ts:14](../src/app/api/users/%5Bid%5D/route.ts#L14), [users/[id]/skills/route.ts:22](../src/app/api/users/%5Bid%5D/skills/route.ts#L22), [tags/route.ts:19](../src/app/api/tags/route.ts#L19), [dispositions/route.ts:25](../src/app/api/dispositions/route.ts#L25), [skills/route.ts:20](../src/app/api/skills/route.ts#L20), [saved-filters/route.ts:23](../src/app/api/saved-filters/route.ts#L23), [automation-settings/route.ts:20](../src/app/api/automation-settings/route.ts#L20), [assignment-rules/route.ts:20](../src/app/api/assignment-rules/route.ts#L20), [super-admin/companies/route.ts:36](../src/app/api/super-admin/companies/route.ts#L36), [super-admin/companies/[id]/route.ts:14](../src/app/api/super-admin/companies/%5Bid%5D/route.ts#L14)
**Root cause:** `await req.json()` with no surrounding try/catch. A malformed/empty body throws, and since Next.js's default unhandled-error response for a Route Handler isn't guaranteed to be JSON, any frontend caller doing `await res.json()` without its own try/catch (see M-series below) can get stuck the same way the original signup bug worked.
**Recommended fix:** Wrap `req.json()` (or the whole handler body) in try/catch returning `400` on parse failure, matching the pattern already used in `/api/auth/signup`.

### H7. Webhook retry can create duplicate leads with no idempotency guard
**Location:** [src/app/api/webhook-logs/[id]/retry/route.ts](../src/app/api/webhook-logs/%5Bid%5D/retry/route.ts)
**Root cause:** Retrying a failed webhook log re-runs lead creation from the stored payload. There's no check for "was a lead already created from this exact webhook delivery" — clicking Retry twice on the same failed log creates two leads (both get flagged `isDuplicate` by the phone/email heuristic, but both exist).
**How to reproduce:** Retry the same failed webhook log entry twice from the Webhook Logs UI.
**Recommended fix:** Store a delivery identifier (e.g. Facebook's `leadgen_id`, or a hash of the raw payload) and skip creation if a lead already references it.

### H8. Facebook webhook's outer try/catch aborts the whole batch on one bad entry
**Location:** [src/app/api/webhooks/facebook/route.ts:29-70](../src/app/api/webhooks/facebook/route.ts#L29)
**Root cause:** A single `try` wraps the nested loop over every `entry`/`change` in the payload. If `decrypt(source.accessToken)` throws for one page (e.g. a corrupted/rotated token), every other entry in the same delivery — potentially from a different, healthy page — is silently dropped too.
**Recommended fix:** Move the try/catch inside the innermost loop body so one bad entry doesn't sink the batch.

---

## Medium

### M1. Client-side fetches with no try/catch — the exact bug class already fixed in signup, still present elsewhere
Verified directly (not just from the research pass) in [src/app/(app)/leads/page.tsx](../src/app/(app)/leads/page.tsx): `load()` (lines 29-42) and `handleImportFile()` (lines 66-86) both call `fetch`/`res.json()` with no try/catch. If either throws, `setLoading(false)` (line 41) or `setImporting(false)` (line 78) never runs — the "Loading leads…" state or the "Importing…" button is stuck exactly like the pre-fix signup button was.
Also present (per the frontend research pass, pattern consistent with the above) in:
- [src/app/(app)/leads/[id]/page.tsx](<../src/app/(app)/leads/[id]/page.tsx>) — `load()` fetching 5 endpoints via `Promise.all`
- [src/app/(app)/settings/audit-log/page.tsx](../src/app/(app)/settings/audit-log/page.tsx)
- [src/app/(app)/settings/automation/page.tsx](../src/app/(app)/settings/automation/page.tsx)
- [src/app/(app)/settings/pipeline/page.tsx](../src/app/(app)/settings/pipeline/page.tsx)
- [src/app/(app)/settings/agents/page.tsx](../src/app/(app)/settings/agents/page.tsx)
- [src/app/(app)/settings/connector/page.tsx](../src/app/(app)/settings/connector/page.tsx)

**Recommended fix:** Apply the same try/catch/finally pattern used to fix `src/app/signup/page.tsx`. This is mechanical and low-risk — consider a small shared `fetchJson()` helper to avoid repeating it 7+ times.

### M2. `Sidebar.tsx` logout has no try/catch (correction: it *is* awaited)
**Location:** [src/components/Sidebar.tsx:19-23](../src/components/Sidebar.tsx#L19)
**Root cause:** `await fetch("/api/auth/logout", ...)` **is** correctly awaited before redirecting (an earlier research pass incorrectly flagged this as "not awaited" — verified false, see Retracted section). The real, smaller issue: there's no try/catch, so if the POST throws (e.g. offline), `router.push("/login")` never runs and clicking "Sign out" silently does nothing.
**Recommended fix:** Wrap in try/catch; redirect to `/login` even on failure since the client-side cookie should still be cleared by the route handler on a best-effort basis, or show an inline error.

### M3. Lead assignment race under concurrency
**Location:** [src/lib/assignment.ts:81-90](../src/lib/assignment.ts#L81)
**Root cause:** The cursor is computed from a `SELECT COUNT`-equivalent read, then used to decide the assignee, then written — two concurrent `assignLead()` calls for the same company can read the same count before either writes, sending two different leads to the same agent instead of round-robining. Not data corruption, just breaks the fairness guarantee the feature promises.
**Recommended fix:** Fixing C1 (moving to a stored cursor with an atomic `UPDATE ... RETURNING`) fixes this too.

### M4. Optimistic UI update with no rollback on failure
**Location:** [src/app/(app)/leads/page.tsx:49-56](../src/app/(app)/leads/page.tsx#L49)
**Root cause:** `updateDisposition()` updates local state immediately (line 50), then fires the PATCH with no error handling. If the PATCH fails, the UI silently shows a disposition that was never saved, with no indication to the user.
**Recommended fix:** Roll back the optimistic update (or refetch) on a non-OK response.

### M5. Login `status: "pending"` isn't actually blocked at login
See [02-security.md § Auth logic](./02-security.md) — cross-referenced here because it's a logic bug, not strictly a security hole: the signup confirmation screen tells the user their account is "pending activation," but `/api/auth/login` only blocks `status === "suspended"`, so a pending company's admin can log in and use the product immediately, undermining the manual-activation gate described in the code comments.

---

## Low

### L1. `pool` global caching only applies outside production
[src/db/index.ts:19](../src/db/index.ts#L19) — `if (process.env.NODE_ENV !== "production") global._pgPool = pool;` means the pool is never cached onto `global` in production. Harmless today (the standalone server loads this module once per process either way), but the comment/intent (survive HMR in dev) doesn't match what happens in prod — worth a comment clarifying it's dev-only by design, not a bug needing a fix.

### L2. CSV export has no pagination/streaming
[src/app/api/leads/export/route.ts](../src/app/api/leads/export/route.ts) loads every non-deleted lead for the company into memory before building the CSV. Fine at current scale; will matter once a single company has 100k+ leads. See also the performance report.

---

## Retracted (flagged by initial research, disproven on direct read — listed so they aren't re-reported)

- ~~`Sidebar.tsx` logout fetch not awaited~~ — verified `await` is present (see M2 for the real, smaller issue).
- ~~`leads/page.tsx`'s `load` function isn't memoized, causing an effect-driven infinite refetch loop~~ — verified `load` **is** wrapped in `useCallback([search])`; the debounce effect is correctly scoped and not buggy.
- ~~`/api/users/[id]/skills` `POST` and `/api/leads/[id]/attachments` `POST` are missing tenant isolation~~ — verified both correctly check `eq(<parent>.companyId, session.companyId)` before writing. (Their sibling `GET`/`DELETE` handlers *are* missing this check — see the security report, which is a real, separate finding.)
