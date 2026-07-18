import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  real,
  numeric,
  date,
  bigint,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// "manager" sits between admin and agent (Leads + Agents + Reports, but not
// company-wide settings/API keys/audit log/integrations — see
// src/lib/permissions.ts). There is no separate "owner" value: company
// deletion isn't even a company-level action in this app (only super-admin
// can delete a company), so "Owner" has no enforceable difference from
// "admin" here — it's shown in the Agents UI as a computed label (the
// earliest-created admin per company), not a stored role.
export const roleEnum = pgEnum("role", ["super_admin", "admin", "manager", "agent"]);
// Tiers are a configurable priority band, not hardcoded logic — the ORDER/
// weight of each tier comes from assignment_rules + the AI tier factor's
// config, never from the enum values themselves. "senior"/"supervisor" (Phase
// 5) are additive; give them a weight in config to prioritize them.
export const tierEnum = pgEnum("tier", ["1", "2", "3", "senior", "supervisor"]);
export const companyStatusEnum = pgEnum("company_status", [
  "pending", // signed up, awaiting super-admin activation (manual billing phase)
  "active",
  "suspended",
]);
// "google" (existing) is the Universal-Webhook stopgap for Google Lead
// Forms delivered via a relay (Zapier/Pabbly) — pageName defaults to
// "Google Lead Form" for it, see api/lead-sources/route.ts. "google_ads" is
// kept distinct for the real future OAuth-based Google Ads integration
// (its own connectedAccounts identity, its own token) so the two are never
// ambiguous once both exist.
//
// typeform / gravityforms / jotform / wordpress / gohighlevel / zapier /
// make all reuse the exact same Universal Webhook mechanism as "generic" —
// they exist as distinct values purely so the Lead Sources UI can label a
// connection by which tool it's actually from, not because any of them
// need their own route or backend logic (see the generic webhook receiver
// at api/webhooks/generic/[sourceId]).
//
// "website" IS its own first-class provider (a customer's own site form via
// the embed.js snippet / a direct <form action>): unlike the server-to-
// server "generic" webhook (which authenticates with a shared secret), a
// website form is submitted from the visitor's browser, so it can't carry a
// secret and instead relies on a public source id + spam protection
// (honeypot + rate limit + optional CAPTCHA). See api/forms/[sourceId].
export const sourcePlatformEnum = pgEnum("source_platform", [
  "facebook",
  "google",
  "google_ads",
  "tiktok",
  "linkedin",
  "microsoft",
  "generic",
  "website",
  "typeform",
  "gravityforms",
  "jotform",
  "wordpress",
  "gohighlevel",
  "zapier",
  "make",
  "reddit",
  "other",
]);
// "skipped" is not a failure — it's an intentional no-op (a disabled form,
// a duplicate delivery, a disconnected source) that still deserves a row
// so "why didn't this lead show up" is always answerable from the Delivery
// Log rather than requiring a server-log search. See webhookLogs.stage
// below for exactly which point in the pipeline a "failed" row stopped at.
export const webhookLogStatusEnum = pgEnum("webhook_log_status", ["success", "failed", "retried", "skipped"]);

// The 5-step lead-delivery pipeline shown on the Delivery Log page. For a
// "success" row this is always "completed"; for a "failed" row it's the
// last stage actually reached before the failure (e.g. stage="received"
// with status="failed" means the Graph API lead fetch — the step after
// "received" — is what failed).
export const webhookStageEnum = pgEnum("webhook_stage", [
  "received",
  "lead_downloaded",
  "lead_stored",
  "lead_assigned",
  "completed",
]);

// A lead source's own connection health, distinct from webhookLogStatusEnum
// (which is per-delivery-attempt) and from webhookStatusEnum below (whether
// Facebook is actually subscribed to push events — a token can be fine
// while the subscription itself was dropped independently). Mirrors
// ProviderErrorKind in lib/lead-sources/provider.ts: token_expired,
// permission_revoked, and not_found are set by the webhook receiver/
// sync-now when a Graph API call fails, distinguishing "reconnect" from
// "grant permission again" from "this Page/form no longer exists" instead
// of one generic error. "disconnected" is set by the user-initiated
// Disconnect action.
export const leadSourceStatusEnum = pgEnum("lead_source_status", [
  "connected",
  "token_expired",
  "permission_revoked",
  "not_found",
  "error",
  "disconnected",
]);

// Whether the provider (Facebook) currently has an active push
// subscription for this connection — separate from token/connection
// health because a healthy token doesn't guarantee the subscription itself
// is still active (Facebook can drop it independently, e.g. if the app
// briefly failed its webhook verification).
export const webhookStatusEnum = pgEnum("webhook_status", ["active", "inactive"]);

// Billing lifecycle, independent of `companyStatusEnum` above (that's the
// platform-level "has super-admin let this tenant onto the app at all"
// gate; this is "are they current on payment"). "trial" is set at company
// creation (see signup routes) and never touches Stripe; a real Stripe
// subscription only exists once they complete Checkout, at which point
// this flips to "active". "past_due" is a grace period (Stripe is retrying
// a failed charge) — the app shows a warning but does NOT block usage for
// it, only for an expired trial or "cancelled".
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trial",
  "active",
  "past_due",
  "cancelled",
]);

// ---------------------------------------------------------------------------
// Companies (tenants)
// ---------------------------------------------------------------------------
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    status: companyStatusEnum("status").notNull().default("pending"),
    plan: varchar("plan", { length: 100 }).notNull().default("starter"),
    pricePerAgentCents: integer("price_per_agent_cents").notNull().default(1900),
    customDomain: varchar("custom_domain", { length: 255 }),
    customDomainVerified: boolean("custom_domain_verified").notNull().default(false),
    // Company Settings "Company" tab. logoUrl is a pasted link (same
    // convention as lead attachments — no file-upload infra in this app).
    logoUrl: text("logo_url"),
    website: varchar("website", { length: 255 }),
    address: text("address"),
    timezone: varchar("timezone", { length: 100 }),
    supportEmail: varchar("support_email", { length: 255 }),
    businessPhone: varchar("business_phone", { length: 50 }),
    // Billing / subscription (Stripe). See subscriptionStatusEnum above for
    // what each status means and what it does/doesn't block.
    subscriptionStatus: subscriptionStatusEnum("subscription_status").notNull().default("trial"),
    trialStartedAt: timestamp("trial_started_at"),
    trialEndsAt: timestamp("trial_ends_at"),
    // "Next Billing Date" on the Subscription page — synced from Stripe's
    // subscription.current_period_end via webhook, not computed locally, so
    // it always reflects what Stripe will actually charge.
    currentPeriodEnd: timestamp("current_period_end"),
    stripeCustomerId: varchar("stripe_customer_id", { length: 255 }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
    // Phase 13 seat-based billing: how many seats the admin purchased. Billing
    // charges seats × the plan's per-agent price; usage is the count of ACTIVE
    // agents (suspended agents don't consume a seat). `plan` (varchar above)
    // now holds basic|professional|premium (legacy values map to basic).
    seats: integer("seats").notNull().default(1),
    // Phase 13: first-run setup wizard completion (company profile → invite →
    // Meta → import → dashboard). Nulls/false show the wizard on next login.
    onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
    // Phase 13 company settings (localization + business hours as minutes since
    // midnight in the company timezone). Language is future-ready (en today).
    dateFormat: varchar("date_format", { length: 20 }).notNull().default("MM/DD/YYYY"),
    language: varchar("language", { length: 10 }).notNull().default("en"),
    businessHoursStart: integer("business_hours_start"),
    businessHoursEnd: integer("business_hours_end"),
    // Phase 18 Feature Management: per-company module overrides as a jsonb
    // map { featureKey: boolean }, merged over the registry defaults (see
    // src/lib/features/registry.ts). Null = pure defaults — every existing
    // company keeps exactly the modules it has today, and registering a new
    // module never needs a migration or a backfill.
    enabledFeatures: jsonb("enabled_features"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"), // soft delete
  },
  (t) => ({
    stripeCustomerIdx: uniqueIndex("companies_stripe_customer_idx").on(t.stripeCustomerId),
  })
);

// ---------------------------------------------------------------------------
// Users (super_admin has companyId = null; admin/agent belong to a company)
// ---------------------------------------------------------------------------
// Presence: "online" is the only status eligible for new-lead assignment.
// idle/busy/break all mean "logged in but not taking leads right now" —
// deliberately not split further (e.g. no separate "in a call" status):
// the assignment engine only needs to know assignable vs not, and more
// granularity than that has no routing effect, only UI display value that
// isn't being built in this pass (see the report's simplicity notes).
// "offline" is both the default (never logged in) and what a stale
// heartbeat is treated as — see src/lib/presence.ts for the derived
// availability check that combines this with lastHeartbeatAt.
// Stored states only. Two states from the presence spec are deliberately
// DERIVED, never stored: "disconnected"/"heartbeat lost" is computed from
// lastHeartbeatAt staleness (a crashed browser can't tell us anything — the
// missing heartbeat IS the signal), see deriveDisplayStatus() in
// src/lib/presence.ts. "locked" IS stored because the client can sometimes
// report it (Idle Detection API, Chrome, permission-gated) — when it can't,
// the heartbeat timeout catches a locked machine anyway.
//
// Assignment eligibility: ELIGIBLE_PRESENCE_STATUSES in src/lib/presence.ts
// is the single source of truth for which of these can receive leads.
export const presenceStatusEnum = pgEnum("presence_status", [
  "online",
  "idle",
  "busy",
  "break",
  "offline",
  "away",
  "lunch",
  "wrap_up",
  "locked",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    phone: varchar("phone", { length: 50 }),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull().default("agent"),
    tier: tierEnum("tier").default("1"),
    active: boolean("active").notNull().default(true),
    presenceStatus: presenceStatusEnum("presence_status").notNull().default("offline"),
    lastHeartbeatAt: timestamp("last_heartbeat_at"),
    // When this agent last received a lead — kept O(1)-readable here
    // (updated inside the assignment lock) instead of MAX()-ing over
    // assignment_log on every assignment. Drives the last_assigned /
    // most_available selection modes and the "ai" mode's idle-time signal.
    lastAssignedAt: timestamp("last_assigned_at"),
    // Supervisor kill-switch: a locked agent is excluded from assignment
    // regardless of presence/workload, until a supervisor unlocks them
    // (see src/lib/supervisor.ts). Defaults false so no existing agent is
    // affected until a supervisor explicitly locks one.
    locked: boolean("locked").notNull().default(false),
    // Notifications tab preferences.
    emailNotificationsEnabled: boolean("email_notifications_enabled").notNull().default(true),
    smsNotificationsEnabled: boolean("sms_notifications_enabled").notNull().default(true),
    // Security tab's "Last Password Change" — "Last Login" is deliberately
    // NOT a column here; it's read from the existing audit_log (most
    // recent "auth.login" row for this user), which already records this
    // reliably with no new field needed.
    passwordChangedAt: timestamp("password_changed_at"),
    // Phase 13: an invited agent gets a temporary password + this flag set, and
    // is forced to create their own password on first login (temp passwords can
    // never become permanent). Cleared the moment they set a real password.
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    // Phase 5 per-agent routing profile: capacity limits (max active leads,
    // daily assignments, concurrent conversations, queue size, recycled) and a
    // working schedule (days, start/end, timezone, lunch, vacation ranges).
    // Null = company defaults (see src/lib/assignment/ai/agent-profile.ts). A
    // jsonb blob so new limits/schedule fields never need a migration.
    routingConfig: jsonb("routing_config"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"), // soft delete
  },
  (t) => ({
    companyIdx: index("users_company_idx").on(t.companyId),
  })
);

// ---------------------------------------------------------------------------
// Refresh tokens (DB-backed, revocable — separate from the short-lived
// access-token session cookie)
// ---------------------------------------------------------------------------
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    userAgent: varchar("user_agent", { length: 255 }),
  },
  (t) => ({
    userIdx: index("refresh_tokens_user_idx").on(t.userId),
  })
);

// ---------------------------------------------------------------------------
// Skills (for skill-based assignment) + agent<->skill mapping
// ---------------------------------------------------------------------------
export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    label: varchar("label", { length: 100 }).notNull(),
  },
  (t) => ({
    companyIdx: index("skills_company_idx").on(t.companyId),
  })
);

export const userSkills = pgTable(
  "user_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    skillId: uuid("skill_id").references(() => skills.id, { onDelete: "cascade" }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("user_skills_unique").on(t.userId, t.skillId),
  })
);

// ---------------------------------------------------------------------------
// Connected accounts — one row per external OAuth identity a company has
// connected (a specific Meta login, later a specific Google Ads account,
// TikTok Business Center account, etc). Sits above leadSources (one row per
// Page/asset) so a company can connect unlimited accounts — each with its
// own set of Pages — without anything in the schema assuming "one account
// per company." Provider-agnostic by design: platform / externalAccountId
// / accountLabel are meaningful for every OAuth-based provider, not just
// Meta, so adding a real Google/TikTok/LinkedIn/Microsoft provider later
// reuses this table unchanged (see lib/lead-sources/provider.ts).
//
// Not used by non-OAuth sources (Universal Webhook) — leadSources.accountId
// is nullable for exactly that reason; a webhook source has no "account" to
// group under.
// ---------------------------------------------------------------------------
export const connectedAccountStatusEnum = pgEnum("connected_account_status", [
  "connected",
  "token_expired",
  "permission_revoked",
  "error",
  "disconnected",
]);

export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    platform: sourcePlatformEnum("platform").notNull(),
    // The provider's own id for this identity (a Facebook user id, later a
    // Google Ads customer id, ...) — not displayed anywhere; it's what lets
    // the OAuth callback recognize "this is the same login as before" and
    // add pages to the existing account row instead of creating a
    // duplicate one every time someone reconnects or adds another page.
    externalAccountId: varchar("external_account_id", { length: 255 }).notNull(),
    // What the Lead Sources page displays as the account's name — the
    // connected email when the provider/granted scope includes it, else a
    // display name.
    accountLabel: varchar("account_label", { length: 255 }),
    status: connectedAccountStatusEnum("status").notNull().default("connected"),
    // Phase 11 (Conversions API): the long-lived USER access token from this
    // OAuth grant, encrypted (AES-256-GCM, see lib/crypto). Lead Ads uses
    // per-page tokens; CAPI needs a token that can read the account's
    // businesses/ad accounts/pixels and POST events — the same grant covers
    // both once ads scopes are granted. Reused, never a second Meta login.
    // Null for accounts connected before Phase 11 (reconnect to populate).
    accessToken: text("access_token"),
    tokenExpiresAt: timestamp("token_expires_at"),
    // Escape hatch for whatever a future provider needs that doesn't
    // justify its own column (a Google Ads manager-account hierarchy id, a
    // LinkedIn organization URN, a GoHighLevel location id, ...) — added
    // now specifically so a provider's own quirks never force a schema
    // migration later. Unused by Meta today; stays null for it.
    providerMetadata: jsonb("provider_metadata"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"), // soft delete
  },
  (t) => ({
    companyIdx: index("connected_accounts_company_idx").on(t.companyId),
    // One row per real-world login per company — reconnecting the same
    // Meta account (or adding another page from it) must always resolve
    // back to this same row, never create a sibling duplicate.
    uniq: uniqueIndex("connected_accounts_unique").on(t.companyId, t.platform, t.externalAccountId),
  })
);

