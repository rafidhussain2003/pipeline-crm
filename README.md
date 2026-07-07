# Pipeline — Lead CRM (NexusCore spec)

A fast, multi-tenant CRM for lead ads (Facebook, Google Lead Forms, and any
generic webhook source). Built to replace a slow Airtable/Base44-based CRM:
leads come in via real-time webhooks, get auto-assigned across weighted /
skill-based agent tiers, and everything runs on a real Postgres database —
no rate limits under load.

## What's included

**Core**
- Public site (`/`) + pricing (`/pricing`, per-agent pricing) + self-serve signup (`/signup`)
- Login (`/login`) with role-based access: `super_admin`, `admin`, `agent`
- Leads table (`/leads`) with search, CSV import/export, duplicate flagging
- Lead detail page (`/leads/[id]`) — notes, tags, attachments (link-based)
- Webhook Connector (`/settings/connector`) — Facebook OAuth ("Connect with
  Facebook"), a Universal Webhook connector for Google Lead Forms/any other
  tool, and a webhook delivery log with retry
- Agents & Tiers (`/settings/agents`) — add/remove agents, tiers, skills
- Pipeline Settings (`/settings/pipeline`) — tier weights, dispositions, tags, skills
- Automation (`/settings/automation`) — auto-assign on/off, assignment mode
  (round robin / weighted / skill-based), auto-recycle stale leads
- Audit Log (`/settings/audit-log`) — who did what, when
- Super Admin (`/super-admin`) — see every company, activate/suspend/delete,
  manually add companies

**Platform / governance**
- JWT access tokens (short-lived session cookie) + DB-backed, revocable
  refresh tokens (`/api/auth/refresh`)
- Soft delete on companies, users, leads, lead sources (nothing is
  hard-deleted; history and referential integrity are preserved)
- Audit log covering logins, lead changes, agent changes, company changes
- Rate limiting on login, signup, and webhook endpoints (in-memory, sized for
  a single-instance deployment — see `src/lib/rate-limit.ts` for the note on
  scaling to multi-instance with Redis)
- Health check endpoint (`/api/health`) for Render/uptime monitoring
- Docker + `docker-compose.yml` for local dev, GitHub Actions CI (lint + build
  on every push)

Everything is company-scoped (`companyId` on every table) so adding new
companies later is just a new row — no re-deploy needed.

## Tech stack

- **Next.js 16** (App Router, TypeScript) — frontend + API routes in one app
- **PostgreSQL** via **Drizzle ORM** (`pg` driver — no native binary downloads,
  installs cleanly anywhere, including restricted-network CI/build environments)
- **JWT session cookies** for the access token, opaque DB-backed tokens for
  refresh (`bcryptjs` for password hashing)
- **AES-256-GCM** for encrypting Facebook page access tokens at rest
- Plain Tailwind CSS, no component library

A note on this choice vs. the original NestJS+Prisma spec: Prisma's installer
needs to download native binaries from a domain that's blocked in some
locked-down build/CI environments (this one included), which makes it an
unreliable foundation. Drizzle does the same job with zero native binaries.
Next.js as a single app (API routes + frontend together) also means one
deployable service instead of two, which matches the "keep it simple, it
doesn't need to be huge" instinct that started this whole project.

## Local setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up Postgres.** Either run one locally (`docker run -e POSTGRES_PASSWORD=pass -p 5432:5432 postgres:16`) or use `docker-compose up db` from this project, or point at any hosted Postgres.

3. **Copy the env file and fill it in:**
   ```bash
   cp .env.example .env
   ```
   See `.env.example` for what each variable is and how to generate it.

4. **Push the schema to your database:**
   ```bash
   npm run db:push
   ```
   (Or `npm run db:generate` + `npm run db:migrate` for versioned migrations — one's already generated at `drizzle/0000_gorgeous_energizer.sql`.)

5. **Create your Super Admin account:**
   ```bash
   SEED_SUPER_ADMIN_EMAIL=you@yourcompany.com SEED_SUPER_ADMIN_PASSWORD=somethingstrong npm run db:seed
   ```

6. **Run it:**
   ```bash
   npm run dev
   ```
   Visit `http://localhost:3000`.

### Or run everything in Docker

```bash
docker compose up --build
```
This starts Postgres + the app together. Run the schema push once against it (`DATABASE_URL=postgresql://pipeline:pipeline@localhost:5432/pipeline npm run db:push`).

## Connecting lead sources

**Facebook** — see the in-app "Connect with Facebook" button on the Connector
page. One-time setup in Meta for Developers:
1. Facebook Login for Business product → add `https://YOUR_DOMAIN/api/oauth/facebook/callback` to Valid OAuth Redirect URIs.
2. Webhooks product → subscribe to `leadgen`, callback URL `https://YOUR_DOMAIN/api/webhooks/facebook`, verify token = your `FACEBOOK_VERIFY_TOKEN`.
3. `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` from Settings > Basic.
4. For real customers (not just pages you manage), submit for App Review on `leads_retrieval` + `pages_show_list`.

**Google Lead Forms / anything else** — use "Universal Webhook" on the
Connector page. It gives you a URL + secret; point any tool that can send a
webhook (Google Lead Forms via a relay like Zapier/Pabbly, a custom form, another
CRM) at it, sending the secret in an `X-Webhook-Secret` header. Field mapping
defaults to `{name, phone, email}` top-level JSON keys; for a different
shape, update the `field_mapping` column on that `lead_sources` row (dot-path
supported, e.g. `"lead.contact.phone"`).

## Automation

**Assignment modes** (Settings > Automation):
- **Round robin** — equal split across all active agents.
- **Weighted** (default) — split by tier weight (Settings > Pipeline, default 3:2:1 for Tier 1:2:3).
- **Skill-based** — a lead can have a required skill; only agents with that skill are eligible (falls back to the full pool if nobody matches, so nothing goes unassigned).

**Auto-recycle** — reassigns leads still at "New Lead" disposition after N
minutes of inactivity to a different agent. This runs when something calls
`POST /api/cron/recycle-leads` with an `X-Cron-Secret` header matching your
`CRON_SECRET` env var — it's not a background process inside the app itself.
Set up a **Render Cron Job** (or a free external scheduler like
cron-job.org) to hit that URL every 15–30 minutes.

## Billing (Stripe)

Every company gets a **7-day free trial** the moment it's created (public
signup or super-admin-created) — no Stripe involvement, no card required.
Trial start/end and the current subscription status live on
`companies.subscriptionStatus` / `trialStartedAt` / `trialEndsAt`
(`trial` → `active` → `past_due` → `cancelled`; see the enum's comment in
`src/db/schema.ts` for exactly what each one does and doesn't block). This
is deliberately just **one plan** — there's no plan picker, no per-seat
pricing, no proration logic to maintain.

**One-time Stripe setup:**
1. Create a Product with one recurring **monthly** Price in the
   [Stripe Dashboard](https://dashboard.stripe.com/products) → copy its Price
   ID (`price_...`) into `STRIPE_PRICE_ID`.
2. Copy your API secret key (`sk_test_...` while testing) into `STRIPE_SECRET_KEY`.
3. Add a webhook endpoint pointing at `https://YOUR_DOMAIN/api/webhooks/stripe`,
   subscribed to: `checkout.session.completed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`, `invoice.payment_succeeded`. Copy its signing
   secret into `STRIPE_WEBHOOK_SECRET`.
4. For local testing, use the [Stripe CLI](https://stripe.com/docs/stripe-cli)
   instead of a dashboard webhook: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
   (it prints a `whsec_...` — use that as `STRIPE_WEBHOOK_SECRET` while it's running).

**How it fits together:**
- **Upgrade Now / Upgrade Plan** → `POST /api/billing/checkout` creates a
  Stripe Checkout Session (subscription mode) and redirects there. On
  success, Stripe redirects to `/billing/success`, which eagerly confirms
  the session server-side (so the app doesn't still look "blocked" for the
  second or two before the webhook arrives) and then sends the user to
  `/subscription`.
- **Update Card / Billing History / Cancel Subscription** → all three open
  the Stripe-hosted **Billing Portal** (`POST /api/billing/portal`), just
  deep-linked to a different starting screen. Nothing about payment methods,
  invoices, or cancellation is built or stored in this app — Stripe owns all
  of it, per the "don't build a custom payment system" rule this was built
  under.
- **Renewals and failed payments** are handled entirely by Stripe's own
  billing cycle + Smart Retries; `/api/webhooks/stripe` just mirrors the
  resulting status onto the company row. A failed payment sets `past_due`,
  which shows a warning banner but does **not** block the app (a grace
  period while Stripe retries); it only becomes `cancelled` (which does
  block) once Stripe gives up retrying and cancels the subscription.
- Only `admin` can act on billing (`billing:manage` permission) — every
  company role can see the read-only Subscription page.
- **Enforcement is centralized in `src/proxy.ts`** (this app's `proxy.js`
  file — the file convention Next.js 16 renamed `middleware.ts` to; it
  defaults to the Node.js runtime, so it can query Postgres directly). It
  decodes the session cookie and, for any `/api/*` request belonging to a
  company session, checks that company's subscription status before the
  request ever reaches its route handler — returning `402 Payment Required`
  if the trial has expired or the subscription is cancelled. This is the
  single chokepoint every company-scoped API passes through, so no
  individual route needs its own copy of the check. Explicitly exempted:
  `/api/auth/*`, `/api/webhooks/*`, `/api/health`, `/api/billing/*` (a
  blocked company must still be able to pay), `/api/super-admin/*`, and
  `/api/cron/*`. The same file also already handles page-level auth
  redirects for `/leads`, `/settings`, and `/super-admin` — the billing
  check was added alongside that, not as a second competing file (Next.js
  only supports one).

**Companies that existed before this feature shipped** were grandfathered in
by the migration (`drizzle/0005_fair_moon_knight.sql`): already-`active`
companies were set to `subscriptionStatus = 'active'` (no trial clock
running), so this rollout never silently locks out an existing customer.

## Deploying to Render

1. **Push to GitHub**, then in Render choose **New > Blueprint** and point it
   at your repo — it reads `render.yaml` and provisions the web service +
   Postgres database together, generating `JWT_SECRET`, `ENCRYPTION_KEY`, and
   `CRON_SECRET` automatically.
2. Add `FACEBOOK_VERIFY_TOKEN`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` in
   the Render dashboard (these are marked `sync: false` in the blueprint, so
   Render will prompt you for them).
3. Run the schema push once against the live database (`DATABASE_URL` = your
   Render Postgres's External Database URL): `npm run db:push && npm run db:seed`.
4. Optional: add a **Render Cron Job** hitting `https://YOUR_DOMAIN/api/cron/recycle-leads`
   with header `X-Cron-Secret: <your CRON_SECRET>` on whatever schedule you want auto-recycle to run.
5. Custom domains: Render supports adding one under Settings > Custom
   Domains for your main platform domain. Per-company custom domains are
   stored (`companies.customDomain`) and shown in Super Admin, but live
   traffic routing for those isn't wired yet — see "What's deliberately
   simple" below.

Render also picks up the included `Dockerfile` automatically if you choose a
Docker-based service instead of the native Node runtime — either works.

## What's deliberately simple / next steps

- **Platform approval and billing are separate gates** — a company still
  signs up and lands "pending" in Super Admin (that's unrelated to payment,
  and unchanged by Stripe billing above); it separately gets its own 7-day
  trial clock and, once subscribed, its own Stripe-billed status. A company
  can be platform-"pending" and billing-"trial" at the same time.
- **Per-company custom domain routing** isn't live-wired yet (stored, shown
  in Super Admin, not yet routing real traffic — needs a wildcard cert +
  host-header lookup layer).
- **Attachments are link-based**, not binary uploads through the server —
  Render's filesystem is ephemeral, so saving files to disk would lose them
  on every deploy. True in-app uploads would need an S3-compatible bucket;
  the schema doesn't need to change for that, just how `fileUrl` gets populated.
- **Rate limiting is in-memory**, sized for the single-instance deployment
  this app targets. Scaling to multiple instances behind a load balancer
  would need a shared store (Redis) instead — noted in `src/lib/rate-limit.ts`.
- **No calling/dialing/email/customer portal** — intentionally, per the brief.

Everything above is scoped so the next step is additive, not a rewrite.
