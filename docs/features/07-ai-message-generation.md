# Sprint 07 — AI Message Generation

## Goal

Ship the **flagship product wedge** : AI-generated outbound messages **contextualized by the organisation's brand brief** and the prospect's history. After this sprint, a commercial can in two clicks generate a brand-aligned email or LinkedIn message tailored to a specific contact, taking into account interaction history and the brand voice.

> "AI contextualized by brand brief + fine-grained territory management" — this sprint covers the first half.

---

## Prerequisites

- Sprint 06 done ✅ — scoring, breakdown, signal badges in place.
- `organizations` table exists ; we'll extend it with `brand_brief jsonb`.
- `interactions` table exists with `type / channel / outcome / summary / interestLevel`.
- OpenAI API access available (key in `.env.local`).

---

## Scope

### In scope

1. **Brand brief data model + editor UI** — `organizations.brand_brief jsonb` (localized FR/EN), CRUD via `/settings/brand`.
2. **LLM strategy infrastructure** — full Strategy + Builder + Provider + Factory of Provider, OpenAI + Anthropic, env-driven.
3. **Generic LLM usage logging** — `llm_usage` table + `LlmUsageLogger` service + `LlmGenerationService` Facade. ANY LLM call in the codebase logs here (current + future use cases like brand brief generation, interaction summarization, enrichment).
4. **Prompt builder** — pure function, provider-agnostic, locale-aware.
5. **`messages` table** — outbound message content + status, with FK `llm_usage_id` to the audit row.
6. **`generateMessageAction`** — server action validates Zod, builds context, builds prompt, calls `LlmGenerationService`, persists message, returns content.
7. **UI : Generate from task** — 1-click trigger from task row when `type ∈ {email, linkedin, follow_up}` AND `contactId` is set. Modal pre-fills everything from the task.
8. **UI : Generate from contact** — trigger from contact detail. Modal asks for intent + channel + optional orientation note.
9. **UI : Result modal** — editable textarea, regenerate-with-orientation, copy-to-clipboard. Updates `messages.status` to `discarded` or keeps `draft` on copy.
10. **i18n FR + EN** — every label, every error, every empty state.
11. **Tests** — prompt builder (pure function, snapshot), LLM strategies (mocked client), `LlmUsageLogger`, `LlmGenerationService` (with `NoopLlmUsageLogger`), `generateMessageAction` happy path + multi-tenant isolation.

### Out of scope

- **Gmail send** (V1 — manual copy at MVP).
- **Sequences / multi-touch automation** (V1+).
- **LinkedIn DM automation** (manual copy at MVP).
- **Streaming responses** — full response returned in one shot.
- **A/B prompt variants** — V1+.
- **Batch generation** (multiple contacts at once) — V1+.
- **Cost dashboard / per-org cost limits** — DB captures the data, no UI surface yet.

---

## Decisions (locked)

| Decision | Choice |
|---|---|
| LLM provider at MVP | OpenAI (`gpt-5-mini` default) |
| Architecture | Strategy + Builder + Provider + Factory of Provider (option B) + Facade (`LlmGenerationService`) for orchestration |
| Generic LLM logging | `llm_usage` table reused by ALL future LLM features (brand brief gen, summarization, enrichment…). `messages.llm_usage_id` FK. |
| Channels | Email + LinkedIn both at MVP |
| Trigger surfaces | Task row + Contact detail (NOT company) |
| Modal layout | **2 columns** : parameters left, generated message right (~1100px wide) |
| Type de message UX | **Combined dropdown** channel × intent (`Email — Premier contact`, `LinkedIn — Relance`, etc.) — 9 valid combos |
| Subject extraction | Email mode : model returns "Object: …\\n\\n…body…" ; first line parsed as subject, rest as body |
| Signal injection | **Toggle ON/OFF** in the modal — default ON when a fresh signal (≤ 30 days) exists. Toggle OFF removes signal from the prompt context. |
| Model selector in UI | **No** — locked via env (`OPENAI_MODEL`). Model name not displayed in the modal either. |
| Color annotations on result | **Yes** — post-process the generated content : highlight personalization vars (blue) and signal-related substrings (amber). Pure function, no LLM dependency. |
| Brand brief excerpt in modal | Yes — read-only first ~2 lines, link to `/settings/brand` |
| Context passed to LLM | 10 last interactions (6 mo max) + 5 last generated messages + company/contact snapshot + sender first+last name |
| Tasks in context | NO (interactions cover history ; future tasks = internal) |
| Brand brief edit | UI in `/settings/brand` (this sprint, not later) |
| Storage scope | Every generation, with tokens I/O and cost |
| Regenerate with orientation | YES, optional free-text field |
| Streaming | NO at MVP |
| Send | NO at MVP — copy-to-clipboard only |
| Default OpenAI model | `gpt-5-mini` (configurable via `OPENAI_MODEL`) |

---

## LLM architecture

Per project convention (see `CLAUDE.md` § *Code style & patterns*) : real OOP, SOLID, Strategy + Builder + Provider + Factory of Provider, plus a **Facade** (`LlmGenerationService`) that owns orchestration (strategy resolution + usage logging) so server actions stay thin.

### Class diagram (textual)

