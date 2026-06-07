# 15 — Sequence email threading (reply in previous thread)

> Follow-up emails sent by a sequence should land in the same Gmail
> thread as the first email, not as separate conversations. Standard
> for cold outreach tools ; without it, reply rates drop 2-3x.

## Why

When a sequence sends "Premier contact" then "Follow-up #1" then
"Follow-up #2", the recipient currently sees three independent
conversations in their inbox. They have no context for the follow-ups
and assume the rep doesn't remember the previous touchpoints. Reply
rates collapse.

Industry standard (Smartlead, Lemlist, Instantly, Outreach, Salesloft)
is to thread follow-ups under the first message :

- Same Gmail thread (passed as `threadId` to the send endpoint)
- `In-Reply-To: <previous-message-id>` MIME header
- `References: <chain>` building the linear history
- Subject prefixed `Re: ` (convention, helps spam filters too)

Secondary benefits :

- Better deliverability — Gmail / Outlook score continued threads
  differently than scattered isolated messages.
- The recipient can scroll back through the history while replying.
- If the contact replied in the thread, our reply-poller already
  picks it up via the thread id ; threading the outbound side closes
  the loop visually.

## Prerequisites

- ✅ Sprint 10 (Gmail send + reply polling) — `messages` table already
  carries `gmail_thread_id` + `gmail_message_id` columns.
- ✅ Sprint 11 (sequences phase A) — `sequence_step_executions` table
  exists, we can extend it.

## Design

### Schema

Two additive migrations, no impact on existing rows.

**On `sequence_step_executions`** — durable record of the thread the
engine actually used :

```sql
ALTER TABLE sequence_step_executions
  ADD COLUMN gmail_thread_id text NULL,
  ADD COLUMN gmail_message_id text NULL;
```

Filled on every `send_email` step that successfully sends. Lets the
engine answer "what thread is this enrolment currently in ?" with a
single indexed lookup.

**On `tasks`** — thread context propagated forward to the actual send
moment :

```sql
ALTER TABLE tasks
  ADD COLUMN gmail_thread_id text NULL,
  ADD COLUMN gmail_reply_to_message_id text NULL;
```

When the engine creates a task for a `send_email` step with
`replyInPreviousThread=true`, it **resolves the thread context up-front**
(lookup step_executions of the enrolment) and stamps the task with
`gmail_thread_id` + `gmail_reply_to_message_id`. The send-side path
(both `AgentMessageExecutor` for auto-tasks AND the manual
`GenerateMessageDialog` / `SendDefinedMessageDialog` for human-handled
tasks) just reads these fields off the task and passes them to the
Gmail send call. No knowledge of sequences / step_executions needed at
send time.

Why this dual storage :

- `step_executions` is the **engine's source of truth** : durable across
  task lifecycle, enrolment state changes, republishes.
- `tasks` is a **denormalized snapshot for the executor** : self-contained,
  so the send code stays sequence-agnostic. The thread context is
  resolved once, at task creation, and travels with the task. Anyone
  inspecting the task (UI, executor, audit log) sees the full picture.

Tiny denormalization, big query simplification + clean separation of
concerns between the engine and the send pipeline.

### Step config

Add a `threadingMode` enum to the `send_email` action config
(extension to `actionConfig` JSON, no schema change). Enum-based
rather than boolean for forward-compatibility — threading
strategies aren't a binary choice.

```ts
type ThreadingMode =
  | "new_thread"        // fresh thread, no In-Reply-To header
  | "last_email_step"   // reply to the most recent send_email step's thread
  | "entry_email_step"  // reply to the first send_email step's thread
  | "last_answered_step"; // reply to the step where the contact most recently answered
```

Semantics :

- **`new_thread`** : default outreach behavior. The send drops the
  threading headers and starts a fresh Gmail thread. Useful for the
  first step, or for a follow-up sequence with a deliberately new
  framing.
- **`last_email_step`** : reply to the most recent prior
  `send_email` step's thread (linear chain). The bread-and-butter
  "cold-outreach follow-up" mode. Standard across Smartlead, Lemlist,
  Instantly.
- **`entry_email_step`** : always reply to the very first
  `send_email` step's thread. Useful when the entry message carries
  the strong context (e.g. a pitch deck attached at step 1) and we
  want every follow-up anchored to it.
- **`last_answered_step`** : reply to the step that prompted the
  most recent contact reply (looked up via `interactions` table
  filtered on `direction='inbound'` for this enrolment). Most
  conversational mode — feels like the rep replied to the contact's
  last message. Fallback to `last_email_step` when no inbound reply
  exists yet.

Editor UI logic :

- **First send_email of an enrolment** : only `new_thread` is
  available, the other options are disabled (no previous email
  step exists). Default `new_thread`.
- **Subsequent send_email steps** : all 4 options available, default
  `last_email_step` (matches industry norm). The select shows each
  option with a one-line explanation so the user understands the
  difference.

The editor decides "is this the first send_email" by walking the
graph from the entry step to the current node and counting upstream
`send_email` predecessors. If zero, lock to `new_thread`.

### Engine / executor flow

**At task creation (engine `send-message-step-executor`)** :

1. Resolve the target step_execution to thread on, based on
   `threadingMode` :

   | mode | lookup |
   |---|---|
   | `new_thread` | none — task fields stay null |
   | `last_email_step` | most recent `step_executions` row for this enrolment with `action_type='send_email'` and `gmail_thread_id IS NOT NULL` |
   | `entry_email_step` | oldest (lowest `execution_counter`) such row |
   | `last_answered_step` | most recent `interactions` row for this enrolment with `direction='inbound'` → trace back to the prior outbound step_execution that it answered ; fallback to `last_email_step` lookup if no inbound exists |