// ---------------------------------------------------------------------------
// Lead sources (Facebook / Google / generic webhook connections) — one row
// per connected Page/asset. Multiple rows can share the same accountId
// (multiple Pages from the same connected Meta account) or belong to
// different accounts entirely (see connectedAccounts above) — nothing here
// assumes a company has only one of either.
// ---------------------------------------------------------------------------
export const leadSources = pgTable(
  "lead_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    // Null for Universal Webhook sources, which have no OAuth account to
    // group under — see connectedAccounts' comment above.
    accountId: uuid("account_id").references(() => connectedAccounts.id, { onDelete: "cascade" }),
    platform: sourcePlatformEnum("platform").notNull().default("facebook"),
    pageId: varchar("page_id", { length: 255 }),
    pageName: varchar("page_name", { length: 255 }),
    // The Facebook Business Manager account the page belongs to — requires
    // the business_management scope to read (see lib/facebook-oauth.ts).
    // Null for non-Facebook platforms and for pages connected before this
    // scope existed, until they're reconnected. Kept denormalized here
    // (not its own table) — it's a display-grouping label with no
    // independent behavior of its own, and every Page already carries it.
    businessId: varchar("business_id", { length: 255 }),
    businessName: varchar("business_name", { length: 255 }),
    accessToken: text("access_token"), // encrypted at rest, see lib/crypto.ts
    // Unused by Meta (its long-lived-token model has no refresh token —
    // renewal means a full reconnect). Added now for OAuth2 providers that
    // *do* issue one (Google, LinkedIn, Microsoft Ads all use short-lived
    // access tokens + a refresh token for silent server-side renewal), so
    // that isn't a schema change made under time pressure when the first
    // such provider is built. Encrypted at rest, same as accessToken.
    refreshToken: text("refresh_token"),
    // Same escape hatch as connectedAccounts.providerMetadata, at the
    // container level instead of the account level.
    providerMetadata: jsonb("provider_metadata"),
    status: leadSourceStatusEnum("status").notNull().default("connected"),
    // Set on a successful subscribeWebhook/unsubscribeWebhook call — see
    // this column's enum comment above for why it's tracked separately
    // from `status`.
    webhookStatus: webhookStatusEnum("webhook_status").notNull().default("active"),
    // Set from Facebook's long-lived-token exchange response so a
    // near-expiry token can be flagged before it actually fails a call.
    tokenExpiresAt: timestamp("token_expires_at"),
    // Last Graph API error observed for this source (webhook processing or
    // sync-now) — shown on the Lead Sources page instead of a silent drop.
    lastError: text("last_error"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    // For generic webhook sources: a per-source secret (checked against a
    // header on inbound requests) and a field-mapping so arbitrary JSON
    // shapes (Google Lead Forms, custom form builders, etc.) can be mapped
    // onto name/phone/email without new code per integration.
    webhookSecret: text("webhook_secret"),
    fieldMapping: jsonb("field_mapping"),
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"), // soft delete
  },
  (t) => ({
    companyIdx: index("lead_sources_company_idx").on(t.companyId),
    accountIdx: index("lead_sources_account_idx").on(t.accountId),
  })
);

// ---------------------------------------------------------------------------
// Hosted forms (Phase 8 form builder) — simple forms built inside Ziplod and
// embedded anywhere. Each belongs to a company's Website connection
// (leadSources row, platform "website"); a submission goes through the exact
// same ingestInboundLead pipeline as an embedded site form, so nothing about
// queue/AI/lifecycle/delivery-log is duplicated. `fields` is a small jsonb
// schema ([{ type, name, label, required, options? }]) — deliberately simple
// (text/email/phone/textarea/dropdown/checkbox), no landing-page builder.
// ---------------------------------------------------------------------------
export const hostedForms = pgTable(
  "hosted_forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    // The Website connection this form submits through (its id is the public key).
    sourceId: uuid("source_id").references(() => leadSources.id, { onDelete: "cascade" }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    fields: jsonb("fields").notNull(), // FormField[]
    submitText: varchar("submit_text", { length: 100 }).notNull().default("Submit"),
    successMessage: text("success_message"),
    redirectUrl: text("redirect_url"),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => ({
    companyIdx: index("hosted_forms_company_idx").on(t.companyId),
    sourceIdx: index("hosted_forms_source_idx").on(t.sourceId),
  })
);

// ---------------------------------------------------------------------------
// Lead forms — which specific Facebook Lead Ad forms (on an already-
// connected Page) are enabled for sync. Facebook's page-level leadgen
// webhook subscription can't be scoped to individual forms — it delivers
// events for every form on the page, tagged with a form_id — so this table
// is what lets the webhook receiver decide which of those events to act on
// (see api/webhooks/facebook/route.ts). A join-table row per form (rather
// than a JSON array on lead_sources) so toggling one form on/off is a
// single-row update, matching this schema's existing pattern (user_skills).
// ---------------------------------------------------------------------------
export const leadForms = pgTable(
  "lead_forms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").references(() => leadSources.id, { onDelete: "cascade" }).notNull(),
    formId: varchar("form_id", { length: 255 }).notNull(),
    formName: varchar("form_name", { length: 255 }),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    sourceIdx: index("lead_forms_source_idx").on(t.sourceId),
    uniq: uniqueIndex("lead_forms_source_form_unique").on(t.sourceId, t.formId),
  })
);

// ---------------------------------------------------------------------------
// Historical lead imports — one row per "import my past leads" run for one
// connected Page. Deliberately NOT an in-memory job: everything the running
// import needs to resume (which form it's on, Meta's pagination cursor) is
// persisted here after every batch, because the app runs as a single
// persistent process on Render that restarts on every deploy — an
// in-memory-only job would silently die and lose all progress on the next
// deploy. See lib/lead-sources/import-engine.ts.
// ---------------------------------------------------------------------------
export const leadImportStatusEnum = pgEnum("lead_import_status", [
  "running",
  "paused",
  "completed",
  "cancelled",
  "failed",
]);

export const leadImportRangeEnum = pgEnum("lead_import_range", ["7d", "30d", "90d", "180d", "365d", "all"]);

export const leadImports = pgTable(
  "lead_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    sourceId: uuid("source_id").references(() => leadSources.id, { onDelete: "cascade" }).notNull(),
    status: leadImportStatusEnum("status").notNull().default("running"),
    range: leadImportRangeEnum("range").notNull(),
    // The exact set of form ids this run covers, decided once at start —
    // adding/removing enabled forms mid-import doesn't retroactively change
    // an already-running job.
    formIds: jsonb("form_ids").notNull(),
    // Resume checkpoint: { formIndex: number, afterCursor: string | null }.
    // Re-read at the top of every loop iteration (not just on restart) so a
    // Cancel request or an externally-updated row is always respected.
    checkpoint: jsonb("checkpoint").notNull(),
    totalFound: integer("total_found").notNull().default(0),
    totalImported: integer("total_imported").notNull().default(0),
    totalSkipped: integer("total_skipped").notNull().default(0), // duplicates
    totalFailed: integer("total_failed").notNull().default(0),
    currentFormId: varchar("current_form_id", { length: 255 }),
    currentFormName: varchar("current_form_name", { length: 255 }),
    // Set by the customer clicking Cancel — the running loop (or a resumed
    // one) checks this every iteration and stops gracefully rather than
    // being killed mid-write.
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    // Updated after every processed batch — the cron resume-sweep uses
    // "status=running AND lastProcessedAt older than N minutes" to detect a
    // job whose in-process loop died (e.g. a Render restart) and needs
    // resuming from `checkpoint`, not a real still-running job.
    lastProcessedAt: timestamp("last_processed_at").notNull().defaultNow(),
    error: text("error"), // set only on status="failed"
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => ({
    sourceIdx: index("lead_imports_source_idx").on(t.sourceId),
    companyIdx: index("lead_imports_company_idx").on(t.companyId),
    // The resume sweep's exact query shape.
    statusHeartbeatIdx: index("lead_imports_status_heartbeat_idx").on(t.status, t.lastProcessedAt),
  })
);

// Per-lead journal for one import — satisfies "if one lead fails, log it
// and continue" with a real queryable row per outcome, not just aggregate
// counters on lead_imports. Not the same table as webhookLogs: an imported
// lead ALSO gets a normal webhookLogs/Delivery Log row via the same
// ingestLead() pipeline live leads use — this table is the import-specific
// journal (which historical leadgen_id mapped to which outcome), not a
// replacement for the Delivery Log.
export const leadImportLogStatusEnum = pgEnum("lead_import_log_status", ["imported", "duplicate", "failed"]);

export const leadImportLogs = pgTable(
  "lead_import_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id").references(() => leadImports.id, { onDelete: "cascade" }).notNull(),
    leadgenId: varchar("leadgen_id", { length: 255 }).notNull(),
    formId: varchar("form_id", { length: 255 }),
    status: leadImportLogStatusEnum("status").notNull(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    importIdx: index("lead_import_logs_import_idx").on(t.importId),
  })
);

// ---------------------------------------------------------------------------
// Webhook delivery logs (every inbound call, success or failure + retries)
// ---------------------------------------------------------------------------
export const webhookLogs = pgTable(
  "webhook_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").references(() => leadSources.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    status: webhookLogStatusEnum("status").notNull(),
    // Which pipeline stage this row reflects — see webhookStageEnum above.
    // Null for rows written before this column existed.
    stage: webhookStageEnum("stage"),
    // Set once a lead is actually created for this delivery (null for
    // skipped/failed-before-storage rows).
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    // Denormalized from the payload for display on the Delivery Log page
    // without joining back into the payload JSON.
    formId: varchar("form_id", { length: 255 }),
    payload: jsonb("payload"),
    error: text("error"),
    retryCount: integer("retry_count").notNull().default(0),
    // Wall-clock time this row's handler took, start to finish — shown on
    // the Delivery Log page in milliseconds.
    processingTimeMs: integer("processing_time_ms"),
    // Time between the provider's own event timestamp (Meta's entry.time)
    // and when our server received it — a signal for delivery delay that's
    // independent of our own processing time.
    webhookLatencyMs: integer("webhook_latency_ms"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    sourceIdx: index("webhook_logs_source_idx").on(t.sourceId),
    companyIdx: index("webhook_logs_company_idx").on(t.companyId),
    // Phase 10: the Delivery Log page (WHERE company_id = ? ORDER BY created_at
    // DESC LIMIT 200) previously used the company-only index and then sorted.
    // This composite serves the ordered pagination directly — matters once a
    // busy tenant has hundreds of thousands of delivery rows.
    companyCreatedIdx: index("webhook_logs_company_created_idx").on(t.companyId, t.createdAt),
  })
);

// ---------------------------------------------------------------------------
// Disposition options (customizable per company)
// ---------------------------------------------------------------------------
export const dispositionOptions = pgTable(
  "disposition_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    color: varchar("color", { length: 20 }).notNull().default("#2563eb"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => ({
    companyIdx: index("disposition_company_idx").on(t.companyId),
  })
);

// ---------------------------------------------------------------------------
// Tags + lead<->tag mapping
// ---------------------------------------------------------------------------
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    color: varchar("color", { length: 20 }).notNull().default("#64748b"),
  },
  (t) => ({
    companyIdx: index("tags_company_idx").on(t.companyId),
  })
);