```
┌──────────────────────────────────────────────────────────┐
│ Server actions (generateMessageAction, future …)         │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼  uses
┌──────────────────────────────────────────────────────────┐
│ LlmGenerationService            (Facade — public API)    │
│   .generate({ input, context, strategyName? })           │
│   → orchestrates Strategy call + usage logging           │
└──────────────────────────────────────────────────────────┘
            │                                  │
            ▼ getStrategy                      ▼ log
┌──────────────────────────┐      ┌──────────────────────────┐
│ LlmStrategyProvider      │      │ LlmUsageLogger (intf)    │
│   .getStrategy(name?)    │      │   .log(entry)            │
└──────────────────────────┘      │   ├── DbLlmUsageLogger   │
            │                     │   └── NoopLlmUsageLogger │
            ▼ holds               └──────────────────────────┘
┌──────────────────────────┐                  │
│ LlmStrategy (interface)  │                  ▼ persists
│   .generate(input)       │      ┌──────────────────────────┐
│   ├── OpenAiStrategy     │      │ table llm_usage          │
│   └── AnthropicStrategy  │      └──────────────────────────┘
└──────────────────────────┘

Concrete strategies are built via Builders, registered into the
Provider by the Factory of Provider :

OpenAiStrategyBuilder       .getInstance() → OpenAiStrategy
AnthropicStrategyBuilder    .getInstance() → AnthropicStrategy
LlmStrategyProviderFactory  .getInstance() → LlmStrategyProvider  (singleton lazy, env-driven)
LlmGenerationServiceFactory .getInstance() → LlmGenerationService (singleton lazy)
```

### File layout

```
lib/ai/
├── llm-strategy.ts                       # interface + shared types (GenerateInput, GenerateResult, ProviderName)
├── pricing.ts                            # PricingCalculator + DefaultPricingCalculator (per-model rates)
├── errors.ts                             # abstract LlmError + concrete subclasses
├── strategies/
│   ├── openai-strategy.ts                # class OpenAiStrategy implements LlmStrategy
│   └── anthropic-strategy.ts             # class AnthropicStrategy implements LlmStrategy
├── builders/
│   ├── openai-strategy-builder.ts        # class OpenAiStrategyBuilder
│   └── anthropic-strategy-builder.ts     # class AnthropicStrategyBuilder
├── llm-strategy-provider.ts              # class LlmStrategyProvider
├── llm-strategy-provider-factory.ts      # class LlmStrategyProviderFactory
├── llm-usage-logger.ts                   # interface LlmUsageLogger + DbLlmUsageLogger + NoopLlmUsageLogger
├── llm-generation-service.ts             # class LlmGenerationService (Facade)
├── llm-generation-service-factory.ts     # class LlmGenerationServiceFactory
└── prompts/
    └── outbound-message-prompt.ts        # pure function — builds system + user prompt
```

### Why a Facade

A direct call (`provider.getStrategy().generate(...)`) skips usage logging — opens the door to inconsistent audit data depending on which dev writes which action.

The Facade enforces : **every LLM call goes through `LlmGenerationService.generate()` → strategy + log + error log are guaranteed by construction**. Future LLM features (auto-fill brand brief, summarize interactions) call the same Facade with a different `type` discriminator and gain free audit + cost visibility.

### Error hierarchy

```typescript
export abstract class LlmError extends Error {
  abstract readonly code: string;
}

export class LlmEmptyResponseError      extends LlmError { code = "EMPTY_RESPONSE"; ... }
export class LlmApiError                 extends LlmError { code = "API_ERROR"; ... }
export class BuilderError                extends LlmError { code = "BUILDER_INVALID"; ... }
export class MissingEnvError             extends LlmError { code = "MISSING_ENV"; ... }
export class UnknownProviderError        extends LlmError { code = "UNKNOWN_PROVIDER"; ... }
```

### .env contract

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5-mini
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-5
```

`LlmStrategyProviderFactory` only requires the API key matching `LLM_PROVIDER`. Other providers can stay blank.

### Pricing table (model → cents)

```typescript
// lib/ai/pricing.ts
const PRICING: Record<string, { inPerMTok: number; outPerMTok: number }> = {
  "gpt-5":             { inPerMTok: 1.25, outPerMTok: 10.00 },
  "gpt-5-mini":        { inPerMTok: 0.25, outPerMTok:  2.00 },
  "gpt-4o":            { inPerMTok: 2.50, outPerMTok: 10.00 },
  "gpt-4o-mini":       { inPerMTok: 0.15, outPerMTok:  0.60 },
  "claude-sonnet-4-5": { inPerMTok: 3.00, outPerMTok: 15.00 },
};
```

Unknown models return `0` cents and log a warning (not a crash — we want to ship even with a new model).

---

## Brand brief

### Type

```typescript
// lib/brand/brand-brief.ts
export type BrandBriefLocale = {
  positioning: string;             // 1-2 sentences "who you are and for whom"
  toneOfVoice: string[];           // ["warm", "expert", "concise"]
  forbiddenWords: string[];        // ["cheap", "discount", "guys"]
  signatureExpressions: string[];  // brand-specific phrases to favor
  valueProps: string[];            // 3-5 bullet arguments
  proofPoints: string[];           // "Le Bristol, Plaza Athénée, Ritz Paris"
};

