import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { UserFacingActionError } from "./user-facing-action-error";

/**
 * Wraps a Server Action body so any `UserFacingActionError` raised inside
 * is converted into a redirect back to the page the user came from, with
 * `?action_error=<code>` (and any `redirectParams` from the error) appended.
 *
 * The global `<ActionErrorModal />` mounted in `(app)` and `/admin` layouts
 * watches that query param and opens a localized modal. Effect : every
 * action failure that we've decided is user-facing produces a friendly
 * dialog instead of the App Router full-page error boundary.
 *
 * System errors (anything NOT extending `UserFacingActionError`) re-throw
 * unchanged, so the error boundary still catches genuine anomalies.
 *
 * The redirect target comes from the `referer` header — the action doesn't
 * need to know where it lives. Falls back to `/dashboard` if no referer.
 *
 * Usage :
 * ```ts
 * export async function someAction(formData: FormData) {
 *   return wrapActionError(async () => {
 *     const parsed = schema.safeParse(...);
 *     if (!parsed.success) throw new InvalidInputError(parsed.error);
 *     // ... happy path
 *   });
 * }
 * ```
 */
export async function wrapActionError<T>(
  body: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await body();
  } catch (err) {
    if (err instanceof UserFacingActionError) {
      const referer = (await headers()).get("referer");
      const target = buildErrorRedirect(referer, err);
      redirect(target);
    }
    throw err;
  }
}

/**
 * Higher-order helper : decorates a Server Action so its body runs inside
 * `wrapActionError`. Lets call sites declare actions normally and apply the
 * error contract at export time, instead of nesting the body in a closure.
 *
 * ```ts
 * async function _createCompanyAction(formData: FormData) {
 *   // happy path — throws InvalidInputError / NotFoundError on user errors
 * }
 * export const createCompanyAction = withActionError(_createCompanyAction);
 * ```
 *
 * The signature is preserved so TypeScript + the Next.js server-action
 * runtime still see the action as a plain async function of FormData.
 */
export function withActionError<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R | undefined> {
  return (...args: Args) => wrapActionError(() => fn(...args));
}

/**
 * Builds the redirect URL : starts from the referer's path + query, drops
 * any existing `action_error`/`email`/etc carryover, then layers in the
 * fresh `action_error=<code>` and `redirectParams`.
 *
 * Exported for unit-testing only — production callers use `wrapActionError`.
 */
export function buildErrorRedirect(
  referer: string | null,
  err: UserFacingActionError,
): string {
  // Parse the referer with an arbitrary base — we only consume pathname +
  // searchParams + hash, so the base never appears in the output.
  const url = referer
    ? new URL(referer, "http://x")
    : new URL("/dashboard", "http://x");

  // Drop any prior error keys so the same modal doesn't get layered twice.
  url.searchParams.delete("action_error");
  url.searchParams.delete("email");

  url.searchParams.set("action_error", err.code.toLowerCase());
  if (err.redirectParams) {
    for (const [k, v] of Object.entries(err.redirectParams)) {
      url.searchParams.set(k, v);
    }
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
