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
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const roleEnum = pgEnum("role", ["super_admin", "admin", "agent"]);
export const tierEnum = pgEnum("tier", ["1", "2", "3"]);
export const companyStatusEnum = pgEnum("company_status", [
  "pending", // signed up, awaiting super-admin activation (manual billing phase)
  "active",
  "suspended",
]);
export const sourcePlatformEnum = pgEnum("source_platform", [
  "facebook",
  "google",
  "generic",
  "reddit",
  "other",
]);
export const webhookLogStatusEnum = pgEnum("webhook_log_status", ["success", "failed", "retried"]);

// ---------------------------------------------------------------------------
// Companies (tenants)
// ---------------------------------------------------------------------------
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  status: companyStatusEnum("status").notNull().default("pending"),
  plan: varchar("plan", { length: 100 }).notNull().default("starter"),
  pricePerAgentCents: integer("price_per_agent_cents").notNull().default(1900),
  customDomain: varchar("custom_domain", { length: 255 }),
  customDomainVerified: boolean("custom_domain_verified").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at"), // soft delete
});

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
export const presenceStatusEnum = pgEnum("presence_status", ["online", "idle", "busy", "break", "offline"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull().default("agent"),
    tier: tierEnum("tier").default("1"),
    active: boolean("active").notNull().default(true),
    presenceStatus: presenceStatusEnum("presence_status").notNull().default("offline"),
    lastHeartbeatAt: timestamp("last_heartbeat_at"),
    // Supervisor kill-switch: a locked agent is excluded from assignment
    // regardless of presence/workload, until a supervisor unlocks them
    // (see src/lib/supervisor.ts). Defaults false so no existing agent is
    // affected until a supervisor explicitly locks one.
    locked: boolean("locked").notNull().default(false),
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
// Lead sources (Facebook / Google / generic webhook connections)
// ---------------------------------------------------------------------------
export const leadSources = pgTable(
  "lead_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    platform: sourcePlatformEnum("platform").notNull().default("facebook"),
    pageId: varchar("page_id", { length: 255 }),
    pageName: varchar("page_name", { length: 255 }),
    accessToken: text("access_token"), // encrypted at rest, see lib/crypto.ts
    status: varchar("status", { length: 50 }).notNull().default("active"),
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
    payload: jsonb("payload"),
    error: text("error"),
    retryCount: integer("retry_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    sourceIdx: index("webhook_logs_source_idx").on(t.sourceId),
    companyIdx: index("webhook_logs_company_idx").on(t.companyId),
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
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .references(() => companies.id, { onDelete: "cascade" })
      .notNull(),
    sourceId: uuid("source_id").references(() => leadSources.id, { onDelete: "set null" }),
    name: varchar("name", { length: 255 }),
    phone: varchar("phone", { length: 50 }),
    email: varchar("email", { length: 255 }),
    state: varchar("state", { length: 100 }),
    disposition: varchar("disposition", { length: 100 }).notNull().default("New Lead"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    requiredSkillId: uuid("required_skill_id").references(() => skills.id, { onDelete: "set null" }),
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
export const assignmentModeEnum = pgEnum("assignment_mode", ["round_robin", "weighted", "skill_based"]);

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
  },
  (t) => ({
    leadIdx: index("assignment_log_lead_idx").on(t.leadId),
    assignedToIdx: index("assignment_log_assigned_to_idx").on(t.assignedTo),
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
  leads: many(leads),
  webhookLogs: many(webhookLogs),
}));

export const webhookLogsRelations = relations(webhookLogs, ({ one }) => ({
  source: one(leadSources, { fields: [webhookLogs.sourceId], references: [leadSources.id] }),
  company: one(companies, { fields: [webhookLogs.companyId], references: [companies.id] }),
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
