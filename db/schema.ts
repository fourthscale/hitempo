import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  pgEnum,
  uniqueIndex,
  index,
  integer,
  boolean,
  numeric,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type { BrandBrief } from "@/lib/brand/brand-brief";

export const organizationPlan = pgEnum("organization_plan", [
  "trial", "starter", "pro", "business",
]);

export const memberRole = pgEnum("member_role", [
  "owner", "admin", "commercial", "viewer",
]);

export const companyRelationshipType = pgEnum("company_relationship_type", [
  "prospect", "client", "former_client", "prescriber", "partner",
]);

export const siteType = pgEnum("site_type", [
  "office", "hotel", "showroom", "store", "restaurant", "warehouse", "other",
]);

export const contactRole = pgEnum("contact_role", [
  "decision_maker", "influencer", "user", "prescriber", "assistant", "other",
]);

export const interactionType = pgEnum("interaction_type", [
  "first_contact", "follow_up", "call", "visit", "linkedin",
  "meeting", "demo", "proposal_sent", "note",
]);

export const interactionChannel = pgEnum("interaction_channel", [
  "email", "linkedin", "phone", "in_person", "video", "other",
]);

export const interactionOutcome = pgEnum("interaction_outcome", [
  "no_response", "positive_reply", "negative_reply", "out_of_office",
  "wrong_contact", "rdv_scheduled", "opted_out",
]);

export const taskType = pgEnum("task_type", [
  "email", "linkedin", "phone", "visit", "follow_up", "research", "other",
]);

export const taskStatus = pgEnum("task_status", [
  "pending", "in_progress", "completed", "cancelled", "snoozed",
]);

export const taskPriority = pgEnum("task_priority", [
  "low", "medium", "high", "urgent",
]);

// --- Sprint 07 : AI message generation + generic LLM usage logging ---

export const llmUsageType = pgEnum("llm_usage_type", [
  "outbound_message",
  "brand_brief_generation",
  "interaction_summary",
  "company_enrichment",
  "signal_extraction",
  "other",
]);

export const llmUsageStatus = pgEnum("llm_usage_status", [
  "success", "error",
]);

export const messageStatus = pgEnum("message_status", [
  "draft", "copied", "discarded", "sent",
]);

export const messageChannel = pgEnum("message_channel", [
  "email", "linkedin",
]);

export const messageIntent = pgEnum("message_intent", [
  "first_contact", "follow_up", "meeting_request",
  "proposal_send", "reconnect", "other",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  plan: organizationPlan("plan").notNull().default("trial"),
  defaultLocale: text("default_locale").notNull().default("fr"),
  supportedLocales: text("supported_locales").array().notNull().default(sql`ARRAY['fr', 'en']`),
  brandBrief: jsonb("brand_brief").$type<BrandBrief>().default({}),
  settings: jsonb("settings").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const organizationMembers = pgTable("organization_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  role: memberRole("role").notNull().default("commercial"),
  preferredLocale: text("preferred_locale").notNull().default("fr"),
  timezone: text("timezone").notNull().default("Europe/Paris"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqMember: uniqueIndex("uniq_org_user").on(t.organizationId, t.userId),
  byUser: index("idx_org_members_user").on(t.userId),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  messages: many(messages),
  llmUsage: many(llmUsage),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
}));

/**
 * Platform admins — hitempo team members with cross-org read access.
 * See docs/architecture.md → "Platform admin pattern".
 * FK to auth.users(id) is added in raw SQL (cross-schema, Drizzle doesn't track).
 */
export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id").primaryKey(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  grantedBy: uuid("granted_by"),
  note: text("note"),
});

/**
 * Append-only audit log. Rows arrive via the log_platform_admin_write() trigger
 * for every cross-org INSERT/UPDATE/DELETE, plus best-effort app-side inserts
 * for SELECT events (Postgres has no SELECT trigger).
 */