export const leadTags = pgTable(
  "lead_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
    tagId: uuid("tag_id").references(() => tags.id, { onDelete: "cascade" }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("lead_tags_unique").on(t.leadId, t.tagId),
  })
);

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------
// Formal lead LIFECYCLE (Phase 4) — a fixed, engine-owned progression,
// distinct from the company-configurable `disposition`. Every transition is
// timestamped in lead_lifecycle_events; the current stage is denormalized onto
// leads.lifecycle_stage for cheap filtering (recycling/rebalancing).
export const lifecycleStageEnum = pgEnum("lifecycle_stage", [
  "new",
  "queued",
  "assigned",
  "contacted",
  "in_progress",
  "follow_up",
  "won",
  "lost",
  "closed",
]);

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    sourceId: uuid("source_id").references(() => leadSources.id, { onDelete: "set null" }),
    // The provider's own globally-unique id for this lead (a Facebook
    // leadgen_id). Populated only for provider-sourced leads that flow
    // through ingestLead() — the live Facebook webhook AND the historical
    // importer, which share that one function. Null for generic-webhook and
    // CSV-imported leads (which dedup by phone/email instead). The partial
    // unique index below on (sourceId, externalLeadId) is what makes "never
    // create a duplicate lead" a DATABASE guarantee rather than an
    // application-level check-then-insert that can race under concurrency
    // (e.g. a live webhook delivery arriving for the same lead a historical
    // import is fetching at that moment). See ingestLead()'s
    // insert-on-conflict.
    externalLeadId: varchar("external_lead_id", { length: 255 }),
    name: varchar("name", { length: 255 }),
    phone: varchar("phone", { length: 50 }),
    email: varchar("email", { length: 255 }),
    state: varchar("state", { length: 100 }),
    disposition: varchar("disposition", { length: 100 }).notNull().default("New Lead"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    requiredSkillId: uuid("required_skill_id").references(() => skills.id, { onDelete: "set null" }),
    // Phase 5 multi-skill requirements: { required: skillId[], preferred:
    // skillId[], priority: skillId[] }. The skill-matching factor grades an
    // agent perfect/preferred/partial/fallback against these. Backward
    // compatible: requiredSkillId (single) is still honored when this is null.
    skillRequirements: jsonb("skill_requirements"),
    followUpAt: timestamp("follow_up_at"),
    rawPayload: jsonb("raw_payload"),
    isDuplicate: boolean("is_duplicate").notNull().default(false),
    duplicateOfLeadId: uuid("duplicate_of_lead_id"),
    recycleCount: integer("recycle_count").notNull().default(0), // capped by automation_settings.max_recycle_count
    // "high" bypasses the workload-cap soft filter during assignment (see
    // assignLead()) so a VIP/priority lead is never stuck waiting behind an
    // agent's cap — everything else about routing (presence, hours, skill)
    // still applies. Plain varchar rather than a pgEnum: this is a routing
    // hint, not a fixed taxonomy a migration should have to grow later.
    priority: varchar("priority", { length: 20 }).notNull().default("normal"),
    // Phase 4 lifecycle: the current stage (see lifecycleStageEnum) and when
    // the lead was last assigned to an agent (drives the SLA-based recycling —
    // "assigned but never contacted within N minutes"). assignedAt is set by
    // the assignment pipeline; lifecycleStage only ever changes through the
    // lifecycle service (nothing sets it silently).
    lifecycleStage: lifecycleStageEnum("lifecycle_stage").notNull().default("new"),
    assignedAt: timestamp("assigned_at"),
    // Blacklisted leads are skipped entirely by auto-assignment (see
    // assignLead()) — e.g. a DNC request or a lead a company never wants
    // routed automatically. A supervisor/admin can still assign manually.
    isBlacklisted: boolean("is_blacklisted").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"), // soft delete
  },
  (t) => ({
    // Every real query in the codebase that touches `leads` also filters
    // by companyId (verified — see the Phase 10 tenant-isolation audit),
    // so a plain single-column companyId index and a plain single-column
    // ownerId index were both fully redundant with the composite indexes
    // below (a composite (companyId, x) index serves companyId-only
    // lookups just as well as a dedicated one). Replaced both with
    // (companyId, ownerId), which is what the workload-cap query
    // (assignment.ts) and the "last active lead" query
    // (/api/supervisor/agents) actually filter by.
    companyOwnerIdx: index("leads_company_owner_idx").on(t.companyId, t.ownerId),
    // Phase 10: the leads-list query (WHERE company_id = ? [AND deleted_at IS
    // NULL] ORDER BY created_at DESC LIMIT/OFFSET) is the single most-hit read
    // in the app. Without this composite, Postgres had to sort a company's
    // whole lead set on every page load (or scan the global created_at index
    // across all tenants). (company_id, created_at) makes it an ordered
    // index scan — the key scalability index for 100k+ leads/day per tenant.
    // Applied CONCURRENTLY (see the Phase 10 index migration) so it never
    // locked the live leads table.
    companyCreatedIdx: index("leads_company_created_idx").on(t.companyId, t.createdAt),
    // Added for the Lead Delivery Health panel's per-source aggregates
    // (total/today/week/month lead counts) — nothing queried `leads` by
    // sourceId before this, so there was no covering index.
    sourceIdx: index("leads_source_idx").on(t.sourceId),
    // Database-level "never create a duplicate lead" guarantee: no two
    // leads on the same source can share a provider lead id. Partial
    // (WHERE external_lead_id IS NOT NULL) so it applies ONLY to
    // provider-sourced leads and never constrains generic-webhook/CSV
    // leads, whose external_lead_id is always null. ingestLead() relies on
    // this index for its atomic insert-on-conflict dedup.
    externalLeadUniq: uniqueIndex("leads_source_external_lead_uniq")
      .on(t.sourceId, t.externalLeadId)
      .where(sql`${t.externalLeadId} IS NOT NULL`),
    createdIdx: index("leads_created_idx").on(t.createdAt),
    phoneIdx: index("leads_phone_idx").on(t.companyId, t.phone),
    emailIdx: index("leads_email_idx").on(t.companyId, t.email),
    dispositionIdx: index("leads_disposition_idx").on(t.companyId, t.disposition),
    priorityIdx: index("leads_priority_idx").on(t.companyId, t.priority),
    // Trigram GIN indexes on name/phone/email (for the ILIKE '%x%' search
    // in /api/leads) live in drizzle/manual/0001_trgm_search_indexes.sql,
    // NOT here. They need the pg_trgm extension and CREATE INDEX
    // CONCURRENTLY (which cannot run inside drizzle-kit's transactional
    // migration runner), so they're applied as a one-time manual script
    // instead of being modeled in this schema — see that file for why and
    // how to run it.
  })
);

// ---------------------------------------------------------------------------
// Lead notes
// ---------------------------------------------------------------------------
export const leadNotes = pgTable(
  "lead_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    leadIdx: index("lead_notes_lead_idx").on(t.leadId),
  })
);

// ---------------------------------------------------------------------------
// Lead attachments (metadata + URL; see lib/storage.ts for upload handling)
// ---------------------------------------------------------------------------
export const leadAttachments = pgTable(
  "lead_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    fileUrl: text("file_url").notNull(),
    fileSize: integer("file_size"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    leadIdx: index("lead_attachments_lead_idx").on(t.leadId),
  })
);

// ---------------------------------------------------------------------------
// Saved filters (per user, per company)
// ---------------------------------------------------------------------------
export const savedFilters = pgTable(
  "saved_filters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    filterJson: jsonb("filter_json").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("saved_filters_company_idx").on(t.companyId),
    userIdx: index("saved_filters_user_idx").on(t.userId),
  })
);

// ---------------------------------------------------------------------------
// Assignment rules (weight per tier, per company)
// ---------------------------------------------------------------------------
export const assignmentRules = pgTable(
  "assignment_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    tier: tierEnum("tier").notNull(),
    weight: integer("weight").notNull().default(1),
    active: boolean("active").notNull().default(true),
  },
  (t) => ({
    companyIdx: index("assignment_rules_company_idx").on(t.companyId),
  })
);

// ---------------------------------------------------------------------------
// Automation settings (one row per company): assignment mode, recycle rules
// ---------------------------------------------------------------------------
// Every selection strategy the assignment engine supports — see
// chooseAgent() in src/lib/assignment.ts for what each one actually does.
// "ai" is an adaptive composite heuristic (workload + idle time + tier),
// deliberately NOT an LLM call in the assignment hot path — it's the seam
// where a learned model can plug in later without a schema change.
export const assignmentModeEnum = pgEnum("assignment_mode", [
  "round_robin",
  "weighted",
  "skill_based",
  "tier_based",
  "priority_based",
  "last_assigned",
  "least_active",
  "most_available",
  "random",
  "ai",
]);

export const automationSettings = pgTable("automation_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  autoAssignEnabled: boolean("auto_assign_enabled").notNull().default(true),
  assignmentMode: assignmentModeEnum("assignment_mode").notNull().default("weighted"),
  autoRecycleEnabled: boolean("auto_recycle_enabled").notNull().default(false),
  recycleAfterMinutes: integer("recycle_after_minutes").notNull().default(1440), // 24h default
  // How long a missed heartbeat is tolerated before an agent is treated as
  // unavailable for assignment (see src/lib/presence.ts). Default 90s
  // assumes the standard ~30s client heartbeat interval, tolerating one
  // missed beat.
  heartbeatTimeoutSeconds: integer("heartbeat_timeout_seconds").notNull().default(90),
  // Minutes since midnight, company server-local time (same timezone
  // caveat already documented for analytics date ranges — see
  // src/lib/analytics/range.ts). Both null (the default) means no working-
  // hours restriction at all, preserving today's 24/7 assignment behavior
  // for every existing company.
  workingHoursStart: integer("working_hours_start"),
  workingHoursEnd: integer("working_hours_end"),
  // Soft cap: an agent at or above this many currently-open (non-terminal)
  // leads is skipped in favor of a less-loaded agent, unless skipping
  // would leave no eligible agent at all (overflow — see assignLead()).
  // Null means no cap, preserving today's behavior.
  maxOpenLeadsPerAgent: integer("max_open_leads_per_agent"),
  // Hard ceiling on automatic recycling for a single lead — once reached,
  // the recycle cron stops touching it (an admin can still act on it
  // manually) instead of cycling it between agents forever.
  maxRecycleCount: integer("max_recycle_count").notNull().default(5),
  // Persistent round-robin position for this company's automatic
  // assignment cycle (see assignLead()). Replaces the old approach of
  // computing the cursor as COUNT(*) over the company's entire
  // assignment_log history on every single assignment — that was O(n) and
  // got slower forever as history grew. This column is incremented
  // atomically (UPDATE ... SET assignment_cursor = assignment_cursor + 1
  // RETURNING ...) inside the same per-company lock assignLead() already
  // holds, making cursor selection O(1) regardless of history size.
  // Deliberately only moved by the automatic round-robin cycle itself —
  // manual/supervisor reassignments don't touch it (see the Phase 10
  // report for why that's a considered choice, not an oversight).
  assignmentCursor: integer("assignment_cursor").notNull().default(0),
  // Per-company AI scoring configuration (Phase 3). Null = use the built-in
  // defaults (see src/lib/assignment/ai/config.ts). A jsonb blob rather than a
  // column-per-knob so new factors/weights/thresholds never require a
  // migration — "no hardcoded business logic, everything configurable."
  aiConfig: jsonb("ai_config"),
  // Phase 4 queue/lifecycle tunables (reservation timeout, retry limit,
  // recycle SLA/untouched/offline thresholds, rebalance thresholds, priority
  // weights). Null = built-in defaults (see src/lib/lifecycle/config.ts).
  queueConfig: jsonb("queue_config"),
  // Phase 17 Progressive Lead Release settings (enabled, release interval,
  // reserved backlog %, per-tier batch sizes, max active leads). Null = the
  // built-in defaults with the feature OFF (see
  // src/lib/assignment/progressive/config.ts) — same jsonb-over-defaults
  // pattern as aiConfig/queueConfig, so new knobs never need a migration.
  progressiveConfig: jsonb("progressive_config"),
});

// ---------------------------------------------------------------------------
// Progressive Lead Release state (Phase 17) — one row per company holding the
// engine's pacing + reserved-backlog "wave" bookkeeping. This is runtime
// STATE, not configuration (that's automation_settings.progressive_config):
// it must survive restarts and be atomically claimable across instances, so
// it lives in its own row rather than in-process memory.
// ---------------------------------------------------------------------------
export const progressiveReleaseState = pgTable("progressive_release_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  // A "wave" is one contiguous drain of a backlog (e.g. the overnight queue).
  // It opens when the engine first sees backlog with no active wave, and
  // closes when the backlog hits zero. initialBacklog is the wave's high-water
  // mark (grows if new leads arrive mid-wave); releasedCount is how many the
  // engine has released so far this wave — together they anchor the reserved-
  // backlog math (see progressive/engine.ts).
  waveStartedAt: timestamp("wave_started_at"),
  initialBacklog: integer("initial_backlog").notNull().default(0),
  releasedCount: integer("released_count").notNull().default(0),
  lastCycleAt: timestamp("last_cycle_at"),
  // The pacing gate: a cycle may only run when now >= nextReleaseAt. Claimed
  // atomically (UPDATE ... WHERE next_release_at <= now() RETURNING), which
  // makes the row itself the cross-instance mutex — no advisory locks.
  nextReleaseAt: timestamp("next_release_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Assignment log (audit trail for lead routing specifically)
// ---------------------------------------------------------------------------
export const assignmentLog = pgTable(
  "assignment_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    assignedAt: timestamp("assigned_at").notNull().defaultNow(),
    ruleUsed: varchar("rule_used", { length: 100 }),
    // "assigned" (success), "failed" (no eligible agent at arrival — logged
    // once per lead arrival, NOT re-logged by every queue-sweep retry, which
    // would flood this table), or "skipped" (lost the atomic claim race —
    // another concurrent call assigned this lead first). Plain varchar, not
    // an enum: an audit-trail vocabulary, not a state machine.
    status: varchar("status", { length: 20 }).notNull().default("assigned"),
    // The chosen agent's presence status at the moment of assignment.
    presenceStatus: varchar("presence_status", { length: 20 }),
    // Wall-clock duration of the whole assignLead() call, in milliseconds.
    latencyMs: integer("latency_ms"),
    // Human-readable detail: which pool the agent was picked from, why an
    // attempt failed, etc.
    reason: text("reason"),
  },
  (t) => ({
    leadIdx: index("assignment_log_lead_idx").on(t.leadId),
    assignedToIdx: index("assignment_log_assigned_to_idx").on(t.assignedTo),
  })
);

// ---------------------------------------------------------------------------
// Assignment Engine (Phase 1 foundation) — a durable work queue + a
// permanent decision store, both feeding the single AssignmentEngine
// service in src/lib/assignment/. These are ADDITIVE: nothing that existed
// before reads or writes them, so they cannot change existing behavior.
// See src/lib/assignment/README-ish comments for how each column is used.
// ---------------------------------------------------------------------------

// Lifecycle of one queued assignment job. `failed` is a transient state
// (will be retried after a backoff); `dead_letter` is terminal for the JOB
// only — the underlying lead is never lost (it keeps ownerId=NULL and the
// reactive owner-NULL sweep in assignment-queue.ts remains its ultimate
// backstop), this just stops the job from being retried forever.
export const assignmentJobStatusEnum = pgEnum("assignment_job_status", [
  "pending",
  "processing",
  "completed",
  "failed",
  "dead_letter",
]);

// The outcome recorded for every assignment DECISION in assignment_history.
export const assignmentOutcomeEnum = pgEnum("assignment_outcome", [
  "assigned",
  "no_eligible_agent",
  "claim_lost",
  "skipped",
  "error",
]);

// ---------------------------------------------------------------------------
// Assignment jobs — the durable internal queue. A lead that needs assigning
// is represented here as a row; workers reserve due rows with FOR UPDATE
// SKIP LOCKED (so multiple future worker processes / app instances can drain
// it concurrently with zero double-processing), run it through the engine
// pipeline, and either complete it or reschedule it with exponential backoff.
// This is the seam a Redis/BullMQ backend slots behind later — the queue
// INTERFACE (src/lib/assignment/job-queue.ts) does not change when it does.
// ---------------------------------------------------------------------------
export const assignmentJobs = pgTable(
  "assignment_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
    status: assignmentJobStatusEnum("status").notNull().default("pending"),
    // How many times this job has been attempted, and the ceiling after
    // which it is dead-lettered instead of retried forever.
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(10),
    // When this job becomes eligible to (re)process — now for a fresh job,
    // a point in the future after a failed attempt (exponential backoff).
    availableAt: timestamp("available_at").notNull().defaultNow(),
    // Worker coordination — which worker reserved this row and when, purely
    // for observability / stuck-job detection (SKIP LOCKED does the real
    // mutual exclusion).
    lockedAt: timestamp("locked_at"),
    lockedBy: varchar("locked_by", { length: 100 }),
    // Assignment parameters carried from the original request so a retry
    // reproduces the same decision inputs (skill requirement, agent to avoid
    // on a reassignment, and where the work originated).
    requiredSkillId: uuid("required_skill_id"),
    excludeAgentId: uuid("exclude_agent_id"),
    source: varchar("source", { length: 20 }).notNull().default("arrival"),
    // Phase 4 queue priority — higher is drained first (fresh Facebook lead,
    // VIP, expired follow-up, manual override, ...). Computed by
    // lifecycle/priority.ts at enqueue time; 0 = normal.
    priority: integer("priority").notNull().default(0),
    // Phase 5 SLA: the time-to-assign deadline for this lead (from the SLA
    // config for its class). Used to escalate overdue queued leads and to
    // measure SLA compliance. Null = no SLA target.
    slaDeadline: timestamp("sla_deadline"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // The worker's hot path: due rows first. SKIP LOCKED handles concurrency.
    dueIdx: index("assignment_jobs_due_idx").on(t.status, t.availableAt),
    // Priority-aware draining: due rows, highest priority first, then oldest.
    priorityDueIdx: index("assignment_jobs_priority_due_idx").on(t.status, t.priority, t.availableAt),
    companyIdx: index("assignment_jobs_company_idx").on(t.companyId),
    // At most one LIVE job per lead — makes enqueue idempotent (a second
    // enqueue for a lead already queued is a no-op via ON CONFLICT DO
    // NOTHING). Partial: completed/dead_letter rows don't block a fresh job.
    leadActiveUniq: uniqueIndex("assignment_jobs_lead_active_uniq")
      .on(t.leadId)
      .where(sql`status in ('pending','processing','failed')`),
  })
);

