# Sprint 16 — Outlook integration (parity with Gmail)

## Goal

Ship feature parity with the existing Gmail integration so users on
**Microsoft 365 / Outlook.com** can connect their mailbox to hitempo
exactly like Gmail users : send messages, track replies, auto-execute
agent tasks, surface a "Reconnect Outlook" CTA on credential death.

Architectural goal : abstract behind a `MailService` interface so the
sequence engine, agent executor, and generate-message dialog stay
provider-agnostic.

> Half the European SMB segment runs Office 365. Shipping Outlook is the
> precondition to landing the second customer (anyone non-FR + outside
> the Google Workspace bubble).

---

## Prerequisites

- Sprint 10 done ✅ — `GmailService`, OAuth callback, reply poller,
  credential lifecycle (status revoked, auto-replay)
- Sprint 14 done ✅ — credential status enum, auto-replay of failed
  agent tasks (Outlook inherits this for free)
- Microsoft Entra ID app registration (manual step by Ludovic — see
  "Operations" section below)
- Azure tenant access (free with any Microsoft account)

---

## Decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Schema | Single `user_mail_credentials` table with `provider` enum (`gmail` \| `outlook`) | One mental model ("user's connected mailbox"), keeps the status/revoked lifecycle uniform, easier to query. Migration renames the existing `user_gmail_credentials` table. |
| Multi-connection | One provider at a time per user | A user doesn't realistically have BOTH active for prospection. Switching providers replaces the row. PK stays `(userId)` unique. |
| Reply detection | Polling (Inngest cron, same cadence as Gmail) | Graph supports webhooks (Change Notifications) but subscriptions expire every ~3 days and need renewal. Polling reuses our existing infra. Webhooks are V2 if latency complaints surface. |
| Threading | Use Outlook's `conversationId` server-side identifier | Graph exposes a stable thread id ; we don't have to build the RFC 5322 In-Reply-To / References chain we use on Gmail. Stored in the same `gmail_thread_id` column (renamed to `mail_thread_id` in the migration). |
| Reply storage | Snippet only (~100 chars), same as Gmail | Full body via "Open in Outlook" deep link. Saves storage + GDPR surface. |
| Verification | Skip Microsoft Publisher Verification at launch | Optional, cosmetic (blue checkmark on consent screen). Requires MPN ID. Add later if a customer flags it as a trust issue. |
| Auth model | Multi-tenant from day 1 | Outlook.com + work/school accounts both supported with one app registration. No "Testing → Production" promotion like Google. |

---

## Scope

### In scope

1. **Provider unification migration** — rename `user_gmail_credentials` to `user_mail_credentials`, add `provider text not null default 'gmail'` column. Rename `messages.gmail_thread_id` → `mail_thread_id` (same for `gmail_message_id` → `mail_message_id`, `gmail_reply_to_message_id` → `mail_reply_to_message_id`).

2. **`MailService` interface** — common contract :
   - `send(input): Promise<SendResult>`
   - `fetchThread(threadId)` (for the reply poller)
   - `getCanonicalMessageId(internalId)` (mirrors the Gmail Message-ID rewrite path — Outlook doesn't rewrite IDs but we keep the same shape so the executor doesn't branch)
   - `disconnect()` (no-op for OAuth, for symmetry)
   
   Refactor `GmailService` to implement it.

3. **`MailCredentialsService`** — unify the credential CRUD under the renamed table. Add the `provider` field to the `DecryptedMailCredentials` type. Keep encryption / status / `markRevoked` / lifecycle wiring identical.

4. **`OutlookService`** — class (mirrors `GmailService`) :
   - Send via Microsoft Graph `POST /me/sendMail`
   - Fetch threads via `GET /me/messages?$filter=conversationId eq '...'` 
   - Refresh access token via Graph token endpoint
   - Same `invalid_grant` detection → mark credential revoked + throw `MailCredentialRevokedError`

5. **OAuth flow** — `/api/auth/mail/connect?provider=outlook` and `/api/auth/mail/callback`. The Gmail routes stay for back-compat, OR rename to `/api/auth/mail/*?provider=gmail` in the same migration.

6. **Send flow in `GenerateMessageDialog`** — dialog reads the user's provider from the credential row, surfaces the right button ("Envoyer via Gmail" vs "Envoyer via Outlook") with the matching icon. Same handler, same Server Action, behind the `MailServiceFactory.forUser(userId)` Facade.

