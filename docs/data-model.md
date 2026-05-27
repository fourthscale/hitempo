# Data Model — hitempo

The single source of truth for tables, columns, relations, indexes, and RLS policies. This document describes the **target schema**. Features 02-08 will build this incrementally; this doc is what we're converging towards.

## Conventions

- All `id` columns: `uuid` generated with `gen_random_uuid()`
- All tables have `created_at timestamptz NOT NULL DEFAULT now()` and `updated_at timestamptz NOT NULL DEFAULT now()`
- Soft delete via `deleted_at timestamptz NULL` only where it matters (companies, contacts). Hard delete elsewhere.
- Every business table has `organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE` + RLS policies
- Drizzle column naming: TypeScript `camelCase`, SQL `snake_case` via `pgTable("table_name", { columnName: text("column_name") })`
- Booleans default `false` explicitly, never `null`
- All enums in Postgres are `text` with a CHECK constraint OR Postgres enums via `pgEnum`. Prefer `pgEnum` for stability.

## Postgres enums (define once at top of schema.ts)

```typescript
import { pgEnum } from "drizzle-orm/pg-core";

export const organizationPlan = pgEnum("organization_plan", [
  "trial", "starter", "pro", "business"
]);

export const memberRole = pgEnum("member_role", [
  "owner", "admin", "commercial", "viewer"
]);

export const companyRelationshipType = pgEnum("company_relationship_type", [
  "parent", "subsidiary", "brand", "division", "partner"
]);

export const siteType = pgEnum("site_type", [
  "headquarters", "office", "store", "hotel", "coworking",
  "warehouse", "showroom", "atelier", "other"
]);

export const contactRole = pgEnum("contact_role", [
  "decision_maker", "influencer", "prescriber", "user", "gatekeeper"
]);

export const interactionType = pgEnum("interaction_type", [
  "first_contact", "follow_up", "call", "visit", "linkedin",
  "meeting", "demo", "proposal_sent", "note"
]);

export const interactionChannel = pgEnum("interaction_channel", [
  "email", "linkedin", "phone", "in_person", "video", "other"
]);

export const interactionOutcome = pgEnum("interaction_outcome", [
  "no_response", "positive_reply", "negative_reply", "out_of_office",
  "wrong_contact", "rdv_scheduled", "opted_out"
]);

export const taskType = pgEnum("task_type", [
  "email", "linkedin", "phone", "visit", "follow_up", "research", "other"
]);

export const taskStatus = pgEnum("task_status", [
  "pending", "in_progress", "completed", "cancelled", "snoozed"
]);

export const taskPriority = pgEnum("task_priority", [
  "low", "medium", "high", "urgent"
]);

export const messageDirection = pgEnum("message_direction", ["outbound", "inbound"]);

export const messageStatus = pgEnum("message_status", [
  "draft", "scheduled", "sent", "delivered", "opened", "clicked",
  "replied", "bounced", "failed"
]);

export const sequenceStatus = pgEnum("sequence_status", [
  "draft", "active", "paused", "archived"
]);

export const sequenceRunStatus = pgEnum("sequence_run_status", [
  "running", "paused", "completed", "exited"
]);

export const sequenceStepType = pgEnum("sequence_step_type", [
  "email", "linkedin_invite", "linkedin_message", "phone_call",
  "visit", "ai_message", "wait", "task"
]);

export const sequenceConditionType = pgEnum("sequence_condition_type", [
  "no_action", "opened", "clicked", "replied_positive", "replied_negative",
  "opted_out", "in_zone", "always", "after_days"
]);

export const opportunityStage = pgEnum("opportunity_stage", [
  "discovery", "qualification", "proposal", "negotiation", "won", "lost"
]);
```

---

## Tables

### 1. `organizations`

The tenant root. One organization per customer of hitempo.