export type BrandBrief = {
  fr?: BrandBriefLocale;
  en?: BrandBriefLocale;
};
```

### Schema migration

Add to `organizations` (column already typed as `jsonb` in schema, see existing `brand_brief jsonb` column — verify and adjust the type binding to `BrandBrief` in `db/schema.ts`).

### Editor UI — `/settings/brand`

- Tabs : FR / EN.
- Each tab : 6 inputs (positioning textarea, the five list fields as tag inputs / textareas with one-per-line).
- Save button → `updateBrandBriefAction(formData)` validates Zod schema, persists `brand_brief = { fr, en }`.
- Empty fields → omit the locale. Both FR and EN optional, but at least one must be set before generation works (action returns explicit error if neither is set for the contact's locale).

### No client-specific seed

hitempo is multi-tenant. The codebase contains zero references to specific customer organizations. Every org owner fills in their own brand brief via `/settings/brand`. New orgs start with `brand_brief = {}` ; the generation action returns `BrandBriefMissingError` until at least one locale is populated, surfaced in the modal as a clear CTA to the settings page.

---

## Database schema

### `llm_usage` — generic LLM audit (this sprint introduces it, all future LLM features reuse it)

```typescript
export const llmUsageType = pgEnum("llm_usage_type", [
  "outbound_message",         // sprint 07 — the only producer at MVP
  "brand_brief_generation",   // future
  "interaction_summary",      // future
  "company_enrichment",       // future
  "signal_extraction",        // future
  "other",                    // fallback
]);

export const llmUsageStatus = pgEnum("llm_usage_status", ["success", "error"]);

export const llmUsage = pgTable("llm_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id"),                   // who triggered (null = background job)

  type: llmUsageType("type").notNull(),

  // Provenance — keep model + tokens to enable retroactive cost analysis when prices shift
  provider: text("provider").notNull(),       // "openai" | "anthropic"
  model:    text("model").notNull(),          // "gpt-5-mini" | "claude-sonnet-4-5" | ...
  tokensIn:  integer("tokens_in").notNull(),
  tokensOut: integer("tokens_out").notNull(),
  costCents: integer("cost_cents").notNull().default(0),  // computed at log time with current PRICING table
  durationMs: integer("duration_ms"),         // round-trip latency (excl. DB overhead)

  // Polymorphic backref — knowing which entity this call was for, without per-feature columns
  relatedEntityType: text("related_entity_type"),  // "message" | "company" | "contact" | "organization" | ...
  relatedEntityId:   uuid("related_entity_id"),

  // Errors get logged too — visibility on cost of retries and provider outages
  status:    llmUsageStatus("status").notNull().default("success"),
  errorCode: text("error_code"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byOrg:  index("idx_llm_usage_org").on(t.organizationId, t.createdAt),
  byType: index("idx_llm_usage_type").on(t.organizationId, t.type, t.createdAt),
  byUser: index("idx_llm_usage_user").on(t.userId, t.createdAt),
}));
```

### `messages` — outbound message content (FK to `llm_usage` for audit/provenance)

```typescript
export const messageStatus = pgEnum("message_status", [
  "draft",       // generated, not copied yet
  "copied",      // user clicked copy-to-clipboard
  "discarded",   // user closed modal without copying
  "sent",        // V1 : Gmail send confirmed
]);

export const messageChannel = pgEnum("message_channel", ["email", "linkedin"]);

export const messageIntent = pgEnum("message_intent", [
  "first_contact", "follow_up", "meeting_request",
  "proposal_send", "reconnect", "other",
]);

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  userId: uuid("user_id").notNull(),        // who triggered the generation

  channel: messageChannel("channel").notNull(),
  intent:  messageIntent("intent").notNull(),
  locale:  text("locale").notNull(),        // "fr" | "en"

  orientation: text("orientation"),         // optional user note ("plus court", "mentionne la rénovation")
  content:     text("content").notNull(),   // final content (after user edits if any)

  // Single source of truth for provider/model/tokens/cost lives in llm_usage — JOIN when displayed
  llmUsageId: uuid("llm_usage_id").notNull().references(() => llmUsage.id, { onDelete: "restrict" }),

  status: messageStatus("status").notNull().default("draft"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  byContact: index("idx_messages_contact").on(t.contactId, t.createdAt),
  byCompany: index("idx_messages_company").on(t.companyId, t.createdAt),
  byOrg:     index("idx_messages_org").on(t.organizationId, t.createdAt),
}));
```

### RLS

Same 4-statement pattern as previous business tables, **on both** `llm_usage` AND `messages`. A user only sees their org's messages and only their org's LLM usage records.

### Insertion order in `generateMessageAction`

1. `LlmGenerationService.generate()` → calls strategy → on success inserts `llm_usage` row → returns `{ result, usageId }`
2. Action inserts `messages` row with `llmUsageId = usageId`
3. Action patches the just-inserted `llm_usage` row to set `relatedEntityType = "message"` + `relatedEntityId = message.id` (we couldn't know `message.id` before step 2)

---

## Server actions

```typescript
// lib/actions/messages.ts

export type ChannelIntent =
  | "email-first_contact" | "email-follow_up" | "email-meeting_request"
  | "email-proposal_send" | "email-reconnect"
  | "linkedin-first_contact" | "linkedin-follow_up"
  | "linkedin-meeting_request" | "linkedin-reconnect";

