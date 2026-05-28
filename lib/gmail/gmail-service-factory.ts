import "server-only";

import { GmailService } from "./gmail-service";
import { GmailCredentialsServiceFactory } from "./gmail-credentials-service-factory";

/**
 * Lazy singleton factory for `GmailService`. Reads NEXT_PUBLIC_SITE_URL
 * once — `GmailService` needs it for the OAuth refresh redirect URI.
 *
 * Tests inject a stub via `setInstance()` + `reset()` to avoid hitting
 * the live Gmail API.
 */
export class GmailServiceFactory {
  private static cached: GmailService | null = null;

  public static getInstance(): GmailService {
    if (this.cached) return this.cached;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    this.cached = new GmailService(
      GmailCredentialsServiceFactory.getInstance(),
      siteUrl,
    );
    return this.cached;
  }

  public static setInstance(service: GmailService): void {
    this.cached = service;
  }

  public static reset(): void {
    this.cached = null;
  }
}
