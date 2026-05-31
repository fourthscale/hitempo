"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { companies } from "@/db/schema";
import { getActiveOrg } from "@/lib/auth/context";
import { recomputeCompanyScore } from "@/lib/scoring/recompute";
import { InvalidInputError } from "./user-facing-action-error";
import { withActionError } from "./wrap-action-error";
import { emptyStringsToNull } from "./normalize";

const baseSchema = {
  name: z.string().min(1).max(200),
  legalName: z.string().max(200).optional().or(z.literal("")),
  websiteUrl: z.string().url().optional().or(z.literal("")),
  linkedinUrl: z.string().url().optional().or(z.literal("")),
  relationshipType: z
    .enum(["prospect", "client", "former_client", "prescriber", "partner"])
    .optional()
    .or(z.literal("")),
  industry: z.string().max(100).optional().or(z.literal("")),
  sizeEstimate: z.string().max(50).optional().or(z.literal("")),
  standing: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(1).max(5).nullable().optional(),
  ),
  primaryLocale: z.string().max(10).optional(),
  // IANA TZ string ; empty = inherit from org via the cascade resolver.
  timezone: z.string().max(64).optional().or(z.literal("")),
  status: z.string().max(50).optional(),
  signalType: z.string().max(100).optional().or(z.literal("")),
  signalSource: z.string().max(200).optional().or(z.literal("")),
  notes: z.string().max(5000).optional().or(z.literal("")),
  parentId: z.string().uuid().optional().or(z.literal("")),
  ownerId: z.string().uuid().optional().or(z.literal("")),
};

const createSchema = z.object(baseSchema);
const updateSchema = z.object({ id: z.string().uuid(), ...baseSchema });

async function _createCompanyAction(formData: FormData) {
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new InvalidInputError(parsed.error);
  }
  const { activeOrganization } = await getActiveOrg();
  const data = emptyStringsToNull(parsed.data);

  const [row] = await getDb()
    .insert(companies)
    .values({
      organizationId: activeOrganization.id,
      name: data.name as string,
      legalName: (data.legalName as string | null) ?? null,
      websiteUrl: (data.websiteUrl as string | null) ?? null,
      linkedinUrl: (data.linkedinUrl as string | null) ?? null,
      relationshipType: data.relationshipType
        ? (data.relationshipType as "prospect" | "client" | "former_client" | "prescriber" | "partner")
        : null,
      industry: (data.industry as string | null) ?? null,
      sizeEstimate: (data.sizeEstimate as string | null) ?? null,
      standing: (data.standing as number | null) ?? null,
      primaryLocale: (data.primaryLocale as string) || "fr",
      timezone: (data.timezone as string | null) ?? null,
      status: (data.status as string) || "to_qualify",
      signalType: (data.signalType as string | null) ?? null,
      signalSource: (data.signalSource as string | null) ?? null,
      notes: (data.notes as string | null) ?? null,
      parentId: (data.parentId as string | null) ?? null,
      ownerId: (data.ownerId as string | null) ?? null,
    })
    .returning();

  revalidatePath("/companies");
  redirect(`/companies/${row!.id}`);
}

async function _updateCompanyAction(formData: FormData) {
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    throw new InvalidInputError(parsed.error);
  }
  const { activeOrganization } = await getActiveOrg();
  const data = emptyStringsToNull(parsed.data);

  // Guard against creating a self-loop (parentId === own id)
  const parentId =
    (data.parentId as string | null) && (data.parentId as string) !== parsed.data.id
      ? (data.parentId as string)
      : null;

  await getDb()
    .update(companies)
    .set({
      name: data.name as string,
      legalName: (data.legalName as string | null) ?? null,
      websiteUrl: (data.websiteUrl as string | null) ?? null,
      linkedinUrl: (data.linkedinUrl as string | null) ?? null,
      relationshipType: data.relationshipType
        ? (data.relationshipType as "prospect" | "client" | "former_client" | "prescriber" | "partner")
        : null,
      industry: (data.industry as string | null) ?? null,
      sizeEstimate: (data.sizeEstimate as string | null) ?? null,
      standing: (data.standing as number | null) ?? null,
      primaryLocale: (data.primaryLocale as string) || "fr",
      timezone: (data.timezone as string | null) ?? null,
      status: (data.status as string) || "to_qualify",
      signalType: (data.signalType as string | null) ?? null,
      signalSource: (data.signalSource as string | null) ?? null,
      notes: (data.notes as string | null) ?? null,
      parentId,
      ownerId: (data.ownerId as string | null) ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(companies.id, parsed.data.id),
        eq(companies.organizationId, activeOrganization.id),
      ),
    );

  revalidatePath(`/companies/${parsed.data.id}`);
  revalidatePath("/companies");
  void recomputeCompanyScore(activeOrganization.id, parsed.data.id);
  redirect(`/companies/${parsed.data.id}`);
}

async function _deleteCompanyAction(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) throw new InvalidInputError(id.error);

  const { activeOrganization } = await getActiveOrg();

  await getDb()
    .update(companies)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(companies.id, id.data), eq(companies.organizationId, activeOrganization.id)),
    );

  revalidatePath("/companies");
  redirect("/companies");
}

/**
 * Sets the primary contact for a company. Pass empty string to clear.
 * UX: invoked from the "Changer" button on the company detail's Contact prioritaire card.
 */
async function _setPrimaryContactAction(formData: FormData) {
  const companyId = z.string().uuid().safeParse(formData.get("companyId"));
  const rawContact = formData.get("contactId");
  const contactId =
    rawContact === "" || rawContact == null
      ? null
      : z.string().uuid().parse(rawContact);

  if (!companyId.success) throw new InvalidInputError(companyId.error);
  const { activeOrganization } = await getActiveOrg();

  await getDb()
    .update(companies)
    .set({ primaryContactId: contactId, updatedAt: new Date() })
    .where(
      and(eq(companies.id, companyId.data), eq(companies.organizationId, activeOrganization.id)),
    );

  revalidatePath(`/companies/${companyId.data}`);
  void recomputeCompanyScore(activeOrganization.id, companyId.data);
}

// ---------------------------------------------------------------------------
// Wrapped exports — all action errors flow through `wrapActionError` so
// `UserFacingActionError` subclasses surface via the global modal instead
// of the App Router error boundary.
// ---------------------------------------------------------------------------

export const createCompanyAction = withActionError(_createCompanyAction);
export const updateCompanyAction = withActionError(_updateCompanyAction);
export const deleteCompanyAction = withActionError(_deleteCompanyAction);
export const setPrimaryContactAction = withActionError(_setPrimaryContactAction);
