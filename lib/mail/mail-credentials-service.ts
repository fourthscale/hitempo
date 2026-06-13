import "server-only";

import { eq } from "drizzle-orm";
import type { TokenCipher } from "@/lib/crypto/token-cipher";
import { userMailCredentials } from "@/db/schema";
import type { Db } from "@/db/client";
import { MailCredentialsNotFoundError } from "./mail-errors";

export type MailProvider = "gmail" | "outlook";

/**
 * Decrypted view of a `user_mail_credentials` row. Returned by the
 * service to higher-level callers (GmailService, OutlookService,
 * profile page). Tokens are plaintext in memory only — never logged,
 * never persisted in clear form.
 *
 * Sprint 16 — `provider` field added during the unification. Each row
 * is either a Gmail or an Outlook credential ; the service is
 * provider-agnostic at the storage layer.
 */
export type DecryptedMailCredentials = {
  userId: string;
  organizationId: string;
  provider: MailProvider;
  emailAddress: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
  connectedAt: Date;
  lastUsedAt: Date | null;
};

export type MailCredentialsUpsertInput = {
  userId: string;
  organizationId: string;
  provider: MailProvider;
  emailAddress: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
};

/**
 * CRUD service for the unified mail OAuth credentials table. Encrypts
 * tokens before writing, decrypts on read. The service-role DB is
 * injected so writes bypass RLS (the OAuth callback runs server-side
 * and must write on behalf of the user).
 *
 * Single responsibility : token persistence. Refresh logic and API
 * calls belong to the higher-level `MailService` implementations.
 */
export class MailCredentialsService {
  constructor(
    private readonly db: Db,
    private readonly cipher: TokenCipher,
  ) {}

  /**
   * Lightweight "is this user connected ?" check for UI gating. Avoids
   * the decrypt cost of `getForUser` when the caller only needs the
   * connection state + the address to display.
   *
   * Sprint 14 — `status` is included so callers can distinguish a
   * healthy connection from a revoked one. Sprint 16 — `provider` is
   * surfaced so the profile UI shows the right buttons (Connect
   * Gmail / Connect Outlook).
   */
  public async getConnectionStatus(userId: string): Promise<{
    connected: boolean;
    provider: MailProvider | null;
    address: string | null;
    status: "active" | "revoked" | null;
    revokedAt: Date | null;
    lastRefreshError: string | null;
  }> {
    const row = await this.db.query.userMailCredentials.findFirst({
      where: eq(userMailCredentials.userId, userId),
      columns: {
        provider: true,
        emailAddress: true,
        status: true,
        revokedAt: true,
        lastRefreshError: true,
      },
    });
    if (!row) {
      return {
        connected: false,
        provider: null,
        address: null,
        status: null,
        revokedAt: null,
        lastRefreshError: null,
      };
    }
    return {
      connected: true,
      provider: row.provider as MailProvider,
      address: row.emailAddress,
      status: row.status,
      revokedAt: row.revokedAt,
      lastRefreshError: row.lastRefreshError,
    };
  }

  public async getForUser(userId: string): Promise<DecryptedMailCredentials | null> {
    const row = await this.db.query.userMailCredentials.findFirst({
      where: eq(userMailCredentials.userId, userId),
    });
    if (!row) return null;
    return {
      userId: row.userId,
      organizationId: row.organizationId,
      provider: row.provider as MailProvider,
      emailAddress: row.emailAddress,
      accessToken: this.cipher.decrypt(row.accessTokenEncrypted),
      refreshToken: this.cipher.decrypt(row.refreshTokenEncrypted),
      expiresAt: row.expiresAt,
      scopes: row.scopes,
      connectedAt: row.connectedAt,
      lastUsedAt: row.lastUsedAt,
    };
  }

  public async requireForUser(userId: string): Promise<DecryptedMailCredentials> {
    const creds = await this.getForUser(userId);
    if (!creds) throw new MailCredentialsNotFoundError(userId);
    return creds;
  }

  public async upsert(input: MailCredentialsUpsertInput): Promise<void> {
    const accessTokenEncrypted = this.cipher.encrypt(input.accessToken);
    const refreshTokenEncrypted = this.cipher.encrypt(input.refreshToken);

    await this.db
      .insert(userMailCredentials)
      .values({
        userId: input.userId,
        organizationId: input.organizationId,
        provider: input.provider,
        emailAddress: input.emailAddress,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        expiresAt: input.expiresAt,
        scopes: input.scopes,
      })
      .onConflictDoUpdate({
        target: userMailCredentials.userId,
        set: {
          organizationId: input.organizationId,
          // Switching providers replaces the row — the PK is on userId
          // only, so the provider column gets overwritten too.
          provider: input.provider,
          emailAddress: input.emailAddress,
          accessTokenEncrypted,
          refreshTokenEncrypted,
          expiresAt: input.expiresAt,
          scopes: input.scopes,
          // Sprint 14 — reconnect clears the revoked state. A user who
          // hit Reconnect after a refresh-token death lands here ; we
          // restore `active` + wipe the failure breadcrumbs so the UI
          // flips back to the green "connected" card and the OAuth
          // callback can safely replay the failed agent tasks.
          status: "active",
          revokedAt: null,
          lastRefreshError: null,
        },
      });
  }

  /**
   * Sprint 14 — flag a credential as revoked. Called when the provider
   * returns `invalid_grant` on a refresh attempt. We deliberately keep
   * the encrypted tokens around : the row is the canonical "this user
   * had a mail connection" record that the executor + UI need to gate
   * auto-execution off until reconnect.
   *
   * Idempotent : safe to call repeatedly for the same user — `revokedAt`
   * only set on the first transition (subsequent calls keep the
   * original timestamp), the error message is overwritten each time so
   * we always see the most recent failure mode.
   */
  public async markRevoked(userId: string, error: string): Promise<void> {
    const truncated = error.slice(0, 500);
    const now = new Date();
    const existing = await this.db
      .select({
        status: userMailCredentials.status,
        revokedAt: userMailCredentials.revokedAt,
      })
      .from(userMailCredentials)
      .where(eq(userMailCredentials.userId, userId))
      .limit(1)
      .then((rows) => rows[0]);
    if (!existing) return;
    const revokedAt =
      existing.status === "revoked" && existing.revokedAt
        ? existing.revokedAt
        : now;
    await this.db
      .update(userMailCredentials)
      .set({
        status: "revoked",
        revokedAt,
        lastRefreshError: truncated,
        lastRefreshAttemptAt: now,
      })
      .where(eq(userMailCredentials.userId, userId));
  }

  /**
   * Update just the access token + expiry (refresh path — refresh
   * token stays the same, the provider returns a new access_token
   * only).
   */
  public async updateAccessToken(
    userId: string,
    accessToken: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.db
      .update(userMailCredentials)
      .set({
        accessTokenEncrypted: this.cipher.encrypt(accessToken),
        expiresAt,
        lastRefreshAttemptAt: new Date(),
      })
      .where(eq(userMailCredentials.userId, userId));
  }

  public async markUsed(userId: string): Promise<void> {
    await this.db
      .update(userMailCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(userMailCredentials.userId, userId));
  }

  public async delete(userId: string): Promise<void> {
    await this.db
      .delete(userMailCredentials)
      .where(eq(userMailCredentials.userId, userId));
  }
}
