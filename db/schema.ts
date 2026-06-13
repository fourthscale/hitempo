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

/**
 * Whether a contact is a real named person or a generic channel
 * (info@hotel.fr, switchboard number) where no person is known yet.
 * Generic contacts have nullable first/last names but must carry at
 * least one channel (email or phone) — enforced by a CHECK constraint
 * in the migration + Zod at the action layer.
 */
export const contactKind = pgEnum("contact_kind", [
  "person", "generic",
]);

export const interactionType = pgEnum("interaction_type", [
  "first_contact", "follow_up", "call", "visit", "linkedin",
  "meeting", "demo", "proposal_sent", "note", "email_received",
]);

export const interactionChannel = pgEnum("interaction_channel", [
  "email", "linkedin", "phone", "in_person", "video", "other",
]);

export const interactionOutcome = pgEnum("interaction_outcome", [
  "no_response", "positive_reply", "negative_reply", "out_of_office",
  "wrong_contact", "rdv_scheduled", "opted_out",
]);

/**
 * Lifecycle stage of an interaction. Independent of `outcome` (which
 * qualifies the content of the exchange — positive/negative/rdv/etc).
 *
 *   - `sent`       : outbound emitted, no follow-up yet (default for outbound)
 *   - `responded`  : a reply / answer was received (auto-flipped by the
 *                    Gmail poller for emails ; manual for other channels)
 *   - `no_answer`  : call attempted, no one picked up
 *   - `done`       : completed event (visit performed, call connected, etc.)
 */
export const interactionStatus = pgEnum("interaction_status", [
  "sent", "responded", "no_answer", "done",
]);

export const taskType = pgEnum("task_type", [
  // Sprint 14 — dropped `follow_up`. It was an *intent* ("relance"), not
  // a channel : "follow up on what" required the channel to be set too.
  // The relance information now lives on the AI generation side (the
  // `message_intent` enum has `follow_up`, which is the right place :
  // it's an instruction to the LLM, not a task channel).
  "email", "linkedin", "phone", "visit", "research", "other",
]);

export const taskStatus = pgEnum("task_status", [
  "pending", "in_progress", "completed", "cancelled", "snoozed",
]);

/**
 * Sprint 12 phase 4 — agent auto-execution lifecycle for a task created by a
 * step whose assignment.actor is "agent". Null on every non-agent task.
 *   - `pending`   : created, awaiting auto-execution (Inngest may sleepUntil
 *                   scheduled_for before firing).
 *   - `succeeded` : the agent sent + persisted + completed the task.
 *   - `failed`    : auto-execution tripped (no Gmail, LLM error, etc.). The
 *                   task stays pending and the human assignee picks it up,
 *                   sees `auto_execution_error` in the UI.
 */
export const taskAutoExecutionStatus = pgEnum("task_auto_execution_status", [
  "pending", "succeeded", "failed",
]);

/**
 * Sprint 14 — credential lifecycle for a user's connected mail OAuth
 * (renamed from gmail_credential_status in sprint 16, same shape — the
 * enum is provider-agnostic).
 *
 *   - `active`  : refresh + send work nominally. Default after `upsert`.
 *   - `revoked` : the refresh token died (provider returned
 *                 `invalid_grant`), OR the user revoked access in their
 *                 Google/Microsoft account, OR a provider-side window
 *                 expired (Google Testing 7-day, Outlook 90-day
 *                 inactivity). The UI surfaces this as "Reconnect
 *                 Gmail" / "Reconnect Outlook" ; on reconnect the OAuth
 *                 callback replays the mail_auth-failed agent tasks for
 *                 this user.
 */
