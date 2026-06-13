import "server-only";

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sites } from "@/db/schema";
import { GeocodingServiceFactory } from "./geocoding-service-factory";
import { GeocodingError } from "./geocoding-errors";

/**
 * Convenience helper : geocode the given site (already in DB) and
 * persist the lat/lng if found. Designed as a fire-and-forget call
 * from `createSiteAction` / `updateSiteAction` ; any error is caught
 * and logged so the user-facing action never fails because of a
 * geocoding hiccup.
 *
 * Returns whether coordinates were written, useful for the backfill
 * action that needs to surface progress.
 */
export async function persistSiteGeocode(
  orgId: string,
  siteId: string,
  input: {
    addressLine1: string | null;
    postalCode: string | null;
    city: string | null;
    region: string | null;
    country: string;
  },
): Promise<{ success: boolean; reason?: string }> {
  try {
    const result = await GeocodingServiceFactory.getInstance().geocode(input);
    await getDb()
      .update(sites)
      .set({
        lat: String(result.lat),
        lng: String(result.lng),
        updatedAt: new Date(),
      })
      .where(and(eq(sites.id, siteId), eq(sites.organizationId, orgId)));
    return { success: true };
  } catch (err) {
    // Typed errors are expected (empty address, not found, network) ;
    // we don't want them in Sentry as exceptions. Untyped errors are
    // logged loudly because they indicate a bug.
    if (err instanceof GeocodingError) {
      return { success: false, reason: err.message };
    }
    console.error("[persistSiteGeocode] unexpected", err);
    return {
      success: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
