# 13 — Sequence versioning & in-flight enrolment isolation

> Make sequence edits safe : `sequence_steps` IDs stable across publishes,
> in-flight enrolments isolated from edits, draft / publish cleanly
> separated.

## Why

Today, every publish of a sequence **recreates** the `sequence_steps`
rows (DELETE-then-INSERT). This has two compounding consequences :

1. **Step IDs drift.** Anything that references `sequence_step.id` from
   outside (`step_executions.step_id`, the diagram coloring, links in
   the editor history) becomes stale the moment you republish.
2. **In-flight enrolments lose context.** When a publish reshuffles
   `nextStepIds`, an enrolment that was about to read its next step at
   wake-up time reads the new topology — which may have a different
   "next", or none at all. Effect : enrolments mysteriously end early,
   skip steps, or jump to a step that wasn't in their original plan.

Sprint 12 phase 6 added a `step_order` fallback in two places (the
engine's cursor resolver and the diagram coloring) to mitigate the
worst symptoms, but it's a patch, not a fix.

Real solution = two independent changes :

- **Stable step IDs** : publishes UPDATE existing `sequence_steps` rows
  instead of recreating them. Removes the drift root cause.
- **Snapshot per enrolment** : every enrolment captures the published
  definition at start time and the engine reads from that snapshot.
  Edits to the live sequence affect new enrolments only.

The two are orthogonal — stable IDs fix the UI / observability ; the
snapshot fixes the engine semantics for in-flight enrolments.

## Prerequisites

- ✅ Sprint 11 (sequences phase A) — the engine and editor exist.
- ✅ Sprint 12 (sequences phase 4 — agent auto-execute) — surfaces the
  terminal-step + step-id-drift bugs that motivated this work.

## Out of scope

- Versioning at the sequence level for analytics / "show me how V2
  performed vs V1". Worth doing later but solved independently of the
  isolation problem here.
- Editor UI for "rollback to previous version". Same.
- A/B testing different versions of a sequence on the same audience.
  Different feature.

## Design

### Part 1 — Stable step IDs (UPDATE-in-place publish)

Today's publish flow (`sequence-editing-service.ts` `publishDraft`) :

```
BEGIN
  DELETE FROM sequence_steps WHERE sequence_id = $1;
  INSERT INTO sequence_steps (id, sequence_id, step_order, ...) VALUES (...);
COMMIT
```

New flow :

```
BEGIN
  -- 1. resolve which draft step matches which existing row, by id
  draftIds = { s.id for s in draft.steps }
  existingIds = SELECT id FROM sequence_steps WHERE sequence_id = $1

  -- 2. UPDATE matched rows
  for each draft step where id in existingIds:
    UPDATE sequence_steps SET (step_order, action_type, action_config,
      next_step_ids, condition, filter, updated_at) = (...) WHERE id = ...

  -- 3. INSERT new rows
  for each draft step where id NOT in existingIds:
    INSERT INTO sequence_steps (id, sequence_id, step_order, ...)

  -- 4. soft-archive removed rows (NOT delete : enrolments may point here)
  UPDATE sequence_steps
    SET archived_at = now()
    WHERE sequence_id = $1
      AND id NOT IN (draftIds)
      AND archived_at IS NULL
COMMIT
```

Schema additions :

- `sequence_steps.archived_at timestamptz NULL`
- Indexes : `(sequence_id, archived_at) WHERE archived_at IS NULL` for
  the "active steps" reads.
- Query helpers : `getStepsForSequence` filters out archived by default,
  with an opt-in flag for the engine cursor's fallback.

Engine impact :

- `sequence-engine.ts` lines 96-98 already do id-first / step_order
  fallback. Keep both ; the fallback now only matters for old enrolments
  predating this migration (and even those work since IDs are stable
  from now on).
- A new check : if the resolved step is `archived_at != null`, behave
  like "step deleted" (= end the enrolment with reason `step_removed`
  or `exhausted` — TBD).

UI impact :

- The editor's "draft from published" seeder (`publishedStepsToDraft`)
  already preserves IDs. No change.
- Step deletion in the editor : keep the row id around as "marked for
  archive on next publish" until the publish completes.

Migration plan :

- Additive only (just adds `archived_at`). Existing data unaffected.
- Backfill = no-op (all existing rows stay `archived_at = null`).
- Cloud + local apply in the usual order (cloud first via
  `supabase db push`, then `supabase migration up --local`).

### Part 2 — Snapshot per enrolment

A new table `sequence_enrolment_steps` captures the published
definition at the moment each enrolment starts :

```sql
CREATE TABLE sequence_enrolment_steps (
  id              uuid PRIMARY KEY,
  enrolment_id    uuid NOT NULL REFERENCES sequence_enrolments(id)
                    ON DELETE CASCADE,
  source_step_id  uuid NOT NULL,  -- which sequence_steps row this is a copy of
  step_order      integer NOT NULL,
  action_type     sequence_step_action_type NOT NULL,
  action_config   jsonb NOT NULL,
  next_step_ids   jsonb,
  condition       jsonb,
  filter          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrolment_id, source_step_id)
);
```

`step_executions.step_id` references **the snapshot row's source_step_id**
(or the snapshot row's own id — TBD, the diagram needs to decide which
keys it joins on). The natural choice : keep `step_executions.step_id`
pointing at the snapshot's `source_step_id` so it matches the live
`sequence_steps.id` when the user hasn't republished. The diagram
coloring's id-first then step_order fallback still works.

Engine impact :

- `getStepsForSequence(db, sequenceId)` becomes
  `getStepsForEnrolment(db, enrolmentId)` reading from
  `sequence_enrolment_steps`. Same shape, different source.
- The engine becomes deterministic per enrolment : reading the snapshot
  table never changes its result for a given enrolment.

Storage cost : N enrolments × ~5-20 steps × JSON config. For L&G's
expected volume (a few thousand enrolments per year, 5-10 steps each),
under 100k rows — trivial.

Enrolment creation impact :

- The enrolment-start path (sequence-engine + auto-enrol triggers)
  inserts the snapshot rows in the same transaction as the enrolment
  row itself. Failure to snapshot = enrolment rolled back.
- Migration backfill : for existing enrolments, snapshot the current
  `sequence_steps` rows (best-effort — they may already be drifted from
  what was published when the enrolment started, but it's the closest
  approximation available).

UI impact :

- The enrolment-detail diagram reads `sequence_enrolment_steps`, not
  the live `sequence_steps`. Coloring becomes exact.
- The sequence-detail diagram (read-only view of the published flow)
  still reads `sequence_steps`. Two views, two sources.

### Part 3 — Draft / publish cleanly separated

Today the draft state lives in `sequence_drafts` (per-user JSON blob,
already separated from the live `sequence_steps`). The publish flow is
already an atomic transaction. The only thing missing is the publish
**audit log** :

```sql
CREATE TABLE sequence_publishes (
  id              uuid PRIMARY KEY,
  sequence_id     uuid NOT NULL REFERENCES sequences(id),
  published_by    uuid NOT NULL REFERENCES users(id),
  published_at    timestamptz NOT NULL DEFAULT now(),
  step_count      integer NOT NULL,
  notes           text  -- optional release note
);
```

Light. Useful when debugging "why did this enrolment behave weirdly —
was there a publish in the middle of its run ?".

## Acceptance criteria

- [ ] Publishing a sequence preserves step IDs across runs (verifiable
      via `select id from sequence_steps where sequence_id = X` before
      and after a publish).
- [ ] Reordering steps in the editor (swap 2 and 3) does NOT alter
      `step_executions.step_id` references — the diagram still colors
      both steps correctly for past enrolments.
- [ ] Deleting a step in the editor + publishing soft-archives the row.
      An enrolment parked on it terminates with a clear reason on next
      wake-up, instead of silently going wrong.
- [ ] An enrolment started before a publish keeps its original
      trajectory regardless of edits made to the live sequence. Test :
      enrol, advance to step 2, publish a swap of steps 3/4, wait for
      task at step 2 to close, observe engine takes the ORIGINAL step 3
      (not the swapped one).
- [ ] `sequence_publishes` audit log gets one row per publish.
- [ ] Existing enrolments at migration time keep working (backfill
      snapshot from current sequence_steps).

## Implementation plan (rough sizing)

Sub-sprint 13.1 — stable IDs (+ archived_at). 1-2 days.
Sub-sprint 13.2 — snapshot table + engine read path swap. 2-3 days.
Sub-sprint 13.3 — publish audit log. 0.5 day.
Sub-sprint 13.4 — backfill migration + dogfood validation. 0.5 day.

Total ~4-6 days of work. Not urgent unless the L&G dogfood starts
hitting it (e.g. they want to edit a sequence mid-campaign).

## Open questions

- What's the right `end_reason` for "the step under your cursor was
  removed in a publish" ? New variant `step_archived` ? Or fold into
  `exhausted` ?
- Do we surface the snapshot vs live divergence in the UI ? Banner on
  the enrolment detail : "this enrolment is running on a previous
  version of the sequence" ?
- Once we have publish history, is there value in showing
  per-publish-version metrics (open rate, reply rate) ? Probably yes
  but it's a V2 feature.
