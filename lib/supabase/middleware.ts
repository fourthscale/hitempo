import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const APP_ROUTE_PREFIXES = [
  "/dashboard",
  "/companies",
  "/contacts",
  "/tasks",
  "/settings",
  "/admin",
];

/**
 * Auth routes where ALREADY-authenticated users should be bounced into the app.
 * `/reset-password` is intentionally NOT in this list : that page is the
 * canonical destination for invite / recovery flows, which by design land the
 * user with a (recovery-scope) session already established. Redirecting them
 * away breaks the password-set step.
 */
const AUTH_ROUTE_PREFIXES = ["/login", "/forgot-password"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: getUser() triggers the cookie refresh cycle.
  // Do NOT remove this even if the user variable is unused.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAppRoute = APP_ROUTE_PREFIXES.some((p) => pathname.startsWith(p));
  const isAuthRoute = AUTH_ROUTE_PREFIXES.some((p) => pathname.startsWith(p));

  if (!user && isAppRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