// ============================================================================
// Business tables — sprint 04
// ============================================================================

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    // Identity
    name: text("name").notNull(),
    legalName: text("legal_name"),
    websiteUrl: text("website_url"),
    linkedinUrl: text("linkedin_url"),
    logoUrl: text("logo_url"),

    // Relationships
    parentId: uuid("parent_id"), // self-ref FK added via raw SQL in migration
    relationshipType: companyRelationshipType("relationship_type"),

    // Classification (segments/microZones tables come later — these stay nullable UUID without FK)
    segmentId: uuid("segment_id"),
    subSegment: text("sub_segment"),

    // Business attributes
    primaryLocale: text("primary_locale").notNull().default("fr"),
    sizeEstimate: text("size_estimate"),
    standing: integer("standing"),
    industry: text("industry"),

    // Scoring (sprint 06 will compute these)
    score: integer("score"),
    scoreBreakdown: jsonb("score_breakdown"),

    // Status + signal
    status: text("status").notNull().default("to_qualify"),
    signalType: text("signal_type"),
    signalSource: text("signal_source"),
    signalDetectedAt: timestamp("signal_detected_at", { withTimezone: true }),

    notes: text("notes"),
    ownerId: uuid("owner_id"),

    // Primary contact (one per company, optional). FK added in migration SQL
    // (cross-circular reference with contacts.companyId).
    primaryContactId: uuid("primary_contact_id"),

    // Org-scoped external reference for CSV imports + future integrations.
    // Optional. Unique per (organization_id, organisation_ref) when set —
    // null values do NOT collide (partial unique index, see below).
    organisationRef: text("organisation_ref"),

    // Soft delete
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byOrg: index("idx_companies_org").on(t.organizationId),
    byOrgScore: index("idx_companies_org_score").on(t.organizationId, t.score),
    byOrgStatus: index("idx_companies_org_status").on(t.organizationId, t.status),
    byParent: index("idx_companies_parent").on(t.parentId),
    bySegment: index("idx_companies_segment").on(t.segmentId),
    byOrgRef: uniqueIndex("uniq_companies_org_ref")
      .on(t.organizationId, t.organisationRef)
      .where(sql`organisation_ref IS NOT NULL`),
  }),
);

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    type: siteType("type").notNull().default("office"),

    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    postalCode: text("postal_code"),
    city: text("city"),
    region: text("region"),
    country: text("country").notNull().default("FR"),

    lat: numeric("lat", { precision: 10, scale: 7 }),
    lng: numeric("lng", { precision: 10, scale: 7 }),
    microZoneId: uuid("micro_zone_id"),

    isPrimary: boolean("is_primary").notNull().default(false),
    standing: integer("standing"),
    notes: text("notes"),

    // Primary contact for THIS site (max 1 per site, enforced by FK uniqueness — only one column reference).
    primaryContactId: uuid("primary_contact_id"),

    // Org-scoped external reference (see companies.organisationRef).
    organisationRef: text("organisation_ref"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCompany: index("idx_sites_company").on(t.companyId),
    byMicroZone: index("idx_sites_micro_zone").on(t.microZoneId),
    byOrg: index("idx_sites_org").on(t.organizationId),
    byOrgRef: uniqueIndex("uniq_sites_org_ref")
      .on(t.organizationId, t.organisationRef)
      .where(sql`organisation_ref IS NOT NULL`),
  }),
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),

    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    // fullName is added as a STORED generated column in the migration SQL
    // (Drizzle's generated-columns DSL is not 100% reliable across versions).
    jobTitle: text("job_title"),
    role: contactRole("role"),

    email: text("email"),
    emailValidated: boolean("email_validated").default(false),
    phone: text("phone"),
    linkedinUrl: text("linkedin_url"),

    preferredLanguage: text("preferred_language").notNull().default("fr"),
    preferredChannel: text("preferred_channel"),

    relevance: integer("relevance"),

    status: text("status").notNull().default("to_contact"),
    optedOut: boolean("opted_out").notNull().default(false),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    optedOutReason: text("opted_out_reason"),

    lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
    lastResponseAt: timestamp("last_response_at", { withTimezone: true }),

    notes: text("notes"),

    // Org-scoped external reference (see companies.organisationRef).
    organisationRef: text("organisation_ref"),

    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCompany: index("idx_contacts_company").on(t.companyId),
    bySite: index("idx_contacts_site").on(t.siteId),
    byOrg: index("idx_contacts_org").on(t.organizationId),
    byEmail: index("idx_contacts_email").on(t.organizationId, t.email),
    byOrgRef: uniqueIndex("uniq_contacts_org_ref")
      .on(t.organizationId, t.organisationRef)
      .where(sql`organisation_ref IS NOT NULL`),
  }),
);

