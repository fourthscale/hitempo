"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { contacts } from "@/db/schema";
import { getActiveOrg } from "@/lib/auth/context";
import { InvalidInputError } from "./user-facing-action-error";
import { withActionError } from "./wrap-action-error";
import { emptyStringsToNull } from "./normalize";
import { contactBodySchema } from "@/lib/contacts/contact-kind";

type ContactRole =
  | "decision_maker"
  | "influencer"
  | "user"
  | "prescriber"
  | "assistant"
  | "other";

const updateSchema = z.intersection(
  z.object({ id: z.string().uuid() }),
  contactBodySchema,
);

async function _createContactAction(formData: FormData) {
  const parsed = contactBodySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const { activeOrganization } = await getActiveOrg();
  const data = emptyStringsToNull(parsed.data);

  const [row] = await getDb()
    .insert(contacts)
    .values({
      organizationId: activeOrganization.id,
      companyId: data.companyId as string,
      siteId: (data.siteId as string | null) ?? null,
      kind: parsed.data.kind,
      firstName: (data.firstName as string | null) ?? null,
      lastName: (data.lastName as string | null) ?? null,
      jobTitle: (data.jobTitle as string | null) ?? null,
      role: data.role ? (data.role as ContactRole) : null,
      email: (data.email as string | null) ?? null,
      phone: (data.phone as string | null) ?? null,
      linkedinUrl: (data.linkedinUrl as string | null) ?? null,
      preferredLanguage: (data.preferredLanguage as string) || "fr",
      preferredChannel: (data.preferredChannel as string | null) ?? null,
      relevance: (data.relevance as number | null) ?? null,
      status: (data.status as string) || "to_contact",
      notes: (data.notes as string | null) ?? null,
      ownerId: (data.ownerId as string | null) ?? null,
    })
    .returning();

  revalidatePath("/contacts");
  revalidatePath(`/companies/${parsed.data.companyId}`);
  redirect(`/contacts/${row!.id}`);
}

async function _updateContactAction(formData: FormData) {
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const { activeOrganization } = await getActiveOrg();
  const data = emptyStringsToNull(parsed.data);

  await getDb()
    .update(contacts)
    .set({
      companyId: data.companyId as string,
      siteId: (data.siteId as string | null) ?? null,
      kind: parsed.data.kind,
      firstName: (data.firstName as string | null) ?? null,
      lastName: (data.lastName as string | null) ?? null,
      jobTitle: (data.jobTitle as string | null) ?? null,
      role: data.role ? (data.role as ContactRole) : null,
      email: (data.email as string | null) ?? null,
      phone: (data.phone as string | null) ?? null,
      linkedinUrl: (data.linkedinUrl as string | null) ?? null,
      preferredLanguage: (data.preferredLanguage as string) || "fr",
      preferredChannel: (data.preferredChannel as string | null) ?? null,
      relevance: (data.relevance as number | null) ?? null,
      status: (data.status as string) || "to_contact",
      notes: (data.notes as string | null) ?? null,
      ownerId: (data.ownerId as string | null) ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(contacts.id, parsed.data.id), eq(contacts.organizationId, activeOrganization.id)),
    );

  revalidatePath("/contacts");
  revalidatePath(`/contacts/${parsed.data.id}`);
  revalidatePath(`/companies/${parsed.data.companyId}`);
  redirect(`/contacts/${parsed.data.id}`);
}

async function _deleteContactAction(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) throw new InvalidInputError(id.error);

  const { activeOrganization } = await getActiveOrg();

  await getDb()
    .update(contacts)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(contacts.id, id.data), eq(contacts.organizationId, activeOrganization.id)),
    );

  revalidatePath("/contacts");
  redirect("/contacts");
}

// ---------------------------------------------------------------------------
// Wrapped exports — see lib/actions/wrap-action-error.ts
// ---------------------------------------------------------------------------

export const createContactAction = withActionError(_createContactAction);
export const updateContactAction = withActionError(_updateContactAction);
export const deleteContactAction = withActionError(_deleteContactAction);
