import "server-only";

import { getAdminDb } from "@/db/client";
import { MailReplyPoller } from "./mail-reply-poller";
import { MailCredentialsServiceFactory } from "./mail-credentials-service-factory";

/**
 * Lazy singleton for the unified `MailReplyPoller`. The Inngest poll
 * function calls `MailReplyPollerFactory.getInstance().pollUser(userId)`
 * inside each `step.run()`.
 */
export class MailReplyPollerFactory {
  private static cached: MailReplyPoller | null = null;

  public static getInstance(): MailReplyPoller {
    if (this.cached) return this.cached;
    this.cached = new MailReplyPoller(
      getAdminDb(),
      MailCredentialsServiceFactory.getInstance(),
    );
    return this.cached;
  }

  public static setInstance(poller: MailReplyPoller): void {
    this.cached = poller;
  }

  public static reset(): void {
    this.cached = null;
  }
}
