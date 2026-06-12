# Sprint 10 — Gmail integration (send + reply tracking)

## Goal

Close the outbound prospection loop : let each commercial **send AI-generated messages via their own Gmail** in one click, **track replies automatically**, and surface them in the contact timeline. This unlocks the full feedback cycle the product needs to be useful — and is the last piece before the AI generation feature actually gets used in real life.

> "AI-native + field-aware" — this sprint completes the AI half by turning copy-paste into actual workflow.

---

## Prerequisites

- Sprint 07 done ✅ — `messages` table, `GenerateMessageDialog`, `generateMessageAction`.
- Sprint 05 done ✅ — `interactions` table (we'll write inbound rows when replies come in).
- Inngest set up (deferred from sprint 08) — this sprint **introduces Inngest** since reply polling needs a scheduled job.
- Google Cloud Console project created with OAuth 2.0 client + Gmail API enabled (manual step by Ludovic).

---

## Scope

### In scope

1. **Per-user Gmail OAuth** — separate from auth (user keeps their email/password login). Connect / disconnect from `/settings/profile`.
2. **Encrypted token storage** — `user_gmail_credentials` table, access + refresh tokens AES-encrypted at rest with a server-side key.
3. **`GmailService`** — class (OOP, Strategy-ready) that handles send + read, refreshes tokens automatically when expired.
4. **Send flow** — new button "Envoyer via Gmail" in `GenerateMessageDialog`, **alongside** the existing "Copier" (both stay — copy is useful for LinkedIn DM, other clients, sharing).
5. **Thread tracking** — when sending, capture `threadId` + `messageId`, persist on `messages` table. Set `In-Reply-To` / `References` headers properly so replies land in the same thread.
6. **Reply polling (Inngest)** — scheduled function, every 10 min, for each user with Gmail connected : fetch threads sent in the last 14 days that have no reply logged yet, detect new messages from the contact, create `interactions` (inbound) accordingly.
7. **Auto follow-up tasks** — after send : auto-create a "Follow-up if no reply" task with a 4-day due date (configurable). When a reply is detected, this task is auto-completed.
8. **UI : contact timeline shows replies** — inbound interactions surface in the contact detail timeline, with the reply snippet and a "Voir dans Gmail" deep link.
9. **i18n FR + EN** — consent copy, connection state, error messages.
10. **Tests** — `GmailService` (mocked API), token encryption round-trip, reply detection (given a thread fixture, find new inbound messages), polling function (Inngest test utilities).

### Out of scope

- **Gmail Push via Cloud Pub/Sub** (real-time webhooks) — V1+. Polling is sufficient for MVP.
- **Outlook / SMTP custom** — `GmailService` is built as a Strategy so adding `OutlookService` later is straightforward, but not built now.
- **Inline tracking pixels / open detection** — privacy-invasive, deliverability risk. Skip.
- **Link click tracking** — same.
- **Multi-account per user** — one Gmail per user per org. Switching org switches the connected mailbox.
- **Storing full reply body in our DB** — we store the snippet only (~100 chars), enough for the timeline. Full read goes through the "Voir dans Gmail" deep link.
- **Reply sentiment analysis / classification** — V1+ (would be a great LLM use case).
- **Bulk send** — one-by-one only at MVP.

---

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Auth method for Gmail | Separate OAuth flow, not "Sign in with Google" | Decouples app auth from email-send authorization. User can connect/disconnect without touching their login. |
| Scopes requested | `gmail.send` + `gmail.readonly` | Both sensitive (same Google verification path). We're explicit in the UI : "lecture limitée aux conversations envoyées depuis hitempo". |
| Token storage | AES-256-GCM at rest, key from env var | Standard practice. Key rotation deferred to V1+. |
| Reply detection | Inngest cron, every 10 min | Simple, no infra to maintain. Pub/Sub push is V1+ if polling becomes a bottleneck. |
| Reply storage | Snippet only (~100 chars) + Gmail `messageId` | Light DB, sufficient for timeline. "Voir dans Gmail" for full read. |
| Per-user vs per-org Gmail | Per-user | "1-to-1 deliverability" is the wedge. Each rep sends from their own address. |
| Copy button | Keep alongside "Envoyer via Gmail" | LinkedIn DM, other clients, sharing with a colleague — copy stays useful. |
| Verification mode (Google) | "Testing" with manual test-user list | <100 users at MVP. Production verification = 2-6 weeks, defer until needed. |
| Follow-up task default delay | 4 days | Reasonable for B2B SMB outbound. Configurable per-org later. |

---

## Data model changes

### New table : `user_gmail_credentials`

```sql
create table user_gmail_credentials (
  user_id uuid primary key references auth.users on delete cascade,
  organization_id uuid not null references organizations on delete cascade,
  gmail_address text not null,
  access_token_encrypted text not null,
  refresh_token_encrypted text not null,
  expires_at timestamptz not null,
  scopes text[] not null,
  connected_at timestamptz not null default now(),
  last_used_at timestamptz
);
-- RLS : user can only see their own row
```

**Why `user_id` primary key, not `(user_id, org_id)`** : one Gmail per user globally, simpler. If the user belongs to multiple orgs, switching org keeps the same mailbox (they're the same person). `organization_id` is informational (tracks where they connected from).

### Columns added to `messages`

```sql
alter table messages
  add column gmail_thread_id text,
  add column gmail_message_id text,
  add column reply_received_at timestamptz,
  add column last_polled_at timestamptz;

create index messages_pending_reply_idx
  on messages (last_polled_at)
  where gmail_thread_id is not null
    and reply_received_at is null
    and status = 'sent';
```

The partial index keeps the polling query cheap : only rows we actually need to check.

### No new table for replies

Replies are written into the existing `interactions` table with `direction = 'inbound'`, `channel = 'email'`, `type = 'email_inbound'`, `gmail_message_id` for dedup.

---

## Implementation plan

### Slice A — OAuth plumbing (foundation)

1. Migration : `user_gmail_credentials` table + RLS.
2. `lib/crypto/token-cipher.ts` — AES-256-GCM wrapper, key from `GMAIL_TOKEN_ENCRYPTION_KEY` env var. Pure class, unit-tested.
3. `lib/gmail/gmail-credentials-service.ts` — `GmailCredentialsService` class : `getForUser`, `upsert`, `delete`, `withFreshAccessToken` (auto-refresh).
4. Routes : `app/api/auth/gmail/connect/route.ts` (redirect to Google consent) + `app/api/auth/gmail/callback/route.ts` (exchange code, persist, redirect to `/settings/profile?gmail=connected`).
5. UI : section "Email d'envoi" dans `/settings/profile`. Connected state shows the email + disconnect button. Disconnected shows the "Connecter Gmail" button + explicit copy about scope.

### Slice B — Send

6. `lib/gmail/gmail-service.ts` — `GmailService` class (Strategy-ready). `send({ to, subject, body, replyToThreadId? })` returns `{ threadId, messageId }`. Handles MIME encoding, threading headers.
7. `lib/gmail/gmail-service-factory.ts` — singleton factory, injects credentials service.
8. Extend `messages` schema (Drizzle) with the new columns. Generate migration.
9. New server action `sendMessageViaGmailAction` — takes `messageId`, fetches the row, calls `GmailService.send`, updates the row with `gmail_thread_id` / `gmail_message_id` / `status = 'sent'` / `sentAt`.
10. UI : "Envoyer via Gmail" button in `GenerateMessageDialog`. Primary action when connected, hidden when not (just a small "Connecter Gmail pour envoyer en un clic" link below "Copier").
11. Auto-create follow-up task on send (via existing tasks API).

### Slice C — Reply tracking

12. Inngest setup : `inngest/client.ts` + `app/api/inngest/route.ts`.
13. `inngest/functions/poll-gmail-replies.ts` — cron, every 10 min. For each user with credentials : `selectPendingReplyMessages()` → for each thread, `gmailService.getThreadSince(threadId, sentAt)` → for new inbound messages, create `interactions` (inbound) + update `messages.reply_received_at` + complete the follow-up task.
14. Dedup via `gmail_message_id` on `interactions` (unique constraint).
15. UI : contact timeline already renders interactions — verify inbound emails display correctly with the snippet + "Voir dans Gmail" link.

### Slice D — Polish

16. i18n FR + EN for the entire flow.
17. Error states : token expired & refresh failed (prompt reconnect), Gmail API rate limit (back off), network errors.
18. Tests : token cipher, credentials service, send (mocked API), reply detection (fixture thread), polling function.
19. Doc : `docs/architecture.md` section "Gmail integration" with the OAuth flow diagram + polling sequence.

---

## Acceptance criteria

- [ ] User can connect Gmail from `/settings/profile`. Consent screen shows the right scopes.
- [ ] Connection survives org switch (same user → same Gmail).
- [ ] User can disconnect → token deleted from DB.
- [ ] "Envoyer via Gmail" button visible only when connected ; sends the AI-generated message correctly.
- [ ] "Copier" button still present and functional alongside.
- [ ] Sent message lands in the recipient's inbox (smoke test with real Gmail).
- [ ] Reply to the sent message lands in the same thread (correct headers).
- [ ] Within 10 min of receiving a reply, an inbound `interaction` appears in the contact's timeline.
- [ ] The "Follow-up if no reply" task is auto-completed when reply detected.
- [ ] Polling does NOT re-create duplicate interactions if run twice.
- [ ] Polling reads only threads we sent ; never broader inbox (verified by code review of the query).
- [ ] Tokens encrypted at rest (DB inspection confirms ciphertext, not plaintext).
- [ ] Auto token refresh works (expired access token → refreshed without user action).
- [ ] All UI strings via `useTranslations()` / `getTranslations()`, FR + EN parity.
- [ ] Zod validation on all new server actions.
- [ ] Tests green ; tsc + lint clean.

---

## Open questions

- **Follow-up task delay** — 4 days hardcoded MVP, or configurable per-org from day 1 ? *Default : hardcoded, add UI in V1.*
- **What happens to "sent" messages if the user disconnects Gmail ?** — Stop polling those threads (mark `last_polled_at` permanently in the past, or add a `polling_disabled` flag). Decision : keep the data, stop polling, surface a warning on the contact timeline.
- **Multiple replies in a thread** — log each new inbound separately, or just the latest ? *Decision : each one (it's a conversation, we want the timeline).*
- **What if the recipient forwards our email to a colleague who replies ?** — Same thread, different from-address. Should we log it ? *Decision : yes, log as inbound. The user can see "from: someone-else@..." and decide.*
- **Replies from auto-responders ("Out of office")** — log as inbound or filter ? *Decision : log them ; filter heuristics are V1+.*

---

## Implementation notes

### Deviations from the brief

- **Auto follow-up task on send was dropped from the MVP scope.** The
  workflow we kept is "user → Send via Gmail → message stored + interaction
  logged + originating task completed". Adding a J+4 follow-up task on top
  felt premature without dogfood data — easy to bring back later if L&G
  asks for it. Implementation notes 1.
- **No "draft" lifecycle for messages.** The original plan was to persist
  a `messages` row at generation time (status `draft`) and flip it on send.
  In practice we found out that dialog-close auto-discard would overwrite
  successful `sent` rows under racy conditions, and that the `discarded` /
  `copied` lifecycle wasn't adding signal anywhere in the product. We
  refactored the action layer to commit-on-action : the `messages` row is
  only created when the user clicks Send via Gmail OR Log interaction. The
  `llm_usage` row is still created at generation time, agnostic of any
  message — it just gets its back-reference set when the commit happens.
- **Interaction model gained a `status` enum.** Outbound interactions now
  carry one of `sent`, `responded`, `no_answer`, `done`. The poller flips
  the outbound's status from `sent` → `responded` when a reply is detected
  ; outcome qualification (positive_reply / negative_reply / rdv_scheduled
  / etc) moves to the inbound `email_received` row. Originally the spec
  had the outcome staying on the outbound — we decided this was less
  intuitive when reading the timeline.
- **Timeline UI got a "Groupé / Liste" switcher.** Wasn't in the brief —
  emerged from dogfood. Grouped view bumps the whole conversation to the
  top when a reply arrives, list view is the legacy flat chronological.
- **Snippet cleanup.** Gmail returns the snippet with quoted history
  ("Le X à HH:MM, X a écrit : > Bonjour ...") and HTML entities
  (`&gt;`, `&#39;`). We added `cleanReplySnippet()` to decode entities and
  strip the quoted tail on the major French / English / German markers.
  Heuristic, not perfect — fine for a snippet display.

### Architecture decisions

- **Inngest over Vercel Cron.** Considered Vercel Cron for the polling
  job since we already have Vercel. Inngest won on : built-in fan-out
  (1 step per user with independent retry), step-level observability,
  reusable infra for V1 sequences. Free tier (50k step runs / month) is
  largely enough at L&G dogfood scale and beyond — see brief consom table.
- **Cron cadence per Ludovic.** 6 distinct weekday slots (peak 10 min,
  lunch 20 min, etc.) + weekend hourly, all in Europe/Paris TZ. Defined
  as 7 Inngest function declarations sharing the same handler. ~17k step
  runs / month at 3 connected users ≈ 35 % free tier.
- **Sec : Inngest's `signingKey` is auto-discovered from
  `INNGEST_SIGNING_KEY`.** No need to pass it to `serve()` explicitly.
  In dev we set `INNGEST_DEV=1` so the SDK bypasses signature checks
  and routes events to the local `inngest dev` server.
- **Vercel preview deployments + Inngest don't mix natively.** The
  Vercel-Inngest integration auto-discovered a preview URL (protected by
  Vercel Deployment Protection → 401 from Inngest). Fix : manual sync in
  Inngest dashboard pointing at the stable prod alias
  (`https://hitempo.vercel.app/api/inngest`). Documented as a "watch out"
  for future deployers.

### Migrations applied (in order)

1. `20260528150430_user_gmail_credentials.sql` — credentials table + RLS
2. `20260528155123_messages_gmail_columns.sql` — gmail_thread_id /
   gmail_message_id / reply_received_at / last_polled_at on messages
3. `20260528183539_interaction_type_email_received.sql` — new enum value
4. `20260528191652_interaction_status.sql` — new enum + status column

All additive, all pushed to local + cloud.

### OAuth verification + token lifecycle (pre-production)

While the Google Cloud OAuth app stays in **Publishing status =
"Testing"**, refresh tokens issued to users **expire after 7 days**.
Symptom : every Monday the Gmail integration silently dies, the user
sees "reconnect Gmail" on next send. This is a documented Google
behavior, not a bug in our code.

Once the app is moved to **"In production"** (status "Published"),
refresh tokens stop expiring on a fixed clock. They still get revoked
on : user-initiated revoke, password change (some Workspace policies),
6 months of total inactivity, scope changes, or > 50 refresh tokens
issued for the same (client_id, user) pair.

**Gotcha** : our scopes (`gmail.send` + `gmail.readonly`) are classified
as **restricted scopes** by Google. Moving the app from External /
Testing to External / Production requires going through Google's
**OAuth Verification** — security review form, demo video of the
end-to-end consent flow, privacy policy URL + branding, and for true
restricted scopes a **CASA audit** by a Google-approved third party
(Bishop Fox / Leviathan / NCC Group). Timeline : 4–12 weeks depending
on queue + how clean the privacy policy + homepage are.

#### Paths forward (in order of how much work they save)

1. **Workspace Internal app — recommended for L&G dogfood** (current
   single-customer state). If L&G has a Google Workspace, recreate the
   OAuth client with **User type = Internal** instead of External.
   Internal apps :
   - skip OAuth Verification entirely,
   - have no 7-day refresh-token expiry,
   - skip the "unverified app" warning screen,
   - are restricted to the workspace's own domain (`*@leonandgeorge.com`).

   Trade-off : the app cannot grant tokens to users outside L&G's
   workspace. Fine while L&G is the only customer ; blocking the
   second customer onboarding.

2. **External + Verification — required for multi-tenant SaaS.** When
   the second customer signs and they're not L&G domain users, switch
   user type back to External and launch the verification process. Plan
   a ~3 month buffer between "second-customer LOI signed" and "second
   customer can connect Gmail" — start the verification before the LOI
   if possible.

3. **External + Unverified + Testing.** Status quo. Acceptable while
   L&G is sole dogfood and they're OK reconnecting weekly. **Not
   acceptable post-dogfood** — refresh-token churn breaks sequences
   silently mid-flight.

#### Action items

- **Now (L&G dogfood)** : switch the OAuth client to user type
  **Internal**. Stops the weekly reconnects, costs ~30 min of Google
  Cloud Console config. Validate by issuing a fresh token and confirming
  it survives a week.
- **Before second customer** : start External + OAuth Verification. Add
  privacy policy URL, branding, demo video. Budget : 3 months wall-clock,
  but most of it is Google's queue, not our work.
- **Before > 20 connected users** : reconsider Gmail Push via Pub/Sub
  (see deferred V1+ items below) — independent decision but related
  because Pub/Sub also lives under the same Cloud project.

### Things explicitly deferred to V1+

- **Gmail Push via Cloud Pub/Sub** — real-time webhooks instead of
  polling. Worth it once latency becomes a customer complaint or > 20
  connected users start eating the Inngest free tier.
- **LLM sentiment classification of replies** — auto-fill the outbound's
  outcome from the reply content. Currently the user clicks the outcome
  menu manually.
- **Multi-reply tracking** — only the first inbound reply per thread
  triggers an interaction row today (because `reply_received_at` is set
  after detection and filters the row out of the polling query).
- **Disconnect cleanup of pending threads** — when a user disconnects
  Gmail, we keep `messages` rows but stop polling (no opt-in flag for
  this yet, just relies on `getForUser` returning null and the user
  loop exiting early).
