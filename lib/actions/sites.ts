"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sites } from "@/db/schema";
import { getActiveOrg } from "@/lib/auth/context";

const siteSchemaBase = {
  companyId: z.string().uuid(),
  name: z.string().min(1).max(200),
  type: z
    .enum(["office", "hotel", "showroom", "store", "restaurant", "warehouse", "other"])
    .default("office"),
  addressLine1: z.string().max(200).optional().or(z.literal("")),
  postalCode: z.string().max(20).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  region: z.string().max(100).optional().or(z.literal("")),
  country: z.string().length(2).default("FR"),
  isPrimary: z.preprocess((v) => v === "on" || v === true || v === "true", z.boolean()).optional(),
  standing: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(1).max(5).nullable().optional(),
  ),
  notes: z.string().max(2000).optional().or(z.literal("")),
};

const createSiteSchema = z.object(siteSchemaBase);
const updateSiteSchema = z.object({ id: z.string().uuid(), ...siteSchemaBase });

function emptyToNull<T extends Record<string, unknown>>(input: T) {
  const out: Record<string, unknown> = { ...input };
  for (const k of Object.keys(out)) if (out[k] === "") out[k] = null;
  return out;
}

export async function createSiteAction(formData: FormData) {
  const parsed = createSiteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("invalid_input");

  const { activeOrganization } = await getActiveOrg();
  const data = emptyToNull(parsed.data);
  const db = getDb();

  // Convention: the FIRST site of a company is auto-primary. Subsequent ones
  // default to non-primary unless explicitly checked.
  const userWantsPrimary = Boolean(data.isPrimary);
  const [existing] = await db
    .select({ c: count() })
    .from(sites)
    .where(
      and(
        eq(sites.companyId, parsed.data.companyId),
        eq(sites.organizationId, activeOrganization.id),
      ),
    );
  const isFirst = (existing?.c ?? 0) === 0;
  const willBePrimary = isFirst || userWantsPrimary;

  // If this site is going to be primary, unset other primaries first
  // (DB-level unique index would block otherwise).
  if (willBePrimary) {
    await db
      .update(sites)
      .set({ isPrimary: false })
      .where(
        and(
          eq(sites.companyId, parsed.data.companyId),
          eq(sites.organizationId, activeOrganization.id),
        ),
      );
  }

  await db.insert(sites).values({
    organizationId: activeOrganization.id,
    companyId: data.companyId as string,
    name: data.name as string,
    type: (data.type as "office" | "hotel" | "showroom" | "store" | "restaurant" | "warehouse" | "other") ?? "office",
    addressLine1: (data.addressLine1 as string | null) ?? null,
    postalCode: (data.postalCode as string | null) ?? null,
    city: (data.city as string | null) ?? null,
    region: (data.region as string | null) ?? null,
    country: ((data.country as string) || "FR").toUpperCase(),
    isPrimary: willBePrimary,
    standing: (data.standing as number | null) ?? null,
    notes: (data.notes as string | null) ?? null,
  });

  revalidatePath(`/companies/${parsed.data.companyId}`);
}

export async function updateSiteAction(formData: FormData) {
  const parsed = updateSiteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error("invalid_input");

  const { activeOrganization } = await getActiveOrg();
  const data = emptyToNull(parsed.data);
  const db = getDb();
  const wantsPrimary = Boolean(data.isPrimary);

  // If this site becomes primary, unset other primaries first.
  if (wantsPrimary) {
    await db
      .update(sites)
      .set({ isPrimary: false })
      .where(
        and(
          eq(sites.companyId, parsed.data.companyId),
          eq(sites.organizationId, activeOrganization.id),
          ne(sites.id, parsed.data.id),
        ),
      );
  }

  await db
    .update(sites)
    .set({
      name: data.name as string,
      type: (data.type as "office" | "hotel" | "showroom" | "store" | "restaurant" | "warehouse" | "other") ?? "office",
      addressLine1: (data.addressLine1 as string | null) ?? null,
      postalCode: (data.postalCode as string | null) ?? null,
      city: (data.city as string | null) ?? null,
      region: (data.region as string | null) ?? null,
      country: ((data.country as string) || "FR").toUpperCase(),
      isPrimary: wantsPrimary,
      standing: (data.standing as number | null) ?? null,
      notes: (data.notes as string | null) ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(sites.id, parsed.data.id), eq(sites.organizationId, activeOrganization.id)),
    );

  revalidatePath(`/companies/${parsed.data.companyId}`);
}

/**
 * Sets the primary contact for a site. Pass empty string for contactId to clear.
 */
export async function setSitePrimaryContactAction(formData: FormData) {
  const siteId = z.string().uuid().safeParse(formData.get("siteId"));
  const rawContact = formData.get("contactId");
  const contactId =
    rawContact === "" || rawContact == null
      ? null
      : z.string().uuid().parse(rawContact);

  if (!siteId.success) throw new Error("invalid_input");
  const { activeOrganization } = await getActiveOrg();

  await getDb()
    .update(sites)
    .set({ primaryContactId: contactId, updatedAt: new Date() })
    .where(and(eq(sites.id, siteId.data), eq(sites.organizationId, activeOrganization.id)));

  const companyId = formData.get("companyId");
  if (typeof companyId === "string") revalidatePath(`/companies/${companyId}`);
  revalidatePath(`/sites/${siteId.data}`);
}

export async function deleteSiteAction(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get("id"));
  const companyId = z.string().uuid().safeParse(formData.get("companyId"));
  if (!id.success || !companyId.success) throw new Error("invalid_id");

  const { activeOrganization } = await getActiveOrg();

  await getDb()
    .delete(sites)
    .where(
      and(eq(sites.id, id.data), eq(sites.organizationId, activeOrganization.id)),
    );

  revalidatePath(`/companies/${companyId.data}`);
}
