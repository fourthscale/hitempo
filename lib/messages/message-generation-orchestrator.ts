import "server-only";

import { getBrandBrief } from "@/db/queries/brand";
import { getCompanyById } from "@/db/queries/companies";
import { getContactById } from "@/db/queries/contacts";
import { getRecentInteractionsForPrompt } from "@/db/queries/interactions";
import { getRecentMessagesByContact } from "@/db/queries/messages";
import { BrandBriefMissingError } from "@/lib/ai/errors";
import type { LlmGenerationService } from "@/lib/ai/llm-generation-service";
import { buildOutboundMessagePrompt } from "@/lib/ai/prompts/outbound-message-prompt";
import { extractSubjectAndBody } from "@/lib/messages/extract-subject";
import {
  CompanyNotFoundError,
  ContactNotFoundError,
} from "@/lib/messages/message-errors";
import type {
  MessageChannel,
  MessageIntent,
  MessageLocale,
} from "@/lib/messages/types";

/**
 * Strongly-typed input the orchestrator expects. The action layer is
 * responsible for parsing/validating raw FormData into this shape before
 * calling `generate()` — keeping zod out of this class.
 */
export type OrchestratorInput = {
  organizationId: string;
  userId: string;
  contactId: string;
  companyId: string;
  /** Empty string normalized to null at the action boundary. */
  taskId: string | null;
  channel: MessageChannel;
  intent: MessageIntent;
  locale: MessageLocale;
  includeSignal: boolean;
  /** Free-text steering note from the user (null if blank). */
  orientation: string | null;
  sender: {
    firstName: string;
    lastName: string;
  };
};

export type OrchestratorResult = {
  /** The full raw content as produced by the LLM (with "Subject: ..." line for
   *  email channel). Persisted as-is when the user commits to send / log. */
  content: string;
  /** Parsed split — convenience for the UI preview. */
  channel: MessageChannel;
  subject: string | null;
  body: string;
  /** FK target on `messages.llm_usage_id` once the row is created at commit. */
  llmUsageId: string;
  tokensIn: number;
  tokensOut: number;
};

/**
 * Facade for the "generate one outbound message" workflow.
 *
 * Coordinates the five-step pipeline so the action layer stays thin :
 *
 *   1. fetch context (contact, company, brief, interactions, prior messages)
 *   2. assemble the signal block (or drop it if disabled / absent)
 *   3. build the prompt
 *   4. call the LLM via the injected `LlmGenerationService` Facade
 *      (which auto-logs to `llm_usage`)
 *   5. persist the `messages` row and patch the `llm_usage.relatedEntity*` backref
 *
 * Errors raised here use the typed hierarchy from `message-errors.ts`
 * (`ContactNotFoundError`, `CompanyNotFoundError`, `MessagePersistError`).
 * `BrandBriefMissingError` from the prompt-prep step propagates unchanged so
 * the action layer can map it to its own user-facing message.
 *
 * Dependencies are constructor-injected — the factory composes the production
 * `LlmGenerationService`; tests can pass a mock.
 */
export class MessageGenerationOrchestrator {
  constructor(private readonly llmService: LlmGenerationService) {}

  public async generate(input: OrchestratorInput): Promise<OrchestratorResult> {
    // 1. Fetch context in parallel.
    const [contact, company, brief, interactionsList, previousMsgs] =
      await Promise.all([
        getContactById(input.organizationId, input.contactId),
        getCompanyById(input.organizationId, input.companyId),
        getBrandBrief(input.organizationId),
        getRecentInteractionsForPrompt(input.organizationId, input.companyId),
        getRecentMessagesByContact(input.organizationId, input.contactId, 5),
      ]);

    if (!contact) throw new ContactNotFoundError(input.contactId);
    if (!company) throw new CompanyNotFoundError(input.companyId);

    // 2. Validate the brand brief for the requested locale.
    const briefLocale = brief?.[input.locale];
    if (!briefLocale || !briefLocale.positioning) {
      throw new BrandBriefMissingError(input.locale);
    }

    // 3. Build the signal block — omitted if the user toggled it off OR if
    //    the company has no detected signal in the first place.
    const companySignal =
      input.includeSignal && company.signalType && company.signalDetectedAt
        ? {
            type: company.signalType,
            detectedAt: company.signalDetectedAt,
            ageDays: Math.floor(
              (Date.now() - new Date(company.signalDetectedAt).getTime()) /
                (24 * 60 * 60 * 1000),
            ),
          }
        : null;

    // 4. Build the prompt.
    const { systemPrompt, userPrompt } = buildOutboundMessagePrompt({
      brandBrief: briefLocale,
      company: {
        name: company.name,
        industry: company.industry,
        standing: company.standing,
        score: company.score,
      },
      signal: companySignal,
      contact: {
        firstName: contact.firstName,
        lastName: contact.lastName,
        jobTitle: contact.jobTitle,
        preferredLanguage: contact.preferredLanguage ?? input.locale,
        relevance: contact.relevance,
      },
      interactions: interactionsList.map((i) => ({
        occurredAt: i.occurredAt,
        type: i.type,
        channel: i.channel,
        outcome: i.outcome,
        summary: i.summary,
        interestLevel: i.interestLevel,
      })),
      previousMessages: previousMsgs.map((m) => ({
        createdAt: m.createdAt,
        channel: m.channel as MessageChannel,
        intent: m.intent as MessageIntent,
        content: m.content,
      })),
      sender: input.sender,
      intent: input.intent,
      channel: input.channel,
      locale: input.locale,
      orientation: input.orientation ?? undefined,
    });

    // 5. Call the LLM via the Facade (auto-logs to llm_usage).
    const { result, usage } = await this.llmService.generate({
      input: { systemPrompt, userPrompt },
      context: {
        organizationId: input.organizationId,
        userId: input.userId,
        type: "outbound_message",
      },
    });

    // 6. Parse subject + body (email) ; LinkedIn is body-only.
    const { subject, body } = extractSubjectAndBody(
      result.content,
      input.channel,
      input.locale,
    );

    // The messages row is intentionally NOT created here — it is persisted
    // later only if the user actually commits the message (Send via Gmail
    // or manually log the interaction). The llm_usage row already exists ;
    // its `relatedEntity*` backref is patched at commit time too.

    return {
      content: result.content,
      channel: input.channel,
      subject,
      body,
      llmUsageId: usage.id,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
    };
  }
}