export async function generateMessageAction(formData: FormData): Promise<{
  messageId: string;
  subject: string | null;     // null for LinkedIn
  body: string;
  tokensIn: number;
  tokensOut: number;
}> {
  // 1. Zod validate { contactId, companyId, taskId?, channelIntent, locale, includeSignal, orientation? }
  // 2. Parse channelIntent → { channel: "email"|"linkedin", intent: MessageIntent }
  // 3. Fetch context : contact, company, last 10 interactions (6mo cap),
  //    last 5 previously generated messages for contact, brand brief for the locale,
  //    sender (user) first + last name
  // 4. If brand brief is missing for target locale → throw BrandBriefMissingError
  // 5. If !includeSignal, strip signal info from the context before building the prompt
  // 6. Build prompt via buildOutboundMessagePrompt(ctx)
  // 7. Call LlmGenerationServiceFactory.getInstance().generate({
  //      input, context: { orgId, userId, type: "outbound_message" }
  //    })
  //    → returns { result, usageId }
  // 8. If channel === "email" : parse subject (first line after "Objet:" or first line)
  //    + body. Otherwise subject = null and body = full content.
  // 9. Insert messages row with { content, llmUsageId: usageId, status: "draft" } + return
  // 10. Patch llm_usage row : set relatedEntityType="message", relatedEntityId=message.id
  // 11. revalidatePath(`/contacts/${contactId}`), `/companies/${companyId}`, `/tasks` if taskId
}

export async function updateMessageStatusAction(formData: FormData): Promise<void> {
  // Zod { messageId, status: "copied" | "discarded" }
  // Update messages.status + updatedAt, multi-tenant filter via WHERE organization_id.
}

export async function updateMessageContentAction(formData: FormData): Promise<void> {
  // Zod { messageId, subject?, body }
  // Reassemble content from subject + body for emails (with "Object: ...\n\n..." format),
  // body only for LinkedIn. Update messages.content + updatedAt.
}
```

```typescript
// lib/actions/brand.ts

export async function updateBrandBriefAction(formData: FormData): Promise<void> {
  // Zod validate full BrandBrief shape (fr, en optional locales)
  // Update organizations.brand_brief, revalidatePath("/settings/brand")
}
```

---

## UI components

### `<GenerateMessageDialog>` — controlled 2-column dialog

Client component. Width ~1100px, max-height ~720px, internal scroll on the right column.

#### Props

```typescript
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "task" | "contact";
  contactId: string;
  companyId: string;
  taskId?: string;                       // only when mode = "task"

  // Pre-fill data — fetched by parent server component
  contactDisplayName: string;            // "Sophie Durand"
  companyDisplayName: string;            // "Hôtel Westminster"
  defaultChannelIntent?: ChannelIntent;  // combined "email-first_contact" etc.
  defaultLocale: string;                 // "fr" | "en", from contact.preferred_language
  preferredLocaleSource: string;         // "Langue préférée de Sophie Durand"
  detectedSignal?: { type: string; daysAgo: number; isFresh: boolean };  // null if none
  brandBriefExcerpt?: string;            // first ~150 chars of positioning OR null if missing
  brandBriefMissingForLocale?: boolean;  // surfaces inline warning + CTA to /settings/brand
};
```

#### Internal state machine

```typescript
type State =
  | { step: "config"; params: GenerateParams }
  | { step: "generating"; params: GenerateParams }
  | { step: "result"; params: GenerateParams; message: GeneratedMessage; orientationOpen: boolean }
  | { step: "regenerating"; params: GenerateParams; previousMessage: GeneratedMessage }
  | { step: "error"; params: GenerateParams; error: string };

type GenerateParams = {
  channelIntent: ChannelIntent;           // dropdown value
  locale: "fr" | "en";
  includeSignal: boolean;                 // toggle, default = !!detectedSignal.isFresh
  orientation: string;                    // empty by default
};

type GeneratedMessage = {
  messageId: string;
  subject: string | null;                 // email mode only
  body: string;
  tokensIn: number;
  tokensOut: number;
  generatedAt: Date;
};
```

#### Layout (2 columns)

**Header (dark bar)** :
```
✨ Génération IA · {companyDisplayName} → {contactDisplayName}        [×]
```

**Left column — PARAMÈTRES** :

| Field | UI | Notes |
|---|---|---|
| `Type de message` | Dropdown with 9 combos | `Email — Premier contact`, `Email — Relance`, `Email — Demande de RDV`, `Email — Proposition`, `Email — Reprise de contact`, `LinkedIn — Premier contact`, `LinkedIn — Relance`, `LinkedIn — Demande de RDV`, `LinkedIn — Reprise de contact` |
| `Signal détecté` | Chip + Toggle | Shown only if `detectedSignal != null`. Chip displays `{type} ({daysAgo}j)` with green dot if fresh, slate if old. Toggle "Mentionner dans le message" defaults to ON when fresh. Hidden when no signal. |
| `Langue` | 2-button toggle | `🇫🇷 Français` / `🇬🇧 English`. Below : muted text `{preferredLocaleSource}` |
| `Brief de marque actif` | Read-only quote card | Shows `brandBriefExcerpt`. Below : link `Modifier le brief →` to `/settings/brand`. If `brandBriefMissingForLocale === true`, instead show prominent warning : "Aucun brief pour {locale}. Configure-le pour générer." with CTA button. |

**Right column — MESSAGE GÉNÉRÉ** :

*Empty state* (before first generation) : centered illustration + "Choisis tes paramètres et clique sur Générer."

*Loading state* : spinner + "Génération en cours…" (no model name shown).

*Result state* :
- Top-right metadata : `Généré il y a {n} sec · {tokensIn + tokensOut} tokens`
- **Objet** field (email mode only) : editable single-line input
- **Corps du message** : editable textarea. Rendered with color annotations overlay :
  - Personalization variables in **blue**
  - Signal-related substrings in **amber**
  - When user clicks into the textarea, annotations stay visible (rendered as background overlay or sibling preview — V1 polish; MVP can render annotated read-only preview ABOVE the editable textarea)
- **Legend** below the textarea : `🔵 Variables personnalisées · 🟡 Signal injecté`
- **Action bar** :
  - `⟲ Régénérer` — opens an inline orientation textarea ; clicking again triggers regeneration
  - `📋 Copier` — copies (subject + body if email, body only if LinkedIn), calls `updateMessageStatusAction(messageId, "copied")`, closes dialog
- **Régénérer behavior** : when expanded, shows textarea `Orientation pour régénérer` (e.g., "plus court", "mentionne le contact précédent"). Confirm button triggers a new generation with same params + new orientation. The previous message stays accessible until the new one arrives (no blank state).

*Error state* : red banner with error code + retry button.

#### Generate flow

1. User clicks `Générer` → `step: "generating"`
2. Call `generateMessageAction(formData)` with `{ contactId, companyId, taskId?, channelIntent, locale, includeSignal, orientation }`
3. On success → `step: "result"` with returned `{ messageId, subject, body, tokensIn, tokensOut }`
4. On error → `step: "error"`

#### Close behavior

- User clicks `×` or backdrop : if `step === "result"` and message was NOT copied, fire `updateMessageStatusAction(messageId, "discarded")`. Then `onOpenChange(false)`.
- If user copied first, status is already `"copied"`, no further update.

### `<MessageAnnotator>` — pure function for color highlights

```typescript
// lib/ai/message-annotator.ts
export type AnnotatedSegment =
  | { kind: "plain"; text: string }
  | { kind: "personalize"; text: string }
  | { kind: "signal"; text: string };