```typescript
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  plan: organizationPlan("plan").notNull().default("trial"),
  defaultLocale: text("default_locale").notNull().default("fr"),
  supportedLocales: text("supported_locales").array().notNull().default(sql`ARRAY['fr', 'en']`),
  brandBrief: jsonb("brand_brief").$type<Record<string, string>>().default({}),
  settings: jsonb("settings").$type<OrgSettings>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`brand_brief` shape:
```json
{
  "fr": "L&G parle avec élégance...",
  "en": "L&G speaks with elegance..."
}
```

**RLS**: only org members can read; only org owners/admins can write.

### 2. `organization_members`

Links Supabase Auth `auth.users` to organizations with a role.

```typescript
export const organizationMembers = pgTable("organization_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(), // FK to auth.users (Supabase managed)
  role: memberRole("role").notNull().default("commercial"),
  preferredLocale: text("preferred_locale").notNull().default("fr"),
  timezone: text("timezone").notNull().default("Europe/Paris"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqMember: uniqueIndex("uniq_org_user").on(t.organizationId, t.userId),
  byUser: index("idx_org_members_user").on(t.userId),
}));
```

**RLS**: user can read their own memberships; owner/admin can manage org's members.

### 2bis. `platform_admins` + `platform_admin_audit` (cross-org access)

These two tables implement the platform admin pattern documented in `architecture.md` (section "Platform admin pattern"). `platform_admins` is the source of truth for who on the hitempo team can read across all orgs; `platform_admin_audit` is the append-only log of every cross-org access. **Implemented in sprint 03.**

```typescript
export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id").primaryKey().references(() => sql`auth.users(id)`, { onDelete: "cascade" }),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  grantedBy: uuid("granted_by"), // FK to auth.users — nullable for the initial bootstrap row
  note: text("note"),
});

export const platformAdminAudit = pgTable("platform_admin_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  tableName: text("table_name").notNull(),
  rowId: uuid("row_id"), // nullable: list reads don't always have a single row
  operation: text("operation").notNull(), // "SELECT" | "INSERT" | "UPDATE" | "DELETE"
  organizationId: uuid("organization_id"), // org the row belongs to (when applicable)
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byUser: index("idx_platform_audit_user").on(t.userId, t.occurredAt),
  byOrg: index("idx_platform_audit_org").on(t.organizationId, t.occurredAt),
}));
```

Companion SQL (also in sprint 03 migration):

```sql
CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM platform_admins WHERE user_id = auth.uid())
$$;

-- platform_admins is itself RLS-protected: only existing admins see/manage the list.
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_see_admins" ON platform_admins FOR ALL
  USING (public.is_platform_admin());

ALTER TABLE platform_admin_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins_read_audit" ON platform_admin_audit FOR SELECT
  USING (public.is_platform_admin());
