"use client";

/**
 * Client-side timezone context.
 *
 * Server Components fetch the user's TZ via `getActiveOrg().userTimezone`.
 * Client Components can't do that — they get the TZ from this context,
 * which is hydrated once at the `(app)/layout.tsx` boundary.
 *
 * Keep this dumb : a string in, a string out. Formatting still goes
 * through `formatDateInTz` so the same logic / fallback / DST handling
 * applies everywhere.
 */

import { createContext, useContext } from "react";

const TzContext = createContext<string>("UTC");

export function TzProvider({
  userTimezone,
  children,
}: {
  userTimezone: string;
  children: React.ReactNode;
}) {
  return <TzContext.Provider value={userTimezone}>{children}</TzContext.Provider>;
}

/** Returns the user's timezone (`organization_members.timezone`). Always
 *  defined — the context has a sane default (`"UTC"`) for tests / Storybook
 *  / orphan renders, but the real app always wraps in `<TzProvider>`. */
export function useUserTz(): string {
  return useContext(TzContext);
}
