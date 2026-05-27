# Sprint 05 — Interactions & Tasks

## Goal

Add the touch-log and task system that drives the "À traiter aujourd'hui" dashboard. After this sprint:

- Every contact and company has a chronological interaction history (emails, calls, visits, notes…).
- Commercials can create tasks, mark them done, and reschedule overdue ones.
- The dashboard "À traiter aujourd'hui" card and the KPI counters show real data instead of mocked constants.
- The sidebar Tasks counter shows pending task count.

## Prerequisites

- Sprint 04 done: `companies`, `sites`, `contacts` tables exist with seed data for L&G and Bristol.
- `db/seed-demo-data.ts` exists and creates 4 L&G companies / 8 contacts.
- RLS helper functions `user_organization_ids()` and `is_platform_admin()` are live.

## Scope

### In scope

1. **Schema** — `interactions` + `tasks` tables + 6 new enums.
2. **Migration** — generated via `drizzle-kit generate`, synced to `supabase/migrations/`.
3. **RLS policies** — same 4-statement pattern as sprint 04.
4. **Query helpers** — `db/queries/interactions.ts`, `db/queries/tasks.ts`.
5. **Tasks list page** (`/tasks`) — pending + today view, with complete + delete actions.
6. **New task form** (`/tasks/new`) — standalone creation form.
7. **Contextual tasks** — on company detail and contact detail: show linked tasks, "+ Add task" shortcut that pre-fills company/contact.
8. **Log interaction** — on contact detail: timeline of past interactions + "+ Log" inline form.
9. **Company interactions** — on company detail: merged timeline across all contacts.
10. **Dashboard wiring** — replace `PLACEHOLDER` constants with real queries for:
    - "À traiter aujourd'hui" list (tasks due today + overdue, max 10, sorted by company score desc)
    - KPI "actionsToday" (pending tasks due today)
    - KPI "overdue" (pending tasks past due)
    - "Recent activity" sidebar card (last 5 interactions org-wide)
11. **Sidebar counter** — Tasks badge = count of pending tasks for active org.
12. **Seed update** — `db/seed-demo-data.ts` gets interactions + tasks for L&G demo.
13. **Tests** — RLS isolation for both tables (~4 tests each).

### Out of scope

- Task snooze / reschedule UI (data model supports it; no UI yet).
- Interaction-to-task automatic creation (V1+).
- Sequence run linkage (`sequenceRunId`, `messageId` columns exist but stay null).
- Gmail send from task (sprint 07+).

---

## Schema additions

Add to `db/schema.ts` immediately after the existing contact-role enum and before the `organizations` table definition.

### New enums

```typescript
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
```

### `interactions` table

```typescript
export const interactions = pgTable("interactions", {
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

  interestLevel: integer("interest_level"), // 0–5

  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  userId: uuid("user_id"), // who logged it

  // Reserved for sprint 07+ (sequences, messages)
  sequenceRunId: uuid("sequence_run_id"),
  messageId: uuid("message_id"),

  metadata: jsonb("metadata").default({}),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byCompany: index("idx_interactions_company").on(t.companyId, t.occurredAt),
  byContact: index("idx_interactions_contact").on(t.contactId, t.occurredAt),
  byOrg:     index("idx_interactions_org").on(t.organizationId, t.occurredAt),
}));
```

### `tasks` table

```typescript
export const tasks = pgTable("tasks", {
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

  assigneeId: uuid("assignee_id"), // FK to auth.users — no Drizzle ref (cross-schema)
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: uuid("completed_by"),

  // Reserved for sprint 07+
  sequenceRunId: uuid("sequence_run_id"),
  messageId: uuid("message_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byAssigneeDue: index("idx_tasks_assignee_due").on(t.assigneeId, t.dueAt),
  byOrgStatus:   index("idx_tasks_org_status").on(t.organizationId, t.status),
  byCompany:     index("idx_tasks_company").on(t.companyId),
}));
```

