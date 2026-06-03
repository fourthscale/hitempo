import "server-only";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { tasks } from "@/db/schema";
import { getContactById } from "@/db/queries/contacts";
import { getCompanyById } from "@/db/queries/companies";
import { getMessageContextResolutionForTask } from "@/db/queries/sequences";
import { resolveLocalizedString } from "@/lib/sequences/locale-resolver";
import { resolveContactDisplayName } from "@/lib/contacts/contact-kind";
import {
  renderTemplate,
  type TemplateFacts,
} from "@/lib/messages/template-render";
import {
  type MessageChannel,
  type MessageIntent,
  type MessageLocale,
  messageIntentToInteractionType,
} from "@/lib/messages/types";
import type { SequenceStepAttachmentRef } from "@/lib/sequences/types";
import type { MessageGenerationOrchestrator } from "@/lib/messages/message-generation-orchestrator";
import type { GmailService } from "@/lib/gmail/gmail-service";
import type { AttachmentStorageService } from "@/lib/gmail/attachment-storage-service";
import type { MimeAttachment } from "@/lib/gmail/mime-message-strategy";
import { GmailCredentialsNotFoundError, GmailApiError } from "@/lib/gmail/gmail-errors";
import { insertMessage } from "@/db/queries/messages";
import { insertMessageAttachment } from "@/db/queries/message-attachments";
import { logInteraction } from "@/db/queries/interactions";
import { completeTask } from "@/db/queries/tasks";
import { promoteContactStatus } from "@/lib/contacts/contact-status-promoter";
import { emitSequenceTaskCompleted } from "@/lib/sequences/engine/emit-task-completed";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSenderName as deriveSenderName } from "@/lib/auth/sender-name";

/**
 * Sprint 12 phase 4 — auto-execute the outbound email for an "agent" task.
 *
 * A sequence step with `assignment.actor === "agent"` produces a task the
 * system handles end-to-end : render the template (defined mode) or call
 * the LLM (ai mode), pull the step's pre-attached files from Storage,
 * send via the assignee's connected Gmail, archive attachments, log the
 * outbound interaction, complete the task, advance the sequence.
 *
 * The class is constructor-injected (per SOLID + the codebase's OOP
 * convention) so tests can mock collaborators without touching real
 * Gmail / LLM / Storage. Production wiring lives in
 * `AgentMessageExecutorFactory`.
 *
 * Failure mode : any error mid-flight is caught at the top level and
 * recorded on the task as `auto_execution_status='failed'` +
 * `auto_execution_error=<reason>`. The task stays pending so the human
 * assignee (the same user whose Gmail we tried to use) sees it in their
 * queue with the failure reason and can take over via the existing
 * dialogs.
 */
export type AgentExecutionInput = {
  taskId: string;
};

export type AgentExecutionResult =
  | { status: "succeeded"; messageId: string; threadId: string }
  | { status: "failed"; error: string };

export class AgentMessageExecutor {
  constructor(
    private readonly db: Db,
    private readonly orchestrator: MessageGenerationOrchestrator,
    private readonly gmail: GmailService,
    private readonly storage: AttachmentStorageService,
  ) {}