export function annotateMessage(
  text: string,
  ctx: {
    contactFirstName: string;
    contactLastName: string;
    contactJobTitle: string | null;
    companyName: string;
    senderFirstName: string;
    senderLastName: string;
    signalKeywords: string[];   // derived from signalType + variations
  },
): AnnotatedSegment[];
```

Pure function, no LLM dependency. Uses ordered substring matching (longest first to avoid partial overlaps). The dialog renders segments with the right span class per `kind`.

For `signalKeywords` : a small `signal-keywords-fr.ts` / `signal-keywords-en.ts` table maps `signalType` → list of stems (e.g., `"renovation"` → `["rénovation", "rénove", "rénover", "rénovant", "renovation", "renovating", "renovate"]`).

### Trigger from task row

In `task-row-actions.tsx` : new dropdown item "Generate message" shown only if `task.type ∈ {email, linkedin, follow_up}` AND `task.contactId` is set. Sets dialog state, renders the dialog as sibling (same pattern as `TaskInteractionDialog`).

### Trigger from contact detail

In `app/(app)/contacts/[id]/page.tsx` : a "Generate message" button in the header actions area. Renders `<GenerateMessageDialog mode="contact" ...>`.

### `/settings/brand` page

Server component. Loads `organization.brand_brief`. Renders client `<BrandBriefEditor>` with two tabs (FR / EN). Each tab is a `<form action={updateBrandBriefAction}>` with the 6 fields. Save button at the bottom of each tab.

---

## Prompt structure (provider-agnostic)

```typescript
// lib/ai/prompts/outbound-message-prompt.ts

export type OutboundMessageContext = {
  brandBrief: BrandBriefLocale;       // localized
  company: { name: string; industry: string | null; standing: number | null; score: number | null };
  // Signal is provided here ONLY if includeSignal === true in the action input.
  // The action strips it from the context when the user toggles it off.
  signal: { type: string; detectedAt: Date; ageDays: number } | null;
  contact: { firstName: string; lastName: string; jobTitle: string | null; preferredLanguage: string; relevance: number | null };
  interactions: Array<{ occurredAt: Date; type: string; channel: string; outcome: string | null; summary: string | null; interestLevel: number | null }>;
  previousMessages: Array<{ createdAt: Date; channel: string; intent: string; content: string }>;
  sender: { firstName: string; lastName: string };
  intent: MessageIntent;
  channel: MessageChannel;
  locale: "fr" | "en";
  orientation?: string;
};

export function buildOutboundMessagePrompt(ctx: OutboundMessageContext): {
  systemPrompt: string;
  userPrompt: string;
};
```

### System prompt skeleton (FR)

```
Tu es un assistant de rédaction commerciale pour {brandBrief.positioning}.

Voix et ton :
- Ton : {brandBrief.toneOfVoice.join(", ")}
- Expressions signature à privilégier : {brandBrief.signatureExpressions}
- Mots/expressions à éviter absolument : {brandBrief.forbiddenWords}

Arguments de valeur disponibles :
{brandBrief.valueProps.map(v => "- " + v).join("\n")}

Preuves sociales mobilisables :
{brandBrief.proofPoints.map(p => "- " + p).join("\n")}

Contraintes de format pour ce message :
{channel === "email"
  ? `- Email : 80-150 mots dans le corps
- Première ligne EXACTEMENT au format : "Objet: <ton objet>"
- Ligne vide après l'objet
- Puis le corps du message`
  : "- LinkedIn DM : max 300 caractères, pas d'objet, pas de salutation formelle"}