### Drizzle relations to add

```typescript
// append to companiesRelations
interactions: many(interactions),
tasks: many(tasks),

// append to contactsRelations
interactions: many(interactions),
tasks: many(tasks),

// new top-level
export const interactionsRelations = relations(interactions, ({ one }) => ({
  organization: one(organizations, { fields: [interactions.organizationId], references: [organizations.id] }),
  company:      one(companies,     { fields: [interactions.companyId],      references: [companies.id] }),
  contact:      one(contacts,      { fields: [interactions.contactId],      references: [contacts.id] }),
  site:         one(sites,         { fields: [interactions.siteId],         references: [sites.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  organization: one(organizations, { fields: [tasks.organizationId], references: [organizations.id] }),
  company:      one(companies,     { fields: [tasks.companyId],      references: [companies.id] }),
  contact:      one(contacts,      { fields: [tasks.contactId],      references: [contacts.id] }),
  site:         one(sites,         { fields: [tasks.siteId],         references: [sites.id] }),
}));
```

---

## Migration

After editing `schema.ts`:

```bash
npm run db:generate
npm run db:sync          # copies drizzle output → supabase/migrations/
```

Then add RLS policies **at the bottom** of the generated migration file (same 4-statement pattern as sprint 04):

```sql
-- interactions
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "interactions_select" ON interactions FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()) OR public.is_platform_admin());

CREATE POLICY "interactions_insert" ON interactions FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY "interactions_update" ON interactions FOR UPDATE
  USING  (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY "interactions_delete" ON interactions FOR DELETE
  USING (organization_id IN (SELECT public.user_organization_ids()));

-- tasks
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_select" ON tasks FOR SELECT
  USING (organization_id IN (SELECT public.user_organization_ids()) OR public.is_platform_admin());

CREATE POLICY "tasks_insert" ON tasks FOR INSERT
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY "tasks_update" ON tasks FOR UPDATE
  USING  (organization_id IN (SELECT public.user_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.user_organization_ids()));

CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (organization_id IN (SELECT public.user_organization_ids()));
```

Then apply locally:

```bash
supabase db reset
```

---

## Query helpers

### `db/queries/interactions.ts`

```typescript
// Key functions to implement:
getInteractionsByContact(orgId, contactId)    // sorted by occurredAt desc
getInteractionsByCompany(orgId, companyId)    // all contacts, sorted by occurredAt desc
getRecentInteractionsByOrg(orgId, limit = 5) // dashboard "recent activity"
logInteraction(orgId, data)                  // insert + update contacts.lastContactedAt
```

`logInteraction` must also update `contacts.lastContactedAt` if `contactId` is provided:
```typescript
await db.update(contacts)
  .set({ lastContactedAt: data.occurredAt, updatedAt: new Date() })
  .where(and(eq(contacts.id, data.contactId), eq(contacts.organizationId, orgId)));
```

### `db/queries/tasks.ts`

```typescript
getTasksByOrg(orgId, filters?)              // all non-cancelled tasks
getTodayTasksByOrg(orgId)                   // dueAt::date <= today AND status = pending, sorted by company score desc (join companies)
getOverdueTasksByOrg(orgId)                 // dueAt < now() AND status = pending
getTasksByCompany(orgId, companyId)
getTasksByContact(orgId, contactId)
countPendingTasksByOrg(orgId)               // sidebar counter
createTask(orgId, data)
completeTask(orgId, taskId, userId)         // sets status = completed, completedAt = now(), completedBy = userId
deleteTask(orgId, taskId)
```

`getTodayTasksByOrg` needs a join on `companies` to get `score` for sorting:
```typescript
.leftJoin(companies, eq(tasks.companyId, companies.id))
.orderBy(desc(companies.score), asc(tasks.priority))
```

---

## Server Actions

### `app/(app)/tasks/actions.ts`

