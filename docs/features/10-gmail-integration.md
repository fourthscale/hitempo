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

(Filled at end of sprint.)
