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
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"), // soft delete
  },
  (t) => ({
    companyIdx: index("leads_company_idx").on(t.companyId),
    ownerIdx: index("leads_owner_idx").on(t.ownerId),
    createdIdx: index("leads_created_idx").on(t.createdAt),
    phoneIdx: index("leads_phone_idx").on(t.companyId, t.phone),
    emailIdx: index("leads_email_idx").on(t.companyId, t.email),
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
});

// ---------------------------------------------------------------------------
// Assignment log (audit trail for lead routing specifically)
// ---------------------------------------------------------------------------
export const assignmentLog = pgTable("assignment_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }).notNull(),
  assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
  ruleUsed: varchar("rule_used", { length: 100 }),
});

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
    companyIdx: index("audit_log_company_idx").on(t.companyId),
    entityIdx: index("audit_log_entity_idx").on(t.entityType, t.entityId),
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
