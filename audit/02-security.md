# Security Audit

Every route under `src/app/api/**/route.ts` was read. The findings below marked "verified directly" were personally re-read against source after the initial research pass, because the research pass initially flagged several tenant-isolation issues that turned out to be false positives on the specific endpoint it named (though it had, correctly, found the real pattern one method away). Treat the "verified" tag as the confidence signal.

**No code has been changed.** This is a report only, per your instruction.

---

## Critical

### SEC-1. Cross-tenant data leak: 4 endpoints return another company's data if you know/guess an ID
**Status: verified directly, all four.**

This is one systemic bug repeated in four files: the `POST` handler on each of these correctly checks that the parent resource (`lead` or `user`) belongs to `session.companyId` before writing, but the sibling `GET` (and in two cases `DELETE`) handler skips that check entirely and queries only by the child's own foreign key.

| Endpoint | Method(s) affected | File:line | What leaks |
|---|---|---|---|
| Lead tags | `GET`, `DELETE` | [src/app/api/leads/[id]/tags/route.ts:12](<../src/app/api/leads/[id]/tags/route.ts#L12>), [:38](<../src/app/api/leads/[id]/tags/route.ts#L38>) | Tag IDs attached to any lead in any company; any authenticated user can also delete a tag mapping on another company's lead |
| Lead notes | `GET` | [src/app/api/leads/[id]/notes/route.ts:17](<../src/app/api/leads/[id]/notes/route.ts#L17>) | Full note text + author name for any lead in any company |
| Lead attachments | `GET` | [src/app/api/leads/[id]/attachments/route.ts:25](<../src/app/api/leads/[id]/attachments/route.ts#L25>) | File names/URLs attached to any lead in any company |
| Agent skills | `GET`, `DELETE` | [src/app/api/users/[id]/skills/route.ts:12](<../src/app/api/users/[id]/skills/route.ts#L12>), [:42](<../src/app/api/users/[id]/skills/route.ts#L42>) | Skill IDs for any user in any company; any admin can also remove a skill from another company's agent |

**Root cause:** each `GET`/`DELETE` does e.g. `db.select().from(leadTags).where(eq(leadTags.leadId, id))` with `id` taken straight from the URL, and never joins back to `leads`/`users` to confirm `companyId === session.companyId`. UUIDs aren't guessable by brute force, but this is a textbook IDOR (insecure direct object reference): any authenticated user of *any* company — down to the lowest-privilege agent role — who obtains another company's lead/user ID (e.g. from a leaked URL, a shared support ticket, a previous employer's data) can read or, for two of them, mutate that company's data.
**How to reproduce:** As an authenticated agent of Company A, call `GET /api/leads/<lead_id_belonging_to_company_B>/notes` — the notes return successfully.
**Recommended fix:** Add the same `and(eq(<parent>.id, id), eq(<parent>.companyId, session.companyId))` existence check already used in each sibling `POST` handler, to every `GET` and `DELETE` in this table.

---

## High

### SEC-2. JWT signing falls back to a hardcoded, publicly-known secret
**Location:** [src/lib/auth.ts:5](../src/lib/auth.ts#L5) — `const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";`
**Root cause:** `render.yaml` sets `JWT_SECRET` via `generateValue: true`, so in the currently-committed deployment config this fallback should never trigger. But the fallback is silent — if that env var is ever unset (a config edit, a redeploy from a different blueprint, a manual dashboard change), the app keeps running and starts signing/accepting sessions with a secret that's sitting in this public-facing source file. Anyone can then forge a valid session cookie for any `userId`/`companyId`/`role` (including `super_admin`).
**Recommended fix:** `throw new Error("JWT_SECRET must be set")` at module load instead of silently falling back, matching the pattern already used in `src/lib/crypto.ts` for `ENCRYPTION_KEY`.

### SEC-3. Weak password policy
**Location:** [src/app/api/auth/signup/route.ts:17](../src/app/api/auth/signup/route.ts#L17), [src/app/api/users/route.ts](../src/app/api/users/route.ts)
**Root cause:** `password: z.string().min(8)` — length only, no complexity requirement. `"12345678"` is accepted for the account that becomes a company's first admin.
**Recommended fix:** Add a complexity check (or, better, check against a breached-password list / just raise min length to 10-12) — this is a product decision, flagging for your call.

### SEC-4. In-memory rate limiting covers 3 of ~34 routes, and won't survive horizontal scaling
**Location:** [src/lib/rate-limit.ts](../src/lib/rate-limit.ts); only used in `auth/login`, `auth/signup`, `webhooks/generic/[sourceId]`.
**Root cause:** Every other authenticated CRUD route (`leads`, `users`, `tags`, `dispositions`, `assignment-rules`, etc.) and every unauthenticated route except the three above (`oauth/facebook/*`, `webhooks/facebook`, `cron/recycle-leads`) has no rate limit. This isn't necessarily wrong for authenticated internal routes, but the two OAuth/webhook entry points that accept unauthenticated traffic have no throttle. Separately, the limiter is a per-process `Map` — if Render ever runs more than one instance, each instance has its own counter, and the effective limit becomes `limit × instance_count`.
**Recommended fix:** Rate-limit the public OAuth start/callback endpoints and the Facebook webhook; document the single-instance assumption prominently (it's already noted in the file's own comment, but not enforced or checked anywhere in `render.yaml`).

### SEC-5. Login logic doesn't actually enforce the "pending" gate the product describes
**Location:** [src/app/api/auth/login/route.ts:39-44](../src/app/api/auth/login/route.ts#L39)
**Root cause:** Only `company.status === "suspended"` blocks login; `"pending"` (the status every self-signup company starts in, per [signup/route.ts:85](../src/app/api/auth/signup/route.ts#L85)) is not checked. The signup confirmation page tells the user "Your company is pending activation… our team will review and activate it shortly," implying they can't use the product yet — but they can log in and use every feature immediately. This isn't a classic vuln (it's the account's own admin using their own data), but it defeats the manual-approval/billing gate that's clearly the intended design (see the `status` enum comment in `schema.ts:19`).
**Recommended fix:** Confirm intent with the product owner; if pending companies should be blocked, add `|| company.status === "pending"` to the login check (and decide what UX a blocked pending user sees).

---

## Medium

### SEC-6. Unvalidated JSON blobs stored and later trusted
**Location:** `fieldMapping` in [src/app/api/lead-sources/route.ts](../src/app/api/lead-sources/route.ts) and `filterJson` in [src/app/api/saved-filters/route.ts:23-28](../src/app/api/saved-filters/route.ts#L23)
**Root cause:** Both are stored as raw JSONB with no schema validation. `field-mapping.ts`'s `resolvePath()` walks a dot-path string supplied via `fieldMapping` — it was read and confirmed to only do plain property lookups (no `eval`, no `Function()`, no `Object.assign` merge into a mutable prototype-bearing object), so this is **not** an exploitable prototype-pollution vector today, but there's no validation stopping a company admin from storing a mapping that later causes confusing runtime behavior (e.g. mapping to `__proto__` would just fail to resolve, not pollute — verified by reading the walk implementation).
**Recommended fix:** Add a zod schema for `fieldMapping` (`Record<string, string>` with a denylist for path segments like `__proto__`, `constructor`, `prototype`) as defense-in-depth even though the current implementation isn't vulnerable.

### SEC-7. Generic webhook and Facebook webhook payloads aren't size-limited
**Location:** [src/app/api/webhooks/generic/[sourceId]/route.ts](<../src/app/api/webhooks/generic/[sourceId]/route.ts>), [src/app/api/webhooks/facebook/route.ts](../src/app/api/webhooks/facebook/route.ts)
**Root cause:** `req.json()` has no size cap before the payload is stored into a `jsonb` column. Postgres will reject truly enormous rows, but there's nothing stopping a large payload from being accepted, parsed, and stored, consuming memory and DB storage.
**Recommended fix:** Add a `Content-Length` check or body-size middleware ahead of `req.json()`.

---

## Verified clean (checked explicitly, no issue found)

- **SQL injection:** No raw `sql\`...\`` string interpolation of user input found anywhere; all queries go through Drizzle's parameterized query builder (`eq`, `and`, `ilike`, etc.). `src/app/api/health/route.ts`'s `sql\`SELECT 1\`` has no interpolated values.
- **Command injection:** No `child_process`/`exec`/`spawn` usage anywhere in `src/`.
- **Cookies:** `httpOnly: true` and `sameSite: "lax"` on both session and refresh cookies ([src/lib/auth.ts](../src/lib/auth.ts)); `secure` is conditional on `NODE_ENV === "production"`, which is correct (Render sets `NODE_ENV=production`).
- **CSRF:** `sameSite: "lax"` blocks cross-site `POST` cookie submission in all modern browsers, which covers the realistic CSRF surface here (no state-changing `GET` routes were found).
- **Password hashing:** `bcryptjs` with a cost factor of 10 ([src/lib/auth.ts:17](../src/lib/auth.ts#L17)) — reasonable.
- **Session fixation:** Login and signup both issue a *new* signed JWT and a *new* DB-backed refresh token on every successful auth; nothing reuses a pre-existing token.
- **Privilege escalation via the users API:** Verified directly — `POST /api/users` forces `role === "admin" ? "admin" : "agent"` ([users/route.ts:38](../src/app/api/users/route.ts#L38)), and `PATCH /api/users/[id]` only whitelists `name`/`tier`/`active` ([users/[id]/route.ts:16](<../src/app/api/users/[id]/route.ts#L16>)) — `role` cannot be changed through this endpoint by anyone, including admins, so there is no path for an agent (or even an admin) to mint a `super_admin`.
- **Open redirect:** Facebook OAuth callback and login page redirects go to hardcoded internal paths (`/leads`, `/super-admin`, `/settings/connector`), not to a user-controlled URL parameter.
- **Path traversal / unsafe uploads:** There is no server-side file upload handling at all — `lead_attachments` stores a URL string pointing to externally-hosted files (Google Drive/S3/etc.), by explicit design documented in [leads/[id]/attachments/route.ts:8-16](<../src/app/api/leads/[id]/attachments/route.ts#L8>). No path traversal surface exists because the app never touches a filesystem path derived from user input.
- **SSRF:** The only user-influenced outbound fetch is to the Facebook Graph API using an access token the user pastes ([lead-sources/route.ts](../src/app/api/lead-sources/route.ts)) — the *target host* (`graph.facebook.com`) is hardcoded, not user-supplied, so this isn't an SSRF vector (a bad token just gets rejected by Facebook, it can't redirect the fetch elsewhere).
- **Secret leakage in logs:** Grepped all `console.log`/`console.error` call sites for password/token/secret values — none found. The signup route's step logging includes email and plan but hashes the password before logging anything.
- **CORS:** No custom CORS headers are set anywhere (no `Access-Control-Allow-Origin`), so the Next.js default same-origin policy applies; there's no permissive wildcard CORS misconfiguration.
- **Middleware bypass:** `src/proxy.ts` is confirmed dead code (see the cleanup report) — but this doesn't create an auth gap because every API route independently calls `getSession()` and every protected page's data fetch goes through those same API routes. The absence of middleware means there's no *defense in depth* at the edge (an unauthenticated request to `/leads` briefly renders the client shell before the in-page fetch 401s), but no protected data is actually exposed via this gap. See cleanup report for the dead-file finding itself.
