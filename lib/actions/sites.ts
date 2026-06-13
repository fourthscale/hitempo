"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { sites } from "@/db/schema";
import { getActiveOrg } from "@/lib/auth/context";
import { InvalidInputError } from "./user-facing-action-error";
import { withActionError } from "./wrap-action-error";
import { emptyStringsToNull } from "./normalize";
import { persistSiteGeocode } from "@/lib/geocoding/persist-site-geocode";

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
  // IANA TZ string ; empty = inherit from company → org via the cascade resolver.
  timezone: z.string().max(64).optional().or(z.literal("")),
  isPrimary: z.preprocess((v) => v === "on" || v === true || v === "true", z.boolean()).optional(),
  standing: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
    z.number().int().min(1).max(5).nullable().optional(),
  ),
  notes: z.string().max(2000).optional().or(z.literal("")),
};

const createSiteSchema = z.object(siteSchemaBase);
const updateSiteSchema = z.object({ id: z.string().uuid(), ...siteSchemaBase });

async function _createSiteAction(formData: FormData) {
  const parsed = createSiteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const { activeOrganization } = await getActiveOrg();
  const data = emptyStringsToNull(parsed.data);
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

  const addressLine1 = (data.addressLine1 as string | null) ?? null;
  const postalCode = (data.postalCode as string | null) ?? null;
  const city = (data.city as string | null) ?? null;
  const region = (data.region as string | null) ?? null;
  const country = ((data.country as string) || "FR").toUpperCase();

  const [inserted] = await db
    .insert(sites)
    .values({
      organizationId: activeOrganization.id,
      companyId: data.companyId as string,
      name: data.name as string,
      type: (data.type as "office" | "hotel" | "showroom" | "store" | "restaurant" | "warehouse" | "other") ?? "office",
      addressLine1,
      postalCode,
      city,
      region,
      country,
      timezone: (data.timezone as string | null) ?? null,
      isPrimary: willBePrimary,
      standing: (data.standing as number | null) ?? null,
      notes: (data.notes as string | null) ?? null,
    })
    .returning({ id: sites.id });

  // Sprint 14 — fire-and-forget geocode. We don't await the result so
  // the user-facing action stays snappy ; the lat/lng is persisted
  // when the provider answers. The backfill action recovers any rows
  // we missed (e.g. provider down at write time).
  if (inserted?.id) {
    void persistSiteGeocode(activeOrganization.id, inserted.id, {
      addressLine1,
      postalCode,
      city,
      region,
      country,
    });
  }

  revalidatePath(`/companies/${parsed.data.companyId}`);
}

async function _updateSiteAction(formData: FormData) {
  const parsed = updateSiteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const { activeOrganization } = await getActiveOrg();
  const data = emptyStringsToNull(parsed.data);
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

  const addressLine1 = (data.addressLine1 as string | null) ?? null;
  const postalCode = (data.postalCode as string | null) ?? null;
  const city = (data.city as string | null) ?? null;
  const region = (data.region as string | null) ?? null;
  const country = ((data.country as string) || "FR").toUpperCase();

  await db
    .update(sites)
    .set({
      name: data.name as string,
      type: (data.type as "office" | "hotel" | "showroom" | "store" | "restaurant" | "warehouse" | "other") ?? "office",
      addressLine1,
      postalCode,
      city,
      region,
      country,
      timezone: (data.timezone as string | null) ?? null,
      isPrimary: wantsPrimary,
      standing: (data.standing as number | null) ?? null,
      notes: (data.notes as string | null) ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(sites.id, parsed.data.id), eq(sites.organizationId, activeOrganization.id)),
    );

  // Sprint 14 — re-geocode on every save. Simpler than diffing the
  // address fields and the BAN/Nominatim calls are cheap. Fire-and-
  // forget so the action returns quickly ; failures fall through to
  // the backfill safety net.
  void persistSiteGeocode(activeOrganization.id, parsed.data.id, {
    addressLine1,
    postalCode,
    city,
    region,
    country,
  });

  revalidatePath(`/companies/${parsed.data.companyId}`);
  revalidatePath(`/sites/${parsed.data.id}`);
  redirect(`/sites/${parsed.data.id}`);
}