-- INSERTs to the audit table come from triggers running as the table owner;
-- nobody writes to it directly.
```

**Convention used everywhere else.** Every business table's read policy is:

```sql
USING (organization_id IN (SELECT public.user_organization_ids()) OR public.is_platform_admin())
```

Write policies default to org members only and add `OR public.is_platform_admin()` *only when the action genuinely needs to cross orgs* (see `architecture.md` for the discipline rules).

### 3. `segments`

Configurable per org. The 5 L&G segments (architectes, hôtels, etc.) live here.

```typescript
export const segments = pgTable("segments", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: jsonb("name").$type<Record<string, string>>().notNull(), // { fr: "Hôtels premium", en: "Premium hotels" }
  slug: text("slug").notNull(),
  description: jsonb("description").$type<Record<string, string>>().default({}),
  color: text("color").default("#0891B2"),
  order: integer("order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniqSlug: uniqueIndex("uniq_segment_slug").on(t.organizationId, t.slug),
}));
```

### 4. `micro_zones`

Geographic zones configurable per org.

```typescript
export const microZones = pgTable("micro_zones", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code"), // ex: "OP-AU"
  centerAddress: text("center_address"),
  centerLat: numeric("center_lat", { precision: 10, scale: 7 }),
  centerLng: numeric("center_lng", { precision: 10, scale: 7 }),
  radiusMeters: integer("radius_meters").default(800),
  priority: integer("priority").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  segmentIds: uuid("segment_ids").array(), // segments active in this zone
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byOrg: index("idx_microzones_org").on(t.organizationId),
}));
```

### 5. `companies`

The commercial entity. A "company" can have a parent (group/holding) and contain N sites.

```typescript
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

  // Identity
  name: text("name").notNull(),
  legalName: text("legal_name"),
  websiteUrl: text("website_url"),
  linkedinUrl: text("linkedin_url"),
  logoUrl: text("logo_url"),

  // Relationships
  parentId: uuid("parent_id").references(() => companies.id, { onDelete: "set null" }),
  relationshipType: companyRelationshipType("relationship_type"),

  // Classification
  segmentId: uuid("segment_id").references(() => segments.id, { onDelete: "set null" }),
  subSegment: text("sub_segment"),

  // Business attributes
  primaryLocale: text("primary_locale").notNull().default("fr"),
  sizeEstimate: text("size_estimate"), // "1-10", "11-50", "51-200", ...
  standing: integer("standing"), // 1-5
  industry: text("industry"),

  // Scoring (denormalized for query perf, recomputed on writes)
  score: integer("score"), // 0-100
  scoreBreakdown: jsonb("score_breakdown").$type<ScoreBreakdown>(),

  // Status
  status: text("status").notNull().default("to_qualify"),
  signalType: text("signal_type"), // "fundraising", "moving", "renovation", etc.
  signalSource: text("signal_source"),
  signalDetectedAt: timestamp("signal_detected_at", { withTimezone: true }),

  // Notes
  notes: text("notes"),
  ownerId: uuid("owner_id"), // FK to auth.users

  // Soft delete
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byOrg: index("idx_companies_org").on(t.organizationId),
  byOrgScore: index("idx_companies_org_score").on(t.organizationId, t.score),
  byOrgStatus: index("idx_companies_org_status").on(t.organizationId, t.status),
  byParent: index("idx_companies_parent").on(t.parentId),
  bySegment: index("idx_companies_segment").on(t.segmentId),
}));
```

### 6. `sites`

Physical locations attached to a company. A company has 1..N sites. Micro-zone is attached here, not on company.

```typescript
export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),

  name: text("name").notNull(), // "Westminster Paris Opéra"
  type: siteType("type").notNull().default("office"),

  // Address
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  postalCode: text("postal_code"),
  city: text("city"),
  region: text("region"),
  country: text("country").notNull().default("FR"),

  // Geo
  lat: numeric("lat", { precision: 10, scale: 7 }),
  lng: numeric("lng", { precision: 10, scale: 7 }),
  microZoneId: uuid("micro_zone_id").references(() => microZones.id, { onDelete: "set null" }),

  // Attributes
  isPrimary: boolean("is_primary").notNull().default(false),
  standing: integer("standing"), // 1-5, can override company's
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byCompany: index("idx_sites_company").on(t.companyId),
  byMicroZone: index("idx_sites_micro_zone").on(t.microZoneId),
  byOrg: index("idx_sites_org").on(t.organizationId),
}));
```

### 7. `contacts`

People. Always attached to a company. Optionally attached to a specific site.

```typescript
export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),

  // Identity
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  fullName: text("full_name").generatedAlwaysAs(sql`first_name || ' ' || last_name`),
  jobTitle: text("job_title"),
  role: contactRole("role"),

  // Contact info
  email: text("email"),
  emailValidated: boolean("email_validated").default(false),
  phone: text("phone"),
  linkedinUrl: text("linkedin_url"),

  // Preferences
  preferredLanguage: text("preferred_language").notNull().default("fr"),
  preferredChannel: text("preferred_channel"), // "email" | "phone" | "linkedin" | "in_person"

  // Relevance scoring (1-5 stars)
  relevance: integer("relevance"),

  // Status
  status: text("status").notNull().default("to_contact"),
  optedOut: boolean("opted_out").notNull().default(false),
  optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
  optedOutReason: text("opted_out_reason"),

  // Last contact denormalized for query perf
  lastContactedAt: timestamp("last_contacted_at", { withTimezone: true }),
  lastResponseAt: timestamp("last_response_at", { withTimezone: true }),

  notes: text("notes"),

  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byCompany: index("idx_contacts_company").on(t.companyId),
  bySite: index("idx_contacts_site").on(t.siteId),
  byOrg: index("idx_contacts_org").on(t.organizationId),
  byEmail: index("idx_contacts_email").on(t.organizationId, t.email),
}));
```

### 8. `interactions`

Historical log of all touchpoints with a contact. Sent emails, calls, visits, LinkedIn messages, etc.

```typescript
export const interactions = pgTable("interactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),

  type: interactionType("type").notNull(),
  channel: interactionChannel("channel").notNull(),
  outcome: interactionOutcome("outcome"),

  subject: text("subject"),
  summary: text("summary"),
  rawContent: text("raw_content"),

  interestLevel: integer("interest_level"), // 0-5
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  userId: uuid("user_id"), // who logged it / triggered it

  // For sequenced interactions
  sequenceRunId: uuid("sequence_run_id"), // FK to sequence_runs, nullable
  messageId: uuid("message_id"), // FK to messages, nullable

  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byCompany: index("idx_interactions_company").on(t.companyId, t.occurredAt),
  byContact: index("idx_interactions_contact").on(t.contactId, t.occurredAt),
  byOrg: index("idx_interactions_org").on(t.organizationId, t.occurredAt),
}));
```

### 9. `tasks`

To-do items. The "Actions du jour" view is driven by this table.

```typescript
export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  siteId: uuid("site_id").references(() => sites.id, { onDelete: "set null" }),

  type: taskType("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),

  status: taskStatus("status").notNull().default("pending"),
  priority: taskPriority("priority").notNull().default("medium"),

  dueAt: timestamp("due_at", { withTimezone: true }),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }), // exact time if scheduled

  assigneeId: uuid("assignee_id"), // FK to auth.users
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: uuid("completed_by"),

  // Linked entities
  sequenceRunId: uuid("sequence_run_id"),
  messageId: uuid("message_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byAssigneeDue: index("idx_tasks_assignee_due").on(t.assigneeId, t.dueAt),
  byOrgStatus: index("idx_tasks_org_status").on(t.organizationId, t.status),
  byCompany: index("idx_tasks_company").on(t.companyId),
}));
```

### 10. `message_templates`

Reusable message templates. Multilingual via `template_group_id` linking versions.

```typescript
export const messageTemplates = pgTable("message_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

  templateGroupId: uuid("template_group_id").notNull(), // links versions of same template
  locale: text("locale").notNull(), // "fr", "en", ...
  name: text("name").notNull(),
  description: text("description"),

  channel: interactionChannel("channel").notNull(),
  stage: text("stage"), // "first_contact", "follow_up_1", "linkedin_invite", "post_acceptance"
  segmentId: uuid("segment_id").references(() => segments.id, { onDelete: "set null" }),

  subject: text("subject"), // for emails
  body: text("body").notNull(),
  variables: jsonb("variables").$type<string[]>().default([]), // ["first_name", "company_name", "signal"]

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byOrgLocale: index("idx_templates_org_locale").on(t.organizationId, t.locale),
  byGroup: index("idx_templates_group").on(t.templateGroupId, t.locale),
  uniqueGroupLocale: uniqueIndex("uniq_template_group_locale").on(t.templateGroupId, t.locale),
}));
```

### 11. `messages`

Actual sent or drafted messages. Generated by AI or composed manually.

```typescript
export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),

  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").references(() => messageTemplates.id),

  direction: messageDirection("direction").notNull().default("outbound"),
  channel: interactionChannel("channel").notNull(),
  status: messageStatus("status").notNull().default("draft"),
  locale: text("locale").notNull(),

  subject: text("subject"),
  body: text("body").notNull(),

  // AI generation metadata
  generatedByAi: boolean("generated_by_ai").notNull().default(false),
  aiModel: text("ai_model"),
  aiInputTokens: integer("ai_input_tokens"),
  aiOutputTokens: integer("ai_output_tokens"),
  aiCostCents: integer("ai_cost_cents"),

  // Tracking
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  sentVia: text("sent_via"), // "gmail_oauth", "resend", "smartlead", ...
  externalMessageId: text("external_message_id"), // Gmail message ID, etc.

  openedAt: timestamp("opened_at", { withTimezone: true }),
  openedCount: integer("opened_count").notNull().default(0),
  clickedAt: timestamp("clicked_at", { withTimezone: true }),
  repliedAt: timestamp("replied_at", { withTimezone: true }),

  // Inbound (replies)
  inReplyToMessageId: uuid("in_reply_to_message_id"),

  authorId: uuid("author_id"), // FK to auth.users

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byContact: index("idx_messages_contact").on(t.contactId, t.sentAt),
  byOrg: index("idx_messages_org").on(t.organizationId, t.sentAt),
}));
```

### 12-15. Sequences (V1 — prepared in MVP)

Branched sequences. Graph with conditions on edges. See `docs/architecture.md` for the runner pattern.

```typescript
export const sequences = pgTable("sequences", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  targetSegmentId: uuid("target_segment_id").references(() => segments.id, { onDelete: "set null" }),
  status: sequenceStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sequenceSteps = pgTable("sequence_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  sequenceId: uuid("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull(), // denormalized for RLS perf

  position: integer("position").notNull(),
  name: text("name").notNull(),
  type: sequenceStepType("type").notNull(),

  // Config varies by type. For email: { templateGroupId, delayDays }. For wait: { delayDays }. Etc.
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),

  // For visual builder UI (V1.5+)
  x: numeric("x"),
  y: numeric("y"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  bySequence: index("idx_seq_steps_seq").on(t.sequenceId),
}));