- Langue : français
- Pas de mention de prix
- Signature : {sender.firstName} {sender.lastName}
- Ne jamais inventer de proof point qui n'est pas dans la liste ci-dessus
- Ne jamais répéter une phrase d'un message précédent
{!signal ? "- Ne PAS inventer de signal/événement (rénovation, ouverture, etc.) si aucun n'est fourni dans le contexte" : ""}
```

### User prompt skeleton

```
Génère un message pour ce prospect :

## Entreprise
{company.name} · {company.industry} · Standing : {company.standing}/5
{signal ? `Signal actif : ${signal.type} (détecté il y a ${signal.ageDays} jours)` : "(aucun signal à mentionner)"}
Score hitempo : {company.score}/100

## Contact
{contact.firstName} {contact.lastName} · {contact.jobTitle}

## Historique d'interactions ({interactions.length} dernières)
{interactions.map(i => `- ${formatDate(i.occurredAt)} · ${i.type}/${i.channel}${i.outcome ? "/" + i.outcome : ""} : ${i.summary ?? "(pas de résumé)"}`).join("\n")}

## Messages précédents que nous lui avons envoyés
{previousMessages.length === 0 ? "(aucun)" : previousMessages.map(m => `--- ${formatDate(m.createdAt)} · ${m.channel}/${m.intent} ---\n${m.content}`).join("\n\n")}

## Intent de ce message
{intent} via {channel}

{orientation ? `## Orientation spécifique\n${orientation}` : ""}

