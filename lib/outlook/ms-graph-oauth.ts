import "server-only";

import { MailOAuthError, MissingMailEnvError } from "@/lib/mail/mail-errors";

const MS_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MS_USERINFO_URL = "https://graph.microsoft.com/v1.0/me";

/**
 * Scopes requested for the Outlook integration. Mirrors the Gmail
 * scope set : send + read + identity. `offline_access` is what gives
 * us a refresh token ; without it Microsoft returns access token only.
 *
 * - `Mail.Send`      : send outbound mail
 * - `Mail.ReadWrite` : read inbox for reply detection + thread fetch
 * - `User.Read`      : surface the user's email (for the From address)
 * - `offline_access` : get a refresh token
 * - `openid`, `email`, `profile` : OIDC identity payload
 */
const REQUIRED_SCOPES = [
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/User.Read",
  "offline_access",
  "openid",
  "email",
  "profile",
] as const;

export type MsGraphOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type MsGraphTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
  id_token?: string;
};

export type MsGraphUserInfo = {
  email: string;
  displayName: string | null;
};

/**
 * Reads the MS Graph OAuth config from env. Throws a typed error if
 * any required var is missing.
 */
export function getMsGraphOAuthConfig(siteUrl: string): MsGraphOAuthConfig {
  const clientId = process.env.MS_GRAPH_CLIENT_ID;
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;
  if (!clientId) throw new MissingMailEnvError("MS_GRAPH_CLIENT_ID");
  if (!clientSecret) throw new MissingMailEnvError("MS_GRAPH_CLIENT_SECRET");
  return {
    clientId,
    clientSecret,
    redirectUri: `${siteUrl}/api/auth/mail/callback`,
  };
}

/**
 * Builds the Microsoft consent URL. `state` is opaque to Microsoft and
 * round-trips to the callback for CSRF protection + provider dispatch.
 * We request `offline_access` to force a refresh token, and pass
 * `prompt=consent` to guarantee a fresh authorization (Microsoft
 * sometimes silently reuses prior consent without re-issuing a refresh
 * token if scopes haven't changed).
 */
export function buildAuthorizationUrl(config: MsGraphOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: REQUIRED_SCOPES.join(" "),
    prompt: "consent",
    state,
  });
  return `${MS_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  config: MsGraphOAuthConfig,
  code: string,
): Promise<MsGraphTokenResponse> {
  const res = await fetch(MS_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
      grant_type: "authorization_code",
      scope: REQUIRED_SCOPES.join(" "),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new MailOAuthError(`MS Graph token exchange failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as MsGraphTokenResponse;
  if (!json.refresh_token) {
    // We force prompt=consent + offline_access so this shouldn't happen.
    // If it does, the user has a sticky session that didn't issue a
    // refresh token — they'd need to revoke + reconnect manually.
    throw new MailOAuthError(
      "MS Graph returned no refresh_token. Revoke access in your Microsoft account and reconnect.",
    );
  }
  return json;
}

export async function refreshAccessToken(
  config: MsGraphOAuthConfig,
  refreshToken: string,
): Promise<Pick<MsGraphTokenResponse, "access_token" | "expires_in" | "scope" | "token_type">> {
  const res = await fetch(MS_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: REQUIRED_SCOPES.join(" "),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new MailOAuthError(`MS Graph token refresh failed (${res.status}): ${body}`);
  }
  return res.json();
}

/**
 * Fetch the connected user's identity. Used by the OAuth callback to
 * stamp the row's `email_address` column. Microsoft returns the
 * primary mail in either `mail` (work/school) or `userPrincipalName`
 * (consumer Microsoft accounts where `mail` is null) — we coalesce.
 */
export async function fetchMsGraphUserInfo(accessToken: string): Promise<MsGraphUserInfo> {
  const res = await fetch(MS_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new MailOAuthError(`MS Graph userinfo fetch failed (${res.status})`);
  }
  const json = (await res.json()) as {
    mail?: string | null;
    userPrincipalName?: string | null;
    displayName?: string | null;
  };
  const email = json.mail ?? json.userPrincipalName ?? null;
  if (!email) {
    throw new MailOAuthError("MS Graph /me returned no email / userPrincipalName");
  }
  return {
    email,
    displayName: json.displayName ?? null,
  };
}
