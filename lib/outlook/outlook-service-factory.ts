import "server-only";

import { MailCredentialsServiceFactory } from "@/lib/mail/mail-credentials-service-factory";
import { OutlookService } from "./outlook-service";

/**
 * Lazy singleton factory for `OutlookService`. Symmetric with
 * `GmailServiceFactory` — the request lifecycle reaches for one of
 * the two, the `MailServiceFactory.forUser` Facade picks the right
 * one based on the credential row.
 */
export class OutlookServiceFactory {
  private static cached: OutlookService | null = null;

  public static getInstance(): OutlookService {
    if (this.cached) return this.cached;
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    this.cached = new OutlookService(
      MailCredentialsServiceFactory.getInstance(),
      siteUrl,
    );
    return this.cached;
  }

  public static setInstance(service: OutlookService): void {
    this.cached = service;
  }

  public static reset(): void {
    this.cached = null;
  }
}