- `createTaskAction(formData: FormData)` — Zod validate → `createTask()` → `revalidatePath("/tasks")`
- `completeTaskAction(formData: FormData)` — Zod `{ taskId: z.string().uuid() }` → `completeTask()` → revalidate
- `deleteTaskAction(formData: FormData)` — same pattern

### `app/(app)/contacts/[id]/actions.ts` (new file)

- `logInteractionAction(formData: FormData)` — Zod validate → `logInteraction()` → `revalidatePath("/contacts/[id]")`

(Company interactions are read-only aggregates — no separate action needed for company; they come from contacts.)

---

## Routes

### `/tasks` — Tasks list

Sections:

1. **Today** — `getTodayTasksByOrg()` — cards with company name, contact name, task type icon, priority badge, "Done" button.
2. **Overdue** — `getOverdueTasksByOrg()` — same card style, amber tint, shows how many days late.
3. **All pending** — `getTasksByOrg()` filtered to `pending` — table or card list.

Each card/row has:
- Type icon (Mail / Phone / MapPin / LinkedIn / etc.)
- Title + company name (link) + contact name (link) — if set
- Due date
- Priority badge
- "Mark done" form button (POST → `completeTaskAction`)
- Delete button

Header: "+ New task" button → `/tasks/new`.

### `/tasks/new` — Create task

Form fields:

| Field | Type | Required |
|-------|------|----------|
| type | select (enum) | yes |
| title | text | yes |
| description | textarea | no |
| priority | select (low/medium/high/urgent) | yes, default medium |
| dueAt | datetime-local | no |
| companyId | select (companies in org) | no |
| contactId | select (contacts filtered by companyId if set) | no |

`assigneeId` defaults to current user server-side — no picker at MVP.

On success: redirect to `/tasks`.

### Company detail page additions (`/companies/[id]`)

Add two new sections below the existing content:

**1. "Tâches" section** — `getTasksByCompany(orgId, companyId)`, shows pending tasks. "+ Add task" link goes to `/tasks/new?companyId=[id]`.

**2. "Interactions" section** — `getInteractionsByCompany(orgId, companyId)`, reverse-chron timeline, last 10. Each row: date, type badge, channel, contact name (if set), summary snippet.

### Contact detail page additions (`/contacts/[id]`)

Add two sections below the existing content:

**1. "Tâches" section** — `getTasksByContact(orgId, contactId)`, pending tasks. "+ Add task" → `/tasks/new?contactId=[id]`.

**2. "Interactions" section** — `getInteractionsByContact(orgId, contactId)`, reverse-chron timeline. Each row shows type badge, channel, date, outcome badge (color-coded), summary.

At the top of the interactions section: "+ Log interaction" button → expands an inline form (no route needed, use `<details>` or a controlled client component):

| Field | Type | Required |
|-------|------|----------|
| type | select (enum) | yes |
| channel | select (enum) | yes |
| outcome | select (enum) | no |
| summary | textarea | no |
| occurredAt | datetime-local | yes, default = now |
| interestLevel | number 0–5 | no |

On submit: `logInteractionAction` → revalidate → form collapses.

---

## Dashboard wiring

In `app/(app)/dashboard/page.tsx`, replace the `PLACEHOLDER` object with real queries:

```typescript
const [todayTasks, recentInteractions] = await Promise.all([
  getTodayTasksByOrg(org.id),
  getRecentInteractionsByOrg(org.id, 5),
]);

const actionsToday = todayTasks.length;
const overdue = todayTasks.filter(t => t.dueAt && t.dueAt < startOfToday).length;
```

**"À traiter aujourd'hui" list** — map `todayTasks` (max 10). Show:
- Type icon
- Task title
- Company name (with score badge if company has score)
- Contact name + job title
- Due date (or "overdue X days" in amber)

**"Recent activity" card** — map `recentInteractions`. Show:
- Date
- Interaction type + channel
- Contact name at company name
- Outcome badge

