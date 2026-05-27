"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveOrg } from "@/lib/auth/context";
import { recomputeCompanyScore } from "@/lib/scoring/recompute";

export async function recomputeCompanyScoreAction(formData: FormData) {
  const companyId = z.string().uuid().safeParse(formData.get("companyId"));
  if (!companyId.success) throw new Error("invalid_input");

  const { activeOrganization } = await getActiveOrg();
  await recomputeCompanyScore(activeOrganization.id, companyId.data);

  revalidatePath(`/companies/${companyId.data}`);
  revalidatePath("/companies");
  revalidatePath("/dashboard");
}