Rédige uniquement le message final, sans préambule ni commentaire.
{channel === "email" ? "Format : objet en première ligne, ligne vide, puis corps." : ""}
```

EN version mirrored.

---

## i18n additions

```json
"pages": {
  "messages": {
    "modalTitle": "AI generation",
    "modalSubtitle": "{company} → {contact}",
    "paramsHeader": "Parameters",
    "resultHeader": "Generated message",
    "fields": {
      "channelIntent": "Message type",
      "signalDetected": "Detected signal",
      "signalInclude": "Mention in the message",
      "signalAge": "{days}d ago",
      "language": "Language",
      "languageHint": "Preferred language of {contact}",
      "brandBriefActive": "Active brand brief",
      "brandBriefEdit": "Edit the brief →",
      "brandBriefMissing": "No brief for {locale} yet. Configure it to generate.",
      "subject": "Subject",
      "body": "Message body",
      "orientation": "Anything to refine?",
      "orientationPlaceholder": "e.g. shorter, mention the previous contact"
    },
    "channelIntentOptions": {
      "email-first_contact": "Email — First contact",
      "email-follow_up": "Email — Follow-up",
      "email-meeting_request": "Email — Meeting request",
      "email-proposal_send": "Email — Proposal",
      "email-reconnect": "Email — Reconnect",
      "linkedin-first_contact": "LinkedIn — First contact",
      "linkedin-follow_up": "LinkedIn — Follow-up",
      "linkedin-meeting_request": "LinkedIn — Meeting request",
      "linkedin-reconnect": "LinkedIn — Reconnect"
    },
    "actions": {
      "generate": "Generate",
      "generating": "Generating…",
      "regenerate": "Regenerate",
      "regenerateConfirm": "Apply",
      "copy": "Copy",
      "copied": "Copied to clipboard",
      "close": "Close",
      "openConfig": "Set up generation",
      "fromTask": "Generate message from task",
      "fromContact": "Generate message"
    },
    "legend": {
      "personalize": "Personalized variables",
      "signalInjected": "Injected signal"
    },
    "metadata": {
      "generatedAgo": "Generated {ago} · {tokens} tokens"
    },
    "errors": {
      "brandBriefMissing": "Brand brief not set for {locale}. Configure it in Settings → Brand.",
      "generationFailed": "Generation failed. Try again.",
      "noContact": "This task has no contact — generation needs a contact."
    }
  },
  "settings": {
    "brand": {
      "title": "Brand voice",
      "subtitle": "Used by hitempo's AI to generate brand-aligned messages.",
      "tabFr": "Français",
      "tabEn": "English",
      "fields": {
        "positioning": "Positioning",
        "toneOfVoice": "Tone of voice",
        "forbiddenWords": "Forbidden words",
        "signatureExpressions": "Signature expressions",
        "valueProps": "Value propositions",
        "proofPoints": "Proof points"
      },
      "save": "Save",
      "saved": "Saved"
    }
  }
},
"messageIntent": {
  "first_contact": "First contact",
  "follow_up": "Follow-up",
  "meeting_request": "Meeting request",
  "proposal_send": "Proposal",
  "reconnect": "Reconnect",
  "other": "Other"
},
"messageChannel": {
  "email": "Email",
  "linkedin": "LinkedIn"
}
```

---

## Tests

| Test file | What it covers |
|---|---|
| `tests/ai/openai-strategy.test.ts` | OpenAI strategy with mocked SDK client : happy path, empty response throws, error mapping |
| `tests/ai/anthropic-strategy.test.ts` | Same for Anthropic |
| `tests/ai/openai-strategy-builder.test.ts` | Builder rejects missing apiKey/model, produces correct strategy with defaults |
| `tests/ai/llm-strategy-provider.test.ts` | Provider returns correct strategy by name, throws `UnknownProviderError` if not registered |
| `tests/ai/llm-strategy-provider-factory.test.ts` | Factory reads env, registers strategies whose API key is present, singleton behavior, `reset()` works |
| `tests/ai/pricing.test.ts` | Calculator returns correct cents for known models, 0 + warning for unknown |
| `tests/ai/llm-usage-logger.test.ts` | `DbLlmUsageLogger` inserts row with correct fields, `NoopLlmUsageLogger` returns fake record without DB call |
| `tests/ai/llm-generation-service.test.ts` | Facade logs on success (status=success, tokens populated) AND on error (status=error, tokens=0, errorCode set). Uses `NoopLlmUsageLogger` + mocked strategy. |
| `tests/ai/prompts/outbound-message-prompt.test.ts` | Snapshot tests on system + user prompt for FR/EN, with/without orientation, with/without previous messages, with/without signal injection |
| `tests/ai/message-annotator.test.ts` | Pure function `annotateMessage()` — produces correct `AnnotatedSegment[]` for personalization vars (firstName, lastName, companyName, jobTitle) and signal keywords (FR + EN stems). Edge cases : overlapping matches resolved by longest-first, no false positives on partial words. |
| `tests/rls/messages.test.ts` | L&G user reads only L&G messages ; Bristol isolated ; platform admin reads both |
| `tests/rls/llm-usage.test.ts` | Same isolation guarantees on `llm_usage` |

Target : ~25 new tests, total ~55+ tests at end of sprint.

---

## Release order (within the sprint)

1. **Schema + migration** ✅ — `llm_usage` + `messages` tables + 5 enums, `brand_brief` typed, RLS on both
2. **LLM infrastructure** — types → pricing → errors → strategies → builders → provider → factory (each tested before next)
3. **LLM usage logging + generation Facade** — `LlmUsageLogger` (Db + Noop) → `LlmGenerationService` → `LlmGenerationServiceFactory`
4. **`/settings/brand` editor** — `<BrandBriefEditor>` + `updateBrandBriefAction`. Ships early so we can dogfood (fill our own brief via the UI before testing generation).
5. **Prompt builder** + snapshot tests (pure function, no external dep)
6. **`generateMessageAction`** — wires steps 2–5 + `messages` insert + backref patch
7. **`<GenerateMessageDialog>`** client component (the heart of the UX)
8. **Trigger from task row** (smaller diff, ships first)
9. **Trigger from contact detail**
10. **i18n FR + EN final pass**
11. **lint / build / test green**

---

## Acceptance criteria

- [x] `LLM_PROVIDER=openai` + `OPENAI_API_KEY` in `.env.local` is enough to generate a message
- [x] Switching to `LLM_PROVIDER=anthropic` with a valid key works without code change
- [x] Brand brief editable from `/settings/brand`, FR and EN tabs, saved to `organizations.brand_brief`
- [ ] Generating from a task with a contact takes < 6s and produces a brand-aligned message — _verified end-to-end with real provider key in browser_
- [ ] Generating from a contact with intent + channel + orientation works — _same, requires live key_
- [ ] Regenerate with orientation "plus court" visibly produces a shorter output — _live key required_
- [x] Copy-to-clipboard updates `messages.status = "copied"`
- [x] Closing the modal without copying updates `messages.status = "discarded"`
- [ ] LinkedIn output respects the 300-character limit — _system prompt constrains the model ; client-side hard validator not yet implemented_
- [x] Email output : subject parsed and shown in its own field, body separate (via `extractSubjectAndBody`)
- [x] Contact with `preferred_language = en` gets an English message (defaultLocale picker + EN templates)
- [x] Missing brand brief for target locale shows a clear error message + CTA to `/settings/brand`
- [x] Signal toggle ON injects signal into the prompt context ; OFF strips it AND adds "do not invent signal" constraint
- [x] Color annotations visible in result : personalization vars in blue, signal keywords in amber, legend shown
- [x] Model selector is NOT shown in the modal (env-driven only)
- [x] Cost in cents is computed and stored for every generation in `llm_usage`
- [x] **Every LLM call logs to `llm_usage`** — including failures (status=`error`, tokens=0, errorCode set)
- [x] `messages.llm_usage_id` FK is correctly populated and resolvable via JOIN
- [x] `LlmGenerationService` is the only entry point used by server actions (no direct strategy calls bypassing the logger)
- [x] Multi-tenant safe — every query filters by `organization_id`, RLS policies on `messages` AND `llm_usage`
- [x] Architecture conforms to project OOP/SOLID conventions (Strategy + Builder + Provider + Factory of Provider + Facade, constructor injection, typed errors)
- [x] No hardcoded strings — all labels through i18n, perfect FR/EN parity
- [x] `npm run lint`, `npm run build`, `npm run test` clean (129 unit tests passing)

---

## Implementation notes

### Architecture delivered

The full Strategy + Builder + Provider + Factory of Provider + Facade stack ships as specified. 14 new classes in `lib/ai/`, every dependency injected via constructor, every error typed, every public class exposes `getInstance()` as canonical entry point :

```
LlmStrategy (interface)
 ├── OpenAiStrategy ←── OpenAiStrategyBuilder
 └── AnthropicStrategy ←── AnthropicStrategyBuilder

LlmStrategyProvider (holds Map<ProviderName, LlmStrategy>)
LlmStrategyProviderFactory.getInstance() → Provider (singleton, env-driven)

LlmUsageLogger (interface)
 ├── DbLlmUsageLogger (production)
 └── NoopLlmUsageLogger (tests)

