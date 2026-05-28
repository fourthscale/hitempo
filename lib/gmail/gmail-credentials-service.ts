import "server-only";

import { eq } from "drizzle-orm";
import type { TokenCipher } from "@/lib/crypto/token-cipher";
import { userGmailCredentials } from "@/db/schema";
import type { Db } from "@/db/client";
import { GmailCredentialsNotFoundError } from "./gmail-errors";

/**
 * Decrypted view of a `user_gmail_credentials` row. Returned by the service
 * to higher-level callers (GmailService, profile page). Tokens are plaintext
 * in memory only — never logged, never persisted in clear form.
 */
export type DecryptedGmailCredentials = {
  userId: string;
  organizationId: string;
  gmailAddress: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
  connectedAt: Date;
  lastUsedAt: Date | null;
};

export type GmailCredentialsUpsertInput = {
  userId: string;
  organizationId: string;
  gmailAddress: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scopes: string[];
};

/**
 * CRUD service for Gmail OAuth credentials. Encrypts tokens before writing,
 * decrypts on read. The service-role DB is injected so writes bypass RLS
 * (the OAuth callback runs server-side and must write on behalf of the user).
 *
 * Single responsibility : token persistence. Refresh logic and API calls
 * belong to the higher-level `GmailService` (slice B).
 */
export class GmailCredentialsService {
  constructor(
    private readonly db: Db,
    private readonly cipher: TokenCipher,
  ) {}

  public async getForUser(userId: string): Promise<DecryptedGmailCredentials | null> {
    const row = await this.db.query.userGmailCredentials.findFirst({
      where: eq(userGmailCredentials.userId, userId),
    });
    if (!row) return null;
    return {
      userId: row.userId,
      organizationId: row.organizationId,
      gmailAddress: row.gmailAddress,
      accessToken: this.cipher.decrypt(row.accessTokenEncrypted),
      refreshToken: this.cipher.decrypt(row.refreshTokenEncrypted),
      expiresAt: row.expiresAt,
      scopes: row.scopes,
      connectedAt: row.connectedAt,
      lastUsedAt: row.lastUsedAt,
    };
  }

  public async requireForUser(userId: string): Promise<DecryptedGmailCredentials> {
    const creds = await this.getForUser(userId);
    if (!creds) throw new GmailCredentialsNotFoundError(userId);
    return creds;
  }

  public async upsert(input: GmailCredentialsUpsertInput): Promise<void> {
    const accessTokenEncrypted = this.cipher.encrypt(input.accessToken);
    const refreshTokenEncrypted = this.cipher.encrypt(input.refreshToken);

    await this.db
      .insert(userGmailCredentials)
      .values({
        userId: input.userId,
        organizationId: input.organizationId,
        gmailAddress: input.gmailAddress,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        expiresAt: input.expiresAt,
        scopes: input.scopes,
      })
      .onConflictDoUpdate({
        target: userGmailCredentials.userId,
        set: {
          organizationId: input.organizationId,
          gmailAddress: input.gmailAddress,
          accessTokenEncrypted,
          refreshTokenEncrypted,
          expiresAt: input.expiresAt,
          scopes: input.scopes,
        },
      });
  }

  /**
   * Update just the access token + expiry (refresh path — refresh_token
   * stays the same, Google returns a new access_token only).
   */
  public async updateAccessToken(
    userId: string,
    accessToken: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.db
      .update(userGmailCredentials)
      .set({
        accessTokenEncrypted: this.cipher.encrypt(accessToken),
        expiresAt,
      })
      .where(eq(userGmailCredentials.userId, userId));
  }

  public async markUsed(userId: string): Promise<void> {
    await this.db
      .update(userGmailCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(userGmailCredentials.userId, userId));
  }

  public async delete(userId: string): Promise<void> {
    await this.db
      .delete(userGmailCredentials)
      .where(eq(userGmailCredentials.userId, userId));
  }
}
