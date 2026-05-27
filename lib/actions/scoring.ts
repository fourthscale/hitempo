"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveOrg } from "@/lib/auth/context";
import { recomputeCompanyScore } from "@/lib/scoring/recompute";
import { InvalidInputError } from "./user-facing-action-error";
import { withActionError } from "./wrap-action-error";

async function _recomputeCompanyScoreAction(formData: FormData) {
  const companyId = z.string().uuid().safeParse(formData.get("companyId"));
  if (!companyId.success) throw new InvalidInputError(companyId.error);

  const { activeOrganization } = await getActiveOrg();
  await recomputeCompanyScore(activeOrganization.id, companyId.data);

  revalidatePath(`/companies/${companyId.data}`);
  revalidatePath("/companies");
  revalidatePath("/dashboard");
}

export const recomputeCompanyScoreAction = withActionError(_recomputeCompanyScoreAction);