7. **Sequence engine / agent executor** — replace the hardcoded `GmailService` injection with `MailServiceFactory.forUser(userId)`. The factory routes by the user's credential `provider` column. Threading metadata captured the same way (just stored as `mail_thread_id`).

8. **Reply poller** — split into two Inngest functions or one function that fans out per-credential by provider. Outlook poller calls Graph, persists the inbound interaction the same way the Gmail one does. Intent classification (sprint 11.5 / Slice B) keeps working unchanged because it operates on the persisted interaction row, not the protocol.

9. **Settings UI** — `/settings/profile` shows ONE mail card. If no credential yet, two connect buttons (Gmail / Outlook) side by side. Once connected, the card shows the active provider + a "Disconnect" button (which clears the row entirely, letting the user pick a different provider).

10. **Revoked status + auto-replay** — Outlook inherits sprint 14's full credential lifecycle for free : same `status` column, same `markRevoked` path, same replay-on-reconnect for `gmail_auth` failed agent tasks (we'll rename the failure kind to `mail_auth` in this sprint, since it's no longer Gmail-specific).

11. **i18n FR + EN** — connect/disconnect/reconnect copy, error messages, send button label per provider.

12. **Tests** — `OutlookService` (mocked Graph), `MailServiceFactory` routing, credential round-trip on the renamed table, reply detection given a Graph thread fixture.

### Out of scope

- **Webhooks via Graph Change Notifications** — V2. Polling is simpler and our cadence (10 min) is acceptable for cold outreach.
- **Sent folder push via Outlook Web Add-in** — V2+.
- **Outlook calendar integration** — separate concern, separate sprint.
- **Multi-mailbox per user** (e.g. corporate + personal Outlook) — same constraint as Gmail. One per user.
- **SMTP / IMAP custom server** — out. The OAuth model is what gives us authentic deliverability ; SMTP via app passwords is brittle and the UX is awful (see deferred-options memo in `10-gmail-integration.md`).
- **Publisher Verification (Microsoft trust badge)** — V2. Cosmetic, requires MPN ID.

---

## Data model changes

### Renamed table : `user_mail_credentials`

Migration is a 2-step :
1. `ALTER TABLE user_gmail_credentials RENAME TO user_mail_credentials;`
2. `ALTER TABLE user_mail_credentials ADD COLUMN provider text NOT NULL DEFAULT 'gmail';`
   Then drop the default once new code is deployed (so future inserts MUST specify).

The existing `status`, `revoked_at`, `last_refresh_error`, `last_refresh_attempt_at` columns from sprint 14 stay as-is — they work for both providers.

### Renamed columns on `messages` + `tasks` + `sequence_step_executions`

- `gmail_thread_id` → `mail_thread_id`
- `gmail_message_id` → `mail_message_id`
- `gmail_reply_to_message_id` → `mail_reply_to_message_id`

Done via `ALTER TABLE ... RENAME COLUMN`. Drizzle types regenerate. Code-level grep + rename.

### Renamed failure kind on `tasks`

- `auto_execution_failure_kind = 'gmail_auth'` → `'mail_auth'`
- One-shot UPDATE migrates any existing rows.

---

## Implementation plan

### Slice A — Schema unification + interface

1. Migration : rename table + columns + failure kind. Backfill `provider = 'gmail'` for existing rows.
2. `MailService` interface in `lib/mail/` + types.
3. Refactor `GmailService` to implement `MailService` (no behaviour change).
4. Refactor `GmailCredentialsService` → `MailCredentialsService` (no behaviour change).
5. Update all call sites to import from `lib/mail/` instead of `lib/gmail/`.
6. Verify tests still pass.

### Slice B — Microsoft Graph implementation

1. `OutlookService` class implementing `MailService`.
2. `MsGraphOAuth` helpers (authorize URL, code exchange, refresh).
3. OAuth callback handler at `/api/auth/mail/callback` (dispatch on `state.provider`).
4. UI : `/settings/profile` exposes the Outlook connect button.
5. End-to-end test : connect → send via Outlook → confirm in user's Sent folder.

### Slice C — Reply tracking via Graph

