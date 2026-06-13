import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/context";
import { buildAuthorizationUrl, getMsGraphOAuthConfig } from "@/lib/outlook/ms-graph-oauth";

const STATE_COOKIE = "mail_oauth_state";
const STATE_TTL_SECONDS = 10 * 60;

/**
 * Sprint 16 — unified mail OAuth entry point. Currently routes the
 * Outlook flow ; the Gmail flow still goes through
 * /api/auth/gmail/connect because Google Cloud Console has the legacy
 * redirect URI registered. Eventually both providers could route here
 * (one less endpoint to maintain) once GCP's redirect URI is updated.
 *
 *   GET /api/auth/mail/connect?provider=outlook
 *     → redirect to Microsoft consent screen
 *
 *   GET /api/auth/mail/connect?provider=gmail
 *     → redirect to /api/auth/gmail/connect (legacy passthrough)
 *
 * State cookie carries the CSRF nonce. The callback validates the
 * round-trip.
 */
export async function GET(request: NextRequest) {
  await getCurrentUser();

  const provider = new URL(request.url).searchParams.get("provider");
  if (provider === "gmail") {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/auth/gmail/connect`,
    );
  }
  if (provider !== "outlook") {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/settings/profile?mail=missing_provider`,
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const config = getMsGraphOAuthConfig(siteUrl);

  const state = randomBytes(32).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: STATE_TTL_SECONDS,
    secure: process.env.NODE_ENV === "production",
  });

  return NextResponse.redirect(buildAuthorizationUrl(config, state));
}