export const mailCredentialStatus = pgEnum("mail_credential_status", [
  "active", "revoked",
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

// ---------------------------------------------------------------------------
// Sequences (sprint 11). See docs/features/11-sequences-phase-a.md.
// Enums are designed graph-native + forward-compatible : Phase B/C add new
// action types via `ALTER TYPE ... ADD VALUE` (O(1), no row migration).
// ---------------------------------------------------------------------------

export const sequenceStatus = pgEnum("sequence_status", [
  "active", "paused",
  "completed_exhausted", "completed_success", "completed_cascaded",
  "stopped_opted_out", "stopped_manual",
]);

export const sequenceStepActionType = pgEnum("sequence_step_action_type", [
  // Legacy Phase-A names (kept in the DB enum so values are never dropped ;
  // no longer produced by the editor or templates).
  "create_task_manual",
  "create_task_with_ai_draft",
  "wait_delay",
  "enroll_in_sequence",
  "end_success",
  // Active taxonomy (Klaviyo-style palette : Messages / Field / Data / Logic).
  "send_email",
  "phone_call",
  "send_linkedin", // palette "later", executor registered for forward-compat
  "update_contact",
  "conditional_split",
  "conditional_switch",
  "merge", // structural passthrough join node (branches converge)
]);

export const sequenceStepDelayUnit = pgEnum("sequence_step_delay_unit", [
  "minutes", "hours", "days",
]);

/**
 * How contacts get into a sequence.
 *  - 'manual' : a user enrols a contact by hand from the contact's page.
 * Extension points (later): 'signal' (auto-enrol on a Lemlist-style signal),
 * 'score_threshold', 'rule', etc.
 */
export const sequenceTriggerKind = pgEnum("sequence_trigger_kind", [
  "manual",
]);

export const sequenceEndReason = pgEnum("sequence_end_reason", [
  "exhausted", "success", "cascaded", "opted_out", "manual",
  "safety_loop_cap_reached",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  plan: organizationPlan("plan").notNull().default("trial"),
  defaultLocale: text("default_locale").notNull().default("fr"),
  supportedLocales: text("supported_locales").array().notNull().default(sql`ARRAY['fr', 'en']`),
  /** IANA TZ, fallback root for the timezone cascade (member → org). */
  timezone: text("timezone").notNull().default("Europe/Paris"),
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
  /**
   * Work pattern (WorkPattern from lib/sequences/work-pattern.ts) : the
   * windows during which the sale is reachable for tasks. Null → defaults
   * to Mon-Fri 9-12 + 14-17 applied at use site (DEFAULT_WORK_PATTERN).
   */
  workPattern: jsonb("work_pattern"),
  /** Per-day quota for sequence-driven email tasks. */
  maxEmailsPerDay: integer("max_emails_per_day").notNull().default(25),
  /** Per-day quota for sequence-driven phone-call tasks. */
  maxCallsPerDay: integer("max_calls_per_day").notNull().default(10),
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
    /** Contact-cascade TZ fallback (after contact / site, before org). */
    timezone: text("timezone"),
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
    /** Contact-cascade TZ fallback (after contact, before company). */
    timezone: text("timezone"),

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

    // kind = 'person' (default) requires first+last name ; kind = 'generic'
    // allows null names but requires at least one channel. Enforced by the
    // contacts_kind_consistency CHECK constraint in the migration.
    kind: contactKind("kind").notNull().default("person"),

    // Nullable since sprint 10.8 : generic contacts (info@…) carry no name.
    firstName: text("first_name"),
    lastName: text("last_name"),
    // fullName is added as a STORED generated column in the migration SQL
    // (Drizzle's generated-columns DSL is not 100% reliable across versions).
    // For generic contacts (null names) full_name is NULL — callers use
    // resolveContactDisplayName() instead, never full_name directly.
    jobTitle: text("job_title"),
    role: contactRole("role"),

    email: text("email"),
    emailValidated: boolean("email_validated").default(false),
    phone: text("phone"),
    linkedinUrl: text("linkedin_url"),

    preferredLanguage: text("preferred_language").notNull().default("fr"),
    preferredChannel: text("preferred_channel"),
    /** Contact-cascade TZ root (most specific). */
    timezone: text("timezone"),

    relevance: integer("relevance"),

    status: text("status").notNull().default("to_contact"),
    // Optional owner override. Defaults (null) to the company owner —
    // see companies.ownerId. Soft reference (no FK to auth.users).
    ownerId: uuid("owner_id"),
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
    /** Lifecycle status (sent / responded / no_answer / done). Independent
     *  of outcome. Default null = legacy rows ; new outbound rows default
     *  to "sent" via the action layer. */
    status: interactionStatus("status"),

    subject: text("subject"),
    summary: text("summary"),

    interestLevel: integer("interest_level"),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    userId: uuid("user_id"),

    taskId: uuid("task_id"),

    sequenceRunId: uuid("sequence_run_id"),
    messageId: uuid("message_id"),

    metadata: jsonb("metadata").default({}),

    /**
     * Sprint 11.5 / Slice B : LLM intent classification of inbound replies.
     * Populated by the `interactions/classify` Inngest handler. Kept as raw
     * `text` (not an enum) so the classifier can return forward-compatible
     * labels without a schema migration ; the application layer validates
     * against `INTENT_LABELS` before applying any side-effect (outcome auto
     * promotion). `null` = not yet classified.
     *
     * confidence is in [0, 1] (numeric(4, 3) — 1.000 max).
     * processedAt non-null marks the row as already attempted (idempotency).
     */
    aiIntentLabel: text("ai_intent_label"),
    aiIntentConfidence: numeric("ai_intent_confidence", { precision: 4, scale: 3 }),
    aiIntentReasoning: text("ai_intent_reasoning"),
    aiProcessedAt: timestamp("ai_processed_at", { withTimezone: true }),

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
    /** True : the UI hides the hour of `due_at` (whole-day deadline). */
    dueAtAllDay: boolean("due_at_all_day").notNull().default(false),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    /** Effective slot duration ; defaulted from the step's scheduling. */
    estimatedDurationMinutes: integer("estimated_duration_minutes"),

    assigneeId: uuid("assignee_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by"),

    // Sprint 11 : the existing `sequence_run_id` placeholder column is now
    // the FK back to the sequence_enrolments row that generated this task.
    // Kept the column name (additive — no migration on tasks) but exposed
    // under a clearer property. Nullable : most tasks aren't sequence-driven.
    sequenceEnrolmentId: uuid("sequence_run_id"),
    messageId: uuid("message_id"),

    // Sprint 12 phase 4 — agent auto-execution flow. Null on tasks meant for
    // a human ; one of pending|succeeded|failed when the source step's
    // `assignment.actor` was "agent". The Inngest handler bumps this and
    // optionally writes `auto_execution_error` + `auto_execution_at`.
    autoExecutionStatus: taskAutoExecutionStatus("auto_execution_status"),
    autoExecutionError: text("auto_execution_error"),
    autoExecutionAt: timestamp("auto_execution_at", { withTimezone: true }),
    /**
     * Sprint 14 — failure classification when `auto_execution_status = 'failed'`.
     *
     * Kept as free-text (not pgEnum) so we can add new kinds without a
     * schema migration. Today :
     *   - `gmail_auth` : refresh token revoked / no creds. The OAuth
     *     callback bulk-replays these on next reconnect.
     *   - `other`      : any other failure (LLM, network, malformed step,
     *     race condition). Retry requires user intervention.
     *   - NULL when not failed (or when failed before this column shipped).
     */
    autoExecutionFailureKind: text("auto_execution_failure_kind"),

    // Sprint 15 — email threading context resolved at task creation by the
    // sequence engine. Filled when the source `send_email` step's
    // `threadingMode` asks to reply to a previous thread ; all three stay
    // null for fresh-thread sends and non-email tasks. The send-side path
    // (agent executor + manual dialogs) reads these and passes them to the
    // Mail API (Gmail/Outlook) + MIME builder — no sequence knowledge
    // needed downstream. `subject` mirrors the thread's reference subject
    // so the send picks it up with "Re: " prefix without an extra join on
    // messages.
    //
    // Sprint 16 — column renamed from `gmail_thread_id` /
    // `gmail_reply_to_message_id` to `mail_thread_id` /
    // `mail_reply_to_message_id` as part of the provider unification
    // (the value is the Gmail threadId for Gmail users, Outlook
    // conversationId for Outlook users — same role, both providers).
    mailThreadId: text("mail_thread_id"),
    mailReplyToMessageId: text("mail_reply_to_message_id"),
    subject: text("subject"),
    // Sprint 15 — full RFC 5322 References chain (space-separated message-ids
    // with angle brackets, oldest → newest, INCLUDING the parent at the end).
    // NULL on fresh-thread sends and non-email tasks. The send-side path emits
    // this verbatim in the `References:` header ; without it Gmail/Outlook may
    // not splice the message into the original conversation when there are 2+
    // hops in the thread.
    mailReferences: text("mail_references"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byAssigneeDue: index("idx_tasks_assignee_due").on(t.assigneeId, t.dueAt),
    byOrgStatus:   index("idx_tasks_org_status").on(t.organizationId, t.status),
    byCompany:     index("idx_tasks_company").on(t.companyId),
    bySequenceEnrolment: index("idx_tasks_sequence_enrolment").on(t.sequenceEnrolmentId),
    // Lookup index for the agent Inngest handler — finds the pending agent
    // tasks fast when the timer wakes up.
    byAutoExecStatus: index("idx_tasks_auto_exec_status").on(t.autoExecutionStatus),
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
    // Sprint 12 phase 3 — nullable. AI-generated messages link to their
    // `llm_usage` audit row ; messages rendered from a `defined`-mode
    // sequence step have no LLM call and write NULL here.
    llmUsageId: uuid("llm_usage_id").references(() => llmUsage.id, {
      onDelete: "restrict",
    }),

    status: messageStatus("status").notNull().default("draft"),

    // Mail send + reply tracking (sprint 10, renamed sprint 16).
    // sentAt set when status flips to 'sent'. mail_thread_id /
    // mail_message_id captured from the provider's send response
    // (Gmail threadId/Message-ID, Outlook conversationId/internetMessageId).
    // reply_received_at flipped by the polling job (Slice C).
    // last_polled_at drives the partial index used to keep the polling
    // query cheap.
    sentAt:            timestamp("sent_at",            { withTimezone: true }),
    mailThreadId:      text("mail_thread_id"),
    mailMessageId:     text("mail_message_id"),
    replyReceivedAt:   timestamp("reply_received_at",  { withTimezone: true }),
    lastPolledAt:      timestamp("last_polled_at",     { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byContact: index("idx_messages_contact").on(t.contactId, t.createdAt),
    byCompany: index("idx_messages_company").on(t.companyId, t.createdAt),
    byOrg:     index("idx_messages_org").on(t.organizationId, t.createdAt),
    // Partial index keeps the reply-polling scan cheap : only sent
    // messages with a mail_thread_id and no reply yet are candidates.
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
  sequenceEnrolment: one(sequenceEnrolments, {
    fields: [tasks.sequenceEnrolmentId],
    references: [sequenceEnrolments.id],
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

export const messagesRelations = relations(messages, ({ one, many }) => ({
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
  attachments: many(messageAttachments),
}));

/**
 * Files attached to outbound messages — PDF devis / présentations the rep
 * adds to a Gmail send. One message can carry multiple attachments.
 *
 * Files live in the private Supabase Storage bucket `message-attachments`
 * under the path `{organization_id}/{message_id}/{uuid}-{filename}`. We
 * keep both `storage_bucket` and `storage_path` so the bucket name is not
 * hardcoded in code and can be migrated later if needed.
 *
 * Lifecycle : created on Send via Gmail (action-level transaction), deleted
 * if the Gmail call fails (garbage collection). Bytes are NOT stored in the
 * DB — only the metadata pointer.
 */
export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    storageBucket: text("storage_bucket").notNull().default("message-attachments"),
    storagePath: text("storage_path").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedBy: uuid("uploaded_by").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byMessage: index("idx_message_attachments_message").on(t.messageId),
    byOrg: index("idx_message_attachments_org").on(t.organizationId, t.uploadedAt),
  }),
);

export const messageAttachmentsRelations = relations(messageAttachments, ({ one }) => ({
  organization: one(organizations, {
    fields: [messageAttachments.organizationId],
    references: [organizations.id],
  }),
  message: one(messages, {
    fields: [messageAttachments.messageId],
    references: [messages.id],
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
 * Mail OAuth credentials — one row per user (the mailbox is global to a
 * person, not org-scoped). organizationId tracks where they connected
 * from, for audit. Tokens are AES-256-GCM-encrypted at rest with a
 * server-side key.
 *
 * Sprint 16 — formerly `user_gmail_credentials`. Renamed during the
 * provider unification ; `provider` column now distinguishes 'gmail'
 * from 'outlook' (a DB-level CHECK constraint pins the allowed values).
 * Per-user uniqueness is preserved via the `userId` primary key — a
 * user can only have ONE connected mailbox at a time. Switching
 * provider replaces the row.
 *
 * See docs/features/{10-gmail-integration,16-outlook-integration}.md.
 */
export const userMailCredentials = pgTable("user_mail_credentials", {
  userId: uuid("user_id").primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** 'gmail' | 'outlook'. CHECK constraint enforces at the DB layer. */
  provider: text("provider").notNull(),
  /** The user's email address on the connected provider — Gmail address
   *  for Gmail users, Outlook address (or whatever they signed in with
   *  on the Microsoft side) for Outlook users. */
  emailAddress: text("email_address").notNull(),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  scopes: text("scopes").array().notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  /** Sprint 14 — credential lifecycle. Default `active` ; the
   *  MailService flips this to `revoked` when a refresh fails with
   *  `invalid_grant`. */
  status: mailCredentialStatus("status").notNull().default("active"),
  /** When the credential was first observed dead. Cleared on reconnect
   *  (upsert resets status to `active` + this to NULL). */
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  /** Last refresh error payload (truncated). Surfaced verbatim on the
   *  profile page so the user understands what happened. */
  lastRefreshError: text("last_refresh_error"),
  /** Timestamp of the last refresh attempt (success or failure).
   *  Useful for "your last sync was X minutes ago" UI + debug. */
  lastRefreshAttemptAt: timestamp("last_refresh_attempt_at", { withTimezone: true }),
}, (t) => ({
  byOrg: index("idx_mail_creds_org").on(t.organizationId),
  byStatus: index("idx_mail_creds_status").on(t.status),
}));

// ===========================================================================
// Sequences (sprint 11). See docs/features/11-sequences-phase-a.md.
//
// Graph-native model : steps navigate via `next_step_ids` jsonb (not
// step_order), predicates (`condition`/`filter`) and `action_config` are
// polymorphic jsonb dispatched by typed Factories in lib/sequences. Phase A
// ships a limited set of action/predicate types ; B/C extend without schema
// change. The CHECK constraint + partial unique index are appended manually
// in the migration SQL (Drizzle DSL doesn't model them reliably).
// ===========================================================================

export const sequences = pgTable(
  "sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),

    /** How contacts enter this sequence. Phase A : only 'manual'. */
    triggerKind: sequenceTriggerKind("trigger_kind").notNull().default("manual"),

    // Targeting (eligibility) — empty array = no restriction on that axis.
    targetRelationshipTypes: text("target_relationship_types").array().notNull().default(sql`ARRAY[]::text[]`),
    targetSiteTypes:         text("target_site_types").array().notNull().default(sql`ARRAY[]::text[]`),
    targetContactRoles:      text("target_contact_roles").array().notNull().default(sql`ARRAY[]::text[]`),
    targetLocales:           text("target_locales").array().notNull().default(sql`ARRAY[]::text[]`),

    // Built-in exclusion guards.
    excludeIfCompanyHasActiveSequence: boolean("exclude_if_company_has_active_sequence").notNull().default(true),
    excludeIfCompanyRelationshipIn:    text("exclude_if_company_relationship_in").array().notNull().default(sql`ARRAY[]::text[]`),
    cooldownAfterCompletedDays:        integer("cooldown_after_completed_days"),

    // Draft + publish + lock cycle. The engine NEVER reads draftDefinition.
    draftDefinition: jsonb("draft_definition"),
    draftSavedAt:    timestamp("draft_saved_at", { withTimezone: true }),
    editingLockedBy: uuid("editing_locked_by"),
    editingLockedAt: timestamp("editing_locked_at", { withTimezone: true }),

    /**
     * Sprint 11.5 / Slice D — strategy when the engine reaches a branch
     * that needs a qualified reply outcome but the latest inbound reply
     * is still un-qualified (LLM confidence too low, sale not yet
     * confirmed). Plain text (not enum) so adding strategies later is a
     * pure code change. Validated in code against
     * `SEQUENCE_UNKNOWN_OUTCOME_STRATEGIES`.
     *
     *   - "park"             : default. Park the enrolment with next_due_at = NULL
     *                          until the outcome is set (manually or via classifier
     *                          auto-apply), at which point the
     *                          `sequences/outcome.qualified` event resumes the run.
     *   - "continue_default" : fall through to the default branch immediately,
     *                          treating "no outcome yet" as "no positive signal".
     */
    unknownOutcomeStrategy: text("unknown_outcome_strategy").notNull().default("park"),

    /**
     * Sprint 12 — scope of the interaction history the AI message generator
     * pulls into the prompt when the task that owns the message comes from
     * this sequence.
     *
     *   - "sequence" : only interactions linked to THIS enrolment (via
     *                  outbound message → task → sequenceEnrolmentId). Stops
     *                  the AI from "replying" to a parallel out-of-sequence
     *                  thread. Default.
     *   - "all"      : include every recent interaction on the company
     *                  (legacy pre-sprint-12 behavior). Use when the sale
     *                  wants the AI to acknowledge parallel exchanges.
     *
     * Per-step override lives on `sequence_steps.message_context_scope`.
     * The sale can also override per-message in the dialog at generation
     * time without persisting anything.
     */
    messageContextScope: text("message_context_scope").notNull().default("sequence"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    byOrgActive: index("idx_sequences_org_active").on(t.organizationId, t.isActive),
  }),
);

export const sequenceSteps = pgTable(
  "sequence_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sequenceId: uuid("sequence_id")
      .notNull()
      .references(() => sequences.id, { onDelete: "cascade" }),

    // Display hint only — the engine navigates via nextStepIds.
    stepOrder: integer("step_order").notNull(),

    actionType: sequenceStepActionType("action_type").notNull(),
    actionConfig: jsonb("action_config").notNull().default({}),

    // { "default": "<step-id>" } in Phase A (or null = terminal). Phase B
    // adds { "yes","no" } / { "cases","default" }.
    nextStepIds: jsonb("next_step_ids"),

    // Polymorphic predicates : { type, config? } or null (= always).
    condition: jsonb("condition"),
    filter:    jsonb("filter"),

    /**
     * Optional per-step override of the sequence-level
     * `unknown_outcome_strategy`. NULL = inherit. Only meaningful on
     * conditional_split / conditional_switch steps whose decision depends
     * on reply outcomes.
     */
    unknownOutcomeStrategy: text("unknown_outcome_strategy"),

    /**
     * Sprint 12 — per-step override of the sequence's `messageContextScope`.
     * NULL = inherit. Only meaningful on `send_email` / `send_linkedin`
     * steps in AI mode (the only ones that call the generator).
     */
    messageContextScope: text("message_context_scope"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bySequence: uniqueIndex("uniq_sequence_steps_order").on(t.sequenceId, t.stepOrder),
  }),
);

export const sequenceEnrolments = pgTable(
  "sequence_enrolments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sequenceId: uuid("sequence_id")
      .notNull()
      .references(() => sequences.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    assigneeId: uuid("assignee_id"),

    status: sequenceStatus("status").notNull().default("active"),

    // Soft reference (NO FK) by design : publish swaps the whole sequence_steps
    // set, regenerating ids. The engine resolves the live step from this id,
    // falling back to currentStepOrder, and ends the enrolment as
    // completed_exhausted when the cursor overshoots the new step count. A hard
    // FK would block the publish swap and contradict that model.
    currentStepId:    uuid("current_step_id").notNull(),
    currentStepOrder: integer("current_step_order").notNull(),
    // NULL means "indefinite wait" — set after a human-action step
    // (send_email / phone_call) so the cron sweep does not advance the
    // enrolment before the rep closes the task. The `sequences/task.completed`
    // event re-fires the engine when that happens, bypassing the cron entirely.
    nextDueAt:        timestamp("next_due_at", { withTimezone: true }),

    // Loop-safety + idempotence (see migration / brief).
    lastExecutionCounter: integer("last_execution_counter").notNull().default(0),
    maxExecutionCount:    integer("max_execution_count").notNull().default(200),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt:   timestamp("ended_at", { withTimezone: true }),
    endReason: sequenceEndReason("end_reason"),
  },
  (t) => ({
    byDue:      index("idx_seq_enrolments_due").on(t.organizationId, t.status, t.nextDueAt),
    byContact:  index("idx_seq_enrolments_contact").on(t.contactId, t.status),
    byCompany:  index("idx_seq_enrolments_company").on(t.companyId, t.status),
    // "Only one active/paused enrolment of the same sequence per contact" —
    // partial unique index appended in migration SQL via .where().
    uniqActive: uniqueIndex("uniq_seq_enrolments_active_per_contact")
      .on(t.sequenceId, t.contactId)
      .where(sql`status IN ('active', 'paused')`),
  }),
);

export const sequenceStepExecutions = pgTable(
  "sequence_step_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enrolmentId: uuid("enrolment_id")
      .notNull()
      .references(() => sequenceEnrolments.id, { onDelete: "cascade" }),
    // Soft reference (NO FK) : the audit trail must survive a publish swap that
    // deletes the step row it points to (see currentStepId note above).
    stepId:     uuid("step_id").notNull(),
    stepOrder:  integer("step_order").notNull(),
    actionType: sequenceStepActionType("action_type").notNull(),

    // Monotonic per-enrolment counter backing the idempotence UNIQUE.
    executionCounter: integer("execution_counter").notNull(),

    executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
    taskId:     uuid("task_id"),
    outcome:    text("outcome").notNull(), // 'executed' | 'skipped_filter' | 'skipped_condition'
    notes:      text("notes"),

    // Sprint 15 — email thread metadata captured AFTER the send completes
    // (Agent executor / manual dialog updates this row post-send). Lets the
    // next send_email step in the enrolment resolve "what thread are we in"
    // with one indexed lookup. Null on non-email executions and on email
    // steps that haven't sent yet (status pending).
    mailThreadId:  text("gmail_thread_id"),
    mailMessageId: text("gmail_message_id"),
    subject:        text("subject"),
  },
  (t) => ({
    byEnrolment: index("idx_seq_executions_enrolment").on(t.enrolmentId),
    uniqCounter: uniqueIndex("uniq_seq_executions_counter").on(t.enrolmentId, t.executionCounter),
    // Sprint 15 — partial index for the "find the latest thread in this
    // enrolment" lookup used at task creation by the threading resolver.
    byThread: index("idx_seq_executions_thread")
      .on(t.enrolmentId, t.executedAt)
      .where(sql`gmail_thread_id is not null`),
  }),
);

export const sequencesRelations = relations(sequences, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [sequences.organizationId],
    references: [organizations.id],
  }),
  steps: many(sequenceSteps),
  enrolments: many(sequenceEnrolments),
}));

export const sequenceStepsRelations = relations(sequenceSteps, ({ one }) => ({
  sequence: one(sequences, {
    fields: [sequenceSteps.sequenceId],
    references: [sequences.id],
  }),
}));

export const sequenceEnrolmentsRelations = relations(sequenceEnrolments, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [sequenceEnrolments.organizationId],
    references: [organizations.id],
  }),
  sequence: one(sequences, {
    fields: [sequenceEnrolments.sequenceId],
    references: [sequences.id],
  }),
  company: one(companies, {
    fields: [sequenceEnrolments.companyId],
    references: [companies.id],
  }),
  contact: one(contacts, {
    fields: [sequenceEnrolments.contactId],
    references: [contacts.id],
  }),
  currentStep: one(sequenceSteps, {
    fields: [sequenceEnrolments.currentStepId],
    references: [sequenceSteps.id],
  }),
  executions: many(sequenceStepExecutions),
}));

export const sequenceStepExecutionsRelations = relations(sequenceStepExecutions, ({ one }) => ({
  enrolment: one(sequenceEnrolments, {
    fields: [sequenceStepExecutions.enrolmentId],
    references: [sequenceEnrolments.id],
  }),
  step: one(sequenceSteps, {
    fields: [sequenceStepExecutions.stepId],
    references: [sequenceSteps.id],
  }),
}));
