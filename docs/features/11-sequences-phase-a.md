# 11 — Sequences (Phase A : foundation + task-mode)

> First useful slice of the long-term Klaviyo-tier outreach automation
> engine. Phase A ships **the complete foundation** (graph data model,
> polymorphic predicates, executor Strategy, draft+publish+lock cycle,
> Inngest engine, drag-drop editor) but only **a limited subset of step
> types** : task creation (manual + AI draft), wait, enrol cascade, end.
>
> Phase B and Phase C add new step types, new predicate types, and richer
> UI on top of the same foundation — **no schema migration, no engine
> refactor, no UI rewrite**. The single user benefit at the end of Phase A :
> **the rep never forgets a follow-up again, across all channels**, with
> AI-pre-drafted messages waiting to be reviewed and sent.

## Why this design — Klaviyo-inspired but graph-native from day 1

The mockup (`docs/mockups/sequences-page.png`) and the Klaviyo flows the
user shared as inspiration (`docs/mockups/klaviyo-flow-1.png`,
`docs/mockups/klaviyo-flow-2.png`) describe an automation tool with :

- Atomic step model (each step does ONE thing : send, wait, branch, etc.)
- Multi-way branching (Conditional split for yes/no, plus our own
  `switch_case` innovation for n-way)
- Per-step filters on contact / company properties
- Time delays as their own step type
- Localised content per contact preferred language without flow branching
- Data actions (property update, list update, internal alert, webhook)
- Drag-drop visual editor

We commit to the **whole structural foundation** in Phase A so adding
features later doesn't break existing sequences in production. Phase A
ships with limited step / predicate types because each takes time to
implement and L&G can validate the core loop with the simpler ones first.

## Prerequisites

- ✅ Sprint 10 (Gmail send + reply polling) — interactions carry the
  `status` enum the predicates read.
- ✅ Sprint 10.5 (Gmail attachments) — migration applied to prod.
- ⏳ Sprint 10.8 (generic contacts) — needs to ship first so the auto-
  suggest flow can target hotels without a real named contact.

## Scope

In :

**Foundation (the structural pieces) — fully implemented in Phase A** :