**KPI cards**: `actionsToday` and `overdue` replace `PLACEHOLDER.actionsToday` and `PLACEHOLDER.overdue`. Leave `hotTargets` and `responseRate` as placeholders (sprint 06).

The `"Today's tasks" → "View all"` link goes to `/tasks`.

---

## Sidebar counter

In `components/app/sidebar.tsx`, add a query call for the Tasks nav item (same pattern as company/contact counters):

```typescript
const pendingTasks = await countPendingTasksByOrg(organization.id);
```

Display as a badge next to "Tasks" in the nav.

---

## Seed data

In `db/seed-demo-data.ts`, after creating contacts, add:

**Interactions (6 rows for L&G):**
- Westminster / Sophie Durand — `first_contact`, email, `no_response`, 12 days ago
- Westminster / Sophie Durand — `follow_up`, email, `positive_reply`, 5 days ago
- Exotrail / Alexandre Braud — `first_contact`, email, `no_response`, 8 days ago
- Studio Marc Hertrich / Christophe Daudré — `call`, phone, `rdv_scheduled`, 3 days ago
- Wojo Madeleine / (first contact) — `linkedin`, linkedin, `positive_reply`, 2 days ago
- Wojo Madeleine — `meeting`, in_person, `positive_reply`, yesterday

**Tasks (5 rows for L&G):**
- Westminster / Sophie Durand — `follow_up`, "Send pricing catalogue", due today, priority high
- Exotrail / Alexandre Braud — `email`, "Follow-up email J+12", overdue 2 days, priority high
- Studio Marc Hertrich / Christophe Daudré — `phone`, "Call back at 14h30", due today, priority urgent
- Wojo Madeleine — `visit`, "Site visit and product presentation", due in 3 days, priority medium
- (no contact) company-level — `research`, "Identify 2nd contact at Westminster", due tomorrow, priority low

After seeding, update `contacts.lastContactedAt` for each contact that has interactions.

Also add 1 interaction for Bristol (Plaza Athénée) to validate RLS isolation in tests.

---

## i18n additions

Add to `messages/en.json` (mirror in `messages/fr.json`):

```json
"pages": {
  "tasks": {
    "title": "Tasks",
    "subtitle": "Your actions for today and upcoming",
    "today": "Due today",
    "overdue": "Overdue",
    "allPending": "All pending",
    "empty": "Nothing due. Enjoy the quiet.",
    "newTask": "New task",
    "markDone": "Mark done",
    "overdueBy": "{days, plural, one {# day late} other {# days late}}"
  },
  "interactions": {
    "logNew": "Log interaction",
    "timeline": "Interaction history",
    "empty": "No interactions yet.",
    "logSuccess": "Interaction logged."
  }
},
"taskType": {
  "email": "Email",
  "linkedin": "LinkedIn",
  "phone": "Phone",
  "visit": "Visit",
  "follow_up": "Follow-up",
  "research": "Research",
  "other": "Other"
},
"taskStatus": {
  "pending": "Pending",
  "in_progress": "In progress",
  "completed": "Done",
  "cancelled": "Cancelled",
  "snoozed": "Snoozed"
},
"taskPriority": {
  "low": "Low",
  "medium": "Medium",
  "high": "High",
  "urgent": "Urgent"
},
"interactionType": {
  "first_contact": "First contact",
  "follow_up": "Follow-up",
  "call": "Call",
  "visit": "Visit",
  "linkedin": "LinkedIn",
  "meeting": "Meeting",
  "demo": "Demo",
  "proposal_sent": "Proposal sent",
  "note": "Note"
},
"interactionChannel": {
  "email": "Email",
  "linkedin": "LinkedIn",
  "phone": "Phone",
  "in_person": "In person",
  "video": "Video",
  "other": "Other"
},
"interactionOutcome": {
  "no_response": "No response",
  "positive_reply": "Positive reply",
  "negative_reply": "Negative reply",
  "out_of_office": "Out of office",
  "wrong_contact": "Wrong contact",
  "rdv_scheduled": "Meeting scheduled",
  "opted_out": "Opted out"
}
```

