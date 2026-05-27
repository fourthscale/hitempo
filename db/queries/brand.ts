import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import type { BrandBrief } from "@/lib/brand/brand-brief";

/**
 * Returns the brand brief for an organization, or null if the org doesn't exist.
 * An empty `{}` brief is returned as-is — the caller decides what "empty" means
 * (e.g. the editor shows blank fields ; the generation action throws).
 */
export async function getBrandBrief(orgId: string): Promise<BrandBrief | null> {
  const row = await getDb().query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { brandBrief: true },
  });
  if (!row) return null;
  return row.brandBrief ?? {};
}

/**
 * Shape consumed by the generate dialog — boolean per locale + short excerpt
 * for display. Cheaper than passing the full brief through to UI code that
 * only needs to know "is it configured?" + "what does the user see?".
 */
export type BrandBriefStatus = {
  fr: { configured: boolean; excerpt: string | null };
  en: { configured: boolean; excerpt: string | null };
};

const EXCERPT_LEN = 160;

function buildExcerpt(positioning: string | undefined): string | null {
  if (!positioning) return null;
  const trimmed = positioning.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= EXCERPT_LEN
    ? trimmed
    : trimmed.slice(0, EXCERPT_LEN).trimEnd() + "…";
}

export async function getBrandBriefStatus(orgId: string): Promise<BrandBriefStatus> {
  const brief = await getBrandBrief(orgId);
  const fr = brief?.fr;
  const en = brief?.en;
  return {
    fr: {
      configured: Boolean(fr?.positioning),
      excerpt: buildExcerpt(fr?.positioning),
    },
    en: {
      configured: Boolean(en?.positioning),
      excerpt: buildExcerpt(en?.positioning),
    },
  };
}