export const interactions = pgTable(
  "interactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),

    type: interactionType("type").notNull(),
    channel: interactionChannel("channel").notNull(),
    outcome: interactionOutcome("outcome"),

    subject: text("subject"),
    summary: text("summary"),

    interestLevel: integer("interest_level"),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    userId: uuid("user_id"),

    taskId: uuid("task_id"),

    sequenceRunId: uuid("sequence_run_id"),
    messageId: uuid("message_id"),

    metadata: jsonb("metadata").default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCompany: index("idx_interactions_company").on(t.companyId, t.occurredAt),
    byContact: index("idx_interactions_contact").on(t.contactId, t.occurredAt),
    byOrg:     index("idx_interactions_org").on(t.organizationId, t.occurredAt),
    byTask:    index("idx_interactions_task").on(t.taskId),
  }),
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),

    type: taskType("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),

    status: taskStatus("status").notNull().default("pending"),
    priority: taskPriority("priority").notNull().default("medium"),

    dueAt: timestamp("due_at", { withTimezone: true }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),

    assigneeId: uuid("assignee_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by"),

    sequenceRunId: uuid("sequence_run_id"),
    messageId: uuid("message_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byAssigneeDue: index("idx_tasks_assignee_due").on(t.assigneeId, t.dueAt),
    byOrgStatus:   index("idx_tasks_org_status").on(t.organizationId, t.status),
    byCompany:     index("idx_tasks_company").on(t.companyId),
  }),
);

// --- Sprint 07 : llm_usage (generic LLM audit) + messages (outbound content) ---

/**
 * Generic audit log for every LLM call across the platform.
 * Sprint 07 produces `outbound_message` rows ; future features (brand brief
 * autogen, summarization, enrichment…) write their own `type` here.
 * The `messages` table FKs into this for outbound message provenance.
 */
export const llmUsage = pgTable(
  "llm_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id"), // null = background job

    type: llmUsageType("type").notNull(),

    provider: text("provider").notNull(),
    model: text("model").notNull(),
    tokensIn: integer("tokens_in").notNull(),
    tokensOut: integer("tokens_out").notNull(),
    costCents: integer("cost_cents").notNull().default(0),
    durationMs: integer("duration_ms"),

    relatedEntityType: text("related_entity_type"),
    relatedEntityId: uuid("related_entity_id"),

    status: llmUsageStatus("status").notNull().default("success"),
    errorCode: text("error_code"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byOrg:  index("idx_llm_usage_org").on(t.organizationId, t.createdAt),
    byType: index("idx_llm_usage_type").on(t.organizationId, t.type, t.createdAt),
    byUser: index("idx_llm_usage_user").on(t.userId, t.createdAt),
  }),
);