- Atomic step model with `next_step_ids jsonb` for graph navigation
  (every step in Phase A just has `{ default : <next-step-id> }`,
  but the engine reads the jsonb so Phase B's branches plug in zero-cost).
- Polymorphic `condition jsonb` + `filter jsonb` predicates on each
  step, dispatched via a `SequencePredicateEvaluatorFactory`.
- Step executors via `SequenceStepExecutor` interface +
  `SequenceStepExecutorFactory` (Strategy + Factory pattern, same shape
  as the LLM / CSV / MIME builders elsewhere in the codebase).
- `LocalizedString` type + resolver for any contact-facing text in
  `action_config` (chain : contact preferred → company primary → org
  default → explicit `default` → any).
- Sequence draft + lock + publish lifecycle (4 columns on `sequences`,
  optimistic single-editor lock, transactional swap on publish, the
  engine NEVER reads the draft).
- Eligibility checker run at enrolment time : opt-out hard rejections,
  three built-in exclusion guards (active sequence on contact, active
  sequence on company, cooldown after completed).
- Inngest engine : `sequence-tick` cron + `sequence-advance-enrolment`
  per-enrolment handler triggered both by tick and by `task/completed`
  events, idempotent via `UNIQUE(enrolment_id, step_order)` on
  executions.
- Built-in template system : TypeScript objects in
  `lib/sequences/built-in-templates.ts`, cloned at sequence creation.
- AI drafts persisted via existing `messages` table with `status='draft'`,
  consumed by the existing `GenerateMessageDialog`.

**Features shipped in Phase A — limited intentionally** :

- 5 step types :
  - `create_task_manual`
  - `create_task_with_ai_draft`
  - `wait_delay`
  - `enroll_in_sequence`
  - `end_success`
- 6 condition predicates (history-based) :
  - `always` (implicit when condition is null)
  - `if_no_inbound`
  - `if_responded`
  - `if_positive_reply`
  - `if_negative_reply`
  - `if_no_answer`
- 0 filter predicates : the column + evaluator dispatcher are in place,
  but no concrete filter evaluators are shipped. Phase A steps always
  have `filter = null`.
- Manual enrolment from contact page + suggestion at contact creation
  + auto-advance on task completion. Auto-enrol-without-confirmation
  is Phase B.
- Node-based flow editor built on **React Flow** (`@xyflow/react`) with
  **Dagre** auto-layout. Phase A is a single-column vertical flow
  because no step types produce branching outputs yet, but the visual
  model + drag-drop affordances are in place — Phase B "just" adds
  branching step types and the auto-layout opens side-by-side columns
  where needed. No manual canvas 2D positioning ; Dagre always
  re-renders the layout from the graph.

Out of scope (Phase B / C, documented at the bottom) :

- Any kind of auto-send.
- Click / open tracking via redirect endpoints or pixels.
- AI auto-reply on prospect engagement signals.
- Branching step types (`conditional_split`, `switch_case`).
- Data action steps (`property_update`, `tag_update`, `internal_alert`,
  `webhook`, `slack_notify`, `trigger_split`).
- Property / time-based predicates.
- AND / OR / NOT composition of predicates.
- TEST / sandbox mode on sequences.
- Per-step metrics (sent / opened / clicked / replied counters).
- A/B variants on a step.
- Canvas 2D editor with free node positioning. Probably never shipped.
- Zoom / pan on the editor. Added later if vertical scrolling becomes
  painful with real usage.
- Quiet hours (essential for Phase B+ auto-send, not for Phase A
  task-creation).

## Decisions captured

These are the design calls we made during the back-and-forth — recorded
here so the implementation doesn't drift later.

1. **Sequence is a reusable template.** Multiple `sequence_enrolments`
   reference the same `sequence_id`. Editing the recipe affects all
   in-flight enrolments from their next step onwards.

2. **Enrolment is keyed on `contact_id`** (with `company_id`
   denormalised for fast lookups). Generic contacts (Sprint 10.8) make
   this work for hotels where no named person exists yet.
   Intra-sequence contact switch (e.g. "try the director if the
   concierge ignores us") is out of scope for Phase A — deferred to
   V1.5+ as a future executor type.

3. **Multi-sequence on a single contact** : allowed. The
   `UNIQUE(sequence_id, contact_id) WHERE status IN ('active', 'paused')`
   partial index just blocks the same sequence being active twice on
   the same contact. Two different sequences in parallel is fine.

4. **Targeting / eligibility** : a sequence carries small fixed array
   filters (`target_relationship_types`, `target_site_types`,
   `target_contact_roles`, `target_locales`) plus three exclusion flags
   (active sequence on contact, active sequence on company, cooldown
   after completed). Composite boolean (`AND / OR`) is V1.5 territory.

5. **Targeting strictness** : warn, never refuse. The enrol button
   shows a yellow banner "ce contact ne correspond pas au ciblage —
   continuer ?" instead of disabling.

6. **Enrolment triggers** : manual from contact page + suggestion at
   contact creation. The latter is a UI block on the create form —
   when the contact matches one or more sequences, a "Tu peux l'enrôler
   dans : …" panel appears with an "Enrôler" button per eligible
   sequence. Auto-enrol-without-confirmation is Phase B.

7. **Auto-advancement on task completion** : when a sequence-generated
   task is completed (any path — Gmail send, mark done, log
   interaction), the engine looks at the next step and schedules /
   branches via a `task/completed` Inngest event. No toggle in the
   dialog : sequences just continue silently when the contact is
   already in one.

8. **Condition vocabulary is interaction-based, not channel-specific** :
   `if_no_inbound`, `if_responded`, `if_positive_reply`,
   `if_negative_reply`, `if_no_answer`, `always`. The engine queries
   the enrolment's interaction trail regardless of whether the step
   was email / call / visit.

9. **Sequence is NOT terminated on a positive reply by default.** A
   positive reply just drives the next branch via the
   `if_positive_reply` condition. The sequence terminates only when (a)
   a step of `action_type='end_success'` runs, (b) the contact opts
   out, (c) the user manually stops, (d) no `next_step_id` resolves
   (`completed_exhausted`), or (e) an `enroll_in_sequence` step cascades
   into another (`completed_cascaded`).

10. **Starting step is optional and configurable** at enrolment. The rep
    can pick "step 1" (default) or any later step — useful when the
    first touch happened outside hitempo.

11. **System templates** are TypeScript objects in the repo, not a DB
    table. At sequence creation the user picks "From template" → form
    pre-filled. No back-link after instantiation : editing the user's
    sequence does NOT mutate the template, and the template can be
    re-instantiated as many times as wanted.

12. **AI drafts reuse the existing `messages` table** (`status='draft'`
    + `task_id` FK) — not a free-form jsonb column on `tasks`. Type-safe,
    one source of truth across the system, and Phase B's `send_email_auto`
    executor naturally re-uses the same row when it flips to `sent`.

13. **"Recycling" is NOT a Phase A concept** — it's composable through
    the `enroll_in_sequence` step type combined with `wait_delay`. The
    sequence definition explicitly lays out cooldown + cascade /
    self-recycle as regular steps. This removes the need for an
    `auto_recycle_after_days` lifecycle hook on the sequence itself.

14. **Edits go through a draft + publish cycle, not edit-in-place**,
    and the sequence is **locked** to a single editor at a time. The
    engine NEVER reads `draft_definition` — only the published
    `sequences` row + `sequence_steps`. Drafting can't break in-flight
    enrolments. Implementation : 4 columns on `sequences`
    (`draft_definition jsonb`, `draft_saved_at`, `editing_locked_by`,
    `editing_locked_at`), atomic conditional UPDATE for lock
    acquisition, 30-minute idle timeout for stale-lock takeover, single
    transactional `publish` that swaps live steps with drafted ones.

15. **In-flight enrolments pick up the new definition on their next
    tick**, but already-executed steps stay frozen in
    `sequence_step_executions`. Edge case warned in the publish UI :
    enrolments whose cursor would now overshoot the new step count end
    as `completed_exhausted` on their next tick.

16. **Draft is stored as JSONB on the sequence row**, not as shadow
    tables. JSONB makes it structurally impossible for the engine to
    read a draft by accident. Validation at action layer (Zod) at every
    save + at publish. FK integrity for nested references
    (`enroll_in_sequence.action_config.target_sequence_id`) is
    re-checked at publish time.

17. **Atomic step model, Klaviyo-inspired**. Each step does ONE thing :
    create a task, wait, enrol into another sequence, end. Waits are
    NOT a property of action steps — they're their own step type
    (`wait_delay`) with `action_config = { duration_value, duration_unit }`
    where `duration_unit ∈ ('minutes' | 'hours' | 'days')`.

18. **Conditions stay on each step**, evaluated at execution time
    (including on `wait_delay`). A `wait_delay` whose condition is
    false advances immediately without waiting — useful for the
    "wait 7 days for response, but advance immediately if response
    came earlier" pattern. Multi-way branching (positive_reply →
    branch A, negative → branch B, no_reply → branch C) is **not
    possible in Phase A's linear graph** : it needs the
    `conditional_split` or `switch_case` step types from Phase B.

19. **Quiet hours are Phase B+**. In Phase A, all steps create tasks
    (no auto-send), so a `wait_delay` expiring at 3am on Sunday just
    means the rep sees the task Monday morning — no deliverability
    issue. Phase B's `send_email_auto` will need org-level quiet hours
    config.

20. **Locale is data, not flow control.** A single sequence serves
    contacts of all languages. Per-step contact-facing strings
    (`titleTemplate`, `orientation`, future `subject`, `body`) are
    typed as `LocalizedString` :
    ```
    type LocalizedString = string | { [locale: string]: string } & { default?: string }
    ```
    Resolution at execution time : contact.preferredLanguage →
    company.primaryLocale → organization.defaultLocale → explicit
    `default` → any value. The AI orchestrator already receives
    `contact.preferredLanguage` and generates in it. We never branch
    a flow on locale (Klaviyo does, we explicitly don't).

21. **Foundation is complete in Phase A, features are limited.**
    All schema, all polymorphic dispatchers, all UI structure : in.
    Step types : only 5. Predicate types : only 6 (history-based).
    Filter evaluators : 0. Phase B/C add executors and predicate
    evaluators via Factory registration — no schema migration, no
    engine refactor, no UI rewrite.

22. **UI editor is node-based on React Flow from Phase A.**
    `@xyflow/react` + `dagre` for auto-layout. Phase A renders a
    single-column vertical flow (no branching step types yet exist),
    but the visual model, the drag-drop affordances, and the
    edge-rewiring logic are all in place. Phase B "just" adds new
    branching step types — the editor automatically renders
    side-by-side columns at branch points because Dagre handles the
    layout for any DAG. Phase B also unlocks dragging a node's next
    handle onto a non-adjacent target (skip-ahead, back-loop). We
    deliberately picked React Flow over `@dnd-kit` to avoid a UI
    rewrite at the Phase A → Phase B transition — total effort is
    similar across phases but the iteration risk is much lower.
    Canvas 2D free positioning (drag a node to any x/y) is NOT in
    scope ; the layout is always auto-computed from the graph.

23. **Loops are supported by the data model from Phase A** but the UI
    doesn't expose them. A step's `next_step_ids` can point to any
    earlier step's id, the engine just follows. Idempotence is
    rebuilt around a monotonic
    `sequence_enrolments.last_execution_counter` instead of
    `(enrolment_id, step_order)` so the same step can be executed
    multiple times safely. Anti-runaway safety cap :
    `sequence_enrolments.max_execution_count` default 200, breach ends
    the enrolment with `end_reason='safety_loop_cap_reached'`. Phase
    B adds the editor affordance to create loops (drag a step's next
    handle onto an earlier step) — zero schema or engine change
    required.

## Architecture

### Graph navigation via `next_step_ids`

Each step row carries a `next_step_ids jsonb` column describing where
the engine goes after this step :

| Step type                | `next_step_ids` shape                          |
|--------------------------|------------------------------------------------|
| Linear (Phase A)         | `{ "default" : "<next-step-id>" }`             |
| Linear ending            | `null` → enrolment ends as `completed_exhausted` |
| `conditional_split` (B)  | `{ "yes" : "<id>", "no" : "<id>" }`            |
| `switch_case` (B)        | `{ "cases" : { "val1" : "<id>", … }, "default" : "<id>" }` |

Step executors return a `{ navigateTo : string }` field telling the
engine which key to look up in `next_step_ids`. Phase A executors
always return `navigateTo : 'default'`. Phase B's branching executors
return `'yes' / 'no'` or the matched case key. The engine is
type-agnostic — it just does a lookup.

This is the single architectural decision that unlocks the whole
roadmap. Once the engine reads `next_step_ids` instead of
`step_order + 1`, every future step type that emits branches plugs in
without engine changes.

### Polymorphic predicates (`condition` + `filter`)

Both `condition` and `filter` on a step are `jsonb` payloads with a
small DSL shape :

```typescript
type SequencePredicate = {
  type: string;             // e.g. 'if_no_inbound', 'contact_property_eq'
  config?: Record<string, unknown>;
} | null;                   // null = always true
```

A central `SequencePredicateEvaluatorFactory` maps `type` to a concrete
evaluator class :

```
lib/sequences/predicates/predicate-evaluator.ts
  interface SequencePredicateEvaluator {
    type: string;
    evaluate(ctx: PredicateEvaluationContext): boolean;
  }

  PredicateEvaluationContext = {
    contact, company, organization, enrolment,
    sequenceStepExecutions, interactions, now
  }
```

Phase A registers 6 history-based condition evaluators
(`AlwaysEvaluator`, `IfNoInboundEvaluator`, `IfRespondedEvaluator`,
`IfPositiveReplyEvaluator`, `IfNegativeReplyEvaluator`,
`IfNoAnswerEvaluator`). 0 filter evaluators registered. The factory
throws a typed `UnknownPredicateTypeError` if asked for a type that
isn't registered — surfaced as a publish-time validation error.

Phase B adds `ContactPropertyEqEvaluator`,
`CompanyPropertyInEvaluator`, `IfWeekdayInEvaluator`, etc. as new
classes registered with the Factory. Phase C may add an
`AndEvaluator` / `OrEvaluator` / `NotEvaluator` for composition if
the flat model proves insufficient.

At step execution time the engine evaluates `filter` first (skip the
step if false → no execution, just advance via `next_step_ids.default`,
increment a `skipped` counter on the execution row) then `condition`
(same skip behaviour if false). Both null = both pass.

### Step executors (Strategy + Factory)

Same pattern as `MimeMessageBuilder`, `CsvImporter`, `LlmStrategy`,
`ScoringStrategy` already in the codebase.

```
lib/sequences/step-executor.ts
  interface SequenceStepExecutor {
    actionType: SequenceStepActionType;
    execute(ctx: StepExecutionContext): Promise<StepExecutionResult>;
  }

  StepExecutionContext = {
    enrolment, step, contact, company, organization,
    db, services, locale  // locale = resolved for this enrolment
  }

  StepExecutionResult = {
    taskId?: string;
    navigateTo?: string;      // key in next_step_ids
    markEnded?: SequenceEnrolmentEndReason;
    skippedReason?: string;
  }
```

Phase A executors :

- `ManualTaskStepExecutor` (`create_task_manual`) — `createTask`,
  passes `sequenceEnrolmentId`.
- `AiDraftTaskStepExecutor` (`create_task_with_ai_draft`) — `createTask`
  + `MessageGenerationOrchestrator.generate(ctx)` with locale =
  `contact.preferredLanguage` + insert `messages` row with
  `status='draft'`. Graceful fallback to a no-draft task on generation
  error.
- `WaitDelayStepExecutor` (`wait_delay`) — schedules `next_due_at` to
  `now + duration_value × duration_unit`. If condition is false, skips
  the wait (advance immediately).
- `EnrollInSequenceStepExecutor` (`enroll_in_sequence`) — `action_config
  = { target_sequence_id, start_at_step }`. Creates a new enrolment on
  target_sequence for the same (company, contact, assignee), running
  through the eligibility checker. Ends the current enrolment with
  `end_reason='cascaded'`.
- `EndSuccessStepExecutor` (`end_success`) — returns
  `{ markEnded: 'success' }`.

Phase B / C just register new executor classes with the Factory. The
engine's hot loop never changes.

### Locale resolution (`LocalizedString`)

```
lib/sequences/locale-resolver.ts

type LocalizedString = string | { [locale: string]: string } & { default?: string };

function resolveLocalizedString(
  value: LocalizedString,
  ctx: { contact, company, organization }
): string {
  if (typeof value === 'string') return value;
  const candidates = [
    value[ctx.contact.preferredLanguage],
    value[ctx.company.primaryLocale],
    value[ctx.organization.defaultLocale],
    value.default,
    Object.values(value).find(v => typeof v === 'string'),
  ];
  return candidates.find(c => typeof c === 'string') ?? '';
}
```

All contact-facing fields in `action_config` are typed `LocalizedString` :

- `create_task_*.action_config.titleTemplate`
- `create_task_with_ai_draft.action_config.orientation`
- `create_task_manual.action_config.description`
- (Phase B) `property_update.action_config.value` (when textual)
- (Phase C) `send_email_auto.action_config.{subject, body}`

The Phase A UI shows a single text input by default. A small
"+ langue" button next to each field opens a panel where the user can
provide alternates per locale + a `default`. The persistent shape is
`LocalizedString`.

### Draft + publish + lock

Same model as discussed in the iteration :

```
sequences:
  draft_definition jsonb            -- null = no pending draft
  draft_saved_at timestamptz        -- last saveDraft timestamp
  editing_locked_by uuid            -- user_id of the lock holder
  editing_locked_at timestamptz     -- when the lock was acquired
```

Three logical states :

- **Draft (never published)** : `is_active=false`,
  `draft_definition != null`, 0 rows in `sequence_steps`. The engine
  ignores it.
- **Published, no pending edit** : `is_active=true`,
  `draft_definition=null`, N rows in `sequence_steps`.
- **Published with pending edit** : `is_active=true`,
  `draft_definition != null`, N rows in `sequence_steps`. The engine
  runs the live def, the user sees the draft in the editor.

The `SequenceEditingService` exposes `startEditing`, `saveDraft`,
`publishDraft`, `discardDraft`, `takeOverStaleLock`. Lock acquisition
is an atomic conditional `UPDATE`. Publish is a single transaction
that updates the `sequences` row + replaces the `sequence_steps` rows.

Publish impact preview : a small modal counts how many active
enrolments will overshoot the new step count and reports
`{ unaffected, ending_exhausted_after_publish }`. Other types of edit
impact (content changes, condition flips, new step inserted in the
middle) are silent.

### Engine + scheduler (Inngest)

Two Inngest functions :

1. **`sequence-tick`** — cron, runs every 10 min during business hours
   on weekdays, every hour at night & weekends (same cadence model as
   the Gmail reply poller). Fans out to one event per active enrolment
   with `next_due_at <= now`.

2. **`sequence-advance-enrolment`** — per-enrolment handler triggered
   by the tick and by `task/completed` events. Steps :

   1. Reload the enrolment + the published sequence + the current step.
   2. Hard-reject : contact opted out → end as `stopped_opted_out`.
   3. Resolve locale (`contact.preferredLanguage` with the chain).
   4. Evaluate the step's `filter` predicate. If false : log skipped,
      advance via `next_step_ids.default`, schedule the next step.
   5. Evaluate the step's `condition` predicate. If false : same as
      filter, log skipped + advance.
   6. Call `SequenceStepExecutorFactory.forActionType(step.actionType)
      .execute(ctx)`.
   7. Persist the `sequence_step_executions` row (idempotent on
      `(enrolment_id, step_order)`).
   8. Use the executor's `navigateTo` to pick the next step from
      `next_step_ids`, or end the enrolment if `markEnded` is set or
      `next_step_ids` is null.

`task/completed` event : when a sequence-generated task is closed
(Gmail send / mark done / log interaction), the task action layer
publishes an Inngest event `task/completed` with the
`sequence_enrolment_id`. That immediately triggers
`sequence-advance-enrolment` so the next step schedules without
waiting for the next cron tick.

### Idempotence + loop safety

`sequence_step_executions(enrolment_id, execution_counter)` has the
UNIQUE constraint. The engine reads
`enrolment.last_execution_counter`, computes `next = current + 1`,
and inserts the execution row with that value. If Inngest's
at-least-once delivery double-fires the handler, the second insert
violates the constraint → caught, logged, no-op. Same idempotence
guarantee as before, but loops are now supported because the same
`step_id` can appear in multiple execution rows with different
counters.

Before any executor runs, the engine checks
`enrolment.last_execution_counter + 1 <= enrolment.max_execution_count`.
If exceeded, the enrolment ends with
`end_reason='safety_loop_cap_reached'` and is logged for audit.
Default cap is 200 step executions per enrolment, configurable
per-enrolment (and per-sequence later via a default override on
the sequence row).

Loops as a feature : the graph navigation model
(`next_step_ids jsonb`) doesn't distinguish forward vs backward
pointers. A step can point to an earlier step's id and the engine
just follows. Phase A doesn't expose any UI affordance to create
loops, so the data model is loop-ready but no user can introduce
them via the editor. Phase B adds the affordance (drag the next
pointer to an earlier step → visualised as a back-arrow chip).

## Data model

```sql
-- ===========================================================================
-- Enums
-- ===========================================================================

CREATE TYPE sequence_status AS ENUM (
  'active', 'paused',
  'completed_exhausted', 'completed_success', 'completed_cascaded',
  'stopped_opted_out', 'stopped_manual'
);

CREATE TYPE sequence_step_action_type AS ENUM (
  -- Phase A :
  'create_task_manual',
  'create_task_with_ai_draft',
  'wait_delay',
  'enroll_in_sequence',
  'end_success'
  -- Phase B will ALTER TYPE ADD VALUE 'conditional_split', 'switch_case',
  --                                    'property_update', 'tag_update', …
  -- Phase C will ALTER TYPE ADD VALUE 'send_email_auto', 'ai_reply_auto',
  --                                    'webhook', 'internal_alert', 'slack_notify'
);

CREATE TYPE sequence_step_delay_unit AS ENUM (
  'minutes', 'hours', 'days'
);

CREATE TYPE sequence_end_reason AS ENUM (
  'exhausted', 'success', 'cascaded', 'opted_out', 'manual',
  'safety_loop_cap_reached'   -- triggered when an enrolment exceeds
                              -- max_execution_count (anti-infinite-loop)
);

-- ===========================================================================
-- Tables
-- ===========================================================================

CREATE TABLE sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,

  -- Targeting (eligibility) — all empty arrays = no restriction.
  -- Locale targeting goes here too (uses contact.preferredLanguage at
  -- enrolment time) so we don't need a sequence.locale column :
  target_relationship_types text[] NOT NULL DEFAULT '{}',
  target_site_types          text[] NOT NULL DEFAULT '{}',
  target_contact_roles       text[] NOT NULL DEFAULT '{}',
  target_locales             text[] NOT NULL DEFAULT '{}',

  -- Built-in exclusion guards (Phase A) :
  exclude_if_company_has_active_sequence boolean NOT NULL DEFAULT true,
  exclude_if_company_relationship_in     text[]  NOT NULL DEFAULT '{}',
  cooldown_after_completed_days          int,     -- null = no cooldown

  -- Draft + publish + lock cycle :
  draft_definition jsonb,                          -- null = no pending draft
  draft_saved_at timestamptz,
  editing_locked_by uuid,
  editing_locked_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_sequences_org_active ON sequences(organization_id, is_active);

CREATE TABLE sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,

  -- step_order = display hint only. Engine navigates via next_step_ids.
  step_order int NOT NULL,

  action_type sequence_step_action_type NOT NULL,
  action_config jsonb NOT NULL DEFAULT '{}',
  -- action_config shapes (Phase A) :
  --
  -- create_task_manual : {
  --   taskType, channel, intent,
  --   titleTemplate: LocalizedString,
  --   description?:  LocalizedString
  -- }
  --
  -- create_task_with_ai_draft : {
  --   taskType, channel, intent,
  --   titleTemplate: LocalizedString,
  --   orientation?:  LocalizedString,
  --   includeSignal: bool
  -- }
  --
  -- wait_delay : {
  --   duration_value: int,
  --   duration_unit: 'minutes'|'hours'|'days'
  -- }
  --
  -- enroll_in_sequence : {
  --   target_sequence_id: uuid,
  --   start_at_step: int default 1
  -- }
  --
  -- end_success : {}

  -- Navigation : where to go after this step. Phase A always
  -- { "default": "<next-step-id>" } or null for terminal.
  -- Phase B will use { "yes", "no" } or { "cases", "default" }.
  next_step_ids jsonb,

  -- Predicates : both null = always execute. Both jsonb of shape
  -- { type: string, config?: object }.
  -- Phase A only ships condition evaluators ; filter is null in Phase A.
  condition jsonb,
  filter    jsonb,

  UNIQUE (sequence_id, step_order)
);

CREATE TABLE sequence_enrolments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sequence_id uuid NOT NULL REFERENCES sequences(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id)  ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES contacts(id)   ON DELETE CASCADE,
  assignee_id uuid,                                          -- rep user_id

  status sequence_status NOT NULL DEFAULT 'active',

  -- current_step_id : which step the engine should execute next.
  -- step_order is also kept for fast "have we overshot the new step count
  -- after publish ?" queries in the impact preview modal.
  current_step_id    uuid NOT NULL REFERENCES sequence_steps(id),
  current_step_order int  NOT NULL,
  next_due_at        timestamptz NOT NULL,

  -- Loop safety + idempotence machinery. last_execution_counter is the
  -- monotonic counter that backs the UNIQUE constraint on
  -- sequence_step_executions(enrolment_id, execution_counter). A step can
  -- be re-visited (loops are supported by the graph nav model), each
  -- visit gets a new execution_counter. max_execution_count is the
  -- safety cap that prevents a misconfigured loop from running forever ;
  -- when reached the engine ends the enrolment with
  -- end_reason='safety_loop_cap_reached'.
  --
  -- Phase A : no UI to create loops, but the foundation supports them so
  --           Phase B can flip on the affordance with zero schema change.
  last_execution_counter int NOT NULL DEFAULT 0,
  max_execution_count    int NOT NULL DEFAULT 200,

  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,
  end_reason sequence_end_reason,

  -- "Only one active enrolment of the same sequence per contact"
  -- is enforced by a partial unique index :
  CONSTRAINT chk_end_consistency CHECK (
    (status IN ('active', 'paused') AND ended_at IS NULL AND end_reason IS NULL)
    OR
    (status NOT IN ('active', 'paused') AND ended_at IS NOT NULL AND end_reason IS NOT NULL)
  )
);

CREATE INDEX idx_seq_enrolments_due
  ON sequence_enrolments(organization_id, status, next_due_at);
CREATE INDEX idx_seq_enrolments_contact
  ON sequence_enrolments(contact_id, status);
CREATE UNIQUE INDEX uniq_seq_enrolments_active_per_contact
  ON sequence_enrolments(sequence_id, contact_id)
  WHERE status IN ('active', 'paused');

CREATE TABLE sequence_step_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrolment_id uuid NOT NULL REFERENCES sequence_enrolments(id) ON DELETE CASCADE,
  step_id      uuid NOT NULL REFERENCES sequence_steps(id),
  step_order   int  NOT NULL,                   -- display hint, NOT unique under loops
  action_type  sequence_step_action_type NOT NULL,

  -- Monotonic counter per enrolment ; matches the value of
  -- sequence_enrolments.last_execution_counter at the moment this row was
  -- inserted. Unique so two concurrent Inngest retries can't both succeed
  -- (idempotence guarantee, replaces the previous UNIQUE on step_order).
  -- Allowing the same step_id to appear with several execution_counter
  -- values is what enables loops.
  execution_counter int NOT NULL,

  executed_at  timestamptz NOT NULL DEFAULT now(),
  task_id      uuid,                            -- set for create_task_* executors
  outcome      text NOT NULL,                   -- 'executed' | 'skipped_filter' | 'skipped_condition'
  notes        text,

  UNIQUE (enrolment_id, execution_counter)
);

-- tasks : add a FK back to the enrolment so the task action layer
-- can publish the task/completed Inngest event with the enrolment id.
ALTER TABLE tasks ADD COLUMN sequence_enrolment_id uuid;
```

RLS : same 4-policy pattern as messages / message_attachments
(SELECT org + platform_admin, INSERT/UPDATE/DELETE org).

### AI drafts via existing `messages` table

No new schema for AI drafts. The `messages` table already has :
- `status` enum including `'draft' | 'sent'`
- `task_id` FK to tasks
- `content`, `llm_usage_id`, `subject` etc.

The `AiDraftTaskStepExecutor` inserts a `messages` row with
`status='draft'`, `task_id` set. The `GenerateMessageDialog` opened on
a task with a linked draft message skips the params step, jumps to the
result column pre-filled, shows a "Message IA · à valider" badge.
Send via Gmail flips the same row to `status='sent'`. No proliferation
of message rows on regenerate (overwrite content + llm_usage_id of the
same row).

## UI surfaces

### `/sequences` — index

- Cards grid : one card per sequence with name, # active enrolments,
  rough % responded.
- Status badge : "Brouillon" (never published) / "Publiée" / "En cours
  d'édition par {X}".
- Filter chips : active / inactive / all.
- "+ Nouvelle séquence" → flow described in `/sequences/new` below.

### `/sequences/[id]` — detail (read-only)

- Header : name, status, # active enrolments, last published date.
- Body : vertical list of steps with one card per step (icon + name +
  one-line summary of action_config). Read-only.
- Sidebar / lower section : recent enrolments table with contact,
  current step, status, last advance, next due, owner.
- "Modifier" button → calls `startEditingAction`, transitions to the
  edit view. Disabled with a banner if another user holds the lock.

### Edit view (React Flow editor)

The core UX win of Phase A. Three columns :

```
┌────────────┬───────────────────────────┬──────────────────────┐
│  PALETTE   │  FLOW CANVAS              │  DETAIL PANEL        │
│            │                           │                      │
│ Drag any   │  React Flow + Dagre       │  Form for the        │
│ of the 5   │  auto-layout. Each step   │  selected step's     │
│ step types │  is a custom node card    │  action_config       │
│ into the   │  with a "next" handle at  │  (Zod-validated      │
│ canvas to  │  the bottom. Edges drawn  │  live).              │
│ add it.    │  by Dagre, never by hand. │                      │
│            │                           │  + langue button on  │
│            │  Phase A : single column  │  every LocalizedStr  │
│            │  flow, the only branching │  field.              │
│            │  is sequential. Phase B   │                      │
│            │  : same canvas, side-by-  │  Predicate sub-form  │
│            │  side columns at branch   │  for condition (Phase│
│            │  points.                  │  A : 6 history types │
│            │                           │  in a small dropdown │
│            │  Drag a node from palette │  + custom config UI  │
│            │  → drops into the flow at │  per type).          │
│            │  the closest insertion    │                      │
│            │  point. Drag an existing  │                      │
│            │  node onto another's      │                      │
│            │  position → reorder       │                      │
│            │  (next_step_ids re-wired).│                      │
│            │  Click a node → selects   │                      │
│            │  it ; ✕ deletes (with     │                      │
│            │  pointer recoupling).     │                      │
└────────────┴───────────────────────────┴──────────────────────┘

Top bar : sequence name, draft saved indicator, Publier button (gated
by validation), Annuler (discard), pan-to-fit, zoom in/out, heartbeat
to refresh the lock.
```

Behaviour details :

- Each edit triggers a `saveDraftAction` debounced at 500 ms —
  autosave by default, no explicit save button.
- The save also refreshes the lock heartbeat (`editing_locked_at`).
- If the user idles 25 min, the editor sends a noop save to extend
  the lock. After 30 min stale, another user can take over from the
  detail page.
- Publier opens the impact preview modal (count of impacted
  enrolments) before the swap.
- Layout is recomputed by Dagre on every edit ; no x/y is persisted
  in the draft. The shape of `next_step_ids` fully determines what
  the user sees.
- Phase A node cards are intentionally simple (icon, action name,
  one-line summary, badge for condition if not 'always'). Phase B
  adds visual differentiation for branching nodes.

Stack :

- `@xyflow/react` (React Flow v12+, the modern React 19-compatible
  rebrand) for the canvas + interactions.
- `dagre` for auto-layout : rank direction top-to-bottom, ranker
  `network-simplex`, separators tuned for our card size.
- Custom node component `SequenceStepNode` rendered for every node ;
  Phase B adds variants for branching types.
- Custom edge component with the right routing (orthogonal vertical
  by default, curves on convergence in Phase B).
- The draft state is plain React state, mirrored to the server via
  `saveDraftAction`. No React Query needed.
- Zod schema for `SequenceDraftDefinition` shared between client +
  server.

Why React Flow over @dnd-kit :
- The data model is intrinsically a graph (next_step_ids jsonb), so
  rendering with edges is the natural visual fit even in Phase A's
  linear case.
- Avoids a UI rewrite at the Phase A → Phase B transition. Adding
  the branching step types in Phase B is purely incremental.
- React Flow has battle-tested support for pan / zoom / mini-map —
  features we may want as flows grow, with no extra work.
- A vertical drag-drop list with @dnd-kit would have been faster to
  ship in Phase A but locked us into a refactor.

### Enrolment surfaces

- "Enrôler dans une séquence" button on contact header → modal :
  - List of eligible sequences (with warning banner for soft mismatches).
  - Optional dropdown : "Démarrer à l'étape …" (default = step 1).
  - Assignee selector (default = current user or company's assignee).
  - Confirm → calls `enrolContactAction`.
- After contact create, if 1+ eligible sequences exist, a banner
  appears with "Tu peux l'enrôler dans : …" + an "Enrôler" button
  per sequence + "Plus tard" dismiss. No silent auto-enrol.
- Sequence badge on outbound interaction rows in the timeline.
- "Séquences en cours" section on the contact / company detail pages
  with Pause / Stop buttons per enrolment.

## Implementation plan

### Slice 1 — Schema + RLS + migration

- Add the four enums + four tables + the `tasks.sequence_enrolment_id`
  column + the partial unique index in `db/schema.ts`.
- Drizzle relations between sequences ↔ steps ↔ enrolments ↔
  executions.
- Migration generated, RLS policies appended manually, applied to
  local + cloud.

### Slice 2 — Foundation : types + predicates + executors

- `lib/sequences/types.ts` — shared types (`LocalizedString`,
  `SequencePredicate`, `StepExecutionContext`, etc.).
- `lib/sequences/locale-resolver.ts` — `resolveLocalizedString`.
- `lib/sequences/predicates/predicate-evaluator.ts` interface.
- 6 concrete evaluators :
  - `AlwaysEvaluator`
  - `IfNoInboundEvaluator`
  - `IfRespondedEvaluator`
  - `IfPositiveReplyEvaluator`
  - `IfNegativeReplyEvaluator`
  - `IfNoAnswerEvaluator`
- `SequencePredicateEvaluatorFactory`.
- `lib/sequences/step-executor.ts` interface.
- 5 concrete executors :
  - `ManualTaskStepExecutor`
  - `AiDraftTaskStepExecutor` (calls orchestrator, inserts draft `messages`)
  - `WaitDelayStepExecutor`
  - `EnrollInSequenceStepExecutor`
  - `EndSuccessStepExecutor`
- `SequenceStepExecutorFactory`.
- `SequenceEligibilityChecker` class.
- Unit tests for resolver, each evaluator, each executor.

### Slice 3 — Queries layer

- `db/queries/sequences.ts` — CRUD on sequences + steps.
- `db/queries/sequence-enrolments.ts` — CRUD + advance.
- `db/queries/sequence-step-executions.ts` — insert with idempotence.
- Helper `getEligibleSequencesForContact(orgId, contactId)` for the
  suggestion-at-create flow.

### Slice 4 — Actions layer

- `lib/sequences/sequence-editing-service.ts` — startEditing,
  saveDraft, publishDraft (transactional swap), discardDraft,
  takeOverStaleLock.
- `lib/actions/sequences.ts` :
  - `createSequenceAction` (unpublished + lock acquired).
  - `startEditingAction`, `saveDraftAction`, `publishDraftAction`,
    `discardDraftAction`, `takeOverStaleLockAction`.
  - `archiveSequenceAction`.
- `lib/actions/sequence-enrolments.ts` :
  - `enrolContactAction(sequenceId, contactId, opts)`.
  - `pauseEnrolmentAction`, `resumeEnrolmentAction`,
    `stopEnrolmentAction`.
- Typed error hierarchy in `lib/actions/sequence-action-errors.ts` :
  `SequenceNotFoundError`, `SequenceEditLockHeldError` (carries holder
  + acquired-at), `SequenceEditLockLostError`,
  `SequenceDraftInvalidError`, `ContactAlreadyEnroledError`,
  `SequenceNotEligibleHardError`, `UnknownPredicateTypeError`,
  `UnknownActionTypeError`, …

### Slice 5 — Inngest engine

- `inngest/functions/sequence-tick.ts` — cron + fan-out.
- `inngest/functions/sequence-advance-enrolment.ts` — per-enrolment
  handler.
- Publish `task/completed` Inngest event from the existing
  `completeTask` query helper when the task carries a
  `sequence_enrolment_id`.
- Idempotence relies on the unique constraint, retries swallowed
  cleanly.

### Slice 6 — Built-in templates

- `lib/sequences/built-in-templates.ts` :
  - "Hôtel Prospect — Premier contact" (7 steps, multi-step with
    AI draft, two waits, conditioned relances, ends in `end_success`).
  - "Bureau RH — Approche wellness" (6 steps).
  - "Agence prescriptrice — Onboarding" (5 steps).
- All `LocalizedString` fields populated with FR + EN inline.
- `getBuiltInTemplate(slug)` resolver.

### Slice 7 — UI : index + detail (read-only)

- `/sequences` index page (server component) with cards + filter
  chips + "+ Nouvelle séquence".
- `/sequences/[id]` detail page (read-only) with steps list +
  enrolments section + "Modifier" button.

### Slice 8 — UI : React Flow editor

- Install `@xyflow/react` + `dagre` + `@types/dagre`.
- `SequenceFlowEditor` client component : palette (left) + React Flow
  canvas (centre, with auto-layout) + detail panel (right).
- `SequenceStepNode` custom node component, rendered for every step,
  with action-type-specific icon + summary + condition badge.
- `SequenceStepEdge` custom edge with orthogonal vertical routing.
- Dagre layout hook : recomputes positions from
  `nodes + edges → { positionedNodes, positionedEdges }` on every
  graph change.
- `SequenceStepDetailPanel` with action_config form per action_type
  (Zod-validated live).
- `LocalizedStringInput` component (single-text by default, "+ langue"
  expands to multi-locale form, persists as `{ fr, en, default }`).
- `SequencePredicateForm` component (select condition type from the 6
  Phase A history options, no config for `always`, optional config
  for the others ; placeholder slot for filter, hidden in Phase A).
- `useSequenceDraft` hook : holds the draft state in React state,
  debounced `saveDraftAction`, lock heartbeat noop-save every 25 min,
  publish validation gating.
- Publish impact preview modal (counts of impacted enrolments via
  the "step count reduced" check).
- Edit lock banner + "Reprendre maintenant" button when the holder's
  lock is stale.
- Pan / zoom / fit-to-screen controls from React Flow (free, native).

### Slice 9 — UI : enrolment surfaces

- "Enrôler dans une séquence" button on contact header → modal.
- "Tu peux l'enrôler dans" banner after contact create.
- Sequence badge on interaction timeline.
- "Séquences en cours" section on contact + company detail.

### Slice 10 — i18n + verify

- `pages.sequences.*` namespace, FR + EN parity.
- `nav.sequences` already exists.
- Final tsc + lint + vitest + production build.
- End-to-end smoke : create sequence from template → enrol a contact →
  run a manual Inngest tick → complete the AI-drafted task via Gmail
  → observe the next step schedules → simulate a positive reply →
  confirm branching kicks in.

## Acceptance criteria

- [ ] Schema migration applies cleanly on a fresh DB and on the
      existing cloud DB.
- [ ] Creating a sequence : name + 3+ steps + targeting saved as a
      draft, no rows in `sequence_steps` until publish.
- [ ] Eligibility checker hard-rejects opted-out contacts ; soft-warns
      on targeting mismatches.
- [ ] Manual enrolment at step N > 1 starts the enrolment at the
      right place ; `next_due_at` matches the chosen step's expected
      schedule.
- [ ] Inngest tick picks up a due enrolment, the right executor runs,
      the execution row is written, the cursor advances via
      `next_step_ids.default`.
- [ ] A `create_task_with_ai_draft` step populates a `messages` row
      with `status='draft'` linked to the task, with content in the
      contact's `preferredLanguage` ; the GenerateMessageDialog opens
      pre-filled.
- [ ] LLM provider down : the AI draft executor still creates a task
      (without a draft), engine doesn't get stuck.
- [ ] Completing the task immediately schedules the next step via
      `task/completed` (no need to wait for the next cron tick).
- [ ] A positive reply (interaction with positive outcome) flips the
      `if_positive_reply` branch on the next tick ; sequence does NOT
      auto-terminate.
- [ ] `enroll_in_sequence` step ends the current enrolment with
      `end_reason='cascaded'` and creates a new enrolment on the
      target, with `start_at_step` honoured.
- [ ] `wait_delay` schedules `next_due_at` correctly for all three
      units (minutes / hours / days). A `wait_delay` with a false
      condition skips immediately.
- [ ] `LocalizedString` resolver returns the right value through the
      4-step fallback chain.
- [ ] User A clicks "Modifier", user B is rejected with a "verrou tenu"
      banner. After 30 min idle, B can take over.
- [ ] saveDraft updates `draft_definition`, engine continues to run
      the live def. publishDraft swaps atomically. discardDraft
      restores `draft_definition` to null.
- [ ] Publish that reduces the step count below at least one active
      enrolment's cursor shows the impact preview modal ; after
      publish, those enrolments end as `completed_exhausted` on next
      tick.
- [ ] Drag a palette item into the canvas → new step inserted with the
      default action_config, next_step_ids re-wired.
- [ ] Drag a step inside the canvas → reorder with correct
      next_step_ids recoupling.
- [ ] An enrolment manually crafted with a back-pointing `next_step_ids`
      (loop) executes correctly through several iterations, each in its
      own `execution_counter`, and ends with
      `safety_loop_cap_reached` once the cap is hit.
- [ ] All queries filter by `organization_id` ; RLS smoke test passes.
- [ ] FR + EN i18n keys, no hardcoded UI text.
- [ ] tsc + lint + vitest + production build pass.

## Forward compatibility — how Phase B and C add without breaking

Every Phase A architectural choice is designed so Phase B and Phase C
extend without schema migration, engine refactor, or UI rewrite.

| Layer | Phase A delivery | Phase B addition | Phase C addition |
|---|---|---|---|
| `sequence_step_action_type` enum | 5 values | `ALTER TYPE ADD VALUE` x4 (split, switch, property_update, tag_update) | `ALTER TYPE ADD VALUE` x5 (send_auto, ai_reply_auto, webhook, internal_alert, slack_notify) |
| `action_config jsonb` | Phase A shapes | New shapes for new types | New shapes |
| `next_step_ids jsonb` | Always `{default}` | Now also `{yes,no}`, `{cases,default}` | Same |
| `condition`/`filter jsonb` | 6 condition evaluators | + property, time, composite evaluators | (saturated) |
| `SequenceStepExecutorFactory` | 5 executor classes | + 4 classes | + 5 classes |
| `SequencePredicateEvaluatorFactory` | 6 evaluator classes | + N classes | + N classes |
| Engine logic | reads `next_step_ids` + predicates + Factory | unchanged | unchanged |
| UI editor | React Flow + Dagre, single-column linear | + branching node variants → Dagre auto-renders side-by-side columns ; affordance to drop a next handle on any node (skip-ahead, back-loop) | (zoom/pan already free) ; possibly mini-map ; never manual x/y canvas |
| `messages` table | draft consumed by GenerateMessageDialog | unchanged | `send_email_auto` updates the same row to `sent` |
| Loops | data model ready (back-pointer in `next_step_ids`, monotonic `execution_counter`, safety cap), no UI | editor affordance to point a step's next handle to an earlier step | (saturated) |
| Auto-send infra | n/a | n/a | hold window, confidence floor, URL tracking, quiet hours |

Sequences created in Phase A keep working unchanged in B and C. New
features are opt-in via the new step types and predicates.

## Roadmap towards the mockup

### Phase B — Branching + filters + data nodes (Sprint ~12)

- New step types : `conditional_split` (yes/no), `switch_case`
  (n-way, our innovation over Klaviyo), `property_update`,
  `tag_update`.
- New predicate evaluators : property-based (`contact_property_eq`,
  `company_property_in`, `if_weekday_in`, `if_hour_in`), composite
  AND/OR/NOT if needed.
- UI : branching chips + sub-list indentation in the same vertical
  editor. No canvas 2D.

### Phase C — Auto-send + tracking + integrations (Sprint ~13-14)

- New step types : `send_email_auto`, `ai_reply_auto`, `webhook`,
  `internal_alert`, `slack_notify`, `trigger_split`.
- Auto-send infrastructure :
  - Hold window (e.g. 5 min) for rep cancel before send.
  - Confidence floor fallback to `create_task_with_ai_draft`.
  - Per-user send cap for Gmail deliverability.
  - URL rewriting + click tracking endpoint (`/api/track/click/[token]`).
  - Open pixel (`/api/track/open/[token]`).
- Org-level quiet hours config.
- TEST mode flag on sequences (forces auto-send executors to fall
  back to draft mode + UI banner).
- Per-step metrics : sent / opened / clicked / replied.
- Optional : zoom + pan on the editor if real usage requires it. The
  canvas 2D positioning probably never ships unless we see strong
  signal for it.

### V1.5 / V2 follow-ups

- Composite eligibility DSL (replace flat array filters with a JSONB
  tree if needed).
- Switch-contact intra-séquence executor.
- A/B variants on a step.
- Org-level sequence template library (extension of the built-in
  templates, with cross-org sharing).
- Prescriber-specific patterns (a step that creates a "thank a
  prescriber for the intro" follow-up loop).

## Implementation notes

Shipped 2026-05-29 (Opus 4.8). Structure complete, a few features deliberately
deferred (the user asked for the full structural rollout, limited features OK).

### Schema decisions

- **`tasks.sequence_run_id` reused as the enrolment FK** (Drizzle property
  `sequenceEnrolmentId`) → zero migration on `tasks`, purely additive.
- **`current_step_id` and `sequence_step_executions.step_id` are SOFT references
  (no FK)** — migration `20260529121500_sequences_soft_step_refs`. Publish swaps
  the whole `sequence_steps` set (new UUIDs), so a hard FK would block the swap
  and the executions audit must survive it. The engine resolves the live step by
  id with a fallback to `current_step_order`, ending overshoot enrolments as
  `completed_exhausted`. This migration is applied **local only** — cloud push
  still pending (additive `DROP CONSTRAINT IF EXISTS`, safe to replay).
- The drizzle snapshot was regenerated (0015) but its `.sql` was removed from
  `db/.drizzle-out/` to avoid `db:sync` duplicating the hand-written idempotent
  migration. Snapshot + journal retained so future diffs are correct.

### Architecture (all OOP per house style)

- **Predicates**: `SequencePredicateEvaluator` Strategy + `…Factory` registry
  (6 history evaluators). **Executors**: `SequenceStepExecutor` Strategy +
  `SequenceStepExecutorFactory` (5 action types). New types register with no
  engine change.
- **Locale is data, not flow**: `resolveLocalizedString` fallback chain
  contact.preferredLanguage → company.primaryLocale → org.defaultLocale →
  `default` → any. `LocalizedString` everywhere on contact-facing copy.
- **Editing**: `SequenceEditingService` (lock / draft / publish / discard /
  impact preview) + factory (RLS pool). Publish = single transaction: validate
  graph → remap author ids to UUIDs → replace steps → clear draft + lock.
- **Eligibility**: pure `SequenceEligibilityChecker` (opt-out hard reject + 3
  guards: active-on-contact, active-on-company, cooldown). `SequenceEnrolmentService`
  loads facts + enrols. **Engine**: `SequenceEngine` (admin pool) +
  `EngineExecutorServices` + factory. Idempotent on `(enrolment_id,
  execution_counter)`; loop cap via `max_execution_count`.
- **Inngest**: `sequence-tick` (2 crons, business vs off-hours) fans out
  `sequences/advance`; per-enrolment handler also listens to
  `sequences/task.completed` (emitted from task completion in `tasks.ts` +
  `messages.ts`).

### Deferred in Phase A (structure present, feature limited)

- **AI draft at cron time** — `EngineExecutorServices.generateDraftForTask` is a
  no-op returning `{drafted:false}`. Running the message orchestrator inside the
  cron would fight RLS and produce a stale draft; the task is created and the rep
  generates a fresh draft on open via the existing dialog (action_config carries
  channel/intent/orientation). Wire it up in Phase B if desired.
- **Publish impact-preview modal** — `previewPublishImpact()` exists on the
  service but isn't surfaced in the editor UI; publish proceeds directly and the
  engine ends overshoot enrolments on next tick.
- **Predicate window** — the engine passes interactions since `enrolment.startedAt`
  (not since the previous step) to the evaluators. Fine for the Phase-A history
  predicates ("have they ever replied"); tighten in Phase B if needed.
- **Drag-to-reorder** — the React Flow editor uses dagre auto-layout (no free
  positioning); steps are added via the palette and linked by dragging edges.
  Entry = lowest `step_order`.

### Tests

`tests/sequences/` — locale resolver, 6 predicate evaluators + factory,
eligibility checker, 5 executors + factory, targeting matcher, draft-schema graph
validator, built-in templates (each validated against the graph validator). 65
sequence tests green. The engine itself is orchestration over unit-tested parts
(no dedicated integration test yet). The 4 pre-existing
`message-generation-orchestrator` failures are unrelated (fail on `main` too).
