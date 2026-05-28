import "server-only";

import { getAdminDb } from "@/db/client";
import { GmailCredentialsServiceFactory } from "./gmail-credentials-service-factory";
import { GmailReplyPoller } from "./gmail-reply-poller";

/**
 * Lazy singleton factory for the Inngest reply-polling job. Wires the
 * admin DB pool (the cron runs outside any user session — no `auth.uid()`)
 * with the credentials service and the site URL needed for token refresh.
 */
export class GmailReplyPollerFactory {
  private static cached: GmailReplyPoller | null = null;

  public static getInstance(): GmailReplyPoller {
    if (this.cached) return this.cached;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    this.cached = new GmailReplyPoller(
      getAdminDb(),
      GmailCredentialsServiceFactory.getInstance(),
      siteUrl,
    );
    return this.cached;
  }

  public static setInstance(poller: GmailReplyPoller): void {
    this.cached = poller;
  }

  public static reset(): void {
    this.cached = null;
  }
}
