# 14 — Agent auto-execution resilience

> Make the agent send pipeline survive transient infrastructure failures
> (DB pool exhaustion, Gmail timeouts, Inngest network blips) without
> double-sending emails or silently dropping tasks.

## Why

The current `AgentMessageExecutor` catches every error and **returns**
`{status: "failed"}` instead of throwing. The reasoning was good — if
the mail was already sent and we just failed at persisting, an Inngest
retry would send it twice. But the cost is high :

1. **Silent drops.** When the DB pool is exhausted (the
   `EMAXCONNSESSION` errors we hit in prod on 2026-06-05),
   `markTaskAutoExecutionFailed` itself plants — the catch-of-catch
   logs and we return success. Inngest sees the step succeed, no retry.
   The task stays in `auto_execution_status = "pending"` forever.
2. **No retry on transient errors.** Network blip to Inngest, momentary
   Gmail 5xx, Vercel cold-start timeout — all symptoms a one-shot retry
   would fix. We absorb them.
3. **The "Reprendre la main" workflow is the only recovery path** and
   it requires a human to spot the stuck task.

Inngest already gives us retry-with-backoff for free. The blocker is
the "no double send" invariant. The fix is **idempotence**, not
catching-everything.

## Prerequisites

- ✅ Sprint 12 phase 4 (agent auto-execute pipeline + storage RLS fix).
- ✅ The connection pool fix on env vars (transaction pooler / port
  6543 for `SUPABASE_POSTGRES_URL` and `SUPABASE_POSTGRES_DIRECT_URL`)
  eliminates the immediate symptom, but the resilience gap survives
  any future transient failure.

## Design

### Part 1 — Idempotent send (so retries are safe)

Before each external action that has at-most-once semantics, check
whether the action has already happened :

- **Gmail send** : before calling `GmailService.send(...)`, check if a
  `messages` row already exists with `task_id = currentTaskId`. If yes
  AND it has a `gmail_message_id` AND status is `sent`, skip the send,
  treat it as already-done, just complete the task and emit the
  `sequences/task.completed` event.
- **`logInteraction`** : same — if an `interactions` row already exists
  for this task in the relevant time window, skip the insert.
- **`completeTask`** : already idempotent (UPDATE with no-op when
  status is already "completed").
- **`emitSequenceTaskCompleted`** : Inngest dedupes events by (name +
  data hash + 60s window) by default, so emitting twice in close
  succession is a no-op. Beyond 60s, we'd send it again ; not a
  problem (`handleAdvance`'s top guard catches "already-executed
  terminal step").

With those checks in place, the executor can :

- **Throw all infrastructure errors** (DB connection, Inngest network,
  Gmail 5xx) → Inngest retries → on the retry, the idempotence checks
  short-circuit past the parts already done.
- **Mark + swallow business errors** (Gmail OAuth `invalid_grant`,
  Brand brief missing, no recipient on the contact) → those are NOT
  transient ; retrying won't help. Same behavior as today : mark task
  as failed, return.

### Part 2 — Retry policy on the Inngest function

Today the agent-auto-execute function uses Inngest defaults (3 retries,
exponential backoff). Tune for the new contract :

- Keep 3 retries for transient errors.
- After the 3rd retry, Inngest moves the run to "failed" — at that
  point, write `auto_execution_status = "failed"` with a clear reason
  ("retries exhausted") via a `step.run("mark-failed-after-retries")`
  that runs in the Inngest function's failure handler (`onFailure`
  in v3).

### Part 3 — Stuck-task scavenger (defense in depth)

Even with (1) and (2), edge cases happen (worker killed mid-step
before Inngest records the retry, etc.). Add a periodic scavenger :

- Cron : every hour.
- SELECT tasks where `auto_execution_status = "pending"` AND
  `auto_execution_at IS NULL` AND `scheduled_for < now() - interval
  '30 minutes'` (the 30-min grace covers `sleepUntil` precision).
- For each row, re-emit `sequences/task.auto-execute`. The function's
  upfront guards (`auto_execution_status === "pending"`, idempotence
  checks) handle the rest.

Light : a few SELECT + sendEvent per hour. Safe : idempotent.

## Acceptance criteria

- [ ] A retry-able infrastructure error (DB pool, Inngest blip) does
      NOT leave the task in `pending` ; it's either succeeded by retry
      or marked `failed` with a reason after retries exhausted.
- [ ] A double-emission of the auto-execute event for the same task
      results in exactly ONE Gmail send (verified by inspecting Gmail
      sent-folder for a duplicate).
- [ ] A task stuck in `auto_execution_status = pending` for more than
      30 minutes past its `scheduled_for` gets picked up by the
      scavenger within an hour.
- [ ] Business errors (OAuth `invalid_grant`, missing brand brief,
      invalid recipient) still short-circuit immediately with a clear
      `auto_execution_error` message — no wasteful retries.

## Implementation plan (rough sizing)

- 14.1 — Idempotence checks (messages, interactions). 0.5 day.
- 14.2 — Refactor `AgentMessageExecutor` : split transient vs business
  errors, rethrow the transient ones. 0.5 day.
- 14.3 — `onFailure` hook on the Inngest function. 0.25 day.
- 14.4 — Scavenger cron. 0.25 day.
- 14.5 — Tests : retry on transient, no-op on already-sent, business
  errors marked + no retry. 0.5 day.

Total ~2 days.

## Open questions

- The "messages row already exists for this task" check assumes we
  insert a `messages` row BEFORE the Gmail send. Today the order is
  reversed (Gmail first, then DB). The cleanest fix may be to insert
  a `messages` row in `status = "pending"` BEFORE the Gmail call, then
  update it to `sent` after — gives us a natural idempotence token and
  also lets us recover if we crash between the two steps.
- Do we want the scavenger to also handle "stuck after 24h" with an
  alerting hook (Sentry breadcrumb / email) rather than just retrying ?
  Probably yes for ops visibility — file under "future".
- For Gmail specifically, we could use the Gmail API's `thread_id`
  reservation pattern (draft → send) to get end-to-end idempotence —
  but it's complex. The pre-insert messages-row trick is simpler and
  good enough.
