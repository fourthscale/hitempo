import "server-only";

import { GmailServiceFactory } from "@/lib/gmail/gmail-service-factory";
import { OutlookServiceFactory } from "@/lib/outlook/outlook-service-factory";
import { MailCredentialsServiceFactory } from "./mail-credentials-service-factory";
import { MailCredentialsNotFoundError } from "./mail-errors";
import type { MailService } from "./mail-service";
import type { MailProvider } from "./mail-credentials-service";

/**
 * Routes a runtime mail operation to the right provider implementation
 * based on the user's stored credential `provider` column.
 *
 * Call sites never branch on provider — they ask the Factory for the
 * service that fits this user and call the interface methods. Adding a
 * third provider (Yahoo, custom SMTP, etc.) is a one-file change : new
 * implementation + one more arm in `forProvider`.
 *
 * Sprint 16.
 */
export class MailServiceFactory {
  /**
   * Return the MailService instance matching the given user's stored
   * provider. Throws MailCredentialsNotFoundError when the user has no
   * connected mailbox (the caller decides whether that's a hard error
   * or a "no-op silently" — agent executor escalates to mail_auth).
   */
  public static async forUser(userId: string): Promise<MailService> {
    const status = await MailCredentialsServiceFactory.getInstance()
      .getConnectionStatus(userId);
    if (!status.connected || !status.provider) {
      throw new MailCredentialsNotFoundError(userId);
    }
    return this.forProvider(status.provider);
  }

  /**
   * Synchronous dispatch by known provider — used by the OAuth
   * callback and any code path that already resolved the provider
   * (e.g. dialog send-button label).
   */
  public static forProvider(provider: MailProvider): MailService {
    switch (provider) {
      case "gmail":
        return GmailServiceFactory.getInstance();
      case "outlook":
        return OutlookServiceFactory.getInstance();
      default: {
        // Exhaustiveness check — if a new provider is added to the
        // MailProvider union, TS errors here until we handle it.
        const _exhaustive: never = provider;
        throw new Error(
          `Unknown mail provider: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  }
}