1. `OutlookReplyPoller` Inngest function. Same cadence as the Gmail one.
2. `MailServiceFactory.forUser(userId)` → routes the poller to the right service.
3. Intent classification works unchanged (uses persisted interactions).
4. End-to-end test : send via Outlook → reply from another account → confirm interaction appears + intent classified.

### Slice D — Sequence engine + agent executor

1. Replace hardcoded `GmailService` in `AgentMessageExecutor` with `MailServiceFactory.forUser(task.assigneeId)`.
2. Threading : `ThreadingResolver` reads `mail_thread_id` (renamed column) — works the same for both providers.
3. Test : agent task on Outlook user → send via Outlook → reply detected → next step fires.

### Slice E — Polish + edge cases

1. Revoke detection + auto-replay : verify the Outlook path triggers the same UI banner + replay of `mail_auth` failed tasks.
2. UI : disconnect button wipes the row cleanly. Reconnecting with a different provider just creates a new row with the new `provider` value.
3. Provider switching : if user is connected to Gmail and clicks Connect Outlook → confirm dialog "this will replace your current connection".
4. i18n parity FR + EN.

---

## Acceptance criteria

- [ ] Sprint 10 (Gmail) functionality unchanged after the refactor.
- [ ] A user can connect Outlook from `/settings/profile`.
- [ ] Sending via the AI generation dialog hits Outlook for Outlook users, Gmail for Gmail users.
- [ ] Replies on Outlook threads create inbound interactions within 10 min.
- [ ] Agent tasks auto-execute via the user's connected provider (no Gmail hardcoding).
- [ ] Revoked Outlook credentials surface the "Reconnect Outlook" banner and replay failed `mail_auth` agent tasks on reconnect.
- [ ] Sidebar counters and dashboard stats unchanged.
- [ ] Multi-tenant safety verified (`organization_id` filtered everywhere).
- [ ] FR + EN i18n covers all new strings.

---

## Operations — Azure App Registration walkthrough

This is a manual one-time step for Ludovic. Estimated time : **20-30 min** including signing into Azure for the first time.

### Step 1 — Create a Microsoft account (skip if you already have one)

If you don't already use Microsoft 365 / Outlook.com / Live, create a free account :

- Go to https://signup.live.com/
- Use a hitempo / fourthscale email if you want to keep things branded (e.g. `azure@hitempo.app`)
- This is the account that owns the Azure tenant + app registration. **Use a shared / role mailbox, not Ludovic's personal account**, so the registration doesn't get orphaned if you change accounts later.

### Step 2 — Sign into the Azure Portal

- Go to https://portal.azure.com/
- Sign in with the account from Step 1
- First-time sign-in : Microsoft will auto-create an "Azure Active Directory" tenant for you (Entra ID). Free, no credit card required.
- You may be prompted to create an Azure subscription. **You don't need one** for app registration. If the portal insists, you can sign up for a free trial (no auto-charge after expiration) but it's not necessary.

### Step 3 — Register the app

1. In the Azure Portal search bar at the top, type **"App registrations"** and click it.
2. Click **+ New registration**.
3. Fill in :
   - **Name** : `hitempo` (or `hitempo Mail` if you want a separate one for clarity)
   - **Supported account types** : **"Accounts in any organizational directory (Any Microsoft Entra ID tenant — Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)"**.
     This is what lets both Outlook.com personal users AND work / school Office 365 users connect.
   - **Redirect URI** : choose **Web**, value `https://hitempo.app/api/auth/mail/callback` (and add `http://localhost:3000/api/auth/mail/callback` later in the same page for local dev).
4. Click **Register**.
5. On the overview page that opens, **copy + save** :
   - **Application (client) ID** → goes to `MS_GRAPH_CLIENT_ID` env var
   - **Directory (tenant) ID** → not needed for multi-tenant ; ignore

### Step 4 — Add API permissions (the scopes)

1. In the left nav of your new app, click **API permissions**.
2. Click **+ Add a permission** → **Microsoft Graph** → **Delegated permissions**.
3. Search and check each of :
   - `User.Read` (already there by default)
   - `Mail.Send`
   - `Mail.ReadWrite`
   - `offline_access` (this is what gives us a refresh token — critical)
   - `openid`, `email`, `profile` (for the userinfo fetch in the callback)
4. Click **Add permissions** at the bottom.
5. **Do NOT click "Grant admin consent for [tenant]"** — that's for single-tenant apps. We want each user to consent individually at first login.

