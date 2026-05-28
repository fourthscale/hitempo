import "server-only";

import { getAdminDb } from "@/db/client";
import { TokenCipherFactory } from "@/lib/crypto/token-cipher";
import { GmailCredentialsService } from "./gmail-credentials-service";

/**
 * Lazy singleton factory. The OAuth callback and any server action that
 * persists tokens calls `GmailCredentialsServiceFactory.getInstance()`.
 *
 * Tests inject a stub via `setInstance()` + `reset()`.
 */
export class GmailCredentialsServiceFactory {
  private static cached: GmailCredentialsService | null = null;

  public static getInstance(): GmailCredentialsService {
    if (this.cached) return this.cached;
    this.cached = new GmailCredentialsService(
      getAdminDb(),
      TokenCipherFactory.getInstance(),
    );
    return this.cached;
  }

  public static setInstance(service: GmailCredentialsService): void {
    this.cached = service;
  }

  public static reset(): void {
    this.cached = null;
  }
}