export const sequenceTransitions = pgTable("sequence_transitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  sequenceId: uuid("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").notNull(),

  fromStepId: uuid("from_step_id").notNull().references(() => sequenceSteps.id, { onDelete: "cascade" }),
  toStepId: uuid("to_step_id").references(() => sequenceSteps.id, { onDelete: "cascade" }), // nullable if it's an "exit" transition

  conditionType: sequenceConditionType("condition_type").notNull(),
  conditionConfig: jsonb("condition_config").$type<Record<string, unknown>>().default({}),
  priority: integer("priority").notNull().default(0), // higher first

  isExit: boolean("is_exit").notNull().default(false),
  exitReason: text("exit_reason"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byFrom: index("idx_seq_trans_from").on(t.fromStepId),
}));

export const sequenceRuns = pgTable("sequence_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sequenceId: uuid("sequence_id").notNull().references(() => sequences.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),

  currentStepId: uuid("current_step_id").references(() => sequenceSteps.id),
  status: sequenceRunStatus("status").notNull().default("running"),
  state: jsonb("state").$type<Record<string, unknown>>().default({}),

  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  nextActionAt: timestamp("next_action_at", { withTimezone: true }),
  lastActionAt: timestamp("last_action_at", { withTimezone: true }),
  exitedAt: timestamp("exited_at", { withTimezone: true }),
  exitReason: text("exit_reason"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byNextAction: index("idx_seq_runs_next_action").on(t.status, t.nextActionAt),
  byContact: index("idx_seq_runs_contact").on(t.contactId),
}));
```

### 16. `opportunities`

Real deals. Created from interactions, tracks pipeline stages.

```typescript
export const opportunities = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),

  name: text("name").notNull(),
  description: text("description"),

  amountCents: integer("amount_cents"),
  currency: text("currency").notNull().default("EUR"),
  probability: integer("probability"), // 0-100

  stage: opportunityStage("stage").notNull().default("discovery"),

  expectedCloseDate: date("expected_close_date"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedReason: text("closed_reason"),

  ownerId: uuid("owner_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byOrgStage: index("idx_opp_org_stage").on(t.organizationId, t.stage),
  byCompany: index("idx_opp_company").on(t.companyId),
}));
```

### 17. `ai_usage`

Tracking AI calls for cost monitoring and per-org quotas.

```typescript
export const aiUsage = pgTable("ai_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id"),

  feature: text("feature").notNull(), // "message_generation", "scoring", "sourcing", "reply_classification"
  model: text("model").notNull(), // "claude-sonnet-4-6", "gpt-4o-mini", ...
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  costCents: integer("cost_cents").notNull(),

  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byOrgDate: index("idx_ai_usage_org_date").on(t.organizationId, t.createdAt),
}));
```

---

## Relations (Drizzle)

Declare relations separately to avoid circular imports:

```typescript
// db/relations.ts
export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  segments: many(segments),
  microZones: many(microZones),
  companies: many(companies),
}));