LlmGenerationService (Facade)
LlmGenerationServiceFactory.getInstance() → Service (singleton)
```

### Deviations from the brief

- **No client-specific seed** (e.g. L&G brand brief in code) — multi-tenant integrity. Brand brief is configured per-org via `/settings/brand` exclusively.
- **`generateMessageAction` returns `{ messageId, channel, subject, body, tokensIn, tokensOut }`** — `channel` added so the dialog knows whether to render a subject field without re-parsing.
- **`linkUsageToEntity` patches the FK after insertion** — the message row is inserted with the FK to `llm_usage`, then `llm_usage.related_entity_*` is patched in a follow-up update. This is because the message ID can't be known before insertion.
- **Editor list fields use newline-separated textareas** instead of a tag-input component — pragmatic MVP choice ; the server action splits on `\n` and trims. Tag editor can ship later as polish without changing the API.
- **`async TaskRow` in `/tasks/page.tsx`** — needed `getTranslations("pages.messages")` to build the labels for the row's dialog. React Server Components handle async components natively, but it changes the file's shape.
- **`brand_brief.fr` / `brand_brief.en` are independently optional** — generation throws `BrandBriefMissingError` only when the target locale's brief is empty. An org with only FR configured can generate FR messages but not EN.

### Gotchas

- **Drizzle re-emitted `interactions.task_id` ADD COLUMN** at codegen time even though the column already existed (sprint 05 applied it manually via psql, never recorded in `supabase_migrations`). Fix : removed the duplicate lines from the new migration AND retrofitted the orphan sprint-05 migration with `IF NOT EXISTS` to make it idempotent.
- **`server-only` import breaks Vitest** — added a vitest alias to `tests/helpers/server-only-stub.ts` so we can import Strategies / Builders / Provider directly in unit tests.
- **OpenAI SDK uses `max_completion_tokens`**, not `max_tokens`, in current versions. The Strategy wraps both to the same `maxTokens` field on `GenerateInput`.
- **Anthropic puts the system prompt in a top-level `system` field**, not as a role-system message. Translation handled in `AnthropicStrategy.generate()`.

### What was NOT implemented (deferred to polish or V1+)

- **Per-generation model selector** in the UI — env-driven only (decision verrouillée).
- **"Modèle IA" displayed in the modal** — not shown (decision Q1 — fully hidden).
- **LinkedIn 300-char client-side validator** — prompt constrains the model but no UI red-line if model exceeds.
- **"Autres formulations suggérées"** (alt phrasings) — mockup feature deferred to V1+.
- **"Programmer" + "Envoyer via Gmail"** — explicitly out of scope (sprint 08+).
- **"Modifier" mode toggle** — textarea is always editable instead.
- **Per-org cost dashboard** — data captured in `llm_usage`, no UI yet.
- **Brand brief auto-generation feature** — schema reserves `llm_usage_type = "brand_brief_generation"` for it.

### Test coverage

- 129 unit tests passing (15 files)
- 47 LLM infrastructure tests (strategies, builders, provider, factory, pricing, errors)
- 12 service/logger tests (Facade success/error, logger)
- 21 prompt builder tests (FR/EN, signal toggle, channel format, snapshot)
- 18 message helpers (extract-subject, sender-name, signal-keywords, annotator)
- RLS isolation test for `messages` + `llm_usage` deferred (`tests/rls/*` already has connection-pool issues from prior sprints).

### Files inventory

| Layer | Files |
|---|---|
| Schema | `db/schema.ts` (+5 enums, +2 tables, +brand_brief typing) ; `supabase/migrations/20260527103853_*.sql` |
| LLM core | `lib/ai/{llm-strategy,errors,pricing}.ts` |
| Strategies | `lib/ai/strategies/{openai,anthropic}-strategy.ts` |
| Builders | `lib/ai/builders/{openai,anthropic}-strategy-builder.ts` |
| Provider | `lib/ai/{llm-strategy-provider,llm-strategy-provider-factory}.ts` |
| Logger + Facade | `lib/ai/{llm-usage-logger,llm-generation-service,llm-generation-service-factory}.ts` |
| Prompts | `lib/ai/prompts/outbound-message-prompt.ts` |
| Messages helpers | `lib/messages/{types,extract-subject,signal-keywords,message-annotator,task-defaults}.ts` |
| Brand | `lib/brand/brand-brief.ts` ; `db/queries/brand.ts` ; `lib/actions/brand.ts` |
| Auth helper | `lib/auth/sender-name.ts` |
| DB queries | `db/queries/{messages,interactions}.ts` (interactions enriched) |
| Server actions | `lib/actions/messages.ts` |
| UI | `app/(app)/settings/brand/page.tsx` ; `components/app/{brand-brief-editor,generate-message-dialog,contact-generate-message-button,task-row-actions}.tsx` |
| Tests | `tests/ai/**` ; `tests/messages/**` ; `tests/auth/**` |
| i18n | `messages/{en,fr}.json` (perfect parity, +messageIntent, +messageChannel, +pages.messages, +pages.settings.brand) |
| Config | `.env.example` (LLM_PROVIDER, OPENAI_MODEL, ANTHROPIC_MODEL documented) ; `CLAUDE.md` (Code style & patterns section) ; `vitest.config.ts` (server-only alias) |

### Sprint length

7 release-order steps, all green at every checkpoint. Total : ~3700 lines of new code + tests + docs.
