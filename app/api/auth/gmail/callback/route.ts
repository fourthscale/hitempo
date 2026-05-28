import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getCurrentOrg } from "@/lib/auth/context";
import {
  exchangeCodeForTokens,
  fetchGoogleUserInfo,
  getGoogleOAuthConfig,
} from "@/lib/gmail/google-oauth";
import { GmailCredentialsServiceFactory } from "@/lib/gmail/gmail-credentials-service-factory";

const STATE_COOKIE = "gmail_oauth_state";

/**
 * OAuth callback :
 *
 *   GET /api/auth/gmail/callback?code=...&state=...
 *
 * 1. Validate state vs cookie (CSRF).
 * 2. Exchange code → tokens.
 * 3. Fetch the user's Google email (userinfo).
 * 4. Encrypt + persist via GmailCredentialsService (service-role DB write).
 * 5. Redirect to /settings/profile with a result flag.
 *
 * All error paths redirect back with `?gmail_error=<code>` so the page can
 * surface a clear FR/EN message via the i18n catalog.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const userDeniedError = url.searchParams.get("error");

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (userDeniedError) {
    // User clicked "Cancel" on the consent screen — not a real error.
    return redirectToProfile("denied");
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectToProfile("state_mismatch");
  }

  try {
    const { user, membership } = await getCurrentOrg();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const config = getGoogleOAuthConfig(siteUrl);

    const tokens = await exchangeCodeForTokens(config, code);
    const userInfo = await fetchGoogleUserInfo(tokens.access_token);

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const scopes = tokens.scope.split(" ");

    await GmailCredentialsServiceFactory.getInstance().upsert({
      userId: user.id,
      organizationId: membership.organizationId,
      gmailAddress: userInfo.email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token!, // exchangeCode throws if missing
      expiresAt,
      scopes,
    });

    return redirectToProfile("connected");
  } catch (err) {
    console.error("[gmail oauth callback] failed", err);
    return redirectToProfile("exchange_failed");
  }
}

function redirectToProfile(result: string): NextResponse {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return NextResponse.redirect(`${siteUrl}/settings/profile?gmail=${result}`);
}