export const companiesRelations = relations(companies, ({ one, many }) => ({
  organization: one(organizations, { fields: [companies.organizationId], references: [organizations.id] }),
  parent: one(companies, { fields: [companies.parentId], references: [companies.id], relationName: "parentRel" }),
  children: many(companies, { relationName: "parentRel" }),
  segment: one(segments, { fields: [companies.segmentId], references: [segments.id] }),
  sites: many(sites),
  contacts: many(contacts),
  interactions: many(interactions),
  tasks: many(tasks),
  opportunities: many(opportunities),
}));

export const sitesRelations = relations(sites, ({ one, many }) => ({
  company: one(companies, { fields: [sites.companyId], references: [companies.id] }),
  microZone: one(microZones, { fields: [sites.microZoneId], references: [microZones.id] }),
  contacts: many(contacts),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  company: one(companies, { fields: [contacts.companyId], references: [companies.id] }),
  site: one(sites, { fields: [contacts.siteId], references: [sites.id] }),
  interactions: many(interactions),
  messages: many(messages),
}));

// ... etc for every table
```

---

## RLS policies (Postgres SQL)

A migration file should define these. Pattern:

```sql
-- Enable RLS on every business table
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admin_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE micro_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

-- Helper functions (see architecture.md → "Platform admin pattern")
CREATE OR REPLACE FUNCTION public.user_organization_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM organization_members WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM platform_admins WHERE user_id = auth.uid())
$$;