2. If the lookup returns a row : stamp the task with
   `gmail_thread_id` + `gmail_reply_to_message_id`.
3. If the lookup returns nothing (legitimate for `new_thread`, or
   defensive fallback for the other modes after a republish edge
   case) : leave both null and log a warning if a non-`new_thread`
   mode silently fell back. The send will fall back to a fresh
   thread.
4. Create the task normally with these two extra fields populated.

**At send time (`AgentMessageExecutor` or manual dialog)** :

1. Read `task.gmail_thread_id` + `task.gmail_reply_to_message_id`.
   No sequence knowledge needed.
2. If both are set : pass `threadId` to the Gmail API + inject
   `In-Reply-To: <reply_to_message_id>` and `References: ...` headers
   in the MIME builder. Prefix subject with `Re: ` if not already.
3. If both null : send as a fresh thread (the normal path).
4. Capture the Gmail send response → store `gmail_thread_id` +
   `gmail_message_id` on the `sequence_step_executions` row (when
   the task is sequence-linked ; no-op for one-off manual tasks).

The `In-Reply-To` always references the **previous step's message**,
not a hypothetical "last incoming reply from the contact" — that's
out of scope for V1 ; we can refine later.

### Reply-side coherence

When the recipient replies, our existing reply-poller picks it up
via `gmail_thread_id` matching against `messages` rows. Since the
follow-ups now share that same thread id, all messages in the
conversation are correctly attributed to this contact / enrolment.
No code change needed on the reply side.

### Subject handling

Two options :

- **Strict `Re: ` prefix** : MIME convention, helps clients render
  the conversation correctly, no surprise.
- **Reuse the previous subject verbatim** : less spammy-looking, but
  some clients render it as a "subject change" event.

Recommendation : prefix `Re: ` if the previous subject doesn't already
start with `Re: ` (case-insensitive). Standard, predictable.

## Acceptance criteria

- [ ] Step 1 (first email) sent → step_executions row records
      `gmail_thread_id` + `gmail_message_id`.
- [ ] Step 2+ with `threadingMode='last_email_step'` :
      - lands in the same Gmail thread (verify in Gmail web client)
      - has `In-Reply-To:` header pointing at the immediate previous
        send_email step's message id
      - has `References:` header containing the chain
      - subject is `Re: <previous subject>`
- [ ] Step 2+ with `threadingMode='entry_email_step'` :
      `In-Reply-To` points at the FIRST send_email step's message id
      regardless of what happened in between.
- [ ] Step 2+ with `threadingMode='last_answered_step'` and an inbound
      reply exists on the enrolment : `In-Reply-To` points at the
      step that prompted the reply.
- [ ] Step 2+ with `threadingMode='last_answered_step'` and no inbound
      reply : falls back to `last_email_step` behavior, with a warning
      logged.
- [ ] First send_email step in the editor : enum locked to
      `new_thread`, other options disabled with a tooltip.
- [ ] Subsequent send_email steps : default `last_email_step`, user
      can pick any of the 4.
- [ ] An enrolment with `threadingMode='new_thread'` on a follow-up :
      that step lands in a fresh thread (no headers, no `Re: `).
- [ ] If the lookup for the previous thread fails (no prior
      step_execution with thread id), we log a warning AND send as a
      fresh thread instead of crashing.

## Implementation plan (rough sizing)

- 15.1 — Migration : add the 4 columns (2 on `sequence_step_executions`,
  2 on `tasks`) + partial index on
  `sequence_step_executions(enrolment_id) WHERE gmail_thread_id IS NOT NULL`
  for the lookup. 0.25 day.
- 15.2 — Extend `send_email` action config schema + Zod +
  `replyInPreviousThread` flag. Editor UI : toggle + tooltip +
  lock-on-first-step logic (walk the graph). 0.5 day.
- 15.3 — Engine wiring : at task creation, resolve thread context from
  step_executions, stamp the task. After send, capture Gmail response
  back into step_executions. 0.5 day.
- 15.4 — Send path wiring : `AgentMessageExecutor` + the manual
  dialogs read task.gmail_thread_id / gmail_reply_to_message_id and
  pass to GmailService. 0.25 day.
- 15.5 — MIME builder : inject `In-Reply-To` + `References` headers,
  prefix subject with `Re: `. 0.25 day.
- 15.6 — Tests : threading happy path, fallback when no prior thread,
  config flag forced for first step, manual send picks up the thread
  context. 0.5 day.

Total ~2.25 days.

## Open questions

- **Multi-recipient threads** : Gmail thread id is per-account. If
  the rep changes the assignee mid-sequence, the new assignee's
  Gmail account won't see the original thread. Two options : (a)
  continue threading on the new account (Gmail creates a new
  threadId for them naturally — the `In-Reply-To` header keeps the
  conversation logically threaded for the recipient), (b) abort
  threading and start a fresh thread. (a) seems right ; the
  recipient's view is what matters.

- **Reply-from-contact-in-thread fork** : if the contact replied to
  step 1, then step 2 fires — should we set `In-Reply-To` to the
  contact's reply (more conversational) or to our own step 1 (linear
  outbound chain) ? V1 : always our own previous message. V2 could
  refine if reply-polling integrates here.

- **Thread limit** : Gmail caps threads at 100 messages. Long
  sequences (>10 follow-ups) won't hit it, ignore for now.

- **Sequence republish** : if a step is removed or reordered between
  enrolment start and follow-up send, the "find previous send_email
  execution" still works because step_executions is durable. No
  drift problem here.
