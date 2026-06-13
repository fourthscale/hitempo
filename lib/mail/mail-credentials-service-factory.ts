import "server-only";

import { getAdminDb } from "@/db/client";
import { TokenCipherFactory } from "@/lib/crypto/token-cipher";
import { MailCredentialsService } from "./mail-credentials-service";

/**
 * Lazy singleton factory for the unified `MailCredentialsService`. The
 * OAuth callback and any server action that persists tokens calls
 * `MailCredentialsServiceFactory.getInstance()`. One service instance
 * covers both Gmail and Outlook credentials — the table is unified
 * sprint 16.
 *
 * Tests inject a stub via `setInstance()` + `reset()`.
 */
export class MailCredentialsServiceFactory {
  private static cached: MailCredentialsService | null = null;

  public static getInstance(): MailCredentialsService {
    if (this.cached) return this.cached;
    this.cached = new MailCredentialsService(
      getAdminDb(),
      TokenCipherFactory.getInstance(),
    );
    return this.cached;
  }

  public static setInstance(service: MailCredentialsService): void {
    this.cached = service;
  }

  public static reset(): void {
    this.cached = null;
  }
}