/**
 * Sets the primary contact for a site. Pass empty string for contactId to clear.
 */
async function _setSitePrimaryContactAction(formData: FormData) {
  const siteId = z.string().uuid().safeParse(formData.get("siteId"));
  const rawContact = formData.get("contactId");
  const contactId =
    rawContact === "" || rawContact == null
      ? null
      : z.string().uuid().parse(rawContact);

  if (!siteId.success) throw new InvalidInputError(siteId.error);
  const { activeOrganization } = await getActiveOrg();

  await getDb()
    .update(sites)
    .set({ primaryContactId: contactId, updatedAt: new Date() })
    .where(and(eq(sites.id, siteId.data), eq(sites.organizationId, activeOrganization.id)));

  const companyId = formData.get("companyId");
  if (typeof companyId === "string") revalidatePath(`/companies/${companyId}`);
  revalidatePath(`/sites/${siteId.data}`);
}

async function _deleteSiteAction(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get("id"));
  const companyId = z.string().uuid().safeParse(formData.get("companyId"));
  if (!id.success || !companyId.success) throw new InvalidInputError(id.success ? companyId.error : id.error);

  const { activeOrganization } = await getActiveOrg();

  await getDb()
    .delete(sites)
    .where(
      and(eq(sites.id, id.data), eq(sites.organizationId, activeOrganization.id)),
    );

  revalidatePath(`/companies/${companyId.data}`);
}

// ---------------------------------------------------------------------------
// Wrapped exports — see lib/actions/wrap-action-error.ts
// ---------------------------------------------------------------------------

/**
 * Sprint 14 — one-shot backfill for sites without coordinates.
 * Idempotent : finds every site of the active org where lat OR lng is
 * NULL but at least one address field is set, then runs them through
 * the GeocodingService. FR rows go fast (BAN unlimited) ; non-FR rows
 * serialize at 1 req/sec to honour Nominatim's ToS.
 *
 * The action returns a summary that the field page surfaces ("X sites
 * geocoded, Y failed"). Errors per-row are swallowed (logged) so a
 * single bad address doesn't kill the whole batch.
 */
async function _backfillSiteGeocodesAction(): Promise<{
  total: number;
  geocoded: number;
  failed: number;
}> {
  const { activeOrganization } = await getActiveOrg();
  const orgId = activeOrganization.id;
  const { isNull, or, sql } = await import("drizzle-orm");
  const db = getDb();

  // Pull only the columns we need ; skip sites with absolutely no
  // address material (geocoder would just throw EmptyAddress anyway).
  const rows = await db
    .select({
      id: sites.id,
      addressLine1: sites.addressLine1,
      postalCode: sites.postalCode,
      city: sites.city,
      region: sites.region,
      country: sites.country,
    })
    .from(sites)
    .where(
      and(
        eq(sites.organizationId, orgId),
        or(isNull(sites.lat), isNull(sites.lng)),
        sql`(${sites.addressLine1} is not null or ${sites.postalCode} is not null or ${sites.city} is not null)`,
      ),
    );

  let geocoded = 0;
  let failed = 0;
  // Process sequentially so the Nominatim rate-limit gate works as
  // expected (concurrent calls would serialize anyway but blow up
  // the call stack). FR rows still go fast in practice because BAN
  // has no rate limit and the await is cheap.
  for (const row of rows) {
    const result = await persistSiteGeocode(orgId, row.id, {
      addressLine1: row.addressLine1,
      postalCode: row.postalCode,
      city: row.city,
      region: row.region,
      country: row.country ?? "FR",
    });
    if (result.success) geocoded++;
    else failed++;
  }

  revalidatePath("/field");
  return { total: rows.length, geocoded, failed };
}

export const createSiteAction = withActionError(_createSiteAction);
export const updateSiteAction = withActionError(_updateSiteAction);
export const backfillSiteGeocodesAction = withActionError(_backfillSiteGeocodesAction);
export const setSitePrimaryContactAction = withActionError(_setSitePrimaryContactAction);
export const deleteSiteAction = withActionError(_deleteSiteAction);
