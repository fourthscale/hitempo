import "server-only";

import { GmailOAuthError, MissingGmailEnvError } from "./gmail-errors";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "openid",
  "email",
] as const;

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
  id_token?: string;
};

export type GoogleUserInfo = {
  email: string;
  email_verified: boolean;
};

/**
 * Reads the Google OAuth config from env. Throws a typed error if any
 * required var is missing — surfaces clearly instead of a cryptic 500.
 */
export function getGoogleOAuthConfig(siteUrl: string): GoogleOAuthConfig {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId) throw new MissingGmailEnvError("GOOGLE_OAUTH_CLIENT_ID");
  if (!clientSecret) throw new MissingGmailEnvError("GOOGLE_OAUTH_CLIENT_SECRET");
  return {
    clientId,
    clientSecret,
    redirectUri: `${siteUrl}/api/auth/gmail/callback`,
  };
}

/**
 * Builds the Google consent URL. `state` is opaque to Google and round-trips
 * to the callback for CSRF protection. We request offline access + force a
 * consent prompt to guarantee a fresh refresh_token (Google omits it on
 * subsequent connects unless we ask).
 */
export function buildAuthorizationUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: REQUIRED_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  config: GoogleOAuthConfig,
  code: string,
): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new GmailOAuthError(`Token exchange failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as GoogleTokenResponse;
  if (!json.refresh_token) {
    // We force prompt=consent, so this should never happen. If it does,
    // the user likely revoked + re-consented while we still had a refresh
    // token. We fail loud rather than silently lose offline access.
    throw new GmailOAuthError(
      "Google returned no refresh_token. Revoke access in your Google account and reconnect.",
    );
  }
  return json;
}

export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
): Promise<Pick<GoogleTokenResponse, "access_token" | "expires_in" | "scope" | "token_type">> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new GmailOAuthError(`Token refresh failed (${res.status}): ${body}`);
  }
  return res.json();
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new GmailOAuthError(`Userinfo fetch failed (${res.status})`);
  }
  return res.json();
}
