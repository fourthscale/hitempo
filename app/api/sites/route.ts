import { NextRequest, NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/auth/context";
import { getSitesForTaskForm } from "@/db/queries/tasks";

/**
 * Sprint 12.5 — sites for a company, used by the task form's site
 * select. Mirrors `/api/contacts` : returns [] when no company is
 * picked, lets the field stay disabled UX-side until a company is
 * selected.
 */
export async function GET(req: NextRequest) {
  const { activeOrganization } = await getActiveOrg();
  const companyId = req.nextUrl.searchParams.get("companyId");
  if (!companyId) return NextResponse.json([]);
  const sites = await getSitesForTaskForm(activeOrganization.id, companyId);
  return NextResponse.json(sites);
}
