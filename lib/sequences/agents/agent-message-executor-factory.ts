import "server-only";
import { getAdminDb } from "@/db/client";
import { AgentMessageExecutor } from "./agent-message-executor";
import { MessageGenerationOrchestratorFactory } from "@/lib/messages/message-generation-orchestrator-factory";
import { GmailServiceFactory } from "@/lib/gmail/gmail-service-factory";
import { getAttachmentStorageService } from "@/lib/gmail/attachment-storage-service";

/**
 * Singleton factory for `AgentMessageExecutor` — wires the admin db pool
 * (the executor runs outside an RLS user session from Inngest), the
 * production LLM orchestrator, the Gmail service, and the attachment
 * storage service. Tests can bypass this and construct the executor
 * directly with mocked collaborators.
 */
export class AgentMessageExecutorFactory {
  private static cached: AgentMessageExecutor | null = null;

  public static getInstance(): AgentMessageExecutor {
    if (!this.cached) {
      this.cached = new AgentMessageExecutor(
        getAdminDb(),
        MessageGenerationOrchestratorFactory.getInstance(),
        GmailServiceFactory.getInstance(),
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
