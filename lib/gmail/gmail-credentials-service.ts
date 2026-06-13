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

  /**
   * Lightweight "is this user connected ?" check for UI gating. Avoids the
   * decrypt cost of `getForUser` when the caller only needs the connection
   * state + the Gmail address to display.
   *
   * Sprint 14 — `status` is included so callers can distinguish a healthy
   * connection from a revoked one (refresh token died, user needs to
   * reconnect). Older callers that only inspect `connected` keep working
   * unchanged — a revoked credential row still returns `connected: true`
   * because the row exists, the `status` field carries the nuance.
   */
  public async getConnectionStatus(
    userId: string,
  ): Promise<{
    connected: boolean;
    address: string | null;
    status: "active" | "revoked" | null;
    revokedAt: Date | null;
    lastRefreshError: string | null;
  }> {
    const row = await this.db.query.userGmailCredentials.findFirst({
      where: eq(userGmailCredentials.userId, userId),
      columns: {
        gmailAddress: true,
        status: true,
        revokedAt: true,
        lastRefreshError: true,
      },
    });
    if (!row) {
      return { connected: false, address: null, status: null, revokedAt: null, lastRefreshError: null };
    }
    return {
      connected: true,
      address: row.gmailAddress,
      status: row.status,
      revokedAt: row.revokedAt,
      lastRefreshError: row.lastRefreshError,
    };
  }

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
          // Sprint 14 — reconnect clears the revoked state. A user who
          // hit Reconnect-Gmail after a refresh-token death lands here ;
          // we restore `active` + wipe the failure breadcrumbs so the
          // UI flips back to the green "connected" card and the OAuth
          // callback can safely replay the failed agent tasks.
          status: "active",
          revokedAt: null,
          lastRefreshError: null,
        },
      });
  }

  /**
   * Sprint 14 — flag a credential as revoked. Called by GmailService when
   * Google returns `invalid_grant` on a refresh attempt. We deliberately
   * keep the encrypted tokens around : the user might re-grant the
   * exact same authorization (rare but possible), and even if not, the
   * row is the canonical "this user had a Gmail connection" record that
   * the executor + UI need to gate auto-execution off until reconnect.
   *
   * Idempotent : safe to call repeatedly for the same user — `revokedAt`
   * only set on the first transition (subsequent calls keep the original
   * timestamp), the error message is overwritten each time so we always
   * see the most recent failure mode.
   */
  public async markRevoked(userId: string, error: string): Promise<void> {
    const truncated = error.slice(0, 500);
    const now = new Date();
    // Pull the existing row to preserve `revokedAt` on repeat calls — we
    // want to show "revoked since X" in the UI, not "revoked since just
    // now" after every failed cron tick.
    const existing = await this.db
      .select({ status: userGmailCredentials.status, revokedAt: userGmailCredentials.revokedAt })
      .from(userGmailCredentials)
      .where(eq(userGmailCredentials.userId, userId))
      .limit(1)
      .then((rows) => rows[0]);
    if (!existing) return; // No credential row — nothing to mark.
    const revokedAt =
      existing.status === "revoked" && existing.revokedAt
        ? existing.revokedAt
        : now;
    await this.db
      .update(userGmailCredentials)
      .set({
        status: "revoked",
        revokedAt,
        lastRefreshError: truncated,
        lastRefreshAttemptAt: now,
      })
      .where(eq(userGmailCredentials.userId, userId));
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
        // Sprint 14 — record the successful refresh. Mirrors the
        // failure path (markRevoked sets `lastRefreshAttemptAt` too),
        // so both branches converge on a single "when did we last try
        // to keep this credential alive" timestamp.
        lastRefreshAttemptAt: new Date(),
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
