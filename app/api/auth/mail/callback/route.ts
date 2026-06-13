import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getCurrentOrg } from "@/lib/auth/context";
import {
  exchangeCodeForTokens,
  fetchMsGraphUserInfo,
  getMsGraphOAuthConfig,
} from "@/lib/outlook/ms-graph-oauth";
import { MailCredentialsServiceFactory } from "@/lib/mail/mail-credentials-service-factory";
import { replayGmailAuthFailedTasksForUser } from "@/lib/sequences/agents/replay-gmail-auth-failed-tasks";

const STATE_COOKIE = "mail_oauth_state";

/**
 * Outlook OAuth callback. Sprint 16 — mirrors the Gmail callback for
 * the Microsoft Graph flow.
 *
 *   GET /api/auth/mail/callback?code=...&state=...
 *
 * 1. Validate state vs cookie (CSRF).
 * 2. Exchange code → tokens via the MS token endpoint.
 * 3. Fetch the user's identity from Graph /me.
 * 4. Persist into `user_mail_credentials` with provider='outlook'.
 * 5. Replay any agent tasks that failed with mail_auth.
 * 6. Redirect to /settings/profile with a result flag.
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
    return redirectToProfile("denied");
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectToProfile("state_mismatch");
  }

  try {
    const { user, membership } = await getCurrentOrg();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const config = getMsGraphOAuthConfig(siteUrl);

    const tokens = await exchangeCodeForTokens(config, code);
    const userInfo = await fetchMsGraphUserInfo(tokens.access_token);

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    const scopes = tokens.scope.split(" ");

    await MailCredentialsServiceFactory.getInstance().upsert({
      userId: user.id,
      organizationId: membership.organizationId,
      provider: "outlook",
      emailAddress: userInfo.email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token!, // exchangeCode throws if missing
      expiresAt,
      scopes,
    });

    let replayedCount = 0;
    try {
      replayedCount = await replayGmailAuthFailedTasksForUser(
        membership.organizationId,
        user.id,
      );
    } catch (err) {
      console.error("[mail oauth callback] replay failed (non-fatal)", err);
    }

    return redirectToProfile("connected", replayedCount);
  } catch (err) {
    console.error("[mail oauth callback] failed", err);
    return redirectToProfile("exchange_failed");
  }
}

function redirectToProfile(result: string, replayed?: number): NextResponse {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  // Reuse the same `gmail` / `gmail_replayed` query params as the Gmail
  // callback so the existing profile page banner logic handles both
  // providers without branching. Sprint 17 — rename to `mail` /
  // `mail_replayed` once the existing handler is generalised.
  const qs = new URLSearchParams({ gmail: result });
  if (replayed && replayed > 0) qs.set("gmail_replayed", String(replayed));
  return NextResponse.redirect(`${siteUrl}/settings/profile?${qs.toString()}`);
}
