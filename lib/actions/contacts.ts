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

const baseSchema = {
  companyId: z.string().uuid(),
  siteId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal("")),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  jobTitle: z.string().max(150).optional().or(z.literal("")),
  role: z
    .enum(["decision_maker", "influencer", "user", "prescriber", "assistant", "other"])
    .optional()
    .or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  linkedinUrl: z.string().url().optional().or(z.literal("")),
  preferredLanguage: z.string().max(10).default("fr"),
  preferredChannel: z
    .enum(["email", "phone", "linkedin", "in_person"])
    .optional()
    .or(z.literal("")),
  relevance: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(1).max(5).nullable().optional(),
  ),
  status: z.string().max(50).optional(),
  notes: z.string().max(5000).optional().or(z.literal("")),
};

const createSchema = z.object(baseSchema);
const updateSchema = z.object({ id: z.string().uuid(), ...baseSchema });

function emptyToNull<T extends Record<string, unknown>>(input: T) {
  const out: Record<string, unknown> = { ...input };
  for (const k of Object.keys(out)) if (out[k] === "") out[k] = null;
  return out;
}

async function _createContactAction(formData: FormData) {
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const { activeOrganization } = await getActiveOrg();
  const data = emptyToNull(parsed.data);

  const [row] = await getDb()
    .insert(contacts)
    .values({
      organizationId: activeOrganization.id,
      companyId: data.companyId as string,
      siteId: (data.siteId as string | null) ?? null,
      firstName: data.firstName as string,
      lastName: data.lastName as string,
      jobTitle: (data.jobTitle as string | null) ?? null,
      role: data.role
        ? (data.role as "decision_maker" | "influencer" | "user" | "prescriber" | "assistant" | "other")
        : null,
      email: (data.email as string | null) ?? null,
      phone: (data.phone as string | null) ?? null,
      linkedinUrl: (data.linkedinUrl as string | null) ?? null,
      preferredLanguage: (data.preferredLanguage as string) || "fr",
      preferredChannel: (data.preferredChannel as string | null) ?? null,
      relevance: (data.relevance as number | null) ?? null,
      status: (data.status as string) || "to_contact",
      notes: (data.notes as string | null) ?? null,
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
  const data = emptyToNull(parsed.data);

  await getDb()
    .update(contacts)
    .set({
      companyId: data.companyId as string,
      siteId: (data.siteId as string | null) ?? null,
      firstName: data.firstName as string,
      lastName: data.lastName as string,
      jobTitle: (data.jobTitle as string | null) ?? null,
      role: data.role
        ? (data.role as "decision_maker" | "influencer" | "user" | "prescriber" | "assistant" | "other")
        : null,
      email: (data.email as string | null) ?? null,
      phone: (data.phone as string | null) ?? null,
      linkedinUrl: (data.linkedinUrl as string | null) ?? null,
      preferredLanguage: (data.preferredLanguage as string) || "fr",
      preferredChannel: (data.preferredChannel as string | null) ?? null,
      relevance: (data.relevance as number | null) ?? null,
      status: (data.status as string) || "to_contact",
      notes: (data.notes as string | null) ?? null,
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