/**
 * Outbound messages — emails and LinkedIn DMs generated by hitempo's AI.
 * Provenance (provider/model/tokens/cost) lives in `llm_usage` via FK.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    userId: uuid("user_id").notNull(), // who triggered the generation

    channel: messageChannel("channel").notNull(),
    intent:  messageIntent("intent").notNull(),
    locale:  text("locale").notNull(), // "fr" | "en"

    orientation: text("orientation"), // optional user note used at generation time
    content:     text("content").notNull(), // final content after user edits if any

    // Single source of truth for provenance (provider/model/tokens/cost) — JOIN llm_usage when needed
    llmUsageId: uuid("llm_usage_id")
      .notNull()
      .references(() => llmUsage.id, { onDelete: "restrict" }),

    status: messageStatus("status").notNull().default("draft"),

    // Gmail send + reply tracking (sprint 10).
    // sentAt set when status flips to 'sent'. gmail_thread_id / gmail_message_id
    // captured from the Gmail API send response. reply_received_at flipped by
    // the polling job (Slice C). last_polled_at drives the partial index used
    // to keep the polling query cheap.
    sentAt:            timestamp("sent_at",            { withTimezone: true }),
    gmailThreadId:     text("gmail_thread_id"),
    gmailMessageId:    text("gmail_message_id"),
    replyReceivedAt:   timestamp("reply_received_at",  { withTimezone: true }),
    lastPolledAt:      timestamp("last_polled_at",     { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byContact: index("idx_messages_contact").on(t.contactId, t.createdAt),
    byCompany: index("idx_messages_company").on(t.companyId, t.createdAt),
    byOrg:     index("idx_messages_org").on(t.organizationId, t.createdAt),
    // Partial index keeps the reply-polling scan cheap: only sent messages with a Gmail
    // thread and no reply yet are candidates.
    pendingReply: index("idx_messages_pending_reply").on(t.lastPolledAt),
  }),
);

export const companiesRelations = relations(companies, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [companies.organizationId],
    references: [organizations.id],
  }),
  parent: one(companies, {
    fields: [companies.parentId],
    references: [companies.id],
    relationName: "company_hierarchy",
  }),
  children: many(companies, { relationName: "company_hierarchy" }),
  sites: many(sites),
  contacts: many(contacts),
  interactions: many(interactions),
  tasks: many(tasks),
  messages: many(messages),
}));

export const sitesRelations = relations(sites, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [sites.organizationId],
    references: [organizations.id],
  }),
  company: one(companies, {
    fields: [sites.companyId],
    references: [companies.id],
  }),
  contacts: many(contacts),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [contacts.organizationId],
    references: [organizations.id],
  }),
  company: one(companies, {
    fields: [contacts.companyId],
    references: [companies.id],
  }),
  site: one(sites, {
    fields: [contacts.siteId],
    references: [sites.id],
  }),
  interactions: many(interactions),
  tasks: many(tasks),
  messages: many(messages),
}));

export const interactionsRelations = relations(interactions, ({ one }) => ({
  organization: one(organizations, {
    fields: [interactions.organizationId],
    references: [organizations.id],
  }),
  company: one(companies, {
    fields: [interactions.companyId],
    references: [companies.id],
  }),
  contact: one(contacts, {
    fields: [interactions.contactId],
    references: [contacts.id],
  }),
  site: one(sites, {
    fields: [interactions.siteId],
    references: [sites.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [tasks.organizationId],
    references: [organizations.id],
  }),
  company: one(companies, {
    fields: [tasks.companyId],
    references: [companies.id],
  }),
  contact: one(contacts, {
    fields: [tasks.contactId],
    references: [contacts.id],
  }),
  site: one(sites, {
    fields: [tasks.siteId],
    references: [sites.id],
  }),
  messages: many(messages),
}));

export const llmUsageRelations = relations(llmUsage, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [llmUsage.organizationId],
    references: [organizations.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  organization: one(organizations, {
    fields: [messages.organizationId],
    references: [organizations.id],
  }),
  contact: one(contacts, {
    fields: [messages.contactId],
    references: [contacts.id],
  }),
  company: one(companies, {
    fields: [messages.companyId],
    references: [companies.id],
  }),
  task: one(tasks, {
    fields: [messages.taskId],
    references: [tasks.id],
  }),
  llmUsage: one(llmUsage, {
    fields: [messages.llmUsageId],
    references: [llmUsage.id],
  }),
}));

export const platformAdminAudit = pgTable(
  "platform_admin_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    tableName: text("table_name").notNull(),
    rowId: uuid("row_id"),
    operation: text("operation").notNull(), // 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'
    organizationId: uuid("organization_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("idx_platform_audit_user").on(t.userId, t.occurredAt),
    byOrg: index("idx_platform_audit_org").on(t.organizationId, t.occurredAt),
    byTable: index("idx_platform_audit_table").on(t.tableName, t.occurredAt),
  }),
);

/**
 * Gmail OAuth credentials — one row per user (Gmail is global to a person,
 * not org-scoped). organizationId tracks where they connected from, for audit.
 * Tokens are AES-256-GCM-encrypted at rest with a server-side key.
 *
 * See docs/features/10-gmail-integration.md for the full design.
 */
export const userGmailCredentials = pgTable("user_gmail_credentials", {
  userId: uuid("user_id").primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  gmailAddress: text("gmail_address").notNull(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  scopes: text("scopes").array().notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (t) => ({
  byOrg: index("idx_gmail_creds_org").on(t.organizationId),
}));