// ---------------------------------------------------------------------------
// Assignment history — the permanent, append-only record of every
// assignment DECISION (not every retry). Richer than assignment_log (which
// stays for backward compatibility): it captures the candidate pool the
// decision was made from, the strategy used, processing time, attempt
// number and failure reason — the raw material future AI/analytics phases
// learn from. Never read by existing code; purely additive.
// ---------------------------------------------------------------------------
export const assignmentHistory = pgTable(
  "assignment_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    outcome: assignmentOutcomeEnum("outcome").notNull(),
    strategyUsed: varchar("strategy_used", { length: 50 }),
    // The eligible agent ids the decision chose among (jsonb array), plus its
    // size denormalized for cheap aggregation without unpacking the array.
    candidateIds: jsonb("candidate_ids"),
    candidateCount: integer("candidate_count").notNull().default(0),
    presenceStatus: varchar("presence_status", { length: 20 }),
    processingTimeMs: integer("processing_time_ms"),
    attempt: integer("attempt").notNull().default(1),
    source: varchar("source", { length: 20 }),
    failureReason: text("failure_reason"),
    // AI decision audit (Phase 3), null for non-AI strategies. finalScore is
    // the chosen agent's composite AI score; decisionDetail is the full
    // explainability + training-data blob: per-factor scores for the winner,
    // the scored/rejected candidates and why, and the decision duration.
    finalScore: real("final_score"),
    decisionDetail: jsonb("decision_detail"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyCreatedIdx: index("assignment_history_company_created_idx").on(t.companyId, t.createdAt),
    leadIdx: index("assignment_history_lead_idx").on(t.leadId),
    assignedToIdx: index("assignment_history_assigned_to_idx").on(t.assignedTo),
  })
);

// ---------------------------------------------------------------------------
// Lead lifecycle events (Phase 4) — the timestamped, append-only audit of
// every lifecycle transition. "Nothing should silently change state": the
// lifecycle service writes exactly one row here per transition and updates
// leads.lifecycle_stage in the same step. Feeds the self-optimization metrics
// (queue wait, recycle time, abandonment).
// ---------------------------------------------------------------------------
export const leadLifecycleEvents = pgTable(
  "lead_lifecycle_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
    fromStage: varchar("from_stage", { length: 20 }), // null for the very first (creation)
    toStage: lifecycleStageEnum("to_stage").notNull(),
    // Why the transition happened: "assigned", "recycled:sla_exceeded",
    // "recycled:agent_offline", "rebalanced", "disposition:Won", etc.
    reason: varchar("reason", { length: 100 }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    leadIdx: index("lead_lifecycle_events_lead_idx").on(t.leadId),
    companyCreatedIdx: index("lead_lifecycle_events_company_created_idx").on(t.companyId, t.createdAt),
    toStageIdx: index("lead_lifecycle_events_to_stage_idx").on(t.companyId, t.toStage),
  })
);

// ---------------------------------------------------------------------------
// Lead Insights (Phase 9) — a per-lead CACHE of the deterministic, explainable
// AI insight (score + label + summary + next-best-action + follow-up timing +
// "why" explanation). One row per lead. It is NOT a source of truth: every
// field is recomputed from existing CRM data by src/lib/insights, so this row
// can be dropped and rebuilt at any time. It exists purely so the Lead Details
// card reads O(1) instead of recomputing on every view, and so the recompute
// can run asynchronously off the assignment/API path (never blocking either).
// ---------------------------------------------------------------------------
export const leadInsights = pgTable(
  "lead_insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull().unique(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    score: integer("score").notNull(), // 0-100
    // "Hot" | "Warm" | "Cold" (+ occasionally "Very High Potential") — the
    // human-facing headline label; `temperature` is the coarse bucket used for
    // coloring so the UI never string-matches the label.
    scoreLabel: varchar("score_label", { length: 40 }).notNull(),
    temperature: varchar("temperature", { length: 10 }).notNull(), // hot | warm | cold
    // Non-exclusive descriptors: ["Returning Customer","High Value",...].
    tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
    summary: text("summary").notNull(),
    // The next-best-action: a stable key + a human label + the reasoning. These
    // are RECOMMENDATIONS only — nothing acts on them automatically.
    recommendation: varchar("recommendation", { length: 40 }).notNull(),
    recommendationLabel: varchar("recommendation_label", { length: 60 }).notNull(),
    recommendationReason: text("recommendation_reason").notNull(),
    // Recommended follow-up moment + its human label ("Call within 5 minutes",
    // "Reminder overdue", ...). followUpAt is null when no follow-up applies
    // (already won / archived).
    followUpAt: timestamp("follow_up_at"),
    followUpLabel: varchar("follow_up_label", { length: 60 }).notNull(),
    // The "why": an ordered array of short plain-language reason strings, plus
    // the full ScoreFactor[] breakdown for the expandable detail.
    explanation: jsonb("explanation").notNull().default(sql`'[]'::jsonb`),
    factors: jsonb("factors").notNull().default(sql`'[]'::jsonb`),
    version: integer("version").notNull().default(1), // engine version, for future re-computes
    computedAt: timestamp("computed_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("lead_insights_company_idx").on(t.companyId),
    temperatureIdx: index("lead_insights_temperature_idx").on(t.companyId, t.temperature),
  })
);

// ---------------------------------------------------------------------------
// Agent overrides (Phase 5) — temporary, AUTO-EXPIRING manual controls a
// supervisor can apply to routing. Expiry is enforced at read time (queries
// filter expiresAt > now), so no cron is needed to clean them up.
//   pause          — skip this agent for assignment
//   lock           — same as pause but "hard" (kill-switch semantics)
//   reserve        — route ONLY to this agent (company-wide reservation)
//   force          — force the next assignment(s) to this agent
//   capacity_boost — temporarily raise this agent's max-active-leads (value.boost)
// ---------------------------------------------------------------------------
export const agentOverrideTypeEnum = pgEnum("agent_override_type", ["pause", "lock", "reserve", "force", "capacity_boost"]);

export const agentOverrides = pgTable(
  "agent_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    // Null for a company-wide override (none today use it, but reserve/force
    // are naturally agent-scoped; kept nullable for future company-wide rules).
    agentId: uuid("agent_id").references(() => users.id, { onDelete: "cascade" }),
    type: agentOverrideTypeEnum("type").notNull(),
    value: jsonb("value"), // e.g. { boost: 10 } for capacity_boost
    expiresAt: timestamp("expires_at").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyActiveIdx: index("agent_overrides_company_active_idx").on(t.companyId, t.expiresAt),
    agentIdx: index("agent_overrides_agent_idx").on(t.agentId),
  })
);

// ---------------------------------------------------------------------------
// General audit log (governance): who did what, to what, when
// ---------------------------------------------------------------------------
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 100 }).notNull(), // e.g. "lead.disposition_changed"
    entityType: varchar("entity_type", { length: 100 }).notNull(), // e.g. "lead"
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    // Composite (companyId, createdAt) replaces the old companyId-only
    // index — it still serves any "WHERE companyId = ?" lookup (Postgres
    // can use a leading prefix of a composite index the same as a
    // single-column one) while ALSO covering the audit-log page's actual
    // query (WHERE companyId = ? ORDER BY createdAt DESC LIMIT 200)
    // without a separate sort step. Keeping both would just be a second
    // index to maintain on every insert for no query it uniquely serves.
    companyCreatedIdx: index("audit_log_company_created_idx").on(t.companyId, t.createdAt),
    entityIdx: index("audit_log_entity_idx").on(t.entityType, t.entityId),
  })
);

// ---------------------------------------------------------------------------
// Notifications — in-app is the only channel actually delivered today (see
// src/lib/notifications); email/sms/webhook/push rows can be written here
// too (for a unified history/status view) once those channels have a real
// provider behind them.
// ---------------------------------------------------------------------------
export const notificationChannelEnum = pgEnum("notification_channel", ["in_app", "email", "sms", "webhook", "push"]);
export const notificationStatusEnum = pgEnum("notification_status", ["pending", "sent", "delivered", "failed"]);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    channel: notificationChannelEnum("channel").notNull().default("in_app"),
    status: notificationStatusEnum("status").notNull().default("pending"),
    type: varchar("type", { length: 100 }).notNull(), // e.g. "lead.assigned"
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    metadata: jsonb("metadata"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("notifications_user_idx").on(t.userId, t.createdAt),
    companyIdx: index("notifications_company_idx").on(t.companyId),
  })
);

// ---------------------------------------------------------------------------
// API keys — for exposing a public API later (see src/lib/api-keys). Not
// wired into any business-data route yet; this is the key-management layer
// (issue/list/revoke), ready for whichever routes get opened up publicly.
// ---------------------------------------------------------------------------
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    keyHash: text("key_hash").notNull(), // sha256, same pattern as refresh_tokens.token_hash
    keyPrefix: varchar("key_prefix", { length: 12 }).notNull(), // shown in the UI so admins can tell keys apart without re-revealing the secret
    scopes: jsonb("scopes").notNull(), // e.g. ["leads:read", "leads:write"]
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("api_keys_company_idx").on(t.companyId),
    keyHashIdx: uniqueIndex("api_keys_key_hash_idx").on(t.keyHash),
  })
);

// ---------------------------------------------------------------------------
// Platform Owner Mailbox — a small internal email client for the platform
// operator ONLY (super_admin; every table here is platform-level, has no
// companyId, and is never exposed to company admins — enforced at the route
// layer, all mailbox APIs require role super_admin). Sends via Resend and
// receives via a Resend inbound webhook. Deliberately just a mailbox: no
// CRM automation, AI, ticketing, or shared/customer access.
// ---------------------------------------------------------------------------
export const emailFolderEnum = pgEnum("email_folder", ["inbox", "sent", "drafts", "trash", "archive"]);
export const emailDirectionEnum = pgEnum("email_direction", ["inbound", "outbound"]);

// One row per operated address (support@ / sales@ / mail@ziplod.com). Seeded
// once; the UI switches between them.
export const mailboxes = pgTable("mailboxes", {
  id: uuid("id").primaryKey().defaultRandom(),
  address: varchar("address", { length: 255 }).notNull().unique(),
  displayName: varchar("display_name", { length: 255 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A conversation — messages are grouped into a thread by their RFC 2822
// References/In-Reply-To headers (or, failing that, normalized subject +
// participants), so a reply chain reads as one conversation like Gmail.
export const emailThreads = pgTable(
  "email_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mailboxId: uuid("mailbox_id").references(() => mailboxes.id, { onDelete: "cascade" }).notNull(),
    subject: text("subject"),
    lastMessageAt: timestamp("last_message_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    mailboxIdx: index("email_threads_mailbox_idx").on(t.mailboxId, t.lastMessageAt),
  })
);

export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id").references(() => emailThreads.id, { onDelete: "cascade" }).notNull(),
    mailboxId: uuid("mailbox_id").references(() => mailboxes.id, { onDelete: "cascade" }).notNull(),
    direction: emailDirectionEnum("direction").notNull(),
    // Which folder this message currently lives in. A single message moves
    // between folders (inbox -> archive -> trash); "sent"/"drafts" are set at
    // creation for outbound. Star and read are separate flags, Gmail-style.
    folder: emailFolderEnum("folder").notNull().default("inbox"),
    fromAddress: varchar("from_address", { length: 255 }).notNull(),
    toAddresses: jsonb("to_addresses").notNull(), // string[]
    ccAddresses: jsonb("cc_addresses"), // string[] | null
    bccAddresses: jsonb("bcc_addresses"), // string[] | null (outbound only)
    subject: text("subject"),
    htmlBody: text("html_body"),
    textBody: text("text_body"),
    // First ~200 chars of the text body for list previews without shipping
    // the whole body to the message-list view.
    snippet: varchar("snippet", { length: 255 }),
    // RFC 2822 threading headers. messageIdHeader is this message's own
    // Message-ID; inReplyTo / referencesHeader point at ancestors and are
    // how a reply is stitched into the right thread.
    messageIdHeader: varchar("message_id_header", { length: 998 }),
    inReplyTo: varchar("in_reply_to", { length: 998 }),
    referencesHeader: jsonb("references_header"), // string[] | null
    providerId: varchar("provider_id", { length: 255 }), // Resend message id (outbound)
    isRead: boolean("is_read").notNull().default(false),
    isStarred: boolean("is_starred").notNull().default(false),
    isDraft: boolean("is_draft").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    sentAt: timestamp("sent_at"),
  },
  (t) => ({
    threadIdx: index("email_messages_thread_idx").on(t.threadId),
    folderIdx: index("email_messages_mailbox_folder_idx").on(t.mailboxId, t.folder, t.createdAt),
  })
);

// User-defined labels (Gmail-style), applied to messages many-to-many.
export const emailLabels = pgTable("email_labels", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  color: varchar("color", { length: 20 }).notNull().default("#64748b"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const emailMessageLabels = pgTable(
  "email_message_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id").references(() => emailMessages.id, { onDelete: "cascade" }).notNull(),
    labelId: uuid("label_id").references(() => emailLabels.id, { onDelete: "cascade" }).notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("email_message_labels_unique").on(t.messageId, t.labelId),
  })
);