  public async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    // Defensive : reject empty/undefined taskId upfront. Without this guard,
    // every downstream DB query passes `undefined` to a parameterized
    // `where tasks.id = $1` and postgres-js raises `UNDEFINED_VALUE`. We've
    // seen this happen with stale Inngest events queued before the engine
    // started returning {taskId, scheduledFor} (older payloads memoized at
    // the time of the event still flow through the step.run replay).
    if (!input.taskId || typeof input.taskId !== "string") {
      const reason = `AgentMessageExecutor invoked with invalid taskId (${JSON.stringify(input.taskId)})`;
      console.error("[AgentMessageExecutor]", reason);
      return { status: "failed", error: reason };
    }
    try {
      const result = await this.executeInner(input.taskId);
      await this.markTaskAutoExecutionSucceeded(input.taskId);
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.markTaskAutoExecutionFailed(input.taskId, reason).catch(
        (markErr) => {
          // The mark-failed itself failed — log and let the original error
          // surface. Operationally this means the task stays at
          // status=pending but we can't surface a reason ; better than
          // silent drop.
          console.error(
            "[AgentMessageExecutor] markFailed failed (non-fatal)",
            markErr,
          );
        },
      );
      return { status: "failed", error: reason };
    }
  }

  // ---------------------------------------------------------------------------
  // Inner flow — throws on any failure ; the outer `execute` catches.
  // ---------------------------------------------------------------------------

  private async executeInner(
    taskId: string,
  ): Promise<{ status: "succeeded"; messageId: string; threadId: string }> {
    // 1. Load the task row — confirm pending + still auto_execution_status=pending.
    //    A human picking up the task mid-sleep would have completed it ;
    //    we must not double-send.
    const task = await this.db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
      columns: {
        id: true,
        organizationId: true,
        contactId: true,
        companyId: true,
        assigneeId: true,
        status: true,
        autoExecutionStatus: true,
        sequenceEnrolmentId: true,
      },
    });
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status !== "pending") {
      throw new Error(
        `Task is not pending (status=${task.status}) — human may have taken over`,
      );
    }
    if (task.autoExecutionStatus !== "pending") {
      throw new Error(
        `Task auto-execution is not pending (status=${task.autoExecutionStatus})`,
      );
    }
    if (!task.assigneeId) {
      throw new Error("Task has no assignee — agent needs a user's Gmail");
    }
    if (!task.contactId || !task.companyId) {
      throw new Error("Task is missing contactId or companyId");
    }

    // 2. Load step config via the resolution helper (returns the source
    //    step's `actionConfig` — mode, subject, body, attachments, intent…).
    const ctx = await getMessageContextResolutionForTask(this.db, taskId);
    if (!ctx || !ctx.stepActionConfig) {
      throw new Error("Source step config not found — task may not be sequence-driven");
    }
    const stepCfg = ctx.stepActionConfig as {
      mode?: "ai" | "defined";
      channel?: MessageChannel;
      intent?: MessageIntent;
      subject?: unknown;
      body?: unknown;
      orientation?: unknown;
      includeSignal?: boolean;
      attachments?: unknown;
    };
    const channel: MessageChannel = stepCfg.channel ?? "email";
    if (channel !== "email") {
      // We only auto-send via Gmail. LinkedIn / phone stays human.
      throw new Error(
        `Agent auto-execution only supports email channel (got ${channel})`,
      );
    }
    const intent: MessageIntent = stepCfg.intent ?? "first_contact";

    // 3. Load contact + company + sender name. The sender resolves through
    //    the admin auth API since we're outside an RLS user session.
    const [contact, company, sender] = await Promise.all([
      getContactById(task.organizationId, task.contactId),
      getCompanyById(task.organizationId, task.companyId),
      this.resolveSenderName(task.assigneeId),
    ]);
    if (!contact) throw new Error("Contact not found");
    if (!company) throw new Error("Company not found");
    if (!contact.email) {
      throw new Error("Contact has no email address");
    }

    const locale: MessageLocale =
      (contact.preferredLanguage as MessageLocale | null) ??
      (company.primaryLocale as MessageLocale | null) ??
      "fr";

    // 4. Compute the content. Two branches : defined mode renders the
    //    template ; ai mode calls the orchestrator (LLM + brief + signals).
    const mode = stepCfg.mode === "defined" ? "defined" : "ai";
    let subject: string;
    let body: string;
    let llmUsageId: string | null = null;

    if (mode === "defined") {
      const { subject: s, body: b } = await this.renderDefined({
        stepCfg,
        locale,
        contact,
        company,
        sender,
      });
      subject = s;
      body = b;
    } else {
      const generated = await this.orchestrator.generate({
        organizationId: task.organizationId,
        userId: task.assigneeId,
        contactId: task.contactId,
        companyId: task.companyId,
        taskId,
        channel,
        intent,
        locale,
        includeSignal: Boolean(stepCfg.includeSignal),
        orientation: this.resolveOrientation(stepCfg.orientation, locale),
        sender: { firstName: sender.firstName, lastName: sender.lastName },
        sequenceEnrolmentId: ctx.sequenceEnrolmentId,
      });
      subject = generated.subject ?? "";
      body = generated.body;
      llmUsageId = generated.llmUsageId;
    }

    // 5. Load step pre-attachments from Storage. Same path layout as the
    //    dialog send flow (`<orgId>/step-...`).
    const stepAttachments = await this.loadStepAttachments(
      task.organizationId,
      stepCfg.attachments,
    );

    // 6. Send via Gmail using the assignee's OAuth credentials.
    let sendResult;
    try {
      sendResult = await this.gmail.send({
        userId: task.assigneeId,
        to: contact.email,
        subject: subject || (locale === "fr" ? "(sans objet)" : "(no subject)"),
        body,
        attachments: stepAttachments.length > 0 ? stepAttachments : undefined,
      });
    } catch (err) {
      if (err instanceof GmailCredentialsNotFoundError) {
        throw new Error(
          "Assignee has not connected Gmail — agent cannot send on their behalf",
        );
      }
      if (err instanceof GmailApiError) {
        throw new Error(`Gmail send failed: ${err.message}`);
      }
      throw err;
    }

    // 7. Persist message + log interaction + archive attachments + complete
    //    task + advance sequence. Mirrors `persistSentMessage` in the action
    //    layer but runs on the admin db (`this.db`).
    const fullContent =
      channel === "email" && subject
        ? `${locale === "fr" ? "Objet" : "Subject"}: ${subject}\n\n${body}`
        : body;
    const summary = subject || body.slice(0, 120).trim() || null;

    const inserted = await insertMessage(
      task.organizationId,
      {
        contactId: task.contactId,
        companyId: task.companyId,
        taskId,
        userId: task.assigneeId,
        channel,
        intent,
        locale,
        orientation: null,
        content: fullContent,
        llmUsageId,
        sentAt: new Date(),
        gmailThreadId: sendResult.threadId,
        gmailMessageId: sendResult.messageId,
      },
      this.db,
    );

    // Archive attachments to Storage under the message id (best-effort).
    for (const att of stepAttachments) {
      try {
        const uploaded = await this.storage.upload({
          organizationId: task.organizationId,
          messageId: inserted.id,
          filename: att.filename,
          mimeType: att.mimeType,
          content: att.content,
        });
        await insertMessageAttachment({
          organizationId: task.organizationId,
          messageId: inserted.id,
          storageBucket: uploaded.storageBucket,
          storagePath: uploaded.storagePath,
          filename: att.filename,
          mimeType: att.mimeType,
          sizeBytes: att.content.byteLength,
          uploadedBy: task.assigneeId,
        });
      } catch (err) {
        console.error(
          "[AgentMessageExecutor] attachment archive failed (non-fatal)",
          err,
        );
      }
    }

    const interaction = await logInteraction(
      task.organizationId,
      task.assigneeId,
      {
        companyId: task.companyId,
        contactId: task.contactId,
        taskId,
        type: messageIntentToInteractionType(intent),
        channel,
        outcome: null,
        summary,
        occurredAt: new Date(),
        status: "sent",
        messageId: inserted.id,
      },
      this.db,
    );
    if (!interaction) throw new Error("Failed to log interaction");

    // Complete the task + kick the engine.
    await completeTask(task.organizationId, taskId, task.assigneeId, this.db);
    await emitSequenceTaskCompleted(task.organizationId, taskId);

    // Promote contact status (fire-and-forget).
    void promoteContactStatus(task.organizationId, task.contactId, {
      kind: "outbound_sent",
    });

    return {
      status: "succeeded",
      messageId: inserted.id,
      threadId: sendResult.threadId,
    };
  }

  // ---------------------------------------------------------------------------
  // Defined-mode rendering — mirrors the dialog path but server-side only.
  // ---------------------------------------------------------------------------

  private async renderDefined(args: {
    stepCfg: {
      subject?: unknown;
      body?: unknown;
    };
    locale: MessageLocale;
    contact: {
      kind: string | null;
      firstName: string | null;
      lastName: string | null;
      jobTitle: string | null;
      email: string | null;
    };
    company: { name: string; signalType: string | null };
    sender: { firstName: string; lastName: string };
  }): Promise<{ subject: string; body: string }> {
    const lc = {
      contact: { preferredLanguage: args.locale },
      company: { primaryLocale: args.locale },
      organization: { defaultLocale: args.locale },
    };
    const subjectTpl = args.stepCfg.subject
      ? resolveLocalizedString(
          args.stepCfg.subject as Parameters<typeof resolveLocalizedString>[0],
          lc,
        )
      : "";
    const bodyTpl = args.stepCfg.body
      ? resolveLocalizedString(
          args.stepCfg.body as Parameters<typeof resolveLocalizedString>[0],
          lc,
        )
      : "";

    const senderFull = [args.sender.firstName, args.sender.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    const facts: TemplateFacts = {
      "contact.firstName": args.contact.firstName,
      "contact.lastName": args.contact.lastName,
      "contact.fullName": resolveContactDisplayName({
        kind: args.contact.kind as Parameters<typeof resolveContactDisplayName>[0]["kind"],
        firstName: args.contact.firstName,
        lastName: args.contact.lastName,
        email: args.contact.email,
      }),
      "contact.jobTitle": args.contact.jobTitle,
      "company.name": args.company.name,
      "company.signalType": args.company.signalType,
      "sender.firstName": args.sender.firstName,
      "sender.lastName": args.sender.lastName,
      "sender.fullName": senderFull,
    };

    return {
      subject: renderTemplate(subjectTpl, facts).text,
      body: renderTemplate(bodyTpl, facts).text,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private resolveOrientation(
    raw: unknown,
    locale: MessageLocale,
  ): string | null {
    if (!raw) return null;
    const resolved = resolveLocalizedString(
      raw as Parameters<typeof resolveLocalizedString>[0],
      {
        contact: { preferredLanguage: locale },
        company: { primaryLocale: locale },
        organization: { defaultLocale: locale },
      },
    );
    return resolved.trim().length > 0 ? resolved : null;
  }

  private async loadStepAttachments(
    organizationId: string,
    rawAttachments: unknown,
  ): Promise<MimeAttachment[]> {
    if (!Array.isArray(rawAttachments) || rawAttachments.length === 0) return [];
    const refs = (rawAttachments as unknown[]).filter(
      (a): a is SequenceStepAttachmentRef =>
        a != null &&
        typeof a === "object" &&
        typeof (a as { storagePath?: unknown }).storagePath === "string" &&
        typeof (a as { filename?: unknown }).filename === "string" &&
        typeof (a as { mimeType?: unknown }).mimeType === "string" &&
        typeof (a as { sizeBytes?: unknown }).sizeBytes === "number",
    );
    const prefix = `${organizationId}/step-`;
    const owned = refs.filter((r) => r.storagePath.startsWith(prefix));
    const out: MimeAttachment[] = [];
    for (const ref of owned) {
      // downloadAsAdmin (vs download) — we're in an Inngest worker without
      // a user session ; the RLS-bound client would return "Object not
      // found". The `<orgId>/step-` prefix filter above is our defense in
      // depth against accidentally fetching another org's file.
      const content = await this.storage.downloadAsAdmin(
        "message-attachments",
        ref.storagePath,
      );
      out.push({
        filename: ref.filename,
        mimeType: ref.mimeType,
        content,
      });
    }
    return out;
  }

  private async resolveSenderName(
    userId: string,
  ): Promise<{ firstName: string; lastName: string }> {
    try {
      const { data, error } = await getSupabaseAdmin().auth.admin.getUserById(
        userId,
      );
      if (error || !data.user) return { firstName: "", lastName: "" };
      const name = deriveSenderName({
        email: data.user.email ?? null,
        user_metadata: (data.user.user_metadata as Record<string, unknown>) ?? null,
      });
      return { firstName: name.firstName, lastName: name.lastName };
    } catch {
      return { firstName: "", lastName: "" };
    }
  }

  private async markTaskAutoExecutionSucceeded(taskId: string): Promise<void> {
    await this.db
      .update(tasks)
      .set({
        autoExecutionStatus: "succeeded",
        autoExecutionAt: new Date(),
        autoExecutionError: null,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));
  }

  private async markTaskAutoExecutionFailed(
    taskId: string,
    reason: string,
  ): Promise<void> {
    // Defensive — should be caught by execute()'s upfront guard, but a
    // belt-and-braces check here prevents an UNDEFINED_VALUE blast from a
    // logic change elsewhere reaching the DB driver.
    if (!taskId) return;
    // Truncate the reason to keep the column reasonable (the underlying
    // text column has no limit but the UI tooltip does).
    const truncated = reason.slice(0, 500);
    await this.db
      .update(tasks)
      .set({
        autoExecutionStatus: "failed",
        autoExecutionAt: new Date(),
        autoExecutionError: truncated,
        updatedAt: new Date(),
      })
      .where(and(eq(tasks.id, taskId)));
  }
}
