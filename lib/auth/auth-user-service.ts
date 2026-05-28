import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  AuthDeleteUserError,
  AuthInviteError,
  AuthListUsersError,
  AuthMagicLinkError,
  AuthReinviteError,
  AuthUpdateMetadataError,
} from "./auth-errors";

/**
 * Identity-service wrapper around the Supabase Auth admin API.
 *
 * Centralizes :
 *   - paginated user lookups (listAll, findByEmail, bulkResolve)
 *   - invite / re-invite / magic-link flows with a single decision matrix
 *   - metadata patches
 *   - hard delete
 *
 * All operations throw an `AuthServiceError` subclass on failure, so the
 * caller can switch on `error.code` instead of string-matching.
 *
 * Built via `AuthUserServiceFactory.getInstance()` — see that file for the
 * env-driven configuration and the test-friendly seams.
 */

export type UserMetadataPatch = {
  firstName?: string;
  lastName?: string;
};

/**
 * Discriminated outcome of `getOrInviteOrRefresh`. The action layer uses this
 * to surface UI feedback ("invitation sent", "magic link sent", "metadata
 * updated") rather than guessing from the state of the returned user.
 */
export type InviteOrRefreshOutcome =
  /** No existing user — invited fresh. Supabase sent the invite email. */
  | { user: User; status: "invited" }
  /** User existed but never confirmed — fresh invite link re-generated and sent. */
  | { user: User; status: "reinvited" }
  /** User existed and confirmed — magic link sent so they get a heads-up email. */
  | { user: User; status: "magiclinked" }
  /** User existed, no email was sent (e.g. magic-link rate-limited). Metadata may have changed. */
  | { user: User; status: "noop"; warning?: string };

/** Default page size we hit when scanning the user table. */
const DEFAULT_PAGE_SIZE = 1000;