// Attachment bytes stored inline as base64 (contentBase64). Fine for a
// low-volume internal owner mailbox — no separate blob store to provision;
// capped per-attachment at the route layer. Sent to Resend as base64 on
// outbound; populated from the Resend inbound webhook on inbound.
export const emailAttachments = pgTable(
  "email_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id").references(() => emailMessages.id, { onDelete: "cascade" }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 255 }),
    size: integer("size"),
    contentBase64: text("content_base64").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    messageIdx: index("email_attachments_message_idx").on(t.messageId),
  })
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const companiesRelations = relations(companies, ({ many }) => ({
  users: many(users),
  leads: many(leads),
  leadSources: many(leadSources),
  dispositionOptions: many(dispositionOptions),
  assignmentRules: many(assignmentRules),
  tags: many(tags),
  skills: many(skills),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  company: one(companies, { fields: [users.companyId], references: [companies.id] }),
  leads: many(leads),
  skills: many(userSkills),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  company: one(companies, { fields: [leads.companyId], references: [companies.id] }),
  owner: one(users, { fields: [leads.ownerId], references: [users.id] }),
  source: one(leadSources, { fields: [leads.sourceId], references: [leadSources.id] }),
  notes: many(leadNotes),
  attachments: many(leadAttachments),
  tags: many(leadTags),
}));

export const skillsRelations = relations(skills, ({ many }) => ({
  users: many(userSkills),
}));

// ---------------------------------------------------------------------------
// Relations added after the original four above (companiesRelations,
// usersRelations, leadsRelations, skillsRelations) were found incomplete
// and 16 other tables had no relations() object at all — the missing
// `leadSourcesRelations` specifically is what broke drizzle-kit studio
// ("Invalid relation leadSources for table companies"): companiesRelations
// declares `leadSources: many(leadSources)` but nothing existed on the
// leadSources side to pair with it.
//
// These are appended as NEW exports rather than edited into the original
// four objects above: Drizzle merges every `relations()` call that targets
// the same table (by table reference, not by export/variable name) when it
// builds the relational schema graph, so a table can have its relations
// declared across multiple exports with no functional difference from one
// combined declaration. The four "*RelationsExtra" objects below add only
// the fields the original four were missing — nothing here duplicates a
// key already declared above, so there's nothing to conflict or override.
//
// Two columns are deliberately NOT modeled anywhere in this file:
//   - `auditLog.entityId` is polymorphic (its target table varies with
//     `entityType` — lead, user, company, etc.), which Drizzle's relations
//     API has no way to express as a single fixed-table relation.
//   - `leads.duplicateOfLeadId` has no `.references()` at the table level
//     (see that column's own comment) — there's no declared foreign key
//     for a relation to pair with.
//
// `automationSettings.companyId` is unique (one settings row per company —
// a true 1:1), but its `companies` side uses `many()` below like every
// other relation in this file rather than an argument-less `one()` — that
// alternate one-to-one syntax isn't exercised anywhere else in this
// codebase and isn't worth risking on an unverified variant; `many()` is
// unambiguously correct Drizzle syntax and Studio/the query API both
// resolve it fine.
// ---------------------------------------------------------------------------
export const companiesRelationsExtra = relations(companies, ({ many }) => ({
  webhookLogs: many(webhookLogs),
  savedFilters: many(savedFilters),
  automationSettings: many(automationSettings),
  auditLogs: many(auditLog),
  notifications: many(notifications),
  apiKeys: many(apiKeys),
}));

export const usersRelationsExtra = relations(users, ({ many }) => ({
  refreshTokens: many(refreshTokens),
  notes: many(leadNotes),
  attachments: many(leadAttachments),
  savedFilters: many(savedFilters),
  assignmentLogs: many(assignmentLog),
  auditLogs: many(auditLog),
  notifications: many(notifications),
  createdApiKeys: many(apiKeys),
}));

export const leadsRelationsExtra = relations(leads, ({ one, many }) => ({
  requiredSkill: one(skills, { fields: [leads.requiredSkillId], references: [skills.id] }),
  assignmentLogs: many(assignmentLog),
}));

export const skillsRelationsExtra = relations(skills, ({ one, many }) => ({
  company: one(companies, { fields: [skills.companyId], references: [companies.id] }),
  requiredByLeads: many(leads),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export const userSkillsRelations = relations(userSkills, ({ one }) => ({
  user: one(users, { fields: [userSkills.userId], references: [users.id] }),
  skill: one(skills, { fields: [userSkills.skillId], references: [skills.id] }),
}));

export const leadSourcesRelations = relations(leadSources, ({ one, many }) => ({
  company: one(companies, { fields: [leadSources.companyId], references: [companies.id] }),
  account: one(connectedAccounts, { fields: [leadSources.accountId], references: [connectedAccounts.id] }),
  leads: many(leads),
  webhookLogs: many(webhookLogs),
  forms: many(leadForms),
  imports: many(leadImports),
  creator: one(users, { fields: [leadSources.createdBy], references: [users.id] }),
}));

export const leadImportsRelations = relations(leadImports, ({ one, many }) => ({
  company: one(companies, { fields: [leadImports.companyId], references: [companies.id] }),
  source: one(leadSources, { fields: [leadImports.sourceId], references: [leadSources.id] }),
  creator: one(users, { fields: [leadImports.createdBy], references: [users.id] }),
  logs: many(leadImportLogs),
}));

export const leadImportLogsRelations = relations(leadImportLogs, ({ one }) => ({
  import: one(leadImports, { fields: [leadImportLogs.importId], references: [leadImports.id] }),
  lead: one(leads, { fields: [leadImportLogs.leadId], references: [leads.id] }),
}));

export const connectedAccountsRelations = relations(connectedAccounts, ({ one, many }) => ({
  company: one(companies, { fields: [connectedAccounts.companyId], references: [companies.id] }),
  creator: one(users, { fields: [connectedAccounts.createdBy], references: [users.id] }),
  sources: many(leadSources),
}));

export const webhookLogsRelations = relations(webhookLogs, ({ one }) => ({
  source: one(leadSources, { fields: [webhookLogs.sourceId], references: [leadSources.id] }),
  company: one(companies, { fields: [webhookLogs.companyId], references: [companies.id] }),
  lead: one(leads, { fields: [webhookLogs.leadId], references: [leads.id] }),
}));

export const leadFormsRelations = relations(leadForms, ({ one }) => ({
  source: one(leadSources, { fields: [leadForms.sourceId], references: [leadSources.id] }),
}));

export const dispositionOptionsRelations = relations(dispositionOptions, ({ one }) => ({
  company: one(companies, { fields: [dispositionOptions.companyId], references: [companies.id] }),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  company: one(companies, { fields: [tags.companyId], references: [companies.id] }),
  leadTags: many(leadTags),
}));

export const leadTagsRelations = relations(leadTags, ({ one }) => ({
  lead: one(leads, { fields: [leadTags.leadId], references: [leads.id] }),
  tag: one(tags, { fields: [leadTags.tagId], references: [tags.id] }),
}));

export const leadNotesRelations = relations(leadNotes, ({ one }) => ({
  lead: one(leads, { fields: [leadNotes.leadId], references: [leads.id] }),
  author: one(users, { fields: [leadNotes.authorId], references: [users.id] }),
}));

export const leadAttachmentsRelations = relations(leadAttachments, ({ one }) => ({
  lead: one(leads, { fields: [leadAttachments.leadId], references: [leads.id] }),
  uploader: one(users, { fields: [leadAttachments.uploadedBy], references: [users.id] }),
}));

export const savedFiltersRelations = relations(savedFilters, ({ one }) => ({
  company: one(companies, { fields: [savedFilters.companyId], references: [companies.id] }),
  user: one(users, { fields: [savedFilters.userId], references: [users.id] }),
}));

export const assignmentRulesRelations = relations(assignmentRules, ({ one }) => ({
  company: one(companies, { fields: [assignmentRules.companyId], references: [companies.id] }),
}));

export const automationSettingsRelations = relations(automationSettings, ({ one }) => ({
  company: one(companies, { fields: [automationSettings.companyId], references: [companies.id] }),
}));

export const assignmentLogRelations = relations(assignmentLog, ({ one }) => ({
  lead: one(leads, { fields: [assignmentLog.leadId], references: [leads.id] }),
  agent: one(users, { fields: [assignmentLog.assignedTo], references: [users.id] }),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  company: one(companies, { fields: [auditLog.companyId], references: [companies.id] }),
  user: one(users, { fields: [auditLog.userId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  company: one(companies, { fields: [notifications.companyId], references: [companies.id] }),
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  company: one(companies, { fields: [apiKeys.companyId], references: [companies.id] }),
  creator: one(users, { fields: [apiKeys.createdBy], references: [users.id] }),
}));

export const mailboxesRelations = relations(mailboxes, ({ many }) => ({
  threads: many(emailThreads),
  messages: many(emailMessages),
}));

export const emailThreadsRelations = relations(emailThreads, ({ one, many }) => ({
  mailbox: one(mailboxes, { fields: [emailThreads.mailboxId], references: [mailboxes.id] }),
  messages: many(emailMessages),
}));

export const emailMessagesRelations = relations(emailMessages, ({ one, many }) => ({
  thread: one(emailThreads, { fields: [emailMessages.threadId], references: [emailThreads.id] }),
  mailbox: one(mailboxes, { fields: [emailMessages.mailboxId], references: [mailboxes.id] }),
  attachments: many(emailAttachments),
  labels: many(emailMessageLabels),
}));

export const emailLabelsRelations = relations(emailLabels, ({ many }) => ({
  messageLabels: many(emailMessageLabels),
}));

export const emailMessageLabelsRelations = relations(emailMessageLabels, ({ one }) => ({
  message: one(emailMessages, { fields: [emailMessageLabels.messageId], references: [emailMessages.id] }),
  label: one(emailLabels, { fields: [emailMessageLabels.labelId], references: [emailLabels.id] }),
}));

export const emailAttachmentsRelations = relations(emailAttachments, ({ one }) => ({
  message: one(emailMessages, { fields: [emailAttachments.messageId], references: [emailMessages.id] }),
}));

// ===========================================================================
// Phase 11 — Meta Conversions API (CAPI)
// Sends CRM conversion events back to Meta to improve Event Match Quality,
// attribution and campaign optimization. Built ON TOP of the existing Meta
// OAuth (connectedAccounts) — no second login. Fully isolated: nothing here
// changes Lead Ads, the Assignment Engine, Website Forms, or AI.
// ===========================================================================

export const capiEventStatusEnum = pgEnum("capi_event_status", ["pending", "processing", "sent", "failed", "dead_letter"]);

// A selected Pixel/Dataset a company sends conversions to. One company can
// connect several (multiple Meta accounts / ad accounts / pixels).
export const capiPixels = pgTable(
  "capi_pixels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    // The reused Meta OAuth identity this pixel was discovered through.
    accountId: uuid("account_id").references(() => connectedAccounts.id, { onDelete: "set null" }),
    businessId: varchar("business_id", { length: 255 }),
    businessName: varchar("business_name", { length: 255 }),
    adAccountId: varchar("ad_account_id", { length: 255 }),
    adAccountName: varchar("ad_account_name", { length: 255 }),
    // The pixel (a.k.a. dataset) events are POSTed to: /{pixelId}/events.
    pixelId: varchar("pixel_id", { length: 255 }).notNull(),
    pixelName: varchar("pixel_name", { length: 255 }),
    datasetId: varchar("dataset_id", { length: 255 }),
    // The access token used to POST events, encrypted (AES-256-GCM). Defaults
    // to the connected account's user token; an admin may override with a
    // system-user token. NEVER stored or logged in plaintext.
    accessToken: text("access_token"),
    // Optional Events Manager "Test Events" code — routes events to the test
    // view instead of production, for verifying the connection.
    testEventCode: varchar("test_event_code", { length: 100 }),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => ({
    companyIdx: index("capi_pixels_company_idx").on(t.companyId),
    // One live config per (company, pixel).
    liveUniq: uniqueIndex("capi_pixels_company_pixel_uniq").on(t.companyId, t.pixelId).where(sql`deleted_at is null`),
  })
);

// CRM trigger -> Meta event mapping, per pixel. `trigger` is a disposition
// label, a lifecycle stage, or a system trigger ("lead_created"/"lead_assigned").
// metaEvent null = "No Event" (explicitly do not send). Fully configurable.
export const capiEventMappings = pgTable(
  "capi_event_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    pixelId: uuid("pixel_id").references(() => capiPixels.id, { onDelete: "cascade" }).notNull(),
    trigger: varchar("trigger", { length: 120 }).notNull(),
    metaEvent: varchar("meta_event", { length: 120 }), // null = No Event
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    pixelTriggerUniq: uniqueIndex("capi_mappings_pixel_trigger_uniq").on(t.pixelId, t.trigger),
    companyIdx: index("capi_mappings_company_idx").on(t.companyId),
  })
);

// The durable event store: simultaneously the send QUEUE (status/attempts/
// availableAt worked by a SKIP LOCKED worker) AND the Conversions Delivery Log
// (every row kept with response/latency/retry count). payload holds ONLY hashed
// user_data + non-PII custom_data — never raw PII.
export const capiEvents = pgTable(
  "capi_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    pixelConfigId: uuid("pixel_config_id").references(() => capiPixels.id, { onDelete: "cascade" }).notNull(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    eventName: varchar("event_name", { length: 120 }).notNull(),
    // Deterministic dedup key sent to Meta as `event_id` AND enforced by the
    // partial unique index below — resending the same conversion (live or
    // historical) is deduplicated on both ends.
    eventId: varchar("event_id", { length: 200 }).notNull(),
    eventTime: timestamp("event_time").notNull(),
    actionSource: varchar("action_source", { length: 40 }).notNull().default("system_generated"),
    trigger: varchar("trigger", { length: 120 }),
    origin: varchar("origin", { length: 20 }).notNull().default("live"), // live | historical
    status: capiEventStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    availableAt: timestamp("available_at").notNull().defaultNow(),
    lockedAt: timestamp("locked_at"),
    lockedBy: varchar("locked_by", { length: 100 }),
    payload: jsonb("payload"), // hashed user_data + custom_data (no raw PII)
    matchKeys: jsonb("match_keys"), // which match params were present (for EMQ)
    eventMatchQuality: varchar("event_match_quality", { length: 20 }), // excellent|good|fair|poor
    httpStatus: integer("http_status"),
    metaResponse: jsonb("meta_response"),
    latencyMs: integer("latency_ms"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // Worker hot path: due rows first (SKIP LOCKED handles concurrency).
    dueIdx: index("capi_events_due_idx").on(t.status, t.availableAt),
    // Delivery Log pagination (WHERE company_id ORDER BY created_at DESC).
    companyCreatedIdx: index("capi_events_company_created_idx").on(t.companyId, t.createdAt),
    leadIdx: index("capi_events_lead_idx").on(t.leadId),
    // Absolute dedup: at most one row per (pixel, event_id).
    dedupUniq: uniqueIndex("capi_events_pixel_event_uniq").on(t.pixelConfigId, t.eventId),
  })
);

// ===========================================================================
// Phase 13 — Email verification codes (signup + password reset)
// A short-lived 6-digit code emailed to the user. Stored hashed (never in
// plaintext). One active row per (email, purpose) is used; expiry, attempt,
// and resend limits are enforced in src/lib/auth/verification.ts.
// ===========================================================================
export const verificationPurposeEnum = pgEnum("verification_purpose", ["signup", "password_reset"]);

export const emailVerifications = pgTable(
  "email_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 255 }).notNull(),
    purpose: verificationPurposeEnum("purpose").notNull(),
    // SHA-256 of the 6-digit code — the code itself is only ever emailed.
    codeHash: text("code_hash").notNull(),
    // Signup carries the pending name + company name here until the code is
    // verified and the account is actually created.
    payload: jsonb("payload"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    resendCount: integer("resend_count").notNull().default(0),
    maxResends: integer("max_resends").notNull().default(5),
    lastSentAt: timestamp("last_sent_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    emailPurposeIdx: index("email_verifications_email_purpose_idx").on(t.email, t.purpose),
  })
);

// ===========================================================================
// Phase 15 — AI Callback & Follow-up Engine
// An agent schedules a callback on a lead; the engine reminds them at the
// right moments. Built on the SAME durable-queue model as the assignment and
// Conversions API queues (rows + FOR UPDATE SKIP LOCKED + backoff +
// dead-letter), so thousands of callbacks can come due at once without
// blocking anything. Fully additive: nothing here changes the CRM, the
// Assignment Engine, the Lead Lifecycle, or Notifications.
// ===========================================================================
export const callbackStatusEnum = pgEnum("callback_status", ["scheduled", "due", "completed", "missed", "cancelled", "rescheduled"]);
export const callbackReminderStatusEnum = pgEnum("callback_reminder_status", ["pending", "processing", "sent", "failed", "dead_letter", "cancelled"]);

export const callbacks = pgTable(
  "callbacks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
    // Who gets reminded — normally the lead's assigned agent at scheduling time.
    agentId: uuid("agent_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    // The moment to call back. Stored as an absolute instant; `timezone` is the
    // IANA zone the agent picked, kept for display + future calendar sync.
    scheduledAt: timestamp("scheduled_at").notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull().default("UTC"),
    reason: varchar("reason", { length: 60 }).notNull(),
    notes: text("notes"),
    priority: varchar("priority", { length: 20 }).notNull().default("normal"), // low|normal|high|urgent
    status: callbackStatusEnum("status").notNull().default("scheduled"),
    // Set when the agent dismisses the due reminder — the reminder banner stays
    // visible (across reloads) until this is set.
    acknowledgedAt: timestamp("acknowledged_at"),
    completedAt: timestamp("completed_at"),
    cancelledAt: timestamp("cancelled_at"),
    missedAt: timestamp("missed_at"),
    escalatedAt: timestamp("escalated_at"),
    // Reschedule chain: the callback this one replaced (the old row is marked
    // "rescheduled" and kept, so history is never lost).
    rescheduledFromId: uuid("rescheduled_from_id"),
    rescheduleCount: integer("reschedule_count").notNull().default(0),
    // Deterministic AI ordering score — recomputed when a callback comes due so
    // simultaneous callbacks surface hottest-first (see lib/callbacks/prioritize).
    priorityScore: real("priority_score").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // Dashboard: this company's callbacks by time (Today / Upcoming / Overdue).
    companyScheduledIdx: index("callbacks_company_scheduled_idx").on(t.companyId, t.scheduledAt),
    // An agent's own queue, hottest-first.
    agentStatusIdx: index("callbacks_agent_status_idx").on(t.agentId, t.status, t.scheduledAt),
    // Overdue sweep: open callbacks whose time has passed.
    statusScheduledIdx: index("callbacks_status_scheduled_idx").on(t.status, t.scheduledAt),
    leadIdx: index("callbacks_lead_idx").on(t.leadId),
  })
);

// The durable reminder queue: one row per (callback × configured offset ×
// channel). dueAt is precomputed at scheduling time so the worker only ever
// does an indexed "due now" scan — this is what makes 100k+ scheduled
// callbacks cheap. `channel` is the FUTURE-READY seam: only "in_app" is
// implemented today; email/sms/whatsapp/voice/calendar slot in behind the
// channel dispatcher with no schema change.
export const callbackReminders = pgTable(
  "callback_reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callbackId: uuid("callback_id").references(() => callbacks.id, { onDelete: "cascade" }).notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    agentId: uuid("agent_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
    // Minutes relative to scheduledAt: negative = before, 0 = at time,
    // positive = overdue. `kind` is the human label used for dedup + display.
    offsetMinutes: integer("offset_minutes").notNull(),
    kind: varchar("kind", { length: 30 }).notNull(), // before_15 | before_5 | at_time | overdue_15 | overdue_60
    dueAt: timestamp("due_at").notNull(),
    channel: varchar("channel", { length: 20 }).notNull().default("in_app"),
    status: callbackReminderStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: timestamp("available_at").notNull().defaultNow(),
    lockedAt: timestamp("locked_at"),
    lockedBy: varchar("locked_by", { length: 100 }),
    sentAt: timestamp("sent_at"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // Worker hot path: due rows first (SKIP LOCKED handles concurrency).
    dueIdx: index("callback_reminders_due_idx").on(t.status, t.availableAt, t.dueAt),
    callbackIdx: index("callback_reminders_callback_idx").on(t.callbackId),
    // One reminder per (callback, kind, channel) — makes scheduling idempotent.
    uniq: uniqueIndex("callback_reminders_unique").on(t.callbackId, t.kind, t.channel),
  })
);

// Append-only history: created / rescheduled / completed / cancelled / missed /
// viewed / acknowledged / reminder_sent / escalated. Complements audit_log with
// a per-callback timeline.
export const callbackEvents = pgTable(
  "callback_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callbackId: uuid("callback_id").references(() => callbacks.id, { onDelete: "cascade" }).notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
    type: varchar("type", { length: 30 }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    callbackIdx: index("callback_events_callback_idx").on(t.callbackId, t.createdAt),
    companyIdx: index("callback_events_company_idx").on(t.companyId, t.createdAt),
  })
);