-- Standard read policy for business tables: org members OR platform admin
CREATE POLICY "read_companies" ON companies FOR SELECT USING (
  organization_id IN (SELECT public.user_organization_ids())
  OR public.is_platform_admin()
);

-- Standard write policy: org members only, by default.
-- Add `OR public.is_platform_admin()` here ONLY for tables where cross-org
-- writes are a real product requirement (e.g. support_notes added in V1+).
CREATE POLICY "write_companies" ON companies FOR ALL USING (
  organization_id IN (SELECT public.user_organization_ids())
) WITH CHECK (
  organization_id IN (SELECT public.user_organization_ids())
);

-- Repeat the read/write pair for sites, contacts, interactions, tasks, messages, etc.

-- organizations table: special — read your own org via membership, or any if platform admin
CREATE POLICY "read_own_org" ON organizations FOR SELECT USING (
  id IN (SELECT public.user_organization_ids())
  OR public.is_platform_admin()
);

-- organization_members: read members of your orgs (or all if platform admin)
CREATE POLICY "read_org_members" ON organization_members FOR SELECT USING (
  organization_id IN (SELECT public.user_organization_ids())
  OR public.is_platform_admin()
);

-- platform_admins table: only existing admins see/manage the list
CREATE POLICY "admins_manage_admins" ON platform_admins FOR ALL
  USING (public.is_platform_admin());

-- platform_admin_audit: read-only for admins; writes come from triggers
CREATE POLICY "admins_read_audit" ON platform_admin_audit FOR SELECT
  USING (public.is_platform_admin());
```

---

## TypeScript types (auto-derived from Drizzle)

```typescript
import { InferSelectModel, InferInsertModel } from "drizzle-orm";

export type Organization = InferSelectModel<typeof organizations>;
export type NewOrganization = InferInsertModel<typeof organizations>;

export type Company = InferSelectModel<typeof companies>;
export type NewCompany = InferInsertModel<typeof companies>;

// ... etc
```

These types are the source of truth for all app code. Don't define entity types elsewhere.

---

## Migration strategy

1. Define/edit `db/schema.ts`
2. Run `npx drizzle-kit generate` to create a migration file under `db/migrations/`
3. Hand-edit the generated migration to add RLS policies, helper functions, custom indexes if needed
4. Run `npx drizzle-kit migrate` to apply (or via Supabase CLI for production)
5. Commit both the schema change AND the migration file

For Supabase production migrations, prefer the Supabase CLI workflow:
```
supabase migration new feature_name
# edit the generated SQL
supabase db push
```

---

## Open questions to revisit

- **`auth.users` FK enforcement**: Drizzle can reference the `auth.users` table from Supabase but we should validate the column type matches.
- **Full-text search**: do we add Postgres `tsvector` on companies/contacts? Probably V1.
- **Audit log**: do we add a generic `audit_log` table for all writes? Probably V1+.
- **Materialized views**: for the 5 dashboard views (Actions du jour, Cibles chaudes, etc.), do we use materialized views refreshed periodically, or live queries? MVP says live, V1 reconsider if perf becomes an issue.
