# Performance Audit & Production Launch Checklist

Scenario assumed throughout: 50 tenant companies, up to 100 agents each (~5,000 total users), single Render `starter` web service + `starter` Postgres.

## Part A — Performance bottlenecks

### A1. Lead list pagination exists on the backend but is unreachable from the UI
**Location:** Backend: [src/app/api/leads/route.ts:20-21,52-53](../src/app/api/leads/route.ts#L20) already paginates (`pageSize = 50`, `.limit().offset()`). Frontend: [src/app/(app)/leads/page.tsx:29-42](../src/app/(app)/leads/page.tsx#L29) never sends a `page` param and has no "next page" control.
**Correction to an earlier draft finding:** an initial pass described this as "fetches ALL leads at once" — that's incorrect; the API always caps at 50 rows regardless of what the client sends. The real bug is narrower but still real: **any company with more than 50 leads can never see lead #51 onward** through the UI. This is a completeness bug, not a payload-size/performance risk.
**Recommended fix:** Add page state + Prev/Next controls to `leads/page.tsx`, passing `page` through to the existing API parameter.

### A2. Lead assignment cost grows without bound (see runtime report C1/DB-1)
The single most significant performance risk in the codebase — cross-referenced from [01-runtime-bugs.md](./01-runtime-bugs.md) and [03-database-schema.md](./03-database-schema.md). At 50 companies × 100 agents actively working leads, this will visibly degrade within weeks, not years, of production traffic.

### A3. CSV export loads the entire result set into memory with no streaming
**Location:** [src/app/api/leads/export/route.ts](../src/app/api/leads/export/route.ts)
A company with 100k+ leads would load all of them into a single in-memory array before `Papa.unparse()`. Not an issue at typical CRM-per-tenant volumes, but there's no upper bound today.

### A4. CSV import is O(rows × assignment-log-size) — see H1 in runtime report
Same underlying cause as A2, amplified per-row.

### A5. No `React.memo`/virtualization on the leads table
[src/app/(app)/leads/page.tsx:151](../src/app/(app)/leads/page.tsx#L151) maps every row into a `<select>`-containing `<tr>`. Bounded by A1's 50-row cap today, so not currently a real issue — would become one only if A1 is fixed by simply raising `pageSize` instead of adding real pagination controls.

### A6. Client-side data fetching with no caching layer
Every settings/leads page fetches on mount with plain `fetch()`, no SWR/React Query/RSC caching. Acceptable for this app's size (confirmed by the cleanup audit as an intentional, documented choice — `eslint.config.mjs` explicitly disables `react-hooks/set-state-in-effect` with a comment explaining this is deliberate). Flagging only because at 100 concurrent agents per company, navigating between `/leads` and a lead detail and back re-fetches the whole list every time with no cache — acceptable, just noting it's a real (small) network cost multiplied by user count.

### A7. No `next/image`, no explicit cache headers, no revalidation
[next.config.ts](../next.config.ts) contains only `output: "standalone"` — no `headers()` config for static asset caching, no image domains configured (no `<img>`/`<Image>` usage was found that would need it, so this is a non-issue today, not a live bug). [src/app/(app)/layout.tsx](../src/app/(app)/layout.tsx) fetches the company name on every request with no `revalidate` — cheap today (a single indexed row lookup), worth revisiting if that layout starts doing more.

### A8. Facebook Graph API calls have no timeout (cross-ref H3)
Every request to a route that calls out to Facebook is only as fast as Facebook's API that day. See runtime report H3.

---

## Part B — Production launch checklist

Legend: ✅ Ready · ⚠️ Partial/needs a decision · ❌ Missing

| Area | Status | Notes |
|---|---|---|
| Health checks | ✅ | `/api/health` checks DB connectivity; wired into both `render.yaml` (`healthCheckPath`) and `Dockerfile` (`HEALTHCHECK`), though the Dockerfile path isn't actually used by this Render deployment (`runtime: node`, not Docker — see cleanup report). |
| Database migrations | ✅ | `startCommand: npm run db:migrate && npm start`, `buildCommand` includes `--include=dev` so `drizzle-kit` is present. (Both fixed in a prior session, re-verified here.) |
| Crash recovery | ✅ | Render restarts failed containers automatically; app is stateless (standalone Next server, no in-process session state beyond the rate limiter — see below). |
| Secrets / env vars | ⚠️ | Every var in `.env.example` has a matching `render.yaml` entry. **But** `JWT_SECRET`'s in-code fallback (`"dev-secret-change-me"`, see SEC-2) means a future config mistake fails *silently* instead of loudly — fix before this matters at scale. |
| Logging | ⚠️ | Present but unstructured (`console.log`/`console.error`, only the signup route has a request-correlation ID). Works, but debugging a specific user's report across concurrent traffic from 5,000 users will be painful. |
| Monitoring / error reporting | ❌ | No Sentry/APM/error-tracking integration anywhere. No `process.on('unhandledRejection'/'uncaughtException')` handlers. Production incidents are currently *only* discoverable by someone manually reading Render's log stream. |
| Backups | ⚠️ | No backup/restore scripts or runbook in-repo. Render's Postgres plans include automated backups, but there is zero documentation here of retention window, how to restore, or that anyone has ever tested a restore. Treat as unverified until someone actually does a restore drill. |
| Rate limiting | ⚠️ | Only 3 of ~34 routes are rate-limited (login, signup, generic webhook). In-memory — breaks silently if the service ever scales past 1 instance (nothing enforces single-instance; it's just currently true because the plan has no scaling block). |
| Cron jobs | ❌ | `/api/cron/recycle-leads` is fully implemented and correctly checks `CRON_SECRET`, but **`render.yaml` defines no `type: cron` service** to actually call it. `README.md` documents this as a manual setup step ("add a Render Cron Job hitting this on whatever schedule you want") — as committed, auto-recycle will never run unless someone does that by hand. |
| Test coverage | ❌ | No `*.test.*`/`*.spec.*` files exist anywhere in the repo, and no `test` script in `package.json`. Any future "run the test suite before merging" step has nothing to run. |
| Connection pooling | ⚠️ | `pg.Pool` has no explicit `max` (defaults to 10) — likely undersized for the stated 50×100 target; see DB-6. |
| Multi-instance readiness | ❌ | Rate limiter state is in-process; there is currently no other in-memory global state (verified — grepped for `global.` and ad hoc `Map`/`Set` usage, only the DB pool singleton and short-lived, request-scoped sets were found). If the plan is ever changed to run >1 instance, the rate limiter must move to a shared store (e.g. Redis) first. |
| Scalability of lead assignment | ❌ | The unbounded `assignment_log` scan (C1) will be the first thing to fail under real production load, independent of instance count. |

### Launch-blocking items (fix before onboarding real paying tenants)
1. Fix the C1 assignment-log scan (runtime report) — this is the one item that gets strictly worse over time with normal usage, not just under attack/edge-case load.
2. Add error monitoring (Sentry or equivalent) — right now a production outage is invisible until a customer reports it.
3. Decide on and configure the recycle-leads cron (`render.yaml` `type: cron` service), or remove the auto-recycle setting from the UI until it's wired up — don't ship a toggle that silently does nothing.
4. Remove the `JWT_SECRET` silent fallback (SEC-2) — cheap fix, prevents a catastrophic silent failure mode.
5. Fix the 4 cross-tenant IDOR endpoints (SEC-1) before onboarding a second real company — this is the one item that's an active vulnerability today, not a future scaling concern.

### Should decide before launch, not necessarily block it
6. Resolve the `pending`-company login gap (SEC-5) — confirm intended behavior with whoever owns the billing/activation process.
7. Explicit `max` on the connection pool (DB-6), sized against the real Render Postgres plan limit.
8. Backup restore drill — do it once before you need it for real.