Reference : https://learn.microsoft.com/en-us/graph/permissions-reference

### Step 5 — Create a client secret

1. In the left nav, click **Certificates & secrets**.
2. Click **+ New client secret**.
3. Description : `hitempo prod` ; Expires : **24 months** (max). Set a calendar reminder ~1 month before expiry to rotate.
4. Click **Add**.
5. **IMMEDIATELY** copy the **Value** column (NOT the "Secret ID") and store it in your password manager. **It will never be shown again.**
6. This value goes to the `MS_GRAPH_CLIENT_SECRET` env var.

### Step 6 — Configure the Redirect URIs for local dev

1. In the left nav, click **Authentication**.
2. Under **Platform configurations** → **Web** → **Redirect URIs**, add :
   - `http://localhost:3000/api/auth/mail/callback`
3. Under **Implicit grant and hybrid flows**, leave both checkboxes UNCHECKED. We only use authorization code flow.
4. **Supported account types** : confirm "Accounts in any organizational directory and personal Microsoft accounts" is selected.
5. **Allow public client flows** : No.
6. Save.

### Step 7 — Add env vars to hitempo

Add to Vercel + local `.env.local` :

```
MS_GRAPH_CLIENT_ID=<the Application (client) ID from step 3>
MS_GRAPH_CLIENT_SECRET=<the Value from step 5>
MS_GRAPH_REDIRECT_URI=https://hitempo.app/api/auth/mail/callback
```

The code reads these via `getMsGraphOAuthConfig(siteUrl)` mirroring the
`getGoogleOAuthConfig` shape from `lib/gmail/google-oauth.ts`.

### Step 8 — Inviting test users in dev (without publisher verification)

Since 2024, Microsoft requires **publisher verification** on multitenant
apps before users from foreign tenants can consent. Until we set up
publisher verification (step 9 below), only users **inside our own
tenant** can OAuth into the app. For testing, invite each external
tester as a **guest** in the tenant — guests are "internal" for the
purpose of consent, no verification required.

**Procedure :**

1. Go to https://entra.microsoft.com (or Azure Portal → search
   "Microsoft Entra ID").
2. In the left nav, click **Users** → **+ New user** → **Invite
   external user**.
3. Fill in :
   - **Email** : the tester's email (any Microsoft Outlook, Gmail, work
     account, etc. — anything accepts a Microsoft personal account)
   - **Display name** : their name
   - Optional message : "Test access for hitempo Outlook integration"
4. Click **Invite**. Microsoft sends them an email immediately.
5. The tester clicks the link in the email and accepts the invitation.
   They sign in with their existing Microsoft account ; no new account
   to create.
6. Once accepted, they're listed in our tenant as a guest. They can
   now go to hitempo, click "Connect Outlook" and complete the OAuth
   flow normally.

**Cost :** free for up to 50k guest invitations / month.

**When to use what :**
- **Dev / QA** : guest invitations (this step)
- **Single-customer production** : guest invitations if the customer has
  a small team
- **Multi-customer production** : publisher verification (step 9). Any
  user from any tenant can consent without invitations.

**Alternative — single-tenant mode :** if testing with guests is too
heavy, you can flip the app to single-tenant temporarily
(Authentication → Supported account types → "Accounts in this
organizational directory only"). All users in our tenant (incl. guests)
can consent ; foreign-tenant users are blocked. Flip back to
multi-tenant before publisher verification + customer onboarding.

**Alternative — admin consent grant :** under API permissions, click
**Grant admin consent for [tenant]**. Users in our tenant skip the
consent screen entirely. Foreign-tenant users still need invitations
or publisher verification.

Reference : https://learn.microsoft.com/en-us/entra/external-id/b2b-quickstart-add-guest-users-portal

### Step 9 — Optional : Publisher Verification (V2)

Skip for now. When you decide to apply :

1. Sign up to the Microsoft Partner Network (free) at https://partner.microsoft.com/
2. Get an MPN ID
3. Go to **App registrations → your app → Branding & properties → Publisher domain** and link it to your verified domain.
4. Submit for publisher verification. Microsoft adds the blue checkmark on the consent screen, builds user trust.

Not required for the app to work. Useful when scaling to enterprise customers.

---

## Implementation notes

(To be filled at the end of the sprint with deviations, gotchas, follow-ups for the next dev.)
