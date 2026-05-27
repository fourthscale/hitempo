"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import { getActiveOrg } from "@/lib/auth/context";
import type { BrandBrief, BrandBriefLocale } from "@/lib/brand/brand-brief";
import { InvalidInputError } from "./user-facing-action-error";
import { withActionError } from "./wrap-action-error";

/**
 * Brand brief editor sends one form field per (locale × field). List-type
 * fields (toneOfVoice, forbiddenWords, etc.) are encoded as newline-separated
 * strings in the textarea, then split + trimmed server-side.
 *
 * `positioning` capped at ~2000 chars to keep the system prompt reasonable.
 * Lists capped at 5000 chars total (line-separated). These limits also bound
 * the size of the JSONB payload.
 */
const STRING_FIELD = z.string().trim().max(2000).optional().or(z.literal(""));
const LIST_FIELD = z.string().trim().max(5000).optional().or(z.literal(""));

const updateSchema = z.object({
  fr_positioning: STRING_FIELD,
  fr_toneOfVoice: LIST_FIELD,
  fr_forbiddenWords: LIST_FIELD,
  fr_signatureExpressions: LIST_FIELD,
  fr_valueProps: LIST_FIELD,
  fr_proofPoints: LIST_FIELD,
  en_positioning: STRING_FIELD,
  en_toneOfVoice: LIST_FIELD,
  en_forbiddenWords: LIST_FIELD,
  en_signatureExpressions: LIST_FIELD,
  en_valueProps: LIST_FIELD,
  en_proofPoints: LIST_FIELD,
});

type Parsed = z.infer<typeof updateSchema>;

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildLocale(data: Parsed, locale: "fr" | "en"): BrandBriefLocale | undefined {
  const positioning = (data[`${locale}_positioning`] ?? "").trim();
  const toneOfVoice = parseList(data[`${locale}_toneOfVoice`]);
  const forbiddenWords = parseList(data[`${locale}_forbiddenWords`]);
  const signatureExpressions = parseList(data[`${locale}_signatureExpressions`]);
  const valueProps = parseList(data[`${locale}_valueProps`]);
  const proofPoints = parseList(data[`${locale}_proofPoints`]);

  const hasAnything =
    positioning !== "" ||
    toneOfVoice.length > 0 ||
    forbiddenWords.length > 0 ||
    signatureExpressions.length > 0 ||
    valueProps.length > 0 ||
    proofPoints.length > 0;

  if (!hasAnything) return undefined;

  return {
    positioning,
    toneOfVoice,
    forbiddenWords,
    signatureExpressions,
    valueProps,
    proofPoints,
  };
}

async function _updateBrandBriefAction(formData: FormData): Promise<void> {
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new InvalidInputError(parsed.error);

  const { activeOrganization } = await getActiveOrg();

  const fr = buildLocale(parsed.data, "fr");
  const en = buildLocale(parsed.data, "en");

  const brief: BrandBrief = {};
  if (fr) brief.fr = fr;
  if (en) brief.en = en;

  await getDb()
    .update(organizations)
    .set({ brandBrief: brief, updatedAt: new Date() })
    .where(eq(organizations.id, activeOrganization.id));

  revalidatePath("/settings/brand");
  revalidatePath("/settings");
}

export const updateBrandBriefAction = withActionError(_updateBrandBriefAction);
