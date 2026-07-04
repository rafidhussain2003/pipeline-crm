# Competitive Product Roadmap (vs. HubSpot-class CRM)

Assessed from the actual implemented surface: leads (list/detail/notes/tags/attachments/import/export), agents with tiers + skills, configurable assignment rules (round-robin/weighted/skill-based), automation (auto-assign, auto-recycle), dispositions, Facebook Lead Ads + generic webhook ingestion with retry, audit log, super-admin multi-tenant management, saved filters. No code changes below — this is planning only, per your instruction.

## Critical (blocks a serious sales motion or enterprise deal today)

1. **Reporting & analytics — currently zero.** No dashboard, no conversion-rate/funnel view, no per-agent or per-source performance, no time-to-first-contact metric. Confirmed by direct search: there is no `dashboard`, `report`, or `analytics` page anywhere in `src/app/`. This is the single biggest gap relative to any competing CRM — the product currently cannot answer "how are we doing" without someone manually exporting CSVs.
2. **Fix the confirmed cross-tenant data leaks (SEC-1) before onboarding a second paying company.** An enterprise security review would fail immediately on this; it's also simply the right thing to do regardless of sales motion.
3. **Only 3 fixed roles, no scoped visibility.** `super_admin` / `admin` / `agent` — there is no "team lead"/"supervisor" tier who can see and manage a subset of agents' leads without full company-admin rights, and no custom permission sets. Any company with more than a handful of agents will want team-level structure.
4. **Billing is 100% manual.** Company `status` (`pending`/`active`/`suspended`) is a super-admin-flipped switch with no Stripe/metered-billing integration (confirmed intentional per the code's own comments — "manual-billing phase"). This doesn't scale past a small number of hand-managed accounts and blocks self-serve growth.
5. **No 2FA/SSO.** Password + JWT only. Any enterprise security questionnaire will flag this immediately for admin/super-admin accounts especially.
6. **Incomplete audit trail (9 mutating routes unaudited, see QA report §13).** Assignment-rule changes — which silently change how every future lead is routed — currently leave no trace of who changed them or when. This is a compliance gap for regulated industries (a common CRM buyer segment: insurance, finance, healthcare-adjacent lead gen).

## Important (needed to be competitive, not launch-blocking)

7. **No task/reminder surfacing.** `leads.follow_up_at` exists in the schema but there's no "my tasks today" view or notification tied to it — a core HubSpot workflow (follow-up reminders) is half-built (data model exists, UI doesn't).
8. **No deal/revenue tracking.** Dispositions are just labeled/colored stages with no associated dollar value, so there's no pipeline-value forecasting, win-rate, or revenue reporting — this is table stakes for anything competing on "CRM," not just "lead router."
9. **No outbound integration surface.** The app only *receives* webhooks (Facebook, generic inbound); there's no outbound webhook/public API for a customer to push CRM events into Zapier, Slack, or their own systems.
10. **No bulk actions.** No bulk reassign, bulk disposition change, or bulk tagging on the leads list — at 100 agents/company with potentially thousands of leads, one-at-a-time editing doesn't scale operationally.
11. **Lead sources limited to Facebook + generic webhook.** No native Google Ads/LinkedIn Lead Gen/email-to-lead connectors — each new source today requires a customer to hand-build a generic webhook + field mapping.
12. **No in-app notifications.** New-lead-assigned, note-mentions, etc. have no notification surface — agents have to keep refreshing the leads list.
13. **No custom fields.** The lead schema is fixed-shape (`name`/`phone`/`email`/`state`/`disposition`); companies with industry-specific data (policy numbers, property addresses, etc.) have nowhere to put it except `rawPayload` (opaque JSON, not usable in the UI).
14. **No account-level data export/portability** beyond the leads CSV export — no full-account export for GDPR-style data requests or customer offboarding.

## Nice to have (differentiators, not gaps that lose deals)

15. **Finish or remove `customDomain`.** The schema and super-admin UI both reference a per-company custom domain, but nothing in the app actually resolves tenancy from the request's `Host` header — it's a half-built feature that currently does nothing when set. Either wire it up or remove the UI so it stops looking implemented.
16. Mobile app / PWA support for field agents.
17. Built-in dialer/call-recording integration (common in lead-gen-heavy verticals this product seems aimed at, given "tier"-based agent weighting and lead recycling).
18. Coaching/QA features: call/interaction scorecards, agent leaderboards.
19. Built-in email/SMS sequences and templates for outreach (currently zero communication tooling — the CRM only tracks leads, it doesn't help contact them).
20. In-app collaboration: @mentions in notes, per-note visibility controls.
21. White-labeling for agencies who might resell this to their own clients (relevant given the multi-tenant architecture is already there).

## What's already solid (don't rebuild these)

- Multi-tenant data model with per-company scoping on nearly every table (aside from the SEC-1 gaps, which are enforcement bugs, not architecture problems).
- Configurable, genuinely-implemented lead assignment (three real modes, not a stub).
- Facebook Lead Ads integration is complete end-to-end (OAuth, token encryption, webhook subscription, incoming lead processing).
- Duplicate-lead detection and audit logging exist as first-class concepts, just need broader coverage (see Critical #6) and a hardening pass (see runtime/security reports) rather than a rebuild.
