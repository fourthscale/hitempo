import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/context";
import { buildAuthorizationUrl, getGoogleOAuthConfig } from "@/lib/gmail/google-oauth";

const STATE_COOKIE = "gmail_oauth_state";
const STATE_TTL_SECONDS = 10 * 60; // 10 min — plenty for the consent flow

/**
 * Kicks off the Gmail OAuth flow.
 *
 *   GET /api/auth/gmail/connect
 *     → redirect to Google consent screen
 *
 * We mint a random `state`, store it in an httpOnly cookie, and pass it to
 * Google. The callback validates the round-trip to defeat CSRF.
 */
export async function GET() {
  // Must be authenticated — we tie credentials to the current user.
  await getCurrentUser();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const config = getGoogleOAuthConfig(siteUrl);

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
