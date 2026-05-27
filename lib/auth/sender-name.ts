/**
 * Derives the sender's display name (first + last) from a Supabase auth user.
 *
 * Order of preference :
 *   1. `user_metadata.firstName` / `user_metadata.lastName` (explicitly set)
 *   2. `user_metadata.full_name` split on first space (common OAuth shape)
 *   3. Email local-part, capitalized, as firstName ; empty lastName
 *
 * Never throws — returns at minimum `{ firstName: "User", lastName: "" }`
 * so the caller can always render a signature.
 */
export type SenderNameInput = {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

export type SenderName = {
  firstName: string;
  lastName: string;
};

export function getSenderName(user: SenderNameInput): SenderName {
  const meta = user.user_metadata ?? {};

  const metaFirst = typeof meta.firstName === "string" ? meta.firstName.trim() : "";
  const metaLast  = typeof meta.lastName  === "string" ? meta.lastName.trim()  : "";
  if (metaFirst || metaLast) {
    return { firstName: metaFirst, lastName: metaLast };
  }

  const fullName = typeof meta.full_name === "string" ? meta.full_name.trim() : "";
  if (fullName) {
    const spaceIdx = fullName.indexOf(" ");
    if (spaceIdx === -1) return { firstName: fullName, lastName: "" };
    return {
      firstName: fullName.slice(0, spaceIdx).trim(),
      lastName: fullName.slice(spaceIdx + 1).trim(),
    };
  }

  const local = user.email?.split("@")[0]?.trim() ?? "";
  if (!local) return { firstName: "User", lastName: "" };
  return { firstName: capitalize(local), lastName: "" };
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