---

## Tests

Add `tests/rls/interactions-tasks.test.ts`. Cover:

1. L&G user can read L&G interactions ✓
2. L&G user cannot read Bristol interactions ✗
3. L&G user can read L&G tasks ✓
4. L&G user cannot read Bristol tasks ✗
5. Platform admin can read both L&G and Bristol interactions ✓
6. `logInteraction` updates `contacts.lastContactedAt` (unit test on the query helper)
7. `completeTask` sets `completedAt` and `status = completed` ✓
8. `getTodayTasksByOrg` only returns tasks with `dueAt::date <= today AND status = pending` ✓

Target: test count goes from 12 → ~20.

---

## Acceptance criteria

- [ ] `/tasks` shows today's + overdue tasks with real data (L&G seed)
- [ ] Can create a task from `/tasks/new`, appears in the list
- [ ] "Mark done" removes the task from the pending list
- [ ] Company detail shows related tasks + interactions
- [ ] Contact detail shows related tasks + "Log interaction" form; submitting logs and updates `lastContactedAt`
- [ ] Dashboard "À traiter aujourd'hui" shows 3 seeded tasks with correct company name and due date
- [ ] Dashboard KPIs `actionsToday` and `overdue` are real numbers (not mocked)
- [ ] Dashboard "Recent activity" shows last 3–5 interactions
- [ ] Sidebar Tasks badge shows correct count
- [ ] Impersonate Bristol → Tasks and Interactions list empty (only Bristol seed data visible, not L&G)
- [ ] Multi-tenant safety: all queries filter by `organization_id`
- [ ] No hardcoded strings in UI
- [ ] `npm run lint`, `npm run build`, `npm run test` all clean — test count ~20

---

## Implementation notes

### Deviations from the brief

- **Server Actions location**: actions landed in `lib/actions/tasks.ts` and `lib/actions/interactions.ts` (shared lib), not inside `app/(app)/tasks/actions.ts`. This makes them reusable from multiple pages (company detail, contact detail, task row).

- **Log interaction UI**: the brief called for an inline `<details>`/controlled expand. We shipped a `<Dialog>` instead (`LogInteractionForm` with Base UI dialog) — cleaner UX on mobile, avoids layout shift. Same pattern applied to the task row "Log interaction" quick-action.

- **`taskId` on interactions**: added a `task_id uuid` column to `interactions` (not in original schema spec) to link an interaction to the task it closes. Migration applied manually via psql (Drizzle codegen silently produced no diff due to declaration-order FK issue).

- **Base UI gotcha**: `@base-ui/react/menu` `Menu.Item` fires `onClick`, not an `onSelect` callback. All three action menu items had to be converted. Dialog triggers inside a DropdownMenu also cause focus conflicts — fixed by lifting the dialog open-state to the parent and rendering the Dialog as a sibling to the DropdownMenu, not inside it.

- **Task status "snoozed"**: added to the DB enum as specified, but the UI only surfaces `pending`, `in_progress`, `completed`, `cancelled`. Snoozed is reserved for a future sprint.

- **Kanban and calendar views**: explicitly deferred — the brief already listed them out of scope, confirmed again in sprint review. List view only at MVP.

- **assigneeId filter on dashboard queries**: `getTasksDashboard`, `countTodayTasksByOrg`, `countOverdueTasksByOrg` all accept an optional `assigneeId` so the dashboard shows "my tasks" by default (filtered by `user.id`).

### Acceptance criteria status

All criteria met. RLS isolation tests pass for interactions and tasks (L&G cannot read Bristol data, platform admin can). `npm run lint`, `npm run build`, `npm run test` clean at sprint close.