export class AuthUserService {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly siteUrl: string,
  ) {}

  // ---- Read ----

  /**
   * Returns ALL auth users in one page (capped at `perPage`). For the scale
   * of hitempo (hundreds, not millions) one page suffices ; if we cross that
   * threshold this method should switch to true pagination.
   */
  public async listAll(opts?: { perPage?: number }): Promise<User[]> {
    const perPage = opts?.perPage ?? DEFAULT_PAGE_SIZE;
    const { data, error } = await this.supabase.auth.admin.listUsers({ perPage });
    if (error) throw new AuthListUsersError(error.message, { cause: error });
    return data.users;
  }

  /**
   * Returns the user matching this email (case-insensitive), or null.
   */
  public async findByEmail(email: string): Promise<User | null> {
    const users = await this.listAll();
    const target = email.toLowerCase();
    return users.find((u) => u.email?.toLowerCase() === target) ?? null;
  }

  /**
   * Bulk-resolves a list of user IDs to their auth records.
   * Single paginated `listAll` call — typical use is "render a members table
   * with N rows, fetch the auth identities once for the whole table".
   */
  public async bulkResolve(userIds: string[]): Promise<Map<string, User>> {
    if (userIds.length === 0) return new Map();
    const users = await this.listAll();
    const wanted = new Set(userIds);
    const map = new Map<string, User>();
    for (const u of users) {
      if (wanted.has(u.id)) map.set(u.id, u);
    }
    return map;
  }

  // ---- Create / update ----

  /**
   * Sends a fresh invite email (Supabase creates the user as unconfirmed).
   * Errors with `AuthInviteError` if the email already exists or the API fails.
   */
  public async invite(email: string, metadata: UserMetadataPatch): Promise<User> {
    const { data, error } = await this.supabase.auth.admin.inviteUserByEmail(email, {
      data: this.metadataPayload(metadata),
      redirectTo: `${this.siteUrl}/reset-password`,
    });
    if (error) throw new AuthInviteError(email, error.message, { cause: error });
    if (!data.user) throw new AuthInviteError(email, "no user returned");
    return data.user;
  }

  public async updateMetadata(userId: string, patch: UserMetadataPatch): Promise<void> {
    const payload = this.metadataPayload(patch);
    const { error } = await this.supabase.auth.admin.updateUserById(userId, {
      user_metadata: payload,
    });
    if (error) throw new AuthUpdateMetadataError(userId, error.message, { cause: error });
  }

  /**
   * Re-generates an invite link for an existing-but-unconfirmed user.
   * Supabase sends the email via the configured SMTP.
   */
  public async sendInviteLink(email: string): Promise<void> {
    const { error } = await this.supabase.auth.admin.generateLink({
      type: "invite",
      email,
      options: { redirectTo: `${this.siteUrl}/reset-password` },
    });
    if (error) throw new AuthReinviteError(email, error.message, { cause: error });
  }

  /**
   * Sends a magic-link sign-in email. Used to notify a confirmed user that
   * something changed on their account (promotion, role change, etc.) — they
   * click the link and land on the dashboard with their new privileges visible.
   *
   * Non-fatal in spirit : a rate-limit hit shouldn't block the parent action.
   * We still throw so the caller can log and decide.
   */
  public async sendMagicLink(email: string): Promise<void> {
    const { error } = await this.supabase.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo: `${this.siteUrl}/dashboard` },
    });
    if (error) throw new AuthMagicLinkError(email, error.message, { cause: error });
  }

  /**
   * Three-way resolution :
   *
   *   - user not found → invite (status `"invited"`)
   *   - user found, not confirmed → update metadata + re-send invite (status `"reinvited"`)
   *   - user found, confirmed → update metadata + send magic link
   *     (status `"magiclinked"`, or `"noop"` if the magic-link was suppressed
   *     by rate-limit / SMTP issues — the caller still gets the User).
   *
   * Centralized so every "make sure this person can access the system" path
   * (invite to org, promote to platform admin) shares one decision matrix.
   */
  public async getOrInviteOrRefresh(
    email: string,
    metadata: UserMetadataPatch,
  ): Promise<InviteOrRefreshOutcome> {
    const existing = await this.findByEmail(email);
    if (!existing) {
      const user = await this.invite(email, metadata);
      return { user, status: "invited" };
    }

    // Only patch metadata for unconfirmed users. A confirmed user's identity
    // (name) was set at account creation; a different org's admin must not
    // overwrite it through an invite form.
    const nextMeta: UserMetadataPatch = {};
    if (!existing.email_confirmed_at) {
      const currentMeta = (existing.user_metadata ?? {}) as Record<string, unknown>;
      if (metadata.firstName && currentMeta.firstName !== metadata.firstName) {
        nextMeta.firstName = metadata.firstName;
      }
      if (metadata.lastName && currentMeta.lastName !== metadata.lastName) {
        nextMeta.lastName = metadata.lastName;
      }
      if (Object.keys(nextMeta).length > 0) {
        await this.updateMetadata(existing.id, nextMeta);
      }
    }

    if (!existing.email_confirmed_at) {
      await this.sendInviteLink(email);
      return { user: applyMetadata(existing, nextMeta), status: "reinvited" };
    }

    try {
      await this.sendMagicLink(email);
      return { user: applyMetadata(existing, nextMeta), status: "magiclinked" };
    } catch (err) {
      // Magic-link failures (typically rate-limit) shouldn't block the parent
      // action. Surface the warning so the action layer can log it without
      // crashing the user-facing flow.
      const warning = err instanceof Error ? err.message : String(err);
      return { user: applyMetadata(existing, nextMeta), status: "noop", warning };
    }
  }

  // ---- Delete ----

  public async deleteById(userId: string): Promise<void> {
    const { error } = await this.supabase.auth.admin.deleteUser(userId);
    if (error) throw new AuthDeleteUserError(userId, error.message, { cause: error });
  }

  // ---- Internals ----

  private metadataPayload(meta: UserMetadataPatch): Record<string, string> {
    const out: Record<string, string> = {};
    if (meta.firstName) out.firstName = meta.firstName;
    if (meta.lastName) out.lastName = meta.lastName;
    return out;
  }
}

function applyMetadata(user: User, patch: UserMetadataPatch): User {
  if (Object.keys(patch).length === 0) return user;
  const currentMeta = (user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    ...user,
    user_metadata: {
      ...currentMeta,
      ...(patch.firstName ? { firstName: patch.firstName } : {}),
      ...(patch.lastName ? { lastName: patch.lastName } : {}),
    },
  };
}
