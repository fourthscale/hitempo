import "server-only";
import { getAdminDb } from "@/db/client";
import { AgentMessageExecutor } from "./agent-message-executor";
import { MessageGenerationOrchestratorFactory } from "@/lib/messages/message-generation-orchestrator-factory";
import { getAttachmentStorageService } from "@/lib/gmail/attachment-storage-service";

/**
 * Singleton factory for `AgentMessageExecutor` — wires the admin db
 * pool (the executor runs outside an RLS user session from Inngest),
 * the production LLM orchestrator, and the attachment storage service.
 *
 * Sprint 16 — the mail service is no longer injected at construction
 * time : the executor resolves it per-user inside `execute()` via
 * `MailServiceFactory.forUser(task.assigneeId)`, which routes to
 * `GmailService` or `OutlookService` based on the user's stored
 * provider. Tests stub via the per-provider factory `setInstance`
 * hooks (`GmailServiceFactory.setInstance` /
 * `OutlookServiceFactory.setInstance`).
 */
export class AgentMessageExecutorFactory {
  private static cached: AgentMessageExecutor | null = null;

  public static getInstance(): AgentMessageExecutor {
    if (!this.cached) {
      this.cached = new AgentMessageExecutor(
        getAdminDb(),
        MessageGenerationOrchestratorFactory.getInstance(),
        getAttachmentStorageService(),
      );
    }
    return this.cached;
  }

  /** Test seam : reset the cached instance between specs. */
  public static reset(): void {
    this.cached = null;
  }
}
