# Repository Cleanup Report

Overall assessment: this is a clean, consistently-structured codebase for its size. No unused dependencies, no orphaned component files, consistent TypeScript usage. The issues below are real but mostly minor — nothing here blocks a launch.

## Dead code

### CU-1. `src/proxy.ts` is never executed
**Root cause:** Next.js App Router only loads middleware from a file literally named `middleware.ts` (or `.js`) at the project root or `src/` root. This file exports a function named `proxy` and a `config` object, following neither the filename nor export-name convention — verified there is no `middleware.ts` anywhere in the repo, and nothing imports `src/proxy.ts`'s exports from anywhere else.
**Consequence:** the route protection this file was clearly written to provide (`/leads`, `/settings`, `/super-admin` redirect-to-login logic) never runs. This doesn't currently expose any data (every API route independently checks `getSession()`, confirmed in the security report), but it means there's no edge-level redirect — an unauthenticated visitor briefly sees the client-rendered page shell before the in-page fetch calls start 401ing.
**Recommended action:** Either delete this file (it's genuinely dead), or rename it to `middleware.ts` and its export to `middleware` if the intended edge-redirect behavior is still wanted — the second option is preferable since it was clearly intentional and would add real defense-in-depth.

### CU-2. `Dockerfile` is not used by the actual Render deployment
`render.yaml` specifies `runtime: node` (buildpack-style build/start commands), not Docker — confirmed Render will not build this Dockerfile for the deployment described in this repo. It's still useful for `docker-compose.yml`-based local development and would work for a different deployment target. Recommended action: add a one-line comment at the top of the Dockerfile noting it's for local/alternative deployment only, not the active Render path, so a future maintainer doesn't assume changes here affect production.

## Duplicate / repeated code

### CU-3. Auth-check boilerplate repeated in ~30 route handlers
The 2-3 line pattern `const session = await getSession(); if (!session || !session.companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });` is repeated near-verbatim across nearly every route in `src/app/api/`. Not wrong, just repetitive. **Recommended action:** extract a `requireSession()` helper that returns either the session or throws/returns a pre-built 401 response, to cut this to one line per route. Low priority — purely a maintainability nicety.

### CU-4. Super-admin company creation duplicates the signup route's logic
[src/app/api/super-admin/companies/route.ts](../src/app/api/super-admin/companies/route.ts) re-implements the same company + admin + seed-data creation as `/api/auth/signup`, but wasn't updated when signup was hardened (see runtime report C3). **Recommended action:** extract a shared `createCompanyWithAdmin()` function used by both routes, so a future fix only needs to happen once.

### CU-5. Settings pages repeat the same fetch-on-mount/save/reload pattern
`settings/agents`, `settings/pipeline`, `settings/automation`, `settings/connector` all follow: fetch on mount → local state → PATCH/POST on save → refetch. **Recommended action:** a small `useCRUDEntity(endpoint)` hook would remove most of the repetition, but this is a nice-to-have, not a defect.

## Large components (candidates for splitting, not currently broken)

| File | Lines | Concerns handled |
|---|---|---|
| [src/app/(app)/settings/connector/page.tsx](../src/app/(app)/settings/connector/page.tsx) | ~308 | Facebook OAuth UI, generic webhook creation, webhook log display + retry, 12+ pieces of state |
| [src/app/(app)/settings/agents/page.tsx](../src/app/(app)/settings/agents/page.tsx) | ~213 | Agent list, add-agent form, skill toggling |
| [src/app/(app)/settings/pipeline/page.tsx](../src/app/(app)/settings/pipeline/page.tsx) | ~186 | Dispositions + tags + skills management in one page |

None of these are functionally broken; splitting them is a maintainability call, not a bug fix.

## Environment variables

Cross-checked every `process.env.X` usage in `src/` against `.env.example` — no undocumented env vars found, no documented-but-unused vars found (the seed-only `SEED_SUPER_ADMIN_EMAIL`/`SEED_SUPER_ADMIN_PASSWORD` used by `src/db/seed.ts` are dev-only utilities by design, correctly not listed as production config).

## TypeScript / Next.js best practices

- **Correction to an earlier draft finding:** an initial pass claimed zero non-null assertions (`!`) exist in the codebase. This is **not accurate** — verified one at [src/app/api/super-admin/companies/route.ts:84](../src/app/api/super-admin/companies/route.ts#L84): `userId: session!.userId`. It's low-risk (a `requireSuperAdmin()` guard already ran two lines earlier, so `session` is logically non-null at that point, TypeScript just can't see through the helper function), but it is technically present and should be corrected if "zero non-null assertions" is treated as a hard rule anywhere (e.g. a lint rule enforcing this).
- No `any` types found elsewhere; `unknown` is used correctly for webhook payloads.
- No `@ts-ignore`/`@ts-expect-error` found.
- No test files (`*.test.*`/`*.spec.*`) exist anywhere, and there is no `test` script in `package.json` — flagged again here because it's as much a repo-hygiene gap as a launch-readiness one (see performance/launch report).
- No `loading.tsx`/`error.tsx` route-segment files exist under `src/app/(app)/`; every page manages its own loading/error state client-side instead. This is consistent throughout (not a half-migrated pattern), and documented as intentional in `eslint.config.mjs`'s comment about client-side data loading — noting it here as a stylistic observation, not a defect.
- `eslint-disable-next-line react-hooks/exhaustive-deps` at [leads/[id]/page.tsx:55](<../src/app/(app)/leads/[id]/page.tsx#L55>) papers over a `load` function that isn't wrapped in `useCallback` — low-risk today, but worth fixing the same way `leads/page.tsx` already correctly does it (see runtime report's retracted-findings note — `leads/page.tsx` itself does this correctly).

## Summary

No unused npm dependencies, no orphaned files, no undocumented/unused env vars, no critical architecture violations. Real, worthwhile cleanup items: delete or properly wire up `proxy.ts` (CU-1), de-duplicate the super-admin company-creation logic before it drifts further from the fixed signup route (CU-4), and add a test script + at least smoke-test coverage for the routes touched by this audit.