// Per-company reminder configuration (smart reminders + escalation).
export const callbackSettings = pgTable("callback_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull().unique(),
  // Minutes relative to the scheduled time. Default: 15m before, 5m before,
  // at time, 15m overdue, 1h overdue.
  reminderOffsets: jsonb("reminder_offsets").notNull().default(sql`'[-15,-5,0,15,60]'::jsonb`),
  // How long after the scheduled time an un-completed callback is marked
  // missed + escalated.
  escalateAfterMinutes: integer("escalate_after_minutes").notNull().default(30),
  notifyManager: boolean("notify_manager").notNull().default(true),
  notifyAdmin: boolean("notify_admin").notNull().default(false),
  soundEnabled: boolean("sound_enabled").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Phase 19 — Finance & Bookkeeping Foundation. An independent bounded context:
// nothing in here references CRM tables (leads/sources/etc.) and nothing in
// CRM references these — CRM (or Payroll, Attendance, Inventory…) integrates
// later by POSTING through the finance services, never by joining tables.
//
// Double-entry core: finance_journals (header) + finance_journal_lines. The
// GENERAL LEDGER *is* the set of lines whose `posted` flag is true — there is
// no second ledger table, so a financial amount exists in exactly one row
// (normalized, "no duplicated financial data"). Posted rows are immutable by
// service contract: corrections happen through reversing/adjusting entries,
// never UPDATEs. entry_date is denormalized onto lines at write time so the
// hot ledger query (company + account + date range over posted rows) is one
// partial-index scan with no join — the design that keeps millions of ledger
// entries fast.
// ---------------------------------------------------------------------------
export const financeAccountTypeEnum = pgEnum("finance_account_type", ["asset", "liability", "equity", "income", "expense"]);
export const financeJournalStatusEnum = pgEnum("finance_journal_status", ["draft", "posted", "voided"]);
export const financeYearStatusEnum = pgEnum("finance_year_status", ["open", "closed"]);
export const financeDocStatusEnum = pgEnum("finance_doc_status", ["posted", "voided"]);

// Chart of Accounts. Cash and bank accounts are ASSET accounts with a
// subtype ("cash" | "bank") — that is what real accounting is, so their
// balances fall out of the same ledger as everything else instead of being
// tracked in a parallel structure. metadata holds subtype extras (bank
// nickname, currency placeholder, reconciliation placeholder fields).
export const financeAccounts = pgTable(
  "finance_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    code: varchar("code", { length: 20 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    type: financeAccountTypeEnum("type").notNull(),
    subtype: varchar("subtype", { length: 20 }), // "cash" | "bank" | null
    parentId: uuid("parent_id").references((): AnyPgColumn => financeAccounts.id, { onDelete: "set null" }),
    // Seeded defaults every company gets (Opening Balance Equity, Sales
    // Revenue, …). System accounts can be renamed but never deleted — the
    // posting engine depends on some of them existing.
    isSystem: boolean("is_system").notNull().default(false),
    active: boolean("active").notNull().default(true),
    description: text("description"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    codeUniq: uniqueIndex("finance_accounts_company_code_uniq").on(t.companyId, t.code),
    typeIdx: index("finance_accounts_company_type_idx").on(t.companyId, t.type),
    parentIdx: index("finance_accounts_parent_idx").on(t.parentId),
  })
);

// Per-company finance state: document numbering (atomic UPDATE … RETURNING,
// same pattern as automation_settings.assignment_cursor) + the opening-
// balance lock + placeholder currency.
export const financeSettings = pgTable("finance_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  nextJournalNumber: integer("next_journal_number").notNull().default(1),
  nextRevenueNumber: integer("next_revenue_number").notNull().default(1),
  nextExpenseNumber: integer("next_expense_number").notNull().default(1),
  // Once set, opening-balance journals can no longer be created or voided —
  // corrections from then on are ordinary adjusting entries.
  openingBalancesLockedAt: timestamp("opening_balances_locked_at"),
  defaultCurrency: varchar("default_currency", { length: 8 }).notNull().default("USD"), // placeholder — multi-currency is a future module
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Financial years. Posting checks the entry date against these: a date inside
// a CLOSED year is rejected (locked history); a date no year covers is allowed
// (year discipline is opt-in until the company defines its calendar).
export const financeYears = pgTable(
  "finance_years",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    label: varchar("label", { length: 40 }).notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: financeYearStatusEnum("status").notNull().default("open"),
    closedAt: timestamp("closed_at"),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    labelUniq: uniqueIndex("finance_years_company_label_uniq").on(t.companyId, t.label),
    rangeIdx: index("finance_years_company_range_idx").on(t.companyId, t.startDate, t.endDate),
  })
);

// Journal entry header. entry_number is assigned at POSTING time (drafts have
// none), sequential per company, and unique once assigned.
export const financeJournals = pgTable(
  "finance_journals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    entryNumber: integer("entry_number"),
    entryDate: date("entry_date").notNull(),
    memo: text("memo"),
    status: financeJournalStatusEnum("status").notNull().default("draft"),
    // What produced this entry: "manual" | "revenue" | "expense" |
    // "opening_balance" | "reversal" — and later "payroll", "inventory", …
    // A plain varchar (audit vocabulary), so future modules never migrate.
    sourceType: varchar("source_type", { length: 30 }).notNull().default("manual"),
    sourceId: uuid("source_id"),
    // Voiding never deletes ledger history: it posts a reversing entry that
    // points back here. The voided original + its reversal both stay in the
    // ledger forever, netting to zero.
    reversalOfId: uuid("reversal_of_id").references((): AnyPgColumn => financeJournals.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    postedBy: uuid("posted_by").references(() => users.id, { onDelete: "set null" }),
    postedAt: timestamp("posted_at"),
    voidedBy: uuid("voided_by").references(() => users.id, { onDelete: "set null" }),
    voidedAt: timestamp("voided_at"),
    voidReason: text("void_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    numberUniq: uniqueIndex("finance_journals_company_number_uniq")
      .on(t.companyId, t.entryNumber)
      .where(sql`entry_number is not null`),
    statusIdx: index("finance_journals_company_status_idx").on(t.companyId, t.status, t.entryDate),
    dateIdx: index("finance_journals_company_date_idx").on(t.companyId, t.entryDate),
    sourceIdx: index("finance_journals_source_idx").on(t.sourceId),
  })
);

// Journal lines — THE general ledger (rows where posted = true). accountId
// deliberately has no ON DELETE action: the database itself refuses to delete
// an account that has ever been used, backing the service-level rule.
export const financeJournalLines = pgTable(
  "finance_journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    journalId: uuid("journal_id")
      .references(() => financeJournals.id, { onDelete: "cascade" })
      .notNull(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    accountId: uuid("account_id")
      .references(() => financeAccounts.id)
      .notNull(),
    lineNo: integer("line_no").notNull().default(1),
    // Denormalized from the header at write time (kept in sync by the ONE
    // writer, JournalService) so ledger scans never join.
    entryDate: date("entry_date").notNull(),
    posted: boolean("posted").notNull().default(false),
    debit: numeric("debit", { precision: 14, scale: 2 }).notNull().default("0"),
    credit: numeric("credit", { precision: 14, scale: 2 }).notNull().default("0"),
    description: varchar("description", { length: 255 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    // The ledger index: company + account + date over posted rows only.
    ledgerIdx: index("finance_ledger_account_idx")
      .on(t.companyId, t.accountId, t.entryDate)
      .where(sql`posted = true`),
    journalIdx: index("finance_journal_lines_journal_idx").on(t.journalId),
    companyPostedIdx: index("finance_journal_lines_company_posted_idx")
      .on(t.companyId, t.entryDate)
      .where(sql`posted = true`),
  })
);

// Revenue documents. Each posts ONE balanced journal automatically:
//   Debit  deposit account (cash/bank asset)
//   Credit income account
export const financeRevenues = pgTable(
  "finance_revenues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    docNumber: integer("doc_number").notNull(),
    entryDate: date("entry_date").notNull(),
    customerName: varchar("customer_name", { length: 160 }).notNull(),
    customerRef: varchar("customer_ref", { length: 120 }), // free-form external reference (a CRM lead id, etc.) — no FK: Finance stays CRM-independent
    invoiceRef: varchar("invoice_ref", { length: 120 }), // placeholder — invoicing is a future module
    incomeAccountId: uuid("income_account_id").references(() => financeAccounts.id).notNull(),
    depositAccountId: uuid("deposit_account_id").references(() => financeAccounts.id).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    notes: text("notes"),
    journalId: uuid("journal_id").references(() => financeJournals.id).notNull(),
    status: financeDocStatusEnum("status").notNull().default("posted"),
    voidReason: text("void_reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    numberUniq: uniqueIndex("finance_revenues_company_number_uniq").on(t.companyId, t.docNumber),
    dateIdx: index("finance_revenues_company_date_idx").on(t.companyId, t.entryDate),
  })
);

