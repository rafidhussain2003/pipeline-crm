# QA Workflow Report

**Method note:** there is no running instance of this app and no local Postgres available in this environment (no Docker, no Node.js runtime installed), and pointing a live test at the real Render deployment/production database would be inappropriate without explicit authorization. Every workflow below was traced statically — reading the UI code, the API route(s) it calls, and the library functions involved — not observed by clicking through a running app. Repro steps describe what *should* happen based on the code; treat them as a QA script to run manually against a real deployment, not as confirmed observed behavior.

---

### 1. Signup — Working, with a logic gap
Files: `signup/page.tsx` → `auth/signup/route.ts` → `lib/auth.ts`, `lib/refresh-tokens.ts`, `lib/audit.ts`
- Happy path is complete: creates company (`status: "pending"`), admin user, default dispositions/assignment-rules/automation-settings, session + refresh cookies, audit record. (Already hardened for the hang bug in a prior session — transaction + try/catch + logging in place.)
- **Gap:** the confirmation screen says the account is "pending activation" and implies limited access until a super-admin approves it — but see Workflow 2, login doesn't actually enforce that. A QA tester following the happy path will find they can use the full product immediately after signup, which may look like a bug relative to the on-screen copy even though nothing crashes.

### 2. Login — Working, but confirms the pending-company gap
Files: `login/page.tsx` → `auth/login/route.ts`
- Verified directly: [login/route.ts:39-44](../src/app/api/auth/login/route.ts#L39) only blocks `company.status === "suspended"`, not `"pending"`.
- **Repro:** Sign up a new company → see "pending activation" message → go to `/login` with the same credentials → login succeeds and the full app is usable.
- Rate limiting present (10/min/IP), audit record written on success.

### 3. Logout — Working correctly
Files: `Sidebar.tsx` → `auth/logout/route.ts` → `lib/refresh-tokens.ts`
- Verified directly: the fetch to `/api/auth/logout` **is** awaited before redirecting (corrects an earlier draft finding that claimed otherwise). The logout route revokes the DB-backed refresh token (not just clearing cookies), so a copied/stolen refresh token stops working immediately after logout.
- **Minor gap (see runtime report M2):** no try/catch around the fetch — if it fails (offline), the button does nothing with no error shown.

### 4. Forgot password — Feature does not exist
Searched the entire repo for "forgot", "reset-password", "password-reset" — no matches other than an unrelated "reset" in the lead-recycle cron's naming. There is no dead link pointing to a nonexistent page (the login page doesn't reference a reset flow it doesn't have), so this isn't a *broken* flow — it's simply an **absent** one. A user who forgets their password today has no self-serve path; recovery would require a super-admin or direct DB access. Worth a deliberate product decision (README describes this phase as "deliberately simple").

### 5. Lead import — Working
Files: `leads/page.tsx` (Import CSV button) → `leads/import/route.ts` → `lib/duplicates.ts`, `lib/assignment.ts`
- Admin-only, flexible CSV header matching (`name`/`Name`, etc.), duplicate flagging, per-row assignment, audit record with created/duplicate/skipped counts.
- **Performance concern, not correctness:** cross-ref runtime report H1 — large imports get slower as the company's assignment history grows.
- **UI gap:** no try/catch around the fetch (runtime report M1) — a failed import (e.g. request times out on a huge file) leaves the "Importing…" button stuck rather than showing an error.

### 6. Lead assignment — Working, all three modes implemented
Files: `lib/assignment.ts`, `assignment-rules/route.ts`, `automation-settings/route.ts`
- `round_robin`, `weighted` (tier-weighted, configurable), and `skill_based` (falls back to the full pool if nobody has the required skill, so a lead is never stranded) are all implemented and match what the settings UI exposes — no silent no-op mode.
- Called consistently from manual creation, CSV import, both webhook handlers, and the recycle cron.
- **Correctness concern, not a UI bug:** cross-ref runtime report C1/M3 — the cursor logic has a scalability ceiling and a minor fairness race under concurrent assignment.

### 7. Notes — Working
Files: `leads/[id]/notes/route.ts`, `leads/[id]/page.tsx`
- Add/list notes with author name, audit-logged on creation.
- **Security gap:** `GET` doesn't verify the lead belongs to the caller's company (SEC-1) — a QA tester with two test-tenant accounts could confirm this by requesting another tenant's lead's notes directly.

### 8. Tags — Working
Files: `tags/route.ts`, `leads/[id]/tags/route.ts`, `leads/[id]/page.tsx`
- Create/list company tags, attach/detach per lead via `onConflictDoNothing()` (safe against duplicate attach).
- Any authenticated user (not just admin) can create a new tag — intentional-looking (tags are presentational), but worth confirming with product.
- Tag creation/attachment isn't audit-logged (contrast with notes/attachments, which are).
- **Security gap:** same IDOR pattern as notes (SEC-1) — `GET`/`DELETE` don't check tenant ownership.

### 9. Users (agents & tiers) — Working, no privilege escalation found
Files: `users/route.ts`, `users/[id]/route.ts`, `users/[id]/skills/route.ts`, `settings/agents/page.tsx`
- Verified directly: role is forced to `"agent"` unless explicitly `"admin"` on create, and the `PATCH` update whitelist (`name`, `tier`, `active`) never includes `role` — there is no path for an agent, or even an admin, to self-promote to `super_admin` through this API.
- **Security gap:** skills `GET`/`DELETE` have the same IDOR pattern (SEC-1).

### 10. Automation (auto-assign / auto-recycle) — Implemented but not scheduled in production
Files: `automation-settings/route.ts`, `settings/automation/page.tsx`, `cron/recycle-leads/route.ts`, `render.yaml`
- Auto-assign works as part of the normal lead-creation path.
- Auto-recycle's logic is correct and audit-logged, and correctly validates `X-Cron-Secret` — but **`render.yaml` defines no cron service to ever call it.** `README.md` documents this as an optional manual step. As committed, toggling "auto-recycle" on in the UI does nothing in production until someone manually configures a Render Cron Job (or an external scheduler) — this will look like a broken feature to any customer who enables it, even though the code itself is correct.
- **Repro:** enable auto-recycle in Settings → Automation, wait past the configured threshold → no lead is ever recycled, because nothing ever calls the endpoint.

### 11. Facebook integration — Working end-to-end
Files: `oauth/facebook/start`, `oauth/facebook/callback`, `lead-sources/facebook/pending`, `lead-sources/facebook/finalize`, `lib/facebook-oauth.ts`, `lib/facebook.ts`, `settings/connector/page.tsx`, `webhooks/facebook/route.ts`
- Full OAuth dance traced and complete: signed short-lived state token → code exchange → long-lived token → page list held in a signed httpOnly cookie → page selection → webhook subscription → encrypted token storage.
- Incoming webhook creates leads and assigns them correctly.
- **Reliability gap:** cross-ref runtime report C2/H8 — malformed payloads or one bad page's decrypt failure can abort processing of the whole delivery/batch.

### 12. Webhook retries — Working, but not idempotent
Files: `webhook-logs/route.ts`, `webhook-logs/[id]/retry/route.ts`, both webhook handlers
- Retry correctly re-applies the stored field mapping and creates a lead from the original payload.
- **Bug (runtime report H7):** retrying the *same* failed log twice creates two separate leads (both flagged as duplicates of each other via the phone/email heuristic, but both exist as real rows). A QA tester can reproduce this by clicking Retry twice on one failed webhook log entry.

### 13. Audit logs — Working for major entities, incomplete coverage
Files: `lib/audit.ts`, `audit-log/route.ts`, `settings/audit-log/page.tsx`
- Confirmed audited: signup, login, lead create/update/delete, lead notes, lead attachments, lead import, recycle-cron reassignments, agent add/update/remove, super-admin company actions.
- **Confirmed NOT audited** (verified by grep for `recordAudit(` across every mutating route): `assignment-rules` PATCH (tier weight changes — arguably the most important gap, since this silently changes how every future lead gets routed), `automation-settings` PATCH, `dispositions` POST, `tags` POST, `leads/[id]/tags` POST/DELETE, `skills` POST, `users/[id]/skills` POST/DELETE, `lead-sources` POST, `saved-filters` POST.
- Not a broken workflow, but a compliance/traceability gap worth deciding on deliberately — an admin's assignment-rule change today leaves no trace of who changed it or when.

---

## Summary

| # | Workflow | Status |
|---|---|---|
| 1 | Signup | Working (product-logic gap: see #2) |
| 2 | Login | Working (pending-company gate not enforced) |
| 3 | Logout | Working |
| 4 | Forgot password | Feature missing (not broken — never built) |
| 5 | Lead import | Working (perf risk under load) |
| 6 | Lead assignment | Working (scalability ceiling) |
| 7 | Notes | Working (IDOR on GET) |
| 8 | Tags | Working (IDOR on GET/DELETE, no audit) |
| 9 | Users | Working, no privilege escalation |
| 10 | Automation | Implemented but unscheduled in prod (cron not configured) |
| 11 | Facebook integration | Working |
| 12 | Webhook retries | Working, not idempotent (duplicate leads on double-retry) |
| 13 | Audit logs | Working, incomplete coverage on 9 config-mutating routes |