// Expense documents. Each posts ONE balanced journal automatically:
//   Debit  expense account
//   Credit payment account (cash/bank asset)
export const financeExpenses = pgTable(
  "finance_expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    docNumber: integer("doc_number").notNull(),
    entryDate: date("entry_date").notNull(),
    vendorName: varchar("vendor_name", { length: 160 }).notNull(),
    category: varchar("category", { length: 80 }),
    paymentMethod: varchar("payment_method", { length: 20 }).notNull().default("cash"), // "cash" | "bank" | "card" | "other"
    receiptRef: varchar("receipt_ref", { length: 160 }), // placeholder — receipt uploads are a future module
    expenseAccountId: uuid("expense_account_id").references(() => financeAccounts.id).notNull(),
    paymentAccountId: uuid("payment_account_id").references(() => financeAccounts.id).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    notes: text("notes"),
    journalId: uuid("journal_id").references(() => financeJournals.id).notNull(),
    status: financeDocStatusEnum("status").notNull().default("posted"),
    voidReason: text("void_reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    numberUniq: uniqueIndex("finance_expenses_company_number_uniq").on(t.companyId, t.docNumber),
    dateIdx: index("finance_expenses_company_date_idx").on(t.companyId, t.entryDate),
  })
);

// ---------------------------------------------------------------------------
// Phase 20 — Attendance & Shift Management Engine. Like Finance, an
// independent bounded context: it references users only for identity, never
// CRM data, and future Payroll consumes it exclusively through the attendance
// services (getWorkSummary and friends) — never by joining these tables.
//
// The design centers on attendance_records: exactly ONE row per user per work
// day, carrying the check-in/out pair and the DERIVED figures (late status,
// departure status, break minutes, worked minutes) computed ONCE at the
// moment they become final. Payroll reads stored facts; nothing is
// recalculated per report ("no duplicate calculations").
// ---------------------------------------------------------------------------

// Shifts. Times are minutes-from-midnight WALL CLOCK in the shift's timezone
// (falling back to the company's, then UTC) — an endMinute smaller than
// startMinute means the shift crosses midnight (night shifts). `flexible`
// shifts skip late/early evaluation entirely.
export const attendanceShifts = pgTable(
  "attendance_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    startMinute: integer("start_minute").notNull().default(9 * 60),
    endMinute: integer("end_minute").notNull().default(17 * 60),
    graceMinutes: integer("grace_minutes").notNull().default(10),
    // Past grace but within this many minutes of start = "late"; beyond = "very_late".
    veryLateMinutes: integer("very_late_minutes").notNull().default(30),
    // Leaving more than this many minutes before shift end = "left_early".
    earlyLeaveMinutes: integer("early_leave_minutes").notNull().default(15),
    flexible: boolean("flexible").notNull().default(false),
    timezone: varchar("timezone", { length: 64 }), // null = company timezone
    isSystem: boolean("is_system").notNull().default(false), // seeded defaults
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("attendance_shifts_company_idx").on(t.companyId),
    nameUniq: uniqueIndex("attendance_shifts_company_name_uniq").on(t.companyId, t.name),
  })
);

// Current shift per user. One row per user today; rotating shifts later turn
// this into dated history rows (drop the unique, add effective ranges) —
// effectiveFrom already exists so that change is additive.
export const attendanceAssignments = pgTable(
  "attendance_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    shiftId: uuid("shift_id").references(() => attendanceShifts.id, { onDelete: "set null" }),
    effectiveFrom: date("effective_from"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userUniq: uniqueIndex("attendance_assignments_company_user_uniq").on(t.companyId, t.userId),
  })
);

// The day record — Payroll's raw material. workDate is the check-in date in
// the shift's timezone; a night shift checking out after midnight stays on
// its check-in date (one row per worked day, unambiguous for pay periods).
export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    workDate: date("work_date").notNull(),
    // Snapshot of the shift the evaluation used (assignment may change later;
    // history must not).
    shiftId: uuid("shift_id").references(() => attendanceShifts.id, { onDelete: "set null" }),
    checkInAt: timestamp("check_in_at").notNull(),
    checkOutAt: timestamp("check_out_at"),
    checkInTimezone: varchar("check_in_timezone", { length: 64 }),
    checkInIp: varchar("check_in_ip", { length: 64 }),
    checkInUserAgent: varchar("check_in_user_agent", { length: 255 }),
    checkInLocation: jsonb("check_in_location"), // placeholder — GPS/geo later
    checkInDevice: varchar("check_in_device", { length: 80 }), // placeholder — device binding later
    lateStatus: varchar("late_status", { length: 16 }), // on_time | late | very_late
    lateMinutes: integer("late_minutes").notNull().default(0),
    departureStatus: varchar("departure_status", { length: 16 }), // normal | left_early | overtime (status only — payments are Payroll's)
    earlyMinutes: integer("early_minutes").notNull().default(0),
    breakMinutes: integer("break_minutes").notNull().default(0),
    workedMinutes: integer("worked_minutes"), // set once at check-out: (out − in) − breaks
    manualAdjusted: boolean("manual_adjusted").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    dayUniq: uniqueIndex("attendance_records_company_user_date_uniq").on(t.companyId, t.userId, t.workDate),
    companyDateIdx: index("attendance_records_company_date_idx").on(t.companyId, t.workDate),
    userDateIdx: index("attendance_records_user_date_idx").on(t.userId, t.workDate),
  })
);

export const attendanceBreaks = pgTable(
  "attendance_breaks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recordId: uuid("record_id")
      .references(() => attendanceRecords.id, { onDelete: "cascade" })
      .notNull(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    startAt: timestamp("start_at").notNull(),
    endAt: timestamp("end_at"),
    durationMinutes: integer("duration_minutes"), // set once at break end
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    recordIdx: index("attendance_breaks_record_idx").on(t.recordId),
  })
);

export const attendanceLeaveRequests = pgTable(
  "attendance_leave_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    type: varchar("type", { length: 20 }).notNull(), // casual | sick | paid | unpaid | emergency
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    reason: text("reason"),
    status: varchar("status", { length: 16 }).notNull().default("pending"), // pending | approved | rejected | cancelled
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    reviewNote: text("review_note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("attendance_leaves_company_status_idx").on(t.companyId, t.status),
    userIdx: index("attendance_leaves_user_range_idx").on(t.userId, t.startDate, t.endDate),
  })
);

// Holidays. `recurring` = same month/day every year (national days); dated
// rows handle one-offs and future years explicitly.
export const attendanceHolidays = pgTable(
  "attendance_holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    date: date("date").notNull(),
    kind: varchar("kind", { length: 20 }).notNull().default("company"), // national | company | optional
    recurring: boolean("recurring").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    dateIdx: index("attendance_holidays_company_date_idx").on(t.companyId, t.date),
  })
);

// The attendance EVENT log: every action (check in/out, breaks, leave
// lifecycle, manual adjustments, shift assignment) as an append-only stream.
// Complements the platform audit_log (which records the admin-facing actions
// with before/after) — this one is the per-employee timeline.
export const attendanceLogs = pgTable(
  "attendance_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(), // the employee the event is about
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }), // who performed it (self or an admin)
    recordId: uuid("record_id").references(() => attendanceRecords.id, { onDelete: "set null" }),
    action: varchar("action", { length: 30 }).notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("attendance_logs_company_created_idx").on(t.companyId, t.createdAt),
    userIdx: index("attendance_logs_user_created_idx").on(t.userId, t.createdAt),
  })
);

export const attendanceSettings = pgTable("attendance_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  defaultShiftId: uuid("default_shift_id").references(() => attendanceShifts.id, { onDelete: "set null" }),
  // Days of week (0=Sun..6=Sat) that don't count toward absence.
  weekendDays: jsonb("weekend_days").notNull().default(sql`'[0,6]'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Phase 21 — Payroll & Salary Management Engine. Payroll is a bounded context
// that CONSUMES two others through their services and NEVER their tables:
//   • Attendance — read-only, via getWorkSummary()/getPeriodCalendar() (worked
//     minutes, present/late/leave/absent days, shift history). No attendance
//     math is duplicated here.
//   • Finance — write-only accounting, via JournalService.createAndPost() (the
//     accrual on approval, the payment on "paid"). No finance table is touched
//     directly; payroll only stores the journal IDs it got back.
//
// MONEY: stored as BIGINT CENTS (exact integer arithmetic; ample headroom for
// enterprise aggregate runs). Converted to finance's numeric(14,2) dollars only
// at the JournalService boundary.
//
// HISTORY: a payroll_item SNAPSHOTS every figure at calculation time (basic,
// each component, the attendance summary, the full breakdown). Later structure
// edits or attendance corrections never rewrite a processed run — the run is
// the immutable record, which is exactly what an approved/paid payroll must be.
// ---------------------------------------------------------------------------

// Per-company payroll configuration. Overtime multiplier + the standard workday
// give the hourly rate used to convert overtime minutes → money; the account
// codes tell the Finance integration which accounts to post to (all default to
// the Phase 19 seeded chart, with Salary Payable auto-created on first use).
export const payrollSettings = pgTable("payroll_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  defaultFrequency: varchar("default_frequency", { length: 12 }).notNull().default("monthly"), // monthly | weekly | biweekly | hourly
  overtimeMultiplier: real("overtime_multiplier").notNull().default(1.5),
  standardWorkdayMinutes: integer("standard_workday_minutes").notNull().default(480),
  standardWorkdaysPerMonth: integer("standard_workdays_per_month").notNull().default(22),
  payDayOfMonth: integer("pay_day_of_month").notNull().default(1), // drives the "upcoming payroll date"
  // Finance account codes the accrual/payment journals post to.
  salaryExpenseAccountCode: varchar("salary_expense_account_code", { length: 20 }).notNull().default("5200"),
  salaryPayableAccountCode: varchar("salary_payable_account_code", { length: 20 }).notNull().default("2200"),
  defaultPaymentAccountCode: varchar("default_payment_account_code", { length: 20 }).notNull().default("1100"),
  nextRunNumber: integer("next_run_number").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Salary structures — VERSIONED. Editing a structure creates a new row
// (version + 1) chained to the lineage's first row via rootId; the superseded
// row is deactivated but kept forever. A profile references a specific version
// row, and a run snapshots its numbers, so history is fully reconstructable.
export const payrollStructures = pgTable(
  "payroll_structures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    // The lineage anchor: null on v1, else the v1 row's id. All versions of one
    // structure share (rootId ?? id).
    rootId: uuid("root_id").references((): AnyPgColumn => payrollStructures.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    active: boolean("active").notNull().default(true), // false = superseded by a newer version
    name: varchar("name", { length: 120 }).notNull(),
    frequency: varchar("frequency", { length: 12 }).notNull().default("monthly"),
    basicCents: bigint("basic_cents", { mode: "number" }).notNull().default(0),
    // Ordered components beyond basic: [{ key, label, type, amountCents,
    // taxable? }]. type ∈ allowance | hra | fixed_incentive | employer_contribution
    // | deduction | custom. hra & employer_contribution are placeholder types
    // (carried through the math like allowances/info) — no statutory logic yet.
    components: jsonb("components").notNull().default(sql`'[]'::jsonb`),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("payroll_structures_company_idx").on(t.companyId, t.active),
    rootIdx: index("payroll_structures_root_idx").on(t.rootId),
  })
);

// One payroll profile per employee.
export const payrollProfiles = pgTable(
  "payroll_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    structureId: uuid("structure_id").references(() => payrollStructures.id, { onDelete: "set null" }),
    frequency: varchar("frequency", { length: 12 }).notNull().default("monthly"),
    joiningDate: date("joining_date"),
    status: varchar("status", { length: 16 }).notNull().default("active"), // active | on_hold | terminated
    bankAccountRef: varchar("bank_account_ref", { length: 120 }), // placeholder — no bank integration
    taxRef: varchar("tax_ref", { length: 120 }), // placeholder — no tax engine
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userUniq: uniqueIndex("payroll_profiles_company_user_uniq").on(t.companyId, t.userId),
  })
);

// Incentives + deductions. kind splits the two; category is the sub-type the
// spec enumerates (incentive: fixed/performance/sales/manual/recurring;
// deduction: manual/recurring/penalty/loan/advance — penalty/loan/advance are
// placeholder categories that ride the same one-time/recurring mechanics).
export const payrollAdjustments = pgTable(
  "payroll_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    kind: varchar("kind", { length: 12 }).notNull(), // incentive | deduction
    category: varchar("category", { length: 20 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    recurring: boolean("recurring").notNull().default(false),
    // One-time adjustments apply to the run whose period contains effectiveDate;
    // recurring ones apply every run from effectiveDate until endDate (or forever).
    effectiveDate: date("effective_date").notNull(),
    endDate: date("end_date"),
    // A one-time adjustment is consumed by the run that pays it (set on
    // calculate) so it never double-applies.
    appliedRunId: uuid("applied_run_id"),
    status: varchar("status", { length: 12 }).notNull().default("active"), // active | consumed | cancelled
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    lookupIdx: index("payroll_adjustments_company_user_idx").on(t.companyId, t.userId, t.status),
  })
);

// Payroll runs — the lifecycle envelope. draft → calculated → approved →
// (locked) → paid. Nothing about a run's items may change once approved; the
// accrual journal is written on approval, the payment journal on "paid".
export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    runNumber: integer("run_number"),
    label: varchar("label", { length: 120 }).notNull(),
    frequency: varchar("frequency", { length: 12 }).notNull().default("monthly"),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    payDate: date("pay_date").notNull(),
    status: varchar("status", { length: 12 }).notNull().default("draft"), // draft | calculated | approved | locked | paid
    totalGrossCents: bigint("total_gross_cents", { mode: "number" }).notNull().default(0),
    totalDeductionsCents: bigint("total_deductions_cents", { mode: "number" }).notNull().default(0),
    totalNetCents: bigint("total_net_cents", { mode: "number" }).notNull().default(0),
    employeeCount: integer("employee_count").notNull().default(0),
    // Finance journal IDs (NOT foreign keys into finance tables — payroll only
    // records what the Finance service returned, keeping the contexts decoupled).
    accrualJournalId: uuid("accrual_journal_id"),
    paymentJournalId: uuid("payment_journal_id"),
    paymentAccountCode: varchar("payment_account_code", { length: 20 }),
    calculatedAt: timestamp("calculated_at"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),
    lockedAt: timestamp("locked_at"),
    paidBy: uuid("paid_by").references(() => users.id, { onDelete: "set null" }),
    paidAt: timestamp("paid_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    numberUniq: uniqueIndex("payroll_runs_company_number_uniq").on(t.companyId, t.runNumber).where(sql`run_number is not null`),
    statusIdx: index("payroll_runs_company_status_idx").on(t.companyId, t.status, t.periodStart),
  })
);

// One line per employee per run — the immutable snapshot + the payslip source.
export const payrollItems = pgTable(
  "payroll_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .references(() => payrollRuns.id, { onDelete: "cascade" })
      .notNull(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    structureId: uuid("structure_id").references(() => payrollStructures.id, { onDelete: "set null" }),
    basicCents: bigint("basic_cents", { mode: "number" }).notNull().default(0),
    allowancesCents: bigint("allowances_cents", { mode: "number" }).notNull().default(0),
    incentivesCents: bigint("incentives_cents", { mode: "number" }).notNull().default(0),
    overtimeCents: bigint("overtime_cents", { mode: "number" }).notNull().default(0),
    grossCents: bigint("gross_cents", { mode: "number" }).notNull().default(0),
    deductionsCents: bigint("deductions_cents", { mode: "number" }).notNull().default(0),
    leaveAdjustmentCents: bigint("leave_adjustment_cents", { mode: "number" }).notNull().default(0), // unpaid-leave/absence deduction
    taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0), // placeholder — always 0 this phase
    netCents: bigint("net_cents", { mode: "number" }).notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    // Snapshot of the attendance summary the calc consumed (working/worked/
    // late/leave/absent days + shift history) — the payslip's attendance block.
    attendance: jsonb("attendance"),
    // Full component breakdown: { earnings: [...], deductions: [...] } — the
    // payslip line items, frozen at calculation time.
    breakdown: jsonb("breakdown"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    runUserUniq: uniqueIndex("payroll_items_run_user_uniq").on(t.runId, t.userId),
    userIdx: index("payroll_items_company_user_idx").on(t.companyId, t.userId),
    runIdx: index("payroll_items_run_idx").on(t.runId),
  })
);

// ---------------------------------------------------------------------------
// Phase 22 — HR Core & Employee Management. THE master employee directory.
//
// SINGLE IDENTITY, NO DUPLICATION: an hr_employees row is a 1:1 EXTENSION of an
// existing `users` row (userId is unique). The login identity — name, email,
// phone — stays on `users` (its single source); HR owns the HR-specific fields
// (structured name, DOB, department, designation, manager, employment type,
// documents, …). Because Attendance and Payroll already key on userId, they
// already reference THE SAME employee identity this module makes authoritative —
// no employee data is duplicated across the three contexts, and no attendance/
// payroll table changes to "point at HR". HR simply enriches the shared userId.
// ---------------------------------------------------------------------------

// Departments — hierarchy-ready via a self parent, with an optional manager.
export const hrDepartments = pgTable(
  "hr_departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    code: varchar("code", { length: 30 }).notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => hrDepartments.id, { onDelete: "set null" }),
    managerUserId: uuid("manager_user_id").references(() => users.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    codeUniq: uniqueIndex("hr_departments_company_code_uniq").on(t.companyId, t.code),
    companyIdx: index("hr_departments_company_idx").on(t.companyId, t.active),
  })
);

// Designations (job titles) — optionally scoped to a department, with a numeric
// hierarchy level (lower = more senior) for future org modeling.
export const hrDesignations = pgTable(
  "hr_designations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    code: varchar("code", { length: 30 }).notNull(),
    departmentId: uuid("department_id").references(() => hrDepartments.id, { onDelete: "set null" }),
    level: integer("level").notNull().default(5),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    codeUniq: uniqueIndex("hr_designations_company_code_uniq").on(t.companyId, t.code),
    companyIdx: index("hr_designations_company_idx").on(t.companyId, t.active),
  })
);

// Employment types. Five are seeded per company (isSystem, non-deletable);
// companies add their own custom types.
export const hrEmploymentTypes = pgTable(
  "hr_employment_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 60 }).notNull(),
    code: varchar("code", { length: 30 }).notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    codeUniq: uniqueIndex("hr_employment_types_company_code_uniq").on(t.companyId, t.code),
  })
);

// The employee master — one authoritative HR profile per user.
export const hrEmployees = pgTable(
  "hr_employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    // 1:1 with the login identity. Unique per company — a user has at most one
    // HR profile; email/phone/login-name are read through from `users`.
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    employeeCode: varchar("employee_code", { length: 40 }).notNull(),
    firstName: varchar("first_name", { length: 80 }).notNull(),
    lastName: varchar("last_name", { length: 80 }),
    preferredName: varchar("preferred_name", { length: 80 }),
    dateOfBirth: date("date_of_birth"),
    gender: varchar("gender", { length: 20 }), // placeholder — no downstream logic
    joiningDate: date("joining_date"),
    confirmationDate: date("confirmation_date"), // placeholder
    // active | probation | on_notice | inactive | terminated
    employmentStatus: varchar("employment_status", { length: 20 }).notNull().default("active"),
    departmentId: uuid("department_id").references(() => hrDepartments.id, { onDelete: "set null" }),
    designationId: uuid("designation_id").references(() => hrDesignations.id, { onDelete: "set null" }),
    employmentTypeId: uuid("employment_type_id").references(() => hrEmploymentTypes.id, { onDelete: "set null" }),
    // The reporting manager, referenced by user identity (employees ARE users),
    // which is what powers the org chart.
    managerUserId: uuid("manager_user_id").references(() => users.id, { onDelete: "set null" }),
    workLocation: varchar("work_location", { length: 120 }), // placeholder
    emergencyContact: jsonb("emergency_contact"), // placeholder — { name, phone, relation }
    profilePhotoUrl: varchar("profile_photo_url", { length: 500 }), // placeholder — no upload
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userUniq: uniqueIndex("hr_employees_company_user_uniq").on(t.companyId, t.userId),
    codeUniq: uniqueIndex("hr_employees_company_code_uniq").on(t.companyId, t.employeeCode),
    statusIdx: index("hr_employees_company_status_idx").on(t.companyId, t.employmentStatus),
    deptIdx: index("hr_employees_company_dept_idx").on(t.companyId, t.departmentId),
    managerIdx: index("hr_employees_manager_idx").on(t.managerUserId),
  })
);

// Employee documents — ARCHITECTURE ONLY. Metadata rows (type + title + an
// external reference placeholder); no file bytes, no OCR, no e-signatures.
export const hrDocuments = pgTable(
  "hr_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    employeeId: uuid("employee_id")
      .references(() => hrEmployees.id, { onDelete: "cascade" })
      .notNull(),
    // offer_letter | employment_contract | id_document | certificate | other
    type: varchar("type", { length: 30 }).notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    reference: varchar("reference", { length: 500 }), // placeholder — external URL/ref, no storage
    notes: text("notes"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    employeeIdx: index("hr_documents_employee_idx").on(t.employeeId),
  })
);

export const hrSettings = pgTable("hr_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  employeeCodePrefix: varchar("employee_code_prefix", { length: 12 }).notNull().default("EMP"),
  nextEmployeeNumber: integer("next_employee_number").notNull().default(1),
  defaultEmploymentTypeId: uuid("default_employment_type_id").references(() => hrEmploymentTypes.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 23 — Workflow Automation Engine. The automation layer every module can
// trigger (HubSpot/Salesforce-Flow style). A workflow = a registered TRIGGER +
// a nested CONDITION tree + an ordered list of ACTIONS. Trigger and action
// *types* are code-side registries (extensible without schema change); these
// tables store the per-company DEFINITIONS and the high-volume EXECUTION trail.
// Status fields are validated in the service layer (no pg enums), matching the
// HR/Finance convention, so adding a status never needs an enum-alter migration.
// ─────────────────────────────────────────────────────────────────────────────

// A workflow definition. status: draft | published | disabled | archived —
// only `published` workflows fire on their trigger. `version` is the current
// published version (snapshots live in workflow_versions).
export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 20 }).notNull().default("draft"),
    version: integer("version").notNull().default(1),
    // A registered trigger key (e.g. "lead.created"). The engine never hard-codes
    // trigger types — future modules register them (see lib/workflow/triggers).
    triggerType: varchar("trigger_type", { length: 60 }).notNull(),
    triggerConfig: jsonb("trigger_config"), // schedule cron / webhook token / filters
    // Root condition group: { logic: "and"|"or", conditions: [Condition|Group] }.
    conditions: jsonb("conditions"),
    // { maxRetries, backoffSeconds } — falls back to company settings when null.
    retryConfig: jsonb("retry_config"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    lastExecutedAt: timestamp("last_executed_at"),
    // Denormalized run counter — cheap dashboards without scanning executions.
    executionCount: integer("execution_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // The emit hot path: published workflows for a (company, triggerType).
    triggerIdx: index("workflows_company_trigger_idx").on(t.companyId, t.triggerType),
    statusIdx: index("workflows_company_status_idx").on(t.companyId, t.status),
  })
);

// The ordered ACTION steps of a workflow (normalized, not a jsonb blob, so the
// builder can address individual steps). actionType is a registered action key.
export const workflowActions = pgTable(
  "workflow_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    workflowId: uuid("workflow_id")
      .references(() => workflows.id, { onDelete: "cascade" })
      .notNull(),
    position: integer("position").notNull(),
    actionType: varchar("action_type", { length: 60 }).notNull(),
    config: jsonb("config"),
    // If this step fails, keep going instead of failing the whole execution.
    continueOnError: boolean("continue_on_error").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    workflowIdx: index("workflow_actions_workflow_idx").on(t.workflowId, t.position),
  })
);

// Immutable version snapshots — the "Version History" surface. Each publish
// writes the full definition (trigger + conditions + actions) here.
export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    workflowId: uuid("workflow_id")
      .references(() => workflows.id, { onDelete: "cascade" })
      .notNull(),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    note: varchar("note", { length: 200 }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    versionUniq: uniqueIndex("workflow_versions_workflow_version_uniq").on(t.workflowId, t.version),
  })
);

// User-defined variables. scope: global (company-wide, workflowId NULL) or
// workflow (scoped to one workflow). The module-provided namespaces
// (lead.*, employee.*, payroll.*, …) are NOT stored — they arrive on the
// trigger payload and are resolved at execution time (see lib/workflow/variables).
export const workflowVariables = pgTable(
  "workflow_variables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    workflowId: uuid("workflow_id").references(() => workflows.id, { onDelete: "cascade" }),
    scope: varchar("scope", { length: 20 }).notNull().default("global"),
    key: varchar("key", { length: 80 }).notNull(),
    valueType: varchar("value_type", { length: 20 }).notNull().default("string"),
    value: jsonb("value"),
    description: varchar("description", { length: 200 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // Global keys unique per company; workflow keys unique per workflow. Two
    // partial unique indexes because a nullable workflowId can't do both in one.
    globalUniq: uniqueIndex("workflow_variables_global_uniq").on(t.companyId, t.key).where(sql`${t.workflowId} is null`),
    workflowUniq: uniqueIndex("workflow_variables_workflow_uniq").on(t.workflowId, t.key).where(sql`${t.workflowId} is not null`),
  })
);

// The execution trail — designed for millions of rows. One row per run.
// status: pending | running | success | failed | retrying | dead_letter |
// skipped | waiting. Retry sweeper finds (status='failed', nextRetryAt<=now).
export const workflowExecutions = pgTable(
  "workflow_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    workflowId: uuid("workflow_id")
      .references(() => workflows.id, { onDelete: "cascade" })
      .notNull(),
    workflowVersion: integer("workflow_version").notNull().default(1),
    triggerType: varchar("trigger_type", { length: 60 }).notNull(),
    // event | manual | scheduled | webhook | retry
    triggerSource: varchar("trigger_source", { length: 20 }).notNull().default("event"),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    input: jsonb("input"), // the trigger payload
    context: jsonb("context"), // resolved variable snapshot (optional)
    conditionResult: jsonb("condition_result"), // { matched, detail }
    attempts: integer("attempts").notNull().default(0),
    maxRetries: integer("max_retries").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at"),
    error: text("error"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    durationMs: integer("duration_ms"),
    triggeredBy: uuid("triggered_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    historyIdx: index("workflow_executions_company_workflow_idx").on(t.companyId, t.workflowId, t.createdAt),
    statusIdx: index("workflow_executions_company_status_idx").on(t.companyId, t.status),
    // The retry sweeper: due failed executions across all companies.
    retryIdx: index("workflow_executions_retry_idx").on(t.status, t.nextRetryAt),
  })
);

// Per-action log lines inside an execution (the "Logs" of a run). The highest-
// volume table; always read by (executionId, position).
export const workflowExecutionLogs = pgTable(
  "workflow_execution_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    executionId: uuid("execution_id")
      .references(() => workflowExecutions.id, { onDelete: "cascade" })
      .notNull(),
    position: integer("position").notNull(),
    actionType: varchar("action_type", { length: 60 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(), // success | failed | skipped
    input: jsonb("input"),
    output: jsonb("output"),
    message: text("message"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    executionIdx: index("workflow_execution_logs_execution_idx").on(t.executionId, t.position),
  })
);

// Per-company module settings — default retry policy + retention (placeholder).
export const workflowSettings = pgTable("workflow_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .references(() => companies.id, { onDelete: "cascade" })
    .notNull()
    .unique(),
  defaultMaxRetries: integer("default_max_retries").notNull().default(3),
  defaultBackoffSeconds: integer("default_backoff_seconds").notNull().default(30),
  executionRetentionDays: integer("execution_retention_days").notNull().default(90),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
